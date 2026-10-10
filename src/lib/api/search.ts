// Message search routes (Discord's guild / DM search).
//
//   GET /servers/:serverId/messages/search   every channel + thread the user can view
//   GET /dms/search                          the user's DMs and group DMs (?channelId= narrows)
//   (GET /channels/:channelId/messages/search in channels.ts delegates to searchInChannels)
//
// Query (all optional, comma-separated lists):
//   q            free text (words / word prefixes, all must match)
//   authorId     from: user ids          author   from: names to resolve
//   mentions     mentions: user ids      mentionName  mentions: names to resolve
//   has          link,embed,file,image,video,sound,sticker,poll (all must hold)
//   channelId    in: channel ids (intersected with what the user can view)
//   pinned       true | false
//   authorType   user,bot,webhook
//   minTime / maxTime   ISO bounds (the client turns before/after/during into these)
//   sort         newest | oldest | relevant
//   offset / limit      paging (25 per page by default)
//
// The search service only ever sees channel ids that passed the same view
// checks as opening the channel, so results can't leak from hidden channels.
import { Elysia, t } from 'elysia';
import { and, inArray, or, sql, type SQL } from 'drizzle-orm';
import { Channel, User } from '@/lib/models';
import { db, schema } from '@/lib/db/postgres';
import { normalizeId } from '@/lib/db/normalizeId';
import { authenticateRequest } from '@/lib/services/auth';
import { checkRateLimit, isValidObjectId } from '@/lib/security';
import { clampInt } from '@/lib/utils/clampInt';
import {
  isSearchIndexComplete,
  searchMessages,
  SEARCH_PAGE_SIZE,
  type SearchMessageRow,
} from '@/lib/services/messageSearch';
import {
  SEARCH_AUTHOR_TYPES,
  SEARCH_HAS_VALUES,
  type SearchAuthorType,
  type SearchHas,
  type SearchSort,
} from '@/lib/chat/searchQuery';

async function getAuth(headers: Record<string, string | undefined>, cookie: Record<string, { value?: unknown }>) {
  const authToken = cookie.auth_token?.value;
  const cookies: Record<string, string> = {};
  if (typeof authToken === 'string') cookies.auth_token = authToken;
  return authenticateRequest(headers.authorization ?? null, cookies);
}

export const SEARCH_QUERY = t.Object({
  q: t.Optional(t.String({ maxLength: 512 })),
  authorId: t.Optional(t.String({ maxLength: 2000 })),
  author: t.Optional(t.String({ maxLength: 500 })),
  mentions: t.Optional(t.String({ maxLength: 2000 })),
  mentionName: t.Optional(t.String({ maxLength: 500 })),
  has: t.Optional(t.String({ maxLength: 200 })),
  channelId: t.Optional(t.String({ maxLength: 4000 })),
  pinned: t.Optional(t.String()),
  authorType: t.Optional(t.String({ maxLength: 50 })),
  minTime: t.Optional(t.String({ maxLength: 40 })),
  maxTime: t.Optional(t.String({ maxLength: 40 })),
  sort: t.Optional(t.String()),
  offset: t.Optional(t.String()),
  limit: t.Optional(t.String()),
  // Legacy single-channel params (old clients): from / before / after.
  from: t.Optional(t.String({ maxLength: 200 })),
  before: t.Optional(t.String({ maxLength: 40 })),
  after: t.Optional(t.String({ maxLength: 40 })),
  searchLimit: t.Optional(t.String()),
});
export type SearchQueryInput = typeof SEARCH_QUERY.static;

const csv = (v: string | undefined, max = 25): string[] =>
  (v || '').split(',').map((x) => x.trim()).filter(Boolean).slice(0, max);

const idList = (v: string | undefined, max = 25) => csv(v, max).filter((id) => isValidObjectId(id));

function parseDate(v: string | undefined): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Resolve typed names (from:alice) to user ids, limited to `scope` (members of the searched place). */
async function resolveUserNames(names: string[], scope: SQL): Promise<string[]> {
  if (names.length === 0) return [];
  const conds = names.map((n) => {
    const like = `%${n.toLowerCase().replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    return sql`(lower(${schema.users.username}) LIKE ${like} OR lower(coalesce(${schema.users.displayName}, '')) LIKE ${like})`;
  });
  const rows = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(and(scope, or(...conds)))
    .limit(50);
  return rows.map((r) => r.id);
}

/** from:/mentions: name lookups limited to a server's members. */
export function memberScopeForServer(serverId: string): SQL {
  return sql`${schema.users.id} IN (SELECT ${schema.serverMembers.userId} FROM ${schema.serverMembers} WHERE ${schema.serverMembers.serverId} = ${normalizeId(serverId)})`;
}

/** from:/mentions: name lookups limited to a set of users (DM recipients). */
export function memberScopeForUsers(ids: string[]): SQL {
  if (ids.length === 0) return sql`false`;
  return inArray(schema.users.id, ids.slice(0, 2000).map((id) => normalizeId(id)));
}

type SearchChannel = {
  id: string;
  name: string;
  type: string | null;
  serverId: string | null;
  parentId: string | null;
  recipientIds?: string[] | null;
  icon?: string | null;
};

/**
 * Run a search over `channels` (already permission-filtered) and shape the
 * response: hits with authors, channel info for grouping/jumping, and the
 * users mentioned in the hits (so mentions render as names).
 */
export async function searchInChannels(
  viewerId: string,
  channels: SearchChannel[],
  query: SearchQueryInput,
  opts: { memberScope: SQL },
) {
  const byId = new Map(channels.map((c) => [normalizeId(c.id), c]));
  let channelIds = [...byId.keys()];
  const inIds = idList(query.channelId, 100).map((id) => normalizeId(id));
  if (inIds.length > 0) channelIds = inIds.filter((id) => byId.has(id));

  const has = csv(query.has, 8).map((h) => h.toLowerCase()).filter((h): h is SearchHas => (SEARCH_HAS_VALUES as readonly string[]).includes(h));
  const authorTypes = csv(query.authorType, 3).map((h) => h.toLowerCase()).filter((h): h is SearchAuthorType => (SEARCH_AUTHOR_TYPES as readonly string[]).includes(h));

  // from: / mentions: — ids from the client's autocomplete, plus names to resolve.
  const authorNames = csv(query.author, 5);
  const legacyFrom = (query.from || '').trim();
  if (legacyFrom) {
    if (isValidObjectId(legacyFrom)) query = { ...query, authorId: [query.authorId, legacyFrom].filter(Boolean).join(',') };
    else authorNames.push(legacyFrom);
  }
  let authorIds = idList(query.authorId);
  if (authorNames.length > 0) {
    const resolved = await resolveUserNames(authorNames, opts.memberScope);
    if (resolved.length === 0 && authorIds.length === 0) return emptyResponse();
    authorIds = [...authorIds, ...resolved];
  }
  let mentionIds = idList(query.mentions);
  const mentionNames = csv(query.mentionName, 5);
  if (mentionNames.length > 0) {
    const resolved = await resolveUserNames(mentionNames, opts.memberScope);
    if (resolved.length === 0 && mentionIds.length === 0) return emptyResponse();
    mentionIds = [...mentionIds, ...resolved];
  }

  const pinned = query.pinned === 'true' ? true : query.pinned === 'false' ? false : undefined;
  let minTime = parseDate(query.minTime);
  let maxTime = parseDate(query.maxTime);
  // Legacy before:/after: (YYYY-MM-DD, UTC days).
  if (!maxTime && query.before) maxTime = parseDate(query.before);
  if (!minTime && query.after) minTime = parseDate(query.after);
  const sort: SearchSort = query.sort === 'oldest' || query.sort === 'relevant' ? query.sort : 'newest';
  const limit = clampInt(query.limit, SEARCH_PAGE_SIZE, 50);
  const offset = clampInt(query.offset, 0, 5000);
  const text = (query.q || '').trim();

  const anything = text || authorIds.length || mentionIds.length || has.length || pinned !== undefined || authorTypes.length || minTime || maxTime || inIds.length;
  if (!anything || channelIds.length === 0) return emptyResponse();

  const [result, complete] = await Promise.all([
    searchMessages({ channelIds, text, authorIds, mentionIds, has, pinned, authorTypes, minTime, maxTime, sort, offset, limit }),
    isSearchIndexComplete(),
  ]);

  const messages = await hydrate(viewerId, result.rows, result.contents, byId);
  return {
    totalResults: result.total,
    pageableResults: result.pageable,
    offset,
    limit,
    sort,
    indexing: !complete,
    ...messages,
  };
}

function emptyResponse() {
  return { totalResults: 0, pageableResults: 0, offset: 0, limit: SEARCH_PAGE_SIZE, sort: 'newest', indexing: false, messages: [], channels: [], users: [] };
}

type PublicUser = { id: string; username: string; displayName: string; avatar: string | null; isBot?: boolean; isWebhook?: boolean; isDiscord?: boolean; isSystem?: boolean };

async function hydrate(
  viewerId: string,
  rows: SearchMessageRow[],
  contents: Map<string, string>,
  channels: Map<string, SearchChannel>,
) {
  const authorIds = new Set<string>();
  const mentionIds = new Set<string>();
  for (const r of rows) {
    if (r.authorId) authorIds.add(r.authorId);
    for (const id of r.mentionedUserIds || []) mentionIds.add(id);
  }
  // DM recipients, so the client can label/jump to 1:1 DMs.
  const usedChannels = new Map<string, SearchChannel>();
  for (const r of rows) {
    const c = channels.get(normalizeId(r.channelId));
    if (c) usedChannels.set(c.id, c);
  }
  const dmPeerIds = new Set<string>();
  for (const c of usedChannels.values()) {
    if (c.type === 'dm' || c.type === 'group_dm') for (const id of c.recipientIds || []) if (id !== viewerId) dmPeerIds.add(id);
  }

  const wanted = Array.from(new Set([...authorIds, ...mentionIds, ...dmPeerIds]));
  const users = wanted.length > 0 ? await User.find({ id: { in: wanted } }) : [];
  const userMap = new Map<string, PublicUser>();
  for (const u of users) {
    userMap.set(u.id, {
      id: u.id,
      username: u.username,
      displayName: u.displayName || u.username,
      avatar: u.avatar ?? null,
      isBot: Boolean(u.isBot),
      isSystem: Boolean(u.isSystem),
    });
  }
  const missing = [...authorIds].filter((id) => !userMap.has(id));
  if (missing.length > 0) {
    const { DiscordUser } = await import('@/lib/models/DiscordUser');
    for (const d of await DiscordUser.findMany(missing)) {
      userMap.set(d.id, {
        id: d.id,
        username: d.username || `discord-${d.discordId}`,
        displayName: d.displayName || d.username || 'Discord User',
        avatar: d.avatar ?? null,
        isDiscord: true,
      });
    }
    const stillMissing = missing.filter((id) => !userMap.has(id));
    if (stillMissing.length > 0) {
      const { loadWebhookAuthors } = await import('@/lib/services/webhookAuthors');
      for (const w of await loadWebhookAuthors(stillMissing)) {
        userMap.set(w.id, { id: w.id, username: w.username, displayName: w.displayName, avatar: w.avatar, isBot: true, isWebhook: true });
      }
    }
  }

  // Parent names for threads ("#parent › thread" headers).
  const parentIds = [...usedChannels.values()].map((c) => c.parentId).filter((id): id is string => Boolean(id));
  const parents = parentIds.length > 0 ? await Channel.find({ id: { in: Array.from(new Set(parentIds)) } }) : [];
  const parentName = new Map(parents.map((p) => [p.id, p.name]));

  const messages = rows.map((r) => ({
    id: r.id,
    channelId: r.channelId,
    serverId: r.serverId,
    authorId: r.authorId,
    author: userMap.get(r.authorId) ?? null,
    content: contents.get(r.id) ?? '',
    type: r.type,
    attachments: Array.isArray(r.attachments) ? r.attachments : [],
    embeds: r.suppressEmbeds ? [] : Array.isArray(r.embeds) ? r.embeds : [],
    sticker: r.sticker ?? undefined,
    pinned: Boolean(r.pinned),
    edited: Boolean(r.edited),
    editedTimestamp: r.editedTimestamp,
    mentionedUserIds: r.mentionedUserIds || [],
    referencedMessageId: r.referencedMessageId,
    createdAt: r.createdAt,
  }));

  const channelList = [...usedChannels.values()].map((c) => {
    const peers = (c.recipientIds || []).filter((id) => id !== viewerId);
    return {
      id: c.id,
      name: c.name,
      type: c.type,
      serverId: c.serverId,
      parentId: c.parentId,
      parentName: c.parentId ? parentName.get(c.parentId) ?? null : null,
      icon: c.icon ?? null,
      // 1:1 DMs are routed by the other person's id (/dm/:recipientId).
      recipientId: c.type === 'dm' ? peers[0] ?? null : null,
      recipientNames: c.type === 'dm' || c.type === 'group_dm'
        ? peers.map((id) => userMap.get(id)?.displayName).filter(Boolean)
        : undefined,
    };
  });

  const mentionUsers = [...mentionIds].map((id) => userMap.get(id)).filter(Boolean);
  return { messages, channels: channelList, users: mentionUsers };
}

async function checkSearchRate(userId: string, set: { status?: number | string }) {
  const rl = await checkRateLimit('search', userId);
  if (!rl.success) {
    set.status = 429;
    return { error: 'You are searching too fast. Try again in a moment.', retryAfter: rl.retryAfter };
  }
  return null;
}

export const searchRoutes = new Elysia()
  .get('/servers/:serverId/messages/search', async ({ headers, cookie, params, query, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }
    if (!isValidObjectId(params.serverId)) {
      set.status = 400;
      return { error: 'Invalid server id' };
    }
    const limited = await checkSearchRate(user.id, set);
    if (limited) return limited;

    const { listViewableServerChannels } = await import('./channels');
    const channels = await listViewableServerChannels(user.id, params.serverId);
    if (!channels) {
      set.status = 403;
      return { error: 'You are not a member of this server' };
    }
    // from:/mentions: names resolve among this server's members only.
    return searchInChannels(user.id, channels, query, { memberScope: memberScopeForServer(params.serverId) });
  }, {
    params: t.Object({ serverId: t.String() }),
    query: SEARCH_QUERY,
  })
  .get('/dms/search', async ({ headers, cookie, query, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }
    const limited = await checkSearchRate(user.id, set);
    if (limited) return limited;

    // Every DM / group DM the user is a recipient of.
    const channels = await Channel.find({ type: { in: ['dm', 'group_dm'] }, recipientId: user.id });
    const memberIds = Array.from(new Set(channels.flatMap((c) => c.recipientIds || [])));
    return searchInChannels(user.id, channels, query, { memberScope: memberScopeForUsers(memberIds) });
  }, {
    query: SEARCH_QUERY,
  });

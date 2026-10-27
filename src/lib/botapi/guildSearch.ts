/**
 * GET /guilds/{guild.id}/messages/search for the Discord-compatible bot API,
 * over Serika's message search (src/lib/services/messageSearch.ts: the blind
 * content index plus plaintext metadata filters).
 *
 * Visibility: only channels the bot can view (listViewableServerChannels, the
 * same check as opening a channel, incl. private threads and screening) and
 * read the history of (VIEW_CHANNEL + READ_MESSAGE_HISTORY after overwrites;
 * threads follow their parent). Age-restricted channels only with
 * include_nsfw=true. End-to-end encrypted messages never match.
 *
 * MESSAGE_CONTENT: without the intent, filters that look at content, links,
 * embeds or attachments are refused (they would leak content through the
 * result set) and hits are redacted like every other bot read.
 *
 * Differences from Discord: `slop` is accepted but word distance isn't used
 * (all words must match, prefixes count); `link_hostname` is checked against
 * the decrypted hits, so a page can hold fewer than `limit` messages (Discord
 * documents the same); offsets past 5000 return an empty page.
 */
import { inArray, sql, type SQL } from 'drizzle-orm';
import { schema } from '@/lib/db/postgres';
import { Channel, Message, ServerMember, type IChannel, type IMessage } from '@/lib/models';
import { isValidObjectId } from '@/lib/security';
import { applyTimeout, botCan } from '@/lib/permissions/botChannel';
import { redactMessageContent, shouldRedactContent } from '@/lib/gateway/routing';
import { toDiscordChannel, toDiscordThreadMember } from '@/lib/services/gatewayEvents';
import { invalidFormBody } from './errors';
import { isPublicSnowflake, snowflakeTimestamp } from './snowflake';
import { uuidsForSnowflakes } from './snowflakeStore';
import {
  likeLiteral, messageLinksTo, parseGuildSearchQuery, searchSortFor, serikaHas, usesContentFilters,
  type DiscordSearchEmbedType, type GuildSearchQuery,
} from './guildSearchRules';

type Result = { status: number; body: unknown; headers?: Record<string, string> };

const m = schema.messages;
const MISSING_ACCESS = { code: 50001, message: 'Missing Access' };
const SERIKA_MAX_OFFSET = 5000;

const isThread = (c: { type?: string | null }) => c.type === 'public_thread' || c.type === 'private_thread';
const lower = (s: string) => s.toLowerCase();

/** UUIDs for a list of UUIDs / snowflakes (unknown snowflakes are dropped). */
export async function resolveIdList(values: readonly string[]): Promise<string[]> {
  const out = new Set<string>();
  const sfs: string[] = [];
  for (const v of values) {
    if (isValidObjectId(v)) out.add(lower(v));
    else if (isPublicSnowflake(v)) sfs.push(v);
  }
  if (sfs.length > 0) {
    const res = await uuidsForSnowflakes(sfs);
    for (const sf of sfs) {
      const hit = res.map.get(sf);
      if (hit) out.add(lower(hit.uuid));
    }
  }
  return [...out];
}

/** A min_id / max_id bound as a time: snowflakes carry it, a message UUID is looked up in this guild. */
async function boundTime(id: string | null, guildId: string): Promise<number | null> {
  if (!id) return null;
  if (!isValidObjectId(id)) return snowflakeTimestamp(id);
  const msg = await Message.findById(id).catch(() => null);
  if (!msg || !msg.serverId || lower(msg.serverId) !== lower(guildId) || !msg.createdAt) return null;
  return new Date(msg.createdAt).getTime();
}

const uuidArray = (ids: readonly string[]) => sql`ARRAY[${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)}]::uuid[]`;
const textArray = (vals: readonly string[]) => sql`ARRAY[${sql.join(vals.map((v) => sql`${v}`), sql`, `)}]::text[]`;
const EMBEDS = sql`(CASE WHEN jsonb_typeof(${m.embeds}) = 'array' AND ${m.suppressEmbeds} IS NOT TRUE THEN ${m.embeds} ELSE '[]'::jsonb END)`;
const ATTACHMENTS = sql`(CASE WHEN jsonb_typeof(${m.attachments}) = 'array' THEN ${m.attachments} ELSE '[]'::jsonb END)`;
/** An attachment's file name (stored name, else the URL's last path segment). */
const ATTACHMENT_NAME = sql`lower(COALESCE(NULLIF(a->>'filename', ''), NULLIF(a->>'name', ''), regexp_replace(COALESCE(a->>'url', a #>> '{}', ''), '^.*/|[?#].*$', '', 'g')))`;

function embedTypeCondition(t: DiscordSearchEmbedType): SQL {
  switch (t) {
    case 'image': return sql`(e->>'type' = 'image' OR e->'image'->>'url' IS NOT NULL)`;
    case 'video': return sql`(e->>'type' = 'video' OR e->'video'->>'url' IS NOT NULL)`;
    case 'gif': return sql`(e->>'type' = 'gifv')`;
    case 'sound': return sql`(e->>'type' = 'audio')`;
    case 'article': return sql`(e->>'type' IN ('article', 'link'))`;
  }
}

/** The SQL for the filters Serika's search has no parameter for. */
function extraConditions(q: GuildSearchQuery, ids: { mentionRoleIds: string[]; repliedToUserIds: string[]; repliedToMessageIds: string[] }): SQL[] {
  // E2EE rows are never indexed and must never be returned (the server can't read them).
  const out: SQL[] = [sql`${m.e2ee} IS NULL`];
  if (ids.mentionRoleIds.length > 0) out.push(sql`${m.mentionedRoleIds} && ${uuidArray(ids.mentionRoleIds)}`);
  if (q.mentionEveryone !== null) out.push(q.mentionEveryone ? sql`${m.mentionEveryone} = true` : sql`${m.mentionEveryone} IS NOT TRUE`);
  if (ids.repliedToMessageIds.length > 0) out.push(inArray(m.referencedMessageId, ids.repliedToMessageIds));
  if (ids.repliedToUserIds.length > 0) {
    out.push(sql`${m.referencedMessageId} IN (SELECT r.id FROM messages r WHERE r.author_id = ANY(${uuidArray(ids.repliedToUserIds)}))`);
  }
  const snapshot = sql`(${m.messageSnapshot} IS NOT NULL AND ${m.messageSnapshot} <> 'null'::jsonb)`;
  if (q.hasInclude.includes('snapshot')) out.push(snapshot);
  if (q.hasExclude.includes('snapshot')) out.push(sql`NOT ${snapshot}`);
  if (q.embedTypes.length > 0) {
    out.push(sql`EXISTS (SELECT 1 FROM jsonb_array_elements(${EMBEDS}) e WHERE ${sql.join(q.embedTypes.map(embedTypeCondition), sql` OR `)})`);
  }
  if (q.embedProviders.length > 0) {
    out.push(sql`EXISTS (SELECT 1 FROM jsonb_array_elements(${EMBEDS}) e WHERE e->'provider'->>'name' = ANY(${textArray(q.embedProviders)}))`);
  }
  if (q.attachmentExtensions.length > 0) {
    const patterns = q.attachmentExtensions.map((ext) => `%.${likeLiteral(ext)}`);
    out.push(sql`EXISTS (SELECT 1 FROM jsonb_array_elements(${ATTACHMENTS}) a WHERE ${ATTACHMENT_NAME} LIKE ANY(${textArray(patterns)}))`);
  }
  if (q.attachmentFilenames.length > 0) {
    const patterns = q.attachmentFilenames.map((n) => `%${likeLiteral(n.toLowerCase())}%`);
    out.push(sql`EXISTS (SELECT 1 FROM jsonb_array_elements(${ATTACHMENTS}) a WHERE ${ATTACHMENT_NAME} LIKE ANY(${textArray(patterns)}))`);
  }
  return out;
}

/** Channels of the guild whose history the bot may read (null: not a member). */
async function readableChannels(guildId: string, botId: string, includeNsfw: boolean): Promise<IChannel[] | null> {
  const { listViewableServerChannels, getMemberChannelPermissions } = await import('@/lib/api/channels');
  const [channels, member] = await Promise.all([
    listViewableServerChannels(botId, guildId),
    ServerMember.findOne({ serverId: guildId, userId: botId }),
  ]);
  if (!channels) return null;
  const byId = new Map(channels.map((c) => [lower(c.id), c]));
  const readable = new Map<string, boolean>();
  for (const c of channels) {
    if (isThread(c)) continue;
    const perms = applyTimeout(
      await getMemberChannelPermissions(botId, c as IChannel & { serverId: string }, member ?? null),
      member?.communicationDisabledUntil ?? null,
    );
    readable.set(lower(c.id), botCan(perms, 'read_history') && (includeNsfw || !c.nsfw));
  }
  return channels.filter((c) => {
    if (!isThread(c)) return readable.get(lower(c.id)) === true;
    const parent = c.parentId ? byId.get(lower(c.parentId)) : undefined;
    return !!parent && readable.get(lower(parent.id)) === true && (includeNsfw || !c.nsfw);
  });
}

function emptyBody(total = 0, indexing = false) {
  return { doing_deep_historical_index: indexing, total_results: total, messages: [], threads: [], members: [] };
}

export async function searchGuildMessagesForBot(
  guildId: string,
  viewer: { botId: string; hasMessageContent: boolean },
  rawQuery: Record<string, unknown>,
): Promise<Result> {
  const parsed = parseGuildSearchQuery(rawQuery);
  if (!parsed.ok) return { status: 400, body: invalidFormBody(parsed.errors) };
  const q = parsed.query;
  if (!viewer.hasMessageContent && usesContentFilters(q)) return { status: 403, body: MISSING_ACCESS };

  const { searchMessages, isSearchIndexComplete, ensureMessageSearchSchema } = await import('@/lib/services/messageSearch');
  const needsIndex = Boolean(q.content) || q.linkHostnames.length > 0 || q.hasInclude.includes('link') || q.hasExclude.includes('link');
  if (needsIndex && !(await ensureMessageSearchSchema())) {
    return { status: 202, body: { message: 'Index not yet available. Try again later', code: 110000, documents_indexed: 0, retry_after: 2 } };
  }

  const channels = await readableChannels(guildId, viewer.botId, q.includeNsfw);
  if (!channels) return { status: 403, body: MISSING_ACCESS };
  const byId = new Map(channels.map((c) => [lower(c.id), c]));

  // Id filters: a list that was given but names nothing known matches nothing.
  const [channelIds, authorIds, mentions, mentionRoleIds, repliedToUserIds, repliedToMessageIds] = await Promise.all([
    resolveIdList(q.channelIds), resolveIdList(q.authorIds), resolveIdList(q.mentions), resolveIdList(q.mentionRoleIds),
    resolveIdList(q.repliedToUserIds), resolveIdList(q.repliedToMessageIds),
  ]);
  const unmatched = (given: string[], resolved: string[]) => given.length > 0 && resolved.length === 0;
  if (
    unmatched(q.authorIds, authorIds) || unmatched(q.mentions, mentions) || unmatched(q.mentionRoleIds, mentionRoleIds)
    || unmatched(q.repliedToUserIds, repliedToUserIds) || unmatched(q.repliedToMessageIds, repliedToMessageIds)
    || (q.authorTypes !== null && q.authorTypes.length === 0)
  ) {
    return { status: 200, body: emptyBody() };
  }
  let searchIn = [...byId.keys()];
  if (q.channelIds.length > 0) searchIn = channelIds.filter((id) => byId.has(id));
  if (searchIn.length === 0) {
    // Asked only for channels the bot can't read (or the guild has none).
    if (q.channelIds.length > 0 && channelIds.length > 0) return { status: 403, body: MISSING_ACCESS };
    return { status: 200, body: emptyBody() };
  }

  const [minTime, maxTime] = await Promise.all([boundTime(q.minId, guildId), boundTime(q.maxId, guildId)]);
  // A single hostname narrows through the index too (its words must be in the text).
  let text = q.content;
  if (q.linkHostnames.length === 1) text = `${text} ${q.linkHostnames[0].replace(/[.-]/g, ' ')}`.trim();
  const has = serikaHas(q.hasInclude);
  if (q.linkHostnames.length > 0 && !has.includes('link')) has.push('link');

  const base = {
    channelIds: searchIn,
    text,
    authorIds,
    mentionIds: mentions,
    has,
    hasNot: serikaHas(q.hasExclude),
    pinned: q.pinned ?? undefined,
    authorTypes: q.authorTypes ?? undefined,
    minTime: minTime !== null ? new Date(minTime + 1) : null,
    maxTime: maxTime !== null ? new Date(maxTime) : null,
    sort: searchSortFor(q),
    extra: extraConditions(q, { mentionRoleIds, repliedToUserIds, repliedToMessageIds }),
  };
  const beyond = q.offset > SERIKA_MAX_OFFSET;
  const [result, complete] = await Promise.all([
    searchMessages({ ...base, offset: beyond ? 0 : q.offset, limit: beyond ? 1 : q.limit }),
    isSearchIndexComplete(),
  ]);
  if (beyond) return { status: 200, body: emptyBody(result.total, !complete) };

  const rows = (result.rows as IMessage[]).filter((r) => messageLinksTo(result.contents.get(r.id) ?? '', r.embeds, q.linkHostnames));
  const { loadDiscordMessages } = await import('@/lib/services/botMessages');
  const serialized = await loadDiscordMessages(rows, { viewerId: viewer.botId });
  const messages = serialized.map((formatted, i) => {
    const row = rows[i];
    const redact = shouldRedactContent(
      { guildId: row.serverId, authorId: row.authorId, mentionedUserIds: (row.mentionedUserIds ?? []) as string[] },
      viewer.botId,
      viewer.hasMessageContent,
    );
    const out = { ...(redact ? redactMessageContent(formatted, viewer.botId) : formatted) } as Record<string, unknown>;
    delete out.reactions; // Discord: search results come without reactions
    return [out];
  });

  // Threads holding hits, and the bot's thread member for the ones it joined.
  const threadIds = [...new Set(rows.map((r) => lower(r.channelId)).filter((id) => isThread(byId.get(id) ?? {})))];
  const threads = threadIds.map((id) => byId.get(id)!).filter(Boolean);
  const freshThreads = threads.length > 0 ? await Channel.find({ id: { in: threads.map((t) => t.id) } }).catch(() => threads) : [];
  const members = freshThreads
    .filter((t) => (t.threadMemberIds ?? []).some((u: string) => lower(u) === lower(viewer.botId)))
    .map((t) => toDiscordThreadMember(t, viewer.botId));

  return {
    status: 200,
    body: {
      doing_deep_historical_index: !complete,
      total_results: result.total,
      messages,
      threads: freshThreads.map((t) => toDiscordChannel(t)),
      members,
    },
  };
}

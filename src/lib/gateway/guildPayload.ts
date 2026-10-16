/**
 * DB loaders for the gateway's guild payloads: the full GUILD_CREATE a bot
 * gets for each guild after READY (and on install), and GUILD_MEMBERS_CHUNK
 * answers to op 8 Request Guild Members. Shapes come from the serializers in
 * src/lib/services/gatewayEvents.ts; ids stay UUIDs (the snowflake boundary
 * translates per connection).
 */
import { and, asc, eq, gt, ilike, inArray, or, sql } from 'drizzle-orm';
import { db, schema } from '@/lib/db/postgres';
import { normalizeId } from '@/lib/db/normalizeId';
import {
  isThreadChannelType, toDiscordChannel, toDiscordEmoji, toDiscordGuildBase, toDiscordGuildMember,
  toDiscordRole, toDiscordSticker, toDiscordThreadMember,
} from '@/lib/services/gatewayEvents';
import { INTENT } from './intents';
import { computeChannelPermissions, type ChannelOverwrite } from '@/lib/permissions/channelOverwrites';
import { PERMISSION_BITS } from '@/lib/permissions/bits';

export const DEFAULT_LARGE_THRESHOLD = 50;
/** GUILD_VOICE_STATES intent (voice_states in GUILD_CREATE). */
const GUILD_VOICE_STATES = 1 << 7;
export const MAX_LARGE_THRESHOLD = 250;
/** Members per GUILD_MEMBERS_CHUNK (Discord: 1000). */
export const MEMBERS_PER_CHUNK = 1000;

/** Clamp an IDENTIFY large_threshold to Discord's 50..250. */
export function clampLargeThreshold(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return DEFAULT_LARGE_THRESHOLD;
  return Math.max(50, Math.min(MAX_LARGE_THRESHOLD, Math.floor(n)));
}

type UserRow = typeof schema.users.$inferSelect;
type MemberRow = typeof schema.serverMembers.$inferSelect;

async function usersById(ids: string[]): Promise<Map<string, UserRow>> {
  if (ids.length === 0) return new Map();
  const rows = await db.select().from(schema.users).where(inArray(schema.users.id, ids));
  return new Map(rows.map((u) => [u.id, u]));
}

/** Bots' managed roles carry `tags.bot_id` (Discord); map role id -> bot user id. */
function managedBotRoles(members: MemberRow[], bots: Map<string, UserRow>, roles: Array<{ id: string; managed: boolean | null }>) {
  const managed = new Set(roles.filter((r) => r.managed).map((r) => r.id));
  const out = new Map<string, string>();
  for (const m of members) {
    const u = bots.get(m.userId);
    if (!u?.isBot) continue;
    for (const r of m.roles ?? []) if (managed.has(r) && !out.has(r)) out.set(r, u.id);
  }
  return out;
}

interface ThreadLike {
  type?: string | null;
  archived?: boolean | null;
  threadMemberIds?: string[] | null;
  ownerId?: string | null;
}

/** VIEW_CHANNEL check for the bot on a guild channel (pure; same rules as users). */
export function botViewChecker(opts: {
  isOwner: boolean;
  serverId: string;
  botId: string;
  memberRoleIds: readonly string[];
  roles: ReadonlyArray<{ id: string; permissions?: string | null; isDefault?: boolean | null }>;
}): (channel: { permissionOverwrites?: unknown } | null) => boolean {
  const bits = (v: string | null | undefined) => { try { return BigInt(v ?? '0'); } catch { return 0n; } };
  const everyone = opts.roles.find((r) => r.isDefault) ?? null;
  const mine = new Set(opts.memberRoleIds.map((r) => r.toLowerCase()));
  const rolePermissions = opts.roles.filter((r) => !r.isDefault && mine.has(r.id.toLowerCase())).map((r) => bits(r.permissions));
  return (channel) => {
    if (!channel) return false;
    const perms = computeChannelPermissions({
      isOwner: opts.isOwner,
      everyonePermissions: everyone ? bits(everyone.permissions) : null,
      rolePermissions,
      overwrites: (channel.permissionOverwrites ?? []) as ChannelOverwrite[],
      ctx: { serverId: opts.serverId, everyoneRoleId: everyone?.id ?? null, memberRoleIds: opts.memberRoleIds, userId: opts.botId },
    });
    return (perms & PERMISSION_BITS.VIEW_CHANNEL) === PERMISSION_BITS.VIEW_CHANNEL;
  };
}

/** An active thread the bot may see: parent viewable; private threads only for members / the owner. */
export function threadVisibleToBot(
  thread: ThreadLike,
  parent: { permissionOverwrites?: unknown } | null,
  botId: string,
  canView: (channel: { permissionOverwrites?: unknown } | null) => boolean,
): boolean {
  if (thread.archived) return false;
  if (!canView(parent)) return false;
  if (thread.type !== 'private_thread') return true;
  const bot = botId.toLowerCase();
  return (thread.threadMemberIds ?? []).some((u) => u.toLowerCase() === bot) || (thread.ownerId ?? '').toLowerCase() === bot;
}

export interface GuildCreateOptions {
  botId: string;
  intents: number;
  largeThreshold?: number;
}

/**
 * The full GUILD_CREATE payload for one guild, or null when the server is
 * gone or the bot is no longer a member.
 */
export async function buildGuildCreate(serverId: string, opts: GuildCreateOptions): Promise<Record<string, unknown> | null> {
  const sid = normalizeId(serverId);
  const threshold = clampLargeThreshold(opts.largeThreshold ?? DEFAULT_LARGE_THRESHOLD);
  const wantMembers = (opts.intents & (INTENT.GUILD_MEMBERS | INTENT.GUILD_PRESENCES)) !== 0;

  const [serverRows, channels, roles, emojis, stickers, countRows, botMemberRows] = await Promise.all([
    db.select().from(schema.servers).where(eq(schema.servers.id, sid)).limit(1),
    db.select().from(schema.channels).where(eq(schema.channels.serverId, sid)),
    db.select().from(schema.roles).where(eq(schema.roles.serverId, sid)),
    db.select().from(schema.serverEmojis).where(eq(schema.serverEmojis.serverId, sid)),
    db.select().from(schema.serverStickers).where(eq(schema.serverStickers.serverId, sid)),
    db.select({ n: sql<number>`count(*)::int` }).from(schema.serverMembers).where(eq(schema.serverMembers.serverId, sid)),
    db.select().from(schema.serverMembers)
      .where(and(eq(schema.serverMembers.serverId, sid), eq(schema.serverMembers.userId, normalizeId(opts.botId)))).limit(1),
  ]);
  const server = serverRows[0];
  const botMember = botMemberRows[0];
  if (!server || !botMember) return null;

  const memberCount = Number(countRows[0]?.n ?? 0);
  const large = memberCount > threshold;
  // Without a privileged member intent Discord sends only the bot itself.
  let members: MemberRow[] = [botMember];
  if (wantMembers) {
    const page = await db.select().from(schema.serverMembers)
      .where(eq(schema.serverMembers.serverId, sid))
      .orderBy(asc(schema.serverMembers.joinedAt))
      .limit(threshold);
    members = page.some((m) => m.userId === botMember.userId) ? page : [botMember, ...page.slice(0, threshold - 1)];
  }
  const users = await usersById([...new Set(members.map((m) => m.userId))]);
  const everyone = roles.find((r) => r.isDefault)?.id ?? null;
  const botRoles = managedBotRoles(members, users, roles);

  let events: unknown[] = [];
  try {
    const { toDiscordEvent } = await import('@/lib/services/scheduledEvents');
    const rows = await db.select().from(schema.serverScheduledEvents)
      .where(and(eq(schema.serverScheduledEvents.serverId, sid), inArray(schema.serverScheduledEvents.status, ['scheduled', 'active'])));
    events = rows.map((r) => toDiscordEvent(r));
  } catch { /* table may not exist yet */ }

  // Threads: only active ones whose parent the bot can view (same overwrite
  // resolution as checkChannelAccess); private threads also need membership.
  const byId = new Map(channels.map((c) => [c.id.toLowerCase(), c]));
  const canViewParent = botViewChecker({
    isOwner: (server.ownerId ?? '').toLowerCase() === botMember.userId.toLowerCase(),
    serverId: sid,
    botId: botMember.userId,
    memberRoleIds: botMember.roles ?? [],
    roles,
  });
  const threads = channels
    .filter((c) => isThreadChannelType(c.type) && threadVisibleToBot(c, byId.get((c.parentId ?? '').toLowerCase()) ?? null, botMember.userId, canViewParent))
    .map((c) => ({
      ...toDiscordChannel({ ...c, ownerId: c.ownerId ?? server.ownerId }),
      // Joined threads carry the bot's thread member (Discord's GUILD_CREATE threads).
      ...((c.threadMemberIds ?? []).some((u) => u.toLowerCase() === botMember.userId.toLowerCase())
        ? { member: toDiscordThreadMember(c, botMember.userId) }
        : {}),
    }));
  const guildChannels = channels.filter((c) => c.type !== 'dm' && c.type !== 'group_dm' && !isThreadChannelType(c.type));

  // WP7: who is in voice (GUILD_VOICE_STATES), WP1: presences of the members
  // sent here (GUILD_PRESENCES, privileged), online members only.
  let voiceStates: unknown[] = [];
  if ((opts.intents & GUILD_VOICE_STATES) !== 0) {
    try {
      const { listGuildVoiceStates } = await import('@/lib/services/voiceStates');
      // Only voice channels the bot can view (private channels stay private).
      voiceStates = (await listGuildVoiceStates(sid)).filter((v) => canViewParent(byId.get(String(v.channel_id ?? '').toLowerCase()) ?? null));
    } catch { /* voice mirror unavailable (standalone gateway) */ }
  }
  let presences: unknown[] = [];
  if ((opts.intents & INTENT.GUILD_PRESENCES) !== 0 && users.size > 0) {
    try {
      const { buildPresences } = await import('@/lib/services/botPresence');
      const rich = await db.select().from(schema.richPresence)
        .where(and(inArray(schema.richPresence.userId, [...users.keys()]), gt(schema.richPresence.expiresAt, new Date())));
      const richByUser = new Map<string, typeof rich>();
      for (const r of rich) {
        const list = richByUser.get(r.userId);
        if (list) list.push(r);
        else richByUser.set(r.userId, [r]);
      }
      presences = buildPresences(users.values(), richByUser);
    } catch { /* presences are best-effort */ }
  }

  return {
    ...toDiscordGuildBase(server),
    joined_at: (botMember.joinedAt ?? new Date()).toISOString(),
    large,
    unavailable: false,
    member_count: memberCount,
    approximate_member_count: memberCount,
    voice_states: voiceStates,
    members: members.map((m) => toDiscordGuildMember(m, users.get(m.userId) ?? { id: m.userId }, everyone)),
    channels: guildChannels.sort((a, b) => (a.position ?? 0) - (b.position ?? 0)).map((c) => toDiscordChannel(c)),
    threads,
    presences,
    stage_instances: [],
    guild_scheduled_events: events,
    soundboard_sounds: [],
    roles: roles.map((r) => toDiscordRole(r, botRoles.get(r.id) ?? null)),
    emojis: emojis.map((e) => toDiscordEmoji(e)),
    stickers: stickers.map((s) => toDiscordSticker(s)),
    embedded_activities: [],
    activity_instances: [],
    lazy: true,
    application_command_counts: {},
    hub_type: null,
  };
}

export interface MemberChunkRequest {
  guildId: string;
  query?: string;
  limit: number;
  userIds?: string[];
  nonce?: string;
  /** op 8 `presences: true` from a session with GUILD_PRESENCES. */
  presences?: boolean;
}

/**
 * GUILD_MEMBERS_CHUNK payloads for an op 8 request (1000 members per chunk).
 * `canListAll` = the session has GUILD_MEMBERS (needed for query "" + limit 0).
 */
export async function buildMemberChunks(req: MemberChunkRequest, canListAll: boolean): Promise<Array<Record<string, unknown>>> {
  const sid = normalizeId(req.guildId);
  const roleRows = await db.select({ id: schema.roles.id }).from(schema.roles)
    .where(and(eq(schema.roles.serverId, sid), eq(schema.roles.isDefault, true))).limit(1);
  const everyone = roleRows[0]?.id ?? null;
  const nonce = typeof req.nonce === 'string' && req.nonce.length <= 32 ? req.nonce : undefined;
  let members: MemberRow[] = [];
  let notFound: string[] | undefined;

  if (req.userIds && req.userIds.length > 0) {
    const ids = [...new Set(req.userIds.filter((u) => /^[0-9a-f-]{36}$/i.test(u)).map(normalizeId))].slice(0, 100);
    members = ids.length > 0
      ? await db.select().from(schema.serverMembers).where(and(eq(schema.serverMembers.serverId, sid), inArray(schema.serverMembers.userId, ids)))
      : [];
    const found = new Set(members.map((m) => m.userId.toLowerCase()));
    notFound = req.userIds.filter((u) => !found.has(u.toLowerCase()));
  } else if (req.query) {
    const limit = Math.max(1, Math.min(100, req.limit || 100));
    const prefix = `${req.query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    members = (await db.select({ m: schema.serverMembers }).from(schema.serverMembers)
      .innerJoin(schema.users, eq(schema.users.id, schema.serverMembers.userId))
      .where(and(eq(schema.serverMembers.serverId, sid), or(ilike(schema.users.username, prefix), ilike(schema.users.displayName, prefix), ilike(schema.serverMembers.nickname, prefix))))
      .limit(limit)).map((r) => r.m);
  } else if (canListAll) {
    const cap = req.limit > 0 ? req.limit : Number.MAX_SAFE_INTEGER;
    let after: string | null = null;
    while (members.length < cap) {
      const conds = [eq(schema.serverMembers.serverId, sid)];
      if (after) conds.push(gt(schema.serverMembers.userId, after));
      const page = await db.select().from(schema.serverMembers).where(and(...conds))
        .orderBy(asc(schema.serverMembers.userId)).limit(Math.min(MEMBERS_PER_CHUNK, cap - members.length));
      members.push(...page);
      if (page.length < MEMBERS_PER_CHUNK) break;
      after = page[page.length - 1].userId;
    }
  }

  const chunks: Array<Record<string, unknown>> = [];
  const count = Math.max(1, Math.ceil(members.length / MEMBERS_PER_CHUNK));
  for (let i = 0; i < count; i++) {
    const slice = members.slice(i * MEMBERS_PER_CHUNK, (i + 1) * MEMBERS_PER_CHUNK);
    const users = await usersById(slice.map((m) => m.userId));
    let presences: unknown[] | undefined;
    if (req.presences) {
      try {
        const { buildPresences } = await import('@/lib/services/botPresence');
        const rich = users.size > 0
          ? await db.select().from(schema.richPresence)
            .where(and(inArray(schema.richPresence.userId, [...users.keys()]), gt(schema.richPresence.expiresAt, new Date())))
          : [];
        const richByUser = new Map<string, typeof rich>();
        for (const r of rich) richByUser.set(r.userId, [...(richByUser.get(r.userId) ?? []), r]);
        presences = buildPresences(users.values(), richByUser);
      } catch { presences = []; }
    }
    chunks.push({
      guild_id: sid,
      members: slice.map((m) => toDiscordGuildMember(m, users.get(m.userId) ?? { id: m.userId }, everyone)),
      chunk_index: i,
      chunk_count: count,
      ...(i === 0 && notFound && notFound.length > 0 ? { not_found: notFound } : {}),
      ...(presences ? { presences } : {}),
      ...(nonce !== undefined ? { nonce } : {}),
    });
  }
  return chunks;
}

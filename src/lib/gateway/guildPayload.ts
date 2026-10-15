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
  toDiscordRole, toDiscordSticker,
} from '@/lib/services/gatewayEvents';
import { INTENT } from './intents';

export const DEFAULT_LARGE_THRESHOLD = 50;
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

  const botId = botMember.userId.toLowerCase();
  const visibleThread = (c: (typeof channels)[number]) =>
    !c.archived && (c.type !== 'private_thread' || (c.threadMemberIds ?? []).some((u) => u.toLowerCase() === botId) || (c.ownerId ?? '').toLowerCase() === botId);
  const guildChannels = channels.filter((c) => c.type !== 'dm' && c.type !== 'group_dm' && !isThreadChannelType(c.type));
  const threads = channels.filter((c) => isThreadChannelType(c.type) && visibleThread(c))
    .map((c) => ({ ...toDiscordChannel({ ...c, ownerId: c.ownerId ?? server.ownerId }) }));

  return {
    ...toDiscordGuildBase(server),
    joined_at: (botMember.joinedAt ?? new Date()).toISOString(),
    large,
    unavailable: false,
    member_count: memberCount,
    approximate_member_count: memberCount,
    voice_states: [],
    members: members.map((m) => toDiscordGuildMember(m, users.get(m.userId) ?? { id: m.userId }, everyone)),
    channels: guildChannels.sort((a, b) => (a.position ?? 0) - (b.position ?? 0)).map((c) => toDiscordChannel(c)),
    threads,
    presences: [],
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
    chunks.push({
      guild_id: sid,
      members: slice.map((m) => toDiscordGuildMember(m, users.get(m.userId) ?? { id: m.userId }, everyone)),
      chunk_index: i,
      chunk_count: count,
      ...(i === 0 && notFound && notFound.length > 0 ? { not_found: notFound } : {}),
      ...(nonce !== undefined ? { nonce } : {}),
    });
  }
  return chunks;
}

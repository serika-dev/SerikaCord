/**
 * Bot gateway events for guild resources (WP4a): GUILD_UPDATE, CHANNEL_*,
 * GUILD_ROLE_*, GUILD_MEMBER_ADD/UPDATE/REMOVE, GUILD_BAN_*, INVITE_* and
 * GUILD_INTEGRATIONS_UPDATE.
 *
 * Every mutation site (bot REST routes and the web routes in servers.ts,
 * channels.ts, serverMembership.ts, serverCommunity.ts, developers.ts) calls
 * one of these right after its write. They load what they need, serialize
 * with the shared Discord serializers in ./gatewayEvents.ts and publish on
 * the same `gateway:dispatch` bus. Ids stay internal UUIDs (the snowflake
 * boundary translates per connection).
 *
 * Audience rules:
 *  - CHANNEL_*: only bots that can view the channel. When a change grants or
 *    removes VIEW_CHANNEL for a bot (overwrites, parent sync), that bot gets
 *    CHANNEL_CREATE / CHANNEL_DELETE instead of CHANNEL_UPDATE. Callers take
 *    `captureChannelViewers()` before the write and pass it to the emitter.
 *  - INVITE_*: bots with MANAGE_CHANNELS in the invite's channel (Discord).
 *  - Guild-wide events (GUILD_UPDATE, roles, members, bans, integrations):
 *    every bot in the guild with the event's intent (GatewayHub filters).
 *
 * Everything is best-effort: errors are swallowed so a web request never
 * fails because the gateway bus is down. Callers fire and forget (`void`).
 */
import { and, eq, inArray } from 'drizzle-orm';
import { db, schema } from '@/lib/db/postgres';
import { getPublisher } from '@/lib/db';
import { normalizeId } from '@/lib/db/normalizeId';
import { PERMISSION_BITS, hasPermission } from '@/lib/permissions/bits';
import {
  GATEWAY_CHANNEL, Intents, emitGuildMemberAdd, emitGuildMemberRemove, toDiscordChannel, toDiscordEmoji,
  toDiscordGuildBase, toDiscordGuildMember, toDiscordRole, toDiscordSticker, toDiscordUserRow,
  type ChannelRowLike, type RoleRowLike,
} from './gatewayEvents';

/** Intent bits not in gatewayEvents.Intents (Discord numbering). */
export const GUILD_INTENTS = {
  GUILDS: Intents.GUILDS,
  GUILD_MEMBERS: Intents.GUILD_MEMBERS,
  GUILD_MODERATION: Intents.GUILD_MODERATION,
  GUILD_INTEGRATIONS: 1 << 4,
  GUILD_INVITES: 1 << 6,
} as const;

interface Dispatch {
  t: string;
  guildId: string;
  intent: number;
  d: unknown;
  audience?: string[];
}

async function publish(dispatch: Dispatch): Promise<void> {
  if (dispatch.audience && dispatch.audience.length === 0) return;
  try {
    const pub = getPublisher();
    if (pub) await pub.publish(GATEWAY_CHANNEL, JSON.stringify(dispatch));
  } catch {
    // Best-effort, like gatewayEvents.publish().
  }
}

const lower = (id: string | null | undefined) => String(id ?? '').toLowerCase();

async function invalidate(serverId: string) {
  try {
    const { invalidateServerAudience } = await import('./gatewayAudience');
    invalidateServerAudience(serverId);
  } catch { /* best-effort */ }
}

// ─── Channel visibility ────────────────────────────────────

type ChannelRow = typeof schema.channels.$inferSelect;

/** Bot id -> channel ids (lower case) it can view, for the given channels of one server. */
export type ChannelViewers = Map<string, Set<string>>;

/**
 * VIEW_CHANNEL per bot for `channels` (all in `serverId`). Text-like channels
 * come from the shared audience snapshot (same rules as the app, including
 * rules screening); categories, which the snapshot skips, use the bot's
 * resolved channel permissions.
 */
async function viewersFor(serverId: string, channels: ReadonlyArray<Pick<ChannelRow, 'id' | 'type' | 'serverId' | 'parentId' | 'permissionOverwrites'>>): Promise<ChannelViewers> {
  const out: ChannelViewers = new Map();
  if (channels.length === 0) return out;
  const { serverChannelViewers } = await import('./gatewayAudience');
  const snapshot = await serverChannelViewers(serverId);
  const categories = channels.filter((c) => c.type === 'category');
  const others = channels.filter((c) => c.type !== 'category');
  for (const [bot, visible] of snapshot) {
    const mine = new Set<string>();
    for (const c of others) if (visible.has(lower(c.id))) mine.add(lower(c.id));
    out.set(bot, mine);
  }
  if (categories.length > 0) {
    const { ServerMember } = await import('@/lib/models');
    const { getMemberChannelPermissions } = await import('@/lib/api/channels');
    const bots = snapshot.size > 0 ? [...snapshot.keys()] : await ServerMember.findBotUserIds(serverId);
    await Promise.all(bots.map(async (bot) => {
      const mine = out.get(bot) ?? new Set<string>();
      for (const c of categories) {
        const perms = await getMemberChannelPermissions(bot, { ...c, serverId } as Parameters<typeof getMemberChannelPermissions>[1]).catch(() => 0n);
        if (hasPermission(perms, PERMISSION_BITS.VIEW_CHANNEL)) mine.add(lower(c.id));
      }
      out.set(bot, mine);
    }));
  }
  return out;
}

async function loadChannels(ids: readonly string[]): Promise<ChannelRow[]> {
  if (ids.length === 0) return [];
  return db.select().from(schema.channels).where(inArray(schema.channels.id, ids.map((id) => normalizeId(id))));
}

/**
 * Which bots can view these channels right now. Take it BEFORE a write that
 * may change visibility (overwrites, parent, deletion) and hand it to
 * emitChannelUpdates / emitChannelDelete. Never throws.
 */
export async function captureChannelViewers(serverId: string | null | undefined, channelIds: readonly string[]): Promise<ChannelViewers> {
  if (!serverId || channelIds.length === 0) return new Map();
  try {
    return await viewersFor(serverId, await loadChannels(channelIds));
  } catch {
    return new Map();
  }
}

function audienceOf(viewers: ChannelViewers, channelId: string): string[] {
  const id = lower(channelId);
  return [...viewers].filter(([, set]) => set.has(id)).map(([bot]) => bot);
}

function isGuildChannel(c: { serverId?: string | null; type?: string | null }) {
  return !!c.serverId && c.type !== 'dm' && c.type !== 'group_dm';
}

/** CHANNEL_CREATE to the bots that can view the new channel. */
export async function emitChannelCreate(channel: ChannelRowLike & { serverId?: string | null }): Promise<void> {
  if (!isGuildChannel(channel)) return;
  try {
    const serverId = channel.serverId as string;
    await invalidate(serverId);
    const [row] = await loadChannels([channel.id]);
    if (!row) return;
    const after = await viewersFor(serverId, [row]);
    await publish({ t: 'CHANNEL_CREATE', guildId: serverId, intent: Intents.GUILDS, d: toDiscordChannel(row), audience: audienceOf(after, row.id) });
  } catch { /* best-effort */ }
}

/**
 * CHANNEL_UPDATE for each changed channel, to the bots that could and still
 * can view it. A bot that just gained view gets CHANNEL_CREATE; one that lost
 * it gets CHANNEL_DELETE. Without `before`, everyone who can view it now gets
 * CHANNEL_UPDATE.
 */
export async function emitChannelUpdates(serverId: string | null | undefined, channelIds: readonly string[], before?: ChannelViewers): Promise<void> {
  if (!serverId || channelIds.length === 0) return;
  try {
    await invalidate(serverId);
    const rows = (await loadChannels([...new Set(channelIds.map(lower))])).filter(isGuildChannel);
    if (rows.length === 0) return;
    const after = await viewersFor(serverId, rows);
    for (const row of rows) {
      const now = new Set(audienceOf(after, row.id).map(lower));
      const was = before ? new Set(audienceOf(before, row.id).map(lower)) : now;
      const d = toDiscordChannel(row);
      const keep = [...now].filter((b) => was.has(b));
      const gained = [...now].filter((b) => !was.has(b));
      const lost = [...was].filter((b) => !now.has(b));
      await publish({ t: 'CHANNEL_UPDATE', guildId: serverId, intent: Intents.GUILDS, d, audience: keep });
      await publish({ t: 'CHANNEL_CREATE', guildId: serverId, intent: Intents.GUILDS, d, audience: gained });
      await publish({ t: 'CHANNEL_DELETE', guildId: serverId, intent: Intents.GUILDS, d, audience: lost });
    }
  } catch { /* best-effort */ }
}

/** CHANNEL_DELETE (the channel as it was) to the bots that could view it before the delete. */
export async function emitChannelDelete(channel: ChannelRowLike & { serverId?: string | null }, before: ChannelViewers): Promise<void> {
  if (!isGuildChannel(channel)) return;
  try {
    const serverId = channel.serverId as string;
    await invalidate(serverId);
    await publish({ t: 'CHANNEL_DELETE', guildId: serverId, intent: Intents.GUILDS, d: toDiscordChannel(channel), audience: audienceOf(before, channel.id) });
  } catch { /* best-effort */ }
}

// ─── Guild ─────────────────────────────────────────────────

/** GUILD_UPDATE: the guild object with roles, emojis and stickers. */
export async function emitGuildUpdate(serverId: string): Promise<void> {
  try {
    const sid = normalizeId(serverId);
    const [[server], roles, emojis, stickers] = await Promise.all([
      db.select().from(schema.servers).where(eq(schema.servers.id, sid)).limit(1),
      db.select().from(schema.roles).where(eq(schema.roles.serverId, sid)),
      db.select().from(schema.serverEmojis).where(eq(schema.serverEmojis.serverId, sid)),
      db.select().from(schema.serverStickers).where(eq(schema.serverStickers.serverId, sid)),
    ]);
    if (!server) return;
    await publish({
      t: 'GUILD_UPDATE',
      guildId: sid,
      intent: Intents.GUILDS,
      d: {
        ...toDiscordGuildBase(server),
        roles: roles.sort((a, b) => (a.position ?? 0) - (b.position ?? 0)).map((r) => toDiscordRole(r)),
        emojis: emojis.map((e) => toDiscordEmoji(e)),
        stickers: stickers.map((s) => toDiscordSticker(s)),
      },
    });
  } catch { /* best-effort */ }
}

/** GUILD_INTEGRATIONS_UPDATE: a bot (integration) was added to or removed from the guild. */
export async function emitGuildIntegrationsUpdate(serverId: string): Promise<void> {
  await publish({ t: 'GUILD_INTEGRATIONS_UPDATE', guildId: normalizeId(serverId), intent: GUILD_INTENTS.GUILD_INTEGRATIONS, d: { guild_id: normalizeId(serverId) } });
}

// ─── Roles ─────────────────────────────────────────────────

async function roleRow(roleId: string): Promise<(RoleRowLike & { serverId: string }) | null> {
  const [row] = await db.select().from(schema.roles).where(eq(schema.roles.id, normalizeId(roleId))).limit(1);
  return row ?? null;
}

/** GUILD_ROLE_CREATE / GUILD_ROLE_UPDATE with the role as stored now (callers invalidateRolePerms on permission changes). */
export async function emitRoleUpsert(t: 'GUILD_ROLE_CREATE' | 'GUILD_ROLE_UPDATE', serverId: string, roleId: string): Promise<void> {
  try {
    const role = await roleRow(roleId);
    if (!role || lower(role.serverId) !== lower(serverId)) return;
    await publish({ t, guildId: normalizeId(serverId), intent: Intents.GUILDS, d: { guild_id: normalizeId(serverId), role: toDiscordRole(role) } });
  } catch { /* best-effort */ }
}

export function emitRoleCreate(serverId: string, roleId: string) {
  return emitRoleUpsert('GUILD_ROLE_CREATE', serverId, roleId);
}

export function emitRoleUpdate(serverId: string, roleId: string) {
  return emitRoleUpsert('GUILD_ROLE_UPDATE', serverId, roleId);
}

/** GUILD_ROLE_UPDATE for several roles (bulk position changes). */
export async function emitRolesUpdate(serverId: string, roleIds: readonly string[]): Promise<void> {
  for (const id of roleIds) await emitRoleUpdate(serverId, id);
}

export async function emitRoleDelete(serverId: string, roleId: string): Promise<void> {
  await invalidate(serverId);
  await publish({ t: 'GUILD_ROLE_DELETE', guildId: normalizeId(serverId), intent: Intents.GUILDS, d: { guild_id: normalizeId(serverId), role_id: normalizeId(roleId) } });
}

// ─── Members ───────────────────────────────────────────────

async function memberPayload(serverId: string, userId: string): Promise<Record<string, unknown> | null> {
  const sid = normalizeId(serverId);
  const uid = normalizeId(userId);
  const [[member], [user], [everyone]] = await Promise.all([
    db.select().from(schema.serverMembers)
      .where(and(eq(schema.serverMembers.serverId, sid), eq(schema.serverMembers.userId, uid))).limit(1),
    db.select().from(schema.users).where(eq(schema.users.id, uid)).limit(1),
    db.select({ id: schema.roles.id }).from(schema.roles)
      .where(and(eq(schema.roles.serverId, sid), eq(schema.roles.isDefault, true))).limit(1),
  ]);
  if (!member) return null;
  return toDiscordGuildMember(member, user ?? { id: uid }, everyone?.id ?? null) as Record<string, unknown>;
}

/** GUILD_MEMBER_ADD for a member that just joined (humans and bots). */
export async function emitMemberAdd(serverId: string, userId: string): Promise<void> {
  try {
    const member = await memberPayload(serverId, userId);
    if (member) await emitGuildMemberAdd({ guildId: normalizeId(serverId), member });
  } catch { /* best-effort */ }
}

/**
 * GUILD_MEMBER_UPDATE (nick, roles, avatar, timeout, pending, mute/deaf) with
 * the member as stored now. Role changes of a bot change what it can see, so
 * the gateway audiences are dropped first.
 */
export async function emitMemberUpdate(serverId: string, userId: string): Promise<void> {
  try {
    await invalidate(serverId);
    const member = await memberPayload(serverId, userId);
    if (!member) return;
    await publish({ t: 'GUILD_MEMBER_UPDATE', guildId: normalizeId(serverId), intent: Intents.GUILD_MEMBERS, d: { guild_id: normalizeId(serverId), ...member } });
  } catch { /* best-effort */ }
}

async function userObject(userId: string) {
  const uid = normalizeId(userId);
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, uid)).limit(1);
  return user ? toDiscordUserRow(user) : { id: uid, username: '', discriminator: '0', global_name: null, avatar: null };
}

/** GUILD_MEMBER_REMOVE (leave, kick, ban), plus GUILD_INTEGRATIONS_UPDATE when the member was a bot. */
export async function emitMemberRemove(serverId: string, userId: string): Promise<void> {
  try {
    const user = await userObject(userId);
    await emitGuildMemberRemove({ guildId: normalizeId(serverId), user });
    if ((user as { bot?: boolean }).bot) await emitGuildIntegrationsUpdate(serverId);
  } catch { /* best-effort */ }
}

// ─── Bans ──────────────────────────────────────────────────

export async function emitBanAdd(serverId: string, userId: string): Promise<void> {
  try {
    await publish({ t: 'GUILD_BAN_ADD', guildId: normalizeId(serverId), intent: GUILD_INTENTS.GUILD_MODERATION, d: { guild_id: normalizeId(serverId), user: await userObject(userId) } });
  } catch { /* best-effort */ }
}

export async function emitBanRemove(serverId: string, userId: string): Promise<void> {
  try {
    await publish({ t: 'GUILD_BAN_REMOVE', guildId: normalizeId(serverId), intent: GUILD_INTENTS.GUILD_MODERATION, d: { guild_id: normalizeId(serverId), user: await userObject(userId) } });
  } catch { /* best-effort */ }
}

// ─── Invites ───────────────────────────────────────────────

interface InviteLike {
  code: string;
  serverId: string;
  channelId: string;
  inviterId?: string | null;
  maxAge?: number | null;
  maxUses?: number | null;
  temporary?: boolean | null;
  uses?: number | null;
  createdAt?: Date | string | null;
  expiresAt?: Date | string | null;
}

/** Bots with MANAGE_CHANNELS in the invite's channel (Discord sends invite events only to them). */
async function inviteAudience(serverId: string, channelId: string): Promise<string[]> {
  const [channel] = await loadChannels([channelId]);
  if (!channel) return [];
  const { ServerMember } = await import('@/lib/models');
  const { getMemberChannelPermissions } = await import('@/lib/api/channels');
  const bots = await ServerMember.findBotUserIds(serverId);
  const checks = await Promise.all(bots.map(async (bot) => {
    const perms = await getMemberChannelPermissions(bot, { ...channel, serverId } as Parameters<typeof getMemberChannelPermissions>[1]).catch(() => 0n);
    return hasPermission(perms, PERMISSION_BITS.VIEW_CHANNEL) && hasPermission(perms, PERMISSION_BITS.MANAGE_CHANNELS) ? bot : null;
  }));
  return checks.filter((b): b is string => !!b);
}

const iso = (d?: Date | string | null) => {
  if (!d) return null;
  const t = d instanceof Date ? d : new Date(d);
  return Number.isFinite(t.getTime()) ? t.toISOString() : null;
};

export async function emitInviteCreate(invite: InviteLike): Promise<void> {
  try {
    const audience = await inviteAudience(invite.serverId, invite.channelId);
    if (audience.length === 0) return;
    await publish({
      t: 'INVITE_CREATE',
      guildId: normalizeId(invite.serverId),
      intent: GUILD_INTENTS.GUILD_INVITES,
      audience,
      d: {
        channel_id: invite.channelId,
        guild_id: invite.serverId,
        code: invite.code,
        created_at: iso(invite.createdAt) ?? new Date().toISOString(),
        expires_at: iso(invite.expiresAt),
        ...(invite.inviterId ? { inviter: await userObject(invite.inviterId) } : {}),
        max_age: invite.maxAge ?? 86400,
        max_uses: invite.maxUses ?? 0,
        temporary: invite.temporary ?? false,
        uses: invite.uses ?? 0,
      },
    });
  } catch { /* best-effort */ }
}

export async function emitInviteDelete(invite: Pick<InviteLike, 'code' | 'serverId' | 'channelId'>): Promise<void> {
  try {
    const audience = await inviteAudience(invite.serverId, invite.channelId);
    await publish({
      t: 'INVITE_DELETE',
      guildId: normalizeId(invite.serverId),
      intent: GUILD_INTENTS.GUILD_INVITES,
      audience,
      d: { channel_id: invite.channelId, guild_id: invite.serverId, code: invite.code },
    });
  } catch { /* best-effort */ }
}

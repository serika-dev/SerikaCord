/**
 * Server membership writes shared by the user API, bot API and developer
 * routes. Counter changes are atomic SQL based on rows actually inserted or
 * deleted, so concurrent joins/leaves can't lose updates and removing a
 * non-member never changes memberCount.
 */
import { and, eq, sql } from 'drizzle-orm';
import { db, schema } from '@/lib/db/postgres';
import { cache } from '@/lib/db';
import { normalizeId } from '@/lib/db/normalizeId';
import { ServerBan, ServerMember, type IServerMember } from '@/lib/models';
import { invalidateServerMemberCache } from '@/lib/api/activity';
import { requestUserChannelStreamRecheck } from '@/lib/realtime/channelStreams';
import { joinsAsPending } from '@/lib/services/serverCommunity';

/** Atomically add `delta` to a server's memberCount (never below 0). */
export async function adjustServerMemberCount(serverId: string, delta: number): Promise<void> {
  if (!delta) return;
  await db
    .update(schema.servers)
    .set({ memberCount: sql`GREATEST(COALESCE(${schema.servers.memberCount}, 0) + ${delta}, 0)` })
    .where(eq(schema.servers.id, normalizeId(serverId)));
}

async function afterMembershipChange(serverId: string): Promise<void> {
  invalidateServerMemberCache(serverId);
  // Bot gateway audiences (who may see which channel) depend on membership.
  void import('@/lib/services/gatewayAudience').then((m) => m.invalidateServerAudience(serverId)).catch(() => {});
  await cache.del(`server:${serverId}`).catch(() => { /* cache is best-effort */ });
}

/**
 * Insert a membership row unless one already exists. Safe under concurrent
 * joins: a duplicate insert is a no-op instead of a 500, and memberCount is
 * only incremented when a row was really created.
 */
export async function insertServerMember(
  serverId: string,
  userId: string,
  values: Omit<typeof schema.serverMembers.$inferInsert, 'serverId' | 'userId'> = {},
): Promise<{ membership: IServerMember | null; created: boolean }> {
  // Rules screening: people who join while it is on must accept the rules
  // before they can talk (serverGate.ts screeningDenial).
  const pending = values.pending ?? (await joinsAsPending(serverId).catch(() => false));
  const [row] = await db
    .insert(schema.serverMembers)
    .values({ ...values, pending, serverId: normalizeId(serverId), userId: normalizeId(userId) })
    .onConflictDoNothing()
    .returning();
  if (!row) {
    const existing = await ServerMember.findOne({ serverId, userId });
    return { membership: existing, created: false };
  }
  await adjustServerMemberCount(serverId, 1);
  await afterMembershipChange(serverId);
  // GUILD_MEMBER_ADD for the guild's bots (GUILD_MEMBERS intent).
  void import('@/lib/services/guildGatewayEvents').then((m) => m.emitMemberAdd(serverId, userId)).catch(() => {});
  return { membership: row, created: true };
}

/**
 * Remove a user's membership. Returns false (and touches nothing) when the
 * user wasn't a member. On removal: decrements memberCount atomically,
 * invalidates member caches, closes the user's open channel streams for
 * channels they can no longer see and deletes their per-server profile
 * images (fire-and-forget). Used by leave, kick, ban and the bot API.
 */
export async function removeServerMember(serverId: string, userId: string): Promise<boolean> {
  const deleted = await db
    .delete(schema.serverMembers)
    .where(and(
      eq(schema.serverMembers.serverId, normalizeId(serverId)),
      eq(schema.serverMembers.userId, normalizeId(userId)),
    ))
    .returning({ id: schema.serverMembers.id });
  if (deleted.length === 0) return false;
  await adjustServerMemberCount(serverId, -deleted.length);
  await afterMembershipChange(serverId);
  requestUserChannelStreamRecheck(normalizeId(userId));
  // A server tag only shows while you're a member of its server (CORD-53).
  void import('@/lib/services/serverTags').then((m) => m.clearServerTagOnLeave(serverId, userId)).catch(() => {});
  // A kicked / banned / departed bot's gateway session must stop receiving this
  // server's events now, not at its next reconnect (targeted, so it only ever
  // reaches a bot connection with that user id).
  void import('@/lib/services/gatewayEvents')
    .then((m) => m.emitGuildDelete({ guildId: normalizeId(serverId), targetBotId: normalizeId(userId) }))
    .catch(() => {});
  // GUILD_MEMBER_REMOVE to the remaining bots (plus GUILD_INTEGRATIONS_UPDATE when a bot left).
  void import('@/lib/services/guildGatewayEvents').then((m) => m.emitMemberRemove(serverId, userId)).catch(() => {});
  // Their per-server avatar / banner files (own prefix only), in the background.
  void import('@/lib/services/memberProfileMedia')
    .then((m) => m.cleanupMemberProfileMediaInBackground([normalizeId(serverId)], normalizeId(userId)))
    .catch(() => {});
  return true;
}

/**
 * Create or update a ban. Works whether or not the (server_id, user_id)
 * unique index exists: a concurrent duplicate insert falls back to an update
 * instead of surfacing a 500.
 */
export async function upsertServerBan(
  serverId: string,
  userId: string,
  bannedBy: string,
  reason: string | null,
): Promise<void> {
  const existing = await ServerBan.findOne({ serverId, userId });
  if (existing) {
    await ServerBan.updateById(existing.id, { bannedBy, reason });
    return;
  }
  try {
    await ServerBan.create({ serverId: normalizeId(serverId), userId: normalizeId(userId), bannedBy, reason });
    // GUILD_BAN_ADD (GUILD_MODERATION intent) for a new ban only, like Discord.
    void import('@/lib/services/guildGatewayEvents').then((m) => m.emitBanAdd(serverId, userId)).catch(() => {});
  } catch (err) {
    const e = err as { code?: string; cause?: { code?: string } } | null;
    if ((e?.code ?? e?.cause?.code) !== '23505') throw err;
    const raced = await ServerBan.findOne({ serverId, userId });
    if (raced) await ServerBan.updateById(raced.id, { bannedBy, reason });
  }
}

/**
 * Lift a ban. Returns false when there was none. Sends GUILD_BAN_REMOVE to
 * the guild's bots. Shared by the web unban route and the bot API.
 */
export async function removeServerBan(serverId: string, userId: string): Promise<boolean> {
  const deleted = await db
    .delete(schema.serverBans)
    .where(and(
      eq(schema.serverBans.serverId, normalizeId(serverId)),
      eq(schema.serverBans.userId, normalizeId(userId)),
    ))
    .returning({ id: schema.serverBans.id });
  if (deleted.length === 0) return false;
  void import('@/lib/services/guildGatewayEvents').then((m) => m.emitBanRemove(serverId, userId)).catch(() => {});
  return true;
}

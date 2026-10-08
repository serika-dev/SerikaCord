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
  const [row] = await db
    .insert(schema.serverMembers)
    .values({ ...values, serverId: normalizeId(serverId), userId: normalizeId(userId) })
    .onConflictDoNothing()
    .returning();
  if (!row) {
    const existing = await ServerMember.findOne({ serverId, userId });
    return { membership: existing, created: false };
  }
  await adjustServerMemberCount(serverId, 1);
  await afterMembershipChange(serverId);
  return { membership: row, created: true };
}

/**
 * Remove a user's membership. Returns false (and touches nothing) when the
 * user wasn't a member. On removal: decrements memberCount atomically,
 * invalidates member caches and closes the user's open channel streams for
 * channels they can no longer see.
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
  } catch (err) {
    const e = err as { code?: string; cause?: { code?: string } } | null;
    if ((e?.code ?? e?.cause?.code) !== '23505') throw err;
    const raced = await ServerBan.findOne({ serverId, userId });
    if (raced) await ServerBan.updateById(raced.id, { bannedBy, reason });
  }
}

/**
 * When each member joined a thread (Discord thread member `join_timestamp`).
 *
 * Membership itself is channels.thread_member_ids; the join time is kept in a
 * Redis hash per thread (`thread:joins:<threadId>`, user id -> epoch ms),
 * written by addThreadMembers / removeThreadMember in
 * src/lib/services/threads.ts. Members without an entry (the creator, who is
 * added with the row, and anyone who joined before this existed) fall back to
 * the thread's creation time. Best-effort: Redis being down only loses the
 * precise time, never membership.
 */
import { getRedis } from '@/lib/db/redis';

const key = (threadId: string) => `thread:joins:${threadId.toLowerCase()}`;

/** Remember that `userIds` joined `threadId` now (or at `at`). */
export async function recordThreadJoins(threadId: string, userIds: string[], at = Date.now()): Promise<void> {
  const redis = getRedis();
  if (!redis || userIds.length === 0) return;
  try {
    const fields: Record<string, string> = {};
    for (const id of userIds) fields[id.toLowerCase()] = String(at);
    await redis.hset(key(threadId), fields);
  } catch { /* best-effort */ }
}

/** Forget a member's join time (they left or were removed). */
export async function forgetThreadJoin(threadId: string, userId: string): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.hdel(key(threadId), userId.toLowerCase());
  } catch { /* best-effort */ }
}

/** Join times (ms) of `userIds` in `threadId`; missing entries are absent from the map. */
export async function readThreadJoins(threadId: string, userIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const redis = getRedis();
  if (!redis || userIds.length === 0) return out;
  try {
    const ids = userIds.map((id) => id.toLowerCase());
    const values = await redis.hmget(key(threadId), ...ids);
    ids.forEach((id, i) => {
      const n = Number(values[i]);
      if (values[i] && Number.isFinite(n) && n > 0) out.set(id, n);
    });
  } catch { /* fall back to the thread's creation time */ }
  return out;
}

/** Drop every join time of a deleted thread. */
export async function clearThreadJoins(threadId: string): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.del(key(threadId));
  } catch { /* best-effort */ }
}

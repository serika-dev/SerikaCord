/**
 * Storage cleanup for per-server profile images
 * (`<avatars|banners>/<serverId>/<userId>/<file>`, see
 * src/lib/profiles/memberMediaDrafts.ts for the key rules).
 *
 * - Drafts: every upload through POST /servers/:id/members/@me/profile-media/:kind
 *   is added to the Redis sorted set `member-media:drafts` (member = storage
 *   key, score = upload time in ms). PATCH /servers/:id/members/@me removes
 *   the keys it saves. The sweeper (one instance, behind a Redis leader lock,
 *   started from server.ts) takes drafts older than 24h in small batches,
 *   claims them (ZREM), and deletes those that are still not the member's
 *   saved avatar / banner. Only keys inside that member's own prefix are ever
 *   deleted.
 * - Removal: when a member leaves / is kicked / banned (removeServerMember),
 *   or the server is deleted, the files under the member's own prefixes are
 *   deleted after the membership row is gone. Fire-and-forget: never blocks
 *   the leave and only logs failures.
 * - Recent images: a file the user still lists as a recent avatar / banner,
 *   or uses as their main or another server profile image, is never deleted
 *   here (filterUnprotectedProfileKeys, src/lib/services/recentProfileMedia.ts);
 *   it goes when it drops off the recent list and nothing uses it.
 */
import { and, eq, or } from 'drizzle-orm';
import { db, schema } from '@/lib/db/postgres';
import { getRedis } from '@/lib/db/redis';
import {
  MEMBER_MEDIA_DRAFT_MAX_AGE_MS,
  memberMediaPrefixes,
  memberOwnedKeys,
  memberPairKey,
  memberPairsForKeys,
  parseMemberMediaKey,
  planDraftSweep,
  savedMemberKeys,
  serverMemberMediaFolders,
  serverMemberMediaKeys,
} from '@/lib/profiles/memberMediaDrafts';
import { filterUnprotectedProfileKeys } from '@/lib/services/recentProfileMedia';

const DRAFTS_KEY = 'member-media:drafts';
const SWEEP_LOCK_KEY = 'member-media:sweep-lock';
const SWEEP_INTERVAL_MS = 10 * 60 * 1000;
const SWEEP_LOCK_TTL_S = 15 * 60;
const SWEEP_BATCH = 50;
const SWEEP_MAX_BATCHES = 4;
/** At most this many files are listed per folder when a member / server is cleaned up. */
const MAX_KEYS_PER_FOLDER = 2000;

const g = globalThis as unknown as { __memberMediaSweeper?: boolean };

/** Remember a freshly uploaded draft (best-effort; without Redis nothing is tracked). */
export async function trackMemberMediaDraft(key: string): Promise<void> {
  if (!parseMemberMediaKey(key)) return;
  const redis = getRedis();
  if (!redis) return;
  await redis.zadd(DRAFTS_KEY, Date.now(), key).catch((err) => {
    console.warn('[member-media] Could not track draft:', (err as Error)?.message);
  });
}

/** Forget drafts that were saved (their storage keys). */
export async function untrackMemberMediaDrafts(keys: readonly string[]): Promise<void> {
  const valid = keys.filter((k) => parseMemberMediaKey(k));
  if (valid.length === 0) return;
  const redis = getRedis();
  if (!redis) return;
  await redis.zrem(DRAFTS_KEY, ...valid).catch(() => { /* the sweep re-checks the member row anyway */ });
}

async function deleteKeys(keys: readonly string[], label: string): Promise<{ deleted: string[]; failed: string[] }> {
  const { storage } = await import('@/lib/services/storage');
  const deleted: string[] = [];
  const failed: string[] = [];
  // Small groups: these run in the background next to live traffic.
  for (let i = 0; i < keys.length; i += 5) {
    const group = keys.slice(i, i + 5);
    const results = await Promise.allSettled(group.map((k) => storage.delete(k)));
    results.forEach((r, j) => (r.status === 'fulfilled' ? deleted : failed).push(group[j]));
  }
  if (failed.length > 0) console.error(`[member-media] ${label}: ${failed.length} file(s) could not be deleted`);
  return { deleted, failed };
}

/** The saved avatar / banner keys of the members that still exist, by memberPairKey. */
async function loadSavedKeys(pairs: Array<{ serverId: string; userId: string }>): Promise<Map<string, Set<string>>> {
  const saved = new Map<string, Set<string>>();
  if (pairs.length === 0) return saved;
  const { keyFromUrl } = await import('@/lib/services/storage');
  const sm = schema.serverMembers;
  const rows = await db
    .select({ serverId: sm.serverId, userId: sm.userId, avatar: sm.avatar, banner: sm.banner })
    .from(sm)
    .where(or(...pairs.map((p) => and(eq(sm.serverId, p.serverId), eq(sm.userId, p.userId)))));
  for (const row of rows) saved.set(memberPairKey(row.serverId, row.userId), savedMemberKeys(row, keyFromUrl));
  return saved;
}

/**
 * One sweep batch: drafts uploaded more than 24h ago that were never saved.
 * Each key is claimed (ZREM) before the member row is read, so two sweeps
 * never handle the same key; a failed delete is put back to retry later.
 */
export async function sweepMemberMediaDrafts(now = Date.now()): Promise<{ claimed: number; deleted: number; untracked: number }> {
  const redis = getRedis();
  if (!redis) return { claimed: 0, deleted: 0, untracked: 0 };
  const raw = await redis.zrangebyscore(DRAFTS_KEY, '-inf', now - MEMBER_MEDIA_DRAFT_MAX_AGE_MS, 'WITHSCORES', 'LIMIT', 0, SWEEP_BATCH);
  if (raw.length === 0) return { claimed: 0, deleted: 0, untracked: 0 };
  const scores = new Map<string, number>();
  for (let i = 0; i + 1 < raw.length; i += 2) scores.set(raw[i], Number(raw[i + 1]));

  const pipe = redis.pipeline();
  for (const key of scores.keys()) pipe.zrem(DRAFTS_KEY, key);
  const results = (await pipe.exec()) ?? [];
  const keys = [...scores.keys()];
  const claimed = keys.filter((_, i) => !results[i]?.[0] && Number(results[i]?.[1]) === 1);

  let remove: string[];
  let untracked: number;
  try {
    const saved = await loadSavedKeys(memberPairsForKeys(claimed));
    const plan = planDraftSweep(claimed, saved);
    // A draft the user reused elsewhere or still lists as a recent image stays.
    remove = await filterUnprotectedProfileKeys(plan.remove);
    untracked = plan.untrack.length + (plan.remove.length - remove.length);
  } catch (err) {
    // Couldn't tell what is in use: put the claims back and try again later.
    const retry = redis.pipeline();
    for (const key of claimed) retry.zadd(DRAFTS_KEY, scores.get(key) ?? now, key);
    await retry.exec().catch(() => {});
    throw err;
  }
  const { deleted, failed } = await deleteKeys(remove, 'draft sweep');
  if (failed.length > 0) {
    const retry = redis.pipeline();
    for (const key of failed) retry.zadd(DRAFTS_KEY, scores.get(key) ?? now, key);
    await retry.exec().catch(() => {});
  }
  return { claimed: claimed.length, deleted: deleted.length, untracked };
}

/**
 * Start the periodic draft sweep (idempotent). One instance sweeps at a time:
 * each tick takes or renews `member-media:sweep-lock`; a crashed leader's
 * lock expires and another instance takes over. Without Redis there are no
 * tracked drafts, so nothing runs. Disable with DISABLE_MEMBER_MEDIA_SWEEP=1.
 */
export function startMemberMediaDraftSweeper(instanceId: string): void {
  if (g.__memberMediaSweeper) return;
  if (process.env.DISABLE_MEMBER_MEDIA_SWEEP === '1') return;
  g.__memberMediaSweeper = true;
  let running = false;
  const tick = async () => {
    if (running) return;
    const redis = getRedis();
    if (!redis) return;
    running = true;
    try {
      const got = await redis.set(SWEEP_LOCK_KEY, instanceId, 'EX', SWEEP_LOCK_TTL_S, 'NX').catch(() => null);
      const leader = got === 'OK' || (await redis.get(SWEEP_LOCK_KEY).catch(() => null)) === instanceId;
      if (!leader) return;
      await redis.expire(SWEEP_LOCK_KEY, SWEEP_LOCK_TTL_S).catch(() => {});
      let deleted = 0;
      for (let i = 0; i < SWEEP_MAX_BATCHES; i++) {
        const r = await sweepMemberMediaDrafts();
        deleted += r.deleted;
        if (r.claimed < SWEEP_BATCH) break;
      }
      if (deleted > 0) console.log(`[member-media] Deleted ${deleted} unsaved server profile image(s)`);
    } catch (err) {
      console.error('[member-media] Draft sweep failed:', (err as Error)?.message ?? err);
    } finally {
      running = false;
    }
  };
  const first = setTimeout(() => { void tick(); }, 2 * 60 * 1000);
  const timer = setInterval(() => { void tick(); }, SWEEP_INTERVAL_MS);
  first.unref?.();
  timer.unref?.();
}

/**
 * Delete a removed member's per-server images (their own prefixes only).
 * Call after the membership row is deleted. Skipped when they are a member
 * again by the time the files are listed (a quick rejoin keeps its uploads;
 * the draft sweep still handles unsaved ones).
 */
export async function deleteMemberProfileMedia(serverId: string, userId: string): Promise<void> {
  const prefixes = memberMediaPrefixes(serverId, userId);
  if (prefixes.length === 0) return;
  const { storage } = await import('@/lib/services/storage');
  const listed = (await Promise.all(prefixes.map((p) => storage.listKeys(p, MAX_KEYS_PER_FOLDER)))).flat();
  const keys = memberOwnedKeys(listed, serverId, userId);
  if (keys.length === 0) return;
  const sm = schema.serverMembers;
  const [again] = await db
    .select({ id: sm.id })
    .from(sm)
    .where(and(eq(sm.serverId, serverId.toLowerCase()), eq(sm.userId, userId.toLowerCase())))
    .limit(1);
  if (again) return;
  // Images they still use elsewhere or keep as recent avatars / banners stay.
  const removable = await filterUnprotectedProfileKeys(keys);
  if (removable.length === 0) return;
  const { deleted } = await deleteKeys(removable, 'member removal');
  await untrackMemberMediaDrafts(deleted);
}

/**
 * Fire-and-forget deleteMemberProfileMedia for one user in each of these
 * servers (one server at a time), with logging. Never throws, never blocks.
 */
export function cleanupMemberProfileMediaInBackground(serverIds: readonly string[], userId: string): void {
  void (async () => {
    for (const serverId of serverIds) {
      await deleteMemberProfileMedia(serverId, userId).catch((err) => {
        console.error('[member-media] Cleanup after member removal failed:', (err as Error)?.message ?? err);
      });
    }
  })();
}

/** Delete every member's per-server images of a deleted server (member prefixes only). */
export async function deleteServerProfileMedia(serverId: string): Promise<void> {
  const folders = serverMemberMediaFolders(serverId);
  if (folders.length === 0) return;
  const { storage } = await import('@/lib/services/storage');
  const listed = (await Promise.all(folders.map((f) => storage.listKeys(f, MAX_KEYS_PER_FOLDER * 5)))).flat();
  const keys = serverMemberMediaKeys(listed, serverId);
  if (keys.length === 0) return;
  // Members' recent avatars / banners (and images reused elsewhere) stay.
  const removable = await filterUnprotectedProfileKeys(keys);
  if (removable.length === 0) return;
  const { deleted } = await deleteKeys(removable, 'server deletion');
  await untrackMemberMediaDrafts(deleted);
}

/** Fire-and-forget deleteServerProfileMedia with logging. */
export function cleanupServerProfileMediaInBackground(serverId: string): void {
  void deleteServerProfileMedia(serverId).catch((err) => {
    console.error('[member-media] Cleanup after server deletion failed:', (err as Error)?.message ?? err);
  });
}

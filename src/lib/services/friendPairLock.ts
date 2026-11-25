import { eq } from 'drizzle-orm';
import { db, schema } from '@/lib/db/postgres';
import { normalizeId } from '@/lib/db/normalizeId';
import { invalidateUserCache } from '@/lib/services/auth';
import type { IUser } from '@/lib/models';
import { mirrorFriendChange } from '@/lib/services/friendGraph';
import { applyFriendPatch, localPeerState, type PeerState } from '@/lib/social/friendGraphSync';

type UserPatch = Partial<typeof schema.users.$inferInsert>;
type PairRelation = { before: PeerState; after: PeerState };

export interface FriendPairOutcome {
  /** HTTP status for a refusal; omitted on success. */
  status?: number;
  body: Record<string, unknown>;
  /** True when at least one row was written (caches dropped, event emitted by caller). */
  changed?: boolean;
}

/**
 * Run a friend-graph mutation (add / accept / cancel / decline / block /
 * unblock / remove) with both user rows locked.
 *
 * Both rows are re-read inside one transaction with `SELECT ... FOR UPDATE`,
 * locked in a fixed id order so two opposite requests (A→B and B→A) can't
 * deadlock. `fn` sees the current rows, decides, and writes through `save`.
 * Concurrent mutations on the same pair (double-click, two devices, a third
 * user's request landing during an accept) are therefore serialized instead of
 * overwriting each other's arrays.
 *
 * After a write commits, the 5-minute auth cache (`user:<id>`) of both users
 * is dropped so friend lists, DM gates and block checks see the new state,
 * and the pair's new relation is mirrored to the Serika Accounts friend graph
 * (best-effort, not awaited; `mirror: false` for changes imported from it).
 *
 * Returns null when either user doesn't exist.
 */
export async function mutateFriendPair(
  meId: string,
  targetId: string,
  fn: (me: IUser, target: IUser, save: (id: string, patch: UserPatch) => Promise<void>) => Promise<FriendPairOutcome>,
  opts: { mirror?: boolean } = {},
): Promise<FriendPairOutcome | null> {
  const me = normalizeId(meId);
  const target = normalizeId(targetId);
  const lockOrder = me === target ? [me] : [me, target].sort();

  // The pair as read under the lock and as written, for the graph mirror.
  let relation: PairRelation | null = null;

  const outcome = await db.transaction(async (tx) => {
    const rows = new Map<string, IUser>();
    for (const id of lockOrder) {
      const [row] = await tx.select().from(schema.users).where(eq(schema.users.id, id)).for('update').limit(1);
      if (!row) return null;
      rows.set(id, row as IUser);
    }
    const written = new Map(rows);
    const save = async (id: string, patch: UserPatch) => {
      await tx.update(schema.users).set({ ...patch, updatedAt: new Date() }).where(eq(schema.users.id, normalizeId(id)));
      const key = normalizeId(id);
      const row = written.get(key);
      if (row) written.set(key, applyFriendPatch(row, patch as Partial<IUser>));
    };
    const result = await fn(rows.get(me)!, rows.get(target)!, save);
    if (me !== target) {
      relation = {
        before: localPeerState(rows.get(me)!, target),
        after: localPeerState(written.get(me)!, target),
      };
    }
    return result;
  });

  if (outcome?.changed) {
    await Promise.all([invalidateUserCache(me), invalidateUserCache(target)]).catch(() => {});
    // Assigned inside the transaction callback, which TS can't see.
    const rel = relation as PairRelation | null;
    if (rel && opts.mirror !== false) mirrorFriendChange(me, target, rel.before, rel.after);
  }
  return outcome;
}

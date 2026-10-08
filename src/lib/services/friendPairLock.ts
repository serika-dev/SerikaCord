import { eq } from 'drizzle-orm';
import { db, schema } from '@/lib/db/postgres';
import { normalizeId } from '@/lib/db/normalizeId';
import { invalidateUserCache } from '@/lib/services/auth';
import type { IUser } from '@/lib/models';

type UserPatch = Partial<typeof schema.users.$inferInsert>;

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
 * is dropped so friend lists, DM gates and block checks see the new state.
 *
 * Returns null when either user doesn't exist.
 */
export async function mutateFriendPair(
  meId: string,
  targetId: string,
  fn: (me: IUser, target: IUser, save: (id: string, patch: UserPatch) => Promise<void>) => Promise<FriendPairOutcome>,
): Promise<FriendPairOutcome | null> {
  const me = normalizeId(meId);
  const target = normalizeId(targetId);
  const lockOrder = me === target ? [me] : [me, target].sort();

  const outcome = await db.transaction(async (tx) => {
    const rows = new Map<string, IUser>();
    for (const id of lockOrder) {
      const [row] = await tx.select().from(schema.users).where(eq(schema.users.id, id)).for('update').limit(1);
      if (!row) return null;
      rows.set(id, row as IUser);
    }
    const save = async (id: string, patch: UserPatch) => {
      await tx.update(schema.users).set({ ...patch, updatedAt: new Date() }).where(eq(schema.users.id, normalizeId(id)));
    };
    return fn(rows.get(me)!, rows.get(target)!, save);
  });

  if (outcome?.changed) {
    await Promise.all([invalidateUserCache(me), invalidateUserCache(target)]).catch(() => {});
  }
  return outcome;
}

import { eq, and, desc, sql, type SQL } from 'drizzle-orm';
import { normalizeId } from '../db/normalizeId';
import { db, schema } from '../db/postgres';

export type IActivityHistory = typeof schema.activityHistory.$inferSelect;

export const ActivityHistory = {
  table: schema.activityHistory,

  /** Most-recent activities for a user, newest first. */
  async recent(userId: string, limit = 20) {
    return db
      .select()
      .from(schema.activityHistory)
      .where(eq(schema.activityHistory.userId, normalizeId(userId)))
      .orderBy(desc(schema.activityHistory.lastSeenAt))
      .limit(limit);
  },

  /**
   * Record that `activity` is currently active. Upserts the (user, type, name)
   * row, bumping `lastSeenAt` and accumulating `durationSeconds` by the polling
   * interval since it was last seen (capped so a long gap between sessions
   * doesn't inflate playtime). Increments `sessions` when re-seen after a gap.
   */
  async record(
    userId: string,
    activity: { type: string; name: string; imageUrl?: string | null },
    opts: { intervalSeconds?: number; sessionGapSeconds?: number } = {},
  ) {
    const intervalSeconds = opts.intervalSeconds ?? 60;
    const sessionGapSeconds = opts.sessionGapSeconds ?? 5 * 60;
    const uid = normalizeId(userId);
    const now = new Date();

    const [existing] = await db
      .select()
      .from(schema.activityHistory)
      .where(and(
        eq(schema.activityHistory.userId, uid),
        eq(schema.activityHistory.type, activity.type),
        eq(schema.activityHistory.name, activity.name),
      ))
      .limit(1);

    if (!existing) {
      await db.insert(schema.activityHistory).values({
        userId: uid,
        type: activity.type,
        name: activity.name,
        imageUrl: activity.imageUrl ?? null,
        firstSeenAt: now,
        lastSeenAt: now,
        durationSeconds: 0,
        sessions: 1,
      }).onConflictDoNothing();
      return;
    }

    const elapsed = Math.max(0, Math.round((now.getTime() - new Date(existing.lastSeenAt).getTime()) / 1000));
    const isNewSession = elapsed > sessionGapSeconds;
    // Only count contiguous time toward playtime; a long idle gap starts fresh.
    const addSeconds = isNewSession ? 0 : Math.min(elapsed, intervalSeconds * 2);

    await db.update(schema.activityHistory)
      .set({
        lastSeenAt: now,
        imageUrl: activity.imageUrl ?? existing.imageUrl,
        durationSeconds: sql`${schema.activityHistory.durationSeconds} + ${addSeconds}`,
        sessions: isNewSession
          ? sql`${schema.activityHistory.sessions} + 1`
          : existing.sessions,
      })
      .where(eq(schema.activityHistory.id, existing.id));
  },

  /** Clear a user's entire activity history. */
  async clear(userId: string) {
    await db.delete(schema.activityHistory).where(eq(schema.activityHistory.userId, normalizeId(userId)));
  },

  async deleteById(id: string) {
    await db.delete(schema.activityHistory).where(eq(schema.activityHistory.id, normalizeId(id)));
  },
};

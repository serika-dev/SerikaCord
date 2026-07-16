import { eq, and, inArray, sql } from 'drizzle-orm';
import { normalizeId } from '../db/normalizeId';
import { db, schema } from '../db/postgres';

export type IChannelReadState = typeof schema.channelReadStates.$inferSelect;

/**
 * Per-user, per-channel read markers. Authoritative, cross-device source of
 * unread/mention state; the client's localStorage cache is reconciled against
 * this on startup.
 */
export const ChannelReadState = {
  table: schema.channelReadStates,

  /** All read markers for a user (used to seed the unread engine on login). */
  async findByUser(userId: string) {
    return db
      .select()
      .from(schema.channelReadStates)
      .where(eq(schema.channelReadStates.userId, normalizeId(userId)));
  },

  /** Read markers for a user limited to a set of channels. */
  async findByUserChannels(userId: string, channelIds: string[]) {
    if (channelIds.length === 0) return [];
    return db
      .select()
      .from(schema.channelReadStates)
      .where(
        and(
          eq(schema.channelReadStates.userId, normalizeId(userId)),
          inArray(
            schema.channelReadStates.channelId,
            channelIds.map((id) => normalizeId(id))
          )
        )
      );
  },

  /**
   * Mark a channel read up to `messageId` (created at `readAt`). Idempotent
   * upsert keyed on (userId, channelId). Never moves the marker backwards.
   */
  async ack(userId: string, channelId: string, messageId: string | null, readAt: Date) {
    const uid = normalizeId(userId);
    const cid = normalizeId(channelId);
    const [row] = await db
      .insert(schema.channelReadStates)
      .values({
        userId: uid,
        channelId: cid,
        lastReadMessageId: messageId ? normalizeId(messageId) : null,
        lastReadAt: readAt,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [schema.channelReadStates.userId, schema.channelReadStates.channelId],
        set: {
          lastReadMessageId: messageId ? normalizeId(messageId) : null,
          lastReadAt: readAt,
          updatedAt: new Date(),
        },
        // Only advance the marker; a stale/out-of-order ack must not un-read.
        setWhere: sql`${schema.channelReadStates.lastReadAt} IS NULL OR ${schema.channelReadStates.lastReadAt} < ${readAt}`,
      })
      .returning();
    return row || null;
  },
};

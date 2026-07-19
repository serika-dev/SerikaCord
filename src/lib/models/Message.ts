import { eq, ne, sql, and, or, desc, asc, lt, gt, type SQL } from 'drizzle-orm';
import { normalizeId, buildCondition } from '../db/normalizeId';
import { db, schema } from '../db/postgres';

export type MessageType =
  | 'default'
  | 'reply'
  | 'system'
  | 'member_join'
  | 'member_leave'
  | 'channel_pinned_message'
  | 'user_premium_guild_subscription';

export type IMessage = typeof schema.messages.$inferSelect;

// Unread badges never show an exact number past this — the UI renders "99+".
// Counting (and carrying client-side) anything beyond it is wasted work, so the
// count query, the live increment, and the display all clamp to this ceiling.
// Kept a touch above 99 so "99+" is always reached before the cap bites.
export const MAX_UNREAD_BADGE = 100;

export const Message = {
  table: schema.messages,

  async findById(id: string) {
    const [row] = await db.select().from(schema.messages).where(eq(schema.messages.id, normalizeId(id))).limit(1);
    return row || null;
  },

  async findByDiscordMessageId(discordMessageId: string) {
    const [row] = await db.select().from(schema.messages).where(eq(schema.messages.discordMessageId, discordMessageId)).limit(1);
    return row || null;
  },

  async findOne(filter: Record<string, unknown>) {
    const conditions: SQL[] = [];
    for (const [key, value] of Object.entries(filter)) {
      if (value === undefined || value === null) continue;
      switch (key) {
        case 'id': conditions.push(buildCondition(schema.messages.id, value, true)); break;
        case 'channelId': conditions.push(buildCondition(schema.messages.channelId, value, true)); break;
        case 'serverId': conditions.push(buildCondition(schema.messages.serverId, value, true)); break;
        case 'authorId': conditions.push(buildCondition(schema.messages.authorId, value, true)); break;
        case 'referencedMessageId': conditions.push(buildCondition(schema.messages.referencedMessageId, value, true)); break;
        case 'threadId': conditions.push(buildCondition(schema.messages.threadId, value, true)); break;
        case 'isDeleted': conditions.push(eq(schema.messages.isDeleted, value as boolean)); break;
        case 'pinned': conditions.push(eq(schema.messages.pinned, value as boolean)); break;
      }
    }
    let query = db.select().from(schema.messages);
    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as typeof query;
    }
    const [row] = await query.limit(1);
    return row || null;
  },

  async find(filter: Record<string, unknown> = {}) {
    const conditions: SQL[] = [];
    let limit: number | undefined;
    let orderAsc = false;
    for (const [key, value] of Object.entries(filter)) {
      if (value === undefined || value === null) continue;
      switch (key) {
        case 'id': conditions.push(buildCondition(schema.messages.id, value, true)); break;
        case 'channelId': conditions.push(buildCondition(schema.messages.channelId, value, true)); break;
        case 'serverId': conditions.push(buildCondition(schema.messages.serverId, value, true)); break;
        case 'authorId': conditions.push(buildCondition(schema.messages.authorId, value, true)); break;
        case 'isDeleted': conditions.push(eq(schema.messages.isDeleted, value as boolean)); break;
        case 'pinned': conditions.push(eq(schema.messages.pinned, value as boolean)); break;
        case '_limit': limit = value as number; break;
        case '_orderAsc': orderAsc = true; break;
        case 'createdAtBefore': conditions.push(lt(schema.messages.createdAt, value as Date)); break;
        case 'createdAtAfter': conditions.push(gt(schema.messages.createdAt, value as Date)); break;
      }
    }
    let query = db.select().from(schema.messages);
    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as typeof query;
    }
    query = query.orderBy(orderAsc ? asc(schema.messages.createdAt) : desc(schema.messages.createdAt)) as typeof query;
    if (limit) {
      query = query.limit(limit) as typeof query;
    }
    return query;
  },

  async create(data: typeof schema.messages.$inferInsert) {
    const [row] = await db.insert(schema.messages).values(data).returning();
    return row;
  },

  async updateById(id: string, data: Partial<typeof schema.messages.$inferInsert>) {
    const [row] = await db.update(schema.messages).set({ ...data, updatedAt: new Date() }).where(eq(schema.messages.id, normalizeId(id))).returning();
    return row || null;
  },

  async deleteById(id: string) {
    await db.delete(schema.messages).where(eq(schema.messages.id, normalizeId(id)));
  },

  async count() {
    const result = await db.select({ count: sql<number>`count(*)::int` }).from(schema.messages);
    return result[0]?.count ?? 0;
  },

  /**
   * Count unread, non-own, non-deleted messages for a set of channels in a
   * single grouped query. Each entry carries its own `after` cutoff (the user's
   * per-channel read marker); a null cutoff counts the whole channel.
   *
   * One round-trip regardless of channel count — used to seed DM unread badges
   * without N per-channel queries. Returns { channelId: count } (channels with
   * zero unread are omitted).
   *
   * Each channel is capped at MAX_UNREAD_BADGE: a windowed subquery numbers the
   * matching rows per channel and we only count up to the cap, so a DM sitting
   * on 1000+ unread never forces a full-backlog scan — we stop at the ceiling
   * the UI would render as "99+" anyway.
   */
  async unreadCounts(
    entries: { channelId: string; after: Date | null }[],
    userId: string,
  ): Promise<Record<string, number>> {
    if (entries.length === 0) return {};
    const perChannel = entries.map((e) => {
      const chan = buildCondition(schema.messages.channelId, e.channelId, true);
      return e.after ? and(chan, gt(schema.messages.createdAt, e.after)) : chan;
    });
    const ranked = db
      .select({
        channelId: schema.messages.channelId,
        rn: sql<number>`row_number() over (partition by ${schema.messages.channelId} order by ${schema.messages.createdAt} desc)`.as('rn'),
      })
      .from(schema.messages)
      .where(
        and(
          ne(schema.messages.authorId, normalizeId(userId)),
          eq(schema.messages.isDeleted, false),
          or(...perChannel),
        ),
      )
      .as('ranked');
    const rows = await db
      .select({
        channelId: ranked.channelId,
        count: sql<number>`count(*)::int`,
      })
      .from(ranked)
      .where(sql`${ranked.rn} <= ${MAX_UNREAD_BADGE}`)
      .groupBy(ranked.channelId);
    const out: Record<string, number> = {};
    for (const r of rows) {
      if (r.count > 0) out[r.channelId] = r.count;
    }
    return out;
  },
};

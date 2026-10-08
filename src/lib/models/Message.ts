import { eq, ne, sql, and, or, desc, asc, lt, gt, gte, type SQL } from 'drizzle-orm';
import { normalizeId, buildCondition } from '../db/normalizeId';
import { db, schema } from '../db/postgres';

export type MessageType =
  | 'default'
  | 'reply'
  | 'system'
  | 'member_join'
  | 'member_leave'
  | 'channel_pinned_message'
  | 'user_premium_guild_subscription'
  | 'call';

export type IMessage = typeof schema.messages.$inferSelect;

// Unread badges never show an exact number past this — the UI renders "99+".
// Counting (and carrying client-side) anything beyond it is wasted work, so the
// count query, the live increment, and the display all clamp to this ceiling.
// Kept a touch above 99 so "99+" is always reached before the cap bites.
export const MAX_UNREAD_BADGE = 100;

// Used when a caller passes an invalid `_limit` to Message.find.
const FALLBACK_FIND_LIMIT = 100;

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
        // Only a positive finite limit is applied; a bad value (0, NaN,
        // negative) falls back to a safe cap instead of meaning "no LIMIT".
        // Callers that really want every row leave `_limit` out.
        case '_limit': {
          const n = Number(value);
          limit = Number.isFinite(n) && n > 0 ? Math.floor(n) : FALLBACK_FIND_LIMIT;
          break;
        }
        case '_orderAsc': orderAsc = Boolean(value); break;
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

  /**
   * Recent messages that mention a user (directly, via @everyone/@here, or via
   * one of their roles), newest first. Filtered in SQL — the old approach took
   * the newest 200 messages across every channel and filtered in JS, which was
   * slow and missed mentions in busy servers.
   */
  async findMentionsOf(opts: {
    channelIds: string[];
    userId: string;
    roleIds: string[];
    since: Date;
    limit: number;
  }) {
    if (opts.channelIds.length === 0) return [];
    const uid = normalizeId(opts.userId);
    const mentionConds: SQL[] = [
      sql`${schema.messages.mentionedUserIds} @> ARRAY[${uid}]::uuid[]`,
      eq(schema.messages.mentionEveryone, true),
    ];
    if (opts.roleIds.length > 0) {
      const roles = sql.join(opts.roleIds.map((r) => sql`${normalizeId(r)}`), sql`, `);
      mentionConds.push(sql`${schema.messages.mentionedRoleIds} && ARRAY[${roles}]::uuid[]`);
    }
    return db
      .select()
      .from(schema.messages)
      .where(and(
        buildCondition(schema.messages.channelId, { in: opts.channelIds }, true),
        eq(schema.messages.isDeleted, false),
        gt(schema.messages.createdAt, opts.since),
        ne(schema.messages.authorId, uid),
        or(...mentionConds),
      ))
      .orderBy(desc(schema.messages.createdAt))
      .limit(opts.limit);
  },

  async create(data: typeof schema.messages.$inferInsert) {
    const [row] = await db.insert(schema.messages).values(data).returning();
    return row;
  },

  async updateById(id: string, data: Partial<typeof schema.messages.$inferInsert>) {
    const [row] = await db.update(schema.messages).set({ ...data, updatedAt: new Date() }).where(eq(schema.messages.id, normalizeId(id))).returning();
    return row || null;
  },

  /**
   * Row-locked read-modify-write of a message's reactions array, so concurrent
   * reactions can't overwrite each other. `fn` gets the current array and
   * returns the next one (or null to leave the row untouched). Returns the
   * array that was stored, or null when the message doesn't exist. Doesn't
   * bump `updatedAt`: a reaction is not an edit.
   */
  async mutateReactions<T>(
    id: string,
    fn: (current: T[]) => T[] | null,
  ): Promise<T[] | null> {
    return db.transaction(async (tx) => {
      const [row] = await tx
        .select({ reactions: schema.messages.reactions })
        .from(schema.messages)
        .where(eq(schema.messages.id, normalizeId(id)))
        .for('update');
      if (!row) return null;
      const current = (Array.isArray(row.reactions) ? row.reactions : []) as T[];
      const next = fn(current);
      if (next === null) return current;
      await tx
        .update(schema.messages)
        .set({ reactions: next })
        .where(eq(schema.messages.id, normalizeId(id)));
      return next;
    });
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
      // Postgres keeps microseconds but the read marker came through a JS Date
      // (milliseconds), so the read message itself compares as "after" it.
      // Count from the next millisecond instead.
      return e.after ? and(chan, gte(schema.messages.createdAt, new Date(e.after.getTime() + 1))) : chan;
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

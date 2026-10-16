import { eq, and, gt, asc, sql, type SQL } from 'drizzle-orm';
import { normalizeId, buildCondition } from '../db/normalizeId';
import { db, schema } from '../db/postgres';

export type IServerMember = typeof schema.serverMembers.$inferSelect;

export const ServerMember = {
  table: schema.serverMembers,

  async findById(id: string) {
    const [row] = await db.select().from(schema.serverMembers).where(eq(schema.serverMembers.id, normalizeId(id))).limit(1);
    return row || null;
  },

  async findOne(filter: Record<string, unknown>) {
    const conditions: SQL[] = [];
    for (const [key, value] of Object.entries(filter)) {
      if (value === undefined || value === null) continue;
      switch (key) {
        case 'id': conditions.push(buildCondition(schema.serverMembers.id, value, true)); break;
        case 'serverId': conditions.push(buildCondition(schema.serverMembers.serverId, value, true)); break;
        case 'userId': conditions.push(buildCondition(schema.serverMembers.userId, value, true)); break;
      }
    }
    let query = db.select().from(schema.serverMembers);
    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as typeof query;
    }
    const [row] = await query.limit(1);
    return row || null;
  },

  async find(filter: Record<string, unknown> = {}) {
    const conditions: SQL[] = [];
    for (const [key, value] of Object.entries(filter)) {
      if (value === undefined || value === null) continue;
      switch (key) {
        case 'id': conditions.push(buildCondition(schema.serverMembers.id, value, true)); break;
        case 'serverId': conditions.push(buildCondition(schema.serverMembers.serverId, value, true)); break;
        case 'userId': conditions.push(buildCondition(schema.serverMembers.userId, value, true)); break;
      }
    }
    let query = db.select().from(schema.serverMembers);
    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as typeof query;
    }
    return query;
  },

  /** User ids of the bot accounts that are members of a server (one indexed query, no full member scan). */
  async findBotUserIds(serverId: string): Promise<string[]> {
    const rows = await db
      .select({ userId: schema.serverMembers.userId })
      .from(schema.serverMembers)
      .innerJoin(schema.users, eq(schema.users.id, schema.serverMembers.userId))
      .where(and(eq(schema.serverMembers.serverId, normalizeId(serverId)), eq(schema.users.isBot, true)));
    return rows.map((r) => r.userId);
  },

  /** How many servers a user is a member of (one indexed count). */
  async countByUser(userId: string): Promise<number> {
    if (!userId) return 0;
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.serverMembers)
      .where(eq(schema.serverMembers.userId, normalizeId(userId)));
    return Number(row?.n ?? 0);
  },

  /** One page of a server's members ordered by user id (Discord's `after` + `limit`). */
  async listPage(serverId: string, opts: { limit: number; afterUserId?: string | null }) {
    const conditions: SQL[] = [eq(schema.serverMembers.serverId, normalizeId(serverId))];
    if (opts.afterUserId) conditions.push(gt(schema.serverMembers.userId, normalizeId(opts.afterUserId)));
    return db
      .select()
      .from(schema.serverMembers)
      .where(and(...conditions))
      .orderBy(asc(schema.serverMembers.userId))
      .limit(Math.max(1, Math.min(1000, Math.floor(opts.limit) || 1)));
  },

  async create(data: typeof schema.serverMembers.$inferInsert) {
    const [row] = await db.insert(schema.serverMembers).values(data).returning();
    return row;
  },

  async updateById(id: string, data: Partial<typeof schema.serverMembers.$inferInsert>) {
    const [row] = await db.update(schema.serverMembers).set({ ...data, updatedAt: new Date() }).where(eq(schema.serverMembers.id, normalizeId(id))).returning();
    return row || null;
  },

  async deleteById(id: string) {
    await db.delete(schema.serverMembers).where(eq(schema.serverMembers.id, normalizeId(id)));
  },
};

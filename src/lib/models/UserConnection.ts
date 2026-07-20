import { eq, and, type SQL } from 'drizzle-orm';
import { normalizeId } from '../db/normalizeId';
import { db, schema } from '../db/postgres';

export type IUserConnection = typeof schema.userConnections.$inferSelect;

export const UserConnection = {
  table: schema.userConnections,

  async findById(id: string) {
    const [row] = await db.select().from(schema.userConnections).where(eq(schema.userConnections.id, normalizeId(id))).limit(1);
    return row || null;
  },

  async findOne(filter: Record<string, unknown>) {
    const conditions: SQL[] = [];
    for (const [key, value] of Object.entries(filter)) {
      if (value === undefined || value === null) continue;
      switch (key) {
        case 'id': conditions.push(eq(schema.userConnections.id, normalizeId(value as string))); break;
        case 'userId': conditions.push(eq(schema.userConnections.userId, normalizeId(value as string))); break;
        case 'provider': conditions.push(eq(schema.userConnections.provider, value as string)); break;
        case 'accountId': conditions.push(eq(schema.userConnections.accountId, value as string)); break;
      }
    }
    let query = db.select().from(schema.userConnections);
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
        case 'userId': conditions.push(eq(schema.userConnections.userId, normalizeId(value as string))); break;
        case 'provider': conditions.push(eq(schema.userConnections.provider, value as string)); break;
      }
    }
    let query = db.select().from(schema.userConnections);
    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as typeof query;
    }
    return query;
  },

  async create(data: typeof schema.userConnections.$inferInsert) {
    const [row] = await db.insert(schema.userConnections).values(data).returning();
    return row;
  },

  async updateById(id: string, data: Partial<typeof schema.userConnections.$inferInsert>) {
    const [row] = await db.update(schema.userConnections).set({ ...data, updatedAt: new Date() }).where(eq(schema.userConnections.id, normalizeId(id))).returning();
    return row || null;
  },

  async deleteById(id: string) {
    await db.delete(schema.userConnections).where(eq(schema.userConnections.id, normalizeId(id)));
  },
};

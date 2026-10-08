import { eq, and, type SQL } from 'drizzle-orm';
import { normalizeId } from '../db/normalizeId';
import { db, schema } from '../db/postgres';

export type IAuthorizedApp = typeof schema.authorizedApps.$inferSelect;

export const AuthorizedApp = {
  table: schema.authorizedApps,

  async findById(id: string) {
    const [row] = await db.select().from(schema.authorizedApps).where(eq(schema.authorizedApps.id, normalizeId(id))).limit(1);
    return row || null;
  },

  async findOne(filter: Record<string, unknown>) {
    const conditions: SQL[] = [];
    for (const [key, value] of Object.entries(filter)) {
      if (value === undefined || value === null) continue;
      switch (key) {
        case 'userId': conditions.push(eq(schema.authorizedApps.userId, normalizeId(value as string))); break;
        case 'name': conditions.push(eq(schema.authorizedApps.name, String(value))); break;
      }
    }
    let query = db.select().from(schema.authorizedApps);
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
        case 'userId': conditions.push(eq(schema.authorizedApps.userId, normalizeId(value as string))); break;
        case 'name': conditions.push(eq(schema.authorizedApps.name, String(value))); break;
      }
    }
    let query = db.select().from(schema.authorizedApps);
    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as typeof query;
    }
    return query;
  },

  async create(data: typeof schema.authorizedApps.$inferInsert) {
    const [row] = await db.insert(schema.authorizedApps).values(data).returning();
    return row;
  },

  async updateById(id: string, data: Partial<typeof schema.authorizedApps.$inferInsert>) {
    const [row] = await db.update(schema.authorizedApps).set({ ...data, updatedAt: new Date() }).where(eq(schema.authorizedApps.id, normalizeId(id))).returning();
    return row || null;
  },

  async deleteById(id: string) {
    await db.delete(schema.authorizedApps).where(eq(schema.authorizedApps.id, normalizeId(id)));
  },

  /** Delete an authorized app only if it belongs to `userId`; false when no such row. */
  async deleteByIdForUser(id: string, userId: string) {
    const rows = await db.delete(schema.authorizedApps)
      .where(and(eq(schema.authorizedApps.id, normalizeId(id)), eq(schema.authorizedApps.userId, normalizeId(userId))))
      .returning({ id: schema.authorizedApps.id });
    return rows.length > 0;
  },
};

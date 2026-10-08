import { eq, and, type SQL } from 'drizzle-orm';
import { normalizeId } from '../db/normalizeId';
import { db, schema } from '../db/postgres';

export type IUserDeviceSession = typeof schema.userDeviceSessions.$inferSelect;

export const UserDeviceSession = {
  table: schema.userDeviceSessions,

  async findById(id: string) {
    const [row] = await db.select().from(schema.userDeviceSessions).where(eq(schema.userDeviceSessions.id, normalizeId(id))).limit(1);
    return row || null;
  },

  async findOne(filter: Record<string, unknown>) {
    const conditions: SQL[] = [];
    for (const [key, value] of Object.entries(filter)) {
      if (value === undefined || value === null) continue;
      switch (key) {
        case 'id': conditions.push(eq(schema.userDeviceSessions.id, normalizeId(value as string))); break;
        case 'userId': conditions.push(eq(schema.userDeviceSessions.userId, normalizeId(value as string))); break;
        case 'current': conditions.push(eq(schema.userDeviceSessions.current, value as boolean)); break;
        case 'browser': conditions.push(eq(schema.userDeviceSessions.browser, value as string)); break;
      }
    }
    let query = db.select().from(schema.userDeviceSessions);
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
        case 'userId': conditions.push(eq(schema.userDeviceSessions.userId, normalizeId(value as string))); break;
      }
    }
    let query = db.select().from(schema.userDeviceSessions);
    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as typeof query;
    }
    return query;
  },

  async create(data: typeof schema.userDeviceSessions.$inferInsert) {
    const [row] = await db.insert(schema.userDeviceSessions).values(data).returning();
    return row;
  },

  async updateById(id: string, data: Partial<typeof schema.userDeviceSessions.$inferInsert>) {
    const [row] = await db.update(schema.userDeviceSessions).set({ ...data, updatedAt: new Date() }).where(eq(schema.userDeviceSessions.id, normalizeId(id))).returning();
    return row || null;
  },

  async updateMany(filter: Record<string, unknown>, data: Partial<typeof schema.userDeviceSessions.$inferInsert>) {
    const conditions: SQL[] = [];
    for (const [key, value] of Object.entries(filter)) {
      if (value === undefined || value === null) continue;
      switch (key) {
        case 'userId': conditions.push(eq(schema.userDeviceSessions.userId, normalizeId(value as string))); break;
        case 'current': conditions.push(eq(schema.userDeviceSessions.current, value as boolean)); break;
      }
    }
    if (conditions.length === 0) return;
    await db.update(schema.userDeviceSessions).set(data).where(and(...conditions));
  },

  async deleteById(id: string) {
    await db.delete(schema.userDeviceSessions).where(eq(schema.userDeviceSessions.id, normalizeId(id)));
  },

  /** Delete a device session only if it belongs to `userId`; false when no such row. */
  async deleteByIdForUser(id: string, userId: string) {
    const rows = await db.delete(schema.userDeviceSessions)
      .where(and(eq(schema.userDeviceSessions.id, normalizeId(id)), eq(schema.userDeviceSessions.userId, normalizeId(userId))))
      .returning({ id: schema.userDeviceSessions.id });
    return rows.length > 0;
  },
};

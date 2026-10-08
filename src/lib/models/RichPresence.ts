import { eq, and, type SQL } from 'drizzle-orm';
import { normalizeId, buildCondition } from '../db/normalizeId';
import { db, schema } from '../db/postgres';

export type IRichPresence = typeof schema.richPresence.$inferSelect;

export const RichPresence = {
  table: schema.richPresence,

  async findById(id: string) {
    const [row] = await db.select().from(schema.richPresence).where(eq(schema.richPresence.id, normalizeId(id))).limit(1);
    return row || null;
  },

  async findOne(filter: Record<string, unknown>) {
    const conditions: SQL[] = [];
    for (const [key, value] of Object.entries(filter)) {
      if (value === undefined || value === null) continue;
      switch (key) {
        case 'userId': conditions.push(buildCondition(schema.richPresence.userId, value, true)); break;
        case 'type': conditions.push(eq(schema.richPresence.type, value as string)); break;
        case 'name': conditions.push(eq(schema.richPresence.name, value as string)); break;
      }
    }
    let query = db.select().from(schema.richPresence);
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
        case 'userId': conditions.push(buildCondition(schema.richPresence.userId, value, true)); break;
        case 'type': conditions.push(eq(schema.richPresence.type, value as string)); break;
        case 'name': conditions.push(eq(schema.richPresence.name, value as string)); break;
      }
    }
    let query = db.select().from(schema.richPresence);
    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as typeof query;
    }
    return query;
  },

  async create(data: typeof schema.richPresence.$inferInsert) {
    const [row] = await db.insert(schema.richPresence).values(data).returning();
    return row;
  },

  async updateById(id: string, data: Partial<typeof schema.richPresence.$inferInsert>) {
    const [row] = await db.update(schema.richPresence).set({ ...data, updatedAt: new Date() }).where(eq(schema.richPresence.id, normalizeId(id))).returning();
    return row || null;
  },

  async deleteById(id: string) {
    await db.delete(schema.richPresence).where(eq(schema.richPresence.id, normalizeId(id)));
  },
};

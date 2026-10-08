import { eq, and, isNull, type SQL } from 'drizzle-orm';
import { normalizeId } from '../db/normalizeId';
import { db, schema } from '../db/postgres';

export type IAppCommand = typeof schema.appCommands.$inferSelect;

export const AppCommand = {
  table: schema.appCommands,

  async findById(id: string) {
    const [row] = await db.select().from(schema.appCommands).where(eq(schema.appCommands.id, normalizeId(id))).limit(1);
    return row || null;
  },

  async findOne(filter: Record<string, unknown>) {
    const conditions: SQL[] = [];
    for (const [key, value] of Object.entries(filter)) {
      if (value === undefined) continue;
      // An explicit `guildId: null` means global commands only.
      if (key === 'guildId' && value === null) { conditions.push(isNull(schema.appCommands.guildId)); continue; }
      if (value === null) continue;
      switch (key) {
        case 'applicationId': conditions.push(eq(schema.appCommands.applicationId, normalizeId(value as string))); break;
        case 'guildId': conditions.push(eq(schema.appCommands.guildId, normalizeId(value as string))); break;
      }
    }
    let query = db.select().from(schema.appCommands);
    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as typeof query;
    }
    const [row] = await query.limit(1);
    return row || null;
  },

  async find(filter: Record<string, unknown> = {}) {
    const conditions: SQL[] = [];
    for (const [key, value] of Object.entries(filter)) {
      if (value === undefined) continue;
      // An explicit `guildId: null` means global commands only.
      if (key === 'guildId' && value === null) { conditions.push(isNull(schema.appCommands.guildId)); continue; }
      if (value === null) continue;
      switch (key) {
        case 'applicationId': conditions.push(eq(schema.appCommands.applicationId, normalizeId(value as string))); break;
        case 'guildId': conditions.push(eq(schema.appCommands.guildId, normalizeId(value as string))); break;
      }
    }
    let query = db.select().from(schema.appCommands);
    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as typeof query;
    }
    return query;
  },

  async create(data: typeof schema.appCommands.$inferInsert) {
    const [row] = await db.insert(schema.appCommands).values(data).returning();
    return row;
  },

  async updateById(id: string, data: Partial<typeof schema.appCommands.$inferInsert>) {
    const [row] = await db.update(schema.appCommands).set({ ...data, updatedAt: new Date() }).where(eq(schema.appCommands.id, normalizeId(id))).returning();
    return row || null;
  },

  async deleteById(id: string) {
    await db.delete(schema.appCommands).where(eq(schema.appCommands.id, normalizeId(id)));
  },
};

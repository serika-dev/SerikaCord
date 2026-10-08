import { eq, and, type SQL } from 'drizzle-orm';
import { normalizeId, buildCondition } from '../db/normalizeId';
import { db, schema } from '../db/postgres';

export type IChannelWebhook = typeof schema.channelWebhooks.$inferSelect;

export const ChannelWebhook = {
  table: schema.channelWebhooks,

  async findById(id: string) {
    const [row] = await db.select().from(schema.channelWebhooks).where(eq(schema.channelWebhooks.id, normalizeId(id))).limit(1);
    return row || null;
  },

  async findOne(filter: Record<string, unknown>) {
    const conditions: SQL[] = [];
    for (const [key, value] of Object.entries(filter)) {
      if (value === undefined || value === null) continue;
      switch (key) {
        case 'id': conditions.push(buildCondition(schema.channelWebhooks.id, value, true)); break;
        case 'channelId': conditions.push(eq(schema.channelWebhooks.channelId, normalizeId(value as string))); break;
        case 'serverId': conditions.push(eq(schema.channelWebhooks.serverId, normalizeId(value as string))); break;
        case 'token': conditions.push(eq(schema.channelWebhooks.token, value as string)); break;
      }
    }
    let query = db.select().from(schema.channelWebhooks);
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
        case 'id': conditions.push(buildCondition(schema.channelWebhooks.id, value, true)); break;
        case 'channelId': conditions.push(eq(schema.channelWebhooks.channelId, normalizeId(value as string))); break;
        case 'serverId': conditions.push(eq(schema.channelWebhooks.serverId, normalizeId(value as string))); break;
        case 'token': conditions.push(eq(schema.channelWebhooks.token, value as string)); break;
      }
    }
    let query = db.select().from(schema.channelWebhooks);
    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as typeof query;
    }
    return query;
  },

  async create(data: typeof schema.channelWebhooks.$inferInsert) {
    const [row] = await db.insert(schema.channelWebhooks).values(data).returning();
    return row;
  },

  async updateById(id: string, data: Partial<typeof schema.channelWebhooks.$inferInsert>) {
    const [row] = await db.update(schema.channelWebhooks).set({ ...data, updatedAt: new Date() }).where(eq(schema.channelWebhooks.id, normalizeId(id))).returning();
    return row || null;
  },

  async deleteById(id: string) {
    await db.delete(schema.channelWebhooks).where(eq(schema.channelWebhooks.id, normalizeId(id)));
  },
};

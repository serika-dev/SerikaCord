import { eq, sql, and, type SQL } from 'drizzle-orm';
import { normalizeId, buildCondition } from '../db/normalizeId';
import { db, schema } from '../db/postgres';

export type ChannelType =
  | 'text'
  | 'voice'
  | 'category'
  | 'announcement'
  | 'stage'
  | 'forum'
  | 'public_thread'
  | 'private_thread'
  | 'dm'
  | 'group_dm';

export type ForumMode = 'posts' | 'tickets';

export type IChannel = typeof schema.channels.$inferSelect;

export const Channel = {
  table: schema.channels,

  async findById(id: string) {
    const [row] = await db.select().from(schema.channels).where(eq(schema.channels.id, normalizeId(id))).limit(1);
    return row || null;
  },

  async findOne(filter: Record<string, unknown>) {
    const conditions: SQL[] = [];
    for (const [key, value] of Object.entries(filter)) {
      if (value === undefined || value === null) continue;
      switch (key) {
        case 'id': conditions.push(buildCondition(schema.channels.id, value, true)); break;
        case 'serverId': conditions.push(buildCondition(schema.channels.serverId, value, true)); break;
        case 'type': conditions.push(buildCondition(schema.channels.type, value, false)); break;
        case 'parentId': conditions.push(buildCondition(schema.channels.parentId, value, true)); break;
        case 'lastMessageId': conditions.push(buildCondition(schema.channels.lastMessageId, value, true)); break;
        case 'recipientId': conditions.push(sql`${schema.channels.recipientIds} @> ARRAY[${normalizeId(value as string)}]::uuid[]`); break;
        case 'recipientIds': {
          // Match channels whose recipient set contains ALL given ids (used to
          // locate the DM between specific users). Combined with type:'dm' this
          // uniquely identifies the 1:1 DM.
          const ids = (value as string[]).map((v) => normalizeId(v));
          conditions.push(sql`${schema.channels.recipientIds} @> ARRAY[${sql.join(ids.map((i) => sql`${i}`), sql`, `)}]::uuid[]`);
          break;
        }
      }
    }
    let query = db.select().from(schema.channels);
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
        case 'serverId': conditions.push(buildCondition(schema.channels.serverId, value, true)); break;
        case 'type': conditions.push(buildCondition(schema.channels.type, value, false)); break;
        case 'parentId': conditions.push(buildCondition(schema.channels.parentId, value, true)); break;
        case 'ownerId': conditions.push(buildCondition(schema.channels.ownerId, value, true)); break;
        case 'id': conditions.push(buildCondition(schema.channels.id, value, true)); break;
        case 'recipientId': conditions.push(sql`${schema.channels.recipientIds} @> ARRAY[${normalizeId(value as string)}]::uuid[]`); break;
        case 'recipientIds': {
          // Match channels whose recipient set contains ALL given ids (used to
          // locate the DM between specific users). Combined with type:'dm' this
          // uniquely identifies the 1:1 DM.
          const ids = (value as string[]).map((v) => normalizeId(v));
          conditions.push(sql`${schema.channels.recipientIds} @> ARRAY[${sql.join(ids.map((i) => sql`${i}`), sql`, `)}]::uuid[]`);
          break;
        }
      }
    }
    let query = db.select().from(schema.channels);
    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as typeof query;
    }
    return query;
  },

  async create(data: typeof schema.channels.$inferInsert) {
    const [row] = await db.insert(schema.channels).values(data).returning();
    return row;
  },

  async updateById(id: string, data: Partial<typeof schema.channels.$inferInsert>) {
    const [row] = await db.update(schema.channels).set({ ...data, updatedAt: new Date() }).where(eq(schema.channels.id, normalizeId(id))).returning();
    return row || null;
  },

  async deleteById(id: string) {
    await db.delete(schema.channels).where(eq(schema.channels.id, normalizeId(id)));
  },

  async count() {
    const result = await db.select({ count: sql<number>`count(*)::int` }).from(schema.channels);
    return result[0]?.count ?? 0;
  },
};

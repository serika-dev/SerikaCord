import { eq, and, type SQL } from 'drizzle-orm';
import { normalizeId } from '../db/normalizeId';
import { db, schema } from '../db/postgres';

export type IServerMemberApplication = typeof schema.serverMemberApplications.$inferSelect;

export const ServerMemberApplication = {
  table: schema.serverMemberApplications,

  async findById(id: string) {
    const [row] = await db.select().from(schema.serverMemberApplications).where(eq(schema.serverMemberApplications.id, normalizeId(id))).limit(1);
    return row || null;
  },

  async findOne(filter: Record<string, unknown>) {
    const conditions: SQL[] = [];
    for (const [key, value] of Object.entries(filter)) {
      if (value === undefined || value === null) continue;
      switch (key) {
        case 'id': conditions.push(eq(schema.serverMemberApplications.id, normalizeId(value as string))); break;
        case 'serverId': conditions.push(eq(schema.serverMemberApplications.serverId, normalizeId(value as string))); break;
        case 'userId': conditions.push(eq(schema.serverMemberApplications.userId, normalizeId(value as string))); break;
        case 'status': conditions.push(eq(schema.serverMemberApplications.status, value as typeof schema.serverMemberApplications.status.enumValues[number])); break;
      }
    }
    let query = db.select().from(schema.serverMemberApplications);
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
        case 'id': conditions.push(eq(schema.serverMemberApplications.id, normalizeId(value as string))); break;
        case 'serverId': conditions.push(eq(schema.serverMemberApplications.serverId, normalizeId(value as string))); break;
        case 'userId': conditions.push(eq(schema.serverMemberApplications.userId, normalizeId(value as string))); break;
        case 'status': conditions.push(eq(schema.serverMemberApplications.status, value as typeof schema.serverMemberApplications.status.enumValues[number])); break;
      }
    }
    let query = db.select().from(schema.serverMemberApplications);
    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as typeof query;
    }
    return query;
  },

  async create(data: typeof schema.serverMemberApplications.$inferInsert) {
    const [row] = await db.insert(schema.serverMemberApplications).values(data).returning();
    return row;
  },

  async updateById(id: string, data: Partial<typeof schema.serverMemberApplications.$inferInsert>) {
    const [row] = await db.update(schema.serverMemberApplications).set({ ...data, updatedAt: new Date() }).where(eq(schema.serverMemberApplications.id, normalizeId(id))).returning();
    return row || null;
  },

  async deleteById(id: string) {
    await db.delete(schema.serverMemberApplications).where(eq(schema.serverMemberApplications.id, normalizeId(id)));
  },
};

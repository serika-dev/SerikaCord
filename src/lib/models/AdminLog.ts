import { eq, and, type SQL } from 'drizzle-orm';
import { normalizeId } from '../db/normalizeId';
import { db, schema } from '../db/postgres';

export type AdminActionType = typeof schema.adminLogs.$inferSelect['action'];
export type IAdminLog = typeof schema.adminLogs.$inferSelect;

export const AdminLog = {
  table: schema.adminLogs,

  async findById(id: string) {
    const [row] = await db.select().from(schema.adminLogs).where(eq(schema.adminLogs.id, normalizeId(id))).limit(1);
    return row || null;
  },

  async findOne(filter: Record<string, unknown>) {
    const conditions: SQL[] = [];
    for (const [key, value] of Object.entries(filter)) {
      if (value === undefined || value === null) continue;
      switch (key) {
        case 'adminId': conditions.push(eq(schema.adminLogs.adminId, normalizeId(value as string))); break;
        case 'action': conditions.push(eq(schema.adminLogs.action, value as typeof schema.adminLogs.action.enumValues[number])); break;
        case 'targetId': conditions.push(eq(schema.adminLogs.targetId, normalizeId(value as string))); break;
        case 'targetType': conditions.push(eq(schema.adminLogs.targetType, value as typeof schema.adminLogs.targetType.enumValues[number])); break;
      }
    }
    let query = db.select().from(schema.adminLogs);
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
        case 'adminId': conditions.push(eq(schema.adminLogs.adminId, normalizeId(value as string))); break;
        case 'action': conditions.push(eq(schema.adminLogs.action, value as typeof schema.adminLogs.action.enumValues[number])); break;
        case 'targetId': conditions.push(eq(schema.adminLogs.targetId, normalizeId(value as string))); break;
        case 'targetType': conditions.push(eq(schema.adminLogs.targetType, value as typeof schema.adminLogs.targetType.enumValues[number])); break;
      }
    }
    let query = db.select().from(schema.adminLogs);
    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as typeof query;
    }
    return query;
  },

  async create(data: typeof schema.adminLogs.$inferInsert) {
    const [row] = await db.insert(schema.adminLogs).values(data).returning();
    return row;
  },

  async updateById(id: string, data: Partial<typeof schema.adminLogs.$inferInsert>) {
    const [row] = await db.update(schema.adminLogs).set(data).where(eq(schema.adminLogs.id, normalizeId(id))).returning();
    return row || null;
  },

  async deleteById(id: string) {
    await db.delete(schema.adminLogs).where(eq(schema.adminLogs.id, normalizeId(id)));
  },
};

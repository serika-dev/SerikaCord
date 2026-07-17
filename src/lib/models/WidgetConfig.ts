import { eq, and, type SQL } from 'drizzle-orm';
import { normalizeId } from '../db/normalizeId';
import { db, schema } from '../db/postgres';

export type IWidgetConfig = typeof schema.widgetConfigs.$inferSelect;

function buildConditions(filter: Record<string, unknown>): SQL[] {
  const conditions: SQL[] = [];
  for (const [key, value] of Object.entries(filter)) {
    if (value === undefined || value === null) continue;
    switch (key) {
      case 'id': conditions.push(eq(schema.widgetConfigs.id, normalizeId(value as string))); break;
      case 'applicationId': conditions.push(eq(schema.widgetConfigs.applicationId, normalizeId(value as string))); break;
      case 'status': conditions.push(eq(schema.widgetConfigs.status, value as string)); break;
    }
  }
  return conditions;
}

export const WidgetConfig = {
  table: schema.widgetConfigs,

  async findOne(filter: Record<string, unknown>) {
    const conditions = buildConditions(filter);
    let query = db.select().from(schema.widgetConfigs);
    if (conditions.length > 0) query = query.where(and(...conditions)) as typeof query;
    const [row] = await query.limit(1);
    return row || null;
  },

  async findByApplication(applicationId: string) {
    return this.findOne({ applicationId });
  },

  async create(data: typeof schema.widgetConfigs.$inferInsert) {
    const [row] = await db.insert(schema.widgetConfigs).values(data).returning();
    return row;
  },

  async updateByApplication(applicationId: string, data: Partial<typeof schema.widgetConfigs.$inferInsert>) {
    const [row] = await db.update(schema.widgetConfigs)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(schema.widgetConfigs.applicationId, normalizeId(applicationId)))
      .returning();
    return row || null;
  },

  /** Insert or update the single config row for an application. */
  async upsert(applicationId: string, data: Partial<typeof schema.widgetConfigs.$inferInsert>) {
    const existing = await this.findByApplication(applicationId);
    if (existing) return this.updateByApplication(applicationId, data);
    return this.create({ applicationId: normalizeId(applicationId), name: data.name || 'Widget', ...data });
  },

  async deleteByApplication(applicationId: string) {
    await db.delete(schema.widgetConfigs).where(eq(schema.widgetConfigs.applicationId, normalizeId(applicationId)));
  },
};

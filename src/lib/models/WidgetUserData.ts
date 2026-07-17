import { eq, and, type SQL } from 'drizzle-orm';
import { normalizeId } from '../db/normalizeId';
import { db, schema } from '../db/postgres';

export type IWidgetUserData = typeof schema.widgetUserData.$inferSelect;

function buildConditions(filter: Record<string, unknown>): SQL[] {
  const conditions: SQL[] = [];
  for (const [key, value] of Object.entries(filter)) {
    if (value === undefined || value === null) continue;
    switch (key) {
      case 'applicationId': conditions.push(eq(schema.widgetUserData.applicationId, normalizeId(value as string))); break;
      case 'userId': conditions.push(eq(schema.widgetUserData.userId, normalizeId(value as string))); break;
    }
  }
  return conditions;
}

export const WidgetUserData = {
  table: schema.widgetUserData,

  async findOne(filter: Record<string, unknown>) {
    const conditions = buildConditions(filter);
    let query = db.select().from(schema.widgetUserData);
    if (conditions.length > 0) query = query.where(and(...conditions)) as typeof query;
    const [row] = await query.limit(1);
    return row || null;
  },

  /** Insert or replace this user's dynamic data for an application's widget. */
  async upsert(applicationId: string, userId: string, data: unknown) {
    const appId = normalizeId(applicationId);
    const uid = normalizeId(userId);
    const existing = await this.findOne({ applicationId: appId, userId: uid });
    if (existing) {
      const [row] = await db.update(schema.widgetUserData)
        .set({ data: data as object, updatedAt: new Date() })
        .where(and(eq(schema.widgetUserData.applicationId, appId), eq(schema.widgetUserData.userId, uid)))
        .returning();
      return row || null;
    }
    const [row] = await db.insert(schema.widgetUserData)
      .values({ applicationId: appId, userId: uid, data: data as object })
      .returning();
    return row;
  },

  async delete(applicationId: string, userId: string) {
    await db.delete(schema.widgetUserData).where(and(
      eq(schema.widgetUserData.applicationId, normalizeId(applicationId)),
      eq(schema.widgetUserData.userId, normalizeId(userId)),
    ));
  },
};

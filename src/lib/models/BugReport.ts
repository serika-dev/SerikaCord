import { eq, and, desc, sql, type SQL } from 'drizzle-orm';
import { normalizeId } from '../db/normalizeId';
import { db, schema } from '../db/postgres';

export type BugReportKind = 'bug' | 'feedback';
export type BugReportPriority = 'low' | 'medium' | 'high' | 'critical';
export type BugReportStatus = 'open' | 'acknowledged' | 'resolved' | 'wont_fix';
export type BugReportCategory =
  | 'crash' | 'visual' | 'functionality' | 'performance' | 'security'
  | 'audio' | 'network' | 'ui_ux' | 'other'
  | 'feature_request' | 'improvement' | 'praise' | 'general';

export type IBugReport = typeof schema.bugReports.$inferSelect;

export const BugReport = {
  table: schema.bugReports,

  async findById(id: string) {
    const [row] = await db.select().from(schema.bugReports).where(eq(schema.bugReports.id, normalizeId(id))).limit(1);
    return row || null;
  },

  async findOne(filter: Record<string, unknown>) {
    const conditions: SQL[] = [];
    for (const [key, value] of Object.entries(filter)) {
      if (value === undefined || value === null) continue;
      switch (key) {
        case 'id': conditions.push(eq(schema.bugReports.id, normalizeId(value as string))); break;
        case 'reporterId': conditions.push(eq(schema.bugReports.reporterId, normalizeId(value as string))); break;
        case 'kind': conditions.push(eq(schema.bugReports.kind, value as BugReportKind)); break;
        case 'status': conditions.push(eq(schema.bugReports.status, value as BugReportStatus)); break;
        case 'priority': conditions.push(eq(schema.bugReports.priority, value as BugReportPriority)); break;
        case 'category': conditions.push(eq(schema.bugReports.category, value as BugReportCategory)); break;
      }
    }
    let query = db.select().from(schema.bugReports);
    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as typeof query;
    }
    const [row] = await query.limit(1);
    return row || null;
  },

  async find(filter: Record<string, unknown> = {}) {
    const conditions: SQL[] = [];
    let limit: number | undefined;
    let orderByPriority = false;
    for (const [key, value] of Object.entries(filter)) {
      if (value === undefined || value === null) continue;
      switch (key) {
        case 'id': conditions.push(eq(schema.bugReports.id, normalizeId(value as string))); break;
        case 'reporterId': conditions.push(eq(schema.bugReports.reporterId, normalizeId(value as string))); break;
        case 'kind': conditions.push(eq(schema.bugReports.kind, value as BugReportKind)); break;
        case 'status': conditions.push(eq(schema.bugReports.status, value as BugReportStatus)); break;
        case 'priority': conditions.push(eq(schema.bugReports.priority, value as BugReportPriority)); break;
        case 'category': conditions.push(eq(schema.bugReports.category, value as BugReportCategory)); break;
        case '_limit': limit = value as number; break;
        case '_orderByPriority': orderByPriority = true; break;
      }
    }
    let query = db.select().from(schema.bugReports);
    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as typeof query;
    }
    query = query.orderBy(orderByPriority ? desc(schema.bugReports.priority) : desc(schema.bugReports.createdAt)) as typeof query;
    if (limit) {
      query = query.limit(limit) as typeof query;
    }
    return query;
  },

  async create(data: typeof schema.bugReports.$inferInsert) {
    const [row] = await db.insert(schema.bugReports).values(data).returning();
    return row;
  },

  async updateById(id: string, data: Partial<typeof schema.bugReports.$inferInsert>) {
    const [row] = await db.update(schema.bugReports).set({ ...data, updatedAt: new Date() }).where(eq(schema.bugReports.id, normalizeId(id))).returning();
    return row || null;
  },

  async deleteById(id: string) {
    await db.delete(schema.bugReports).where(eq(schema.bugReports.id, normalizeId(id)));
  },

  async count() {
    const result = await db.select({ count: sql<number>`count(*)::int` }).from(schema.bugReports);
    return result[0]?.count ?? 0;
  },
};

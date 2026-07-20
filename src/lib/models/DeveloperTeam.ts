import { eq, and, type SQL } from 'drizzle-orm';
import { normalizeId } from '../db/normalizeId';
import { db, schema } from '../db/postgres';

export type IDeveloperTeam = typeof schema.developerTeams.$inferSelect;

export interface ITeamMember {
  userId: string;
  username: string;
  role: string;
  addedAt?: string;
}

export const DeveloperTeam = {
  table: schema.developerTeams,

  async findById(id: string) {
    const [row] = await db.select().from(schema.developerTeams).where(eq(schema.developerTeams.id, normalizeId(id))).limit(1);
    return row || null;
  },

  async findOne(filter: Record<string, unknown>) {
    const conditions: SQL[] = [];
    for (const [key, value] of Object.entries(filter)) {
      if (value === undefined || value === null) continue;
      switch (key) {
        case 'ownerId': conditions.push(eq(schema.developerTeams.ownerId, normalizeId(value as string))); break;
      }
    }
    let query = db.select().from(schema.developerTeams);
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
        case 'ownerId': conditions.push(eq(schema.developerTeams.ownerId, normalizeId(value as string))); break;
      }
    }
    let query = db.select().from(schema.developerTeams);
    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as typeof query;
    }
    return query;
  },

  async create(data: typeof schema.developerTeams.$inferInsert) {
    const [row] = await db.insert(schema.developerTeams).values(data).returning();
    return row;
  },

  async updateById(id: string, data: Partial<typeof schema.developerTeams.$inferInsert>) {
    const [row] = await db.update(schema.developerTeams).set({ ...data, updatedAt: new Date() }).where(eq(schema.developerTeams.id, normalizeId(id))).returning();
    return row || null;
  },

  async deleteById(id: string) {
    await db.delete(schema.developerTeams).where(eq(schema.developerTeams.id, normalizeId(id)));
  },
};

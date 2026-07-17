import { eq, and, asc, type SQL } from 'drizzle-orm';
import { normalizeId } from '../db/normalizeId';
import { db, schema } from '../db/postgres';

export type IUserGame = typeof schema.userGames.$inferSelect;
export type UserGameCategory = 'favorite' | 'liked' | 'rotation' | 'wishlist';

/** Max entries per category (enforced here, not in the DB). */
export const USER_GAME_LIMITS: Record<UserGameCategory, number> = {
  favorite: 1,
  liked: 20,
  rotation: 5,
  wishlist: 20,
};

function buildConditions(filter: Record<string, unknown>): SQL[] {
  const conditions: SQL[] = [];
  for (const [key, value] of Object.entries(filter)) {
    if (value === undefined || value === null) continue;
    switch (key) {
      case 'id': conditions.push(eq(schema.userGames.id, normalizeId(value as string))); break;
      case 'userId': conditions.push(eq(schema.userGames.userId, normalizeId(value as string))); break;
      case 'category': conditions.push(eq(schema.userGames.category, value as string)); break;
      case 'igdbId': conditions.push(eq(schema.userGames.igdbId, value as number)); break;
    }
  }
  return conditions;
}

export const UserGame = {
  table: schema.userGames,

  async find(filter: Record<string, unknown> = {}) {
    const conditions = buildConditions(filter);
    let query = db.select().from(schema.userGames);
    if (conditions.length > 0) query = query.where(and(...conditions)) as typeof query;
    return query.orderBy(asc(schema.userGames.category), asc(schema.userGames.position));
  },

  async findOne(filter: Record<string, unknown>) {
    const conditions = buildConditions(filter);
    let query = db.select().from(schema.userGames);
    if (conditions.length > 0) query = query.where(and(...conditions)) as typeof query;
    const [row] = await query.limit(1);
    return row || null;
  },

  async count(filter: Record<string, unknown>): Promise<number> {
    const rows = await this.find(filter);
    return rows.length;
  },

  async create(data: typeof schema.userGames.$inferInsert) {
    const [row] = await db.insert(schema.userGames).values(data).returning();
    return row;
  },

  async updateById(id: string, data: Partial<typeof schema.userGames.$inferInsert>) {
    const [row] = await db.update(schema.userGames)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(schema.userGames.id, normalizeId(id)))
      .returning();
    return row || null;
  },

  async deleteById(id: string) {
    await db.delete(schema.userGames).where(eq(schema.userGames.id, normalizeId(id)));
  },

  async deleteWhere(filter: Record<string, unknown>) {
    const conditions = buildConditions(filter);
    if (conditions.length === 0) return;
    await db.delete(schema.userGames).where(and(...conditions));
  },
};

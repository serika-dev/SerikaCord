import { eq, asc, desc, sql } from 'drizzle-orm';
import { db, schema } from '../db/postgres';

export type IBadge = typeof schema.badges.$inferSelect;
export type IBadgeInsert = typeof schema.badges.$inferInsert;

// Badge ids are slugs (not UUIDs), so no normalizeId here. Read paths should
// go through the cached registry (src/lib/services/badgeRegistry.ts); this
// model is the raw DB access it and the admin routes use.
export const Badge = {
  table: schema.badges,

  async list(): Promise<IBadge[]> {
    return db
      .select()
      .from(schema.badges)
      .orderBy(desc(schema.badges.priority), asc(schema.badges.name));
  },

  async findById(id: string): Promise<IBadge | null> {
    const [row] = await db.select().from(schema.badges).where(eq(schema.badges.id, id)).limit(1);
    return row || null;
  },

  /** Insert a badge; returns null if the id is already taken. */
  async create(data: IBadgeInsert): Promise<IBadge | null> {
    const [row] = await db
      .insert(schema.badges)
      .values(data)
      .onConflictDoNothing({ target: schema.badges.id })
      .returning();
    return row || null;
  },

  async updateById(id: string, data: Partial<Omit<IBadgeInsert, 'id' | 'createdAt'>>): Promise<IBadge | null> {
    const [row] = await db
      .update(schema.badges)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(schema.badges.id, id))
      .returning();
    return row || null;
  },

  /** Returns true if a row was deleted. */
  async deleteById(id: string): Promise<boolean> {
    const rows = await db.delete(schema.badges).where(eq(schema.badges.id, id)).returning({ id: schema.badges.id });
    return rows.length > 0;
  },

  /**
   * Strip a badge id from every user that holds it (single UPDATE). Returns the
   * affected user ids so callers can drop their cached user records.
   */
  async removeFromAllUsers(id: string): Promise<string[]> {
    const rows = await db
      .update(schema.users)
      .set({ badges: sql`array_remove(${schema.users.badges}, ${id})` })
      .where(sql`${id} = ANY(${schema.users.badges})`)
      .returning({ id: schema.users.id });
    return rows.map((r) => r.id);
  },

  /** How many users hold each badge id (admin panel only — scans users). */
  async holderCounts(): Promise<Record<string, number>> {
    const rows = await db.execute<{ id: string; count: number }>(
      sql`SELECT b AS id, count(*)::int AS count FROM ${schema.users}, unnest(${schema.users.badges}) AS b GROUP BY b`,
    );
    const out: Record<string, number> = {};
    for (const r of rows.rows) out[r.id] = Number(r.count) || 0;
    return out;
  },
};

import { eq, and, inArray, type SQL } from 'drizzle-orm';
import { normalizeId } from '../db/normalizeId';
import { db, schema } from '../db/postgres';

export type IDiscordUser = typeof schema.discordUsers.$inferSelect;

export const DiscordUser = {
  table: schema.discordUsers,

  async findById(id: string) {
    const [row] = await db.select().from(schema.discordUsers).where(eq(schema.discordUsers.id, normalizeId(id))).limit(1);
    return row || null;
  },

  async findByDiscordId(discordId: string) {
    const [row] = await db.select().from(schema.discordUsers).where(eq(schema.discordUsers.discordId, discordId)).limit(1);
    return row || null;
  },

  /** Find all Discord users with a specific consent status (e.g. 'denied' for startup restriction sweep). */
  async findAllByConsent(status: 'pending' | 'granted' | 'denied') {
    return db.select().from(schema.discordUsers).where(eq(schema.discordUsers.consentStatus, status));
  },

  async findOne(filter: Record<string, unknown>) {
    const conditions: SQL[] = [];
    for (const [key, value] of Object.entries(filter)) {
      if (value === undefined || value === null) continue;
      switch (key) {
        case 'id': conditions.push(eq(schema.discordUsers.id, normalizeId(value as string))); break;
        case 'discordId': conditions.push(eq(schema.discordUsers.discordId, value as string)); break;
      }
    }
    let query = db.select().from(schema.discordUsers);
    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as typeof query;
    }
    const [row] = await query.limit(1);
    return row || null;
  },

  async findMany(ids: string[]) {
    if (ids.length === 0) return [];
    const rows = await db.select().from(schema.discordUsers).where(inArray(schema.discordUsers.id, ids.map(normalizeId)));
    return rows;
  },

  async create(data: typeof schema.discordUsers.$inferInsert) {
    const [row] = await db.insert(schema.discordUsers).values(data).returning();
    return row;
  },

  async updateById(id: string, data: Partial<typeof schema.discordUsers.$inferInsert>) {
    const [row] = await db.update(schema.discordUsers).set({ ...data, updatedAt: new Date() }).where(eq(schema.discordUsers.id, normalizeId(id))).returning();
    return row || null;
  },

  /** Record a consent decision for a Discord user (creates the row if needed). */
  async setConsent(discordId: string, status: 'pending' | 'granted' | 'denied', extra?: Partial<typeof schema.discordUsers.$inferInsert>) {
    return DiscordUser.upsertByDiscordId(discordId, {
      consentStatus: status,
      consentUpdatedAt: new Date(),
      ...(extra || {}),
    });
  },

  async upsertByDiscordId(discordId: string, data: Partial<typeof schema.discordUsers.$inferInsert>) {
    const existing = await DiscordUser.findByDiscordId(discordId);
    if (existing) {
      const updated = await DiscordUser.updateById(existing.id, data);
      return updated || existing;
    }
    return DiscordUser.create({
      discordId,
      ...data,
    } as typeof schema.discordUsers.$inferInsert);
  },
};

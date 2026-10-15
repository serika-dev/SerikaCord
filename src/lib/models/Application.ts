import { eq, and, inArray, type SQL } from 'drizzle-orm';
import { normalizeId } from '../db/normalizeId';
import { db, schema } from '../db/postgres';
import { decryptRow, decryptRows, encryptRow, fieldLookupCandidates, type FieldSpec } from '../security/fieldEncryption';

export type IApplication = typeof schema.applications.$inferSelect;

/**
 * Secrets encrypted at rest. The bot token is encrypted deterministically so
 * `findOne({ botToken })` can still match it (against its ciphertext or a
 * legacy plaintext row). Rows come back from this model decrypted.
 */
const FIELDS: FieldSpec = { lookup: ['botToken'], text: ['clientSecret', 'privateKeyPem'] };

export const Application = {
  table: schema.applications,

  async findById(id: string) {
    const [row] = await db.select().from(schema.applications).where(eq(schema.applications.id, normalizeId(id))).limit(1);
    return decryptRow(FIELDS, row || null);
  },

  async findOne(filter: Record<string, unknown>) {
    const conditions: SQL[] = [];
    for (const [key, value] of Object.entries(filter)) {
      if (value === undefined || value === null) continue;
      switch (key) {
        case 'id': conditions.push(eq(schema.applications.id, normalizeId(value as string))); break;
        case 'ownerId': conditions.push(eq(schema.applications.ownerId, normalizeId(value as string))); break;
        case 'teamId': conditions.push(eq(schema.applications.teamId, normalizeId(value as string))); break;
        case 'clientId': conditions.push(eq(schema.applications.clientId, normalizeId(value as string))); break;
        case 'botId': conditions.push(eq(schema.applications.botId, normalizeId(value as string))); break;
        case 'botToken': conditions.push(inArray(schema.applications.botToken, await fieldLookupCandidates(String(value)))); break;
      }
    }
    let query = db.select().from(schema.applications);
    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as typeof query;
    }
    const [row] = await query.limit(1);
    return decryptRow(FIELDS, row || null);
  },

  async find(filter: Record<string, unknown> = {}) {
    const conditions: SQL[] = [];
    for (const [key, value] of Object.entries(filter)) {
      if (value === undefined || value === null) continue;
      switch (key) {
        case 'ownerId': conditions.push(eq(schema.applications.ownerId, normalizeId(value as string))); break;
        case 'teamId': conditions.push(eq(schema.applications.teamId, normalizeId(value as string))); break;
      }
    }
    let query = db.select().from(schema.applications);
    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as typeof query;
    }
    return decryptRows(FIELDS, await query);
  },

  async create(data: typeof schema.applications.$inferInsert) {
    const [row] = await db.insert(schema.applications).values(await encryptRow(FIELDS, data)).returning();
    return decryptRow(FIELDS, row);
  },

  async updateById(id: string, data: Partial<typeof schema.applications.$inferInsert>) {
    const [row] = await db.update(schema.applications).set({ ...(await encryptRow(FIELDS, data)), updatedAt: new Date() }).where(eq(schema.applications.id, normalizeId(id))).returning();
    return decryptRow(FIELDS, row || null);
  },

  async deleteById(id: string) {
    await db.delete(schema.applications).where(eq(schema.applications.id, normalizeId(id)));
  },
};

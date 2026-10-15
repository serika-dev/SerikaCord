import { eq, and, inArray, type SQL } from 'drizzle-orm';
import { normalizeId, buildCondition } from '../db/normalizeId';
import { db, schema } from '../db/postgres';
import { decryptRow, decryptRows, encryptRow, fieldLookupCandidates, type FieldSpec } from '../security/fieldEncryption';

export type IChannelWebhook = typeof schema.channelWebhooks.$inferSelect;

/**
 * The execute token is encrypted at rest (deterministically, so the execute
 * route can still look it up), and so is `url`, which embeds the token. Rows
 * come back from this model decrypted; legacy plaintext rows still match.
 */
const FIELDS: FieldSpec = { lookup: ['token'], text: ['url'] };

export const ChannelWebhook = {
  table: schema.channelWebhooks,

  async findById(id: string) {
    const [row] = await db.select().from(schema.channelWebhooks).where(eq(schema.channelWebhooks.id, normalizeId(id))).limit(1);
    return decryptRow(FIELDS, row || null);
  },

  async findOne(filter: Record<string, unknown>) {
    const conditions: SQL[] = [];
    for (const [key, value] of Object.entries(filter)) {
      if (value === undefined || value === null) continue;
      switch (key) {
        case 'id': conditions.push(buildCondition(schema.channelWebhooks.id, value, true)); break;
        case 'channelId': conditions.push(eq(schema.channelWebhooks.channelId, normalizeId(value as string))); break;
        case 'serverId': conditions.push(eq(schema.channelWebhooks.serverId, normalizeId(value as string))); break;
        case 'token': conditions.push(inArray(schema.channelWebhooks.token, await fieldLookupCandidates(String(value)))); break;
        // An unknown key must never widen the match (it used to be dropped,
        // which turned a token lookup into "first webhook in the channel").
        default: throw new Error(`ChannelWebhook: unsupported filter key "${key}"`);
      }
    }
    let query = db.select().from(schema.channelWebhooks);
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
        case 'id': conditions.push(buildCondition(schema.channelWebhooks.id, value, true)); break;
        case 'channelId': conditions.push(eq(schema.channelWebhooks.channelId, normalizeId(value as string))); break;
        case 'serverId': conditions.push(eq(schema.channelWebhooks.serverId, normalizeId(value as string))); break;
        case 'token': conditions.push(inArray(schema.channelWebhooks.token, await fieldLookupCandidates(String(value)))); break;
        // An unknown key must never widen the match (it used to be dropped,
        // which turned a token lookup into "first webhook in the channel").
        default: throw new Error(`ChannelWebhook: unsupported filter key "${key}"`);
      }
    }
    let query = db.select().from(schema.channelWebhooks);
    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as typeof query;
    }
    return decryptRows(FIELDS, await query);
  },

  async create(data: typeof schema.channelWebhooks.$inferInsert) {
    const [row] = await db.insert(schema.channelWebhooks).values(await encryptRow(FIELDS, data)).returning();
    return decryptRow(FIELDS, row);
  },

  async updateById(id: string, data: Partial<typeof schema.channelWebhooks.$inferInsert>) {
    const [row] = await db.update(schema.channelWebhooks).set({ ...(await encryptRow(FIELDS, data)), updatedAt: new Date() }).where(eq(schema.channelWebhooks.id, normalizeId(id))).returning();
    return decryptRow(FIELDS, row || null);
  },

  async deleteById(id: string) {
    await db.delete(schema.channelWebhooks).where(eq(schema.channelWebhooks.id, normalizeId(id)));
  },
};

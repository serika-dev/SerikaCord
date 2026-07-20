import { eq, sql, and, type SQL } from 'drizzle-orm';
import { normalizeId, buildCondition } from '../db/normalizeId';
import { db, schema } from '../db/postgres';

export type IServer = typeof schema.servers.$inferSelect;

export interface IServerSettings {
  widget?: { enabled: boolean; channelId: string | null };
  moderation?: {
    verificationLevel?: string;
    explicitContentFilter?: string;
    require2FA?: boolean;
  };
  safety?: {
    raidProtection?: boolean;
    antiSpam?: boolean;
    mentionSpamLimit?: number;
  };
  integrations?: Record<string, unknown> & {
    discord?: boolean;
    twitch?: boolean;
    youtube?: boolean;
    webhooks?: boolean;
    discordGuildId?: string;
    discordMode?: string;
    discordChannelsMap?: Record<string, string>;
    discordBridgeOutbound?: boolean;
    twitchChannel?: string;
    twitchNotificationChannelId?: string;
    youtubeChannel?: string;
    youtubeNotificationChannelId?: string;
  };
  soundboard?: { enabled: boolean; volume: number };
  access?: { joinMode?: string };
  invites?: { lockToVanity?: boolean };
}

export const Server = {
  table: schema.servers,

  async findById(id: string) {
    const [row] = await db.select().from(schema.servers).where(eq(schema.servers.id, normalizeId(id))).limit(1);
    return row || null;
  },

  async findOne(filter: Record<string, unknown>) {
    const conditions: SQL[] = [];
    for (const [key, value] of Object.entries(filter)) {
      if (value === undefined || value === null) continue;
      switch (key) {
        case 'id': conditions.push(buildCondition(schema.servers.id, value, true)); break;
        case 'ownerId': conditions.push(buildCondition(schema.servers.ownerId, value, true)); break;
        case 'vanityUrlCode': conditions.push(eq(schema.servers.vanityUrlCode, value as string)); break;
        case 'joinMode': conditions.push(eq(schema.servers.joinMode, value as string)); break;
        case 'isPartnered': conditions.push(eq(schema.servers.isPartnered, value as boolean)); break;
        case 'isDiscoverable': conditions.push(eq(schema.servers.isDiscoverable, value as boolean)); break;
        case 'discoveryCategories': conditions.push(sql`COALESCE(${schema.servers.discoveryCategories}, ARRAY[]::text[]) @> ARRAY[${value}]::text[]`); break;
      }
    }
    let query = db.select().from(schema.servers);
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
        case 'id': conditions.push(buildCondition(schema.servers.id, value, true)); break;
        case 'ownerId': conditions.push(buildCondition(schema.servers.ownerId, value, true)); break;
        case 'vanityUrlCode': conditions.push(eq(schema.servers.vanityUrlCode, value as string)); break;
        case 'joinMode': conditions.push(eq(schema.servers.joinMode, value as string)); break;
        case 'isPartnered': conditions.push(eq(schema.servers.isPartnered, value as boolean)); break;
        case 'isDiscoverable': conditions.push(eq(schema.servers.isDiscoverable, value as boolean)); break;
        case 'discoveryCategories': conditions.push(sql`COALESCE(${schema.servers.discoveryCategories}, ARRAY[]::text[]) @> ARRAY[${value}]::text[]`); break;
      }
    }
    let query = db.select().from(schema.servers);
    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as typeof query;
    }
    return query;
  },

  async create(data: typeof schema.servers.$inferInsert) {
    const [row] = await db.insert(schema.servers).values(data).returning();
    return row;
  },

  async updateById(id: string, data: Partial<typeof schema.servers.$inferInsert>) {
    const [row] = await db.update(schema.servers).set({ ...data, updatedAt: new Date() }).where(eq(schema.servers.id, normalizeId(id))).returning();
    return row || null;
  },

  async deleteById(id: string) {
    await db.delete(schema.servers).where(eq(schema.servers.id, normalizeId(id)));
  },

  async count() {
    const result = await db.select({ count: sql<number>`count(*)::int` }).from(schema.servers);
    return result[0]?.count ?? 0;
  },
};

import { eq, and, type SQL } from 'drizzle-orm';
import { normalizeId } from '../db/normalizeId';
import { db, schema } from '../db/postgres';
import crypto from 'crypto';

export type InstanceType = 'host' | 'self_hosted';
export type InstanceStatus = 'active' | 'suspended' | 'pending' | 'offline';

export const HOST_DOMAINS = ['serika.chat', 'waifu.ws', 'serika.dev'];

export type IInstance = typeof schema.instances.$inferSelect;

export const Instance = {
  table: schema.instances,

  async findById(id: string) {
    const [row] = await db.select().from(schema.instances).where(eq(schema.instances.id, normalizeId(id))).limit(1);
    return row || null;
  },

  async findOne(filter: Record<string, unknown>) {
    const conditions: SQL[] = [];
    for (const [key, value] of Object.entries(filter)) {
      if (value === undefined || value === null) continue;
      switch (key) {
        case 'domain': conditions.push(eq(schema.instances.domain, value as string)); break;
        case 'instanceId': conditions.push(eq(schema.instances.instanceId, normalizeId(value as string))); break;
        case 'apiKeyPrefix': conditions.push(eq(schema.instances.apiKeyPrefix, value as string)); break;
        case 'type': conditions.push(eq(schema.instances.type, value as typeof schema.instances.type.enumValues[number])); break;
        case 'status': conditions.push(eq(schema.instances.status, value as typeof schema.instances.status.enumValues[number])); break;
      }
    }
    let query = db.select().from(schema.instances);
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
        case 'domain': conditions.push(eq(schema.instances.domain, value as string)); break;
        case 'instanceId': conditions.push(eq(schema.instances.instanceId, normalizeId(value as string))); break;
        case 'apiKeyPrefix': conditions.push(eq(schema.instances.apiKeyPrefix, value as string)); break;
        case 'type': conditions.push(eq(schema.instances.type, value as typeof schema.instances.type.enumValues[number])); break;
        case 'status': conditions.push(eq(schema.instances.status, value as typeof schema.instances.status.enumValues[number])); break;
      }
    }
    let query = db.select().from(schema.instances);
    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as typeof query;
    }
    return query;
  },

  async create(data: typeof schema.instances.$inferInsert) {
    const [row] = await db.insert(schema.instances).values(data).returning();
    return row;
  },

  async updateById(id: string, data: Partial<typeof schema.instances.$inferInsert>) {
    const [row] = await db.update(schema.instances).set({ ...data, updatedAt: new Date() }).where(eq(schema.instances.id, normalizeId(id))).returning();
    return row || null;
  },
};

export function isHostDomain(domain: string): boolean {
  const normalizedDomain = domain.toLowerCase().replace(/^www\./, '');
  return HOST_DOMAINS.some(host =>
    normalizedDomain === host || normalizedDomain.endsWith(`.${host}`)
  );
}

export function generateInstanceApiKey(): { key: string; hash: string; prefix: string } {
  const key = `sk_inst_${crypto.randomBytes(32).toString('hex')}`;
  const hash = crypto.createHash('sha256').update(key).digest('hex');
  const prefix = key.substring(0, 16);
  return { key, hash, prefix };
}

export function generateSecretKey(): string {
  return crypto.randomBytes(64).toString('hex');
}

export async function verifyInstanceApiKey(apiKey: string): Promise<IInstance | null> {
  const hash = crypto.createHash('sha256').update(apiKey).digest('hex');
  const prefix = apiKey.substring(0, 16);

  const instance = await Instance.findOne({ apiKeyPrefix: prefix, status: 'active' });

  if (!instance || instance.apiKey !== hash) {
    return null;
  }

  await Instance.updateById(instance.id, { lastSeenAt: new Date() });

  return instance;
}

let cachedInstance: IInstance | null = null;

export async function getCurrentInstance(): Promise<IInstance | null> {
  if (cachedInstance) {
    return cachedInstance;
  }

  const domain = process.env.INSTANCE_DOMAIN || 'localhost';

  if (isHostDomain(domain)) {
    let instance = await Instance.findOne({ domain, type: 'host' });

    if (!instance) {
      const { key, hash, prefix } = generateInstanceApiKey();
      const secretKey = generateSecretKey();

      instance = await Instance.create({
        name: 'SerikaCord Host',
        domain,
        instanceId: crypto.randomUUID(),
        type: 'host',
        status: 'active',
        apiKey: hash,
        apiKeyPrefix: prefix,
        secretKey,
        config: {
          allowFederation: true,
          allowExternalEmojis: true,
          shareUserData: true,
        },
      });

      console.log(`[Instance] Created host instance. API Key (save this!): ${key}`);
    }

    cachedInstance = instance;
    return instance;
  }

  const instance = await Instance.findOne({ domain, type: 'self_hosted' });
  cachedInstance = instance;
  return instance;
}

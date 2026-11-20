import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { normalizeId } from '../db/normalizeId';
import { db, schema } from '../db/postgres';
import { config } from '../config';

export type IAllowedFileType = {
  type: string;
  safe: boolean;
};

export type IPlatformSettings = typeof schema.platformSettings.$inferSelect;

export const PlatformSettings = {
  table: schema.platformSettings,

  async findById(id: string = 'settings') {
    const [row] = await db.select().from(schema.platformSettings).where(eq(schema.platformSettings.id, normalizeId(id))).limit(1);
    return row || null;
  },
};

/**
 * The platform settings row as admins may see it: everything except the
 * at-rest message encryption key, which never leaves the server.
 */
export type IPublicPlatformSettings = Omit<IPlatformSettings, 'encryptionKey'>;

export function toPublicPlatformSettings(settings: IPlatformSettings): IPublicPlatformSettings {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { encryptionKey: _secret, ...rest } = settings;
  return rest;
}

/**
 * 64 characters from the same 70-character alphabet as before, drawn from the
 * CSPRNG with rejection sampling (no modulo bias). Only used when no key exists
 * yet; an existing key is never regenerated.
 */
function generateEncryptionKey(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
  const limit = 256 - (256 % chars.length);
  let key = '';
  while (key.length < 64) {
    for (const byte of randomBytes(128)) {
      if (byte >= limit) continue;
      key += chars.charAt(byte % chars.length);
      if (key.length === 64) break;
    }
  }
  return key;
}

const DEFAULT_ALLOWED_FILE_TYPES: IAllowedFileType[] = [
  ...config.ALLOWED_IMAGE_TYPES.map((type) => ({ type, safe: true })),
  ...config.ALLOWED_FILE_TYPES
    .filter((type) => !config.ALLOWED_IMAGE_TYPES.includes(type as typeof config.ALLOWED_IMAGE_TYPES[number]))
    .map((type) => ({ type, safe: true })),
];

export async function getPlatformSettings(): Promise<IPlatformSettings> {
  let [settings] = await db.select().from(schema.platformSettings).where(eq(schema.platformSettings.id, 'settings')).limit(1);

  if (!settings) {
    [settings] = await db.insert(schema.platformSettings).values({
      id: 'settings',
      maintenanceMode: false,
      allowRegistration: true,
      encryptionKey: generateEncryptionKey(),
      allowedFileTypes: DEFAULT_ALLOWED_FILE_TYPES,
    }).returning();
  }

  return settings!;
}

export async function updatePlatformSettings(updates: Partial<IPlatformSettings>): Promise<IPlatformSettings> {
  // The at-rest encryption key is never rotated through settings updates:
  // changing it would make every stored message undecryptable.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { encryptionKey: _ignoredKey, id: _ignoredId, ...safeUpdates } = updates;
  const [settings] = await db.update(schema.platformSettings)
    .set({ ...safeUpdates, updatedAt: new Date() })
    .where(eq(schema.platformSettings.id, 'settings'))
    .returning();

  if (!settings) {
    const [created] = await db.insert(schema.platformSettings).values({
      id: 'settings',
      ...safeUpdates,
      encryptionKey: generateEncryptionKey(),
    } as typeof schema.platformSettings.$inferInsert).returning();
    return created;
  }

  return settings;
}

let cachedEncryptionKey: string = '';

export async function getEncryptionKey(): Promise<string> {
  if (cachedEncryptionKey) {
    return cachedEncryptionKey;
  }

  const settings = await getPlatformSettings();
  cachedEncryptionKey = settings.encryptionKey ?? generateEncryptionKey();
  return cachedEncryptionKey;
}

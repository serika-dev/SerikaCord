/**
 * Storage for the Discord application fields `applications` has no column for
 * (role_connections_verification_url, event_webhooks_*, explicit_content_filter,
 * max_participants), the linked-roles metadata records, users' role
 * connections and the app's linked Discord bot (applicationDiscordLink.ts).
 * Two side tables, created on first use (additive, idempotent, mirrors
 * drizzle/manual_application_api_settings.sql and
 * manual_application_discord_link.sql). Nothing that selects
 * from `applications` depends on them, so a missing table never breaks login
 * or GET /applications/@me: reads fall back to defaults.
 */
import { and, eq, sql } from 'drizzle-orm';
import { db, schema } from '@/lib/db/postgres';
import { ensureSchema, withLockTimeout } from '@/lib/db/schemaGuard';
import type { AppApiExtras } from '@/lib/botapi/application';
import { parseStoredMetadata, serializeUserRoleConnection, type RoleConnectionMetadataRecord, type UserRoleConnection } from '@/lib/botapi/roleConnections';

const g = globalThis as unknown as { __applicationApiSchema?: Promise<void> | null };

export function ensureApplicationApiSchema(): Promise<void> {
  if (g.__applicationApiSchema) return g.__applicationApiSchema;
  g.__applicationApiSchema = ensureSchema(
    'application-api',
    {
      tables: {
        application_api_settings: [
          'application_id', 'role_connections_verification_url', 'role_connection_metadata', 'event_webhooks_url',
          'event_webhooks_status', 'event_webhooks_types', 'explicit_content_filter', 'max_participants', 'updated_at',
          'discord_bot_user_id', 'discord_application_id', 'discord_linked_at',
        ],
        application_role_connections: ['application_id', 'user_id', 'platform_name', 'platform_username', 'metadata', 'updated_at'],
      },
    },
    () => withLockTimeout([
      sql`CREATE TABLE IF NOT EXISTS application_api_settings (
        application_id uuid PRIMARY KEY,
        role_connections_verification_url text,
        role_connection_metadata jsonb,
        event_webhooks_url text,
        event_webhooks_status smallint DEFAULT 1,
        event_webhooks_types text[],
        explicit_content_filter smallint DEFAULT 0,
        max_participants integer,
        updated_at timestamp DEFAULT now()
      )`,
      sql`CREATE TABLE IF NOT EXISTS application_role_connections (
        application_id uuid NOT NULL,
        user_id uuid NOT NULL,
        platform_name text,
        platform_username text,
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
        updated_at timestamp DEFAULT now(),
        PRIMARY KEY (application_id, user_id)
      )`,
      sql`CREATE INDEX IF NOT EXISTS application_role_connections_user_idx ON application_role_connections (user_id)`,
      // The app's linked Discord bot (drizzle/manual_application_discord_link.sql).
      sql`ALTER TABLE application_api_settings ADD COLUMN IF NOT EXISTS discord_bot_user_id text`,
      sql`ALTER TABLE application_api_settings ADD COLUMN IF NOT EXISTS discord_application_id text`,
      sql`ALTER TABLE application_api_settings ADD COLUMN IF NOT EXISTS discord_linked_at timestamp`,
      sql`CREATE UNIQUE INDEX IF NOT EXISTS application_api_settings_discord_bot_user_id_unique ON application_api_settings (discord_bot_user_id)`,
    ]),
    { attempts: 3 },
  ).catch((err) => {
    g.__applicationApiSchema = null; // retry on the next call
    throw err;
  });
  return g.__applicationApiSchema;
}

type SettingsRow = typeof schema.applicationApiSettings.$inferSelect;

async function settingsRow(applicationId: string): Promise<SettingsRow | null> {
  await ensureApplicationApiSchema();
  const [row] = await db.select().from(schema.applicationApiSettings)
    .where(eq(schema.applicationApiSettings.applicationId, applicationId)).limit(1);
  return row ?? null;
}

/** The extra application fields for the Discord application object (defaults on any failure). */
export async function getAppApiExtras(applicationId: string): Promise<AppApiExtras> {
  try {
    const row = await settingsRow(applicationId);
    if (!row) return {};
    return {
      roleConnectionsVerificationUrl: row.roleConnectionsVerificationUrl ?? null,
      eventWebhooksUrl: row.eventWebhooksUrl ?? null,
      eventWebhooksStatus: row.eventWebhooksStatus ?? 1,
      eventWebhooksTypes: row.eventWebhooksTypes ?? [],
      explicitContentFilter: row.explicitContentFilter ?? 0,
      maxParticipants: row.maxParticipants ?? null,
    };
  } catch (err) {
    console.error('[application-api] settings read failed:', (err as Error)?.message ?? err);
    return {};
  }
}

/** Upsert the given extra fields (only keys present in `patch`). */
export async function updateAppApiExtras(applicationId: string, patch: AppApiExtras): Promise<void> {
  const set: Partial<typeof schema.applicationApiSettings.$inferInsert> = {};
  if (patch.roleConnectionsVerificationUrl !== undefined) set.roleConnectionsVerificationUrl = patch.roleConnectionsVerificationUrl;
  if (patch.eventWebhooksUrl !== undefined) set.eventWebhooksUrl = patch.eventWebhooksUrl;
  if (patch.eventWebhooksStatus !== undefined) set.eventWebhooksStatus = patch.eventWebhooksStatus;
  if (patch.eventWebhooksTypes !== undefined) set.eventWebhooksTypes = patch.eventWebhooksTypes;
  if (patch.explicitContentFilter !== undefined) set.explicitContentFilter = patch.explicitContentFilter;
  if (patch.maxParticipants !== undefined) set.maxParticipants = patch.maxParticipants;
  if (Object.keys(set).length === 0) return;
  await ensureApplicationApiSchema();
  const now = new Date();
  await db.insert(schema.applicationApiSettings)
    .values({ applicationId, ...set, updatedAt: now })
    .onConflictDoUpdate({ target: schema.applicationApiSettings.applicationId, set: { ...set, updatedAt: now } });
}

// ─── Linked roles: metadata records ─────────────────────────────────────────

export async function getRoleConnectionMetadata(applicationId: string): Promise<RoleConnectionMetadataRecord[]> {
  const row = await settingsRow(applicationId);
  return parseStoredMetadata(row?.roleConnectionMetadata);
}

export async function putRoleConnectionMetadata(applicationId: string, records: RoleConnectionMetadataRecord[]): Promise<RoleConnectionMetadataRecord[]> {
  await ensureApplicationApiSchema();
  const now = new Date();
  await db.insert(schema.applicationApiSettings)
    .values({ applicationId, roleConnectionMetadata: records, updatedAt: now })
    .onConflictDoUpdate({ target: schema.applicationApiSettings.applicationId, set: { roleConnectionMetadata: records, updatedAt: now } });
  return records;
}

// ─── Linked roles: a user's connection ──────────────────────────────────────

const rc = () => schema.applicationRoleConnections;

async function connectionRow(applicationId: string, userId: string) {
  await ensureApplicationApiSchema();
  const [row] = await db.select().from(rc())
    .where(and(eq(rc().applicationId, applicationId), eq(rc().userId, userId))).limit(1);
  return row ?? null;
}

/** The user's connection (empty shape when there is none, like Discord). */
export async function getUserRoleConnection(applicationId: string, userId: string, records?: RoleConnectionMetadataRecord[]): Promise<UserRoleConnection> {
  const [row, recs] = await Promise.all([connectionRow(applicationId, userId), records ? Promise.resolve(records) : getRoleConnectionMetadata(applicationId)]);
  return serializeUserRoleConnection(row, recs);
}

export async function putUserRoleConnection(applicationId: string, userId: string, conn: UserRoleConnection, records: RoleConnectionMetadataRecord[]): Promise<UserRoleConnection> {
  await ensureApplicationApiSchema();
  const now = new Date();
  const values = { platformName: conn.platform_name, platformUsername: conn.platform_username, metadata: conn.metadata, updatedAt: now };
  await db.insert(rc())
    .values({ applicationId, userId, ...values })
    .onConflictDoUpdate({ target: [rc().applicationId, rc().userId], set: values });
  return serializeUserRoleConnection({ platformName: conn.platform_name, platformUsername: conn.platform_username, metadata: conn.metadata }, records);
}

export async function deleteUserRoleConnection(applicationId: string, userId: string): Promise<void> {
  await ensureApplicationApiSchema();
  await db.delete(rc()).where(and(eq(rc().applicationId, applicationId), eq(rc().userId, userId)));
}

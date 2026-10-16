// Boot-time schema ensure for interactions, application commands and message
// components. Mirrors drizzle/manual_interactions_components.sql. Additive +
// idempotent: nullable columns without defaults (metadata-only adds) and a new
// table. messages.components / webhook_author are read by every message query,
// so initializeAPI() awaits this before serving. Nothing runs when the schema
// is already complete (no ACCESS EXCLUSIVE lock on messages every boot); boot
// fails if it can't be completed (see lib/db/schemaGuard).
import { sql } from 'drizzle-orm';
import { ensureSchema, withLockTimeout } from '@/lib/db/schemaGuard';

const g = globalThis as unknown as { __interactionSchema?: Promise<void> | null };

const APP_COMMAND_COLUMNS = [
  'default_member_permissions', 'dm_permission', 'contexts', 'integration_types',
  'name_localizations', 'description_localizations', 'nsfw', 'handler',
];

export function ensureInteractionSchema(): Promise<void> {
  if (g.__interactionSchema) return g.__interactionSchema;
  g.__interactionSchema = ensureSchema('interactions', {
    tables: {
      messages: ['components', 'webhook_author'],
      app_commands: APP_COMMAND_COLUMNS,
      app_command_permissions: ['guild_id', 'command_id', 'application_id', 'permissions'],
      channel_webhooks: ['application_id'],
    },
  }, async (missing) => {
    const has = (prefix: string) => missing.some((m) => m === prefix || m.startsWith(`${prefix}.`));
    if (has('messages')) {
      await withLockTimeout([
        sql`ALTER TABLE messages ADD COLUMN IF NOT EXISTS "components" jsonb`,
        sql`ALTER TABLE messages ADD COLUMN IF NOT EXISTS "webhook_author" jsonb`,
      ]);
    }
    if (has('app_commands')) {
      await withLockTimeout([
        sql`ALTER TABLE app_commands ADD COLUMN IF NOT EXISTS "default_member_permissions" text`,
        sql`ALTER TABLE app_commands ADD COLUMN IF NOT EXISTS "dm_permission" boolean`,
        sql`ALTER TABLE app_commands ADD COLUMN IF NOT EXISTS "contexts" integer[]`,
        sql`ALTER TABLE app_commands ADD COLUMN IF NOT EXISTS "integration_types" integer[]`,
        sql`ALTER TABLE app_commands ADD COLUMN IF NOT EXISTS "name_localizations" jsonb`,
        sql`ALTER TABLE app_commands ADD COLUMN IF NOT EXISTS "description_localizations" jsonb`,
        sql`ALTER TABLE app_commands ADD COLUMN IF NOT EXISTS "nsfw" boolean`,
        sql`ALTER TABLE app_commands ADD COLUMN IF NOT EXISTS "handler" integer`,
      ]);
    }
    if (has('app_command_permissions')) {
      await withLockTimeout([
        sql`CREATE TABLE IF NOT EXISTS app_command_permissions (
          guild_id uuid NOT NULL,
          command_id uuid NOT NULL,
          application_id uuid NOT NULL,
          permissions jsonb NOT NULL DEFAULT '[]'::jsonb,
          updated_at timestamp DEFAULT now(),
          PRIMARY KEY (guild_id, command_id)
        )`,
        sql`CREATE INDEX IF NOT EXISTS app_command_permissions_app_guild_idx ON app_command_permissions (application_id, guild_id)`,
      ]);
    }
    if (has('channel_webhooks')) {
      await withLockTimeout([sql`ALTER TABLE channel_webhooks ADD COLUMN IF NOT EXISTS "application_id" uuid`]);
    }
  }).catch((err) => {
    g.__interactionSchema = null;
    throw err;
  });
  return g.__interactionSchema;
}

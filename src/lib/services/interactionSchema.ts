// Boot-time schema ensure for interactions, application commands and message
// components. Mirrors drizzle/manual_interactions_components.sql. Additive +
// idempotent: nullable columns without defaults (metadata-only adds) and a new
// table. messages.components / webhook_author are read by every message query,
// so initializeAPI() awaits this before serving.
import { sql } from 'drizzle-orm';
import { db } from '@/lib/db/postgres';

const g = globalThis as unknown as { __interactionSchema?: Promise<void> | null };

export function ensureInteractionSchema(): Promise<void> {
  if (g.__interactionSchema) return g.__interactionSchema;
  g.__interactionSchema = (async () => {
    // The tables are shared with production: never queue behind a long
    // transaction holding a lock (that would stall every message query). Each
    // attempt gives up after a few seconds and is retried.
    for (let attempt = 1; attempt <= 10; attempt++) {
      try {
        await db.transaction(async (tx) => {
          await tx.execute(sql`SET LOCAL lock_timeout = '3s'`);
          await tx.execute(sql`ALTER TABLE messages ADD COLUMN IF NOT EXISTS "components" jsonb`);
          await tx.execute(sql`ALTER TABLE messages ADD COLUMN IF NOT EXISTS "webhook_author" jsonb`);
        });
        await db.transaction(async (tx) => {
          await tx.execute(sql`SET LOCAL lock_timeout = '3s'`);
          await tx.execute(sql`ALTER TABLE app_commands ADD COLUMN IF NOT EXISTS "default_member_permissions" text`);
          await tx.execute(sql`ALTER TABLE app_commands ADD COLUMN IF NOT EXISTS "dm_permission" boolean`);
          await tx.execute(sql`ALTER TABLE app_commands ADD COLUMN IF NOT EXISTS "contexts" integer[]`);
          await tx.execute(sql`ALTER TABLE app_commands ADD COLUMN IF NOT EXISTS "integration_types" integer[]`);
          await tx.execute(sql`ALTER TABLE app_commands ADD COLUMN IF NOT EXISTS "name_localizations" jsonb`);
          await tx.execute(sql`ALTER TABLE app_commands ADD COLUMN IF NOT EXISTS "description_localizations" jsonb`);
          await tx.execute(sql`ALTER TABLE app_commands ADD COLUMN IF NOT EXISTS "nsfw" boolean`);
          await tx.execute(sql`ALTER TABLE app_commands ADD COLUMN IF NOT EXISTS "handler" integer`);
        });
        await db.transaction(async (tx) => {
          await tx.execute(sql`SET LOCAL lock_timeout = '3s'`);
          await tx.execute(sql`CREATE TABLE IF NOT EXISTS app_command_permissions (
            guild_id uuid NOT NULL,
            command_id uuid NOT NULL,
            application_id uuid NOT NULL,
            permissions jsonb NOT NULL DEFAULT '[]'::jsonb,
            updated_at timestamp DEFAULT now(),
            PRIMARY KEY (guild_id, command_id)
          )`);
          await tx.execute(sql`CREATE INDEX IF NOT EXISTS app_command_permissions_app_guild_idx ON app_command_permissions (application_id, guild_id)`);
          await tx.execute(sql`ALTER TABLE channel_webhooks ADD COLUMN IF NOT EXISTS "application_id" uuid`);
        });
        return;
      } catch (err) {
        console.error(`[interactions] Ensuring interaction schema failed (attempt ${attempt}):`, (err as Error)?.message ?? err);
        await new Promise((r) => setTimeout(r, Math.min(30_000, 2_000 * attempt)));
      }
    }
    g.__interactionSchema = null;
  })();
  return g.__interactionSchema;
}

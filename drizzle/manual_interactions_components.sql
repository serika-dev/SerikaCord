-- Interactions, application commands and message components (Discord API v10
-- parity, WP3 + the WP6 webhook router). Additive + idempotent. Also applied
-- automatically at boot by ensureInteractionSchema() in
-- src/lib/services/interactionSchema.ts.
--
-- Every column is nullable with no default, so each ADD COLUMN is a
-- metadata-only change (no table rewrite, even on the big messages table).
SET lock_timeout = '3s';

-- Message components (action rows, buttons, selects, components v2 layouts),
-- stored in Discord's own JSON shape after validation (lib/botapi/components).
ALTER TABLE messages ADD COLUMN IF NOT EXISTS "components" jsonb;
-- Per-message webhook identity override ({ username, avatar }) from webhook
-- execute username / avatar_url, so a reload shows what was posted.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS "webhook_author" jsonb;

-- Application command fields Discord exposes (permissions v2, contexts,
-- localizations, nsfw, entry-point handler).
ALTER TABLE app_commands ADD COLUMN IF NOT EXISTS "default_member_permissions" text;
ALTER TABLE app_commands ADD COLUMN IF NOT EXISTS "dm_permission" boolean;
ALTER TABLE app_commands ADD COLUMN IF NOT EXISTS "contexts" integer[];
ALTER TABLE app_commands ADD COLUMN IF NOT EXISTS "integration_types" integer[];
ALTER TABLE app_commands ADD COLUMN IF NOT EXISTS "name_localizations" jsonb;
ALTER TABLE app_commands ADD COLUMN IF NOT EXISTS "description_localizations" jsonb;
ALTER TABLE app_commands ADD COLUMN IF NOT EXISTS "nsfw" boolean;
ALTER TABLE app_commands ADD COLUMN IF NOT EXISTS "handler" integer;

-- Command permissions v2 overrides per guild. command_id = the application id
-- holds the app-wide defaults, as on Discord.
CREATE TABLE IF NOT EXISTS app_command_permissions (
  guild_id uuid NOT NULL,
  command_id uuid NOT NULL,
  application_id uuid NOT NULL,
  permissions jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamp DEFAULT now(),
  PRIMARY KEY (guild_id, command_id)
);
CREATE INDEX IF NOT EXISTS app_command_permissions_app_guild_idx ON app_command_permissions (application_id, guild_id);

-- Webhooks created by an application (bot) carry its id (webhook.application_id).
ALTER TABLE channel_webhooks ADD COLUMN IF NOT EXISTS "application_id" uuid;

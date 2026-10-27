-- Serika extension: link a SerikaCord application to its Discord bot
-- (PUT /api/v10/applications/@me/discord-link, Developer Portal -> Bot ->
-- Linked Discord bot). Only the Discord bot user id / application id are
-- stored, never the Discord token. A Discord bot belongs to one application
-- at a time (unique index; NULLs don't collide). The Discord bridge relays
-- that bot's messages into bridged servers as the app's own bot user.
-- Additive and idempotent. ensureApplicationApiSchema()
-- (src/lib/services/applicationApiSettings.ts) also runs this on first use.
-- Needs drizzle/manual_application_api_settings.sql (the table) first.
ALTER TABLE application_api_settings ADD COLUMN IF NOT EXISTS discord_bot_user_id text;
ALTER TABLE application_api_settings ADD COLUMN IF NOT EXISTS discord_application_id text;
ALTER TABLE application_api_settings ADD COLUMN IF NOT EXISTS discord_linked_at timestamp;

CREATE UNIQUE INDEX IF NOT EXISTS application_api_settings_discord_bot_user_id_unique
  ON application_api_settings (discord_bot_user_id);

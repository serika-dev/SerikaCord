-- Track which guilds a Discord user is currently restricted (timed out) in, so
-- the timeout can be lifted when they consent — the consent button fires in a
-- DM where the originating guild is unknown.
-- Apply manually:
--   psql "$POSTGRES_URI" -f drizzle/manual_discord_restricted_guilds.sql

ALTER TABLE discord_users
  ADD COLUMN IF NOT EXISTS restricted_guild_ids text[] DEFAULT '{}';

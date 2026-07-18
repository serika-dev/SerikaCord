-- Discord bridge consent tracking.
-- Adds per-Discord-user consent state + rate-limit / enforcement timestamps.
-- Apply manually (see other manual_*.sql files):
--   psql "$DATABASE_URL" -f drizzle/manual_discord_consent.sql

ALTER TABLE discord_users
  ADD COLUMN IF NOT EXISTS consent_status text DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS consent_updated_at timestamp,
  ADD COLUMN IF NOT EXISTS last_consent_dm_at timestamp,
  ADD COLUMN IF NOT EXISTS last_timeout_at timestamp;

-- Existing rows predate the consent system; leave them 'pending' so the bridge
-- re-asks for consent before processing any further messages from them.
UPDATE discord_users SET consent_status = 'pending' WHERE consent_status IS NULL;

-- Discord-style snowflake ids for the bot API (docs/architecture/discord-parity.md 4.1).
-- One row per entity a snowflake-format bot has seen, created lazily by
-- src/lib/botapi/snowflakeStore.ts. Applications opt in through
-- applications.api_id_format = 'snowflake' (NULL = legacy UUID ids, unchanged).
-- Additive + idempotent. Also applied automatically at boot by
-- ensureApiSnowflakeSchema() in src/lib/botapi/snowflakeStore.ts.
SET lock_timeout = '3s';
CREATE TABLE IF NOT EXISTS api_snowflakes (
  snowflake  bigint PRIMARY KEY,
  -- 1 user 2 guild 3 channel 4 message 5 role 6 emoji 7 sticker 8 webhook 9 application
  -- 10 command 11 attachment 12 interaction 13 event 14 automod rule 15 audit entry 0 unknown
  kind       smallint NOT NULL DEFAULT 0,
  uuid       uuid NOT NULL,
  created_at timestamp DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS api_snowflakes_uuid_unique ON api_snowflakes (uuid);
ALTER TABLE applications ADD COLUMN IF NOT EXISTS api_id_format text;

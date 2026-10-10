-- Blind search index for message search (server-wide, DM and group DM search).
-- Message content is encrypted at rest, so this table stores only short keyed
-- hashes (HMAC-SHA256, truncated) of normalized words and word prefixes, plus
-- content-derived has: flags. Additive + idempotent.
--
-- The app also runs this at boot (ensureMessageSearchSchema in
-- src/lib/services/messageSearch.ts), so applying it by hand is optional. Old
-- messages are indexed by an in-process background backfill (newest first,
-- leader-locked in Redis, disable with DISABLE_SEARCH_BACKFILL=1).
CREATE TABLE IF NOT EXISTS "message_search_index" (
  "message_id" uuid PRIMARY KEY NOT NULL,
  "channel_id" uuid NOT NULL,
  "terms" text[] DEFAULT '{}'::text[] NOT NULL,
  "flags" integer DEFAULT 0 NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "indexed_at" timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "message_search_index_terms_gin_idx"
  ON "message_search_index" USING gin ("terms");

CREATE INDEX IF NOT EXISTS "message_search_index_channel_id_idx"
  ON "message_search_index" ("channel_id");

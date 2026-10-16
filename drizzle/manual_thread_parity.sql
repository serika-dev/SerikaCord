-- Discord-parity thread / forum fields for the bot API (WP5).
--   flags             Discord channel flags: PINNED (1<<1) on forum posts,
--                     REQUIRE_TAG (1<<4) on forum channels. NULL = 0.
--   thread_invitable  private threads: whether non-moderators may add other
--                     non-moderators (Discord thread_metadata.invitable). NULL = true.
-- Both nullable without a default: a metadata-only change, no table rewrite.
-- Additive + idempotent. Also applied automatically at boot by
-- ensureThreadParitySchema() in src/lib/services/threadParitySchema.ts.
SET lock_timeout = '3s';
ALTER TABLE channels ADD COLUMN IF NOT EXISTS "flags" integer;
ALTER TABLE channels ADD COLUMN IF NOT EXISTS "thread_invitable" boolean;

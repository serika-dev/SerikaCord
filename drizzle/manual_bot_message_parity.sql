-- Discord-parity message fields for the bot API (WP2).
--   tts        Discord `tts` flag stored on bot / webhook messages.
--   pinned_at  when the message was pinned (GET /channels/{id}/messages/pins
--              pagination, CHANNEL_PINS_UPDATE last_pin_timestamp).
-- Both nullable without a default: a metadata-only change, no table rewrite.
-- Additive + idempotent. Also applied automatically at boot by
-- ensureBotMessageSchema() in src/lib/services/botMessageSchema.ts.
SET lock_timeout = '3s';
ALTER TABLE messages ADD COLUMN IF NOT EXISTS "tts" boolean;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS "pinned_at" timestamp;

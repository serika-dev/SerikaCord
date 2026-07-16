-- Per-user, per-channel read markers for cross-device unread/mention state.
CREATE TABLE IF NOT EXISTS "channel_read_states" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL,
  "channel_id" uuid NOT NULL,
  "last_read_message_id" uuid,
  "last_read_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "channel_read_states_user_channel_unique"
  ON "channel_read_states" ("user_id", "channel_id");

CREATE INDEX IF NOT EXISTS "channel_read_states_user_id_idx"
  ON "channel_read_states" ("user_id");

-- Stage instances for the Discord-compatible bot API (POST/GET/PATCH/DELETE
-- /stage-instances): a live stage channel's topic and privacy level, one row
-- per stage channel. Additive and idempotent. The app also creates this table
-- on first use (ensureStageInstanceSchema in src/lib/botapi/guildStageInstances.ts).
CREATE TABLE IF NOT EXISTS stage_instances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id uuid NOT NULL,
  channel_id uuid NOT NULL,
  topic text NOT NULL,
  privacy_level integer NOT NULL DEFAULT 2,
  discoverable_disabled boolean NOT NULL DEFAULT true,
  guild_scheduled_event_id uuid,
  creator_id uuid,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS stage_instances_channel_id_unique ON stage_instances (channel_id);
CREATE INDEX IF NOT EXISTS stage_instances_server_id_idx ON stage_instances (server_id);

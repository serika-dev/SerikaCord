-- Activities (Embedded App SDK), phase 1: per-application Activity settings
-- (enabled, URL mappings for the Activities proxy, platforms, orientation, age
-- gate, shelf name/art). See docs/architecture/activities.md (CORD-92).
-- Additive and idempotent. The app also creates this table on first use
-- (ensureActivitySettingsSchema in src/lib/services/activitySettings.ts).
CREATE TABLE IF NOT EXISTS application_activity_settings (
  application_id uuid PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT false,
  url_mappings jsonb NOT NULL DEFAULT '[]'::jsonb,
  supported_platforms text[],
  orientation_lock_phone smallint NOT NULL DEFAULT 1,
  orientation_lock_tablet smallint NOT NULL DEFAULT 1,
  age_gated boolean NOT NULL DEFAULT false,
  display_name text,
  image_url text,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);
CREATE INDEX IF NOT EXISTS application_activity_settings_enabled_idx ON application_activity_settings (enabled);

-- Phase 4: one row per Activity launch (audit / analytics). Running instances
-- live in Redis. The app also creates this on first use
-- (ensureActivityLaunchSchema in src/lib/services/activityInstances.ts).
CREATE TABLE IF NOT EXISTS activity_launches (
  instance_id text PRIMARY KEY,
  application_id uuid NOT NULL,
  launch_id text NOT NULL,
  location_kind text NOT NULL,
  channel_id uuid NOT NULL,
  guild_id uuid,
  voice boolean NOT NULL DEFAULT false,
  launcher_id uuid NOT NULL,
  message_id uuid,
  started_at timestamp NOT NULL DEFAULT now(),
  ended_at timestamp,
  peak_participants integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS activity_launches_application_id_idx ON activity_launches (application_id, started_at);
CREATE INDEX IF NOT EXISTS activity_launches_channel_id_idx ON activity_launches (channel_id, started_at);

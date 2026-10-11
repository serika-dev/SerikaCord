-- Server scheduled events + announcement channel follows.
-- Additive and idempotent: safe to run more than once. The app also applies
-- this at boot (ensureScheduledEventSchema in src/lib/services/scheduledEvents.ts).

SET lock_timeout = '3s';

CREATE TABLE IF NOT EXISTS "server_scheduled_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "server_id" uuid NOT NULL,
  "creator_id" uuid NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "entity_type" text NOT NULL DEFAULT 'voice',
  "channel_id" uuid,
  "location" text,
  "image" text,
  "status" text NOT NULL DEFAULT 'scheduled',
  "start_at" timestamp NOT NULL,
  "end_at" timestamp,
  "started_at" timestamp,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "server_scheduled_events_server_status_idx" ON "server_scheduled_events" ("server_id", "status");
CREATE INDEX IF NOT EXISTS "server_scheduled_events_status_start_idx" ON "server_scheduled_events" ("status", "start_at");

CREATE TABLE IF NOT EXISTS "server_scheduled_event_users" (
  "event_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "created_at" timestamp DEFAULT now(),
  PRIMARY KEY ("event_id", "user_id")
);
CREATE INDEX IF NOT EXISTS "server_scheduled_event_users_user_idx" ON "server_scheduled_event_users" ("user_id");

CREATE TABLE IF NOT EXISTS "channel_follows" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "source_channel_id" uuid NOT NULL,
  "source_server_id" uuid NOT NULL,
  "target_channel_id" uuid NOT NULL,
  "target_server_id" uuid NOT NULL,
  "webhook_id" uuid NOT NULL,
  "creator_id" uuid NOT NULL,
  "created_at" timestamp DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "channel_follows_source_target_idx" ON "channel_follows" ("source_channel_id", "target_channel_id");
CREATE INDEX IF NOT EXISTS "channel_follows_target_idx" ON "channel_follows" ("target_channel_id");

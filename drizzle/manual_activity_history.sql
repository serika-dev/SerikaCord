-- Persistent "recent activity" log populated from rich-presence reports.
-- Apply with `bunx drizzle-kit push` (which diffs the schema automatically) or
-- run this file directly against the DB.
CREATE TABLE IF NOT EXISTS "activity_history" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "type" text DEFAULT 'game',
  "name" text NOT NULL,
  "image_url" text,
  "first_seen_at" timestamp DEFAULT now() NOT NULL,
  "last_seen_at" timestamp DEFAULT now() NOT NULL,
  "duration_seconds" integer DEFAULT 0 NOT NULL,
  "sessions" integer DEFAULT 1 NOT NULL
);
CREATE INDEX IF NOT EXISTS "activity_history_user_id_idx" ON "activity_history" ("user_id");
CREATE INDEX IF NOT EXISTS "activity_history_last_seen_at_idx" ON "activity_history" ("last_seen_at");
CREATE UNIQUE INDEX IF NOT EXISTS "activity_history_user_type_name_unique" ON "activity_history" ("user_id", "type", "name");

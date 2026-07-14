-- Discord users table for storing unlinked Discord users separately from real users
CREATE TABLE IF NOT EXISTS "discord_users" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "discord_id" text NOT NULL UNIQUE,
  "username" text,
  "display_name" text NOT NULL,
  "avatar" text,
  "is_bot" boolean DEFAULT false,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "discord_users_discord_id_idx" ON "discord_users" ("discord_id");

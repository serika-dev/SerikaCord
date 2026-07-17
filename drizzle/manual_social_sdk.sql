-- Social SDK / Profile widgets / Serika RPC — Phase 1 schema.
-- ADDITIVE ONLY: new tables + new nullable columns. No existing data is
-- modified or dropped. Safe to run against production; idempotent.
-- See docs/social-sdk-design.md.

-- ── users: profile widget placements ──────────────────────────────────────
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "profile_widgets" jsonb DEFAULT '[]'::jsonb;

-- ── rich_presence: Serika RPC extensions ──────────────────────────────────
ALTER TABLE "rich_presence"
  ADD COLUMN IF NOT EXISTS "application_id" uuid,
  ADD COLUMN IF NOT EXISTS "assets" jsonb,
  ADD COLUMN IF NOT EXISTS "buttons" jsonb,
  ADD COLUMN IF NOT EXISTS "party_id" text,
  ADD COLUMN IF NOT EXISTS "party_size" jsonb;

-- ── user_games: per-user game library ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS "user_games" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "igdb_id" integer,
  "steam_app_id" text,
  "name" text NOT NULL,
  "cover_url" text,
  "category" text NOT NULL,
  "tags" jsonb DEFAULT '[]'::jsonb,
  "note" text,
  "position" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "user_games_user_id_idx" ON "user_games" ("user_id");
CREATE INDEX IF NOT EXISTS "user_games_user_id_category_idx" ON "user_games" ("user_id", "category");
CREATE UNIQUE INDEX IF NOT EXISTS "user_games_user_category_igdb_unique" ON "user_games" ("user_id", "category", "igdb_id");

-- ── widget_configs: application-authored widget definitions ────────────────
CREATE TABLE IF NOT EXISTS "widget_configs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "application_id" uuid NOT NULL,
  "name" text NOT NULL,
  "status" text DEFAULT 'draft' NOT NULL,
  "surfaces" jsonb DEFAULT '{}'::jsonb,
  "sample_data" jsonb DEFAULT '{}'::jsonb,
  "version" integer DEFAULT 1 NOT NULL,
  "published_at" timestamp,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "widget_configs_application_id_unique" ON "widget_configs" ("application_id");

-- ── widget_user_data: per-user dynamic widget values ──────────────────────
CREATE TABLE IF NOT EXISTS "widget_user_data" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "application_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "data" jsonb DEFAULT '{}'::jsonb,
  "updated_at" timestamp DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "widget_user_data_application_user_unique" ON "widget_user_data" ("application_id", "user_id");
CREATE INDEX IF NOT EXISTS "widget_user_data_user_id_idx" ON "widget_user_data" ("user_id");

-- AutoMod rules (Discord-style): one row per rule. trigger_type is
-- keyword | spam | mention_spam | links; trigger_metadata and actions hold the
-- JSON shapes in src/lib/automod/rules.ts.
-- Additive + idempotent. The app also runs this at boot (ensureAutoModSchema
-- in src/lib/services/automod.ts), so applying it by hand is optional.
CREATE TABLE IF NOT EXISTS "automod_rules" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "server_id" uuid NOT NULL,
  "name" text NOT NULL,
  "creator_id" uuid,
  "enabled" boolean DEFAULT true NOT NULL,
  "trigger_type" text NOT NULL,
  "trigger_metadata" jsonb DEFAULT '{}'::jsonb,
  "actions" jsonb DEFAULT '[]'::jsonb,
  "exempt_roles" jsonb DEFAULT '[]'::jsonb,
  "exempt_channels" jsonb DEFAULT '[]'::jsonb,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "automod_rules_server_idx" ON "automod_rules" ("server_id", "created_at");

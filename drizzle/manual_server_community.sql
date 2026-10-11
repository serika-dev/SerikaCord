-- Welcome Screen, Rules Screening and Server Templates. Additive + idempotent.
-- Also applied automatically at boot by ensureCommunitySchema() in
-- src/lib/services/serverCommunity.ts.
--
--   servers.welcome_screen          { enabled, description, welcomeChannels[] } (already in 0000; kept for old DBs)
--   server_members.pending          already in 0000; true = joined during rules screening, not accepted yet
--   server_screening                one row per server: enabled, description, rules[]
--   server_templates                one template per server: code, snapshot (ServerSnapshot JSON), usage count
ALTER TABLE servers ADD COLUMN IF NOT EXISTS welcome_screen jsonb;
ALTER TABLE server_members ADD COLUMN IF NOT EXISTS pending boolean DEFAULT false;

CREATE TABLE IF NOT EXISTS server_screening (
  server_id uuid PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT false,
  description text,
  rules jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS server_templates (
  code text PRIMARY KEY,
  server_id uuid NOT NULL,
  creator_id uuid NOT NULL,
  name text NOT NULL,
  description text,
  usage_count integer NOT NULL DEFAULT 0,
  serialized jsonb NOT NULL,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS server_templates_server_id_unique ON server_templates (server_id);

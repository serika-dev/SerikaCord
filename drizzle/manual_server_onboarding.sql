-- Server Onboarding, Server Guide, stricter Rules Screening (channel access +
-- manual approval) and server connections. Additive + idempotent.
-- Also applied automatically at boot by ensureCommunitySchema() in
-- src/lib/services/serverCommunity.ts.
--
--   server_screening.restrict_channels        pending members only see accessible_channel_ids
--   server_screening.accessible_channel_ids   channels / categories readable before accepting
--   server_screening.manual_approval          submitting the rules queues an application
--   server_screening.questions                application questions asked with the rules
--   server_onboarding                         one row per server: config (questions + guide), linked owner connections
--   server_onboarding_responses               a member's picks and guide progress
ALTER TABLE server_screening ADD COLUMN IF NOT EXISTS restrict_channels boolean NOT NULL DEFAULT false;
ALTER TABLE server_screening ADD COLUMN IF NOT EXISTS accessible_channel_ids jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE server_screening ADD COLUMN IF NOT EXISTS manual_approval boolean NOT NULL DEFAULT false;
ALTER TABLE server_screening ADD COLUMN IF NOT EXISTS questions jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE TABLE IF NOT EXISTS server_onboarding (
  server_id uuid PRIMARY KEY,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  linked_connection_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS server_onboarding_responses (
  server_id uuid NOT NULL,
  user_id uuid NOT NULL,
  option_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  completed_at timestamp,
  roles_applied boolean NOT NULL DEFAULT false,
  todos_done jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamp DEFAULT now(),
  PRIMARY KEY (server_id, user_id)
);

-- Discord parity: Social SDK lobbies, app-scoped DM moderation metadata and
-- invite target users (src/lib/api/botApi/social.ts).
-- Additive and idempotent: new tables and indexes only, nothing on existing
-- tables. Also applied lazily at runtime by ensureSocialParitySchema()
-- (src/lib/services/socialParitySchema.ts).

CREATE TABLE IF NOT EXISTS lobbies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL,
  secret_hash text,
  metadata jsonb,
  flags integer NOT NULL DEFAULT 0,
  idle_timeout_seconds integer NOT NULL DEFAULT 300,
  linked_channel_id uuid,
  linked_by_id uuid,
  last_activity_at timestamp DEFAULT now(),
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lobbies_application_id_idx ON lobbies (application_id);
CREATE UNIQUE INDEX IF NOT EXISTS lobbies_application_id_secret_hash_unique ON lobbies (application_id, secret_hash);
CREATE UNIQUE INDEX IF NOT EXISTS lobbies_linked_channel_id_unique ON lobbies (linked_channel_id);

CREATE TABLE IF NOT EXISTS lobby_members (
  lobby_id uuid NOT NULL,
  user_id uuid NOT NULL,
  metadata jsonb,
  flags integer NOT NULL DEFAULT 0,
  additional_name text,
  created_at timestamp DEFAULT now(),
  PRIMARY KEY (lobby_id, user_id)
);
CREATE INDEX IF NOT EXISTS lobby_members_user_id_idx ON lobby_members (user_id);

CREATE TABLE IF NOT EXISTS lobby_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lobby_id uuid NOT NULL,
  application_id uuid NOT NULL,
  author_id uuid NOT NULL,
  content text NOT NULL DEFAULT '',
  flags integer NOT NULL DEFAULT 0,
  additional_name text,
  moderation_metadata jsonb,
  created_at timestamp DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lobby_messages_lobby_id_created_at_idx ON lobby_messages (lobby_id, created_at);

CREATE TABLE IF NOT EXISTS app_message_moderation (
  application_id uuid NOT NULL,
  message_id uuid NOT NULL,
  metadata jsonb NOT NULL,
  updated_at timestamp DEFAULT now(),
  PRIMARY KEY (application_id, message_id)
);

CREATE TABLE IF NOT EXISTS invite_target_users (
  invite_id uuid NOT NULL,
  user_id uuid NOT NULL,
  created_at timestamp DEFAULT now(),
  PRIMARY KEY (invite_id, user_id)
);

-- Discord application fields with no `applications` column (PATCH
-- /applications/@me: role_connections_verification_url, event_webhooks_*,
-- explicit_content_filter, max_participants), linked-roles metadata records,
-- and users' role connections (role_connections.write).
-- Additive and idempotent. ensureApplicationApiSchema()
-- (src/lib/services/applicationApiSettings.ts) also runs this on first use.
CREATE TABLE IF NOT EXISTS application_api_settings (
  application_id uuid PRIMARY KEY,
  role_connections_verification_url text,
  role_connection_metadata jsonb,
  event_webhooks_url text,
  event_webhooks_status smallint DEFAULT 1,
  event_webhooks_types text[],
  explicit_content_filter smallint DEFAULT 0,
  max_participants integer,
  updated_at timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS application_role_connections (
  application_id uuid NOT NULL,
  user_id uuid NOT NULL,
  platform_name text,
  platform_username text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamp DEFAULT now(),
  PRIMARY KEY (application_id, user_id)
);

CREATE INDEX IF NOT EXISTS application_role_connections_user_idx ON application_role_connections (user_id);

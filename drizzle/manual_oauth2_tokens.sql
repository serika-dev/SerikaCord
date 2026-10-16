-- OAuth2 access / refresh tokens for Bearer auth on /api/v10 (WP6).
-- Additive and idempotent; also applied lazily at runtime by
-- ensureOAuth2TokenSchema() (src/lib/services/oauth2Tokens.ts).
-- Only SHA-256 hashes of tokens are stored.
CREATE TABLE IF NOT EXISTS oauth2_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL,
  user_id uuid NOT NULL,
  scopes text[] NOT NULL DEFAULT '{}',
  grant_type text NOT NULL,
  access_token_hash text NOT NULL,
  refresh_token_hash text,
  expires_at timestamp NOT NULL,
  refresh_expires_at timestamp,
  revoked_at timestamp,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS oauth2_tokens_access_token_hash_unique ON oauth2_tokens (access_token_hash);
CREATE UNIQUE INDEX IF NOT EXISTS oauth2_tokens_refresh_token_hash_unique ON oauth2_tokens (refresh_token_hash);
CREATE INDEX IF NOT EXISTS oauth2_tokens_application_id_user_id_idx ON oauth2_tokens (application_id, user_id);

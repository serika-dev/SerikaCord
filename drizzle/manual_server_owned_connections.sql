-- Server-owned connections: accounts that belong to a server itself (a
-- DNS-verified domain, or an account linked through an OAuth sign-in made for
-- the server) instead of to the owner's personal profile. Additive +
-- idempotent. Also applied automatically at boot by ensureCommunitySchema()
-- in src/lib/services/serverCommunity.ts.
--
--   provider     'website' or an OAuth provider id (github, twitch, ...)
--   metadata     { domainVerification: { token, verified, verifiedAt } } for domains,
--                { oauthVerified: true } for OAuth accounts; never any tokens
--   verified     domain TXT record checked, or account proven by OAuth
--   created_by   the owner who added it (kept across ownership transfers)
CREATE TABLE IF NOT EXISTS server_owned_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id uuid NOT NULL,
  provider text NOT NULL,
  account_id text NOT NULL,
  username text,
  display_name text,
  avatar text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  verified boolean NOT NULL DEFAULT false,
  visible boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS server_owned_connections_server_id_idx
  ON server_owned_connections (server_id);
CREATE INDEX IF NOT EXISTS server_owned_connections_provider_account_idx
  ON server_owned_connections (provider, account_id);
CREATE UNIQUE INDEX IF NOT EXISTS server_owned_connections_server_provider_account_unique
  ON server_owned_connections (server_id, provider, account_id);

-- End-to-end encryption for DMs, group DMs and their calls
-- (docs/architecture/e2ee.md). Additive + idempotent; also applied at boot by
-- ensureE2eeSchema() in src/lib/services/e2ee.ts.
--
-- messages.e2ee is nullable with NO default, so adding it is a metadata-only
-- change (no table rewrite) on PostgreSQL 11+. channels.e2ee has a constant
-- default, which is metadata-only too.

SET lock_timeout = '3s';

ALTER TABLE channels ADD COLUMN IF NOT EXISTS e2ee boolean DEFAULT false;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS e2ee jsonb;

CREATE TABLE IF NOT EXISTS e2ee_identities (
  user_id uuid PRIMARY KEY,
  identity_pub text NOT NULL,
  backup_pub text NOT NULL,
  backup_sig text NOT NULL,
  backup_blob text,
  backup_salt text,
  backup_iters integer,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS e2ee_devices (
  id text PRIMARY KEY,
  user_id uuid NOT NULL,
  ecdh_pub text NOT NULL,
  sign_pub text NOT NULL,
  device_sig text NOT NULL,
  identity_pub text NOT NULL,
  name text,
  created_at timestamp DEFAULT now(),
  last_seen_at timestamp DEFAULT now(),
  revoked_at timestamp
);

CREATE INDEX IF NOT EXISTS e2ee_devices_user_id_idx ON e2ee_devices (user_id);

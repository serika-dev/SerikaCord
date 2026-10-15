-- 6-digit PIN key backup and per-conversation "encryption turned off" records
-- (docs/architecture/e2ee.md "PIN backup" / "Turning encryption off").
-- Additive + idempotent; also applied at boot by ensureE2eeSchema(), so
-- applying it by hand is optional. Two new tables only: no existing table or
-- column changes, so older app versions are unaffected.
--
-- e2ee_pin_backups never holds anything that allows offline PIN guessing:
-- verifier_hash is an HMAC under a key derived from the E2EE_PIN_PEPPER
-- environment secret, and secret_enc (the server secret the bundle also
-- needs) is AES-GCM encrypted under another key derived from it.

SET lock_timeout = '3s';

CREATE TABLE IF NOT EXISTS e2ee_pin_backups (
  user_id uuid PRIMARY KEY,
  identity_pub text,
  salt text,
  iterations integer,
  bundle text,
  verifier_hash text,
  secret_enc text,
  pending_secret_enc text,
  pending_expires_at timestamp,
  attempts integer NOT NULL DEFAULT 0,
  locked_at timestamp,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS e2ee_conversation_states (
  channel_id uuid PRIMARY KEY,
  state text NOT NULL,
  record jsonb,
  updated_by uuid,
  updated_at timestamp DEFAULT now()
);

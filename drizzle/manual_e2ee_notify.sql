-- End-to-end encrypted push previews (docs/architecture/e2ee.md "Push
-- notifications"). Additive + idempotent; also applied at boot by
-- ensureE2eeSchema() (e2ee_notify_keys) and ensurePushSchema()
-- (push_devices.e2ee_notify_id), so applying it by hand is optional.
--
-- push_devices.e2ee_notify_id is nullable with no default: a metadata-only
-- change. Older app versions never read or write either object.

SET lock_timeout = '3s';

CREATE TABLE IF NOT EXISTS e2ee_notify_keys (
  id text PRIMARY KEY,
  user_id uuid NOT NULL,
  device_id text NOT NULL,
  ecdh_pub text NOT NULL,
  sig text NOT NULL,
  created_at timestamp DEFAULT now(),
  revoked_at timestamp
);
CREATE INDEX IF NOT EXISTS e2ee_notify_keys_user_id_idx ON e2ee_notify_keys (user_id);

ALTER TABLE push_devices ADD COLUMN IF NOT EXISTS e2ee_notify_id text;

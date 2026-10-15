-- Trust & Safety: account strikes, temporary restrictions, safety incidents
-- (PhotoDNA CSAM matches, scam-image matches), appeals and the staff-managed
-- scam image hash list. Additive + idempotent. Also applied automatically at
-- boot by ensureTrustSafetySchema() in src/lib/services/trustSafety.ts.
CREATE TABLE IF NOT EXISTS account_strikes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  category text NOT NULL DEFAULT 'other',
  reason text NOT NULL,
  source text NOT NULL DEFAULT 'staff',
  issued_by uuid,
  incident_id uuid,
  created_at timestamp NOT NULL DEFAULT now(),
  expires_at timestamp,
  revoked_at timestamp,
  revoked_by uuid,
  revoke_reason text
);
CREATE INDEX IF NOT EXISTS account_strikes_user_id_idx ON account_strikes (user_id);

CREATE TABLE IF NOT EXISTS account_restrictions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  type text NOT NULL DEFAULT 'chat',
  reason text NOT NULL,
  source text NOT NULL DEFAULT 'staff',
  issued_by uuid,
  incident_id uuid,
  created_at timestamp NOT NULL DEFAULT now(),
  until timestamp NOT NULL,
  lifted_at timestamp,
  lifted_by uuid
);
CREATE INDEX IF NOT EXISTS account_restrictions_user_id_idx ON account_restrictions (user_id);

CREATE TABLE IF NOT EXISTS safety_incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  kind text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  is_test boolean NOT NULL DEFAULT false,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  file_name text,
  content_type text,
  file_size integer,
  sha256 text,
  upload_category text,
  channel_id uuid,
  ip text,
  hash_id uuid,
  action_taken text,
  notes text,
  reviewed_by uuid,
  reviewed_at timestamp,
  ncmec_reported_at timestamp,
  ncmec_report_id text,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS safety_incidents_user_id_idx ON safety_incidents (user_id);
CREATE INDEX IF NOT EXISTS safety_incidents_status_idx ON safety_incidents (status, created_at);

CREATE TABLE IF NOT EXISTS account_appeals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  target_type text NOT NULL,
  target_id uuid,
  message text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  staff_note text,
  reviewed_by uuid,
  reviewed_at timestamp,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS account_appeals_user_id_idx ON account_appeals (user_id);
CREATE INDEX IF NOT EXISTS account_appeals_status_idx ON account_appeals (status, created_at);

CREATE TABLE IF NOT EXISTS scam_image_hashes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hash text NOT NULL,
  label text NOT NULL,
  max_distance integer NOT NULL DEFAULT 6,
  added_by uuid,
  match_count integer NOT NULL DEFAULT 0,
  last_matched_at timestamp,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS scam_image_hashes_hash_unique ON scam_image_hashes (hash);

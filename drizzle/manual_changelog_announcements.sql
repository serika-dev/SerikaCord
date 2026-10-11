-- Apply manually before deploying the admin changelog editor and popup feed.
-- Additive and safe to re-run. This file must not be applied by the application.
CREATE TABLE IF NOT EXISTS changelog_announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 120),
  version text CHECK (version IS NULL OR char_length(version) <= 32),
  body text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 30000),
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  published_by uuid,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS changelog_announcements_published_idx
  ON changelog_announcements (published_at, id);

CREATE TABLE IF NOT EXISTS changelog_receipts (
  user_id uuid NOT NULL,
  changelog_id uuid NOT NULL REFERENCES changelog_announcements(id),
  read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, changelog_id)
);

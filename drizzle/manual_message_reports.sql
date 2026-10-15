-- Message reports: the staff review queue for "Report Message" (ordinary and
-- end-to-end encrypted messages). Additive + idempotent. Also applied
-- automatically by ensureMessageReportsSchema() in
-- src/lib/services/messageReports.ts (at boot and before first use).
--
-- Reports filed before this table existed live in bug_reports (category
-- 'security', title 'Message report: ...'); they are copied in on first use of
-- the queue (legacy_bug_report_id, ON CONFLICT DO NOTHING). bug_reports is
-- left untouched.
CREATE TABLE IF NOT EXISTS message_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL,
  channel_id uuid NOT NULL,
  server_id uuid,
  channel_type text,
  channel_name text,
  reporter_id uuid NOT NULL,
  reported_user_id uuid NOT NULL,
  category text NOT NULL DEFAULT 'other',
  details text,
  content text,
  attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
  attachment_notes jsonb NOT NULL DEFAULT '[]'::jsonb,
  encrypted boolean NOT NULL DEFAULT false,
  franking_verified boolean NOT NULL DEFAULT false,
  message_sent_at timestamp,
  status text NOT NULL DEFAULT 'open',
  staff_note text,
  actions jsonb NOT NULL DEFAULT '[]'::jsonb,
  reviewed_by uuid,
  reviewed_at timestamp,
  reporter_notified_at timestamp,
  legacy_bug_report_id uuid,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS message_reports_status_idx ON message_reports (status, created_at);
CREATE INDEX IF NOT EXISTS message_reports_message_id_idx ON message_reports (message_id);
CREATE INDEX IF NOT EXISTS message_reports_reporter_id_idx ON message_reports (reporter_id);
CREATE INDEX IF NOT EXISTS message_reports_reported_user_id_idx ON message_reports (reported_user_id);
CREATE UNIQUE INDEX IF NOT EXISTS message_reports_legacy_bug_report_unique ON message_reports (legacy_bug_report_id);

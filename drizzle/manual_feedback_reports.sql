-- Extend bug_reports into a combined feedback + bug reporting system.

-- New "kind" enum distinguishing bug reports from feedback / feature requests.
DO $$ BEGIN
  CREATE TYPE "bug_report_kind" AS ENUM ('bug', 'feedback');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- New feedback-oriented categories added to the existing category enum.
ALTER TYPE "bug_report_category" ADD VALUE IF NOT EXISTS 'feature_request';
ALTER TYPE "bug_report_category" ADD VALUE IF NOT EXISTS 'improvement';
ALTER TYPE "bug_report_category" ADD VALUE IF NOT EXISTS 'praise';
ALTER TYPE "bug_report_category" ADD VALUE IF NOT EXISTS 'general';

-- Add the kind column (existing rows default to 'bug').
ALTER TABLE "bug_reports" ADD COLUMN IF NOT EXISTS "kind" "bug_report_kind" DEFAULT 'bug';

CREATE INDEX IF NOT EXISTS "bug_reports_kind_idx" ON "bug_reports" ("kind");

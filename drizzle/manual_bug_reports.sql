-- Bug Reports table
DO $$ BEGIN
  CREATE TYPE "bug_report_priority" AS ENUM ('low', 'medium', 'high', 'critical');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "bug_report_status" AS ENUM ('open', 'acknowledged', 'resolved', 'wont_fix');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "bug_report_category" AS ENUM ('crash', 'visual', 'functionality', 'performance', 'security', 'audio', 'network', 'ui_ux', 'other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "bug_reports" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "reporter_id" uuid NOT NULL,
  "title" text NOT NULL,
  "description" text NOT NULL,
  "category" "bug_report_category" DEFAULT 'other',
  "priority" "bug_report_priority" DEFAULT 'low',
  "status" "bug_report_status" DEFAULT 'open',
  "steps_to_reproduce" text,
  "expected_behavior" text,
  "actual_behavior" text,
  "attachments" jsonb DEFAULT '[]',
  "browser_info" text,
  "os_info" text,
  "app_version" text,
  "assigned_to" uuid,
  "admin_notes" text,
  "resolved_at" timestamp,
  "resolved_by" uuid,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "bug_reports_reporter_id_idx" ON "bug_reports" ("reporter_id");
CREATE INDEX IF NOT EXISTS "bug_reports_status_idx" ON "bug_reports" ("status");
CREATE INDEX IF NOT EXISTS "bug_reports_priority_idx" ON "bug_reports" ("priority");
CREATE INDEX IF NOT EXISTS "bug_reports_category_idx" ON "bug_reports" ("category");
CREATE INDEX IF NOT EXISTS "bug_reports_created_at_idx" ON "bug_reports" ("created_at");
CREATE INDEX IF NOT EXISTS "bug_reports_priority_created_at_idx" ON "bug_reports" ("priority", "created_at");

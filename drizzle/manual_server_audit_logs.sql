-- Server audit log (Discord-style): one row per moderation / settings action.
-- action_type uses Discord's AuditLogEvent numbers (src/lib/audit/auditLog.ts).
-- Additive + idempotent. The app also runs this at boot (ensureAuditLogSchema
-- in src/lib/services/auditLog.ts), so applying it by hand is optional.
CREATE TABLE IF NOT EXISTS "server_audit_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "server_id" uuid NOT NULL,
  "user_id" uuid,
  "action_type" integer NOT NULL,
  "target_id" text,
  "changes" jsonb DEFAULT '[]'::jsonb,
  "options" jsonb,
  "reason" text,
  "created_at" timestamp DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "server_audit_logs_server_created_idx" ON "server_audit_logs" ("server_id", "created_at");
CREATE INDEX IF NOT EXISTS "server_audit_logs_server_action_idx" ON "server_audit_logs" ("server_id", "action_type", "created_at");
CREATE INDEX IF NOT EXISTS "server_audit_logs_server_user_idx" ON "server_audit_logs" ("server_id", "user_id", "created_at");

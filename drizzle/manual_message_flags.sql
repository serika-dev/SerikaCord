-- Discord-style message flags (1<<12 = SUPPRESS_NOTIFICATIONS, "@silent").
-- Additive + idempotent. Also applied automatically at boot by
-- ensureMessageFlagsSchema() in src/lib/services/messageFlagsSchema.ts.
-- On PostgreSQL 11+ adding a column with a constant default is a metadata-only
-- change (no table rewrite).
SET lock_timeout = '3s';
ALTER TABLE messages ADD COLUMN IF NOT EXISTS "flags" integer NOT NULL DEFAULT 0;

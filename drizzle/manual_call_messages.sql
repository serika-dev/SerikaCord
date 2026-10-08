-- DM call log messages ("X started a call." / "You missed a call from X.").
-- Additive + idempotent. Also applied automatically at boot by
-- ensureCallMessageSchema() in src/lib/services/dmCallMessages.ts.
ALTER TYPE message_type ADD VALUE IF NOT EXISTS 'call';
ALTER TABLE messages ADD COLUMN IF NOT EXISTS "call" jsonb;

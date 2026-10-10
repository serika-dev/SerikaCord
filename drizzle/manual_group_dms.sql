-- Group DMs: system message types for membership / name / icon changes and a
-- group icon column on channels. Additive + idempotent. Also applied
-- automatically at boot by ensureGroupDmSchema() in
-- src/lib/services/groupDms.ts.
ALTER TYPE message_type ADD VALUE IF NOT EXISTS 'recipient_add';
ALTER TYPE message_type ADD VALUE IF NOT EXISTS 'recipient_remove';
ALTER TYPE message_type ADD VALUE IF NOT EXISTS 'channel_name_change';
ALTER TYPE message_type ADD VALUE IF NOT EXISTS 'channel_icon_change';
ALTER TABLE channels ADD COLUMN IF NOT EXISTS icon text;

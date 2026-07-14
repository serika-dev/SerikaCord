-- Add 'timeout_member' to the admin_action_type enum
ALTER TYPE admin_action_type ADD VALUE IF NOT EXISTS 'timeout_member';

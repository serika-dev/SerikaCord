-- Add interaction column to messages table for persisting bot slash-command
-- interaction references ({ name, user: { id, username } }) so the
-- "X used /command" header survives page reloads.

ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "interaction" jsonb;

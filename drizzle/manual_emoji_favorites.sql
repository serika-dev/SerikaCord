-- Add emoji_favorites column to users table
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "emoji_favorites" jsonb DEFAULT '[]';

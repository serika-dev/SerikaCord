-- Official ("Made by SerikaCord") apps: a staff-only flag set from
-- Settings → Admin → Apps & Bots (POST /api/admin/apps/:id/official).
-- Additive + idempotent: one nullable column with a constant default
-- (metadata-only add on PostgreSQL 11+). Also applied automatically at boot
-- by ensureAppDirectorySchema() (src/lib/services/appDirectorySchema.ts),
-- which skips it when present.
SET lock_timeout = '3s';
ALTER TABLE applications ADD COLUMN IF NOT EXISTS official boolean DEFAULT false;

-- Optional one-time data fix (also run at boot by backfillVerifiedBotUsers()):
-- bots of verified or official apps get users.is_verified, which the BOT
-- tag's check reads. Only sets true, only on bot users, only where not
-- already true. Safe to run any number of times.
UPDATE users u
SET is_verified = true, updated_at = now()
FROM applications a
WHERE a.bot_id = u.id
  AND u.is_bot = true
  AND COALESCE(u.is_verified, false) = false
  AND (a.verified = true OR a.official = true);

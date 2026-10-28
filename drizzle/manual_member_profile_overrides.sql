-- Per-server profiles: everything a member can override in one server beyond
-- the nickname / avatar / banner columns (bio, pronouns, display name style,
-- nameplate, profile theme colours). Absent keys = use the main profile.
-- Shape and validation: src/lib/profiles/memberProfile.ts.
-- Nullable without a default: a metadata-only change, no table rewrite.
-- Additive + idempotent. Also applied automatically at boot by
-- ensureMemberProfileSchema() in src/lib/services/memberProfileSchema.ts.
SET lock_timeout = '3s';
ALTER TABLE server_members ADD COLUMN IF NOT EXISTS "profile_overrides" jsonb;

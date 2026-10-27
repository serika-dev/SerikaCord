-- App Directory (/bots, Server Settings → App Discovery) and staff bot
-- verification review. Additive + idempotent: nullable columns, constant
-- defaults only (metadata-only adds on PostgreSQL 11+), no backfill.
-- Also applied automatically at boot by ensureAppDirectorySchema()
-- (src/lib/services/appDirectorySchema.ts), which skips it when present.
--
-- directory_listed NULL means "the owner never chose": verified apps keep
-- counting as listed (what the old /directory endpoint reported).
SET lock_timeout = '3s';
ALTER TABLE applications ADD COLUMN IF NOT EXISTS directory_listed boolean;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS directory_listed_at timestamp;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS directory_long_description text;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS directory_categories text[];
ALTER TABLE applications ADD COLUMN IF NOT EXISTS directory_website text;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS directory_support_url text;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS directory_featured boolean DEFAULT false;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS directory_delisted boolean DEFAULT false;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS directory_delisted_reason text;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS verification_requested_at timestamp;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS verification_reviewed_at timestamp;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS verification_reviewed_by uuid;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS verification_note text;

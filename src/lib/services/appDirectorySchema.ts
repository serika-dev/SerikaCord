// Boot-time schema ensure for the App Directory and verification review
// columns on `applications`. Mirrors drizzle/manual_app_directory.sql:
// additive, nullable, constant defaults only (metadata-only adds). Every
// Drizzle select on applications names these columns (src/lib/db/schema.ts),
// so initializeAPI() awaits this before serving. Nothing runs when the
// columns already exist; boot fails if they can't be added (lib/db/schemaGuard).
import { sql } from 'drizzle-orm';
import { ensureSchema, withLockTimeout } from '@/lib/db/schemaGuard';

const g = globalThis as unknown as { __appDirectorySchema?: Promise<void> | null };

const COLUMNS = [
  'directory_listed', 'directory_listed_at', 'directory_long_description', 'directory_categories',
  'directory_website', 'directory_support_url', 'directory_featured', 'directory_delisted',
  'directory_delisted_reason', 'verification_requested_at', 'verification_reviewed_at',
  'verification_reviewed_by', 'verification_note',
];

export function ensureAppDirectorySchema(): Promise<void> {
  if (g.__appDirectorySchema) return g.__appDirectorySchema;
  g.__appDirectorySchema = ensureSchema('app-directory', { tables: { applications: COLUMNS } }, async () => {
    await withLockTimeout([
      sql`ALTER TABLE applications ADD COLUMN IF NOT EXISTS directory_listed boolean`,
      sql`ALTER TABLE applications ADD COLUMN IF NOT EXISTS directory_listed_at timestamp`,
      sql`ALTER TABLE applications ADD COLUMN IF NOT EXISTS directory_long_description text`,
      sql`ALTER TABLE applications ADD COLUMN IF NOT EXISTS directory_categories text[]`,
      sql`ALTER TABLE applications ADD COLUMN IF NOT EXISTS directory_website text`,
      sql`ALTER TABLE applications ADD COLUMN IF NOT EXISTS directory_support_url text`,
      sql`ALTER TABLE applications ADD COLUMN IF NOT EXISTS directory_featured boolean DEFAULT false`,
      sql`ALTER TABLE applications ADD COLUMN IF NOT EXISTS directory_delisted boolean DEFAULT false`,
      sql`ALTER TABLE applications ADD COLUMN IF NOT EXISTS directory_delisted_reason text`,
      sql`ALTER TABLE applications ADD COLUMN IF NOT EXISTS verification_requested_at timestamp`,
      sql`ALTER TABLE applications ADD COLUMN IF NOT EXISTS verification_reviewed_at timestamp`,
      sql`ALTER TABLE applications ADD COLUMN IF NOT EXISTS verification_reviewed_by uuid`,
      sql`ALTER TABLE applications ADD COLUMN IF NOT EXISTS verification_note text`,
    ]);
  }, { backoffMs: (a) => Math.min(30_000, 2_000 * a) }).catch((err) => {
    g.__appDirectorySchema = null;
    throw err;
  });
  return g.__appDirectorySchema;
}

// Boot-time schema ensure for the App Directory, verification review and
// official columns on `applications`. Mirrors drizzle/manual_app_directory.sql
// and drizzle/manual_app_official.sql:
// additive, nullable, constant defaults only (metadata-only adds). Every
// Drizzle select on applications names these columns (src/lib/db/schema.ts),
// so initializeAPI() awaits this before serving. Nothing runs when the
// columns already exist; boot fails if they can't be added (lib/db/schemaGuard).
import { sql } from 'drizzle-orm';
import { db } from '@/lib/db/postgres';
import { ensureSchema, withLockTimeout } from '@/lib/db/schemaGuard';

const g = globalThis as unknown as { __appDirectorySchema?: Promise<void> | null };

const COLUMNS = [
  'directory_listed', 'directory_listed_at', 'directory_long_description', 'directory_categories',
  'directory_website', 'directory_support_url', 'directory_featured', 'directory_delisted',
  'directory_delisted_reason', 'verification_requested_at', 'verification_reviewed_at',
  'verification_reviewed_by', 'verification_note', 'official',
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
      sql`ALTER TABLE applications ADD COLUMN IF NOT EXISTS official boolean DEFAULT false`,
    ]);
  }, { backoffMs: (a) => Math.min(30_000, 2_000 * a) }).catch((err) => {
    g.__appDirectorySchema = null;
    throw err;
  });
  return g.__appDirectorySchema;
}

const backfill = globalThis as unknown as { __verifiedBotBackfill?: Promise<number> };

/**
 * One-time (per process), idempotent fix for bots verified before staff
 * actions synced the bot user: approving an app set applications.verified but
 * never users.is_verified, which is what the BOT tag's check reads. This only
 * ever sets is_verified = true, only on bot users (is_bot), only for apps that
 * are verified or official, and only where it is not already true. It never
 * unsets anything and never touches people's accounts. Never throws.
 */
export function backfillVerifiedBotUsers(): Promise<number> {
  if (backfill.__verifiedBotBackfill) return backfill.__verifiedBotBackfill;
  backfill.__verifiedBotBackfill = (async () => {
    try {
      await ensureAppDirectorySchema();
      const res = await db.execute(sql`
        UPDATE users u
        SET is_verified = true, updated_at = now()
        FROM applications a
        WHERE a.bot_id = u.id
          AND u.is_bot = true
          AND COALESCE(u.is_verified, false) = false
          AND (a.verified = true OR a.official = true)
      `);
      const count = Number((res as { rowCount?: number | null })?.rowCount ?? 0) || 0;
      if (count > 0) console.log(`[app-directory] marked ${count} verified bot user(s) as verified`);
      return count;
    } catch (err) {
      console.error('[app-directory] verified bot backfill failed (continuing):', (err as Error)?.message ?? err);
      return 0;
    }
  })();
  return backfill.__verifiedBotBackfill;
}

// Boot-time schema ensure for per-server profiles (server_members.profile_overrides).
// Mirrors drizzle/manual_member_profile_overrides.sql. Additive + idempotent;
// a nullable column without a default is a metadata-only change on
// PostgreSQL. The column is named in every Drizzle select on server_members
// (src/lib/db/schema.ts), so this runs in initializeAPI() before anything
// reads a member row, and boot fails when it can't be completed
// (lib/db/schemaGuard), leaving the old instance serving.
import { sql } from 'drizzle-orm';
import { ensureSchema, withLockTimeout } from '@/lib/db/schemaGuard';

const g = globalThis as unknown as { __memberProfileSchema?: Promise<void> | null };

export function ensureMemberProfileSchema(): Promise<void> {
  if (g.__memberProfileSchema) return g.__memberProfileSchema;
  g.__memberProfileSchema = ensureSchema('member-profiles', { tables: { server_members: ['profile_overrides'] } }, () => withLockTimeout([
    sql`ALTER TABLE server_members ADD COLUMN IF NOT EXISTS "profile_overrides" jsonb`,
  ]), { backoffMs: (a) => Math.min(5_000, 500 * a) }).catch((err) => {
    g.__memberProfileSchema = null;
    throw err;
  });
  return g.__memberProfileSchema;
}

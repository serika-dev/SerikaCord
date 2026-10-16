// Boot-time schema ensure for the Discord-parity thread / forum columns
// (channels.flags, channels.thread_invitable). Mirrors
// drizzle/manual_thread_parity.sql. Additive + idempotent; nullable columns
// without a default are a metadata-only change on PostgreSQL. Both columns are
// named in every Drizzle select on channels (src/lib/db/schema.ts), so this
// runs in initializeAPI() before anything reads a channel row, and boot fails
// when it can't be completed (lib/db/schemaGuard).
import { sql } from 'drizzle-orm';
import { ensureSchema, withLockTimeout } from '@/lib/db/schemaGuard';

const g = globalThis as unknown as { __threadParitySchema?: Promise<void> | null };

export function ensureThreadParitySchema(): Promise<void> {
  if (g.__threadParitySchema) return g.__threadParitySchema;
  g.__threadParitySchema = ensureSchema('threads', { tables: { channels: ['flags', 'thread_invitable'] } }, () => withLockTimeout([
    sql`ALTER TABLE channels ADD COLUMN IF NOT EXISTS "flags" integer`,
    sql`ALTER TABLE channels ADD COLUMN IF NOT EXISTS "thread_invitable" boolean`,
  ]), { backoffMs: (a) => Math.min(5_000, 500 * a) }).catch((err) => {
    g.__threadParitySchema = null;
    throw err;
  });
  return g.__threadParitySchema;
}

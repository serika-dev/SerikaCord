// Boot-time schema ensure for messages.flags (Discord message flags, used for
// "@silent"). Mirrors drizzle/manual_message_flags.sql. Additive + idempotent;
// a constant default makes it a metadata-only change on PostgreSQL 11+.
import { sql } from 'drizzle-orm';
import { db } from '@/lib/db/postgres';

const g = globalThis as unknown as { __messageFlagsSchema?: Promise<void> | null };

export function ensureMessageFlagsSchema(): Promise<void> {
  if (g.__messageFlagsSchema) return g.__messageFlagsSchema;
  g.__messageFlagsSchema = (async () => {
    // The messages table is shared with production: never queue behind a long
    // transaction holding a lock (that would stall every message query). Each
    // attempt gives up after a few seconds and is retried.
    for (let attempt = 1; attempt <= 10; attempt++) {
      try {
        await db.transaction(async (tx) => {
          await tx.execute(sql`SET LOCAL lock_timeout = '3s'`);
          await tx.execute(sql`ALTER TABLE messages ADD COLUMN IF NOT EXISTS "flags" integer NOT NULL DEFAULT 0`);
        });
        return;
      } catch (err) {
        console.error(`[messages] Ensuring message flags column failed (attempt ${attempt}):`, (err as Error)?.message ?? err);
        await new Promise((r) => setTimeout(r, Math.min(30_000, 2_000 * attempt)));
      }
    }
    g.__messageFlagsSchema = null;
  })();
  return g.__messageFlagsSchema;
}

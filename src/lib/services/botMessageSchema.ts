// Boot-time schema ensure for the Discord-parity message columns
// (messages.tts, messages.pinned_at). Mirrors
// drizzle/manual_bot_message_parity.sql. Additive + idempotent; nullable
// columns without a default are a metadata-only change on PostgreSQL.
import { sql } from 'drizzle-orm';
import { db } from '@/lib/db/postgres';

const g = globalThis as unknown as { __botMessageSchema?: Promise<void> | null };

export function ensureBotMessageSchema(): Promise<void> {
  if (g.__botMessageSchema) return g.__botMessageSchema;
  g.__botMessageSchema = (async () => {
    // The messages table is shared with production: never queue behind a long
    // transaction holding a lock (that would stall every message query). Each
    // attempt gives up after a few seconds and is retried.
    for (let attempt = 1; attempt <= 10; attempt++) {
      try {
        await db.transaction(async (tx) => {
          await tx.execute(sql`SET LOCAL lock_timeout = '3s'`);
          await tx.execute(sql`ALTER TABLE messages ADD COLUMN IF NOT EXISTS "tts" boolean`);
          await tx.execute(sql`ALTER TABLE messages ADD COLUMN IF NOT EXISTS "pinned_at" timestamp`);
        });
        return;
      } catch (err) {
        console.error(`[messages] Ensuring tts / pinned_at columns failed (attempt ${attempt}):`, (err as Error)?.message ?? err);
        await new Promise((r) => setTimeout(r, Math.min(30_000, 2_000 * attempt)));
      }
    }
    g.__botMessageSchema = null;
  })();
  return g.__botMessageSchema;
}

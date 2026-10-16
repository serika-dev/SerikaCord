// Boot-time schema ensure for the Discord-parity message columns
// (messages.tts, messages.pinned_at). Mirrors
// drizzle/manual_bot_message_parity.sql. Additive + idempotent; nullable
// columns without a default are a metadata-only change on PostgreSQL.
import { sql } from 'drizzle-orm';
import { ensureSchema, withLockTimeout } from '@/lib/db/schemaGuard';

const g = globalThis as unknown as { __botMessageSchema?: Promise<void> | null };

export function ensureBotMessageSchema(): Promise<void> {
  if (g.__botMessageSchema) return g.__botMessageSchema;
  // Skips the ALTER (and its lock on messages) when the columns exist; boot
  // fails when they can't be added (lib/db/schemaGuard).
  g.__botMessageSchema = ensureSchema('messages', { tables: { messages: ['tts', 'pinned_at'] } }, () => withLockTimeout([
    sql`ALTER TABLE messages ADD COLUMN IF NOT EXISTS "tts" boolean`,
    sql`ALTER TABLE messages ADD COLUMN IF NOT EXISTS "pinned_at" timestamp`,
  ]), { backoffMs: (a) => Math.min(5_000, 500 * a) }).catch((err) => {
    g.__botMessageSchema = null;
    throw err;
  });
  return g.__botMessageSchema;
}

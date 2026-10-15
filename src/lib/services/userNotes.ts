// Private notes a user keeps about other users ("Note — only visible to you"),
// one row per (owner, target) in `user_notes`. Never exposed to the target.
// The note text is encrypted at rest (fieldEncryption); notes saved before
// that are plaintext and read back unchanged.
import { and, eq, sql } from 'drizzle-orm';
import { db, schema } from '@/lib/db/postgres';
import { normalizeId } from '@/lib/db/normalizeId';
import { normalizeUserNote } from '@/lib/social/userNotes';
import { decryptField, encryptField } from '@/lib/security/fieldEncryption';

// ─── Boot-time schema ensure ──────────────────────────────────────────────────
// Mirrors drizzle/manual_user_notes_message_requests.sql. Additive + idempotent,
// with the same lock_timeout guard as the other boot DDL.
const g = globalThis as unknown as { __userNotesSchema?: Promise<void> | null };

export function ensureUserNotesSchema(): Promise<void> {
  if (g.__userNotesSchema) return g.__userNotesSchema;
  g.__userNotesSchema = (async () => {
    for (let attempt = 1; attempt <= 10; attempt++) {
      try {
        await db.transaction(async (tx) => {
          await tx.execute(sql`SET LOCAL lock_timeout = '3s'`);
          await tx.execute(sql`CREATE TABLE IF NOT EXISTS "user_notes" (
            "owner_id" uuid NOT NULL,
            "target_id" uuid NOT NULL,
            "note" text NOT NULL,
            "updated_at" timestamp DEFAULT now(),
            PRIMARY KEY ("owner_id", "target_id")
          )`);
        });
        return;
      } catch (err) {
        console.error(`[notes] Ensuring user notes schema failed (attempt ${attempt}):`, (err as Error)?.message ?? err);
        await new Promise((r) => setTimeout(r, Math.min(30_000, 2_000 * attempt)));
      }
    }
    g.__userNotesSchema = null;
  })();
  return g.__userNotesSchema;
}

const table = schema.userNotes;

/** All of the owner's notes, keyed by target user id (Discord: GET /users/@me/notes). */
export async function listUserNotes(ownerId: string): Promise<Record<string, string>> {
  await ensureUserNotesSchema();
  const rows = await db.select().from(table).where(eq(table.ownerId, normalizeId(ownerId)));
  const out: Record<string, string> = {};
  const notes = await Promise.all(rows.map((r) => decryptField(r.note)));
  rows.forEach((r, i) => { out[r.targetId] = notes[i]; });
  return out;
}

export async function getUserNote(ownerId: string, targetId: string): Promise<string> {
  await ensureUserNotesSchema();
  const [row] = await db
    .select()
    .from(table)
    .where(and(eq(table.ownerId, normalizeId(ownerId)), eq(table.targetId, normalizeId(targetId))))
    .limit(1);
  return row?.note ? decryptField(row.note) : '';
}

/** Save (or, when empty, delete) a note. Returns what is stored. */
export async function setUserNote(ownerId: string, targetId: string, raw: unknown): Promise<string> {
  await ensureUserNotesSchema();
  const note = normalizeUserNote(raw);
  const owner = normalizeId(ownerId);
  const target = normalizeId(targetId);
  if (!note) {
    await db.delete(table).where(and(eq(table.ownerId, owner), eq(table.targetId, target)));
    return '';
  }
  const stored = await encryptField(note);
  await db
    .insert(table)
    .values({ ownerId: owner, targetId: target, note: stored, updatedAt: new Date() })
    .onConflictDoUpdate({ target: [table.ownerId, table.targetId], set: { note: stored, updatedAt: new Date() } });
  return note;
}

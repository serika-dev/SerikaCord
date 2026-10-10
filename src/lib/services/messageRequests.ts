// DM Message Requests (Discord): a 1:1 DM a non-friend starts is held in the
// recipient's "Message Requests" list (no DM-list row, no badge, no push)
// until they accept it or reply. One row per (channel, recipient) in
// `dm_message_requests`; the decision logic is in lib/chat/messageRequests.ts.
import { and, eq, ne, sql } from 'drizzle-orm';
import { db, schema } from '@/lib/db/postgres';
import { normalizeId } from '@/lib/db/normalizeId';
import { decideOnSend, type MessageRequestStatus } from '@/lib/chat/messageRequests';
import { messageRequestsEnabled } from '@/lib/settings/privacy';

// ─── Boot-time schema ensure ──────────────────────────────────────────────────
// Mirrors drizzle/manual_user_notes_message_requests.sql. Additive + idempotent.
const g = globalThis as unknown as { __messageRequestSchema?: Promise<void> | null; __messageRequestSchemaOk?: boolean };

export function ensureMessageRequestSchema(): Promise<void> {
  if (g.__messageRequestSchema) return g.__messageRequestSchema;
  g.__messageRequestSchema = (async () => {
    for (let attempt = 1; attempt <= 10; attempt++) {
      try {
        await db.transaction(async (tx) => {
          await tx.execute(sql`SET LOCAL lock_timeout = '3s'`);
          await tx.execute(sql`CREATE TABLE IF NOT EXISTS "dm_message_requests" (
            "channel_id" uuid NOT NULL,
            "user_id" uuid NOT NULL,
            "requester_id" uuid NOT NULL,
            "status" text DEFAULT 'pending' NOT NULL,
            "created_at" timestamp DEFAULT now(),
            "updated_at" timestamp DEFAULT now(),
            PRIMARY KEY ("channel_id", "user_id")
          )`);
          await tx.execute(sql`CREATE INDEX IF NOT EXISTS "dm_message_requests_user_status_idx"
            ON "dm_message_requests" ("user_id", "status")`);
        });
        g.__messageRequestSchemaOk = true;
        return;
      } catch (err) {
        console.error(`[message-requests] Ensuring schema failed (attempt ${attempt}):`, (err as Error)?.message ?? err);
        await new Promise((r) => setTimeout(r, Math.min(30_000, 2_000 * attempt)));
      }
    }
    g.__messageRequestSchema = null;
  })();
  return g.__messageRequestSchema;
}

/** Whether the table is known to exist (DM-list reads skip the feature until it does). */
function schemaReady(): boolean {
  if (!g.__messageRequestSchemaOk) void ensureMessageRequestSchema();
  return Boolean(g.__messageRequestSchemaOk);
}

const table = schema.dmMessageRequests;

export interface RequestRow {
  channelId: string;
  userId: string;
  requesterId: string;
  status: MessageRequestStatus;
  createdAt: Date | null;
  updatedAt: Date | null;
}

function asStatus(s: string | null | undefined): MessageRequestStatus {
  return s === 'accepted' || s === 'ignored' ? s : 'pending';
}

/** The viewer's pending + ignored request rows (DM list filtering + the requests tab). */
export async function openRequestsFor(userId: string): Promise<RequestRow[]> {
  if (!schemaReady()) return [];
  try {
    const rows = await db
      .select()
      .from(table)
      .where(and(eq(table.userId, normalizeId(userId)), ne(table.status, 'accepted')));
    return rows.map((r) => ({ ...r, status: asStatus(r.status) }));
  } catch {
    return [];
  }
}

export async function getRequest(channelId: string, userId: string): Promise<RequestRow | null> {
  if (!schemaReady()) return null;
  try {
    const [row] = await db
      .select()
      .from(table)
      .where(and(eq(table.channelId, normalizeId(channelId)), eq(table.userId, normalizeId(userId))))
      .limit(1);
    return row ? { ...row, status: asStatus(row.status) } : null;
  } catch {
    return null;
  }
}

async function setStatus(channelId: string, userId: string, requesterId: string, status: MessageRequestStatus): Promise<void> {
  await db
    .insert(table)
    .values({ channelId: normalizeId(channelId), userId: normalizeId(userId), requesterId: normalizeId(requesterId), status, updatedAt: new Date() })
    .onConflictDoUpdate({ target: [table.channelId, table.userId], set: { status, updatedAt: new Date() } });
}

interface SendParty {
  id: string;
  friends?: string[] | null;
  isBot?: boolean | null;
  isSystem?: boolean | null;
  settings?: unknown;
}

/**
 * Record a 1:1 DM send. Returns true when, for the recipient, this message is a
 * message request (the caller then suppresses their DM-list bump, unread badge
 * and notification, and signals `message_request` instead). The sender's own
 * pending request in this channel (if any) is accepted: replying accepts.
 */
export async function recordDmSend(channelId: string, sender: SendParty, recipient: SendParty): Promise<boolean> {
  await ensureMessageRequestSchema();
  if (!g.__messageRequestSchemaOk) return false;
  try {
    const cid = normalizeId(channelId);
    const senderId = normalizeId(sender.id);
    const recipientId = normalizeId(recipient.id);
    // Replying accepts your own request.
    await db
      .update(table)
      .set({ status: 'accepted', updatedAt: new Date() })
      .where(and(eq(table.channelId, cid), eq(table.userId, senderId), ne(table.status, 'accepted')));

    const areFriends = (sender.friends || []).some((f) => normalizeId(f) === recipientId);
    const existing = await getRequest(cid, recipientId);
    let recipientHasPosted = false;
    if (!existing && !areFriends) {
      const [m] = await db
        .select({ id: schema.messages.id })
        .from(schema.messages)
        .where(and(eq(schema.messages.channelId, cid), eq(schema.messages.authorId, recipientId)))
        .limit(1);
      recipientHasPosted = Boolean(m);
    }
    const decision = decideOnSend({
      areFriends,
      recipientRequestsEnabled: messageRequestsEnabled(recipient.settings as Parameters<typeof messageRequestsEnabled>[0]),
      involvesBotOrSystem: Boolean(sender.isBot || sender.isSystem || recipient.isBot || recipient.isSystem),
      existing: existing?.status ?? null,
      recipientHasPosted,
    });
    if (decision === 'accept') await setStatus(cid, recipientId, existing?.requesterId ?? senderId, 'accepted');
    if (decision === 'request') {
      if (!existing) await setStatus(cid, recipientId, senderId, 'pending');
      return true;
    }
    return false;
  } catch (err) {
    console.error('[message-requests] recordDmSend failed:', (err as Error)?.message ?? err);
    return false;
  }
}

/** Accept (moves the DM into the DM list) or ignore (hides it). False when there is no request. */
export async function resolveRequest(userId: string, channelId: string, status: 'accepted' | 'ignored'): Promise<boolean> {
  await ensureMessageRequestSchema();
  const existing = await getRequest(channelId, userId);
  if (!existing) return false;
  await db
    .update(table)
    .set({ status, updatedAt: new Date() })
    .where(and(eq(table.channelId, normalizeId(channelId)), eq(table.userId, normalizeId(userId))));
  return true;
}

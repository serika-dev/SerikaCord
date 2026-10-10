// Server side of threads in text / announcement channels: the boot-time schema
// ensure, thread summaries (the starter message chip and the threads browser),
// atomic thread membership, live updates, and the auto-archive sweep.
//
//   create (POST /channels/:id/threads) ─▶ thread row (parentId = channel)
//        from a message: starter.threadId = thread, chip on the starter
//        from the header: a 'thread_created' row in the channel
//   message in the thread ─▶ author + @mentioned join, count refreshed,
//        `thread_update` on the parent stream re-renders the chip
//   idle past auto_archive_duration ─▶ archived by the sweep (any instance;
//        the UPDATE's row locks keep it to one), a new message unarchives
//
// Routes live in src/lib/api/channels.ts.
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from '@/lib/db/postgres';
import { normalizeId } from '@/lib/db/normalizeId';
import { Channel, Message, User, type IChannel } from '@/lib/models';
import { decryptFromStorage } from '@/lib/security';
import { processShared } from '@/lib/realtime/processShared';
import {
  isThreadType,
  type ThreadLastMessage,
  type ThreadSummary,
  type ThreadType,
} from '@/lib/chat/threads';

// ─── Boot-time schema ensure ──────────────────────────────────────────────────
// Mirrors drizzle/manual_threads.sql. Additive + idempotent. ADD VALUE can't
// share a transaction with its first use, so it runs alone; the column adds
// never wait long behind a lock on the shared channels table.
const g = globalThis as unknown as { __threadSchema?: Promise<void> | null };

export function ensureThreadSchema(): Promise<void> {
  if (g.__threadSchema) return g.__threadSchema;
  g.__threadSchema = (async () => {
    for (let attempt = 1; attempt <= 10; attempt++) {
      try {
        await db.execute(sql`ALTER TYPE message_type ADD VALUE IF NOT EXISTS 'thread_created'`);
        await db.transaction(async (tx) => {
          await tx.execute(sql`SET LOCAL lock_timeout = '3s'`);
          await tx.execute(sql`ALTER TABLE channels ADD COLUMN IF NOT EXISTS auto_archive_duration integer`);
          await tx.execute(sql`ALTER TABLE channels ADD COLUMN IF NOT EXISTS archive_timestamp timestamp`);
          await tx.execute(sql`ALTER TABLE channels ADD COLUMN IF NOT EXISTS starter_message_id uuid`);
        });
        return;
      } catch (err) {
        console.error(`[threads] Ensuring thread schema failed (attempt ${attempt}):`, (err as Error)?.message ?? err);
        await new Promise((r) => setTimeout(r, Math.min(30_000, 2_000 * attempt)));
      }
    }
    g.__threadSchema = null;
  })();
  return g.__threadSchema;
}

// ─── Summaries ────────────────────────────────────────────────────────────────
const iso = (d: Date | string | null | undefined): string | null => {
  if (!d) return null;
  const t = new Date(d);
  return Number.isNaN(t.getTime()) ? null : t.toISOString();
};

export function toThreadSummary(row: IChannel, lastMessage?: ThreadLastMessage | null): ThreadSummary {
  return {
    id: row.id,
    name: row.name,
    type: (row.type === 'private_thread' ? 'private_thread' : 'public_thread') as ThreadType,
    parentId: row.parentId ?? null,
    ownerId: row.ownerId ?? null,
    archived: Boolean(row.archived),
    locked: Boolean(row.locked),
    messageCount: row.messageCount ?? 0,
    memberCount: (row.threadMemberIds || []).length,
    autoArchiveDuration: row.autoArchiveDuration ?? null,
    archiveTimestamp: iso(row.archiveTimestamp),
    createdAt: iso(row.createdAt),
    starterMessageId: row.starterMessageId ?? null,
    lastMessage: lastMessage ?? null,
  };
}

/** Last-message previews for a set of threads (one batched load). */
async function loadLastMessages(rows: IChannel[]): Promise<Map<string, ThreadLastMessage>> {
  const out = new Map<string, ThreadLastMessage>();
  const lastIds = rows.map((r) => r.lastMessageId).filter((id): id is string => Boolean(id));
  if (lastIds.length === 0) return out;
  const msgs = await Message.find({ id: { in: lastIds }, isDeleted: false });
  const authorIds = [...new Set(msgs.map((m) => m.authorId).filter(Boolean))];
  const authors = authorIds.length ? await User.find({ id: { in: authorIds } }) : [];
  const authorMap = new Map(authors.map((a) => [a.id, a]));
  const contents = await Promise.all(msgs.map((m) => decryptFromStorage(m.content || '').catch(() => '')));
  const byId = new Map(msgs.map((m, i) => [m.id, { m, content: contents[i] }]));
  for (const row of rows) {
    const hit = row.lastMessageId ? byId.get(row.lastMessageId) : undefined;
    if (!hit) continue;
    const a = authorMap.get(hit.m.authorId);
    out.set(row.id, {
      id: hit.m.id,
      content: hit.content.slice(0, 300),
      createdAt: iso(hit.m.createdAt) ?? new Date().toISOString(),
      author: a
        ? { id: a.id, username: a.username, displayName: a.displayName || a.username, avatar: a.avatar ?? null }
        : null,
    });
  }
  return out;
}

/** Summaries (with last-message previews) for thread rows, keyed by thread id. */
export async function loadThreadSummaries(rows: IChannel[]): Promise<Map<string, ThreadSummary>> {
  const threads = rows.filter((r) => isThreadType(r.type));
  const last = await loadLastMessages(threads).catch(() => new Map<string, ThreadLastMessage>());
  return new Map(threads.map((r) => [r.id, toThreadSummary(r, last.get(r.id))]));
}

/** Summaries for thread ids referenced by a page of messages (messages.thread_id). */
export async function loadThreadSummariesByIds(ids: string[]): Promise<Map<string, ThreadSummary>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return new Map();
  const rows = await Channel.find({ id: { in: unique } });
  return loadThreadSummaries(rows);
}

/** Live (not deleted) messages in a thread, capped: the chip shows "50+" anyway. */
export async function countThreadMessages(threadId: string): Promise<number> {
  const res = await db.execute<{ count: number }>(sql`
    SELECT count(*)::int AS count FROM (
      SELECT 1 FROM ${schema.messages}
      WHERE ${schema.messages.channelId} = ${normalizeId(threadId)}::uuid
        AND ${schema.messages.isDeleted} = false
      LIMIT 1000
    ) t`);
  return Number(res.rows[0]?.count) || 0;
}

async function publish(channelId: string, data: object) {
  const { publishToChannel } = await import('@/lib/api/channels');
  publishToChannel(channelId, data);
}

/**
 * Tell everyone watching that a thread changed: the parent channel re-renders
 * the starter chip / "started a thread" row and its threads browser, the
 * thread's own view updates its header (archived, locked, name).
 */
export async function broadcastThreadUpdate(row: IChannel, opts: { deleted?: boolean } = {}): Promise<ThreadSummary | null> {
  if (opts.deleted) {
    if (row.parentId) {
      await publish(row.parentId, { type: 'thread_update', threadId: row.id, messageId: row.starterMessageId ?? null, thread: null });
    }
    return null;
  }
  const summary = (await loadThreadSummaries([row])).get(row.id) ?? toThreadSummary(row);
  if (row.parentId) {
    await publish(row.parentId, { type: 'thread_update', threadId: row.id, messageId: row.starterMessageId ?? null, thread: summary });
  }
  await publish(row.id, { type: 'thread_state', thread: summary });
  return summary;
}

/**
 * After a message lands in (or is removed from) a thread: recount, store the
 * count, and push the new summary to the parent channel. Fire-and-forget.
 */
export function refreshThreadAfterMessage(threadId: string): void {
  void (async () => {
    const count = await countThreadMessages(threadId);
    const row = await Channel.updateById(threadId, { messageCount: count });
    if (row && isThreadType(row.type)) await broadcastThreadUpdate(row);
  })().catch((err: Error) => console.error('[threads] refresh failed:', err?.message));
}

/**
 * Point a channel message at the thread started from it, only if no thread
 * claimed it first (two people clicking "Create Thread" at once). Doesn't
 * touch updatedAt: starting a thread isn't an edit.
 */
export async function claimStarterMessage(messageId: string, threadId: string): Promise<boolean> {
  const rows = await db
    .update(schema.messages)
    .set({ threadId: normalizeId(threadId) })
    .where(and(
      eq(schema.messages.id, normalizeId(messageId)),
      sql`${schema.messages.threadId} IS NULL`,
    ))
    .returning({ id: schema.messages.id });
  return rows.length > 0;
}

/** A deleted thread leaves its starter message (chip gone) and "started a thread" row behind. */
export async function releaseThreadMessages(threadId: string, parentId: string): Promise<void> {
  // Scoped to the parent channel so it rides the channel_id index (there is
  // no index on thread_id).
  await db
    .update(schema.messages)
    .set({ threadId: null })
    .where(and(
      eq(schema.messages.channelId, normalizeId(parentId)),
      eq(schema.messages.threadId, normalizeId(threadId)),
    ));
}

// ─── Membership ───────────────────────────────────────────────────────────────
/** Atomically add users to a thread. Returns the ids that were newly added. */
export async function addThreadMembers(threadId: string, userIds: string[]): Promise<string[]> {
  const ids = [...new Set(userIds.filter(Boolean).map((id) => normalizeId(id).toLowerCase()))];
  if (ids.length === 0) return [];
  const before = await Channel.findById(threadId);
  if (!before) return [];
  const had = new Set((before.threadMemberIds || []).map((id) => id.toLowerCase()));
  const fresh = ids.filter((id) => !had.has(id));
  if (fresh.length === 0) return [];
  const arr = sql.join(fresh.map((id) => sql`${id}::uuid`), sql`, `);
  await db
    .update(schema.channels)
    .set({
      threadMemberIds: sql`ARRAY(SELECT DISTINCT x FROM unnest(coalesce(${schema.channels.threadMemberIds}, '{}'::uuid[]) || ARRAY[${arr}]) AS x)`,
    })
    .where(eq(schema.channels.id, normalizeId(threadId)));
  return fresh;
}

/** Atomically remove a user from a thread. */
export async function removeThreadMember(threadId: string, userId: string): Promise<void> {
  await db
    .update(schema.channels)
    .set({ threadMemberIds: sql`array_remove(coalesce(${schema.channels.threadMemberIds}, '{}'::uuid[]), ${normalizeId(userId)}::uuid)` })
    .where(eq(schema.channels.id, normalizeId(threadId)));
}

/**
 * Users whose joined-thread list changed (joined, left, archived, deleted):
 * their sidebar refetches the server's channels.
 */
export function notifyThreadMembership(serverId: string | null | undefined, threadId: string, userIds: string[]): void {
  if (!serverId || userIds.length === 0) return;
  void import('@/lib/api/activity')
    .then(({ fanoutToUsers }) =>
      fanoutToUsers({ userIds: [...new Set(userIds)] }, { type: 'thread_members_update', serverId, threadId }),
    )
    .catch(() => { /* best-effort */ });
}

// ─── Archive state ────────────────────────────────────────────────────────────
/**
 * Archive / unarchive (and optionally lock) a thread. archive_timestamp is set
 * on every change: it restarts the inactivity clock on unarchive (Discord).
 * Returns the updated row, or null when it doesn't exist.
 */
export async function setThreadArchived(threadId: string, archived: boolean, locked?: boolean): Promise<IChannel | null> {
  const set: Record<string, unknown> = {
    archived,
    archiveTimestamp: sql`now()`,
    updatedAt: sql`now()`,
  };
  if (locked !== undefined) set.locked = locked;
  const [row] = await db
    .update(schema.channels)
    .set(set)
    .where(eq(schema.channels.id, normalizeId(threadId)))
    .returning();
  return row ?? null;
}

/**
 * One pass of the auto-archive sweep: archive every thread with an
 * auto-archive window whose newest activity (last message, last archive
 * change, creation) is older than it. Returns the archived rows.
 */
export async function archiveIdleThreads(): Promise<IChannel[]> {
  const c = schema.channels;
  const rows = await db
    .update(c)
    .set({ archived: true, archiveTimestamp: sql`now()`, updatedAt: sql`now()` })
    .where(and(
      inArray(c.type, ['public_thread', 'private_thread']),
      sql`${c.archived} IS NOT TRUE`,
      sql`${c.autoArchiveDuration} IS NOT NULL`,
      sql`GREATEST(
        coalesce((SELECT m.created_at FROM messages m WHERE m.id = ${c.lastMessageId}), ${c.createdAt}),
        coalesce(${c.archiveTimestamp}, ${c.createdAt}),
        ${c.createdAt}
      ) < now() - (${c.autoArchiveDuration} * interval '1 minute')`,
    ))
    .returning();
  return rows;
}

const SWEEP_MS = 5 * 60_000;
const sweepState = processShared('threads:autoArchive', () => ({ timer: null as ReturnType<typeof setInterval> | null }));

/** Start the periodic auto-archive sweep (once per process). */
export function startThreadAutoArchive(): void {
  if (sweepState.timer) return;
  const run = async () => {
    try {
      const archived = await archiveIdleThreads();
      for (const row of archived) {
        await broadcastThreadUpdate(row).catch(() => null);
        notifyThreadMembership(row.serverId, row.id, row.threadMemberIds || []);
      }
    } catch (err) {
      console.error('[threads] auto-archive sweep failed:', (err as Error)?.message ?? err);
    }
  };
  sweepState.timer = setInterval(() => void run(), SWEEP_MS);
  // Don't keep a process alive just for the sweep.
  (sweepState.timer as { unref?: () => void }).unref?.();
  setTimeout(() => void run(), 30_000);
}

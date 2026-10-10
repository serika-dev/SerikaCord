// Server side of polls and forwarded messages: the boot-time schema ensure,
// vote tallies, closing polls (and posting their "poll results" row), and the
// per-viewer extras every message page carries (`poll`, `pollResult`,
// `forward`). The pure rules live in lib/chat/polls.ts and lib/chat/forward.ts;
// the routes are in lib/api/messageExtras.ts.
//
//   poll created  ─▶ messages.poll = StoredPoll, id added to Redis ZSET polls:open
//   vote          ─▶ poll_votes rows replaced, `poll_update` published
//   expiry        ─▶ the sweeper (every 15s, any instance) or the first page
//                    load after expiry calls finalizePoll(): an atomic UPDATE
//                    marks it finalized exactly once, then the result row is
//                    posted and `poll_update {closed}` published
import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import { db, schema } from '@/lib/db/postgres';
import { getRedis } from '@/lib/db/redis';
import { Channel, Message, Server, User } from '@/lib/models';
import { decryptFromStorage } from '@/lib/security';
import { batchParseCustomEmojis } from '@/lib/services/emoji';
import { processShared } from '@/lib/realtime/processShared';
import { cache } from '@/lib/db';
import {
  buildPollResult,
  buildPollView,
  isPollExpired,
  parsePollResult,
  parseStoredPoll,
  pollPreviewText,
  type PollUpdateEvent,
  type PollView,
  type StoredPoll,
} from '@/lib/chat/polls';
import { forwardJumpHref, parseStoredForward, type ForwardOrigin, type ForwardView, type StoredForward } from '@/lib/chat/forward';

type MessageRow = typeof schema.messages.$inferSelect;
type ConversationRef = { id: string; serverId?: string | null; type?: string | null; name?: string | null; recipientIds?: string[] | null };

// ─── Boot-time schema ensure ──────────────────────────────────────────────────
// Mirrors drizzle/manual_polls_forwarding.sql. Additive + idempotent. ADD VALUE
// can't share a transaction with its first use, so it runs alone.
const g = globalThis as unknown as { __messageExtrasSchema?: Promise<void> | null };

export function ensureMessageExtrasSchema(): Promise<void> {
  if (g.__messageExtrasSchema) return g.__messageExtrasSchema;
  g.__messageExtrasSchema = (async () => {
    // The messages table is shared with production: never queue behind a long
    // transaction holding a lock. Each attempt gives up after a few seconds.
    for (let attempt = 1; attempt <= 10; attempt++) {
      try {
        await db.execute(sql`ALTER TYPE message_type ADD VALUE IF NOT EXISTS 'poll_result'`);
        await db.transaction(async (tx) => {
          await tx.execute(sql`SET LOCAL lock_timeout = '3s'`);
          await tx.execute(sql`ALTER TABLE messages ADD COLUMN IF NOT EXISTS "poll" jsonb`);
          await tx.execute(sql`ALTER TABLE messages ADD COLUMN IF NOT EXISTS "message_snapshot" jsonb`);
        });
        await db.transaction(async (tx) => {
          await tx.execute(sql`SET LOCAL lock_timeout = '3s'`);
          await tx.execute(sql`CREATE TABLE IF NOT EXISTS poll_votes (
            message_id uuid NOT NULL,
            user_id uuid NOT NULL,
            answer_id integer NOT NULL,
            created_at timestamp DEFAULT now()
          )`);
          await tx.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS poll_votes_message_user_answer_idx ON poll_votes (message_id, user_id, answer_id)`);
          await tx.execute(sql`CREATE INDEX IF NOT EXISTS poll_votes_message_answer_idx ON poll_votes (message_id, answer_id)`);
        });
        return;
      } catch (err) {
        console.error(`[polls] Ensuring poll/forward schema failed (attempt ${attempt}):`, (err as Error)?.message ?? err);
        await new Promise((r) => setTimeout(r, Math.min(30_000, 2_000 * attempt)));
      }
    }
    g.__messageExtrasSchema = null;
  })();
  return g.__messageExtrasSchema;
}

// ─── Realtime ─────────────────────────────────────────────────────────────────
/** Publish a client event to a conversation's stream (server channel or DM / group DM). */
export async function publishToConversation(channel: ConversationRef, data: object): Promise<void> {
  if (channel.serverId) {
    const { publishToChannel } = await import('@/lib/api/channels');
    publishToChannel(channel.id, data);
  } else {
    const { publishToDm } = await import('@/lib/api/dms');
    publishToDm(channel.id, data);
  }
}

// ─── Tallies ──────────────────────────────────────────────────────────────────
export type PollTally = { counts: Record<number, number>; totalVoters: number; myVotes: number[] };

/** Vote counts, voter totals and the viewer's own votes for a set of poll messages. */
export async function loadPollTallies(messageIds: string[], viewerId?: string | null): Promise<Map<string, PollTally>> {
  const out = new Map<string, PollTally>();
  if (messageIds.length === 0) return out;
  for (const id of messageIds) out.set(id, { counts: {}, totalVoters: 0, myVotes: [] });
  const pv = schema.pollVotes;
  const [counts, voters, mine] = await Promise.all([
    db.select({ messageId: pv.messageId, answerId: pv.answerId, count: sql<number>`count(*)::int` })
      .from(pv).where(inArray(pv.messageId, messageIds)).groupBy(pv.messageId, pv.answerId),
    db.select({ messageId: pv.messageId, count: sql<number>`count(distinct ${pv.userId})::int` })
      .from(pv).where(inArray(pv.messageId, messageIds)).groupBy(pv.messageId),
    viewerId
      ? db.select({ messageId: pv.messageId, answerId: pv.answerId })
          .from(pv).where(and(inArray(pv.messageId, messageIds), eq(pv.userId, viewerId)))
      : Promise.resolve([] as Array<{ messageId: string; answerId: number }>),
  ]);
  for (const r of counts) {
    const t = out.get(r.messageId);
    if (t) t.counts[r.answerId] = Number(r.count) || 0;
  }
  for (const r of voters) {
    const t = out.get(r.messageId);
    if (t) t.totalVoters = Number(r.count) || 0;
  }
  for (const r of mine) {
    const t = out.get(r.messageId);
    if (t) t.myVotes.push(r.answerId);
  }
  for (const t of out.values()) t.myVotes.sort((a, b) => a - b);
  return out;
}

/** Replace a user's votes on a poll. Returns the previous answer ids. */
export async function replacePollVotes(messageId: string, userId: string, answerIds: number[]): Promise<number[]> {
  const pv = schema.pollVotes;
  return db.transaction(async (tx) => {
    const prev = await tx.select({ answerId: pv.answerId }).from(pv)
      .where(and(eq(pv.messageId, messageId), eq(pv.userId, userId)));
    await tx.delete(pv).where(and(eq(pv.messageId, messageId), eq(pv.userId, userId)));
    if (answerIds.length > 0) {
      await tx.insert(pv)
        .values(answerIds.map((answerId) => ({ messageId, userId, answerId })))
        .onConflictDoNothing();
    }
    return prev.map((r) => r.answerId);
  });
}

/** Who voted for one answer (newest first), for the "view votes" list. */
export async function loadPollVoters(messageId: string, answerId: number, limit = 100) {
  const pv = schema.pollVotes;
  const rows = await db.select({ userId: pv.userId }).from(pv)
    .where(and(eq(pv.messageId, messageId), eq(pv.answerId, answerId)))
    .orderBy(sql`${pv.createdAt} desc`)
    .limit(limit);
  const ids = rows.map((r) => r.userId);
  const users = ids.length ? await User.find({ id: { in: ids } }) : [];
  const byId = new Map(users.map((u) => [u.id, u]));
  return ids
    .map((id) => byId.get(id))
    .filter((u): u is NonNullable<typeof u> => Boolean(u))
    .map((u) => ({ id: u.id, username: u.username, displayName: u.displayName || u.username, avatar: u.avatar ?? null }));
}

// ─── Open-poll schedule ───────────────────────────────────────────────────────
const OPEN_POLLS_KEY = 'polls:open';

export async function scheduleOpenPoll(messageId: string, expiresAt: string): Promise<void> {
  try {
    const redis = getRedis();
    if (redis) await redis.zadd(OPEN_POLLS_KEY, Date.parse(expiresAt), messageId);
  } catch { /* the lazy close on page load still covers it */ }
}

async function unscheduleOpenPoll(messageId: string): Promise<void> {
  try {
    const redis = getRedis();
    if (redis) await redis.zrem(OPEN_POLLS_KEY, messageId);
  } catch { /* best-effort */ }
}

const sweeper = processShared('polls:sweeper', () => ({ timer: null as ReturnType<typeof setInterval> | null, running: false }));

/** Close expired polls every 15s. Idempotent per process; safe on several instances. */
export function startPollSweeper(): void {
  if (sweeper.timer) return;
  const tick = async () => {
    if (sweeper.running) return;
    sweeper.running = true;
    try {
      const redis = getRedis();
      if (!redis) return;
      const due = await redis.zrangebyscore(OPEN_POLLS_KEY, 0, Date.now(), 'LIMIT', 0, 50);
      for (const id of due) {
        await finalizePoll(id).catch((err) => console.error('[polls] closing poll failed:', err));
        await unscheduleOpenPoll(id);
      }
    } catch (err) {
      console.error('[polls] sweep failed:', (err as Error)?.message ?? err);
    } finally {
      sweeper.running = false;
    }
  };
  sweeper.timer = setInterval(() => void tick(), 15_000);
  (sweeper.timer as { unref?: () => void }).unref?.();
}

// ─── Closing a poll ───────────────────────────────────────────────────────────
// Ids being closed by this process right now (page loads can race the sweeper).
const closing = processShared('polls:closing', () => new Set<string>());

/**
 * Close a poll exactly once (atomic across instances): freeze it, post the
 * "poll results" row and tell everyone watching. `early` (the author ended it)
 * also moves the expiry to now. Returns false when it was already closed.
 */
export async function finalizePoll(messageId: string, opts: { early?: boolean } = {}): Promise<boolean> {
  if (closing.has(messageId)) return false;
  closing.add(messageId);
  try {
    const nowIso = new Date().toISOString();
    const patch: Record<string, string> = { finalizedAt: nowIso };
    if (opts.early) patch.expiresAt = nowIso;
    const m = schema.messages;
    const [row] = await db.update(m)
      .set({ poll: sql`${m.poll} || ${JSON.stringify(patch)}::jsonb` })
      .where(and(
        eq(m.id, messageId),
        sql`${m.poll} IS NOT NULL`,
        sql`(${m.poll}->>'finalizedAt') IS NULL`,
        sql`(${m.poll}->>'kind') IS NULL`,
        ne(m.type, 'poll_result'),
        eq(m.isDeleted, false),
        ...(opts.early ? [] : [sql`(${m.poll}->>'expiresAt')::timestamptz <= now()`]),
      ))
      .returning();
    if (!row) return false;
    const poll = parseStoredPoll(row.poll);
    if (!poll) return false;
    void unscheduleOpenPoll(messageId);

    const [tallies, channel, author] = await Promise.all([
      loadPollTallies([messageId]),
      Channel.findById(row.channelId),
      User.findById(row.authorId),
    ]);
    const tally = tallies.get(messageId) ?? { counts: {}, totalVoters: 0, myVotes: [] };
    if (!channel) return true;

    const update: PollUpdateEvent = {
      type: 'poll_update',
      messageId,
      counts: tally.counts,
      totalVoters: tally.totalVoters,
      closed: true,
      finalizedAt: nowIso,
    };
    await publishToConversation(channel, update);

    // The "poll results" row, posted as the poll's author like Discord.
    const result = buildPollResult(messageId, poll, tally.counts, tally.totalVoters);
    const resultRow = await Message.create({
      channelId: row.channelId,
      serverId: row.serverId,
      authorId: row.authorId,
      content: '',
      type: 'poll_result',
      referencedMessageId: messageId,
      poll: result,
    });
    void Channel.updateById(channel.id, { lastMessageId: resultRow.id }).catch(() => {});

    const payload = {
      id: resultRow.id,
      content: '',
      type: 'poll_result' as const,
      authorId: row.authorId,
      author: author ? {
        id: author.id,
        username: author.username,
        displayName: author.displayName || author.username,
        avatar: author.avatar,
        badges: author.badges || [],
        isBot: Boolean(author.isBot),
        isSystem: Boolean(author.isSystem),
        isVerified: Boolean(author.isVerified),
        customization: author.customization || null,
      } : { id: row.authorId, username: 'unknown', displayName: 'Unknown' },
      channelId: row.channelId,
      serverId: row.serverId,
      createdAt: resultRow.createdAt,
      updatedAt: resultRow.updatedAt,
      attachments: [],
      embeds: [],
      reactions: [],
      referencedMessageId: messageId,
      pollResult: result,
    };
    await publishToConversation(channel, { type: 'message', message: payload });

    const preview = pollPreviewText(poll.question);
    if (channel.serverId) {
      const { signalChannelMessage } = await import('@/lib/services/messageSignals');
      void signalChannelMessage({
        channel,
        messageId: resultRow.id,
        authorId: row.authorId,
        authorName: author?.displayName || author?.username,
        authorAvatar: author?.avatar ?? null,
        content: preview,
        createdAt: resultRow.createdAt,
      });
    } else {
      const { signalDmMessage } = await import('@/lib/services/messageSignals');
      void signalDmMessage({
        channelId: channel.id,
        recipientIds: (channel.recipientIds || []) as string[],
        messageId: resultRow.id,
        authorId: row.authorId,
        authorName: author?.displayName || author?.username,
        authorAvatar: author?.avatar ?? null,
        content: preview,
        createdAt: resultRow.createdAt,
        isSystem: true,
      });
    }
    void import('@/lib/services/gatewayEvents')
      .then(({ emitMessageCreate }) => emitMessageCreate(payload as never))
      .catch(() => {});
    return true;
  } finally {
    closing.delete(messageId);
  }
}

// ─── Forward origins ──────────────────────────────────────────────────────────
/** The jump link for a forward's original, or null when the viewer can't open it. */
export async function resolveForwardOrigin(viewerId: string, stored: Pick<StoredForward, 'channelId' | 'messageId'>): Promise<ForwardOrigin | null> {
  const { checkChannelAccess } = await import('@/lib/api/channels');
  const access = await checkChannelAccess(viewerId, stored.channelId).catch(() => null);
  if (!access?.hasAccess || !access.channel) return null;
  const channel = access.channel as { id: string; type?: string | null; name?: string | null; serverId?: string | null; recipientIds?: string[] | null };
  if (channel.type === 'dm') {
    const other = (channel.recipientIds || []).find((id) => id.toLowerCase() !== viewerId.toLowerCase());
    if (!other) return null;
    const user = await User.findById(other).catch(() => null);
    return { kind: 'dm', name: user ? (user.displayName || user.username) : null, href: forwardJumpHref({ kind: 'dm', recipientId: other }, stored.messageId) };
  }
  if (channel.type === 'group_dm') {
    return { kind: 'group_dm', name: channel.name || null, href: forwardJumpHref({ kind: 'group_dm', channelId: channel.id }, stored.messageId) };
  }
  if (!channel.serverId) return null;
  const cacheKey = `server:name:${channel.serverId}`;
  let serverName = await cache.get<string>(cacheKey).catch(() => null);
  if (!serverName) {
    const server = await Server.findById(channel.serverId).catch(() => null);
    serverName = server?.name ?? null;
    if (serverName) void cache.set(cacheKey, serverName, 3600).catch(() => {});
  }
  return {
    kind: 'channel',
    serverId: channel.serverId,
    serverName,
    channelName: channel.name ?? null,
    href: forwardJumpHref({ kind: 'channel', serverId: channel.serverId, channelId: channel.id }, stored.messageId),
  };
}

/**
 * A forward as clients render it. `origin` is resolved for `viewerId`, or left
 * undefined (the client asks on click) for payloads broadcast to everyone.
 */
export async function forwardViewFor(stored: StoredForward, viewerId: string | null, originCache?: Map<string, Promise<ForwardOrigin | null>>): Promise<ForwardView> {
  const content = stored.content ? await decryptFromStorage(stored.content) : '';
  const [emoji] = content ? await batchParseCustomEmojis([content]) : [{ emojis: [] as Array<{ id: string; name: string; animated?: boolean; url: string }> }];
  let origin: ForwardOrigin | null | undefined;
  if (viewerId) {
    const key = `${stored.channelId}:${stored.messageId}`;
    let p = originCache?.get(key);
    if (!p) {
      p = resolveForwardOrigin(viewerId, stored);
      originCache?.set(key, p);
    }
    origin = await p;
  }
  const customEmojis = emoji?.emojis?.map((e) => ({ id: e.id, name: e.name, animated: e.animated, url: e.url })) ?? [];
  return {
    messageId: stored.messageId,
    channelId: stored.channelId,
    author: stored.author,
    content,
    attachments: stored.attachments,
    embeds: stored.embeds,
    sticker: stored.sticker,
    ...(customEmojis.length ? { customEmojis } : {}),
    createdAt: stored.createdAt,
    edited: stored.edited,
    ...(origin !== undefined ? { origin } : {}),
  };
}

// ─── Per-page extras ──────────────────────────────────────────────────────────
export type MessageExtras = {
  type?: 'poll_result';
  poll?: PollView;
  pollResult?: ReturnType<typeof parsePollResult>;
  forward?: ForwardView;
};

/**
 * Poll tallies, poll result rows and forwards for one page of messages, as
 * `viewerId` sees them. Messages with none of these are absent from the map.
 * Also closes any poll on the page that expired without being closed yet.
 */
export async function loadMessageExtras(rows: MessageRow[], viewerId: string | null): Promise<Map<string, MessageExtras>> {
  const out = new Map<string, MessageExtras>();
  const pollRows: Array<{ id: string; poll: StoredPoll }> = [];
  const forwardRows: Array<{ id: string; stored: StoredForward }> = [];
  for (const row of rows) {
    if (row.type === 'poll_result') {
      out.set(row.id, { type: 'poll_result', pollResult: parsePollResult(row.poll) });
      continue;
    }
    const poll = row.poll ? parseStoredPoll(row.poll) : null;
    if (poll) pollRows.push({ id: row.id, poll });
    const stored = row.messageSnapshot ? parseStoredForward(row.messageSnapshot) : null;
    if (stored) forwardRows.push({ id: row.id, stored });
  }
  if (pollRows.length === 0 && forwardRows.length === 0) return out;

  const originCache = new Map<string, Promise<ForwardOrigin | null>>();
  const [tallies, forwards] = await Promise.all([
    pollRows.length ? loadPollTallies(pollRows.map((p) => p.id), viewerId) : Promise.resolve(new Map<string, PollTally>()),
    Promise.all(forwardRows.map((f) => forwardViewFor(f.stored, viewerId, originCache).catch(() => null))),
  ]);
  const now = Date.now();
  for (const { id, poll } of pollRows) {
    const t = tallies.get(id) ?? { counts: {}, totalVoters: 0, myVotes: [] };
    out.set(id, { ...(out.get(id) ?? {}), poll: buildPollView(poll, t.counts, t.totalVoters, t.myVotes, now) });
    // Expired but never closed (sweeper missed it): close it now.
    if (!poll.finalizedAt && isPollExpired(poll, now)) void finalizePoll(id).catch(() => {});
  }
  forwardRows.forEach(({ id }, i) => {
    const view = forwards[i];
    if (view) out.set(id, { ...(out.get(id) ?? {}), forward: view });
  });
  return out;
}

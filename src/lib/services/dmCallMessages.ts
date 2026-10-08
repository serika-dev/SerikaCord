// Server side of the "call" message a DM call leaves in the conversation.
//
//   first join of an empty dm:<a>_<b> room ─▶ create the message (type 'call')
//   someone else joins                      ─▶ answered = true, add participant
//   room empties (hang up, declined, no answer, dropped) ─▶ endedAt = now
//
// voice.ts calls these from /voice/join and evictFromRoom. Each room's work is
// serialized in-process; across instances the active message id lives in Redis
// (claimed with SET NX before the row is inserted) so two instances never
// create two messages for the same call, and a resume (same session re-joining
// after a blip) never creates a new one.
import { randomUUID } from 'crypto';
import { sql } from 'drizzle-orm';
import { db } from '@/lib/db/postgres';
import { getRedis } from '@/lib/db/redis';
import { Channel, Message } from '@/lib/models';
import { dmCallPeers } from '@/lib/chat/dmCall';
import { processShared } from '@/lib/realtime/processShared';
import {
  callDataEnd,
  callDataJoin,
  callPreviewText,
  newCallData,
  parseCallData,
  type CallMessageData,
} from '@/lib/voice/callMessage';

/** The user joining a call, as /voice/join has it after authentication. */
export type CallJoiner = {
  id: string;
  username: string;
  displayName?: string | null;
  avatar?: string | null;
  badges?: string[] | null;
  isPremium?: boolean | null;
  customization?: unknown;
};

// ─── Boot-time schema ensure ──────────────────────────────────────────────────
// Mirrors drizzle/manual_call_messages.sql. Additive + idempotent. ADD VALUE
// can't share a transaction with its first use, so each statement runs alone.
const g = globalThis as unknown as { __callMessageSchema?: Promise<void> | null };

export function ensureCallMessageSchema(): Promise<void> {
  if (g.__callMessageSchema) return g.__callMessageSchema;
  g.__callMessageSchema = (async () => {
    // The messages table is shared with production: never queue behind a long
    // transaction holding a lock (that would stall every message query). Each
    // attempt gives up after a few seconds and is retried.
    for (let attempt = 1; attempt <= 10; attempt++) {
      try {
        await db.execute(sql`ALTER TYPE message_type ADD VALUE IF NOT EXISTS 'call'`);
        await db.transaction(async (tx) => {
          await tx.execute(sql`SET LOCAL lock_timeout = '3s'`);
          await tx.execute(sql`ALTER TABLE messages ADD COLUMN IF NOT EXISTS "call" jsonb`);
        });
        return;
      } catch (err) {
        console.error(`[calls] Ensuring call message schema failed (attempt ${attempt}):`, (err as Error)?.message ?? err);
        await new Promise((r) => setTimeout(r, Math.min(30_000, 2_000 * attempt)));
      }
    }
    g.__callMessageSchema = null;
  })();
  return g.__callMessageSchema;
}

// ─── Active call message per room ─────────────────────────────────────────────
const KEY_TTL_SECONDS = 24 * 60 * 60;
const redisKey = (roomId: string) => `dmcall:msg:${roomId}`;
// roomId -> message id (this instance's view; Redis is the shared truth).
const activeCallMessages = processShared('voice:dmCallMessages', () => new Map<string, string>());
// roomId -> tail of that room's queued work.
const roomQueues = processShared('voice:dmCallMessageQueues', () => new Map<string, Promise<void>>());

function serialize(roomId: string, fn: () => Promise<void>): Promise<void> {
  const prev = roomQueues.get(roomId) ?? Promise.resolve();
  const next = prev.then(fn, fn).catch((err) => {
    console.error('[calls] call message update failed:', err);
  });
  roomQueues.set(roomId, next);
  void next.finally(() => {
    if (roomQueues.get(roomId) === next) roomQueues.delete(roomId);
  });
  return next;
}

async function getActiveId(roomId: string): Promise<string | null> {
  const redis = getRedis();
  if (redis) {
    try {
      const id = await redis.get(redisKey(roomId));
      if (id) activeCallMessages.set(roomId, id);
      else activeCallMessages.delete(roomId);
      return id;
    } catch {
      // fall back to this instance's view
    }
  }
  return activeCallMessages.get(roomId) ?? null;
}

/** Claim the room for a new message id. False when another one got there first. */
async function claim(roomId: string, messageId: string): Promise<boolean> {
  const redis = getRedis();
  if (redis) {
    try {
      const ok = await redis.set(redisKey(roomId), messageId, 'EX', KEY_TTL_SECONDS, 'NX');
      if (ok !== 'OK') return false;
      activeCallMessages.set(roomId, messageId);
      return true;
    } catch {
      // fall through to local-only
    }
  }
  if (activeCallMessages.has(roomId)) return false;
  activeCallMessages.set(roomId, messageId);
  return true;
}

async function release(roomId: string, messageId: string) {
  if (activeCallMessages.get(roomId) === messageId) activeCallMessages.delete(roomId);
  const redis = getRedis();
  if (!redis) return;
  try {
    // Only drop the key if it still points at this call.
    if ((await redis.get(redisKey(roomId))) === messageId) await redis.del(redisKey(roomId));
  } catch {
    /* expires on its own */
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The call message row, waiting briefly for another instance's insert to land. */
async function loadCallMessage(messageId: string, attempts = 1) {
  for (let i = 0; i < attempts; i++) {
    const row = await Message.findById(messageId);
    if (row) return row.type === 'call' ? row : null;
    if (i < attempts - 1) await sleep(250);
  }
  return null;
}

// ─── Live updates ─────────────────────────────────────────────────────────────
async function publishCallUpdate(channelId: string, messageId: string, call: CallMessageData) {
  const { publishToDm } = await import('@/lib/api/dms');
  publishToDm(channelId, { type: 'call_update', messageId, call });
}

/** Refresh both people's DM list preview ("📞 Missed call") without bumping the order. */
async function publishPreview(
  channelId: string,
  peers: [string, string],
  messageId: string,
  call: CallMessageData,
  createdAt: Date | string | null | undefined,
) {
  const { emitDmListUpdate } = await import('@/lib/api/dms');
  const at = new Date(createdAt ?? call.startedAt).toISOString();
  for (const userId of peers) {
    const other = peers[0] === userId ? peers[1] : peers[0];
    emitDmListUpdate([userId], {
      type: 'dm:list:update',
      channelId,
      recipientId: other,
      message: { id: messageId, content: callPreviewText(call, userId), authorId: call.callerId, createdAt: at, type: 'call' },
    });
  }
}

async function createCallMessage(roomId: string, peers: [string, string], caller: CallJoiner, messageId: string) {
  const callee = peers[0] === caller.id.toLowerCase() ? peers[1] : peers[0];
  const { getOrCreateDMChannel } = await import('@/lib/api/dms');
  const channel = await getOrCreateDMChannel(caller.id, callee);
  const call = newCallData(caller.id);
  const message = await Message.create({
    id: messageId,
    channelId: channel.id,
    authorId: caller.id,
    content: '',
    type: 'call',
    call,
  });
  void Channel.updateById(channel.id, { lastMessageId: message.id }).catch(() => {});

  const messageData = {
    id: message.id,
    type: 'call' as const,
    call,
    content: '',
    authorId: caller.id,
    author: {
      id: caller.id,
      username: caller.username,
      displayName: caller.displayName || caller.username,
      avatar: caller.avatar ?? undefined,
      badges: caller.badges || [],
      isPremium: Boolean(caller.isPremium),
      customization: caller.customization || null,
    },
    channelId: channel.id,
    createdAt: message.createdAt,
    attachments: [],
  };
  const { publishToDm } = await import('@/lib/api/dms');
  publishToDm(channel.id, { type: 'message', message: messageData });

  // DM list bump for both + unread badge / notification for the callee.
  const { signalDmMessage } = await import('@/lib/services/messageSignals');
  await signalDmMessage({
    channelId: channel.id,
    recipientIds: [caller.id, callee],
    messageId: message.id,
    authorId: caller.id,
    authorName: caller.displayName || caller.username,
    authorAvatar: caller.avatar ?? null,
    content: callPreviewText(call, callee),
    createdAt: message.createdAt,
  });
}

async function endCallMessage(roomId: string, messageId: string) {
  // Another instance may still be inserting it (a call that ended instantly).
  const row = await loadCallMessage(messageId, 4);
  await release(roomId, messageId);
  if (!row) return;
  const data = parseCallData(row.call);
  if (!data || data.endedAt) return;
  const ended = callDataEnd(data);
  await Message.updateById(row.id, { call: ended });
  await publishCallUpdate(row.channelId, row.id, ended);
  const peers = dmCallPeers(roomId);
  if (peers) await publishPreview(row.channelId, peers, row.id, ended, row.createdAt);
}

// ─── Entry points (called by voice.ts) ────────────────────────────────────────

/**
 * A user joined a DM call room (not a resume of the same session).
 * `roomWasEmpty`: nobody else was in the room before this join.
 */
export function onDmCallJoin(roomId: string, user: CallJoiner, roomWasEmpty: boolean): Promise<void> {
  const peers = dmCallPeers(roomId);
  if (!peers) return Promise.resolve();
  return serialize(roomId, async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const activeId = await getActiveId(roomId);
      if (activeId) {
        // Another instance may still be inserting it: give it a moment.
        const row = await loadCallMessage(activeId, 4);
        const data = row ? parseCallData(row.call) : null;
        // A leftover from a call that never got closed (crash, restart):
        // an empty room means this is a new call.
        if (row && data && !data.endedAt && roomWasEmpty) {
          await endCallMessage(roomId, activeId);
          continue;
        }
        if (row && data && !data.endedAt) {
          const next = callDataJoin(data, user.id);
          if (next !== data) {
            await Message.updateById(row.id, { call: next });
            await publishCallUpdate(row.channelId, row.id, next);
          }
          return;
        }
        // Gone or already over: forget it and start a new one.
        await release(roomId, activeId);
        continue;
      }
      // Only someone entering an empty room starts a call.
      if (!roomWasEmpty) return;
      const messageId = randomUUID();
      if (!(await claim(roomId, messageId))) continue; // lost the race; join theirs
      try {
        await createCallMessage(roomId, peers, user, messageId);
      } catch (err) {
        await release(roomId, messageId);
        throw err;
      }
      return;
    }
  });
}

/** The room is empty: the call is over. */
export function onDmCallRoomEmpty(roomId: string): Promise<void> {
  if (!dmCallPeers(roomId)) return Promise.resolve();
  return serialize(roomId, async () => {
    const activeId = await getActiveId(roomId);
    if (activeId) await endCallMessage(roomId, activeId);
  });
}

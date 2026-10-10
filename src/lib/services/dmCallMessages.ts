// Server side of the "call" message a DM call leaves in the conversation, for
// 1:1 calls (dm:<a>_<b>) and group DM calls (gdm:<channelId>).
//
//   first join of an empty room ─▶ create the message (type 'call')
//   someone else joins          ─▶ answered = true, add participant
//   someone declines            ─▶ remembered (declined, not missed)
//   room empties (hang up, declined, no answer, dropped) ─▶ endedAt = now,
//                                  and everyone who was rung but never joined
//                                  or declined gets a `call_missed` event
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
import { Channel, Message, User } from '@/lib/models';
import { dmCallPeers, groupDisplayName, type CallGroup, type CallMissed } from '@/lib/chat/dmCall';
import { processShared } from '@/lib/realtime/processShared';
import { groupCallChannelId } from '@/lib/voice/rooms';
import {
  callDataDecline,
  callDataEnd,
  callDataJoin,
  callPreviewText,
  missedCallRecipients,
  newCallData,
  parseCallData,
  type CallMessageData,
} from '@/lib/voice/callMessage';

/** Which conversation a call room belongs to. */
type CallTarget = { kind: 'dm'; peers: [string, string] } | { kind: 'group'; channelId: string };

function callTarget(roomId: string): CallTarget | null {
  const peers = dmCallPeers(roomId);
  if (peers) return { kind: 'dm', peers };
  const channelId = groupCallChannelId(roomId);
  return channelId ? { kind: 'group', channelId } : null;
}

/** The group DM channel behind a group call, or null if it's gone / not a group DM. */
export async function loadGroupCallChannel(channelId: string) {
  const channel = await Channel.findById(channelId);
  if (!channel || channel.type !== 'group_dm') return null;
  return channel;
}

/** The group info shown on ring cards and missed-call notifications. */
export async function describeCallGroup(
  channel: { id: string; name?: string | null; recipientIds?: string[] | null; icon?: string | null },
  viewerId?: string,
): Promise<CallGroup> {
  const ids = (channel.recipientIds || []).filter((id) => !viewerId || id.toLowerCase() !== viewerId.toLowerCase());
  const users = ids.length ? await User.find({ id: { in: ids.slice(0, 10) } }).catch(() => []) : [];
  const names = users.map((u) => u.displayName || u.username).filter(Boolean) as string[];
  return {
    channelId: channel.id,
    name: groupDisplayName(channel.name, names),
    icon: channel.icon ?? null,
    memberCount: (channel.recipientIds || []).length,
  };
}

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

/** Refresh everyone's DM list preview ("📞 Missed call") without bumping the order. */
async function publishPreview(
  channelId: string,
  members: string[],
  messageId: string,
  call: CallMessageData,
  createdAt: Date | string | null | undefined,
) {
  const { emitDmListUpdate } = await import('@/lib/api/dms');
  const at = new Date(createdAt ?? call.startedAt).toISOString();
  for (const userId of members) {
    const other = members.length === 2
      ? (members[0] === userId ? members[1] : members[0])
      : call.callerId;
    emitDmListUpdate([userId], {
      type: 'dm:list:update',
      channelId,
      recipientId: other,
      message: { id: messageId, content: callPreviewText(call, userId), authorId: call.callerId, createdAt: at, type: 'call' },
    });
  }
}

async function createCallMessage(target: CallTarget, caller: CallJoiner, messageId: string) {
  let channel: { id: string };
  let recipients: string[];
  let call: CallMessageData;
  let group: CallGroup | null = null;
  if (target.kind === 'dm') {
    const peers = target.peers;
    const callee = peers[0] === caller.id.toLowerCase() ? peers[1] : peers[0];
    const { getOrCreateDMChannel } = await import('@/lib/api/dms');
    channel = await getOrCreateDMChannel(caller.id, callee);
    recipients = [caller.id, callee];
    call = newCallData(caller.id);
  } else {
    const groupChannel = await loadGroupCallChannel(target.channelId);
    if (!groupChannel) throw new Error('Group DM not found');
    channel = groupChannel;
    recipients = [...(groupChannel.recipientIds || [])];
    call = newCallData(caller.id, Date.now(), recipients);
    group = await describeCallGroup(groupChannel).catch(() => null);
  }
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

  // DM list bump for everyone + unread badge / notification for the callees.
  const { signalDmMessage } = await import('@/lib/services/messageSignals');
  const someCallee = recipients.find((id) => id.toLowerCase() !== caller.id.toLowerCase()) ?? null;
  await signalDmMessage({
    channelId: channel.id,
    recipientIds: recipients,
    messageId: message.id,
    authorId: caller.id,
    authorName: caller.displayName || caller.username,
    authorAvatar: caller.avatar ?? null,
    content: callPreviewText(call, someCallee),
    createdAt: message.createdAt,
    isCall: true,
    group,
  });
}

/** Tell everyone who was rung and never picked up (or declined) that they missed it. */
async function notifyMissed(roomId: string, target: CallTarget, messageId: string, channelId: string, call: CallMessageData) {
  const missed = missedCallRecipients(call, target.kind === 'dm' ? target.peers : undefined);
  if (missed.length === 0) return;
  const caller = await User.findById(call.callerId).catch(() => null);
  if (!caller) return;
  let group: CallGroup | null = null;
  if (target.kind === 'group') {
    const channel = await loadGroupCallChannel(target.channelId);
    if (channel) group = await describeCallGroup(channel);
  }
  const payload: { type: 'call_missed' } & CallMissed = {
    type: 'call_missed',
    callId: messageId,
    roomId,
    channelId,
    caller: {
      id: caller.id,
      username: caller.username,
      displayName: caller.displayName || caller.username,
      avatar: caller.avatar || null,
    },
    group,
    endedAt: call.endedAt ?? new Date().toISOString(),
  };
  const { fanoutToUsers } = await import('@/lib/api/activity');
  await fanoutToUsers({ userIds: missed }, payload);
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
  const target = callTarget(roomId);
  if (!target) return;
  const members = target.kind === 'dm' ? target.peers : (ended.memberIds || []);
  await publishPreview(row.channelId, members, row.id, ended, row.createdAt);
  // Only the run that closes the call gets here (endedAt was still null), so
  // each person is told once per call.
  await notifyMissed(roomId, target, row.id, row.channelId, ended).catch((err) => {
    console.error('[calls] missed-call notification failed:', err);
  });
}

// ─── Entry points (called by voice.ts) ────────────────────────────────────────

/**
 * A user joined a DM call room (not a resume of the same session).
 * `roomWasEmpty`: nobody else was in the room before this join.
 */
export function onDmCallJoin(roomId: string, user: CallJoiner, roomWasEmpty: boolean): Promise<void> {
  const target = callTarget(roomId);
  if (!target) return Promise.resolve();
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
        await createCallMessage(target, user, messageId);
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
  if (!callTarget(roomId)) return Promise.resolve();
  return serialize(roomId, async () => {
    const activeId = await getActiveId(roomId);
    if (activeId) await endCallMessage(roomId, activeId);
  });
}

/**
 * Someone pressed Decline on a ringing call: when it ends they get "declined"
 * instead of a missed-call notification.
 */
export function onDmCallDecline(roomId: string, userId: string): Promise<void> {
  if (!callTarget(roomId)) return Promise.resolve();
  return serialize(roomId, async () => {
    const activeId = await getActiveId(roomId);
    if (!activeId) return;
    const row = await loadCallMessage(activeId, 4);
    const data = row ? parseCallData(row.call) : null;
    if (!row || !data) return;
    const next = callDataDecline(data, userId);
    if (next === data) return;
    await Message.updateById(row.id, { call: next });
    await publishCallUpdate(row.channelId, row.id, next);
  });
}

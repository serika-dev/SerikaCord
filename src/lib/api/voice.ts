import { Elysia, t } from 'elysia';
import { authenticateRequest } from '@/lib/services/auth';
import { config } from '@/lib/config';
import { getPublisher } from '@/lib/db';
import { randomUUID } from 'crypto';
import { User, type IServerSettings, type IUserSettings } from '@/lib/models';
import { dmCallPeers } from '@/lib/chat/dmCall';
import { isSystemUser } from '@/lib/services/systemUsers';
import { fanoutToUsers } from './activity';
import { checkChannelAccess } from './channels';
import { BoundedMap } from '@/lib/utils/boundedMap';
import { processShared, PROCESS_INSTANCE_ID } from '@/lib/realtime/processShared';
import {
  parseVoiceRoomId,
  isDmRoomPeer,
  hasRoomForParticipant,
  canSignalBetween,
  groupCallChannelId,
  groupCallRingTargets,
  isGroupCallMember,
} from '@/lib/voice/rooms';
import {
  describeCallGroup,
  loadGroupCallChannel,
  onDmCallDecline,
  onDmCallJoin,
  onDmCallRoomEmpty,
} from '@/lib/services/dmCallMessages';

const sseEncoder = new TextEncoder();

async function getAuth(headers: Record<string, string | undefined>, cookie: Record<string, { value?: unknown }>) {
  const authHeader = headers.authorization ?? null;
  const authToken = cookie.auth_token?.value;
  const cookies: Record<string, string> = {};
  if (typeof authToken === 'string') {
    cookies.auth_token = authToken;
  }
  return authenticateRequest(authHeader, cookies);
}

type VoiceParticipant = {
  userId: string;
  username: string;
  displayName?: string;
  avatar?: string;
  audio: boolean;
  video: boolean;
  deafened: boolean;
  joinedAt: string;
  /** The tab/device this membership belongs to; a join from another replaces it. */
  sessionId?: string;
};

// Local mirror of every voice room's membership. Kept in sync across instances
// via the Redis `voice:members` bus, so a client connecting to ANY instance
// sees everyone in the room (WebRTC media stays fully P2P — only this small bit
// of signaling/presence goes through the server).
// Process-shared (see processShared.ts) so every copy of this module sees the
// same rooms and streams.
const roomState = processShared('voice:roomState', () => new Map<string, Map<string, VoiceParticipant>>());

// SSE connections per voice room: roomId -> userId -> controller set (per process)
const voiceSignalingConnections = processShared(
  'voice:signalConnections',
  () => new Map<string, Map<string, Set<ReadableStreamDefaultController>>>(),
);

// A dropped signaling stream (network blip, laptop sleep, Wi-Fi switch) only
// removes its user from the room after this grace period, so a quick
// reconnect resumes the call instead of ending it for everyone.
const SIGNAL_DROP_GRACE_MS = 12_000;
const pendingEvictions = processShared('voice:pendingEvictions', () => new Map<string, ReturnType<typeof setTimeout>>());
const evictionKey = (roomId: string, userId: string) => `${roomId}|${userId}`;

function cancelEviction(roomId: string, userId: string) {
  const key = evictionKey(roomId, userId);
  const timer = pendingEvictions.get(key);
  if (timer) {
    clearTimeout(timer);
    pendingEvictions.delete(key);
  }
}

// Cross-instance buses. `originId` lets an instance skip echoes of its own
// publishes (it already delivered/applied them locally).
const INSTANCE_ID = PROCESS_INSTANCE_ID || randomUUID();
const VOICE_SSE_BUS = 'voice:sse';       // client-bound SSE payloads
const VOICE_MEMBERS_BUS = 'voice:members'; // room membership sync

function getRoom(roomId: string) {
  if (!roomState.has(roomId)) {
    roomState.set(roomId, new Map());
  }
  return roomState.get(roomId)!;
}

// ── Local-only delivery ─────────────────────────────────────────────────────
function deliverToRoomLocal(roomId: string, payload: object, excludeUserId?: string) {
  const encoded = sseEncoder.encode(`data: ${JSON.stringify(payload)}\n\n`);
  const roomConnections = voiceSignalingConnections.get(roomId);
  if (!roomConnections) return;
  for (const [userId, controllers] of roomConnections.entries()) {
    if (excludeUserId && userId === excludeUserId) continue;
    for (const controller of controllers) {
      try {
        controller.enqueue(encoded);
      } catch {
        controllers.delete(controller);
      }
    }
  }
}

function deliverToUserLocal(roomId: string, targetUserId: string, payload: object) {
  const encoded = sseEncoder.encode(`data: ${JSON.stringify(payload)}\n\n`);
  const roomConnections = voiceSignalingConnections.get(roomId);
  if (!roomConnections) return;
  const controllers = roomConnections.get(targetUserId);
  if (!controllers) return;
  for (const controller of controllers) {
    try {
      controller.enqueue(encoded);
    } catch {
      controllers.delete(controller);
    }
  }
}

// ── Cross-instance delivery (local + Redis fan-out) ─────────────────────────
function broadcastToRoom(roomId: string, payload: object, excludeUserId?: string) {
  deliverToRoomLocal(roomId, payload, excludeUserId);
  const pub = getPublisher();
  if (pub) {
    pub.publish(VOICE_SSE_BUS, JSON.stringify({ originId: INSTANCE_ID, roomId, excludeUserId, payload })).catch(() => {});
  }
}

function sendToUser(roomId: string, targetUserId: string, payload: object) {
  deliverToUserLocal(roomId, targetUserId, payload);
  const pub = getPublisher();
  if (pub) {
    pub.publish(VOICE_SSE_BUS, JSON.stringify({ originId: INSTANCE_ID, roomId, targetUserId, payload })).catch(() => {});
  }
}

// Propagate a membership change to other instances' room mirrors.
function publishMembership(roomId: string, action: 'join' | 'leave', data: object) {
  const pub = getPublisher();
  if (pub) {
    pub.publish(VOICE_MEMBERS_BUS, JSON.stringify({ originId: INSTANCE_ID, roomId, action, ...data })).catch(() => {});
  }
}

// ── DM calls ────────────────────────────────────────────────────────────────
// Ringing goes out over each user's app-wide activity stream (not the voice
// room's SSE, which the callee hasn't opened yet).
function notifyCall(userIds: string[], payload: Record<string, unknown>) {
  void fanoutToUsers({ userIds }, payload).catch(() => {});
}

// Group calls: who is being rung for each room (so the ring can be stopped
// once the room empties). This instance's view; the group's member list is
// the fallback when the ring went out from another instance.
const groupRinging = processShared('voice:groupRinging', () => new Map<string, string[]>());

// Once a DM/group call room empties (the caller hung up before an answer, or
// the call ended), stop it ringing anywhere it still is.
function stopRingingIfEmpty(roomId: string) {
  if (roomState.get(roomId)?.size) return;
  const peers = dmCallPeers(roomId);
  if (peers) {
    notifyCall(peers, { type: 'call_cancel', roomId, reason: 'ended' });
    return;
  }
  const channelId = groupCallChannelId(roomId);
  if (!channelId) return;
  const rung = groupRinging.get(roomId);
  groupRinging.delete(roomId);
  if (rung) {
    notifyCall(rung, { type: 'call_cancel', roomId, reason: 'ended' });
    return;
  }
  void loadGroupCallChannel(channelId)
    .then((channel) => {
      if (channel) notifyCall(channel.recipientIds || [], { type: 'call_cancel', roomId, reason: 'ended' });
    })
    .catch(() => {});
}

const hasId = (list: string[] | null | undefined, id: string) =>
  (list || []).some((x) => x.toLowerCase() === id.toLowerCase());

/**
 * Members of a group call to ring: everyone else in the group, minus anyone
 * who blocked the caller (or whom the caller blocked) and system accounts.
 */
async function groupRingTargets(caller: CallingUser, recipientIds: string[] | null | undefined): Promise<string[]> {
  const ids = groupCallRingTargets(recipientIds, caller.id);
  if (ids.length === 0) return [];
  const users = await User.find({ id: { in: ids } }).catch(() => []);
  return users
    .filter((u) => !u.isSystem && !isSystemUser(u.id))
    .filter((u) => !hasId(caller.blockedUsers, u.id) && !hasId(u.blockedUsers, caller.id))
    .map((u) => u.id);
}

type CallingUser = { id: string; friends?: string[] | null; blockedUsers?: string[] | null };

// Same rule as sending a DM: nobody blocked either way, and either friends or
// the callee accepts DMs from everyone. Returns the callee's stored id (the
// exact key their activity stream is registered under), or null.
async function canCall(caller: CallingUser, calleeId: string): Promise<string | null> {
  const callee = await User.findById(calleeId);
  if (!callee || callee.isSystem || isSystemUser(callee.id)) return null;
  const has = (list: string[] | null | undefined, id: string) => (list || []).some((x) => x.toLowerCase() === id.toLowerCase());
  if (has(caller.blockedUsers, callee.id) || has(callee.blockedUsers, caller.id)) return null;
  const allowed = has(caller.friends, callee.id)
    || (callee.settings as IUserSettings | undefined)?.privacy?.directMessages === 'everyone';
  return allowed ? callee.id : null;
}

/** Remove a user from a room and tell everyone (and stop a now-pointless ring). */
function evictFromRoom(roomId: string, userId: string) {
  cancelEviction(roomId, userId);
  const room = roomState.get(roomId);
  if (!room || !room.has(userId)) return;
  room.delete(userId);
  const empty = room.size === 0;
  if (empty) roomState.delete(roomId);
  publishMembership(roomId, 'leave', { userId });
  broadcastToRoom(roomId, { type: 'voice:participant_left', userId });
  stopRingingIfEmpty(roomId);
  // Last one out of a DM call: close its call message ("lasted 5 minutes" /
  // "missed call").
  if (empty) void onDmCallRoomEmpty(roomId);
}

// Subscribe this process to the voice buses. Call once at startup with a
// dedicated ioredis connection.
export async function startVoiceBridge(): Promise<() => void> {
  const Redis = (await import('ioredis')).default;
  const sub = new Redis(config.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: null });
  sub.on('error', (err: Error) => console.error('Voice bridge Redis error:', err.message));
  await sub.connect().catch((err: Error) => console.error('Voice bridge connect failed:', err.message));
  await sub.subscribe(VOICE_SSE_BUS, VOICE_MEMBERS_BUS);
  sub.on('message', (ch: string, raw: string) => {
    try {
      const msg = JSON.parse(raw);
      if (msg.originId === INSTANCE_ID) return; // already handled locally
      if (ch === VOICE_SSE_BUS) {
        if (msg.targetUserId) {
          deliverToUserLocal(msg.roomId, msg.targetUserId, msg.payload);
        } else {
          deliverToRoomLocal(msg.roomId, msg.payload, msg.excludeUserId);
        }
      } else if (ch === VOICE_MEMBERS_BUS) {
        // Keep this instance's room mirror in sync so its own SSE clients get a
        // complete participant snapshot on connect.
        const room = getRoom(msg.roomId);
        if (msg.action === 'join' && msg.participant) {
          const participant = msg.participant as VoiceParticipant;
          // They (re)joined through another instance: a pending eviction here
          // for a dropped stream is obsolete.
          cancelEviction(msg.roomId, participant.userId);
          room.set(participant.userId, participant);
        } else if (msg.action === 'leave' && msg.userId) {
          room.delete(msg.userId as string);
          if (room.size === 0) roomState.delete(msg.roomId);
        }
      }
    } catch (err) {
      console.error('Voice bridge: bad payload', err);
    }
  });
  console.log(`✅ Voice bridge subscribed to ${VOICE_SSE_BUS}, ${VOICE_MEMBERS_BUS}`);
  return () => { void sub.quit().catch(() => {}); };
}

// ── Room authorization ─────────────────────────────────────────────────────
// Who may see or use a voice room: for a channel room, someone who can view
// that (voice) channel; for a DM call room, one of its two users. Results are
// cached briefly per user+room because the sidebar polls /states every few
// seconds; /join always re-checks.
type RoomAuth = { ok: true; userLimit: number } | { ok: false; status: number; error: string };
const ROOM_AUTH_TTL_MS = 15_000;
const roomAuthCache = new BoundedMap<string, { result: RoomAuth; expires: number }>(5000);

async function authorizeRoom(userId: string, roomId: string, opts: { fresh?: boolean } = {}): Promise<RoomAuth> {
  const key = `${userId}|${roomId}`;
  if (!opts.fresh) {
    const hit = roomAuthCache.get(key);
    if (hit && hit.expires > Date.now()) return hit.result;
  }
  const result = await computeRoomAuth(userId, roomId);
  // Don't cache a transient lookup failure.
  if (result.ok || result.status !== 500) {
    roomAuthCache.set(key, { result, expires: Date.now() + ROOM_AUTH_TTL_MS });
  }
  return result;
}

async function computeRoomAuth(userId: string, roomId: string): Promise<RoomAuth> {
  const room = parseVoiceRoomId(roomId);
  if (!room) return { ok: false, status: 400, error: 'Invalid voice room' };
  if (room.kind === 'dm') {
    return isDmRoomPeer(room, userId)
      ? { ok: true, userLimit: 0 }
      : { ok: false, status: 403, error: 'Not part of this call' };
  }
  if (room.kind === 'group') {
    try {
      const channel = await loadGroupCallChannel(room.channelId);
      return isGroupCallMember(channel, userId)
        ? { ok: true, userLimit: 0 }
        : { ok: false, status: 403, error: 'Not part of this call' };
    } catch {
      return { ok: false, status: 500, error: 'Could not verify group access' };
    }
  }
  try {
    const access = await checkChannelAccess(userId, room.channelId);
    if (!access.hasAccess || !access.channel) {
      return { ok: false, status: access.error === 'Channel not found' ? 404 : 403, error: access.error || 'Forbidden' };
    }
    if (access.channel.type !== 'voice') {
      return { ok: false, status: 400, error: 'Not a voice channel' };
    }
    return { ok: true, userLimit: Number(access.channel.userLimit) || 0 };
  } catch {
    return { ok: false, status: 500, error: 'Could not verify voice channel access' };
  }
}

// Shared body of the offer/answer/ice relays: only joined participants may
// signal each other.
function relaySignal(
  roomId: string,
  fromUserId: string,
  targetUserId: string,
  payload: Record<string, unknown>,
  set: { status?: number | string },
) {
  const room = roomState.get(roomId);
  if (!canSignalBetween(room?.keys(), fromUserId, targetUserId)) {
    set.status = 403;
    return { error: 'Both users must be connected to this voice room' };
  }
  sendToUser(roomId, targetUserId, { ...payload, fromUserId });
  return { success: true };
}

export const voiceRoutes = new Elysia({ prefix: '/voice' })
  .post('/token', async ({ headers, cookie, body, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    if (!config.FEATURE_FLAGS.voice_video_enabled) {
      set.status = 503;
      return { error: 'Voice/video is disabled' };
    }

    const roomId = body.roomId;
    const auth = await authorizeRoom(user.id, roomId);
    if (!auth.ok) {
      set.status = auth.status;
      return { error: auth.error };
    }
    const expiresAt = Date.now() + 5 * 60 * 1000;

    // Build the ICE server list the client feeds into its WebRTC peers.
    // Priority: Cloudflare Worker (fresh creds per join) > env TURN > STUN only.
    const iceServers: Array<{ urls: string | string[]; username?: string; credential?: string }> = [];

    if (config.TURN_WORKER_URL) {
      try {
        const workerRes = await fetch(config.TURN_WORKER_URL, {
          method: 'GET',
          headers: { 'Accept': 'application/json' },
          signal: AbortSignal.timeout(5000),
        });
        if (workerRes.ok) {
          const data = await workerRes.json() as { iceServers?: Array<{ urls: string | string[]; username?: string; credential?: string }> };
          if (Array.isArray(data.iceServers) && data.iceServers.length) {
            iceServers.push(...data.iceServers);
          }
        }
      } catch {
        // Worker unreachable — fall through to env TURN / STUN below
      }
    }

    if (iceServers.length === 0) {
      const stunUrls = config.STUN_URLS.split(',').map((u) => u.trim()).filter(Boolean);
      if (stunUrls.length) iceServers.push({ urls: stunUrls });
      if (config.TURN_URL) {
        const turnUrls = config.TURN_URL.split(',').map((u) => u.trim()).filter(Boolean);
        iceServers.push({
          urls: turnUrls,
          username: config.TURN_USERNAME || undefined,
          credential: config.TURN_PASSWORD || undefined,
        });
      }
    }

    return {
      token: `local-${user.id}-${roomId}-${expiresAt}`,
      roomId,
      expiresAt,
      provider: 'local',
      iceServers,
    };
  }, {
    body: t.Object({
      roomId: t.String({ minLength: 1 }),
      channelId: t.Optional(t.String()),
    }),
  })
  .post('/join', async ({ headers, cookie, body, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const auth = await authorizeRoom(user.id, body.roomId, { fresh: true });
    if (!auth.ok) {
      set.status = auth.status;
      return { error: auth.error };
    }
    const existing = roomState.get(body.roomId);
    if (!hasRoomForParticipant(auth.userLimit, existing?.size ?? 0, existing?.has(user.id) ?? false)) {
      set.status = 403;
      return { error: 'This voice channel is full' };
    }
    // DM call rooms ("dm:<a>_<b>") are only joinable by those two users.
    let callee: string | null = null;
    if (body.roomId.startsWith('dm:')) {
      const peers = dmCallPeers(body.roomId);
      const me = user.id.toLowerCase();
      if (!peers || !peers.includes(me)) {
        set.status = 403;
        return { error: 'Not part of this call' };
      }
      callee = await canCall(user, peers[0] === me ? peers[1] : peers[0]);
      if (!callee) {
        set.status = 403;
        return { error: 'You cannot call this user' };
      }
    }
    // Group DM call rooms ("gdm:<channelId>"): current members only (the
    // fresh authorizeRoom above already checked; keep the channel for ringing).
    let groupChannel: Awaited<ReturnType<typeof loadGroupCallChannel>> = null;
    if (body.roomId.startsWith('gdm:')) {
      const channelId = groupCallChannelId(body.roomId);
      groupChannel = channelId ? await loadGroupCallChannel(channelId) : null;
      if (!isGroupCallMember(groupChannel, user.id)) {
        set.status = 403;
        return { error: 'Not part of this call' };
      }
    }

    // Nobody at all (not even another device of ours) was in the room: this
    // join starts a new call.
    const roomWasEmpty = (existing?.size ?? 0) === 0;
    const room = getRoom(body.roomId);
    const userId = user.id;
    const prev = room.get(userId);
    const sessionId = body.sessionId || undefined;
    // Same tab coming back after a network blip: refresh, don't re-announce
    // (that would make everyone tear down a connection that may still work)
    // and don't ring the other person again.
    const resumed = !!prev && !!sessionId && prev.sessionId === sessionId;
    cancelEviction(body.roomId, userId);
    room.set(userId, {
      userId,
      username: user.username,
      displayName: user.displayName || user.username,
      avatar: user.avatar || undefined,
      audio: body.audio ?? true,
      video: body.video ?? false,
      deafened: resumed && prev ? prev.deafened : false,
      joinedAt: resumed && prev ? prev.joinedAt : new Date().toISOString(),
      sessionId,
    });

    // Sync membership to other instances' mirrors, then notify participants.
    publishMembership(body.roomId, 'join', { participant: room.get(userId) });
    if (!resumed) {
      broadcastToRoom(body.roomId, {
        type: 'voice:participant_joined',
        participant: room.get(userId),
      }, userId);
      // Joined from another tab/device: that one hands the call over.
      if (prev) sendToUser(body.roomId, userId, { type: 'voice:replaced', sessionId });
    }

    if (callee && !resumed) {
      // The "started a call" message in the DM (created once per call, then
      // updated as people join). Best-effort: never blocks the join.
      void onDmCallJoin(body.roomId, user, roomWasEmpty);
      const calleeKey = callee.toLowerCase();
      const answering = Array.from(room.keys()).some((id) => id.toLowerCase() === calleeKey);
      if (answering) {
        // Picked up on one device — stop it ringing on the others.
        notifyCall([userId], { type: 'call_cancel', roomId: body.roomId, reason: 'answered' });
      } else {
        notifyCall([callee], {
          type: 'call_ring',
          roomId: body.roomId,
          video: body.video ?? false,
          caller: {
            id: userId,
            username: user.username,
            displayName: user.displayName || user.username,
            avatar: user.avatar || null,
          },
        });
      }
    }

    if (groupChannel && !resumed) {
      void onDmCallJoin(body.roomId, user, roomWasEmpty);
      if (roomWasEmpty) {
        // A new group call: ring everyone else in the group.
        const caller = {
          id: userId,
          username: user.username,
          displayName: user.displayName || user.username,
          avatar: user.avatar || null,
        };
        const roomId = body.roomId;
        const video = body.video ?? false;
        const channel = groupChannel;
        void (async () => {
          const targets = await groupRingTargets(user, channel.recipientIds);
          // Everyone may have left again while we looked them up.
          if (targets.length === 0 || !roomState.get(roomId)?.size) return;
          groupRinging.set(roomId, targets);
          const group = await describeCallGroup(channel).catch(() => ({
            channelId: channel.id,
            name: channel.name || 'Group',
            icon: null,
            memberCount: (channel.recipientIds || []).length,
          }));
          notifyCall(targets, { type: 'call_ring', roomId, video, caller, group });
        })().catch(() => {});
      } else {
        // Picked up (on one device): stop it ringing on their others.
        notifyCall([userId], { type: 'call_cancel', roomId: body.roomId, reason: 'answered' });
      }
    }

    return {
      success: true,
      roomId: body.roomId,
      resumed,
      participants: Array.from(room.values()),
    };
  }, {
    body: t.Object({
      roomId: t.String({ minLength: 1 }),
      channelId: t.Optional(t.String()),
      audio: t.Optional(t.Boolean()),
      video: t.Optional(t.Boolean()),
      sessionId: t.Optional(t.String({ maxLength: 64 })),
    }),
  })
  .post('/leave', async ({ headers, cookie, body, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const room = roomState.get(body.roomId);
    if (!room) {
      return { success: true };
    }

    const userId = user.id;
    const current = room.get(userId);
    // A late leave from a tab/device the call already moved away from must
    // not kick the one that's in it now.
    if (current && body.sessionId && current.sessionId && current.sessionId !== body.sessionId) {
      return { success: true, roomId: body.roomId, participants: Array.from(room.values()) };
    }

    evictFromRoom(body.roomId, userId);

    // Clean up signaling connections for this user in this room
    const roomConnections = voiceSignalingConnections.get(body.roomId);
    if (roomConnections) {
      roomConnections.delete(userId);
      if (roomConnections.size === 0) {
        voiceSignalingConnections.delete(body.roomId);
      }
    }

    return {
      success: true,
      roomId: body.roomId,
      participants: Array.from(roomState.get(body.roomId)?.values() ?? []),
    };
  }, {
    body: t.Object({
      roomId: t.String({ minLength: 1 }),
      sessionId: t.Optional(t.String({ maxLength: 64 })),
    }),
  })
  // Decline an incoming DM call: tell the caller, stop ringing on my devices.
  .post('/decline', async ({ headers, cookie, body, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const peers = dmCallPeers(body.roomId);
    const groupChannelId = groupCallChannelId(body.roomId);
    if (groupChannelId) {
      const channel = await loadGroupCallChannel(groupChannelId).catch(() => null);
      if (!isGroupCallMember(channel, user.id)) {
        set.status = 403;
        return { error: 'Not part of this call' };
      }
      // One member declining a group call only stops their own ringing.
      if (!roomState.get(body.roomId)?.has(user.id)) void onDmCallDecline(body.roomId, user.id);
      notifyCall([user.id], { type: 'call_cancel', roomId: body.roomId, reason: 'declined' });
      return { success: true };
    }
    if (!peers || !peers.includes(user.id.toLowerCase())) {
      set.status = 403;
      return { error: 'Not part of this call' };
    }

    // Declining on one device while already in the call on another (or from
    // a stale card) must not hang the caller up.
    if (!roomState.get(body.roomId)?.has(user.id)) {
      // Recorded before the caller hears about it (and hangs up), so the call
      // ends as "declined", not "missed".
      void onDmCallDecline(body.roomId, user.id);
      broadcastToRoom(body.roomId, { type: 'voice:call_declined', userId: user.id }, user.id);
    }
    notifyCall([user.id], { type: 'call_cancel', roomId: body.roomId, reason: 'declined' });
    return { success: true };
  }, {
    body: t.Object({
      roomId: t.String({ minLength: 1 }),
    }),
  })
  .get('/state/:roomId', async ({ headers, cookie, params, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const auth = await authorizeRoom(user.id, params.roomId);
    if (!auth.ok) {
      set.status = auth.status;
      return { error: auth.error };
    }

    const room = roomState.get(params.roomId);
    return {
      roomId: params.roomId,
      participants: room ? Array.from(room.values()) : [],
    };
  }, {
    params: t.Object({
      roomId: t.String(),
    }),
  })
  // Participants for several rooms in one call (the channel sidebar used to
  // poll one request per voice channel every 5s).
  .get('/states', async ({ headers, cookie, query, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }
    const roomIds = [...new Set(String(query.rooms || '').split(',').map((r) => r.trim()).filter(Boolean))].slice(0, 100);
    const states: Record<string, unknown[]> = {};
    // Only occupied rooms need an access check; rooms the caller can't see
    // are silently left out.
    const occupied = roomIds.filter((roomId) => (roomState.get(roomId)?.size ?? 0) > 0);
    const allowed = await Promise.all(occupied.map((roomId) => authorizeRoom(user.id, roomId)));
    occupied.forEach((roomId, i) => {
      const room = roomState.get(roomId);
      if (allowed[i].ok && room && room.size > 0) states[roomId] = Array.from(room.values());
    });
    return { states };
  }, {
    query: t.Object({ rooms: t.String() }),
  })
  // SSE signaling stream for a voice room
  .get('/signal/:roomId', async ({ headers, cookie, params, query }) => {
    const sseHeaders = {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    };

    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      const errorStream = new ReadableStream({
        start(controller) {
          controller.enqueue(sseEncoder.encode(`data: ${JSON.stringify({ type: 'error', error: authError || 'Unauthorized' })}

`));
          controller.close();
        },
      });
      return new Response(errorStream, { headers: sseHeaders });
    }

    const roomId = params.roomId;
    const userId = user.id;

    const auth = await authorizeRoom(userId, roomId);
    if (!auth.ok) {
      const deniedStream = new ReadableStream({
        start(controller) {
          controller.enqueue(sseEncoder.encode(`data: ${JSON.stringify({ type: 'error', error: auth.error })}\n\n`));
          controller.close();
        },
      });
      return new Response(deniedStream, { status: auth.status, headers: sseHeaders });
    }

    let controllerRef: ReadableStreamDefaultController | null = null;
    let pingInterval: NodeJS.Timeout | null = null;
    const streamSession = typeof query.session === 'string' && query.session.length <= 64 ? query.session : null;

    const stream = new ReadableStream({
      start(controller) {
        controllerRef = controller;
        if (!voiceSignalingConnections.has(roomId)) {
          voiceSignalingConnections.set(roomId, new Map());
        }
        const roomConns = voiceSignalingConnections.get(roomId)!;
        if (!roomConns.has(userId)) {
          roomConns.set(userId, new Set());
        }
        roomConns.get(userId)!.add(controller);
        // Reconnected in time: keep them in the room.
        const member = roomState.get(roomId)?.get(userId);
        if (member && (!streamSession || !member.sessionId || member.sessionId === streamSession)) {
          cancelEviction(roomId, userId);
        }

        // Send current room state (include self so client can identify itself)
        const room = roomState.get(roomId);
        const participants = room ? Array.from(room.values()) : [];
        controller.enqueue(sseEncoder.encode(`data: ${JSON.stringify({ type: 'voice:state', participants, roomId, self: userId })}

`));

        pingInterval = setInterval(() => {
          try {
            controller.enqueue(sseEncoder.encode('data: {"type":"ping"}\n\n'));
          } catch {
            if (pingInterval) clearInterval(pingInterval);
          }
        }, 25000);
      },
      cancel() {
        if (pingInterval) clearInterval(pingInterval);
        if (!controllerRef) return;
        const roomConns = voiceSignalingConnections.get(roomId);
        if (!roomConns) return;
        const userConns = roomConns.get(userId);
        if (userConns) {
          userConns.delete(controllerRef);
          // When the user's last signaling stream for this room drops (tab
          // closed, navigated away, network died) without a clean POST /leave,
          // evict them after a grace period so they don't linger as a ghost
          // participant. A reconnect within the grace period (POST /join with
          // the same session, then a new stream) cancels it.
          if (userConns.size === 0) {
            roomConns.delete(userId);
            const member = roomState.get(roomId)?.get(userId);
            // Only the stream of the session that's in the room counts; an old
            // device closing after the call moved must not evict the new one.
            const ownsMembership = !!member
              && (!streamSession || !member.sessionId || member.sessionId === streamSession);
            if (ownsMembership) {
              const key = evictionKey(roomId, userId);
              const existing = pendingEvictions.get(key);
              if (existing) clearTimeout(existing);
              pendingEvictions.set(key, setTimeout(() => {
                pendingEvictions.delete(key);
                // Back on this instance in the meantime?
                if (voiceSignalingConnections.get(roomId)?.get(userId)?.size) return;
                const still = roomState.get(roomId)?.get(userId);
                if (!still || (streamSession && still.sessionId && still.sessionId !== streamSession)) return;
                evictFromRoom(roomId, userId);
              }, SIGNAL_DROP_GRACE_MS));
            }
          }
        }
        // Drop the room's connection map once its last stream closes so the
        // outer map doesn't retain an empty entry per room ever opened.
        if (roomConns.size === 0) voiceSignalingConnections.delete(roomId);
      },
    });

    return new Response(stream, { headers: sseHeaders });
  }, {
    params: t.Object({ roomId: t.String() }),
    query: t.Object({ session: t.Optional(t.String()) }),
  })
  // Send WebRTC offer to a specific peer
  .post('/signal/:roomId/offer', async ({ headers, cookie, params, body, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) { set.status = 401; return { error: authError || 'Unauthorized' }; }

    return relaySignal(params.roomId, user.id, body.targetUserId, {
      type: 'voice:offer',
      signal: body.signal,
      pcId: body.pcId,
    }, set);
  }, {
    params: t.Object({ roomId: t.String() }),
    body: t.Object({ targetUserId: t.String(), signal: t.Any(), pcId: t.Optional(t.String({ maxLength: 64 })) }),
  })
  // Send WebRTC answer to a specific peer
  .post('/signal/:roomId/answer', async ({ headers, cookie, params, body, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) { set.status = 401; return { error: authError || 'Unauthorized' }; }

    return relaySignal(params.roomId, user.id, body.targetUserId, {
      type: 'voice:answer',
      signal: body.signal,
      pcId: body.pcId,
    }, set);
  }, {
    params: t.Object({ roomId: t.String() }),
    body: t.Object({ targetUserId: t.String(), signal: t.Any(), pcId: t.Optional(t.String({ maxLength: 64 })) }),
  })
  // Send ICE candidate to a specific peer
  .post('/signal/:roomId/ice', async ({ headers, cookie, params, body, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) { set.status = 401; return { error: authError || 'Unauthorized' }; }

    return relaySignal(params.roomId, user.id, body.targetUserId, {
      type: 'voice:ice',
      candidate: body.candidate,
      pcId: body.pcId,
    }, set);
  }, {
    params: t.Object({ roomId: t.String() }),
    body: t.Object({ targetUserId: t.String(), candidate: t.Any(), pcId: t.Optional(t.String({ maxLength: 64 })) }),
  })
  // Play a soundboard sound to everyone in a voice room
  .post('/soundboard/:roomId', async ({ headers, cookie, params, body, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) { set.status = 401; return { error: authError || 'Unauthorized' }; }

    const room = roomState.get(params.roomId);
    if (!room || !room.has(user.id)) {
      set.status = 403;
      return { error: 'You must be connected to this voice channel' };
    }

    // Channel rooms: verify the sound belongs to the channel's server and
    // the server's soundboard is enabled.
    let volume = 100;
    if (params.roomId.startsWith('channel-')) {
      const channelId = params.roomId.slice('channel-'.length);
      const { Channel, Server } = await import('@/lib/models');
      const channel = await Channel.findById(channelId);
      if (!channel) { set.status = 404; return { error: 'Channel not found' }; }
      if (!channel.serverId) { set.status = 400; return { error: 'Not a server channel' }; }
      const server = await Server.findById(channel.serverId);
      if (!server) { set.status = 404; return { error: 'Server not found' }; }

      if ((server.settings as IServerSettings | undefined)?.soundboard?.enabled === false) {
        set.status = 403;
        return { error: 'Soundboard is disabled in this server' };
      }
      volume = (server.settings as IServerSettings | undefined)?.soundboard?.volume ?? 100;

      const sound = ((server.soundboardSounds as Array<{ name: string; soundId: string; url: string }> | undefined) || []).find(
        (s: { url: string }) => s.url === body.soundUrl
      );
      if (!sound) {
        set.status = 400;
        return { error: 'That sound does not exist in this server' };
      }
    }

    broadcastToRoom(params.roomId, {
      type: 'voice:soundboard',
      userId: user.id,
      username: user.displayName || user.username,
      soundUrl: body.soundUrl,
      soundName: body.soundName,
      volume,
    }, user.id);

    return { success: true, volume };
  }, {
    params: t.Object({ roomId: t.String() }),
    body: t.Object({
      soundUrl: t.String({ minLength: 1, maxLength: 2048 }),
      soundName: t.String({ minLength: 1, maxLength: 100 }),
    }),
  })
  // Update mute/deafen state
  .patch('/state/:roomId', async ({ headers, cookie, params, body, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) { set.status = 401; return { error: authError || 'Unauthorized' }; }

    const room = roomState.get(params.roomId);
    if (!room) { set.status = 404; return { error: 'Room not found' }; }
    const participant = room.get(user.id);
    if (!participant) { set.status = 404; return { error: 'Not in room' }; }

    if (body.audio !== undefined) participant.audio = body.audio;
    if (body.deafened !== undefined) participant.deafened = body.deafened;
    if (body.video !== undefined) participant.video = body.video;

    broadcastToRoom(params.roomId, {
      type: 'voice:state_update',
      userId: user.id,
      audio: participant.audio,
      deafened: participant.deafened,
      video: participant.video,
      screenShare: body.screenShare,
    });

    return { success: true };
  }, {
    params: t.Object({ roomId: t.String() }),
    body: t.Object({
      audio: t.Optional(t.Boolean()),
      deafened: t.Optional(t.Boolean()),
      video: t.Optional(t.Boolean()),
      screenShare: t.Optional(t.Boolean()),
    }),
  })
  // Broadcast speaking state to other participants
  .post('/speaking/:roomId', async ({ headers, cookie, params, body, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) { set.status = 401; return { error: authError || 'Unauthorized' }; }

    const room = roomState.get(params.roomId);
    if (!room || !room.has(user.id)) {
      set.status = 404;
      return { error: 'Not in room' };
    }

    broadcastToRoom(params.roomId, {
      type: 'voice:speaking',
      userId: user.id,
      speaking: body.speaking,
    }, user.id);

    return { success: true };
  }, {
    params: t.Object({ roomId: t.String() }),
    body: t.Object({
      speaking: t.Boolean(),
    }),
  });

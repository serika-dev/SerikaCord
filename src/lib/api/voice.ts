import { Elysia, t } from 'elysia';
import { authenticateRequest } from '@/lib/services/auth';
import { config } from '@/lib/config';
import { getPublisher } from '@/lib/db';
import { randomUUID } from 'crypto';

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
};

// Local mirror of every voice room's membership. Kept in sync across instances
// via the Redis `voice:members` bus, so a client connecting to ANY instance
// sees everyone in the room (WebRTC media stays fully P2P — only this small bit
// of signaling/presence goes through the server).
const roomState = new Map<string, Map<string, VoiceParticipant>>();

// SSE connections per voice room: roomId -> userId -> controller set (per process)
const voiceSignalingConnections = new Map<string, Map<string, Set<ReadableStreamDefaultController>>>();

// Cross-instance buses. `originId` lets an instance skip echoes of its own
// publishes (it already delivered/applied them locally).
const INSTANCE_ID = randomUUID();
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
          room.set((msg.participant as VoiceParticipant).userId, msg.participant as VoiceParticipant);
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

    const room = getRoom(body.roomId);
    const userId = user.id;
    room.set(userId, {
      userId,
      username: user.username,
      displayName: user.displayName || user.username,
      avatar: user.avatar || undefined,
      audio: body.audio ?? true,
      video: body.video ?? false,
      deafened: false,
      joinedAt: new Date().toISOString(),
    });

    // Sync membership to other instances' mirrors, then notify participants.
    publishMembership(body.roomId, 'join', { participant: room.get(userId) });
    broadcastToRoom(body.roomId, {
      type: 'voice:participant_joined',
      participant: room.get(userId),
    }, userId);

    return {
      success: true,
      roomId: body.roomId,
      participants: Array.from(room.values()),
    };
  }, {
    body: t.Object({
      roomId: t.String({ minLength: 1 }),
      channelId: t.Optional(t.String()),
      audio: t.Optional(t.Boolean()),
      video: t.Optional(t.Boolean()),
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
    room.delete(userId);
    if (room.size === 0) {
      roomState.delete(body.roomId);
    }

    // Sync membership to other instances, then notify remaining participants.
    publishMembership(body.roomId, 'leave', { userId });
    broadcastToRoom(body.roomId, {
      type: 'voice:participant_left',
      userId,
    });

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
      participants: room ? Array.from(room.values()) : [],
    };
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
  // SSE signaling stream for a voice room
  .get('/signal/:roomId', async ({ headers, cookie, params }) => {
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

    let controllerRef: ReadableStreamDefaultController | null = null;
    let pingInterval: NodeJS.Timeout | null = null;

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
          // evict them from the room mirror so they don't linger forever as a
          // ghost participant — and tell the remaining members. A reconnect
          // re-adds them via POST /join.
          if (userConns.size === 0) {
            roomConns.delete(userId);
            const room = roomState.get(roomId);
            if (room && room.has(userId)) {
              room.delete(userId);
              if (room.size === 0) roomState.delete(roomId);
              publishMembership(roomId, 'leave', { userId });
              broadcastToRoom(roomId, { type: 'voice:participant_left', userId });
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
  })
  // Send WebRTC offer to a specific peer
  .post('/signal/:roomId/offer', async ({ headers, cookie, params, body, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) { set.status = 401; return { error: authError || 'Unauthorized' }; }

    sendToUser(params.roomId, body.targetUserId, {
      type: 'voice:offer',
      fromUserId: user.id,
      signal: body.signal,
    });
    return { success: true };
  }, {
    params: t.Object({ roomId: t.String() }),
    body: t.Object({ targetUserId: t.String(), signal: t.Any() }),
  })
  // Send WebRTC answer to a specific peer
  .post('/signal/:roomId/answer', async ({ headers, cookie, params, body, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) { set.status = 401; return { error: authError || 'Unauthorized' }; }

    sendToUser(params.roomId, body.targetUserId, {
      type: 'voice:answer',
      fromUserId: user.id,
      signal: body.signal,
    });
    return { success: true };
  }, {
    params: t.Object({ roomId: t.String() }),
    body: t.Object({ targetUserId: t.String(), signal: t.Any() }),
  })
  // Send ICE candidate to a specific peer
  .post('/signal/:roomId/ice', async ({ headers, cookie, params, body, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) { set.status = 401; return { error: authError || 'Unauthorized' }; }

    sendToUser(params.roomId, body.targetUserId, {
      type: 'voice:ice',
      fromUserId: user.id,
      candidate: body.candidate,
    });
    return { success: true };
  }, {
    params: t.Object({ roomId: t.String() }),
    body: t.Object({ targetUserId: t.String(), candidate: t.Any() }),
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

      if ((server.settings as any)?.soundboard?.enabled === false) {
        set.status = 403;
        return { error: 'Soundboard is disabled in this server' };
      }
      volume = (server.settings as any)?.soundboard?.volume ?? 100;

      const sound = ((server.soundboardSounds as any[]) || []).find(
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

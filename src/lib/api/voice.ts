import { Elysia, t } from 'elysia';
import { authenticateRequest } from '@/lib/services/auth';
import { config } from '@/lib/config';

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

const roomState = new Map<string, Map<string, VoiceParticipant>>();

// SSE connections per voice room: roomId -> userId -> controller set
const voiceSignalingConnections = new Map<string, Map<string, Set<ReadableStreamDefaultController>>>();

function getRoom(roomId: string) {
  if (!roomState.has(roomId)) {
    roomState.set(roomId, new Map());
  }
  return roomState.get(roomId)!;
}

function broadcastToRoom(roomId: string, payload: object, excludeUserId?: string) {
  const encoded = new TextEncoder().encode(`data: ${JSON.stringify(payload)}\n\n`);
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

function sendToUser(roomId: string, targetUserId: string, payload: object) {
  const encoded = new TextEncoder().encode(`data: ${JSON.stringify(payload)}\n\n`);
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

    return {
      token: `local-${user._id}-${roomId}-${expiresAt}`,
      roomId,
      expiresAt,
      provider: 'local',
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
    const userId = user._id.toString();
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

    // Notify other participants in the room
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

    const userId = user._id.toString();
    room.delete(userId);
    if (room.size === 0) {
      roomState.delete(body.roomId);
    }

    // Notify remaining participants
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
          controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ type: 'error', error: authError || 'Unauthorized' })}

`));
          controller.close();
        },
      });
      return new Response(errorStream, { headers: sseHeaders });
    }

    const roomId = params.roomId;
    const userId = user._id.toString();

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
        controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ type: 'voice:state', participants, roomId, self: userId })}

`));

        pingInterval = setInterval(() => {
          try {
            controller.enqueue(new TextEncoder().encode('data: {"type":"ping"}\n\n'));
          } catch {
            if (pingInterval) clearInterval(pingInterval);
          }
        }, 25000);
      },
      cancel() {
        if (pingInterval) clearInterval(pingInterval);
        if (controllerRef) {
          const roomConns = voiceSignalingConnections.get(roomId);
          if (roomConns) {
            const userConns = roomConns.get(userId);
            if (userConns) userConns.delete(controllerRef);
          }
        }
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
      fromUserId: user._id.toString(),
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
      fromUserId: user._id.toString(),
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
      fromUserId: user._id.toString(),
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
    if (!room || !room.has(user._id.toString())) {
      set.status = 403;
      return { error: 'You must be connected to this voice channel' };
    }

    // Channel rooms: verify the sound belongs to the channel's server and
    // the server's soundboard is enabled.
    let volume = 100;
    if (params.roomId.startsWith('channel-')) {
      const channelId = params.roomId.slice('channel-'.length);
      const { Channel, Server } = await import('@/lib/models');
      if (!/^[0-9a-fA-F]{24}$/.test(channelId)) {
        set.status = 400;
        return { error: 'Invalid voice channel' };
      }
      const channel = await Channel.findById(channelId).select('serverId');
      if (!channel) { set.status = 404; return { error: 'Channel not found' }; }
      const server = await Server.findById(channel.serverId).select('settings soundboardSounds');
      if (!server) { set.status = 404; return { error: 'Server not found' }; }

      if (server.settings?.soundboard?.enabled === false) {
        set.status = 403;
        return { error: 'Soundboard is disabled in this server' };
      }
      volume = server.settings?.soundboard?.volume ?? 100;

      const sound = (server.soundboardSounds || []).find(
        (s: { url: string }) => s.url === body.soundUrl
      );
      if (!sound) {
        set.status = 400;
        return { error: 'That sound does not exist in this server' };
      }
    }

    broadcastToRoom(params.roomId, {
      type: 'voice:soundboard',
      userId: user._id.toString(),
      username: user.displayName || user.username,
      soundUrl: body.soundUrl,
      soundName: body.soundName,
      volume,
    }, user._id.toString());

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
    const participant = room.get(user._id.toString());
    if (!participant) { set.status = 404; return { error: 'Not in room' }; }

    if (body.audio !== undefined) participant.audio = body.audio;
    if (body.deafened !== undefined) participant.deafened = body.deafened;
    if (body.video !== undefined) participant.video = body.video;

    broadcastToRoom(params.roomId, {
      type: 'voice:state_update',
      userId: user._id.toString(),
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
    if (!room || !room.has(user._id.toString())) {
      set.status = 404;
      return { error: 'Not in room' };
    }

    broadcastToRoom(params.roomId, {
      type: 'voice:speaking',
      userId: user._id.toString(),
      speaking: body.speaking,
    }, user._id.toString());

    return { success: true };
  }, {
    params: t.Object({ roomId: t.String() }),
    body: t.Object({
      speaking: t.Boolean(),
    }),
  });

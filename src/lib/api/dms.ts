import { Elysia, t } from 'elysia';
import { Channel, Message, User, ServerMember, ServerSticker } from '@/lib/models';
import { authenticateRequest } from '@/lib/services/auth';
import { parseCustomEmojis, normalizeEmojiFormat } from '@/lib/services/emoji';
import { resolveEffectiveStatus } from '@/lib/services/presence';
import { checkRateLimit, getClientIP, sanitizeInput, validateMessageContent, isValidObjectId, encryptForStorage, decryptFromStorage, rejectInvalidObjectIdParams } from '@/lib/security';
import { cache, getPublisher } from '@/lib/db';
import { Types } from 'mongoose';

// Helper to safely compare IDs (handles both ObjectId and string)
function compareIds(id1: Types.ObjectId | string, id2: Types.ObjectId | string): boolean {
  const str1 = id1 instanceof Types.ObjectId ? id1.toString() : id1;
  const str2 = id2 instanceof Types.ObjectId ? id2.toString() : id2;
  return str1 === str2;
}

function getPublicPresenceStatus(user: { status?: string | null; presenceLastHeartbeatAt?: Date | string | number | null }) {
  return resolveEffectiveStatus({
    status: user.status,
    presenceLastHeartbeatAt: user.presenceLastHeartbeatAt ?? null,
  });
}

// Helper function for auth
async function getAuth(headers: Record<string, string | undefined>, cookie: Record<string, { value?: unknown }>) {
  const authHeader = headers.authorization ?? null;
  const authToken = cookie.auth_token?.value;
  const cookies: Record<string, string> = {};
  if (typeof authToken === 'string') {
    cookies.auth_token = authToken;
  }
  return authenticateRequest(authHeader, cookies);
}

// Store active SSE connections
const activeConnections = new Map<string, Set<ReadableStreamDefaultController>>();
const activeDmListConnections = new Map<string, Set<ReadableStreamDefaultController>>();

function emitDmListUpdate(userIds: string[], payload: Record<string, unknown>) {
  const data = new TextEncoder().encode(`data: ${JSON.stringify(payload)}\n\n`);
  userIds.forEach((userId) => {
    const streams = activeDmListConnections.get(userId);
    if (!streams) return;
    streams.forEach((controller) => {
      try {
        controller.enqueue(data);
      } catch {
        streams.delete(controller);
      }
    });
    if (streams.size === 0) {
      activeDmListConnections.delete(userId);
    }
  });
}

// Helper to get or create DM channel
async function getOrCreateDMChannel(userId: string, recipientId: string) {
  // Find existing DM channel between users
  let channel = await Channel.findOne({
    type: 'dm',
    recipientIds: { $all: [userId, recipientId], $size: 2 },
  });

  if (!channel) {
    // Create new DM channel
    channel = new Channel({
      type: 'dm',
      name: 'Direct Message',
      recipientIds: [new Types.ObjectId(userId), new Types.ObjectId(recipientId)],
      position: 0,
    });
    await channel.save();
  }

  return channel;
}

export const dmRoutes = new Elysia({ prefix: '/dms' })
  .onBeforeHandle(rejectInvalidObjectIdParams)
  // Get all DM channels for user
  .get('/', async ({ headers, cookie, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const channels = await Channel.find({
      type: { $in: ['dm', 'group_dm'] },
      recipientIds: user._id,
    }).sort({ updatedAt: -1 });

    // Populate recipient info, deduplicating by recipient to avoid showing same user twice
    const seenRecipientIds = new Set<string>();
    const channelsWithRecipients = (
      await Promise.all(
        channels.map(async (channel) => {
          const recipientIds = channel.recipientIds.filter(
            (id: Types.ObjectId) => !id.equals(user._id)
          );
          const recipients = await User.find({ _id: { $in: recipientIds } }).select(
            'username displayName avatar status customStatus isPremium presenceLastHeartbeatAt'
          );

          return {
            id: channel._id,
            type: channel.type,
            recipients: recipients.map((r) => ({
              id: r._id,
              username: r.username,
              displayName: r.displayName,
              avatar: r.avatar,
              status: getPublicPresenceStatus(r),
              customStatus: r.customStatus,
              isPremium: r.isPremium,
            })),
            lastMessageId: channel.lastMessageId,
            updatedAt: channel.updatedAt,
            _recipientKey: recipientIds.map((id: Types.ObjectId) => id.toString()).sort().join(','),
          };
        })
      )
    ).filter((ch) => {
      // For DMs: deduplicate by the other participant's ID (keep the first/most-recent)
      if (ch.type === 'dm') {
        if (seenRecipientIds.has(ch._recipientKey)) return false;
        seenRecipientIds.add(ch._recipientKey);
      }
      return true;
    }).map(({ _recipientKey: _rk, ...rest }) => rest);

    return { channels: channelsWithRecipients };
  })
  // SSE stream for DM list updates
  .get('/stream', async ({ headers, cookie }) => {
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
          controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ type: 'error', error: authError || 'Unauthorized' })}\n\n`));
          controller.close();
        },
      });
      return new Response(errorStream, { headers: sseHeaders });
    }

    let controllerRef: ReadableStreamDefaultController | null = null;
    let pingInterval: NodeJS.Timeout | null = null;
    const userKey = user._id.toString();

    const stream = new ReadableStream({
      start(controller) {
        controllerRef = controller;
        if (!activeDmListConnections.has(userKey)) {
          activeDmListConnections.set(userKey, new Set());
        }
        activeDmListConnections.get(userKey)!.add(controller);
        controller.enqueue(new TextEncoder().encode('data: {"type":"connected"}\n\n'));
        pingInterval = setInterval(() => {
          try {
            controller.enqueue(new TextEncoder().encode('data: {"type":"ping"}\n\n'));
          } catch {
            if (pingInterval) clearInterval(pingInterval);
            activeDmListConnections.get(userKey)?.delete(controller);
          }
        }, 30000);
      },
      cancel() {
        if (pingInterval) clearInterval(pingInterval);
        if (controllerRef) {
          activeDmListConnections.get(userKey)?.delete(controllerRef);
        }
      },
    });

    return new Response(stream, { headers: sseHeaders });
  })
  // Get messages for a DM with specific recipient
  .get('/:recipientId/messages', async ({ headers, cookie, params, query, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    if (!isValidObjectId(params.recipientId)) {
      set.status = 400;
      return { error: 'Invalid recipient ID' };
    }

    // Check if recipient exists
    const recipient = await User.findById(params.recipientId);
    if (!recipient) {
      set.status = 404;
      return { error: 'User not found' };
    }

    // Check if friends or can DM
    const isFriend = user.friends.some((f: Types.ObjectId | string) => compareIds(f, recipient._id));
    if (!isFriend && recipient.settings.privacy.directMessages !== 'everyone') {
      set.status = 403;
      return { error: 'You cannot message this user' };
    }

    // Get or create DM channel
    const channel = await getOrCreateDMChannel(user._id.toString(), params.recipientId);

    const limit = Math.min(parseInt(query.limit as string) || 50, 100);
    const before = query.before as string | undefined;

    const messageQuery: Record<string, unknown> = { channelId: channel._id };
    if (before && isValidObjectId(before)) {
      messageQuery._id = { $lt: new Types.ObjectId(before) };
    }

    const messages = await Message.find(messageQuery)
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate('authorId', 'username displayName avatar status customStatus isPremium badges presenceLastHeartbeatAt');

    // Decrypt messages
    const decryptedMessages = await Promise.all(messages.reverse().map(async (msg) => {
      const author = msg.authorId as unknown as {
        _id: Types.ObjectId;
        username: string;
        displayName?: string;
        avatar?: string;
        status?: string;
        presenceLastHeartbeatAt?: Date;
        customStatus?: string;
        isPremium?: boolean;
        badges?: string[];
      };
      const decryptedContent = await decryptFromStorage(msg.content);
      const emojiResult = await parseCustomEmojis(decryptedContent);
      const customEmojis = emojiResult.emojis.map(e => ({
        id: e.id,
        name: e.name,
        animated: e.animated,
        url: e.url,
      }));
      return {
        id: msg._id,
        content: decryptedContent,
        authorId: author._id,
        author: {
          id: author._id,
          username: author.username,
          displayName: author.displayName,
          avatar: author.avatar,
          status: getPublicPresenceStatus(author),
          customStatus: author.customStatus,
          isPremium: author.isPremium,
          badges: author.badges || [],
        },
        channelId: msg.channelId,
        attachments: msg.attachments,
        createdAt: msg.createdAt,
        updatedAt: msg.updatedAt,
        customEmojis: customEmojis.length > 0 ? customEmojis : undefined,
      };
    }));

    return {
      messages: decryptedMessages,
      channelId: channel._id,
    };
  }, {
    params: t.Object({
      recipientId: t.String(),
    }),
  })
  // Send message in DM
  .post('/:recipientId/messages', async ({ headers, cookie, params, body, request, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    // Rate limit
    const ip = getClientIP(request);
    const rateLimit = await checkRateLimit('message', `${user._id}:${ip}`);
    if (!rateLimit.success) {
      set.status = 429;
      return { error: 'Too many messages', retryAfter: rateLimit.retryAfter };
    }

    if (!isValidObjectId(params.recipientId)) {
      set.status = 400;
      return { error: 'Invalid recipient ID' };
    }

    // Check if recipient exists
    const recipient = await User.findById(params.recipientId);
    if (!recipient) {
      set.status = 404;
      return { error: 'User not found' };
    }

    // Check if blocked
    if (user.blockedUsers.some((b: Types.ObjectId | string) => compareIds(b, recipient._id))) {
      set.status = 403;
      return { error: 'You have blocked this user' };
    }
    if (recipient.blockedUsers.some((b: Types.ObjectId | string) => compareIds(b, user._id))) {
      set.status = 403;
      return { error: 'You cannot message this user' };
    }

    // Check DM permissions
    const isFriend = user.friends.some((f: Types.ObjectId | string) => compareIds(f, recipient._id));
    if (!isFriend && recipient.settings.privacy.directMessages !== 'everyone') {
      set.status = 403;
      return { error: 'You cannot message this user' };
    }

    // Validate content
    const { content, sticker, attachments } = body;
    let sanitizedContent = content ? sanitizeInput(content) : '';

    // Validate sticker if provided
    let stickerData: { id: string; name: string; imageUrl: string; serverId?: string; serverName?: string } | undefined;
    if (sticker?.id) {
      if (!isValidObjectId(sticker.id)) {
        set.status = 400;
        return { error: 'Invalid sticker ID' };
      }
      const stickerDoc = await ServerSticker.findById(sticker.id).populate('serverId', 'name').lean();
      if (!stickerDoc || !stickerDoc.available) {
        set.status = 400;
        return { error: 'Sticker not found' };
      }
      const populatedServer = stickerDoc.serverId as unknown as { _id: Types.ObjectId; name: string } | null;
      stickerData = {
        id: stickerDoc._id.toString(),
        name: stickerDoc.name,
        imageUrl: stickerDoc.imageUrl,
        serverId: populatedServer?._id.toString(),
        serverName: populatedServer?.name,
      };
    }

    const validation = validateMessageContent(sanitizedContent);
    if (!validation.valid && !stickerData && (!attachments || attachments.length === 0)) {
      set.status = 400;
      return { error: validation.error };
    }

    // Normalize emoji format
    sanitizedContent = normalizeEmojiFormat(sanitizedContent);

    // Get user's servers for emoji validation
    const userServerMemberships = await ServerMember.find({ userId: user._id }).select('serverId');
    const userServerIds = userServerMemberships.map(m => m.serverId);

    // Parse and validate custom emojis
    const emojiResult = await parseCustomEmojis(sanitizedContent, undefined, userServerIds);
    
    // Store parsed emoji data for the message response
    const customEmojis = emojiResult.emojis.map(e => ({
      id: e.id,
      name: e.name,
      animated: e.animated,
      url: e.url,
    }));

    // Get or create DM channel
    const channel = await getOrCreateDMChannel(user._id.toString(), params.recipientId);

    // Encrypt content for storage
    const encryptedContent = await encryptForStorage(sanitizedContent);

    // Create message
    const message = new Message({
      channelId: channel._id,
      authorId: user._id,
      content: encryptedContent,
      type: 'default',
      sticker: stickerData,
      attachments: attachments || [],
    });
    await message.save();

    // Update channel's last message
    channel.lastMessageId = message._id;
    channel.updatedAt = new Date();
    await channel.save();

    const messageData = {
      id: message._id,
      content: sanitizedContent, // Return decrypted content
      authorId: user._id,
      author: {
        id: user._id,
        username: user.username,
        displayName: user.displayName,
        avatar: user.avatar,
        status: getPublicPresenceStatus(user),
        customStatus: user.customStatus,
        isPremium: user.isPremium,
        badges: user.badges || [],
      },
      channelId: channel._id,
      createdAt: message.createdAt,
      attachments: message.attachments || undefined,
      customEmojis: customEmojis.length > 0 ? customEmojis : undefined,
      sticker: message.sticker || undefined,
    };

    emitDmListUpdate(
      [user._id.toString(), params.recipientId],
      {
        type: 'dm:list:update',
        channelId: channel._id.toString(),
        recipientId: params.recipientId,
        message: {
          id: message._id.toString(),
          content: sanitizedContent.slice(0, 180),
          authorId: user._id.toString(),
          createdAt: message.createdAt,
        },
      }
    );

    // Publish to Redis for real-time
    try {
      const publisher = getPublisher();
      if (publisher) {
        await publisher.publish(`dm:${channel._id}`, JSON.stringify({
          type: 'message',
          message: messageData,
        }));
      }
    } catch (error) {
      console.error('Failed to publish message:', error);
    }

    // Send to SSE connections
    const channelKey = channel._id.toString();
    const connections = activeConnections.get(channelKey);
    if (connections) {
      const data = `data: ${JSON.stringify({ type: 'message', message: messageData })}\n\n`;
      connections.forEach((controller) => {
        try {
          controller.enqueue(new TextEncoder().encode(data));
        } catch {
          // Connection closed
        }
      });
    }

    return messageData;
  }, {
    params: t.Object({
      recipientId: t.String(),
    }),
    body: t.Object({
      content: t.Optional(t.String({ minLength: 1, maxLength: 4000 })),
      sticker: t.Optional(t.Object({
        id: t.String(),
        name: t.String(),
        imageUrl: t.String(),
        serverId: t.Optional(t.String()),
        serverName: t.Optional(t.String()),
      })),
      attachments: t.Optional(t.Array(t.Object({
        id: t.String(),
        url: t.String(),
        filename: t.String(),
        contentType: t.String(),
        size: t.Optional(t.Number()),
      }))),
    }),
  })
  // SSE stream for real-time messages
  .get('/:recipientId/stream', async ({ headers, cookie, params }) => {
    const sseHeaders = {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    };

    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      // Return error as SSE event
      const errorStream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ type: 'error', error: authError || 'Unauthorized' })}\n\n`));
          controller.close();
        },
      });
      return new Response(errorStream, { headers: sseHeaders });
    }

    if (!isValidObjectId(params.recipientId)) {
      const errorStream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ type: 'error', error: 'Invalid recipient ID' })}\n\n`));
          controller.close();
        },
      });
      return new Response(errorStream, { headers: sseHeaders });
    }

    // Get or create DM channel
    const channel = await getOrCreateDMChannel(user._id.toString(), params.recipientId);
    const channelKey = channel._id.toString();

    // Create SSE stream
    let controllerRef: ReadableStreamDefaultController | null = null;
    let pingInterval: NodeJS.Timeout | null = null;

    const stream = new ReadableStream({
      start(controller) {
        controllerRef = controller;
        // Add to active connections
        if (!activeConnections.has(channelKey)) {
          activeConnections.set(channelKey, new Set());
        }
        activeConnections.get(channelKey)!.add(controller);

        // Send initial ping
        controller.enqueue(new TextEncoder().encode('data: {"type":"connected"}\n\n'));

        // Keep-alive ping every 30 seconds
        pingInterval = setInterval(() => {
          try {
            controller.enqueue(new TextEncoder().encode('data: {"type":"ping"}\n\n'));
          } catch {
            if (pingInterval) {
              clearInterval(pingInterval);
            }
            activeConnections.get(channelKey)?.delete(controller);
          }
        }, 30000);
      },
      cancel() {
        if (pingInterval) {
          clearInterval(pingInterval);
        }
        if (controllerRef) {
          activeConnections.get(channelKey)?.delete(controllerRef);
        }
      },
    });

    return new Response(stream, { headers: sseHeaders });
  }, {
    params: t.Object({
      recipientId: t.String(),
    }),
  })
  // Typing indicator
  .post('/:recipientId/typing', async ({ headers, cookie, params, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    if (!isValidObjectId(params.recipientId)) {
      set.status = 400;
      return { error: 'Invalid recipient ID' };
    }

    const channel = await getOrCreateDMChannel(user._id.toString(), params.recipientId);
    
    // Set typing in Redis
    await cache.setTyping(channel._id.toString(), user._id.toString());

    // Publish typing event
    try {
      const publisher = getPublisher();
      if (publisher) {
        await publisher.publish(`dm:${channel._id}`, JSON.stringify({
          type: 'typing',
          userId: user._id,
          username: user.username,
        }));
      }
    } catch (error) {
      console.error('Failed to publish typing:', error);
    }

    const channelKey = channel._id.toString();
    const connections = activeConnections.get(channelKey);
    if (connections) {
      const data = `data: ${JSON.stringify({
        type: 'typing',
        userId: user._id,
        username: user.username,
      })}\n\n`;
      connections.forEach((controller) => {
        try {
          controller.enqueue(new TextEncoder().encode(data));
        } catch {
          // Connection closed and cleaned up during next heartbeat/cancel.
        }
      });
    }

    emitDmListUpdate(
      [user._id.toString(), params.recipientId],
      {
        type: 'typing',
        channelId: channel._id.toString(),
        userId: user._id.toString(),
        username: user.username,
      }
    );

    return { success: true };
  }, {
    params: t.Object({
      recipientId: t.String(),
    }),
  });

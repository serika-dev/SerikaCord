import { Elysia, t } from 'elysia';
import { Channel, Message, User } from '@/lib/models';
import { authenticateRequest } from '@/lib/services/auth';
import { checkRateLimit, getClientIP, sanitizeInput, validateMessageContent, isValidObjectId } from '@/lib/security';
import { cache, getPublisher } from '@/lib/db';
import { Types } from 'mongoose';

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

    // Populate recipient info
    const channelsWithRecipients = await Promise.all(
      channels.map(async (channel) => {
        const recipientIds = channel.recipientIds.filter(
          (id: Types.ObjectId) => !id.equals(user._id)
        );
        const recipients = await User.find({ _id: { $in: recipientIds } }).select(
          'username displayName avatar status customStatus isPremium'
        );
        
        return {
          id: channel._id,
          type: channel.type,
          recipients: recipients.map((r) => ({
            id: r._id,
            username: r.username,
            displayName: r.displayName,
            avatar: r.avatar,
            status: r.status,
            customStatus: r.customStatus,
            isPremium: r.isPremium,
          })),
          lastMessageId: channel.lastMessageId,
          updatedAt: channel.updatedAt,
        };
      })
    );

    return { channels: channelsWithRecipients };
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
    const isFriend = user.friends.some((f: Types.ObjectId) => f.equals(recipient._id));
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
      .populate('authorId', 'username displayName avatar status customStatus isPremium');

    return {
      messages: messages.reverse().map((msg) => {
        const author = msg.authorId as unknown as {
          _id: Types.ObjectId;
          username: string;
          displayName?: string;
          avatar?: string;
          status?: string;
          customStatus?: string;
          isPremium?: boolean;
        };
        return {
          id: msg._id,
          content: msg.content,
          authorId: author._id,
          author: {
            id: author._id,
            username: author.username,
            displayName: author.displayName,
            avatar: author.avatar,
            status: author.status,
            customStatus: author.customStatus,
            isPremium: author.isPremium,
          },
          channelId: msg.channelId,
          attachments: msg.attachments,
          createdAt: msg.createdAt,
          updatedAt: msg.updatedAt,
        };
      }),
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
    if (user.blockedUsers.some((b: Types.ObjectId) => b.equals(recipient._id))) {
      set.status = 400;
      return { error: 'You have blocked this user' };
    }
    if (recipient.blockedUsers.some((b: Types.ObjectId) => b.equals(user._id))) {
      set.status = 403;
      return { error: 'You cannot message this user' };
    }

    // Check DM permissions
    const isFriend = user.friends.some((f: Types.ObjectId) => f.equals(recipient._id));
    if (!isFriend && recipient.settings.privacy.directMessages !== 'everyone') {
      set.status = 403;
      return { error: 'You cannot message this user' };
    }

    // Validate content
    const { content } = body;
    const sanitizedContent = sanitizeInput(content);
    const validation = validateMessageContent(sanitizedContent);
    if (!validation.valid) {
      set.status = 400;
      return { error: validation.error };
    }

    // Get or create DM channel
    const channel = await getOrCreateDMChannel(user._id.toString(), params.recipientId);

    // Create message
    const message = new Message({
      channelId: channel._id,
      authorId: user._id,
      content: sanitizedContent,
      type: 'default',
    });
    await message.save();

    // Update channel's last message
    channel.lastMessageId = message._id;
    channel.updatedAt = new Date();
    await channel.save();

    const messageData = {
      id: message._id,
      content: message.content,
      authorId: user._id,
      author: {
        id: user._id,
        username: user.username,
        displayName: user.displayName,
        avatar: user.avatar,
        status: user.status,
        customStatus: user.customStatus,
        isPremium: user.isPremium,
      },
      channelId: channel._id,
      createdAt: message.createdAt,
    };

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
      content: t.String({ minLength: 1, maxLength: 4000 }),
    }),
  })
  // SSE stream for real-time messages
  .get('/:recipientId/stream', async ({ headers, cookie, params, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    if (!isValidObjectId(params.recipientId)) {
      set.status = 400;
      return { error: 'Invalid recipient ID' };
    }

    // Get or create DM channel
    const channel = await getOrCreateDMChannel(user._id.toString(), params.recipientId);
    const channelKey = channel._id.toString();

    // Create SSE stream
    const stream = new ReadableStream({
      start(controller) {
        // Add to active connections
        if (!activeConnections.has(channelKey)) {
          activeConnections.set(channelKey, new Set());
        }
        activeConnections.get(channelKey)!.add(controller);

        // Send initial ping
        controller.enqueue(new TextEncoder().encode('data: {"type":"connected"}\n\n'));

        // Keep-alive ping every 30 seconds
        const pingInterval = setInterval(() => {
          try {
            controller.enqueue(new TextEncoder().encode('data: {"type":"ping"}\n\n'));
          } catch {
            clearInterval(pingInterval);
          }
        }, 30000);

        // Cleanup on close - Note: In practice this might not be called
        // The connection cleanup happens when the client disconnects
      },
      cancel() {
        // Connection closed - this is called when client disconnects
      },
    });

    set.headers = {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    };

    return stream;
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

    return { success: true };
  }, {
    params: t.Object({
      recipientId: t.String(),
    }),
  });

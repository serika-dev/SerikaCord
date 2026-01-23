import { Elysia, t } from 'elysia';
import { Channel, Message, Server, ServerMember } from '@/lib/models';
import { authenticateRequest } from '@/lib/services/auth';
import { checkRateLimit, getClientIP, sanitizeInput, validateMessageContent, isValidObjectId } from '@/lib/security';
import { cache, getPublisher } from '@/lib/db';
import { config } from '@/lib/config';
import { Types } from 'mongoose';

// Store active SSE connections for server channels
const activeConnections = new Map<string, Set<ReadableStreamDefaultController>>();

// Export for use in message publishing
export function publishToChannel(channelId: string, data: object) {
  const connections = activeConnections.get(channelId);
  if (connections) {
    const encodedData = `data: ${JSON.stringify(data)}\n\n`;
    connections.forEach((controller) => {
      try {
        controller.enqueue(new TextEncoder().encode(encodedData));
      } catch {
        // Connection closed, will be cleaned up
      }
    });
  }
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

// Helper to check channel access
async function checkChannelAccess(userId: string, channelId: string): Promise<{
  hasAccess: boolean;
  channel?: ReturnType<typeof Channel.prototype.toObject>;
  error?: string;
}> {
  const channel = await Channel.findById(channelId);
  
  if (!channel) {
    return { hasAccess: false, error: 'Channel not found' };
  }

  // DM channels
  if (channel.type === 'dm' || channel.type === 'group_dm') {
    if (!channel.recipientIds.some((r: Types.ObjectId) => r.equals(userId))) {
      return { hasAccess: false, error: 'You do not have access to this channel' };
    }
    return { hasAccess: true, channel };
  }

  // Server channels
  if (channel.serverId) {
    const membership = await ServerMember.findOne({
      serverId: channel.serverId,
      userId,
    });

    if (!membership) {
      return { hasAccess: false, error: 'You are not a member of this server' };
    }

    return { hasAccess: true, channel };
  }

  return { hasAccess: false, error: 'Invalid channel' };
}

export const channelRoutes = new Elysia({ prefix: '/channels' })
  // Get channel
  .get('/:channelId', async ({ headers, cookie, params, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    if (!isValidObjectId(params.channelId)) {
      set.status = 400;
      return { error: 'Invalid channel ID' };
    }

    const { hasAccess, channel, error } = await checkChannelAccess(
      user._id.toString(),
      params.channelId
    );

    if (!hasAccess) {
      set.status = 403;
      return { error };
    }

    return { channel };
  }, {
    params: t.Object({
      channelId: t.String(),
    }),
  })
  // Update channel
  .patch('/:channelId', async ({ headers, cookie, params, body, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const { hasAccess, channel, error } = await checkChannelAccess(
      user._id.toString(),
      params.channelId
    );

    if (!hasAccess || !channel) {
      set.status = 403;
      return { error: error || 'Access denied' };
    }

    // Check permissions (owner or manage channels)
    if (channel.serverId) {
      const server = await Server.findById(channel.serverId);
      if (!server?.ownerId.equals(user._id)) {
        set.status = 403;
        return { error: 'You do not have permission to edit this channel' };
      }
    }

    const { name, topic, nsfw, rateLimitPerUser, bitrate, userLimit } = body;

    if (name !== undefined) channel.name = sanitizeInput(name);
    if (topic !== undefined) channel.topic = sanitizeInput(topic);
    if (nsfw !== undefined) channel.nsfw = nsfw;
    if (rateLimitPerUser !== undefined) channel.rateLimitPerUser = rateLimitPerUser;
    if (bitrate !== undefined) channel.bitrate = bitrate;
    if (userLimit !== undefined) channel.userLimit = userLimit;

    await channel.save();

    // Publish update event
    const publisher = getPublisher();
    if (publisher) {
      await publisher.publish('channel:update', JSON.stringify({
        channelId: channel._id,
        serverId: channel.serverId,
        updates: body,
      }));
    }

    return { success: true, channel };
  }, {
    params: t.Object({
      channelId: t.String(),
    }),
    body: t.Object({
      name: t.Optional(t.String({ minLength: 1, maxLength: 100 })),
      topic: t.Optional(t.String({ maxLength: 1024 })),
      nsfw: t.Optional(t.Boolean()),
      rateLimitPerUser: t.Optional(t.Number({ minimum: 0, maximum: 21600 })),
      bitrate: t.Optional(t.Number({ minimum: 8000, maximum: 384000 })),
      userLimit: t.Optional(t.Number({ minimum: 0, maximum: 99 })),
    }),
  })
  // Delete channel
  .delete('/:channelId', async ({ headers, cookie, params, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const { hasAccess, channel, error } = await checkChannelAccess(
      user._id.toString(),
      params.channelId
    );

    if (!hasAccess || !channel) {
      set.status = 403;
      return { error: error || 'Access denied' };
    }

    // Can't delete DMs this way
    if (channel.type === 'dm' || channel.type === 'group_dm') {
      set.status = 400;
      return { error: 'Cannot delete DM channels' };
    }

    // Check permissions
    if (channel.serverId) {
      const server = await Server.findById(channel.serverId);
      if (!server?.ownerId.equals(user._id)) {
        set.status = 403;
        return { error: 'You do not have permission to delete this channel' };
      }
    }

    // Soft delete messages
    await Message.updateMany(
      { channelId: channel._id },
      { isDeleted: true, deletedAt: new Date() }
    );

    await channel.deleteOne();

    // Publish delete event
    const publisher = getPublisher();
    if (publisher) {
      await publisher.publish('channel:delete', JSON.stringify({
        channelId: params.channelId,
        serverId: channel.serverId,
      }));
    }

    return { success: true };
  }, {
    params: t.Object({
      channelId: t.String(),
    }),
  })
  // Get messages
  .get('/:channelId/messages', async ({ headers, cookie, params, query, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const { hasAccess, error } = await checkChannelAccess(
      user._id.toString(),
      params.channelId
    );

    if (!hasAccess) {
      set.status = 403;
      return { error };
    }

    const limit = Math.min(parseInt(query.limit || '50'), config.MAX_MESSAGES_PER_FETCH);
    const before = query.before;
    const after = query.after;
    const around = query.around;

    const filter: Record<string, unknown> = {
      channelId: params.channelId,
      isDeleted: false,
    };

    if (before) {
      filter._id = { $lt: before };
    } else if (after) {
      filter._id = { $gt: after };
    } else if (around) {
      filter._id = { $lte: around };
    }

    const messages = await Message.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate('authorId', 'username displayName avatar status')
      .lean();

    messages.reverse();

    return { messages };
  }, {
    params: t.Object({
      channelId: t.String(),
    }),
    query: t.Object({
      limit: t.Optional(t.String()),
      before: t.Optional(t.String()),
      after: t.Optional(t.String()),
      around: t.Optional(t.String()),
    }),
  })
  // Send message
  .post('/:channelId/messages', async ({ headers, cookie, params, body, request, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const { hasAccess, channel, error } = await checkChannelAccess(
      user._id.toString(),
      params.channelId
    );

    if (!hasAccess || !channel) {
      set.status = 403;
      return { error: error || 'Access denied' };
    }

    // Rate limit messages
    const rateLimit = await checkRateLimit('message', `${user._id}:${params.channelId}`);
    if (!rateLimit.success) {
      set.status = 429;
      return { error: 'Message rate limited', retryAfter: rateLimit.retryAfter };
    }

    // Global rate limit
    const globalRateLimit = await checkRateLimit('messageGlobal', user._id.toString());
    if (!globalRateLimit.success) {
      set.status = 429;
      return { error: 'Global message rate limited', retryAfter: globalRateLimit.retryAfter };
    }

    // Check slowmode
    if (channel.rateLimitPerUser > 0) {
      const lastMessage = await Message.findOne({
        channelId: params.channelId,
        authorId: user._id,
        isDeleted: false,
      }).sort({ createdAt: -1 });

      if (lastMessage) {
        const timeSinceLastMessage = Date.now() - lastMessage.createdAt.getTime();
        if (timeSinceLastMessage < channel.rateLimitPerUser * 1000) {
          const waitTime = Math.ceil((channel.rateLimitPerUser * 1000 - timeSinceLastMessage) / 1000);
          set.status = 429;
          return { error: `Slowmode enabled. Wait ${waitTime} seconds.`, retryAfter: waitTime };
        }
      }
    }

    const { content, replyTo, attachments = [] } = body;

    // Validate content
    if (!content && attachments.length === 0) {
      set.status = 400;
      return { error: 'Message must have content or attachments' };
    }

    if (content) {
      const validation = validateMessageContent(content);
      if (!validation.valid) {
        set.status = 400;
        return { error: validation.error };
      }
    }

    // Sanitize content
    const sanitizedContent = content ? sanitizeInput(content) : '';

    // Parse mentions
    const mentionedUserIds: string[] = [];
    const mentionedRoleIds: string[] = [];
    const mentionedChannelIds: string[] = [];
    let mentionEveryone = false;

    // @user mentions
    const userMentionRegex = /<@!?(\w{24})>/g;
    let match;
    while ((match = userMentionRegex.exec(sanitizedContent)) !== null) {
      if (isValidObjectId(match[1])) {
        mentionedUserIds.push(match[1]);
      }
    }

    // @role mentions
    const roleMentionRegex = /<@&(\w{24})>/g;
    while ((match = roleMentionRegex.exec(sanitizedContent)) !== null) {
      if (isValidObjectId(match[1])) {
        mentionedRoleIds.push(match[1]);
      }
    }

    // #channel mentions
    const channelMentionRegex = /<#(\w{24})>/g;
    while ((match = channelMentionRegex.exec(sanitizedContent)) !== null) {
      if (isValidObjectId(match[1])) {
        mentionedChannelIds.push(match[1]);
      }
    }

    // @everyone/@here
    if (/@(everyone|here)/.test(sanitizedContent)) {
      mentionEveryone = true;
    }

    // Create message
    const message = new Message({
      channelId: params.channelId,
      serverId: channel.serverId,
      authorId: user._id,
      content: sanitizedContent,
      type: replyTo ? 'reply' : 'default',
      referencedMessageId: replyTo,
      attachments,
      mentionEveryone,
      mentionedUserIds: [...new Set(mentionedUserIds)],
      mentionedRoleIds: [...new Set(mentionedRoleIds)],
      mentionedChannelIds: [...new Set(mentionedChannelIds)],
    });

    await message.save();

    // Update channel's last message
    channel.lastMessageId = message._id;
    await channel.save();

    // Populate author for response
    await message.populate('authorId', 'username displayName avatar status');

    // Publish message event
    const publisher = getPublisher();
    if (publisher) {
      await publisher.publish('message:create', JSON.stringify({
        channelId: params.channelId,
        serverId: channel.serverId,
        message: message.toJSON(),
      }));
    }

    // Send to SSE connections
    publishToChannel(params.channelId, {
      type: 'message',
      message: message.toJSON(),
    });

    return { message };
  }, {
    params: t.Object({
      channelId: t.String(),
    }),
    body: t.Object({
      content: t.Optional(t.String({ maxLength: 4000 })),
      replyTo: t.Optional(t.String()),
      attachments: t.Optional(t.Array(t.Object({
        id: t.String(),
        filename: t.String(),
        contentType: t.String(),
        size: t.Number(),
        url: t.String(),
        width: t.Optional(t.Number()),
        height: t.Optional(t.Number()),
      }))),
    }),
  })
  // Edit message
  .patch('/:channelId/messages/:messageId', async ({ headers, cookie, params, body, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const { hasAccess, channel, error } = await checkChannelAccess(
      user._id.toString(),
      params.channelId
    );

    if (!hasAccess || !channel) {
      set.status = 403;
      return { error: error || 'Access denied' };
    }

    const message = await Message.findOne({
      _id: params.messageId,
      channelId: params.channelId,
      isDeleted: false,
    });

    if (!message) {
      set.status = 404;
      return { error: 'Message not found' };
    }

    // Only author can edit their own messages
    if (!message.authorId.equals(user._id)) {
      set.status = 403;
      return { error: 'You can only edit your own messages' };
    }

    const { content } = body;

    if (content) {
      const validation = validateMessageContent(content);
      if (!validation.valid) {
        set.status = 400;
        return { error: validation.error };
      }

      message.content = sanitizeInput(content);
      message.edited = true;
      message.editedTimestamp = new Date();
    }

    await message.save();

    // Publish update event
    const publisher = getPublisher();
    if (publisher) {
      await publisher.publish('message:update', JSON.stringify({
        channelId: params.channelId,
        serverId: channel.serverId,
        messageId: params.messageId,
        content: message.content,
        editedTimestamp: message.editedTimestamp,
      }));
    }

    return { success: true, message };
  }, {
    params: t.Object({
      channelId: t.String(),
      messageId: t.String(),
    }),
    body: t.Object({
      content: t.String({ maxLength: 4000 }),
    }),
  })
  // Delete message
  .delete('/:channelId/messages/:messageId', async ({ headers, cookie, params, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const { hasAccess, channel, error } = await checkChannelAccess(
      user._id.toString(),
      params.channelId
    );

    if (!hasAccess || !channel) {
      set.status = 403;
      return { error: error || 'Access denied' };
    }

    const message = await Message.findOne({
      _id: params.messageId,
      channelId: params.channelId,
      isDeleted: false,
    });

    if (!message) {
      set.status = 404;
      return { error: 'Message not found' };
    }

    // Check if user can delete (author or has manage messages permission)
    const isAuthor = message.authorId.equals(user._id);
    let hasPermission = isAuthor;

    if (!isAuthor && channel.serverId) {
      const server = await Server.findById(channel.serverId);
      hasPermission = server?.ownerId.equals(user._id) || false;
    }

    if (!hasPermission) {
      set.status = 403;
      return { error: 'You do not have permission to delete this message' };
    }

    // Soft delete
    message.isDeleted = true;
    message.deletedAt = new Date();
    await message.save();

    // Publish delete event
    const publisher = getPublisher();
    if (publisher) {
      await publisher.publish('message:delete', JSON.stringify({
        channelId: params.channelId,
        serverId: channel.serverId,
        messageId: params.messageId,
      }));
    }

    // Send to SSE connections
    publishToChannel(params.channelId, {
      type: 'delete',
      messageId: params.messageId,
    });

    return { success: true };
  }, {
    params: t.Object({
      channelId: t.String(),
      messageId: t.String(),
    }),
  })
  // Typing indicator
  .post('/:channelId/typing', async ({ headers, cookie, params, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const { hasAccess, channel, error } = await checkChannelAccess(
      user._id.toString(),
      params.channelId
    );

    if (!hasAccess || !channel) {
      set.status = 403;
      return { error: error || 'Access denied' };
    }

    // Set typing in Redis
    await cache.setTyping(params.channelId, user._id.toString());

    // Publish typing event
    const publisher = getPublisher();
    if (publisher) {
      await publisher.publish('typing:start', JSON.stringify({
        channelId: params.channelId,
        serverId: channel.serverId,
        userId: user._id,
        username: user.username,
      }));
    }

    // Send to SSE connections
    publishToChannel(params.channelId, {
      type: 'typing',
      userId: user._id,
      username: user.username,
    });

    return { success: true };
  }, {
    params: t.Object({
      channelId: t.String(),
    }),
  })
  // SSE stream for real-time messages
  .get('/:channelId/stream', async ({ headers, cookie, params, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    if (!isValidObjectId(params.channelId)) {
      set.status = 400;
      return { error: 'Invalid channel ID' };
    }

    const { hasAccess, error } = await checkChannelAccess(
      user._id.toString(),
      params.channelId
    );

    if (!hasAccess) {
      set.status = 403;
      return { error: error || 'Access denied' };
    }

    const channelKey = params.channelId;
    let controllerRef: ReadableStreamDefaultController | null = null;

    // Create SSE stream
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
        const pingInterval = setInterval(() => {
          try {
            controller.enqueue(new TextEncoder().encode('data: {"type":"ping"}\n\n'));
          } catch {
            clearInterval(pingInterval);
            activeConnections.get(channelKey)?.delete(controller);
          }
        }, 30000);
      },
      cancel() {
        // Connection closed - cleanup
        if (controllerRef) {
          activeConnections.get(channelKey)?.delete(controllerRef);
        }
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
      channelId: t.String(),
    }),
  });

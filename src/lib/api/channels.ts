import { Elysia, t } from 'elysia';
import { Channel, Message, Server, ServerMember } from '@/lib/models';
import { authenticateRequest } from '@/lib/services/auth';
import { checkRateLimit, getClientIP, sanitizeInput, validateMessageContent, isValidObjectId, encryptForStorage, decryptFromStorage } from '@/lib/security';
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

    // Transform for frontend - return array directly and map _id to id
    // Decrypt messages
    const decryptedMessages = await Promise.all(messages.map(async (msg) => {
      const author = msg.authorId as any;
      const decryptedContent = await decryptFromStorage(msg.content);
      return {
        id: msg._id.toString(),
        content: decryptedContent,
        authorId: author?._id?.toString() || msg.authorId,
        author: author ? {
          id: author._id.toString(),
          username: author.username,
          displayName: author.displayName || author.username,
          avatar: author.avatar,
          status: author.status,
        } : null,
        channelId: msg.channelId.toString(),
        serverId: msg.serverId?.toString(),
        createdAt: msg.createdAt,
        updatedAt: msg.updatedAt,
        attachments: msg.attachments || [],
        edited: msg.edited,
        pinned: msg.pinned,
        reactions: msg.reactions || [],
      };
    }));

    return decryptedMessages;
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

    // Encrypt content for storage
    const encryptedContent = sanitizedContent ? await encryptForStorage(sanitizedContent) : '';

    // Create message
    const message = new Message({
      channelId: params.channelId,
      serverId: channel.serverId,
      authorId: user._id,
      content: encryptedContent,
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

    // Transform message for frontend (return original sanitized content, not encrypted)
    const author = message.authorId as any;
    const messageResponse = {
      id: message._id.toString(),
      content: sanitizedContent, // Return original content, not encrypted
      authorId: author?._id?.toString() || message.authorId,
      author: author ? {
        id: author._id.toString(),
        username: author.username,
        displayName: author.displayName || author.username,
        avatar: author.avatar,
        status: author.status,
      } : null,
      channelId: message.channelId.toString(),
      serverId: message.serverId?.toString(),
      createdAt: message.createdAt,
      updatedAt: message.updatedAt,
      attachments: message.attachments || [],
      edited: message.edited,
      pinned: message.pinned,
      reactions: message.reactions || [],
    };

    // Publish message event
    const publisher = getPublisher();
    if (publisher) {
      await publisher.publish('message:create', JSON.stringify({
        channelId: params.channelId,
        serverId: channel.serverId,
        message: messageResponse,
      }));
    }

    // Send to SSE connections
    publishToChannel(params.channelId, {
      type: 'message',
      message: messageResponse,
    });

    return { message: messageResponse };
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

    let sanitizedEditContent = '';
    if (content) {
      const validation = validateMessageContent(content);
      if (!validation.valid) {
        set.status = 400;
        return { error: validation.error };
      }

      sanitizedEditContent = sanitizeInput(content);
      // Encrypt content for storage
      message.content = await encryptForStorage(sanitizedEditContent);
      message.edited = true;
      message.editedTimestamp = new Date();
    }

    await message.save();

    // Publish update event with decrypted content for SSE
    const publisher = getPublisher();
    if (publisher) {
      await publisher.publish('message:update', JSON.stringify({
        channelId: params.channelId,
        serverId: channel.serverId,
        messageId: params.messageId,
        content: sanitizedEditContent, // Send decrypted for SSE
        editedTimestamp: message.editedTimestamp,
      }));
    }

    return { success: true, message: { ...message.toObject(), content: sanitizedEditContent } };
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
  // Add reaction to message
  .put('/:channelId/messages/:messageId/reactions/:emoji/@me', async ({ headers, cookie, params, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    if (!isValidObjectId(params.channelId) || !isValidObjectId(params.messageId)) {
      set.status = 400;
      return { error: 'Invalid ID' };
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
      isDeleted: { $ne: true },
    });

    if (!message) {
      set.status = 404;
      return { error: 'Message not found' };
    }

    // Decode the emoji (handles URL encoding like %F0%9F%91%8D for 👍)
    const decodedEmoji = decodeURIComponent(params.emoji);
    
    // Find or create reaction
    const existingReaction = message.reactions.find(
      (r: { emoji: { name: string; id?: string } }) => r.emoji.name === decodedEmoji || r.emoji.id === decodedEmoji
    );

    if (existingReaction) {
      // Check if user already reacted
      if (!existingReaction.userIds.some((id: Types.ObjectId) => id.equals(user._id))) {
        existingReaction.userIds.push(user._id);
        existingReaction.count++;
      }
    } else {
      // Add new reaction
      message.reactions.push({
        emoji: { name: decodedEmoji },
        count: 1,
        userIds: [user._id],
      });
    }

    await message.save();

    // Publish reaction event
    publishToChannel(params.channelId, {
      type: 'reaction_add',
      messageId: params.messageId,
      emoji: decodedEmoji,
      userId: user._id,
      count: existingReaction ? existingReaction.count : 1,
    });

    return { success: true };
  }, {
    params: t.Object({
      channelId: t.String(),
      messageId: t.String(),
      emoji: t.String(),
    }),
  })
  // Remove reaction from message
  .delete('/:channelId/messages/:messageId/reactions/:emoji/@me', async ({ headers, cookie, params, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    if (!isValidObjectId(params.channelId) || !isValidObjectId(params.messageId)) {
      set.status = 400;
      return { error: 'Invalid ID' };
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
      isDeleted: { $ne: true },
    });

    if (!message) {
      set.status = 404;
      return { error: 'Message not found' };
    }

    const decodedEmoji = decodeURIComponent(params.emoji);
    const reactions = message.reactions as Array<{ emoji: { name: string; id?: string }; count: number; userIds: Types.ObjectId[] }>;
    const reactionIndex = reactions.findIndex(
      r => r.emoji.name === decodedEmoji || r.emoji.id === decodedEmoji
    );

    if (reactionIndex !== -1) {
      const reaction = reactions[reactionIndex];
      reaction.userIds = reaction.userIds.filter(id => !id.equals(user._id));
      reaction.count = reaction.userIds.length;

      if (reaction.count === 0) {
        message.reactions.splice(reactionIndex, 1);
      }

      await message.save();
    }

    // Publish reaction removal event
    publishToChannel(params.channelId, {
      type: 'reaction_remove',
      messageId: params.messageId,
      emoji: decodedEmoji,
      userId: user._id,
    });

    return { success: true };
  }, {
    params: t.Object({
      channelId: t.String(),
      messageId: t.String(),
      emoji: t.String(),
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
  .get('/:channelId/stream', async ({ headers, cookie, params }) => {
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

    if (!isValidObjectId(params.channelId)) {
      const errorStream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ type: 'error', error: 'Invalid channel ID' })}\n\n`));
          controller.close();
        },
      });
      return new Response(errorStream, { headers: sseHeaders });
    }

    const { hasAccess, error } = await checkChannelAccess(
      user._id.toString(),
      params.channelId
    );

    if (!hasAccess) {
      const errorStream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ type: 'error', error: error || 'Access denied' })}\n\n`));
          controller.close();
        },
      });
      return new Response(errorStream, { headers: sseHeaders });
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

    return new Response(stream, { headers: sseHeaders });
  }, {
    params: t.Object({
      channelId: t.String(),
    }),
  });

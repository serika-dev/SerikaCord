import { Elysia, t } from 'elysia';
import { Channel, Message, Role, Server, ServerMember, ServerSticker, User } from '@/lib/models';
import { authenticateRequest } from '@/lib/services/auth';
import { parseCustomEmojis, normalizeEmojiFormat, getReactionEmoji } from '@/lib/services/emoji';
import { checkRateLimit, sanitizeInput, validateMessageContent, isValidObjectId, encryptForStorage, decryptFromStorage, rejectInvalidObjectIdParams } from '@/lib/security';
import { decodeHtmlEntities } from '@/lib/chat/messages';
import { cache, getPublisher } from '@/lib/db';
import { config } from '@/lib/config';
import { Types } from 'mongoose';

// Helper to safely compare IDs (handles both ObjectId and string)
function compareIds(id1: Types.ObjectId | string, id2: Types.ObjectId | string): boolean {
  const str1 = id1 instanceof Types.ObjectId ? id1.toString() : id1;
  const str2 = id2 instanceof Types.ObjectId ? id2.toString() : id2;
  return str1 === str2;
}

interface PopulatedAuthor {
  _id: Types.ObjectId;
  username: string;
  displayName?: string;
  avatar?: string;
  status?: string;
  customization?: {
    profileColor?: string;
    profileAccentColor?: string;
    profileGradient?: string[];
    displayNameStyle?: {
      font?: string;
      effect?: string;
      color?: string;
      gradient?: string[];
    };
  } | null;
}

interface ReferencedMessageRaw {
  _id: Types.ObjectId;
  content?: string;
  authorId?: PopulatedAuthor | Types.ObjectId | string | null;
  createdAt?: Date;
}

interface RawLeanMessage {
  _id: Types.ObjectId;
  content?: string;
  authorId?: PopulatedAuthor | Types.ObjectId | string | null;
  referencedMessageId?: ReferencedMessageRaw | Types.ObjectId | string | null;
  channelId: Types.ObjectId;
  serverId?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
  attachments?: unknown[];
  edited?: boolean;
  type?: string;
  pinned?: boolean;
  reactions?: unknown[];
  mentionEveryone?: boolean;
  mentionedUserIds?: Array<Types.ObjectId | string>;
  mentionedRoleIds?: Array<Types.ObjectId | string>;
  mentionedChannelIds?: Array<Types.ObjectId | string>;
  sticker?: { id: string; name: string; imageUrl: string };
}

function isPopulatedAuthor(value: unknown): value is PopulatedAuthor {
  return Boolean(value) && typeof value === 'object' && '_id' in (value as Record<string, unknown>);
}

function isReferencedMessageRaw(value: unknown): value is ReferencedMessageRaw {
  return Boolean(value) && typeof value === 'object' && '_id' in (value as Record<string, unknown>) && !(value instanceof Types.ObjectId);
}

const PRESERVED_MESSAGE_TOKEN_REGEX = /<@!?[0-9a-fA-F]{24}>|<@&[0-9a-fA-F]{24}>|<#(?:[0-9a-fA-F]{24})>|<a?:[a-zA-Z0-9_]+:[0-9a-fA-F]{24}>|<t:-?\d{1,13}(?::[tTdDfFRC](?:\[[^\]]*\])?)?>|<t:-?\d{1,13}>/g;
const USER_MENTION_REGEX = /<@!?([0-9a-fA-F]{24})>/g;
const ROLE_MENTION_REGEX = /<@&([0-9a-fA-F]{24})>/g;
const CHANNEL_MENTION_REGEX = /<#([0-9a-fA-F]{24})>/g;

function sanitizeMessageContent(content: string): string {
  const preservedTokens = new Map<string, string>();
  let tokenIndex = 0;
  const placeholderPrefix = '__SERIKACORD_TOKEN__';
  const withPlaceholders = content.replace(PRESERVED_MESSAGE_TOKEN_REGEX, (token) => {
    const key = `${placeholderPrefix}${tokenIndex++}__`;
    preservedTokens.set(key, token);
    return key;
  });

  let sanitized = sanitizeInput(withPlaceholders);
  for (const [placeholder, token] of preservedTokens) {
    sanitized = sanitized.split(placeholder).join(token);
  }
  return decodeHtmlEntities(sanitized);
}

async function extractMentionsFromContent(
  content: string,
  serverId?: Types.ObjectId | string | null
): Promise<{
  mentionEveryone: boolean;
  mentionedUserIds: string[];
  mentionedRoleIds: string[];
  mentionedChannelIds: string[];
}> {
  const mentionedUserIds: string[] = [];
  const mentionedRoleIds: string[] = [];
  const mentionedChannelIds: string[] = [];

  let match: RegExpExecArray | null;

  USER_MENTION_REGEX.lastIndex = 0;
  while ((match = USER_MENTION_REGEX.exec(content)) !== null) {
    if (isValidObjectId(match[1])) {
      mentionedUserIds.push(match[1]);
    }
  }

  ROLE_MENTION_REGEX.lastIndex = 0;
  while ((match = ROLE_MENTION_REGEX.exec(content)) !== null) {
    if (isValidObjectId(match[1])) {
      mentionedRoleIds.push(match[1]);
    }
  }

  CHANNEL_MENTION_REGEX.lastIndex = 0;
  while ((match = CHANNEL_MENTION_REGEX.exec(content)) !== null) {
    if (isValidObjectId(match[1])) {
      mentionedChannelIds.push(match[1]);
    }
  }

  const dedupedUsers = Array.from(new Set(mentionedUserIds));
  const dedupedRoles = Array.from(new Set(mentionedRoleIds));
  const dedupedChannels = Array.from(new Set(mentionedChannelIds));
  const mentionEveryone = /(^|\s)@(everyone|here)\b/i.test(content);

  if (!serverId) {
    return {
      mentionEveryone,
      mentionedUserIds: dedupedUsers,
      mentionedRoleIds: dedupedRoles,
      mentionedChannelIds: dedupedChannels,
    };
  }

  const normalizedServerId = typeof serverId === 'string' ? serverId : serverId.toString();

  const [memberRows, roleRows, channelRows] = await Promise.all([
    dedupedUsers.length
      ? ServerMember.find({
          serverId: normalizedServerId,
          userId: { $in: dedupedUsers.map((id) => new Types.ObjectId(id)) },
        }).select('userId')
      : Promise.resolve([]),
    dedupedRoles.length
      ? Role.find({
          serverId: normalizedServerId,
          _id: { $in: dedupedRoles.map((id) => new Types.ObjectId(id)) },
        }).select('_id')
      : Promise.resolve([]),
    dedupedChannels.length
      ? Channel.find({
          serverId: normalizedServerId,
          _id: { $in: dedupedChannels.map((id) => new Types.ObjectId(id)) },
        }).select('_id')
      : Promise.resolve([]),
  ]);

  return {
    mentionEveryone,
    mentionedUserIds: memberRows.map((row) => row.userId.toString()),
    mentionedRoleIds: roleRows.map((row) => row._id.toString()),
    mentionedChannelIds: channelRows.map((row) => row._id.toString()),
  };
}

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
    if (!channel.recipientIds.some((r: Types.ObjectId | string) => compareIds(r, userId))) {
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

    // Private threads / tickets: only the creator, explicit members, holders of a
    // configured ticket-access role, or server staff (owner) may view.
    if (channel.type === 'private_thread') {
      const isOwner = compareIds(channel.ownerId, userId);
      const isMember = (channel.threadMemberIds || []).some((m: Types.ObjectId | string) => compareIds(m, userId));
      if (!isOwner && !isMember) {
        const server = await Server.findById(channel.serverId).select('ownerId');
        const isServerOwner = server ? compareIds(server.ownerId, userId) : false;
        let hasAccessRole = false;
        if (!isServerOwner && channel.parentId) {
          const parent = await Channel.findById(channel.parentId).select('ticketAccessRoleIds');
          const accessRoles = (parent?.ticketAccessRoleIds || []).map((r: Types.ObjectId) => r.toString());
          if (accessRoles.length) {
            const memberRoles = (membership.roles || []).map((r: Types.ObjectId) => r.toString());
            hasAccessRole = memberRoles.some((r: string) => accessRoles.includes(r));
          }
        }
        if (!isServerOwner && !hasAccessRole) {
          return { hasAccess: false, error: 'You do not have access to this thread' };
        }
      }
    }

    return { hasAccess: true, channel };
  }

  return { hasAccess: false, error: 'Invalid channel' };
}

/**
 * Returns true if a member (with the given role ids) can see every ticket in a
 * ticket-mode forum — i.e. server owner or holder of a configured access role.
 */
async function canAccessAllTickets(
  serverId: Types.ObjectId | string,
  userId: string,
  memberRoleIds: (Types.ObjectId | string)[],
  ticketAccessRoleIds: (Types.ObjectId | string)[],
): Promise<boolean> {
  const server = await Server.findById(serverId).select('ownerId');
  if (server && compareIds(server.ownerId, userId)) return true;
  const access = (ticketAccessRoleIds || []).map((r) => r.toString());
  const mine = (memberRoleIds || []).map((r) => r.toString());
  return mine.some((r) => access.includes(r));
}

export const channelRoutes = new Elysia({ prefix: '/channels' })
  // Reject malformed ObjectId route params before any handler runs
  .onBeforeHandle(rejectInvalidObjectIdParams)
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

    const isThread = channel.type === 'public_thread' || channel.type === 'private_thread';

    // Check permissions (owner or manage channels). Thread owners may manage
    // their own thread (rename / archive / lock).
    let isServerOwner = false;
    if (channel.serverId) {
      const server = await Server.findById(channel.serverId);
      isServerOwner = !!server?.ownerId.equals(user._id);
      const isThreadOwner = isThread && compareIds(channel.ownerId, user._id);
      if (!isServerOwner && !isThreadOwner) {
        set.status = 403;
        return { error: 'You do not have permission to edit this channel' };
      }
    }

    const { name, topic, nsfw, rateLimitPerUser, bitrate, userLimit, parentId, position, permissionOverwrites, type, forumMode, ticketAccessRoleIds, availableTags, archived, locked } = body;

    if (name !== undefined) channel.name = sanitizeInput(name);
    if (topic !== undefined) channel.topic = sanitizeInput(topic);
    if (nsfw !== undefined) channel.nsfw = nsfw;
    // Only text ⇄ announcement conversions are allowed (voice/category are fixed)
    if (type !== undefined && (channel.type === 'text' || channel.type === 'announcement')) {
      if (type === 'text' || type === 'announcement') {
        channel.type = type;
      }
    }
    if (rateLimitPerUser !== undefined) channel.rateLimitPerUser = rateLimitPerUser;
    if (bitrate !== undefined) channel.bitrate = bitrate;
    if (userLimit !== undefined) channel.userLimit = userLimit;
    if (position !== undefined) channel.position = position;

    if (permissionOverwrites !== undefined) {
      channel.permissionOverwrites = permissionOverwrites.map((o: { id: string; type: 'role' | 'member'; allow: string; deny: string }) => ({
        id: new Types.ObjectId(o.id),
        type: o.type,
        allow: o.allow,
        deny: o.deny,
      }));
    }

    if (parentId !== undefined) {
      if (parentId === null) {
        channel.parentId = null;
      } else {
        if (channel.type === 'category') {
          set.status = 400;
          return { error: 'A category cannot have a parent category' };
        }
        if (!isValidObjectId(parentId)) {
          set.status = 400;
          return { error: 'Invalid parent ID' };
        }
        const parentChannel = await Channel.findById(parentId);
        if (!parentChannel || parentChannel.type !== 'category') {
          set.status = 400;
          return { error: 'Invalid parent category' };
        }
        channel.parentId = new Types.ObjectId(parentId);
      }
    }

    // Thread self-management
    if (isThread) {
      if (archived !== undefined) channel.archived = Boolean(archived);
      if (locked !== undefined && isServerOwner) channel.locked = Boolean(locked);
    }

    // Forum configuration (server owner only)
    if (channel.type === 'forum' && isServerOwner) {
      if (forumMode !== undefined && (forumMode === 'posts' || forumMode === 'tickets')) {
        channel.forumMode = forumMode;
      }
      if (ticketAccessRoleIds !== undefined) {
        channel.ticketAccessRoleIds = ticketAccessRoleIds
          .filter((id: string) => isValidObjectId(id))
          .map((id: string) => new Types.ObjectId(id));
      }
      if (availableTags !== undefined) {
        channel.availableTags = availableTags.map((tag: { id?: string; name: string; moderated?: boolean; emojiName?: string }) => ({
          id: tag.id || new Types.ObjectId().toString(),
          name: tag.name,
          moderated: Boolean(tag.moderated),
          emojiName: tag.emojiName,
        }));
      }
    }

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
      type: t.Optional(t.Union([t.Literal('text'), t.Literal('announcement')])),
      parentId: t.Optional(t.Union([t.String(), t.Null()])),
      rateLimitPerUser: t.Optional(t.Number({ minimum: 0, maximum: 21600 })),
      bitrate: t.Optional(t.Number({ minimum: 8000, maximum: 384000 })),
      userLimit: t.Optional(t.Number({ minimum: 0, maximum: 99 })),
      position: t.Optional(t.Number({ minimum: 0 })),
      permissionOverwrites: t.Optional(t.Array(t.Object({
        id: t.String(),
        type: t.Union([t.Literal('role'), t.Literal('member')]),
        allow: t.String(),
        deny: t.String(),
      }))),
      forumMode: t.Optional(t.Union([t.Literal('posts'), t.Literal('tickets')])),
      ticketAccessRoleIds: t.Optional(t.Array(t.String())),
      availableTags: t.Optional(t.Array(t.Object({
        id: t.Optional(t.String()),
        name: t.String({ minLength: 1, maxLength: 40 }),
        moderated: t.Optional(t.Boolean()),
        emojiName: t.Optional(t.String()),
      }))),
      archived: t.Optional(t.Boolean()),
      locked: t.Optional(t.Boolean()),
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
  // ── Forum threads ─────────────────────────────────────────────────────────
  // List threads (posts / tickets) inside a forum channel.
  .get('/:channelId/threads', async ({ headers, cookie, params, query, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const { hasAccess, channel, error } = await checkChannelAccess(user._id.toString(), params.channelId);
    if (!hasAccess || !channel) {
      set.status = 403;
      return { error: error || 'Access denied' };
    }
    if (channel.type !== 'forum') {
      set.status = 400;
      return { error: 'Channel is not a forum' };
    }

    const includeArchived = (query as { archived?: string }).archived === 'true';
    const filter: Record<string, unknown> = {
      parentId: channel._id,
      type: { $in: ['public_thread', 'private_thread'] },
    };
    if (!includeArchived) filter.archived = false;

    let threads = await Channel.find(filter)
      .sort({ lastMessageId: -1, createdAt: -1 })
      .limit(100)
      .lean();

    // Ticket forums: hide tickets the requester isn't a party to (unless staff / access role).
    if (channel.forumMode === 'tickets') {
      const membership = await ServerMember.findOne({ serverId: channel.serverId, userId: user._id }).select('roles');
      const canSeeAll = await canAccessAllTickets(
        channel.serverId,
        user._id.toString(),
        (membership?.roles || []) as Types.ObjectId[],
        (channel.ticketAccessRoleIds || []) as Types.ObjectId[],
      );
      if (!canSeeAll) {
        threads = threads.filter((t) =>
          compareIds(t.ownerId, user._id.toString()) ||
          (t.threadMemberIds || []).some((m: Types.ObjectId) => compareIds(m, user._id.toString())),
        );
      }
    }

    const ownerIds = threads.map((t) => t.ownerId).filter(Boolean);
    const owners = await User.find({ _id: { $in: ownerIds } }).select('username displayName avatar').lean();
    const ownerMap = new Map(owners.map((o) => [o._id.toString(), o]));

    return {
      forumMode: channel.forumMode,
      availableTags: channel.availableTags || [],
      threads: threads.map((t) => {
        const owner = t.ownerId ? ownerMap.get(t.ownerId.toString()) : null;
        return {
          id: t._id.toString(),
          name: t.name,
          type: t.type,
          archived: t.archived,
          locked: t.locked,
          appliedTags: t.appliedTags || [],
          messageCount: t.messageCount || 0,
          lastMessageId: t.lastMessageId?.toString() || null,
          createdAt: t.createdAt,
          owner: owner ? {
            id: owner._id.toString(),
            username: owner.username,
            displayName: owner.displayName,
            avatar: owner.avatar,
          } : null,
        };
      }),
    };
  }, {
    params: t.Object({ channelId: t.String() }),
    query: t.Object({ archived: t.Optional(t.String()) }),
  })
  // Create a thread (post / ticket) inside a forum channel.
  .post('/:channelId/threads', async ({ headers, cookie, params, body, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const { hasAccess, channel: forum, error } = await checkChannelAccess(user._id.toString(), params.channelId);
    if (!hasAccess || !forum) {
      set.status = 403;
      return { error: error || 'Access denied' };
    }
    if (forum.type !== 'forum') {
      set.status = 400;
      return { error: 'Channel is not a forum' };
    }

    const { name, content, appliedTags = [] } = body;
    const trimmedName = sanitizeInput(name).slice(0, 100);
    if (!trimmedName) {
      set.status = 400;
      return { error: 'Post title is required' };
    }
    if (!content || !content.trim()) {
      set.status = 400;
      return { error: 'Post body is required' };
    }
    const validation = validateMessageContent(content);
    if (!validation.valid) {
      set.status = 400;
      return { error: validation.error };
    }

    const isTicket = forum.forumMode === 'tickets';

    // Validate applied tags against the forum's available tags
    const validTagIds = new Set((forum.availableTags || []).map((tag: { id: string }) => tag.id));
    const tags = (appliedTags || []).filter((id: string) => validTagIds.has(id));

    const thread = new Channel({
      serverId: forum.serverId,
      name: trimmedName,
      type: isTicket ? 'private_thread' : 'public_thread',
      parentId: forum._id,
      ownerId: user._id,
      position: 0,
      appliedTags: tags,
      threadMemberIds: [user._id],
      messageCount: 1,
    });
    await thread.save();

    // Initial post message lives in the thread channel.
    let sanitizedContent = normalizeEmojiFormat(sanitizeMessageContent(content));
    const mentionData = await extractMentionsFromContent(sanitizedContent, forum.serverId || null);
    const encryptedContent = await encryptForStorage(sanitizedContent);
    const message = new Message({
      channelId: thread._id,
      serverId: forum.serverId,
      authorId: user._id,
      content: encryptedContent,
      type: 'default',
      mentionEveryone: mentionData.mentionEveryone,
      mentionedUserIds: mentionData.mentionedUserIds,
      mentionedRoleIds: mentionData.mentionedRoleIds,
      mentionedChannelIds: mentionData.mentionedChannelIds,
    });
    await message.save();
    thread.lastMessageId = message._id;
    await thread.save();

    const publisher = getPublisher();
    if (publisher) {
      await publisher.publish('thread:create', JSON.stringify({
        channelId: forum._id,
        threadId: thread._id,
        serverId: forum.serverId,
      }));
    }

    return {
      success: true,
      thread: {
        id: thread._id.toString(),
        name: thread.name,
        type: thread.type,
        parentId: forum._id.toString(),
        serverId: forum.serverId?.toString(),
        appliedTags: thread.appliedTags,
        archived: false,
        locked: false,
      },
    };
  }, {
    params: t.Object({ channelId: t.String() }),
    body: t.Object({
      name: t.String({ minLength: 1, maxLength: 100 }),
      content: t.String({ minLength: 1, maxLength: 4000 }),
      appliedTags: t.Optional(t.Array(t.String())),
    }),
  })
  // Get messages
  .get('/:channelId/messages', async ({ headers, cookie, params, query, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const { hasAccess, channel, error } = await checkChannelAccess(
      user._id.toString(),
      params.channelId
    );

    if (!hasAccess) {
      set.status = 403;
      return { error };
    }

    // Fetch server ownerId for isOwner flag on authors
    let serverOwnerId: Types.ObjectId | null = null;
    let nicknameMap: Map<string, string> = new Map();
    if (channel?.serverId) {
      const [server, members] = await Promise.all([
        Server.findById(channel.serverId).select('ownerId').lean(),
        ServerMember.find({
          serverId: channel.serverId,
          nickname: { $exists: true, $nin: [null, ''] },
        }).select('userId nickname').lean(),
      ]);
      serverOwnerId = server?.ownerId ?? null;
      for (const m of members) {
        nicknameMap.set(m.userId.toString(), m.nickname!);
      }
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
      .populate('authorId', 'username displayName avatar status badges isSystem customization')
      .populate({
        path: 'referencedMessageId',
        select: '_id content authorId createdAt',
        populate: {
          path: 'authorId',
          select: 'username displayName avatar badges isSystem customization',
        },
      })
      .lean();

    messages.reverse();

    // Transform for frontend - return array directly and map _id to id
    // Decrypt messages
    const decryptedMessages = await Promise.all((messages as RawLeanMessage[]).map(async (msg) => {
      const author = msg.authorId as PopulatedAuthor | Types.ObjectId | string | null;
      const populatedAuthor =
        isPopulatedAuthor(author) ? author : null;
      const decryptedContent = await decryptFromStorage(msg.content || '');

      // Parse custom emojis from the decrypted content. No server restriction
      // here: access was validated at send time, and restricting to the
      // message's own server broke rendering of cross-server emojis on fetch.
      const emojiResult = await parseCustomEmojis(decryptedContent);
      const customEmojis = emojiResult.emojis.map(e => ({
        id: e.id,
        name: e.name,
        animated: e.animated,
        url: e.url,
      }));

      const referencedRaw = msg.referencedMessageId;
      let referencedMessage:
        | {
            id: string;
            content: string;
            author?: {
              id: string;
              username: string;
              displayName: string;
              avatar?: string;
            };
            createdAt?: Date;
          }
        | undefined;

      if (isReferencedMessageRaw(referencedRaw)) {
        const referencedAuthor = referencedRaw.authorId as PopulatedAuthor | Types.ObjectId | string | null;
        const populatedReferencedAuthor =
          isPopulatedAuthor(referencedAuthor) ? referencedAuthor : null;
        referencedMessage = {
          id: referencedRaw._id.toString(),
          content: referencedRaw.content ? await decryptFromStorage(referencedRaw.content) : '',
          author: populatedReferencedAuthor
            ? {
                id: populatedReferencedAuthor._id.toString(),
                username: populatedReferencedAuthor.username,
                displayName: populatedReferencedAuthor.displayName || populatedReferencedAuthor.username,
                avatar: populatedReferencedAuthor.avatar,
              }
            : undefined,
          createdAt: referencedRaw.createdAt,
        };
      }

      return {
        id: msg._id.toString(),
        content: decryptedContent,
        authorId: populatedAuthor?._id?.toString() || msg.authorId,
        author: populatedAuthor ? {
          id: populatedAuthor._id.toString(),
          username: populatedAuthor.username,
          displayName: nicknameMap.get(populatedAuthor._id.toString()) || populatedAuthor.displayName || populatedAuthor.username,
          avatar: populatedAuthor.avatar,
          status: populatedAuthor.status,
          badges: (populatedAuthor as PopulatedAuthor & { badges?: string[] }).badges || [],
          isOwner: serverOwnerId ? serverOwnerId.equals(populatedAuthor._id as unknown as Types.ObjectId) : false,
          isSystem: (populatedAuthor as PopulatedAuthor & { isSystem?: boolean }).isSystem || false,
          customization: populatedAuthor.customization || null,
        } : null,
        channelId: msg.channelId.toString(),
        serverId: msg.serverId?.toString(),
        createdAt: msg.createdAt,
        updatedAt: msg.updatedAt,
        attachments: msg.attachments || [],
        edited: msg.edited,
        type: msg.type,
        referencedMessageId:
          typeof msg.referencedMessageId === 'object' && msg.referencedMessageId?._id
            ? msg.referencedMessageId._id.toString()
            : msg.referencedMessageId?.toString?.(),
        referencedMessage,
        pinned: msg.pinned,
        reactions: msg.reactions || [],
        mentionEveryone: Boolean(msg.mentionEveryone),
        mentionedUserIds: (msg.mentionedUserIds || []).map((id: Types.ObjectId | string) => id.toString()),
        mentionedRoleIds: (msg.mentionedRoleIds || []).map((id: Types.ObjectId | string) => id.toString()),
        mentionedChannelIds: (msg.mentionedChannelIds || []).map((id: Types.ObjectId | string) => id.toString()),
        customEmojis: customEmojis.length > 0 ? customEmojis : undefined,
        sticker: msg.sticker || undefined,
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
  // Search messages in channel (decrypt + filter)
  .get('/:channelId/messages/search', async ({ headers, cookie, params, query, set }) => {
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

    const rawQuery = (query.q || '').trim();
    if (rawQuery.length < 2) {
      return { messages: [] };
    }

    const resultLimit = Math.min(parseInt(query.limit || '20', 10), 50);
    const searchLimit = Math.min(parseInt(query.searchLimit || '400', 10), 1000);

    const candidates = await Message.find({
      channelId: params.channelId,
      isDeleted: false,
    })
      .sort({ createdAt: -1 })
      .limit(searchLimit)
      .populate('authorId', 'username displayName avatar status')
      .lean();

    const lowered = rawQuery.toLowerCase();
    const results: Array<Record<string, unknown>> = [];

    for (const msg of candidates as RawLeanMessage[]) {
      const decrypted = await decryptFromStorage(msg.content || '');
      if (!decrypted.toLowerCase().includes(lowered)) continue;

      const author = msg.authorId as PopulatedAuthor | Types.ObjectId | string | null;
      const populatedAuthor =
        isPopulatedAuthor(author) ? author : null;

      results.push({
        id: msg._id.toString(),
        content: decrypted,
        authorId: populatedAuthor?._id?.toString() || msg.authorId,
        author: populatedAuthor
          ? {
              id: populatedAuthor._id.toString(),
              username: populatedAuthor.username,
              displayName: populatedAuthor.displayName || populatedAuthor.username,
              avatar: populatedAuthor.avatar,
            }
          : null,
        channelId: msg.channelId.toString(),
        createdAt: msg.createdAt,
        updatedAt: msg.updatedAt,
        pinned: msg.pinned,
      });

      if (results.length >= resultLimit) break;
    }

    return { messages: results };
  }, {
    params: t.Object({
      channelId: t.String(),
    }),
    query: t.Object({
      q: t.String({ minLength: 1 }),
      limit: t.Optional(t.String()),
      searchLimit: t.Optional(t.String()),
    }),
  })
  // Send message
  .post('/:channelId/messages', async ({ headers, cookie, params, body, set }) => {
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

    // Fetch server ownerId for isOwner flag and sender nickname
    let serverOwnerId: Types.ObjectId | null = null;
    let senderNickname: string | null = null;
    if (channel.serverId) {
      const [server, member] = await Promise.all([
        Server.findById(channel.serverId).select('ownerId').lean(),
        ServerMember.findOne({ serverId: channel.serverId, userId: user._id }).select('nickname').lean(),
      ]);
      serverOwnerId = server?.ownerId ?? null;
      senderNickname = member?.nickname || null;
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

    const { content, replyTo, attachments = [], sticker } = body;

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

    // Validate content
    if (!content && attachments.length === 0 && !stickerData) {
      set.status = 400;
      return { error: 'Message must have content, attachments, or a sticker' };
    }

    if (content) {
      const validation = validateMessageContent(content);
      if (!validation.valid) {
        set.status = 400;
        return { error: validation.error };
      }
    }

    // Sanitize content while preserving mention/channel/custom-emoji tokens.
    let sanitizedContent = content ? sanitizeMessageContent(content) : '';
    if (sanitizedContent) {
      sanitizedContent = normalizeEmojiFormat(sanitizedContent);
    }

    // Get user's servers for emoji validation
    const userServerMemberships = await ServerMember.find({ userId: user._id }).select('serverId');
    const userServerIds = userServerMemberships.map(m => m.serverId);

    // Parse and validate custom emojis
    const emojiResult = await parseCustomEmojis(sanitizedContent, channel.serverId, userServerIds);
    
    // Store parsed emoji data for the message response
    const customEmojis = emojiResult.emojis.map(e => ({
      id: e.id,
      name: e.name,
      animated: e.animated,
      url: e.url,
    }));

    const mentionData = await extractMentionsFromContent(sanitizedContent, channel.serverId || null);

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
      sticker: stickerData,
      mentionEveryone: mentionData.mentionEveryone,
      mentionedUserIds: mentionData.mentionedUserIds,
      mentionedRoleIds: mentionData.mentionedRoleIds,
      mentionedChannelIds: mentionData.mentionedChannelIds,
    });

    await message.save();

    // Update channel's last message
    channel.lastMessageId = message._id;
    await channel.save();

    // Populate author for response
    await message.populate('authorId', 'username displayName avatar status badges isSystem customization');

    // Transform message for frontend (return original sanitized content, not encrypted)
    const author = message.authorId as PopulatedAuthor | Types.ObjectId | string | null;
    const populatedAuthor =
      isPopulatedAuthor(author) ? author : null;
    let referencedMessage:
      | {
          id: string;
          content: string;
          author?: {
            id: string;
            username: string;
            displayName: string;
            avatar?: string;
          };
          createdAt?: Date;
        }
      | undefined;

    if (message.referencedMessageId) {
      const reference = await Message.findById(message.referencedMessageId)
        .populate('authorId', 'username displayName avatar')
        .lean();
      if (reference) {
        const referenceAuthor = reference.authorId as PopulatedAuthor | Types.ObjectId | string | null;
        const populatedReferenceAuthor =
          isPopulatedAuthor(referenceAuthor) ? referenceAuthor : null;
        referencedMessage = {
          id: reference._id.toString(),
          content: reference.content ? await decryptFromStorage(reference.content) : '',
          author: populatedReferenceAuthor
            ? {
                id: populatedReferenceAuthor._id.toString(),
                username: populatedReferenceAuthor.username,
                displayName: populatedReferenceAuthor.displayName || populatedReferenceAuthor.username,
                avatar: populatedReferenceAuthor.avatar,
              }
            : undefined,
          createdAt: reference.createdAt,
        };
      }
    }

    const messageResponse = {
      id: message._id.toString(),
      content: sanitizedContent, // Return original content, not encrypted
      authorId: populatedAuthor?._id?.toString() || message.authorId,
      author: populatedAuthor ? {
        id: populatedAuthor._id.toString(),
        username: populatedAuthor.username,
        displayName: senderNickname || populatedAuthor.displayName || populatedAuthor.username,
        avatar: populatedAuthor.avatar,
        status: populatedAuthor.status,
        badges: (populatedAuthor as PopulatedAuthor & { badges?: string[] }).badges || [],
        isOwner: serverOwnerId ? serverOwnerId.equals(populatedAuthor._id as unknown as Types.ObjectId) : false,
        isSystem: (populatedAuthor as PopulatedAuthor & { isSystem?: boolean }).isSystem || false,
        customization: populatedAuthor.customization || null,
      } : null,
      channelId: message.channelId.toString(),
      serverId: message.serverId?.toString(),
      createdAt: message.createdAt,
      updatedAt: message.updatedAt,
      attachments: message.attachments || [],
      edited: message.edited,
      type: message.type,
      referencedMessageId: message.referencedMessageId?.toString(),
      referencedMessage,
      pinned: message.pinned,
      reactions: message.reactions || [],
      mentionEveryone: message.mentionEveryone,
      mentionedUserIds: message.mentionedUserIds?.map((id: Types.ObjectId | string) => id.toString()) || [],
      mentionedRoleIds: message.mentionedRoleIds?.map((id: Types.ObjectId | string) => id.toString()) || [],
      mentionedChannelIds: message.mentionedChannelIds?.map((id: Types.ObjectId | string) => id.toString()) || [],
      customEmojis: customEmojis.length > 0 ? customEmojis : undefined, // Include parsed emoji data
      sticker: message.sticker || undefined,
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

    // Fan out to connected bots via the gateway bus.
    try {
      const { emitMessageCreate } = await import('@/lib/services/gatewayEvents');
      await emitMessageCreate(messageResponse as never);
    } catch {}

    // If the message invokes a registered slash command, dispatch an interaction.
    try {
      const { maybeDispatchSlashInteraction } = await import('@/lib/services/interactions');
      await maybeDispatchSlashInteraction(messageResponse as never);
    } catch {}

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
        size: t.Optional(t.Number()),
        url: t.String(),
        width: t.Optional(t.Number()),
        height: t.Optional(t.Number()),
      }))),
      sticker: t.Optional(t.Object({
        id: t.String(),
        name: t.String(),
        imageUrl: t.String(),
        serverId: t.Optional(t.String()),
        serverName: t.Optional(t.String()),
      })),
    }),
  })
  // Get pinned messages for channel
  .get('/:channelId/pins', async ({ headers, cookie, params, query, set }) => {
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

    const limit = Math.min(parseInt(query.limit || '50', 10), 100);
    const pinnedMessages = await Message.find({
      channelId: params.channelId,
      pinned: true,
      isDeleted: false,
    })
      .sort({ updatedAt: -1 })
      .limit(limit)
      .populate('authorId', 'username displayName avatar status')
      .lean();

    const messages = await Promise.all(
      (pinnedMessages as RawLeanMessage[]).map(async (msg) => {
        const author = msg.authorId as PopulatedAuthor | Types.ObjectId | string | null;
        const populatedAuthor =
          isPopulatedAuthor(author) ? author : null;
        const decryptedContent = msg.content ? await decryptFromStorage(msg.content) : '';
        // No server restriction: cross-server emojis must render on fetch
        const emojiResult = await parseCustomEmojis(decryptedContent);
        const customEmojis = emojiResult.emojis.map(e => ({
          id: e.id,
          name: e.name,
          animated: e.animated,
          url: e.url,
        }));
        return {
          id: msg._id.toString(),
          content: decryptedContent,
          authorId: populatedAuthor?._id?.toString() || msg.authorId,
          author: populatedAuthor
            ? {
                id: populatedAuthor._id.toString(),
                username: populatedAuthor.username,
                displayName: populatedAuthor.displayName || populatedAuthor.username,
                avatar: populatedAuthor.avatar,
                status: populatedAuthor.status,
              }
            : null,
          channelId: msg.channelId.toString(),
          createdAt: msg.createdAt,
          updatedAt: msg.updatedAt,
          pinned: true,
          attachments: msg.attachments || [],
          customEmojis: customEmojis.length > 0 ? customEmojis : undefined,
        };
      })
    );

    return { messages };
  }, {
    params: t.Object({
      channelId: t.String(),
    }),
    query: t.Object({
      limit: t.Optional(t.String()),
    }),
  })
  // Pin a message
  .put('/:channelId/messages/:messageId/pin', async ({ headers, cookie, params, set }) => {
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

    message.pinned = true;
    await message.save();

    publishToChannel(params.channelId, {
      type: 'pin_update',
      messageId: params.messageId,
      pinned: true,
      updatedBy: user._id.toString(),
    });

    const publisher = getPublisher();
    if (publisher) {
      await publisher.publish('message:update', JSON.stringify({
        channelId: params.channelId,
        serverId: channel.serverId,
        messageId: params.messageId,
        pinned: true,
      }));
    }

    return { success: true };
  }, {
    params: t.Object({
      channelId: t.String(),
      messageId: t.String(),
    }),
  })
  // Unpin a message
  .delete('/:channelId/messages/:messageId/pin', async ({ headers, cookie, params, set }) => {
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

    message.pinned = false;
    await message.save();

    publishToChannel(params.channelId, {
      type: 'pin_update',
      messageId: params.messageId,
      pinned: false,
      updatedBy: user._id.toString(),
    });

    const publisher = getPublisher();
    if (publisher) {
      await publisher.publish('message:update', JSON.stringify({
        channelId: params.channelId,
        serverId: channel.serverId,
        messageId: params.messageId,
        pinned: false,
      }));
    }

    return { success: true };
  }, {
    params: t.Object({
      channelId: t.String(),
      messageId: t.String(),
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

      sanitizedEditContent = sanitizeMessageContent(content);
      sanitizedEditContent = normalizeEmojiFormat(sanitizedEditContent);
      const mentionData = await extractMentionsFromContent(sanitizedEditContent, channel.serverId || null);
      message.mentionEveryone = mentionData.mentionEveryone;
      message.mentionedUserIds = mentionData.mentionedUserIds.map((id) => new Types.ObjectId(id));
      message.mentionedRoleIds = mentionData.mentionedRoleIds.map((id) => new Types.ObjectId(id));
      message.mentionedChannelIds = mentionData.mentionedChannelIds.map((id) => new Types.ObjectId(id));
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
  .put('/:channelId/messages/:messageId/reactions', async ({ headers, cookie, params, query, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown } >);
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

    // Get emoji from query parameter (avoids URL path encoding issues with custom emoji tokens)
    const decodedEmoji = typeof query.emoji === 'string' ? query.emoji : '';
    if (!decodedEmoji) {
      set.status = 400;
      return { error: 'Missing emoji parameter' };
    }
    
    // Parse emoji - handles both custom emojis and unicode
    const emojiData = await getReactionEmoji(decodedEmoji);
    if (!emojiData) {
      set.status = 400;
      return { error: 'Invalid emoji' };
    }
    
    // Find or create reaction - match by ID for custom emojis, name for unicode
    const existingReaction = message.reactions.find(
      (r: { emoji: { name: string; id?: string } }) => 
        (emojiData.id && r.emoji.id === emojiData.id) || 
        (!emojiData.id && r.emoji.name === emojiData.name)
    );

    if (existingReaction) {
      // Check if user already reacted
      if (!existingReaction.userIds.some((id: Types.ObjectId | string) => compareIds(id, user._id))) {
        existingReaction.userIds.push(user._id);
        existingReaction.count++;
        // Ensure url is populated for custom emoji reactions
        if (emojiData.url) {
          existingReaction.emoji.url = emojiData.url;
        }
      }
    } else {
      // Add new reaction with full emoji data
      message.reactions.push({
        emoji: {
          name: emojiData.name,
          id: emojiData.id,
          animated: emojiData.animated,
          url: emojiData.url,
        },
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
    }),
    query: t.Object({
      emoji: t.String(),
    }),
  })
  // Remove reaction from message
  .delete('/:channelId/messages/:messageId/reactions', async ({ headers, cookie, params, query, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown } >);
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

    const decodedEmoji = typeof query.emoji === 'string' ? query.emoji : '';
    if (!decodedEmoji) {
      set.status = 400;
      return { error: 'Missing emoji parameter' };
    }
    
    // Parse emoji to get ID for custom emojis
    const emojiData = await getReactionEmoji(decodedEmoji);
    
    const reactions = message.reactions as Array<{ emoji: { name: string; id?: string }; count: number; userIds: Types.ObjectId[] }>;
    const reactionIndex = reactions.findIndex(r => 
      (emojiData?.id && r.emoji.id === emojiData.id) || 
      (!emojiData?.id && r.emoji.name === (emojiData?.name || decodedEmoji))
    );

    if (reactionIndex !== -1) {
      const reaction = reactions[reactionIndex];
      reaction.userIds = reaction.userIds.filter((id: Types.ObjectId | string) => !compareIds(id, user._id));
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
      emoji: emojiData?.id || decodedEmoji,
      userId: user._id,
    });

    return { success: true };
  }, {
    params: t.Object({
      channelId: t.String(),
      messageId: t.String(),
    }),
    query: t.Object({
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
    let pingInterval: NodeJS.Timeout | null = null;

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
        // Connection closed - cleanup
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
      channelId: t.String(),
    }),
  });

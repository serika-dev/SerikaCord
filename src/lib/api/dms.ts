import { Elysia, t } from 'elysia';
import { Channel, Message, User, ServerMember, ServerSticker } from '@/lib/models';
import { authenticateRequest } from '@/lib/services/auth';
import { parseCustomEmojis, normalizeEmojiFormat, getReactionEmoji } from '@/lib/services/emoji';
import { resolveEffectiveStatus } from '@/lib/services/presence';
import { checkRateLimit, getClientIP, sanitizeInput, validateMessageContent, encryptForStorage, decryptFromStorage, rejectInvalidObjectIdParams } from '@/lib/security';
import { decodeHtmlEntities } from '@/lib/chat/messages';
import { cache, getPublisher } from '@/lib/db';
import { config } from '@/lib/config';
import { randomUUID } from 'crypto';

function compareIds(id1: string, id2: string): boolean {
  return id1 === id2;
}

const PRESERVED_MESSAGE_TOKEN_REGEX = /<@!?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}>|<@&[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}>|<#(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})>|<a?:[a-zA-Z0-9_]+:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}>|<t:-?\d{1,13}(?::[tTdDfFRC](?:\[[^\]]*\])?)?>|<t:-?\d{1,13}>/g;

function sanitizeMessageContent(content: string): string {
  const preservedTokens = new Map<string, string>();
  let tokenIndex = 0;
  const placeholderPrefix = '__SERIKACORD_TOKEN__';
  const withPlaceholders = content.replace(PRESERVED_MESSAGE_TOKEN_REGEX, (token) => {
    const key = `${placeholderPrefix}${tokenIndex++}__`;
    preservedTokens.set(key, token);
    return key;
  });
  // Escape stray '<' characters that aren't part of preserved tokens.
  // The xss library (stripIgnoreTag) treats "< CPU" as a malformed tag and
  // strips it entirely. Escaping to &lt; here preserves the literal character;
  // decodeHtmlEntities() at the end restores it back to '<'.
  const escaped = withPlaceholders.replace(/</g, '&lt;');

  let sanitized = sanitizeInput(escaped);
  for (const [placeholder, token] of preservedTokens) {
    sanitized = sanitized.split(placeholder).join(token);
  }
  return decodeHtmlEntities(sanitized);
}

function getPublicPresenceStatus(user: { status?: string | null; presenceLastHeartbeatAt?: Date | string | number | null; isSystem?: boolean | null }) {
  return resolveEffectiveStatus({
    status: user.status,
    presenceLastHeartbeatAt: user.presenceLastHeartbeatAt ?? null,
    isSystem: user.isSystem,
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

// Cross-instance realtime: see channels.ts for the rationale. DMs use two Redis
// buses — one keyed by DM channel (message events) and one keyed by user id (DM
// list updates). `originId` prevents the publishing instance double-delivering.
const INSTANCE_ID = randomUUID();
const SSE_DM_BUS = 'sse:dm';
const SSE_DMLIST_BUS = 'sse:dmlist';

function deliverToLocalDmList(userIds: string[], payload: Record<string, unknown>) {
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

export function emitDmListUpdate(userIds: string[], payload: Record<string, unknown>) {
  deliverToLocalDmList(userIds, payload);
  const pub = getPublisher();
  if (pub) {
    pub
      .publish(SSE_DMLIST_BUS, JSON.stringify({ originId: INSTANCE_ID, userIds, payload }))
      .catch(() => {});
  }
}

function deliverToLocalDm(channelId: string, data: object) {
  const connections = activeConnections.get(channelId);
  if (connections) {
    const encodedData = `data: ${JSON.stringify(data)}\n\n`;
    connections.forEach((controller) => {
      try {
        controller.enqueue(new TextEncoder().encode(encodedData));
      } catch {
        connections.delete(controller);
      }
    });
  }
}

// Register a raw SSE write callback into the DM's active connection set.
// Used by server.ts to bypass Next.js response buffering.
export function registerRawDmSSEConnection(
  channelId: string,
  write: (data: string) => void,
): () => void {
  const controller = {
    enqueue: (data: Uint8Array) => { try { write(new TextDecoder().decode(data)); } catch { /* closed */ } },
  } as unknown as ReadableStreamDefaultController;

  if (!activeConnections.has(channelId)) {
    activeConnections.set(channelId, new Set());
  }
  activeConnections.get(channelId)!.add(controller);

  return () => { activeConnections.get(channelId)?.delete(controller); };
}

// Publish a DM event: local + cross-instance fan-out over Redis.
function publishToDm(channelId: string, data: object) {
  deliverToLocalDm(channelId, data);
  const pub = getPublisher();
  if (pub) {
    pub
      .publish(SSE_DM_BUS, JSON.stringify({ originId: INSTANCE_ID, channelId, data }))
      .catch(() => {});
  }
}

// Subscribe this process to the DM SSE buses. Call once at startup with a
// dedicated ioredis connection.
export async function startDmSSEBridge(): Promise<() => void> {
  const Redis = (await import('ioredis')).default;
  const sub = new Redis(config.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: null });
  sub.on('error', (err: Error) => console.error('DM SSE bridge Redis error:', err.message));
  await sub.connect().catch((err: Error) => console.error('DM SSE bridge connect failed:', err.message));
  await sub.subscribe(SSE_DM_BUS, SSE_DMLIST_BUS);
  sub.on('message', (ch: string, payload: string) => {
    try {
      const parsed = JSON.parse(payload);
      if (parsed.originId === INSTANCE_ID) return;
      if (ch === SSE_DM_BUS) {
        deliverToLocalDm(parsed.channelId, parsed.data);
      } else if (ch === SSE_DMLIST_BUS) {
        deliverToLocalDmList(parsed.userIds, parsed.payload);
      }
    } catch (err) {
      console.error('DM SSE bridge: bad payload', err);
    }
  });
  console.log(`✅ DM SSE bridge subscribed to ${SSE_DM_BUS}, ${SSE_DMLIST_BUS}`);
  return () => { void sub.quit().catch(() => {}); };
}

// Helper to get or create DM channel
export async function getOrCreateDMChannel(userId: string, recipientId: string) {
  // Find existing DM channel between users using array contains query
  const channels = await Channel.find({ type: 'dm', recipientId: userId });
  let channel = channels.find(c =>
    c.recipientIds &&
    c.recipientIds.length === 2 &&
    c.recipientIds.includes(recipientId)
  );

  if (!channel) {
    // Create new DM channel
    channel = await Channel.create({
      type: 'dm',
      name: 'Direct Message',
      recipientIds: [userId, recipientId],
      position: 0,
    });
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

    const dmChannels = await Channel.find({ type: 'dm', recipientId: user.id });
    const groupDmChannels = await Channel.find({ type: 'group_dm', recipientId: user.id });
    const channels = [...dmChannels, ...groupDmChannels]
      .sort((a, b) => new Date(b.updatedAt ?? 0).getTime() - new Date(a.updatedAt ?? 0).getTime());

    // Batch fetch all recipient users in a single query
    const allRecipientIds = [...new Set(
      channels.flatMap(c => (c.recipientIds || []).filter((id: string) => id !== user.id))
    )];
    const allRecipients = allRecipientIds.length > 0 ? await User.find({ id: { in: allRecipientIds } }) : [];
    const recipientMap = new Map(allRecipients.map(r => [r.id, r]));

    // Batch fetch all last messages in a single query
    const allLastMessageIds = channels.map(c => c.lastMessageId).filter(Boolean) as string[];
    const allLastMessages = allLastMessageIds.length > 0 ? await Message.find({ id: { in: allLastMessageIds } }) : [];
    const lastMessageMap = new Map(allLastMessages.map(m => [m.id, m]));

    // Populate recipient info, deduplicating by recipient to avoid showing same user twice
    const seenRecipientIds = new Set<string>();
    const channelsWithRecipients = (
      await Promise.all(
        channels.map(async (channel) => {
          const recipientIds = (channel.recipientIds || []).filter(
            (id: string) => id !== user.id
          );
          const recipients = recipientIds.map((id: string) => recipientMap.get(id)).filter(Boolean) as typeof allRecipients;

          let lastMessage = null;
          if (channel.lastMessageId) {
            try {
              const msg = lastMessageMap.get(channel.lastMessageId);
              if (msg) {
                const decryptedContent = msg.content ? await decryptFromStorage(msg.content) : '';
                let displayContent = decryptedContent;
                if (!displayContent) {
                  if (msg.attachments && (msg.attachments as any[]).length > 0) {
                    displayContent = 'Sent an attachment';
                  } else if (msg.sticker) {
                    displayContent = 'Sent a sticker';
                  }
                }
                lastMessage = {
                  id: msg.id,
                  content: displayContent,
                  authorId: msg.authorId,
                  createdAt: msg.createdAt,
                };
              }
            } catch (err) {
              console.error('Failed to populate lastMessage:', err);
            }
          }

          return {
            id: channel.id,
            type: channel.type,
            recipients: recipients.map((r: any) => ({
              id: r.id,
              username: r.username,
              displayName: r.displayName,
              avatar: r.avatar,
              status: getPublicPresenceStatus(r),
              customStatus: r.customStatus,
              isPremium: r.isPremium,
              isSystem: r.isSystem || false,
              isBot: Boolean(r.isBot),
              isVerified: Boolean(r.isVerified),
              customization: r.customization || null,
            })),
            lastMessageId: channel.lastMessageId,
            lastMessage,
            updatedAt: channel.updatedAt,
            _recipientKey: recipientIds.sort().join(','),
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
    const userKey = user.id;

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

    if (!params.recipientId) {
      set.status = 400;
      return { error: 'Invalid recipient ID' };
    }

    // Check if recipient exists
    const recipient = await User.findById(params.recipientId);
    if (!recipient) {
      set.status = 404;
      return { error: 'User not found' };
    }

    // Check if friends or can DM (skip for system users)
    const isFriend = (user.friends || []).some((f: string) => compareIds(f, recipient.id));
    if (!isFriend && !recipient.isSystem && (recipient.settings as any)?.privacy?.directMessages !== 'everyone') {
      set.status = 403;
      return { error: 'You cannot message this user' };
    }

    // Get or create DM channel
    const channel = await getOrCreateDMChannel(user.id, params.recipientId);

    const limit = Math.min(parseInt(query.limit as string) || 50, 100);
    const before = query.before as string | undefined;

    // Build cursor-based DB query
    const msgFilter: Record<string, unknown> = {
      channelId: channel.id,
      isDeleted: false,
      _limit: limit,
    };

    if (before) {
      const beforeMsg = await Message.findById(before);
      if (beforeMsg) {
        msgFilter.createdAtBefore = beforeMsg.createdAt;
      }
    }

    const msgs = await Message.find(msgFilter);
    msgs.reverse(); // oldest first for display

    // Batch fetch authors
    const authorIds = [...new Set(msgs.map(m => m.authorId).filter(Boolean))];
    const authors = authorIds.length > 0 ? await User.find({ id: { in: authorIds } }) : [];
    const authorMap = new Map(authors.map(a => [a.id, a]));

    // Batch fetch referenced messages
    const refIds = [...new Set(msgs.map(m => m.referencedMessageId).filter((id): id is string => typeof id === 'string' && id.length > 0))];
    const refMsgs = refIds.length > 0 ? await Message.find({ id: { in: refIds } }) : [];
    const refMap = new Map(refMsgs.map((m: any) => [m.id, m]));

    // Decrypt messages
    const decryptedMessages = await Promise.all(msgs.map(async (msg: any) => {
      const author = authorMap.get(msg.authorId);
      const decryptedContent = await decryptFromStorage(msg.content);
      const emojiResult = await parseCustomEmojis(decryptedContent);
      const customEmojis = emojiResult.emojis.map(e => ({
        id: e.id,
        name: e.name,
        animated: e.animated,
        url: e.url,
      }));

      let referencedMessage: { id: string; content: string; author?: { id: string; username: string; displayName: string; avatar?: string; isBot?: boolean; isVerified?: boolean }; createdAt?: string } | undefined;
      const refRaw = msg.referencedMessageId;
      if (refRaw && typeof refRaw === 'string') {
        const refMsg = refMap.get(refRaw);
        if (refMsg) {
          const refAuthor = refMsg.authorId ? authorMap.get(refMsg.authorId) || await User.findById(refMsg.authorId) : null;
          const refDecrypted = refMsg.content ? await decryptFromStorage(refMsg.content) : '';
          referencedMessage = {
            id: refMsg.id,
            content: refDecrypted,
            author: refAuthor ? {
              id: refAuthor.id,
              username: refAuthor.username,
              displayName: refAuthor.displayName || refAuthor.username,
              avatar: refAuthor.avatar ?? undefined,
              isBot: Boolean(refAuthor.isBot),
              isVerified: Boolean(refAuthor.isVerified),
            } : undefined,
            createdAt: refMsg.createdAt instanceof Date ? refMsg.createdAt.toISOString() : (refMsg.createdAt ?? undefined),
          };
        }
      }

      return {
        id: msg.id,
        content: decryptedContent,
        authorId: msg.authorId,
        author: author ? {
          id: author.id,
          username: author.username,
          displayName: author.displayName,
          avatar: author.avatar,
          status: getPublicPresenceStatus(author),
          customStatus: author.customStatus,
          isPremium: author.isPremium,
          badges: author.badges || [],
          isSystem: author.isSystem || false,
          isBot: Boolean(author.isBot),
          isVerified: Boolean(author.isVerified),
          customization: author.customization || null,
        } : null,
        channelId: msg.channelId,
        attachments: msg.attachments,
        createdAt: msg.createdAt,
        updatedAt: msg.updatedAt,
        customEmojis: customEmojis.length > 0 ? customEmojis : undefined,
        edited: msg.edited,
        pinned: msg.pinned,
        reactions: msg.reactions || [],
        referencedMessageId: typeof msg.referencedMessageId === 'string' ? msg.referencedMessageId : undefined,
        referencedMessage,
        sticker: msg.sticker || undefined,
      };
    }));

    return {
      messages: decryptedMessages,
      channelId: channel.id,
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
    const rateLimit = await checkRateLimit('message', `${user.id}:${ip}`);
    if (!rateLimit.success) {
      set.status = 429;
      return { error: 'Too many messages', retryAfter: rateLimit.retryAfter };
    }

    if (!params.recipientId) {
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
    if ((user.blockedUsers || []).some((b: string) => compareIds(b, recipient.id))) {
      set.status = 403;
      return { error: 'You have blocked this user' };
    }
    if ((recipient.blockedUsers || []).some((b: string) => compareIds(b, user.id))) {
      set.status = 403;
      return { error: 'You cannot message this user' };
    }

    // Check DM permissions (skip for system users)
    const isFriend = (user.friends || []).some((f: string) => compareIds(f, recipient.id));
    if (!isFriend && !recipient.isSystem && (recipient.settings as any)?.privacy?.directMessages !== 'everyone') {
      set.status = 403;
      return { error: 'You cannot message this user' };
    }

    // Validate content
    const { content, sticker, attachments, replyTo } = body;
    let sanitizedContent = content ? sanitizeMessageContent(content) : '';

    // Validate sticker if provided
    let stickerData: { id: string; name: string; imageUrl: string; serverId?: string; serverName?: string } | undefined;
    if (sticker?.id) {
      const stickerDoc = await ServerSticker.findById(sticker.id);
      if (!stickerDoc || !stickerDoc.available) {
        set.status = 400;
        return { error: 'Sticker not found' };
      }
      let stickerServerName: string | undefined;
      if (stickerDoc.serverId) {
        const { Server } = await import('@/lib/models/Server');
        const stickerServer = await Server.findById(stickerDoc.serverId);
        stickerServerName = stickerServer?.name;
      }
      stickerData = {
        id: stickerDoc.id,
        name: stickerDoc.name,
        imageUrl: stickerDoc.imageUrl,
        serverId: stickerDoc.serverId,
        serverName: stickerServerName,
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
    const userServerMemberships = await ServerMember.find({ userId: user.id });
    const userServerIds = userServerMemberships.map((m: any) => m.serverId);

    // Parse and validate custom emojis
    const emojiResult = await parseCustomEmojis(sanitizedContent, undefined, userServerIds);
    
    // Store parsed emoji data for the message response
    const customEmojis = emojiResult.emojis.map(e => ({
      id: e.id,
      name: e.name,
      animated: e.animated,
      url: e.url,
    }));

    const channel = await getOrCreateDMChannel(user.id, params.recipientId);

    // Encrypt content for storage
    const encryptedContent = await encryptForStorage(sanitizedContent);

    // Validate reply target if provided
    let replyRef: string | undefined;
    let referencedMessage: { id: string; content: string; author?: { id: string; username: string; displayName: string; avatar?: string; isBot?: boolean; isVerified?: boolean }; createdAt?: string } | undefined;
    if (replyTo) {
      const refMsg = await Message.findOne({ id: replyTo, channelId: channel.id, isDeleted: false });
      if (refMsg) {
        replyRef = replyTo;
        const refAuthor = refMsg.authorId ? await User.findById(refMsg.authorId) : null;
        const refDecrypted = refMsg.content ? await decryptFromStorage(refMsg.content) : '';
        referencedMessage = {
          id: refMsg.id,
          content: refDecrypted,
          author: refAuthor ? {
            id: refAuthor.id,
            username: refAuthor.username,
            displayName: refAuthor.displayName || refAuthor.username,
            avatar: refAuthor.avatar ?? undefined,
            isBot: Boolean(refAuthor.isBot),
            isVerified: Boolean(refAuthor.isVerified),
          } : undefined,
          createdAt: refMsg.createdAt instanceof Date ? refMsg.createdAt.toISOString() : (refMsg.createdAt ?? undefined),
        };
      }
    }

    // Create message
    const message = await Message.create({
      channelId: channel.id,
      authorId: user.id,
      content: encryptedContent,
      type: replyRef ? 'reply' : 'default',
      referencedMessageId: replyRef,
      sticker: stickerData,
      attachments: attachments || [],
    });

    // Update channel's last message
    await Channel.updateById(channel.id, { lastMessageId: message.id, updatedAt: new Date() });

    const messageData = {
      id: message.id,
      content: sanitizedContent,
      authorId: user.id,
      author: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        avatar: user.avatar,
        status: getPublicPresenceStatus(user),
        customStatus: user.customStatus,
        isPremium: user.isPremium,
        badges: user.badges || [],
        isSystem: user.isSystem || false,
        isBot: Boolean(user.isBot),
        isVerified: Boolean(user.isVerified),
        customization: user.customization || null,
      },
      channelId: channel.id,
      createdAt: message.createdAt,
      attachments: message.attachments || undefined,
      customEmojis: customEmojis.length > 0 ? customEmojis : undefined,
      sticker: message.sticker || undefined,
      referencedMessageId: replyRef,
      referencedMessage,
    };

    emitDmListUpdate(
      [user.id, params.recipientId],
      {
        type: 'dm:list:update',
        channelId: channel.id,
        recipientId: params.recipientId,
        message: {
          id: message.id,
          content: sanitizedContent.slice(0, 180),
          authorId: user.id,
          createdAt: message.createdAt,
        },
      }
    );

    // Deliver everywhere: local SSE + cross-instance Redis fan-out (non-blocking).
    publishToDm(channel.id, { type: 'message', message: messageData });

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
      replyTo: t.Optional(t.String()),
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

    if (!params.recipientId) {
      const errorStream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ type: 'error', error: 'Invalid recipient ID' })}\n\n`));
          controller.close();
        },
      });
      return new Response(errorStream, { headers: sseHeaders });
    }

    // Get or create DM channel
    const channel = await getOrCreateDMChannel(user.id, params.recipientId);
    const channelKey = channel.id;

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

        // Keep-alive ping every 15 seconds
        pingInterval = setInterval(() => {
          try {
            controller.enqueue(new TextEncoder().encode('data: {"type":"ping"}\n\n'));
          } catch {
            if (pingInterval) {
              clearInterval(pingInterval);
            }
            activeConnections.get(channelKey)?.delete(controller);
          }
        }, 15000);
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

    if (!params.recipientId) {
      set.status = 400;
      return { error: 'Invalid recipient ID' };
    }

    const channel = await getOrCreateDMChannel(user.id, params.recipientId);
    
    // Set typing in Redis
    await cache.setTyping(channel.id, user.id);

    // Publish typing event (local + cross-instance).
    publishToDm(channel.id, {
      type: 'typing',
      userId: user.id,
      username: user.username,
    });

    emitDmListUpdate(
      [user.id, params.recipientId],
      {
        type: 'typing',
        channelId: channel.id,
        userId: user.id,
        username: user.username,
      }
    );

    return { success: true };
  }, {
    params: t.Object({
      recipientId: t.String(),
    }),
  })
  // Edit DM message
  .patch('/:recipientId/messages/:messageId', async ({ headers, cookie, params, body, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    if (!params.recipientId || !params.messageId) {
      set.status = 400;
      return { error: 'Invalid ID' };
    }

    const channel = await getOrCreateDMChannel(user.id, params.recipientId);

    const message = await Message.findOne({
      id: params.messageId,
      channelId: channel.id,
      isDeleted: false,
    });

    if (!message) {
      set.status = 404;
      return { error: 'Message not found' };
    }

    if (message.authorId !== user.id) {
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
      message.content = await encryptForStorage(sanitizedEditContent);
      message.edited = true;
      message.editedTimestamp = new Date();
    }

    await Message.updateById(message.id, {
      content: message.content,
      edited: message.edited,
      editedTimestamp: message.editedTimestamp,
    });

    publishToDm(channel.id, {
      type: 'edit',
      messageId: params.messageId,
      content: sanitizedEditContent,
      editedTimestamp: message.editedTimestamp,
    });

    return { success: true };
  }, {
    params: t.Object({
      recipientId: t.String(),
      messageId: t.String(),
    }),
    body: t.Object({
      content: t.String({ maxLength: 4000 }),
    }),
  })
  // Delete DM message
  .delete('/:recipientId/messages/:messageId', async ({ headers, cookie, params, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    if (!params.recipientId || !params.messageId) {
      set.status = 400;
      return { error: 'Invalid ID' };
    }

    const channel = await getOrCreateDMChannel(user.id, params.recipientId);

    const message = await Message.findOne({
      id: params.messageId,
      channelId: channel.id,
      isDeleted: false,
    });

    if (!message) {
      set.status = 404;
      return { error: 'Message not found' };
    }

    if (message.authorId !== user.id) {
      set.status = 403;
      return { error: 'You can only delete your own messages' };
    }

    await Message.updateById(message.id, {
      isDeleted: true,
      deletedAt: new Date(),
    });

    publishToDm(channel.id, {
      type: 'delete',
      messageId: params.messageId,
    });

    return { success: true };
  }, {
    params: t.Object({
      recipientId: t.String(),
      messageId: t.String(),
    }),
  })
  // Add reaction to DM message
  .put('/:recipientId/messages/:messageId/reactions', async ({ headers, cookie, params, query, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    if (!params.recipientId || !params.messageId) {
      set.status = 400;
      return { error: 'Invalid ID' };
    }

    const channel = await getOrCreateDMChannel(user.id, params.recipientId);

    const message = await Message.findOne({
      id: params.messageId,
      channelId: channel.id,
      isDeleted: false,
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
    const emojiData = await getReactionEmoji(decodedEmoji);
    if (!emojiData) {
      set.status = 400;
      return { error: 'Invalid emoji' };
    }

    const reactions = (message.reactions || []) as Array<{ emoji: { name: string; id?: string; url?: string; animated?: boolean }; count: number; userIds: string[] }>;
    const existingReaction = reactions.find(
      (r) =>
        (emojiData.id && r.emoji.id === emojiData.id) ||
        (!emojiData.id && r.emoji.name === emojiData.name)
    );

    if (existingReaction) {
      if (!existingReaction.userIds.some((id: string) => compareIds(id, user.id))) {
        existingReaction.userIds.push(user.id);
        existingReaction.count++;
        if (emojiData.url) {
          existingReaction.emoji.url = emojiData.url;
        }
      }
    } else {
      reactions.push({
        emoji: {
          name: emojiData.name,
          id: emojiData.id,
          animated: emojiData.animated,
          url: emojiData.url,
        },
        count: 1,
        userIds: [user.id],
      });
    }

    await Message.updateById(message.id, { reactions });

    publishToDm(channel.id, {
      type: 'reaction_add',
      messageId: params.messageId,
      emoji: decodedEmoji,
      userId: user.id,
    });

    return { success: true };
  }, {
    params: t.Object({
      recipientId: t.String(),
      messageId: t.String(),
    }),
    query: t.Object({
      emoji: t.String(),
    }),
  })
  // Remove reaction from DM message
  .delete('/:recipientId/messages/:messageId/reactions', async ({ headers, cookie, params, query, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    if (!params.recipientId || !params.messageId) {
      set.status = 400;
      return { error: 'Invalid ID' };
    }

    const channel = await getOrCreateDMChannel(user.id, params.recipientId);

    const message = await Message.findOne({
      id: params.messageId,
      channelId: channel.id,
      isDeleted: false,
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
    const emojiData = await getReactionEmoji(decodedEmoji);

    const reactions = (message.reactions || []) as Array<{ emoji: { name: string; id?: string }; count: number; userIds: string[] }>;
    const reactionIndex = reactions.findIndex(r =>
      (emojiData?.id && r.emoji.id === emojiData.id) ||
      (!emojiData?.id && r.emoji.name === (emojiData?.name || decodedEmoji))
    );

    if (reactionIndex !== -1) {
      const reaction = reactions[reactionIndex];
      reaction.userIds = reaction.userIds.filter((id: string) => !compareIds(id, user.id));
      reaction.count = reaction.userIds.length;

      if (reaction.count === 0) {
        reactions.splice(reactionIndex, 1);
      }

      await Message.updateById(message.id, { reactions });
    }

    publishToDm(channel.id, {
      type: 'reaction_remove',
      messageId: params.messageId,
      emoji: decodedEmoji,
      userId: user.id,
    });

    return { success: true };
  }, {
    params: t.Object({
      recipientId: t.String(),
      messageId: t.String(),
    }),
    query: t.Object({
      emoji: t.String(),
    }),
  })
  // Get pinned DM messages
  .get('/:recipientId/pins', async ({ headers, cookie, params, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    if (!params.recipientId) {
      set.status = 400;
      return { error: 'Invalid recipient ID' };
    }

    const channel = await getOrCreateDMChannel(user.id, params.recipientId);

    const pinnedMsgs = await Message.find({ channelId: channel.id, pinned: true, isDeleted: false, _limit: 50 });

    // Batch fetch authors
    const authorIds = [...new Set(pinnedMsgs.map(m => m.authorId).filter(Boolean))];
    const authors = authorIds.length > 0 ? await User.find({ id: { in: authorIds } }) : [];
    const authorMap = new Map(authors.map(a => [a.id, a]));

    const messages = await Promise.all(
      pinnedMsgs.map(async (msg: any) => {
        const author = msg.authorId ? authorMap.get(msg.authorId) : null;
        const decryptedContent = msg.content ? await decryptFromStorage(msg.content) : '';
        return {
          id: msg.id,
          content: decryptedContent,
          authorId: msg.authorId,
          author: author ? {
            id: author.id,
            username: author.username,
            displayName: author.displayName || author.username,
            avatar: author.avatar,
          } : null,
          channelId: msg.channelId,
          createdAt: msg.createdAt,
          updatedAt: msg.updatedAt,
          pinned: true,
          attachments: msg.attachments || [],
        };
      })
    );

    return { messages };
  }, {
    params: t.Object({
      recipientId: t.String(),
    }),
  })
  // Pin a DM message
  .put('/:recipientId/messages/:messageId/pin', async ({ headers, cookie, params, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    if (!params.recipientId || !params.messageId) {
      set.status = 400;
      return { error: 'Invalid ID' };
    }

    const channel = await getOrCreateDMChannel(user.id, params.recipientId);

    const message = await Message.findOne({
      id: params.messageId,
      channelId: channel.id,
      isDeleted: false,
    });

    if (!message) {
      set.status = 404;
      return { error: 'Message not found' };
    }

    await Message.updateById(message.id, { pinned: true });

    publishToDm(channel.id, {
      type: 'pin_update',
      messageId: params.messageId,
      pinned: true,
    });

    return { success: true };
  }, {
    params: t.Object({
      recipientId: t.String(),
      messageId: t.String(),
    }),
  })
  // Unpin a DM message
  .delete('/:recipientId/messages/:messageId/pin', async ({ headers, cookie, params, set }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    if (!params.recipientId || !params.messageId) {
      set.status = 400;
      return { error: 'Invalid ID' };
    }

    const channel = await getOrCreateDMChannel(user.id, params.recipientId);

    const message = await Message.findOne({
      id: params.messageId,
      channelId: channel.id,
      isDeleted: false,
    });

    if (!message) {
      set.status = 404;
      return { error: 'Message not found' };
    }

    await Message.updateById(message.id, { pinned: false });

    publishToDm(channel.id, {
      type: 'pin_update',
      messageId: params.messageId,
      pinned: false,
    });

    return { success: true };
  }, {
    params: t.Object({
      recipientId: t.String(),
      messageId: t.String(),
    }),
  });

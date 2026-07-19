import { Elysia, t } from 'elysia';
import { Channel, Message, User, ServerMember, ServerSticker } from '@/lib/models';
import { authenticateRequest } from '@/lib/services/auth';
import { parseCustomEmojis, batchParseCustomEmojis, normalizeEmojiFormat, getReactionEmoji } from '@/lib/services/emoji';
import { resolveEffectiveStatus } from '@/lib/services/presence';
import { checkRateLimit, getClientIP, sanitizeInput, validateMessageContent, encryptForStorage, decryptFromStorage, rejectInvalidObjectIdParams } from '@/lib/security';
import { isSystemUser } from '@/lib/services/systemUsers';
import { decodeHtmlEntities } from '@/lib/chat/messages';
import { cache, getPublisher } from '@/lib/db';
import { config } from '@/lib/config';
import { randomUUID } from 'crypto';
import { normalizeId } from '@/lib/db/normalizeId';

function compareIds(id1: string, id2: string): boolean {
  return normalizeId(id1) === normalizeId(id2);
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

// Normalize message text for duplicate-spam detection. Mirrors the channel
// send guard: trivial variations (whitespace, punctuation, an extra character,
// repeated letters) collapse to the same fingerprint.
function normalizeForSpamCheck(content: string): string {
  return content
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '')
    .replace(/(.)\1+/g, '$1')
    .trim();
}

// How many identical (post-normalization) messages in a row before a send is
// blocked as spam.
const DUPLICATE_SPAM_THRESHOLD = 4;

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

// Shared codecs — instantiating TextEncoder/TextDecoder per event (and per
// recipient) showed up as avoidable allocation churn on the message fan-out
// hot path.
const sseEncoder = new TextEncoder();
const sseDecoder = new TextDecoder();

// Cross-instance realtime: see channels.ts for the rationale. DMs use two Redis
// buses — one keyed by DM channel (message events) and one keyed by user id (DM
// list updates). `originId` prevents the publishing instance double-delivering.
const INSTANCE_ID = randomUUID();
const SSE_DM_BUS = 'sse:dm';
const SSE_DMLIST_BUS = 'sse:dmlist';

function deliverToLocalDmList(userIds: string[], payload: Record<string, unknown>) {
  const data = sseEncoder.encode(`data: ${JSON.stringify(payload)}\n\n`);
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
    // Encode once, deliver the same bytes to every connection.
    const encoded = sseEncoder.encode(`data: ${JSON.stringify(data)}\n\n`);
    connections.forEach((controller) => {
      try {
        controller.enqueue(encoded);
      } catch {
        connections.delete(controller);
      }
    });
    if (connections.size === 0) activeConnections.delete(channelId);
  }
}

// Register a raw SSE write callback into the DM's active connection set.
// Used by server.ts to bypass Next.js response buffering.
export function registerRawDmSSEConnection(
  channelId: string,
  write: (data: string) => void,
): () => void {
  const controller = {
    enqueue: (data: Uint8Array) => { try { write(sseDecoder.decode(data)); } catch { /* closed */ } },
  } as unknown as ReadableStreamDefaultController;

  if (!activeConnections.has(channelId)) {
    activeConnections.set(channelId, new Set());
  }
  activeConnections.get(channelId)!.add(controller);

  return () => {
    const set = activeConnections.get(channelId);
    if (!set) return;
    set.delete(controller);
    // Drop the DM channel's entry once its last stream closes — otherwise the
    // map keeps one empty Set per DM ever streamed, forever.
    if (set.size === 0) activeConnections.delete(channelId);
  };
}

// Publish a DM event: local + cross-instance fan-out over Redis.
export function publishToDm(channelId: string, data: object) {
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

    // Fetch DM and group_dm channels in parallel
    const [dmChannels, groupDmChannels] = await Promise.all([
      Channel.find({ type: 'dm', recipientId: user.id }),
      Channel.find({ type: 'group_dm', recipientId: user.id }),
    ]);
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

    // Batch-decrypt all last messages in a single Promise.all (already parallel,
    // but this avoids interleaving with the channel mapping loop)
    const lastMsgsToDecrypt = channels
      .map(c => c.lastMessageId ? lastMessageMap.get(c.lastMessageId) : null)
      .filter(Boolean) as any[];
    const decryptedLastContents = await Promise.all(
      lastMsgsToDecrypt.map(m => decryptFromStorage(m.content || ''))
    );
    const lastContentMap = new Map<string, string>();
    lastMsgsToDecrypt.forEach((m, i) => lastContentMap.set(m.id, decryptedLastContents[i]));

    // Per-DM unread counts: pull the user's read markers, then count unread
    // (non-own, non-deleted) messages for every channel in one grouped query.
    // Powers the accent mention badges on DM rows (Discord shows a real count).
    const { ChannelReadState } = await import('@/lib/models/ChannelReadState');
    const readRows = await ChannelReadState.findByUser(user.id).catch(() => []);
    const readMarkers = new Map<string, Date | null>(
      readRows.map((r: { channelId: string; lastReadAt: Date | string | null }) => [
        r.channelId,
        r.lastReadAt ? new Date(r.lastReadAt) : null,
      ]),
    );
    const unreadCounts = await Message.unreadCounts(
      channels.map((c) => ({ channelId: c.id, after: readMarkers.get(c.id) ?? null })),
      user.id,
    ).catch(() => ({} as Record<string, number>));

    // Populate recipient info, deduplicating by recipient to avoid showing same user twice
    const seenRecipientIds = new Set<string>();
    const channelsWithRecipients = (
      channels.map((channel) => {
          const recipientIds = (channel.recipientIds || []).filter(
            (id: string) => id !== user.id
          );
          const recipients = recipientIds.map((id: string) => recipientMap.get(id)).filter(Boolean) as typeof allRecipients;

          let lastMessage = null;
          if (channel.lastMessageId) {
            try {
              const msg = lastMessageMap.get(channel.lastMessageId);
              if (msg) {
                const decryptedContent = lastContentMap.get(msg.id) || '';
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
            unreadCount: unreadCounts[channel.id] || 0,
            _recipientKey: recipientIds.sort().join(','),
          };
        })
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
          controller.enqueue(sseEncoder.encode(`data: ${JSON.stringify({ type: 'error', error: authError || 'Unauthorized' })}\n\n`));
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
        controller.enqueue(sseEncoder.encode('data: {"type":"connected"}\n\n'));
        pingInterval = setInterval(() => {
          try {
            controller.enqueue(sseEncoder.encode('data: {"type":"ping"}\n\n'));
          } catch {
            if (pingInterval) clearInterval(pingInterval);
            const set = activeDmListConnections.get(userKey);
            if (set) {
              set.delete(controller);
              if (set.size === 0) activeDmListConnections.delete(userKey);
            }
          }
        }, 30000);
      },
      cancel() {
        if (pingInterval) clearInterval(pingInterval);
        if (controllerRef) {
          const set = activeDmListConnections.get(userKey);
          if (set) {
            set.delete(controllerRef);
            // Drop the user's entry entirely once their last DM-list stream
            // closes — otherwise the map keeps one empty Set per user forever.
            if (set.size === 0) activeDmListConnections.delete(userKey);
          }
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
    // Also skip if a DM channel already exists (e.g. created by broadcast system)
    const isFriend = (user.friends || []).some((f: string) => compareIds(f, recipient.id));
    const recipientIsSystem = recipient.isSystem || isSystemUser(recipient.id);
    if (!isFriend && !recipientIsSystem && (recipient.settings as any)?.privacy?.directMessages !== 'everyone') {
      // Check if a DM channel already exists — if so, allow viewing messages
      const existingChannels = await Channel.find({ type: 'dm', recipientId: user.id });
      const hasExistingChannel = existingChannels.some(c =>
        c.recipientIds &&
        c.recipientIds.length === 2 &&
        c.recipientIds.includes(recipient.id)
      );
      if (!hasExistingChannel) {
        set.status = 403;
        return { error: 'You cannot message this user' };
      }
    }

    // Get or create DM channel
    const channel = await getOrCreateDMChannel(user.id, params.recipientId);

    const limit = Math.min(parseInt(query.limit as string) || 50, 100);
    const before = query.before as string | undefined;
    const after = query.after as string | undefined;
    const around = query.around as string | undefined;

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
    } else if (after) {
      // Delta fetch: only messages newer than the client's newest cached one,
      // so re-opening a DM ships a tiny payload instead of the full last page.
      const afterMsg = await Message.findById(after);
      if (afterMsg) {
        msgFilter.createdAtAfter = afterMsg.createdAt;
      }
    } else if (around) {
      // Load a window ending at (and including) the target message so the client
      // can scroll to a pinned/searched message that isn't in the live tail.
      const aroundMsg = await Message.findById(around);
      if (aroundMsg) {
        msgFilter.createdAtBefore = new Date(new Date(aroundMsg.createdAt as string | number | Date).getTime() + 1);
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

    // Decrypt messages — batch decrypt + batch emoji parse
    const decryptedContents = await Promise.all(
      msgs.map((msg: any) => decryptFromStorage(msg.content || ''))
    );
    const emojiResults = await batchParseCustomEmojis(decryptedContents);

    // Batch decrypt referenced message contents
    const refDecryptEntries = msgs
      .filter((msg: any) => msg.referencedMessageId && refMap.get(msg.referencedMessageId))
      .map((msg: any) => {
        const refMsg = refMap.get(msg.referencedMessageId)!;
        return { refId: msg.referencedMessageId, content: refMsg.content || '' };
      });
    const refDecrypted = await Promise.all(
      refDecryptEntries.map((entry) => decryptFromStorage(entry.content))
    );
    const refContentMap = new Map<string, string>();
    refDecryptEntries.forEach((entry, i) => refContentMap.set(entry.refId, refDecrypted[i]));

    const decryptedMessages = msgs.map((msg: any, idx: number) => {
      const author = authorMap.get(msg.authorId);
      const decryptedContent = decryptedContents[idx];
      const customEmojis = emojiResults[idx].emojis.map(e => ({
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
          const refAuthor = refMsg.authorId ? authorMap.get(refMsg.authorId) : null;
          referencedMessage = {
            id: refMsg.id,
            content: refContentMap.get(refRaw) || '',
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
        interaction: (msg as any).interaction ?? undefined,
        suppressEmbeds: Boolean((msg as any).suppressEmbeds),
      };
    });

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
    const recipientIsSystem = recipient.isSystem || isSystemUser(recipient.id);
    if (!isFriend && !recipientIsSystem && (recipient.settings as any)?.privacy?.directMessages !== 'everyone') {
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
        const cacheKey = `server:name:${stickerDoc.serverId}`;
        const cached = await cache.get<string>(cacheKey);
        if (cached) {
          stickerServerName = cached;
        } else {
          const { Server } = await import('@/lib/models/Server');
          const stickerServer = await Server.findById(stickerDoc.serverId);
          stickerServerName = stickerServer?.name;
          if (stickerServerName) await cache.set(cacheKey, stickerServerName, 3600);
        }
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

    // Get user's servers for emoji validation, create/get DM channel, and
    // encrypt content — all three are independent and can run in parallel.
    const [userServerMemberships, channel, encryptedContent] = await Promise.all([
      ServerMember.find({ userId: user.id }),
      getOrCreateDMChannel(user.id, params.recipientId),
      encryptForStorage(sanitizedContent),
    ]);
    const userServerIds = userServerMemberships.map((m: any) => m.serverId);

    // Duplicate-spam guard: block sending the same text many times in a row.
    // Only applies to plain text sends (attachments/stickers are exempt).
    const spamFingerprint = normalizeForSpamCheck(sanitizedContent);
    if (spamFingerprint && (!attachments || attachments.length === 0) && !stickerData) {
      const recent = await Message.find({
        channelId: channel.id,
        authorId: user.id,
        isDeleted: false,
        _limit: DUPLICATE_SPAM_THRESHOLD,
      });
      if (recent.length >= DUPLICATE_SPAM_THRESHOLD) {
        const recentContents = await Promise.all(
          recent.map((m: any) => (m.content ? decryptFromStorage(m.content) : Promise.resolve('')))
        );
        const allDuplicate = recentContents.every(
          (c) => normalizeForSpamCheck(c) === spamFingerprint
        );
        if (allDuplicate) {
          set.status = 429;
          return { error: 'Please stop sending the same message repeatedly.' };
        }
      }
    }

    // Bot (application) slash command in a DM with a bot: dispatch the interaction
    // to that bot and DON'T persist the raw "/command" text. The bot's response
    // (or an ephemeral reply) arrives over the DM SSE stream. Only plain-text
    // sends can be commands (no attachments/sticker).
    if (
      recipient.isBot &&
      content && content.trim().startsWith('/') &&
      (!attachments || attachments.length === 0) && !stickerData
    ) {
      const { dispatchSlashCommand } = await import('@/lib/services/interactions');
      const consumed = await dispatchSlashCommand({
        content: content.trim(),
        channelId: channel.id,
        serverId: null,
        author: { id: user.id, username: user.username ?? undefined, displayName: user.displayName ?? undefined },
        restrictToBotId: recipient.id,
      }).catch(() => false);
      if (consumed) {
        // Signals the client to drop its optimistic message without rendering it.
        return { interaction: true };
      }
    }

    // Parse custom emojis and look up the reply target concurrently — they're
    // independent, and each can cost a DB round-trip.
    const [emojiResult, replyMsg] = await Promise.all([
      parseCustomEmojis(sanitizedContent, undefined, userServerIds),
      replyTo ? Message.findOne({ id: replyTo, channelId: channel.id, isDeleted: false }) : Promise.resolve(null),
    ]);

    // Store parsed emoji data for the message response
    const customEmojis = emojiResult.emojis.map(e => ({
      id: e.id,
      name: e.name,
      animated: e.animated,
      url: e.url,
    }));

    // Validate reply target if provided
    let replyRef: string | undefined;
    let referencedMessage: { id: string; content: string; author?: { id: string; username: string; displayName: string; avatar?: string; isBot?: boolean; isVerified?: boolean }; createdAt?: string } | undefined;
    if (replyTo) {
      const refMsg = replyMsg;
      if (refMsg) {
        replyRef = replyTo;
        const [refAuthor, refDecrypted] = await Promise.all([
          refMsg.authorId ? User.findById(refMsg.authorId) : Promise.resolve(null),
          refMsg.content ? decryptFromStorage(refMsg.content) : Promise.resolve(''),
        ]);
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

    // Update channel's last message — fire-and-forget so the sender's response
    // (and thus their optimistic-confirm) isn't blocked on this bookkeeping
    // write. Mirrors the server-channel send path.
    void Channel.updateById(channel.id, { lastMessageId: message.id, updatedAt: new Date() })
      .catch(() => { /* best-effort; next message retries the bump */ });

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

    // Realtime unread signal: fan out a dm_activity event through the activity
    // stream (always connected via /api/users/@me/activity) so the recipient
    // gets an instant unread badge even when they're viewing a server, not the
    // DM list. The DM SSE stream only fires while the DM list is open — without
    // this, DM unread badges don't appear until the user navigates to the DM list.
    void (async () => {
      try {
        const { fanoutToUsers } = await import('@/lib/api/activity');
        const createdAtIso = message.createdAt instanceof Date ? message.createdAt.toISOString() : new Date(message.createdAt ?? Date.now()).toISOString();
        fanoutToUsers(
          { userIds: [params.recipientId] },
          {
            type: 'dm_activity',
            channelId: channel.id,
            authorId: user.id,
            createdAt: createdAtIso,
          },
        );
      } catch { /* best-effort */ }
    })();

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
          controller.enqueue(sseEncoder.encode(`data: ${JSON.stringify({ type: 'error', error: authError || 'Unauthorized' })}\n\n`));
          controller.close();
        },
      });
      return new Response(errorStream, { headers: sseHeaders });
    }

    if (!params.recipientId) {
      const errorStream = new ReadableStream({
        start(controller) {
          controller.enqueue(sseEncoder.encode(`data: ${JSON.stringify({ type: 'error', error: 'Invalid recipient ID' })}\n\n`));
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
        controller.enqueue(sseEncoder.encode('data: {"type":"connected"}\n\n'));

        // Keep-alive ping every 15 seconds
        pingInterval = setInterval(() => {
          try {
            controller.enqueue(sseEncoder.encode('data: {"type":"ping"}\n\n'));
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
          const set = activeConnections.get(channelKey);
          if (set) {
            set.delete(controllerRef);
            if (set.size === 0) activeConnections.delete(channelKey);
          }
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
  // Suppress embeds on DM message
  .post('/:recipientId/messages/:messageId/suppress-embeds', async ({ headers, cookie, params, set }) => {
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
      return { error: 'You can only suppress embeds on your own messages' };
    }

    await Message.updateById(message.id, { suppressEmbeds: true });

    publishToDm(channel.id, {
      type: 'suppress_embeds',
      messageId: params.messageId,
    });

    return { success: true };
  }, {
    params: t.Object({
      recipientId: t.String(),
      messageId: t.String(),
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

    // Clear stale unread on the recipient's other devices if the deleted message
    // was the one that left this DM unread. Recompute newest remaining message
    // time and broadcast a reset to both participants. Fire-and-forget.
    void (async () => {
      const [latest] = await Message.find({ channelId: channel.id, isDeleted: false, _limit: 1 });
      const lastMessageAt = latest?.createdAt
        ? (latest.createdAt instanceof Date ? latest.createdAt.toISOString() : String(latest.createdAt))
        : null;
      const { notifyUnreadReset } = await import('@/lib/api/activity');
      notifyUnreadReset({ userIds: channel.recipientIds || [user.id, params.recipientId] }, channel.id, lastMessageAt);
    })().catch(() => { /* best-effort */ });

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

    // Batch-decrypt all pinned messages in parallel
    const decryptedContents = await Promise.all(
      pinnedMsgs.map((msg: any) => msg.content ? decryptFromStorage(msg.content) : Promise.resolve(''))
    );

    const messages = pinnedMsgs.map((msg: any, idx: number) => {
      const author = msg.authorId ? authorMap.get(msg.authorId) : null;
      return {
        id: msg.id,
        content: decryptedContents[idx],
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
    });

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

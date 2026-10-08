import { Elysia, t } from 'elysia';
import { and, eq, sql } from 'drizzle-orm';
import { Channel, Message, User, ServerMember, ServerSticker } from '@/lib/models';
import { ChannelReadState } from '@/lib/models/ChannelReadState';
import { db, schema } from '@/lib/db/postgres';
import { canStartDm, dmPairKey, dmPrivacy, isDmBlocked, isDmListedFor, pickDmChannel } from '@/lib/chat/dmAccess';
import { authenticateRequest } from '@/lib/services/auth';
import { parseCustomEmojis, batchParseCustomEmojis, normalizeEmojiFormat, getReactionEmoji } from '@/lib/services/emoji';
import { resolveEffectiveStatus } from '@/lib/services/presence';
import { checkRateLimit, getClientIP, sanitizeInput, validateMessageContent, encryptForStorage, decryptFromStorage, rejectInvalidObjectIdParams, isValidObjectId } from '@/lib/security';
import { isSystemUser } from '@/lib/services/systemUsers';
import { dmSendDenyReason } from '@/lib/chat/dmPolicy';
import { validateMessageAttachments } from '@/lib/chat/attachmentPolicy';
import { matchReactionEmoji, addReaction, removeReaction, type StoredReaction } from '@/lib/chat/reactionMutations';
import { clampInt } from '@/lib/utils/clampInt';
import { decodeHtmlEntities } from '@/lib/chat/messages';
import { cache, getPublisher } from '@/lib/db';
import { processShared, PROCESS_INSTANCE_ID } from '@/lib/realtime/processShared';
import { config } from '@/lib/config';
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
// Process-wide (see processShared): streams register from server.ts's module
// copy while messages publish from Next's copy.
const activeConnections = processShared(
  'dmConnections',
  () => new Map<string, Set<ReadableStreamDefaultController>>(),
);
const activeDmListConnections = processShared(
  'dmListConnections',
  () => new Map<string, Set<ReadableStreamDefaultController>>(),
);

// Shared codecs — instantiating TextEncoder/TextDecoder per event (and per
// recipient) showed up as avoidable allocation churn on the message fan-out
// hot path.
const sseEncoder = new TextEncoder();
const sseDecoder = new TextDecoder();

// Cross-instance realtime: see channels.ts for the rationale. DMs use two Redis
// buses — one keyed by DM channel (message events) and one keyed by user id (DM
// list updates). `originId` prevents the publishing instance double-delivering.
const INSTANCE_ID = PROCESS_INSTANCE_ID;
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

// Read-only lookup of THE 1:1 DM channel between two users. Uses the indexed
// `recipient_ids @>` filter instead of scanning every DM the user has, and
// resolves already-duplicated pairs to the oldest row so every route agrees.
export async function findDMChannel(userId: string, recipientId: string) {
  const channels = await Channel.find({ type: 'dm', recipientIds: [userId, recipientId] });
  return pickDmChannel(channels, userId, recipientId);
}

// Get or create the DM channel. Callers that may create MUST already have
// checked that the recipient exists and that blocks/privacy allow the DM. The
// create path is serialized per user pair with a transaction-scoped advisory
// lock so two concurrent first messages can't insert two channels (no UNIQUE
// index on purpose: pre-existing duplicate rows would make it fail at boot).
export async function getOrCreateDMChannel(userId: string, recipientId: string) {
  const existing = await findDMChannel(userId, recipientId);
  if (existing) return existing;

  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`dm:${dmPairKey(userId, recipientId)}`}))`);
    const rows = await tx.select().from(schema.channels).where(and(
      eq(schema.channels.type, 'dm'),
      sql`${schema.channels.recipientIds} @> ARRAY[${normalizeId(userId)}, ${normalizeId(recipientId)}]::uuid[]`,
    ));
    const found = pickDmChannel(rows, userId, recipientId);
    if (found) return found;
    const [created] = await tx.insert(schema.channels).values({
      type: 'dm',
      name: 'Direct Message',
      recipientIds: [userId, recipientId],
      position: 0,
    }).returning();
    return created;
  });
}

type DmChannelRow = Awaited<ReturnType<typeof getOrCreateDMChannel>>;
type DmOpenResult =
  | { channel: DmChannelRow; status?: undefined; error?: undefined }
  | { channel: null; status: number; error: string };

/**
 * Resolve the DM channel for a realtime route (the DM message stream). An
 * existing channel is reused as-is; a missing one is only created after the
 * same recipient-exists, block and privacy checks POST messages applies, so a
 * stranger can't plant channel rows just by opening streams.
 */
export async function openDMChannelForViewer(
  user: { id: string; friends?: string[] | null; blockedUsers?: string[] | null },
  recipientId: string,
): Promise<DmOpenResult> {
  const existing = await findDMChannel(user.id, recipientId);
  if (existing) return { channel: existing };
  const recipient = await User.findById(recipientId);
  if (!recipient) return { channel: null, status: 404, error: 'User not found' };
  const recipientIsSystem = Boolean(recipient.isSystem) || isSystemUser(recipient.id);
  if (!canStartDm(user, recipient, recipientIsSystem)) {
    return { channel: null, status: 403, error: 'You cannot message this user' };
  }
  return { channel: await getOrCreateDMChannel(user.id, recipientId) };
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
    // Resolve duplicated 1:1 rows to the same channel the DM routes use, and
    // hide empty DMs from everyone but the user who opened them.
    const dmGroups = new Map<string, typeof dmChannels>();
    for (const c of dmChannels) {
      const r = c.recipientIds || [];
      const key = r.length === 2 ? dmPairKey(r[0], r[1]) : `solo:${c.id}`;
      const group = dmGroups.get(key);
      if (group) group.push(c); else dmGroups.set(key, [c]);
    }
    const canonicalDms = [...dmGroups.values()].map((group) => {
      const r = group[0].recipientIds || [];
      return r.length === 2 ? (pickDmChannel(group, r[0], r[1]) ?? group[0]) : group[0];
    });
    const channels = [...canonicalDms, ...groupDmChannels]
      .filter((c) => isDmListedFor(c, user.id))
      .sort((a, b) => new Date(b.updatedAt ?? 0).getTime() - new Date(a.updatedAt ?? 0).getTime());

    const allRecipientIds = [...new Set(
      channels.flatMap(c => (c.recipientIds || []).filter((id: string) => id !== user.id))
    )];
    const allLastMessageIds = channels.map(c => c.lastMessageId).filter(Boolean) as string[];

    // Recipients, last-message previews (+ decrypt) and unread counts depend
    // only on `channels`, so run the three chains concurrently. Deleted
    // messages are never used as a preview.
    const [allRecipients, lastMessageData, unreadCounts] = await Promise.all([
      allRecipientIds.length > 0 ? User.find({ id: { in: allRecipientIds } }) : Promise.resolve([] as Awaited<ReturnType<typeof User.find>>),
      (async () => {
        const msgs = allLastMessageIds.length > 0
          ? await Message.find({ id: { in: allLastMessageIds }, isDeleted: false })
          : [];
        const dec = await Promise.all(msgs.map(m => decryptFromStorage(m.content || '')));
        return {
          lastMessageMap: new Map(msgs.map(m => [m.id, m])),
          lastContentMap: new Map(msgs.map((m, i) => [m.id, dec[i]])),
        };
      })(),
      // Per-DM unread counts from the user's read markers in one grouped query.
      (async () => {
        const readRows = await ChannelReadState.findByUser(user.id).catch(() => []);
        const readMarkers = new Map<string, Date | null>(
          readRows.map((r: { channelId: string; lastReadAt: Date | string | null }) => [
            r.channelId,
            r.lastReadAt ? new Date(r.lastReadAt) : null,
          ]),
        );
        return Message.unreadCounts(
          channels.map((c) => ({ channelId: c.id, after: readMarkers.get(c.id) ?? null })),
          user.id,
        ).catch(() => ({} as Record<string, number>));
      })(),
    ]);
    const recipientMap = new Map(allRecipients.map(r => [r.id, r]));
    const { lastMessageMap, lastContentMap } = lastMessageData;

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
                  if (msg.attachments && (msg.attachments as unknown[]).length > 0) {
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

    const limit = Math.min(parseInt(query.limit as string) || 50, 100);
    const before = query.before as string | undefined;
    const after = query.after as string | undefined;
    const around = query.around as string | undefined;
    const cursorId = before || after || around;

    // Recipient, existing channel and the cursor message are independent
    // lookups (the cursor only depends on query params) — run them together.
    const [recipient, existingChannel, cursorMsg] = await Promise.all([
      User.findById(params.recipientId),
      findDMChannel(user.id, params.recipientId),
      cursorId ? Message.findById(cursorId) : Promise.resolve(null),
    ]);
    if (!recipient) {
      set.status = 404;
      return { error: 'User not found' };
    }

    // An existing channel (e.g. created by the broadcast system or before a
    // privacy change) can always be read. A new one is only created when the
    // sender would be allowed to start the DM (no block, privacy allows).
    let channel = existingChannel;
    if (!channel) {
      const recipientIsSystem = Boolean(recipient.isSystem) || isSystemUser(recipient.id);
      if (!canStartDm(user, recipient, recipientIsSystem)) {
        set.status = 403;
        return { error: 'You cannot message this user' };
      }
      channel = await getOrCreateDMChannel(user.id, params.recipientId);
    }

    // Build cursor-based DB query
    const msgFilter: Record<string, unknown> = {
      channelId: channel.id,
      isDeleted: false,
      _limit: limit,
    };

    if (cursorMsg) {
      if (before) {
        msgFilter.createdAtBefore = cursorMsg.createdAt;
      } else if (after) {
        // Delta fetch: only messages newer than the client's newest cached one,
        // so re-opening a DM ships a tiny payload instead of the full last page.
        msgFilter.createdAtAfter = cursorMsg.createdAt;
        // Oldest-first so the page starts right after the cursor (DESC + LIMIT
        // would return the newest page and skip everything in between).
        msgFilter._orderAsc = true;
      } else {
        // `around`: load a window ending at (and including) the target message
        // so the client can scroll to a pinned/searched message not in the tail.
        msgFilter.createdAtBefore = new Date(new Date(cursorMsg.createdAt as string | number | Date).getTime() + 1);
      }
    }

    const msgs = await Message.find(msgFilter);
    if (!msgFilter._orderAsc) msgs.reverse(); // oldest first for display

    // Authors and referenced messages are independent batch lookups.
    const authorIds = [...new Set(msgs.map(m => m.authorId).filter(Boolean))];
    const refIds = [...new Set(msgs.map(m => m.referencedMessageId).filter((id): id is string => typeof id === 'string' && id.length > 0))];
    const [authors, refMsgs] = await Promise.all([
      authorIds.length > 0 ? User.find({ id: { in: authorIds } }) : Promise.resolve([] as Awaited<ReturnType<typeof User.find>>),
      refIds.length > 0 ? Message.find({ id: { in: refIds }, channelId: channel.id, isDeleted: false }) : Promise.resolve([] as Awaited<ReturnType<typeof Message.find>>),
    ]);
    const authorMap = new Map(authors.map(a => [a.id, a]));
    const refMap = new Map(refMsgs.map((m: any) => [m.id, m]));

    // Decrypt main and referenced contents together, then batch emoji parse.
    const refDecryptEntries = msgs
      .filter((msg: any) => msg.referencedMessageId && refMap.get(msg.referencedMessageId))
      .map((msg: any) => {
        const refMsg = refMap.get(msg.referencedMessageId)!;
        return { refId: msg.referencedMessageId, content: refMsg.content || '' };
      });
    const [decryptedContents, refDecrypted] = await Promise.all([
      Promise.all(msgs.map((msg: any) => decryptFromStorage(msg.content || ''))),
      Promise.all(refDecryptEntries.map((entry) => decryptFromStorage(entry.content))),
    ]);
    const emojiResults = await batchParseCustomEmojis(decryptedContents);
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
        interaction: (msg as { interaction?: unknown }).interaction ?? undefined,
        suppressEmbeds: Boolean((msg as { suppressEmbeds?: boolean }).suppressEmbeds),
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

    // Blocks + DM privacy (skipped for system users). Shared with the generic
    // /channels/:dmChannelId routes so neither path can bypass it.
    const dmDenied = dmSendDenyReason(user, recipient, { recipientIsSystem: isSystemUser(recipient.id) });
    if (dmDenied) {
      set.status = 403;
      return { error: dmDenied };
    }

    // Validate content
    const { content, sticker, attachments, replyTo } = body;
    let sanitizedContent = content ? sanitizeMessageContent(content) : '';

    // Attachments must be our own uploads by this user (see attachmentPolicy).
    const attachmentError = validateMessageAttachments(attachments, { cdnUrl: config.CDN_URL, userId: user.id });
    if (attachmentError) {
      set.status = 400;
      return { error: attachmentError };
    }
    // A malformed reply id would otherwise make the uuid lookup throw (500).
    if (replyTo && !isValidObjectId(replyTo)) {
      set.status = 400;
      return { error: 'Referenced message not found' };
    }

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
            messageId: message.id,
            authorId: user.id,
            authorName: user.displayName || user.username,
            authorAvatar: user.avatar ?? null,
            // Short plaintext preview for the recipient's notification.
            preview: sanitizedContent.slice(0, 120),
            hasAttachments: Array.isArray(attachments) && attachments.length > 0,
            hasSticker: Boolean(stickerData),
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
        spoiler: t.Optional(t.Boolean()),
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

    // Reuse the DM channel; only create one when the user may start the DM.
    const opened = await openDMChannelForViewer(user, params.recipientId);
    if (!opened.channel) {
      const errorStream = new ReadableStream({
        start(controller) {
          controller.enqueue(sseEncoder.encode(`data: ${JSON.stringify({ type: 'error', error: opened.error })}\n\n`));
          controller.close();
        },
      });
      return new Response(errorStream, { headers: sseHeaders });
    }
    const channelKey = opened.channel.id;

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

    // Typing never creates a channel and is dropped silently when there is no
    // conversation yet, either side has blocked the other, or it's spammed.
    const typingLimit = await checkRateLimit('typing', user.id);
    if (!typingLimit.success) return { success: true };
    const [channel, recipient] = await Promise.all([
      findDMChannel(user.id, params.recipientId),
      User.findById(params.recipientId),
    ]);
    if (!channel || !recipient || isDmBlocked(user, recipient)) {
      return { success: true };
    }

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

    const channel = await findDMChannel(user.id, params.recipientId);
    if (!channel) {
      set.status = 404;
      return { error: 'Message not found' };
    }

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

    const channel = await findDMChannel(user.id, params.recipientId);
    if (!channel) {
      set.status = 404;
      return { error: 'Message not found' };
    }

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

    const channel = await findDMChannel(user.id, params.recipientId);
    if (!channel) {
      set.status = 404;
      return { error: 'Message not found' };
    }

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

    // Newest remaining message: moves the DM-list preview pointer off the
    // deleted message (so its text never shows as the preview) and drives the
    // unread reset below.
    const [latest] = await Message.find({ channelId: channel.id, isDeleted: false, _limit: 1 });
    if (channel.lastMessageId && compareIds(channel.lastMessageId, message.id)) {
      // Conditional on the pointer still being the deleted message so a send
      // racing this delete isn't clobbered; updatedAt is left alone so the DM
      // doesn't jump to the top of the list.
      await db.update(schema.channels)
        .set({ lastMessageId: latest?.id ?? null })
        .where(and(eq(schema.channels.id, channel.id), eq(schema.channels.lastMessageId, message.id)))
        .catch((err) => console.error('Failed to move DM lastMessageId after delete:', err));
    }

    // Clear stale unread on the recipient's other devices if the deleted message
    // was the one that left this DM unread: broadcast the newest remaining
    // message time to both participants. Fire-and-forget.
    void (async () => {
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

    const channel = await findDMChannel(user.id, params.recipientId);
    if (!channel) {
      set.status = 404;
      return { error: 'Message not found' };
    }

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

    // Row-locked so concurrent reactions can't overwrite each other.
    const stored = await Message.mutateReactions<StoredReaction>(message.id, (current) =>
      addReaction(
        current,
        matchReactionEmoji(emojiData),
        { name: emojiData.name, id: emojiData.id, animated: emojiData.animated, url: emojiData.url },
        user.id,
        compareIds,
      ).reactions,
    );
    if (!stored) {
      set.status = 404;
      return { error: 'Message not found' };
    }

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

    const channel = await findDMChannel(user.id, params.recipientId);
    if (!channel) {
      set.status = 404;
      return { error: 'Message not found' };
    }

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

    // Row-locked so concurrent reaction changes can't overwrite each other.
    const removeMatch = matchReactionEmoji({ name: emojiData?.name || decodedEmoji, id: emojiData?.id });
    await Message.mutateReactions<StoredReaction>(message.id, (current) => {
      const result = removeReaction(current, removeMatch, user.id, compareIds);
      return result.changed ? result.reactions : null;
    });

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

    const channel = await findDMChannel(user.id, params.recipientId);
    if (!channel) return { messages: [] };

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

    const channel = await findDMChannel(user.id, params.recipientId);
    if (!channel) {
      set.status = 404;
      return { error: 'Message not found' };
    }

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

    const channel = await findDMChannel(user.id, params.recipientId);
    if (!channel) {
      set.status = 404;
      return { error: 'Message not found' };
    }

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

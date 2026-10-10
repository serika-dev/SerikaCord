import { Elysia, t } from 'elysia';
import { and, eq, sql } from 'drizzle-orm';
import { Channel, Message, User, ServerMember, ServerSticker, type IUserSettings, type IMessage } from '@/lib/models';
import { ChannelReadState } from '@/lib/models/ChannelReadState';
import { db, schema } from '@/lib/db/postgres';
import { canStartDm, dmPairKey, dmPrivacy, isDmBlocked, isDmListedFor, pickDmChannel } from '@/lib/chat/dmAccess';
import { acceptsDmsFromNonFriends } from '@/lib/settings/privacy';
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
import { callPreviewText, parseCallData } from '@/lib/voice/callMessage';
import { groupEventPreview, isGroupDmEventType, type GroupDmEventType } from '@/lib/chat/groupDm';
import { loadMessageExtras, type MessageExtras } from '@/lib/services/messageExtras';
import { parsePollResult, parseStoredPoll, pollPreviewText } from '@/lib/chat/polls';

function compareIds(id1: string, id2: string): boolean {
  return normalizeId(id1) === normalizeId(id2);
}

const PRESERVED_MESSAGE_TOKEN_REGEX = /<@!?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}>|<@&[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}>|<#(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})>|<a?:[a-zA-Z0-9_]+:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}>|<t:-?\d{1,13}(?::[tTdDfFRC](?:\[[^\]]*\])?)?>|<t:-?\d{1,13}>/g;

export function sanitizeMessageContent(content: string): string {
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

export function getPublicPresenceStatus(user: { status?: string | null; presenceLastHeartbeatAt?: Date | string | number | null; isSystem?: boolean | null }) {
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
// Who owns each DM stream, for streams that must close when the viewer loses
// access (a member removed from / leaving a group DM). Keyed by the stream's
// controller; 1:1 DM streams don't register here.
const dmStreamOwners = processShared(
  'dmStreamOwners',
  () => new WeakMap<object, { userId: string; close: () => void }>(),
);

function revokeLocalDmStreams(channelId: string, userId: string) {
  const connections = activeConnections.get(channelId);
  if (!connections) return;
  for (const controller of [...connections]) {
    const owner = dmStreamOwners.get(controller);
    if (!owner || owner.userId !== userId) continue;
    connections.delete(controller);
    try { owner.close(); } catch { /* already closed */ }
  }
  if (connections.size === 0) activeConnections.delete(channelId);
}

/**
 * Close every open message stream `userId` has on a DM channel, on every
 * instance (a member was removed from or left a group DM).
 */
export function revokeDmStreams(channelId: string, userId: string) {
  revokeLocalDmStreams(channelId, userId);
  const pub = getPublisher();
  if (pub) {
    pub
      .publish(SSE_DM_BUS, JSON.stringify({ originId: INSTANCE_ID, control: 'revoke', channelId, userId }))
      .catch(() => {});
  }
}

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
  owner?: { userId: string; close: () => void },
): () => void {
  const controller = {
    enqueue: (data: Uint8Array) => { try { write(sseDecoder.decode(data)); } catch { /* closed */ } },
  } as unknown as ReadableStreamDefaultController;
  if (owner) dmStreamOwners.set(controller, owner);

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
      if (ch === SSE_DM_BUS && parsed.control === 'revoke') {
        if (parsed.channelId && parsed.userId) revokeLocalDmStreams(parsed.channelId, parsed.userId);
        return;
      }
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

// ─── Shared DM message helpers ────────────────────────────────────────────────
// Used by the 1:1 routes below (channel resolved from a recipient id) and the
// group DM routes in groupDms.ts (channel resolved from its id + membership),
// so both kinds of conversation behave exactly the same once the channel is
// known.

type AuthUser = NonNullable<Awaited<ReturnType<typeof authenticateRequest>>['user']>;
type DmChannelRef = { id: string; recipientIds?: string[] | null; lastMessageId?: string | null };

/** A route reply: the HTTP status plus the JSON body. */
export type DmReply = { status: number; body: Record<string, unknown> };

const ok = (body: Record<string, unknown> = { success: true }): DmReply => ({ status: 200, body });
const fail = (status: number, error: string, extra: Record<string, unknown> = {}): DmReply => ({ status, body: { error, ...extra } });

type PublicAuthor = {
  id: string;
  username: string;
  displayName: string | null;
  avatar: string | null;
  isBot?: boolean | null;
  isVerified?: boolean | null;
};

function referenceAuthor(a: PublicAuthor | null | undefined) {
  return a ? {
    id: a.id,
    username: a.username,
    displayName: a.displayName || a.username,
    avatar: a.avatar ?? undefined,
    isBot: Boolean(a.isBot),
    isVerified: Boolean(a.isVerified),
  } : undefined;
}

/**
 * One page of a DM conversation (1:1 or group), oldest first, decrypted and
 * shaped for the client. `cursorMsg` is the message `before`/`after`/`around`
 * points at (already looked up by the caller, usually in parallel).
 */
export async function loadDmMessagesPage(
  channelId: string,
  query: { limit?: unknown; before?: unknown; after?: unknown; around?: unknown },
  cursorMsg: Awaited<ReturnType<typeof Message.findById>> | null,
  viewerId?: string | null,
) {
  const limit = Math.min(parseInt(query.limit as string) || 50, 100);
  const before = query.before as string | undefined;
  const after = query.after as string | undefined;

  // Build cursor-based DB query
  const msgFilter: Record<string, unknown> = {
    channelId,
    isDeleted: false,
    _limit: limit,
  };

  if (cursorMsg && cursorMsg.channelId === channelId) {
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

  // Authors (plus the people group system rows talk about) and referenced
  // messages are independent batch lookups.
  const eventTargetIds = msgs
    .filter((m) => isGroupDmEventType(m.type))
    .map((m) => (m.mentionedUserIds || [])[0])
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
  const authorIds = [...new Set([...msgs.map(m => m.authorId).filter(Boolean), ...eventTargetIds])];
  const refIds = [...new Set(msgs.map(m => m.referencedMessageId).filter((id): id is string => typeof id === 'string' && id.length > 0))];
  const [authors, refMsgs] = await Promise.all([
    authorIds.length > 0 ? User.find({ id: { in: authorIds } }) : Promise.resolve([] as Awaited<ReturnType<typeof User.find>>),
    refIds.length > 0 ? Message.find({ id: { in: refIds }, channelId, isDeleted: false }) : Promise.resolve([] as Awaited<ReturnType<typeof Message.find>>),
  ]);
  const authorMap = new Map(authors.map(a => [a.id, a]));
  const refMap = new Map(refMsgs.map((m) => [m.id, m]));

  // Decrypt main and referenced contents together, then batch emoji parse.
  const refDecryptEntries = msgs
    .filter((msg) => msg.referencedMessageId && refMap.get(msg.referencedMessageId))
    .map((msg) => {
      const refMsg = refMap.get(msg.referencedMessageId as string)!;
      return { refId: msg.referencedMessageId as string, content: refMsg.content || '' };
    });
  const [decryptedContents, refDecrypted, extrasMap] = await Promise.all([
    Promise.all(msgs.map((msg) => decryptFromStorage(msg.content || ''))),
    Promise.all(refDecryptEntries.map((entry) => decryptFromStorage(entry.content))),
    // Polls (tallies + the viewer's votes), poll result rows and forwards.
    loadMessageExtras(msgs, viewerId ?? null).catch(() => new Map<string, MessageExtras>()),
  ]);
  const emojiResults = await batchParseCustomEmojis(decryptedContents);
  const refContentMap = new Map<string, string>();
  refDecryptEntries.forEach((entry, i) => refContentMap.set(entry.refId, refDecrypted[i]));

  return msgs.map((msg, idx: number) => {
    const author = authorMap.get(msg.authorId);
    const decryptedContent = decryptedContents[idx];
    const customEmojis = emojiResults[idx].emojis.map(e => ({
      id: e.id,
      name: e.name,
      animated: e.animated,
      url: e.url,
    }));

    let referencedMessage: { id: string; content: string; author?: ReturnType<typeof referenceAuthor>; createdAt?: string } | undefined;
    const refRaw = msg.referencedMessageId;
    if (refRaw && typeof refRaw === 'string') {
      const refMsg = refMap.get(refRaw);
      if (refMsg) {
        const refAuthor = refMsg.authorId ? authorMap.get(refMsg.authorId) : null;
        referencedMessage = {
          id: refMsg.id,
          content: refContentMap.get(refRaw) || '',
          author: referenceAuthor(refAuthor),
          createdAt: refMsg.createdAt instanceof Date ? refMsg.createdAt.toISOString() : (refMsg.createdAt ?? undefined),
        };
      }
    }

    const groupEvent = isGroupDmEventType(msg.type)
      ? groupEventPayload(msg.type, decryptedContent, authorMap.get((msg.mentionedUserIds || [])[0] ?? ''))
      : null;

    return {
      id: msg.id,
      content: groupEvent ? '' : decryptedContent,
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
      // DM call log row ("started a call", "missed call").
      ...(msg.type === 'call' ? { type: 'call' as const, call: parseCallData(msg.call) } : {}),
      // Group DM system row ("X added Y to the group.").
      ...(groupEvent ? { type: msg.type, groupEvent } : {}),
      ...extrasMap.get(msg.id),
    };
  });
}

/** The client payload of a group DM system row. */
export function groupEventPayload(
  type: string | null | undefined,
  content: string,
  target: { id: string; username: string; displayName?: string | null; avatar?: string | null } | null | undefined,
) {
  return {
    kind: type as GroupDmEventType,
    ...(target ? { target: { id: target.id, username: target.username, displayName: target.displayName || target.username, avatar: target.avatar ?? null } } : {}),
    ...(type === 'channel_name_change' ? { name: content } : {}),
  };
}

export type DmSendBody = {
  content?: string;
  sticker?: { id: string; name: string; imageUrl: string; serverId?: string; serverName?: string };
  attachments?: Array<{ id: string; url: string; filename: string; contentType: string; size?: number; spoiler?: boolean }>;
  replyTo?: string;
};

type StickerData = { id: string; name: string; imageUrl: string; serverId?: string; serverName?: string };

export type PreparedDmSend = {
  sanitizedContent: string;
  stickerData?: StickerData;
  attachments: NonNullable<DmSendBody['attachments']>;
  replyTo?: string;
};

/** Validate and sanitize a DM send body (content, attachments, sticker, reply id). */
export async function prepareDmSend(user: AuthUser, body: DmSendBody): Promise<{ error: DmReply } | { prepared: PreparedDmSend }> {
  const { content, sticker, attachments, replyTo } = body;
  let sanitizedContent = content ? sanitizeMessageContent(content) : '';

  // Attachments must be our own uploads by this user (see attachmentPolicy).
  const attachmentError = validateMessageAttachments(attachments, { cdnUrl: config.CDN_URL, userId: user.id });
  if (attachmentError) return { error: fail(400, attachmentError) };
  // A malformed reply id would otherwise make the uuid lookup throw (500).
  if (replyTo && !isValidObjectId(replyTo)) return { error: fail(400, 'Referenced message not found') };

  // Validate sticker if provided
  let stickerData: StickerData | undefined;
  if (sticker?.id) {
    const stickerDoc = await ServerSticker.findById(sticker.id);
    if (!stickerDoc || !stickerDoc.available) return { error: fail(400, 'Sticker not found') };
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
      serverId: stickerDoc.serverId ?? undefined,
      serverName: stickerServerName,
    };
  }

  const validation = validateMessageContent(sanitizedContent);
  if (!validation.valid && !stickerData && (!attachments || attachments.length === 0)) {
    return { error: fail(400, validation.error || 'Invalid message') };
  }

  // Normalize emoji format
  sanitizedContent = normalizeEmojiFormat(sanitizedContent);
  return { prepared: { sanitizedContent, stickerData, attachments: attachments || [], replyTo } };
}

/**
 * Duplicate-spam guard: block sending the same text many times in a row. Only
 * applies to plain text sends (attachments/stickers are exempt).
 */
export async function checkDmDuplicateSpam(channelId: string, userId: string, prepared: PreparedDmSend): Promise<DmReply | null> {
  const spamFingerprint = normalizeForSpamCheck(prepared.sanitizedContent);
  if (!spamFingerprint || prepared.attachments.length > 0 || prepared.stickerData) return null;
  const recent = await Message.find({
    channelId,
    authorId: userId,
    isDeleted: false,
    _limit: DUPLICATE_SPAM_THRESHOLD,
  });
  if (recent.length < DUPLICATE_SPAM_THRESHOLD) return null;
  const recentContents = await Promise.all(
    recent.map((m) => (m.content ? decryptFromStorage(m.content) : Promise.resolve('')))
  );
  const allDuplicate = recentContents.every((c) => normalizeForSpamCheck(c) === spamFingerprint);
  return allDuplicate ? fail(429, 'Please stop sending the same message repeatedly.') : null;
}

/**
 * Store a validated DM message, bump the channel and return the client
 * payload. The caller publishes it and sends the unread signals.
 */
export async function persistDmMessage(
  user: AuthUser,
  channel: DmChannelRef,
  prepared: PreparedDmSend,
  encryptedContent: string,
  userServerIds: string[],
) {
  const { sanitizedContent, stickerData, attachments, replyTo } = prepared;
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
  let referencedMessage: { id: string; content: string; author?: ReturnType<typeof referenceAuthor>; createdAt?: string } | undefined;
  if (replyTo && replyMsg) {
    replyRef = replyTo;
    const [refAuthor, refDecrypted] = await Promise.all([
      replyMsg.authorId ? User.findById(replyMsg.authorId) : Promise.resolve(null),
      replyMsg.content ? decryptFromStorage(replyMsg.content) : Promise.resolve(''),
    ]);
    referencedMessage = {
      id: replyMsg.id,
      content: refDecrypted,
      author: referenceAuthor(refAuthor),
      createdAt: replyMsg.createdAt instanceof Date ? replyMsg.createdAt.toISOString() : (replyMsg.createdAt ?? undefined),
    };
  }

  const message = await Message.create({
    channelId: channel.id,
    authorId: user.id,
    content: encryptedContent,
    type: replyRef ? 'reply' : 'default',
    referencedMessageId: replyRef,
    sticker: stickerData,
    attachments,
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
  return { message, messageData };
}

async function findLiveMessage(channelId: string, messageId: string) {
  return Message.findOne({ id: messageId, channelId, isDeleted: false });
}

/** Edit your own message in a DM conversation. */
export async function editDmMessage(channel: DmChannelRef, user: AuthUser, messageId: string, content: string): Promise<DmReply> {
  const message = await findLiveMessage(channel.id, messageId);
  if (!message) return fail(404, 'Message not found');
  if (message.authorId !== user.id) return fail(403, 'You can only edit your own messages');
  if (message.type && message.type !== 'default' && message.type !== 'reply') return fail(400, 'This message cannot be edited');

  let sanitizedEditContent = '';
  if (content) {
    const validation = validateMessageContent(content);
    if (!validation.valid) return fail(400, validation.error || 'Invalid message');
    sanitizedEditContent = normalizeEmojiFormat(sanitizeMessageContent(content));
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
    messageId,
    content: sanitizedEditContent,
    editedTimestamp: message.editedTimestamp,
  });
  return ok();
}

/** Hide link previews on your own message. */
export async function suppressDmEmbeds(channel: DmChannelRef, user: AuthUser, messageId: string): Promise<DmReply> {
  const message = await findLiveMessage(channel.id, messageId);
  if (!message) return fail(404, 'Message not found');
  if (message.authorId !== user.id) return fail(403, 'You can only suppress embeds on your own messages');
  await Message.updateById(message.id, { suppressEmbeds: true });
  publishToDm(channel.id, { type: 'suppress_embeds', messageId });
  return ok();
}

/** Delete your own message (soft delete) and fix up previews / unread state. */
export async function deleteDmMessage(channel: DmChannelRef, user: AuthUser, messageId: string): Promise<DmReply> {
  const message = await findLiveMessage(channel.id, messageId);
  if (!message) return fail(404, 'Message not found');
  if (message.authorId !== user.id) return fail(403, 'You can only delete your own messages');

  await Message.updateById(message.id, { isDeleted: true, deletedAt: new Date() });
  publishToDm(channel.id, { type: 'delete', messageId });

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

  // Clear stale unread on the recipients' other devices if the deleted
  // message was the one that left this DM unread: broadcast the newest
  // remaining message time to every participant. Fire-and-forget.
  void (async () => {
    const lastMessageAt = latest?.createdAt
      ? (latest.createdAt instanceof Date ? latest.createdAt.toISOString() : String(latest.createdAt))
      : null;
    const { notifyUnreadReset } = await import('@/lib/api/activity');
    notifyUnreadReset({ userIds: channel.recipientIds?.length ? channel.recipientIds : [user.id] }, channel.id, lastMessageAt, [
      { id: message.id, at: message.createdAt ? new Date(message.createdAt).toISOString() : null },
    ]);
  })().catch(() => { /* best-effort */ });

  return ok();
}

/** Add your reaction to a message. */
export async function addDmReaction(channel: DmChannelRef, user: AuthUser, messageId: string, emoji: string): Promise<DmReply> {
  const message = await findLiveMessage(channel.id, messageId);
  if (!message) return fail(404, 'Message not found');
  if (!emoji) return fail(400, 'Missing emoji parameter');
  const emojiData = await getReactionEmoji(emoji);
  if (!emojiData) return fail(400, 'Invalid emoji');

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
  if (!stored) return fail(404, 'Message not found');

  publishToDm(channel.id, { type: 'reaction_add', messageId, emoji, userId: user.id });
  return ok();
}

/** Remove your reaction from a message. */
export async function removeDmReaction(channel: DmChannelRef, user: AuthUser, messageId: string, emoji: string): Promise<DmReply> {
  const message = await findLiveMessage(channel.id, messageId);
  if (!message) return fail(404, 'Message not found');
  if (!emoji) return fail(400, 'Missing emoji parameter');
  const emojiData = await getReactionEmoji(emoji);

  // Row-locked so concurrent reaction changes can't overwrite each other.
  const removeMatch = matchReactionEmoji({ name: emojiData?.name || emoji, id: emojiData?.id });
  await Message.mutateReactions<StoredReaction>(message.id, (current) => {
    const result = removeReaction(current, removeMatch, user.id, compareIds);
    return result.changed ? result.reactions : null;
  });

  publishToDm(channel.id, { type: 'reaction_remove', messageId, emoji, userId: user.id });
  return ok();
}

/** The pinned messages of a DM conversation, newest first. */
export async function listDmPins(channelId: string) {
  const pinnedMsgs = await Message.find({ channelId, pinned: true, isDeleted: false, _limit: 50 });

  // Batch fetch authors
  const authorIds = [...new Set(pinnedMsgs.map(m => m.authorId).filter(Boolean))];
  const authors = authorIds.length > 0 ? await User.find({ id: { in: authorIds } }) : [];
  const authorMap = new Map(authors.map(a => [a.id, a]));

  // Batch-decrypt all pinned messages in parallel
  const decryptedContents = await Promise.all(
    pinnedMsgs.map((msg) => msg.content ? decryptFromStorage(msg.content) : Promise.resolve(''))
  );

  return pinnedMsgs.map((msg, idx: number) => {
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
}

/** Pin or unpin a message (anyone in the conversation may, like Discord). */
export async function setDmPinned(channel: DmChannelRef, messageId: string, pinned: boolean): Promise<DmReply> {
  const message = await findLiveMessage(channel.id, messageId);
  if (!message) return fail(404, 'Message not found');
  await Message.updateById(message.id, { pinned });
  publishToDm(channel.id, { type: 'pin_update', messageId, pinned });
  return ok();
}

/** Open a DM message stream through Elysia (the raw fast path in server.ts is preferred). */
export function dmStreamResponse(channelKey: string, owner?: { userId: string }): Response {
  let controllerRef: ReadableStreamDefaultController | null = null;
  let pingInterval: NodeJS.Timeout | null = null;

  const stream = new ReadableStream({
    start(controller) {
      controllerRef = controller;
      if (owner) {
        dmStreamOwners.set(controller, {
          userId: owner.userId,
          close: () => {
            if (pingInterval) clearInterval(pingInterval);
            try { controller.close(); } catch { /* already closed */ }
          },
        });
      }
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
          if (pingInterval) clearInterval(pingInterval);
          activeConnections.get(channelKey)?.delete(controller);
        }
      }, 15000);
    },
    cancel() {
      if (pingInterval) clearInterval(pingInterval);
      if (controllerRef) {
        const set = activeConnections.get(channelKey);
        if (set) {
          set.delete(controllerRef);
          if (set.size === 0) activeConnections.delete(channelKey);
        }
      }
    },
  });

  return new Response(stream, { headers: DM_SSE_HEADERS });
}

/** A one-event SSE response carrying an error (EventSource can't read bodies of failed requests). */
export function dmStreamError(error: string): Response {
  const errorStream = new ReadableStream({
    start(controller) {
      controller.enqueue(sseEncoder.encode(`data: ${JSON.stringify({ type: 'error', error })}\n\n`));
      controller.close();
    },
  });
  return new Response(errorStream, { headers: DM_SSE_HEADERS });
}

const DM_SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache, no-store, must-revalidate',
  'Connection': 'keep-alive',
  'X-Accel-Buffering': 'no',
};

export const DM_SEND_BODY = t.Object({
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
});

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
                if (msg.type === 'call') {
                  displayContent = callPreviewText(parseCallData(msg.call), user.id);
                } else if (isGroupDmEventType(msg.type)) {
                  const nameOf = (id: string | null | undefined) => {
                    if (!id) return null;
                    if (compareIds(id, user.id)) return user.displayName || user.username;
                    const u = recipientMap.get(id);
                    return u ? (u.displayName || u.username) : null;
                  };
                  displayContent = groupEventPreview(
                    msg.type,
                    nameOf(msg.authorId) || 'Someone',
                    nameOf((msg.mentionedUserIds || [])[0]),
                    decryptedContent,
                  );
                } else if (msg.type === 'poll_result') {
                  const result = parsePollResult(msg.poll);
                  displayContent = result ? `Poll ended: ${result.question}` : 'Poll ended';
                } else if (!displayContent && msg.poll) {
                  const poll = parseStoredPoll(msg.poll);
                  displayContent = poll ? pollPreviewText(poll.question) : 'Sent a poll';
                } else if (!displayContent && msg.messageSnapshot) {
                  displayContent = 'Forwarded a message';
                } else if (!displayContent) {
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
                  ...(msg.type === 'call' ? { type: 'call' as const } : {}),
                };
              }
            } catch (err) {
              console.error('Failed to populate lastMessage:', err);
            }
          }

          return {
            id: channel.id,
            type: channel.type,
            ...(channel.type === 'group_dm'
              ? {
                  name: channel.name || null,
                  icon: (channel as { icon?: string | null }).icon ?? null,
                  ownerId: channel.ownerId || (channel.recipientIds || [])[0] || null,
                }
              : {}),
            recipients: recipients.map((r) => ({
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

    // Names for mention markup in the last-message previews.
    const { lookupMentionNames } = await import('@/lib/services/mentionNames');
    const mentionNames = await lookupMentionNames(channelsWithRecipients.map((c) => c.lastMessage?.content ?? null));

    return { channels: channelsWithRecipients, mentionNames };
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

    const cursorId = (query.before || query.after || query.around) as string | undefined;

    // Recipient, existing channel and the cursor message are independent
    // lookups (the cursor only depends on query params) — run them together.
    const [recipient, existingChannel, cursorMsg] = await Promise.all([
      User.findById(params.recipientId),
      findDMChannel(user.id, params.recipientId),
      cursorId && isValidObjectId(cursorId) ? Message.findById(cursorId) : Promise.resolve(null),
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

    const messages = await loadDmMessagesPage(channel.id, query, cursorMsg, user.id);
    return {
      messages,
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

    const preparedResult = await prepareDmSend(user, body);
    if ('error' in preparedResult) {
      set.status = preparedResult.error.status;
      return preparedResult.error.body;
    }
    const prepared = preparedResult.prepared;
    const { sanitizedContent, stickerData, attachments } = prepared;

    // Get user's servers for emoji validation, create/get DM channel, and
    // encrypt content — all three are independent and can run in parallel.
    const [userServerMemberships, channel, encryptedContent] = await Promise.all([
      ServerMember.find({ userId: user.id }),
      getOrCreateDMChannel(user.id, params.recipientId),
      encryptForStorage(sanitizedContent),
    ]);
    const userServerIds = userServerMemberships.map((m) => m.serverId);

    const spam = await checkDmDuplicateSpam(channel.id, user.id, prepared);
    if (spam) {
      set.status = spam.status;
      return spam.body;
    }

    // Bot (application) slash command in a DM with a bot: dispatch the interaction
    // to that bot and DON'T persist the raw "/command" text. The bot's response
    // (or an ephemeral reply) arrives over the DM SSE stream. Only plain-text
    // sends can be commands (no attachments/sticker).
    const { content } = body;
    if (
      recipient.isBot &&
      content && content.trim().startsWith('/') &&
      attachments.length === 0 && !stickerData
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

    const { message, messageData } = await persistDmMessage(user, channel, prepared, encryptedContent, userServerIds);

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
        const { fanoutToUsers, ackOwnMessage } = await import('@/lib/api/activity');
        const createdAtIso = message.createdAt instanceof Date ? message.createdAt.toISOString() : new Date(message.createdAt ?? Date.now()).toISOString();
        // Sending reads the DM up to your message, on all your devices.
        ackOwnMessage(user.id, channel.id, message.id, createdAtIso);
        const { lookupMentionNames } = await import('@/lib/services/mentionNames');
        const mentionNames = await lookupMentionNames([sanitizedContent.slice(0, 120)]);
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
            mentionNames,
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
    body: DM_SEND_BODY,
  })
  // SSE stream for real-time messages
  .get('/:recipientId/stream', async ({ headers, cookie, params }) => {
    const { user, error: authError } = await getAuth(headers, cookie as Record<string, { value?: unknown }>);
    if (!user) return dmStreamError(authError || 'Unauthorized');
    if (!params.recipientId) return dmStreamError('Invalid recipient ID');

    // Reuse the DM channel; only create one when the user may start the DM.
    const opened = await openDMChannelForViewer(user, params.recipientId);
    if (!opened.channel) return dmStreamError(opened.error);
    return dmStreamResponse(opened.channel.id);
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
    const channel = await findDMChannel(user.id, params.recipientId);
    if (!channel) {
      set.status = 404;
      return { error: 'Message not found' };
    }
    const reply = await editDmMessage(channel, user, params.messageId, body.content);
    set.status = reply.status;
    return reply.body;
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
    const channel = await findDMChannel(user.id, params.recipientId);
    if (!channel) {
      set.status = 404;
      return { error: 'Message not found' };
    }
    const reply = await suppressDmEmbeds(channel, user, params.messageId);
    set.status = reply.status;
    return reply.body;
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
    const channel = await findDMChannel(user.id, params.recipientId);
    if (!channel) {
      set.status = 404;
      return { error: 'Message not found' };
    }
    const reply = await deleteDmMessage(channel, user, params.messageId);
    set.status = reply.status;
    return reply.body;
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
    const channel = await findDMChannel(user.id, params.recipientId);
    if (!channel) {
      set.status = 404;
      return { error: 'Message not found' };
    }
    const reply = await addDmReaction(channel, user, params.messageId, typeof query.emoji === 'string' ? query.emoji : '');
    set.status = reply.status;
    return reply.body;
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
    const channel = await findDMChannel(user.id, params.recipientId);
    if (!channel) {
      set.status = 404;
      return { error: 'Message not found' };
    }
    const reply = await removeDmReaction(channel, user, params.messageId, typeof query.emoji === 'string' ? query.emoji : '');
    set.status = reply.status;
    return reply.body;
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
    const channel = await findDMChannel(user.id, params.recipientId);
    if (!channel) return { messages: [] };
    return { messages: await listDmPins(channel.id) };
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
    const channel = await findDMChannel(user.id, params.recipientId);
    if (!channel) {
      set.status = 404;
      return { error: 'Message not found' };
    }
    const reply = await setDmPinned(channel, params.messageId, true);
    set.status = reply.status;
    return reply.body;
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
    const channel = await findDMChannel(user.id, params.recipientId);
    if (!channel) {
      set.status = 404;
      return { error: 'Message not found' };
    }
    const reply = await setDmPinned(channel, params.messageId, false);
    set.status = reply.status;
    return reply.body;
  }, {
    params: t.Object({
      recipientId: t.String(),
      messageId: t.String(),
    }),
  });

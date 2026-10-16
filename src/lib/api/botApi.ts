import { Elysia, t } from 'elysia';
import { buildPollView, fromDiscordPollRequest, isPollClosed, normalizePollInput, parseStoredPoll, type StoredPoll } from '@/lib/chat/polls';
import { acceptsDmsFromNonFriends } from '@/lib/settings/privacy';
import { ChannelWebhook, type IApplication } from '@/lib/models';
import { addReaction, removeReaction, type StoredReaction } from '@/lib/chat/reactionMutations';
import { Channel, Message, Server, ServerMember, Role, User, ServerEmoji, ServerSticker, Invite, ServerBan, type IMessage, type IChannel } from '@/lib/models';
import { FormErrors } from '@/lib/botapi/formErrors';
import { IS_COMPONENTS_V2, componentsPlainText, isComponentsV2, parseStoredComponents, resolveAttachmentRefs, validateMessageComponents } from '@/lib/botapi/components';
import * as crypto from 'crypto';
import { config } from '@/lib/config';
import { normalizeId } from '@/lib/db/normalizeId';
import { removeServerMember, upsertServerBan } from '@/lib/services/serverMembership';
import { PERMISSION_BITS as P, hasPermission } from '@/lib/permissions/bits';
import {
  computeGuildStanding, standingHas, memberTopPosition, outranks, canGrantBits, parseBitfield,
  type BotGuildStanding,
} from '@/lib/permissions/botGuild';
import type { IServer, IRole } from '@/lib/models';
import { isSilentMessage, MESSAGE_FLAGS, sendFlags } from '@/lib/chat/messageFlags';
import { normalizeVoiceMessage } from '@/lib/chat/voiceMessage';
import { audit } from '@/lib/services/auditLog';
import { AuditLogEvent, auditReason } from '@/lib/audit/auditLog';
import { applyTimeout, botCan, DM_BOT_PERMISSIONS, type BotChannelAction } from '@/lib/permissions/botChannel';
import { allowedPrivilegedIntents, appHasMessageContent, INTENT } from '@/lib/gateway/intents';
import { redactMessageContent, shouldRedactContent } from '@/lib/gateway/routing';
import { normalizeBotAttachments, type IncomingAttachment } from '@/lib/chat/attachmentPolicy';
import {
  MAX_BOT_FILES, effectiveFilename, imageDimensions, isSpoilerFilename, parseBotMessageBody, planAttachments,
  type AttachmentMeta, type FileLike,
} from '@/lib/chat/botMultipart';
import { checkRateLimit, decryptFromStorage, encryptForStorage, getClientIP, isValidObjectId } from '@/lib/security';
import { botRequestBuckets, rateLimitedResponse, rateLimitHeaders } from '@/lib/security/botRateLimit';
import { botIdBoundary } from '@/lib/botapi/boundary';
import { invalidFormBody as invalidFormBodyAt, validationErrorBody } from '@/lib/botapi/errors';
import { parseApplicationPatch, toDiscordApplication } from '@/lib/botapi/application';
import { toDiscordChannel, toDiscordRole } from '@/lib/services/gatewayEvents';
// Discord message parity (messages, reactions, pins, polls, typing).
import { addFormError, formError, hasFormErrors, invalidFormBody, type FormErrorTree } from '@/lib/chat/discordFormErrors';
import { applyAllowedMentions, normalizeAllowedMentions, type NormalizedAllowedMentions } from '@/lib/chat/allowedMentions';
import { validateEmbeds } from '@/lib/chat/embedValidation';
import {
  aroundSplit, pageReactionUsers, parseLimit, parseMessagePageQuery, sortNewestFirst,
  type MessagePageQuery, type PageCursor,
} from '@/lib/chat/messagePagination';
import { clientEmojiString, parseReactionEmojiParam } from '@/lib/chat/reactionEmoji';
import { nonceKey, normalizeNonce } from '@/lib/chat/messageNonce';
import type { StoredForward } from '@/lib/chat/forward';

/** Audit-log a bot's moderation action (reason from X-Audit-Log-Reason, like Discord). */
function botAudit(
  serverId: string,
  botId: string,
  actionType: number,
  targetId: string,
  headers: Record<string, string | undefined>,
  bodyReason?: string | null,
) {
  audit({ serverId, userId: botId, actionType, targetId, reason: auditReason(headers['x-audit-log-reason'], bodyReason) });
}

// ─── Bot Auth Helper ───────────────────────────────────────

type BotAuth = { app: IApplication; botUser: NonNullable<Awaited<ReturnType<typeof User.findById>>> };

// One lookup per request: the rate-limit hook, the access guard and the route
// all authenticate, and Elysia hands them the same headers object.
const authMemo = new WeakMap<object, Promise<BotAuth | null>>();

function authenticateBot(headers: Record<string, string | undefined>): Promise<BotAuth | null> {
  const memo = authMemo.get(headers);
  if (memo) return memo;
  const p = (async () => {
    const authHeader = headers.authorization;
    if (!authHeader) return null;

    // Support both "Bot <token>" and "<token>" formats
    const token = authHeader.startsWith('Bot ') ? authHeader.slice(4) : authHeader;
    if (!token) return null;

    const { resolveBotToken } = await import('@/lib/services/botTokens');
    const app = await resolveBotToken(token);
    if (!app || !app.botId) return null;

    // Get the bot user
    const botUser = await User.findById(app.botId);
    if (!botUser) return null;

    return { app, botUser };
  })();
  authMemo.set(headers, p);
  return p;
}

function compareIds(id1: string, id2: string): boolean {
  return normalizeId(id1) === normalizeId(id2);
}

// ─── Channel permissions (same resolution as users) ────────

const isThreadChannel = (c: { type?: string | null }) => c.type === 'public_thread' || c.type === 'private_thread';

/**
 * The bot's permission bitfield in a channel, resolved exactly like a user's
 * (getMemberChannelPermissions: @everyone + roles, then @everyone / role /
 * member overwrites; threads use their parent's; owner and ADMINISTRATOR get
 * everything), then reduced while the bot is timed out. DMs and group DMs:
 * DM_BOT_PERMISSIONS when the bot is a recipient, nothing otherwise.
 */
async function botChannelPermissions(botId: string, channel: IChannel): Promise<bigint> {
  if (!channel.serverId) {
    const inDm = ((channel.recipientIds || []) as string[]).some((r) => compareIds(r, botId));
    return inDm ? DM_BOT_PERMISSIONS : 0n;
  }
  const membership = await ServerMember.findOne({ serverId: channel.serverId, userId: botId });
  const { getMemberChannelPermissions } = await import('@/lib/api/channels');
  const perms = await getMemberChannelPermissions(botId, channel as IChannel & { serverId: string }, membership ?? null);
  return applyTimeout(perms, membership?.communicationDisabledUntil ?? null);
}

type ChannelGuardResult =
  | { ok: true; channel: IChannel; perms: bigint }
  | { ok: false; status: number; body: { code: number; message: string } };

/** Load `channelId` and require the bot to be allowed `action` in it. */
async function requireChannelAction(channelId: string, botId: string, action: BotChannelAction): Promise<ChannelGuardResult> {
  if (!isValidObjectId(channelId)) return { ok: false, status: 404, body: { code: 10003, message: 'Unknown Channel' } };
  const channel = await Channel.findById(channelId);
  if (!channel) return { ok: false, status: 404, body: { code: 10003, message: 'Unknown Channel' } };
  const perms = await botChannelPermissions(botId, channel);
  if (!botCan(perms, action, { isThread: isThreadChannel(channel) })) {
    return { ok: false, status: 403, body: { code: 50013, message: 'Missing Permissions' } };
  }
  return { ok: true, channel, perms };
}

/** A live (not soft-deleted) message that belongs to `channelId`, or null. */
async function loadChannelMessage(channelId: string, messageId: string): Promise<IMessage | null> {
  if (!isValidObjectId(messageId)) return null;
  const msg = await Message.findById(messageId);
  if (!msg || msg.isDeleted || !compareIds(msg.channelId, channelId)) return null;
  return msg;
}

const UNKNOWN_MESSAGE = { code: 10008, message: 'Unknown Message' };

/**
 * Store multipart `files[n]` for a bot message through the same upload path
 * users get (storeChatAttachment: type whitelist, size limit, image sniffing,
 * Trust & Safety scanning), keyed under the bot's id, and build the stored
 * attachment objects (with `attachments[n]` filename/description and image
 * dimensions).
 */
async function uploadBotFiles(opts: {
  files: Array<{ index: number; file: FileLike }>;
  meta: Map<number, AttachmentMeta>;
  botId: string;
  channelId: string;
  ip?: string;
  isPremium?: boolean;
}): Promise<{ ok: true; attachments: IncomingAttachment[] } | { ok: false; status: number; body: { code: number; message: string } }> {
  const { storeChatAttachment } = await import('@/lib/api/uploads');
  const out: IncomingAttachment[] = [];
  for (const { index, file } of opts.files) {
    const m = opts.meta.get(index) ?? {};
    const filename = effectiveFilename(file.name || `file${index}`, m.filename);
    if (!filename) {
      return { ok: false, status: 400, body: { code: 50035, message: `Invalid Form Body: attachments[${index}].filename may not change the file extension` } };
    }
    const stored = await storeChatAttachment(file as unknown as File, {
      uploaderId: opts.botId,
      channelId: opts.channelId,
      ip: opts.ip,
      isPremium: opts.isPremium,
      spoiler: isSpoilerFilename(filename),
    });
    if (!stored.ok) {
      const code = stored.status === 413 ? 40005 : stored.status === 403 ? 20009 : 50035;
      return { ok: false, status: stored.status, body: { code, message: `files[${index}]: ${stored.error}` } };
    }
    let dims: { width: number; height: number } | null = null;
    if (stored.attachment.contentType.startsWith('image/')) {
      dims = imageDimensions(new Uint8Array(await file.slice(0, 256 * 1024).arrayBuffer()));
    }
    out.push({
      ...stored.attachment,
      filename,
      ...(dims ?? {}),
      ...(m.description !== undefined ? { description: m.description } : {}),
      ...(m.durationSecs !== undefined ? { durationSecs: m.durationSecs } : {}),
      ...(m.waveform !== undefined ? { waveform: m.waveform } : {}),
    });
  }
  return { ok: true, attachments: out };
}

// ─── Message presentation (decryption + MESSAGE_CONTENT) ───

interface BotViewer { botId: string; hasMessageContent: boolean }

function viewerOf(auth: { app: { gatewayIntents?: number | null; createdAt?: Date | null }; botUser: { id: string } }): BotViewer {
  return { botId: auth.botUser.id, hasMessageContent: appHasMessageContent(auth.app) };
}

/**
 * Stored messages as the bot may see them: the full Discord message object
 * (src/lib/services/botMessages.ts + src/lib/chat/discordMessage.ts), with
 * content/embeds/attachments/components/poll blanked when the app lacks the
 * MESSAGE_CONTENT intent (except DMs, the bot's own messages and mentions).
 */
async function presentMessages(
  messages: IMessage[],
  viewer: BotViewer,
  opts: { isThread?: boolean; nonce?: { messageId: string; value: string | number } | null } = {},
) {
  const { loadDiscordMessages } = await import('@/lib/services/botMessages');
  const serialized = await loadDiscordMessages(messages, {
    viewerId: viewer.botId,
    isThread: opts.isThread,
    nonces: opts.nonce ? new Map([[opts.nonce.messageId.toLowerCase(), opts.nonce.value]]) : undefined,
  });
  return serialized.map((formatted, i) => {
    const msg = messages[i];
    const redact = shouldRedactContent(
      { guildId: msg.serverId, authorId: msg.authorId, mentionedUserIds: (msg.mentionedUserIds ?? []) as string[] },
      viewer.botId,
      viewer.hasMessageContent,
    );
    return redact ? redactMessageContent(formatted, viewer.botId) : formatted;
  });
}

async function presentMessage(msg: IMessage, viewer: BotViewer, opts: { isThread?: boolean; nonce?: { messageId: string; value: string | number } | null } = {}) {
  const [one] = await presentMessages([msg], viewer, opts);
  return one;
}

/** The fields of a bot message create / edit body (JSON or payload_json). */
interface BotMessagePayload {
  content?: unknown;
  embeds?: unknown;
  /** Legacy single embed. */
  embed?: unknown;
  tts?: unknown;
  attachments?: unknown;
  allowed_mentions?: unknown;
  sticker_ids?: unknown;
  components?: unknown;
  flags?: unknown;
  poll?: unknown;
  nonce?: unknown;
  enforce_nonce?: unknown;
  message_reference?: unknown;
}

/** Discord's content limit for bot messages. */
const MAX_BOT_CONTENT = 2000;
/** Discord's per-channel pin limit. */
const MAX_PINS = 250;
/** Discord's unique reactions per message. */
const MAX_REACTION_EMOJIS = 20;
/** bulk-delete only takes messages younger than this (Discord: 2 weeks). */
const BULK_DELETE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

const isDmChannel = (c: { type?: string | null }) => c.type === 'dm' || c.type === 'group_dm';
const SYSTEM_MESSAGE = { code: 50021, message: 'Cannot execute action on a system message' };
const UNKNOWN_EMOJI = { code: 10014, message: 'Unknown Emoji' };
const isUserMessageType = (t: string | null | undefined) => !t || t === 'default' || t === 'reply';

/** Validate `content` (string or null, at most 2000 characters). */
function contentError(content: unknown) {
  if (content === undefined || content === null) return null;
  if (typeof content !== 'string') return formError(['content'], 'BASE_TYPE_STRING', 'Must be a string.');
  if (content.length > MAX_BOT_CONTENT) return formError(['content'], 'BASE_TYPE_MAX_LENGTH', `Must be ${MAX_BOT_CONTENT} or fewer in length.`);
  return null;
}

/** Sanitized + emoji-normalized content as stored (same pipeline as user sends). */
async function prepareContent(content: unknown): Promise<string> {
  if (typeof content !== 'string' || !content) return '';
  const { sanitizeMessageContent } = await import('@/lib/api/channels');
  const { normalizeEmojiFormat } = await import('@/lib/services/emoji');
  return normalizeEmojiFormat(sanitizeMessageContent(content));
}

/**
 * Mentions in `text` that may ping: parsed like a user send, limited by the
 * bot's MENTION_EVERYONE / mentionable roles, then by allowed_mentions.
 */
async function resolveBotMentions(
  text: string,
  channel: IChannel,
  botId: string,
  allowed: NormalizedAllowedMentions | null,
  repliedAuthorId: string | null,
) {
  const isDm = isDmChannel(channel);
  let parsed = { mentionEveryone: false, mentionedUserIds: [] as string[], mentionedRoleIds: [] as string[], mentionedChannelIds: [] as string[] };
  if (text) {
    const { extractMentionsFromContent, limitMentionsToPermissions } = await import('@/lib/api/channels');
    parsed = await limitMentionsToPermissions(await extractMentionsFromContent(text, channel.serverId ?? null), channel as Parameters<typeof limitMentionsToPermissions>[1], botId);
  }
  const effective = applyAllowedMentions(
    { userIds: parsed.mentionedUserIds, roleIds: isDm ? [] : parsed.mentionedRoleIds, everyone: isDm ? false : parsed.mentionEveryone },
    allowed,
    { authorId: botId, repliedAuthorId },
  );
  return { ...effective, channelIds: parsed.mentionedChannelIds };
}

/** Publish a client event on the conversation's stream (server channel or DM / group DM). */
async function publishConversation(channel: IChannel, data: object) {
  const { publishToConversation } = await import('@/lib/services/messageExtras');
  await publishToConversation(channel, data);
}

/** The bot as the web client's message author. */
function botAuthorPayload(u: { id: string; username: string; displayName?: string | null; avatar?: string | null; isBot?: boolean | null; isSystem?: boolean | null }) {
  return {
    id: u.id,
    username: u.username,
    displayName: u.displayName ?? undefined,
    avatar: u.avatar,
    isBot: u.isBot ?? undefined,
    isSystem: u.isSystem ?? undefined,
  };
}

/** Filename -> URL of a message's files, for `attachment://` in embeds. */
function attachmentUrlMap(attachments: Array<{ filename?: unknown; url?: unknown }>): Map<string, string> {
  const map = new Map<string, string>();
  for (const a of attachments) {
    if (typeof a.filename === 'string' && typeof a.url === 'string') map.set(a.filename, a.url);
  }
  return map;
}

/**
 * The `{emoji}` path segment as a stored reaction emoji. Adding a custom
 * emoji needs it to exist (and, from another server, membership there plus
 * USE_EXTERNAL_EMOJIS); removals only match by id.
 */
async function resolveReactionEmoji(
  param: string,
  opts: { forAdd: boolean; channel?: IChannel; botId?: string; perms?: bigint },
): Promise<{ ok: true; emoji: StoredReaction['emoji'] } | { ok: false }> {
  const parsed = parseReactionEmojiParam(param);
  if (!parsed || parsed.kind === 'snowflake') return { ok: false };
  if (parsed.kind === 'unicode') return { ok: true, emoji: { name: parsed.name } };
  if (!opts.forAdd) return { ok: true, emoji: { name: parsed.name, id: parsed.id, animated: parsed.animated } };
  const row = await ServerEmoji.findById(parsed.id).catch(() => null);
  if (!row || row.available === false) return { ok: false };
  const channel = opts.channel;
  if (row.serverId && channel && !(channel.serverId && compareIds(channel.serverId, row.serverId))) {
    const member = opts.botId ? await ServerMember.findOne({ serverId: row.serverId, userId: opts.botId }) : null;
    if (!member || !hasPermission(opts.perms ?? 0n, P.USE_EXTERNAL_EMOJIS)) return { ok: false };
  }
  return { ok: true, emoji: { name: row.name, id: row.id, animated: Boolean(row.animated), url: row.imageUrl ?? undefined } };
}

/** Reaction matcher by custom emoji id or unicode name (case-insensitive ids). */
function reactionMatcher(emoji: { name: string; id?: string | null }) {
  return (r: StoredReaction) => (emoji.id
    ? !!r.emoji?.id && compareIds(r.emoji.id, emoji.id)
    : !r.emoji?.id && r.emoji?.name === emoji.name);
}

/** Tell open clients a message's reactions changed wholesale (remove all / remove one emoji). */
async function publishReactionsSet(channel: IChannel, messageId: string, reactions: StoredReaction[]) {
  await publishConversation(channel, { type: 'reactions_set', messageId, reactions });
}

/** Pin / unpin for both the current and the legacy pin routes. */
async function setBotPin(
  auth: BotAuth,
  channelId: string,
  messageId: string,
  pinned: boolean,
  headers: Record<string, string | undefined>,
): Promise<{ status: number; body: unknown }> {
  const msg = await loadChannelMessage(channelId, messageId);
  if (!msg) return { status: 404, body: UNKNOWN_MESSAGE };
  const c = await requireChannelAction(channelId, auth.botUser.id, 'pin');
  if (!c.ok) return { status: c.status, body: c.body };
  if (!isUserMessageType(msg.type)) return { status: 400, body: SYSTEM_MESSAGE };
  if (Boolean(msg.pinned) === pinned) return { status: 204, body: '' };
  if (pinned && (await Message.countPinned(channelId)) >= MAX_PINS) {
    return { status: 400, body: { code: 30003, message: `Maximum number of pins reached (${MAX_PINS})` } };
  }
  await Message.updateById(msg.id, { pinned, pinnedAt: pinned ? new Date() : null });
  await publishConversation(c.channel, { type: 'pin_update', messageId: msg.id, pinned, updatedBy: auth.botUser.id }).catch(() => {});
  const { notifyPinsChanged } = await import('@/lib/services/botMessages');
  notifyPinsChanged(c.channel);
  if (c.channel.serverId) {
    audit({
      serverId: c.channel.serverId,
      userId: auth.botUser.id,
      actionType: pinned ? AuditLogEvent.MESSAGE_PIN : AuditLogEvent.MESSAGE_UNPIN,
      targetId: msg.authorId,
      options: { channel_id: c.channel.id, message_id: msg.id, channel_name: c.channel.name },
      reason: auditReason(headers['x-audit-log-reason']),
    });
  }
  return { status: 204, body: '' };
}

/**
 * Remove `userId`'s reaction (the bot's own with VIEW + READ_MESSAGE_HISTORY,
 * anyone else's with MANAGE_MESSAGES, which bots never have in DMs).
 */
async function removeBotReaction(
  auth: BotAuth,
  channelId: string,
  messageId: string,
  emojiParam: string,
  userId: string,
): Promise<{ status: number; body: unknown }> {
  const msg = await loadChannelMessage(channelId, messageId);
  if (!msg) return { status: 404, body: UNKNOWN_MESSAGE };
  const own = compareIds(userId, auth.botUser.id);
  const c = await requireChannelAction(channelId, auth.botUser.id, own ? 'react_existing' : 'manage_messages');
  if (!c.ok) return { status: c.status, body: c.body };
  const resolved = await resolveReactionEmoji(emojiParam, { forAdd: false });
  if (!resolved.ok) return { status: 400, body: UNKNOWN_EMOJI };
  const emoji = resolved.emoji;
  let removed = false;
  await Message.mutateReactions<StoredReaction>(msg.id, (rows) => {
    const result = removeReaction(rows, reactionMatcher(emoji), userId, compareIds);
    removed = result.changed;
    return result.changed ? result.reactions : null;
  });
  if (removed) {
    await publishConversation(c.channel, { type: 'reaction_remove', messageId: msg.id, emoji: emoji.id || emoji.name, userId }).catch(() => {});
    void import('@/lib/services/gatewayEvents')
      .then(({ emitReactionRemove }) => emitReactionRemove({ channelId, guildId: c.channel.serverId ?? null, messageId: msg.id, userId, emoji }))
      .catch(() => {});
  }
  return { status: 204, body: '' };
}

/** Rows of `GET /channels/{id}/messages` for a parsed query (see src/lib/chat/messagePagination.ts). */
async function pageMessages(channelId: string, q: MessagePageQuery): Promise<IMessage[]> {
  const ref = (cursor: PageCursor) => (cursor.kind === 'message' ? { messageId: cursor.id } : { at: cursor.at });
  if (q.mode === 'latest' || !q.cursor) return Message.pageChannel({ channelId, limit: q.limit });
  if (q.mode === 'before') return Message.pageChannel({ channelId, limit: q.limit, before: ref(q.cursor) });
  if (q.mode === 'after') return (await Message.pageChannel({ channelId, limit: q.limit, after: ref(q.cursor) })).reverse();
  const split = aroundSplit(q.limit);
  const [newer, older] = await Promise.all([
    split.newer > 0 ? Message.pageChannel({ channelId, limit: split.newer, after: ref(q.cursor) }) : Promise.resolve([] as IMessage[]),
    Message.pageChannel({ channelId, limit: split.olderInclusive, atOrBefore: ref(q.cursor) }),
  ]);
  return sortNewestFirst([...newer, ...older]);
}

// ─── Guild permission guard ────────────────────────────────

type ApiError = { code: number; message: string };
type BotGuildResult =
  | { ok: true; server: IServer; roles: IRole[]; standing: BotGuildStanding }
  | { ok: false; status: number; body: ApiError };

const MISSING_PERMISSIONS: ApiError = { code: 50013, message: 'Missing Permissions' };
const MISSING_ACCESS: ApiError = { code: 50001, message: 'Missing Access' };

/** Load a server plus the bot's standing in it (member roles, top position). */
async function loadBotGuild(serverId: string | null | undefined, botId: string): Promise<BotGuildResult> {
  if (!serverId || !isValidObjectId(serverId)) return { ok: false, status: 404, body: { code: 10004, message: 'Unknown Guild' } };
  const server = await Server.findById(serverId);
  if (!server) return { ok: false, status: 404, body: { code: 10004, message: 'Unknown Guild' } };
  const isOwner = compareIds(server.ownerId, botId);
  const member = await ServerMember.findOne({ serverId, userId: botId });
  if (!member && !isOwner) return { ok: false, status: 403, body: MISSING_ACCESS };
  const roles = await Role.find({ serverId });
  const standing = computeGuildStanding(roles, (member?.roles || []) as string[], isOwner);
  // A timed-out bot keeps only view + history, for guild actions too (owner can't be timed out).
  if (!isOwner) standing.perms = applyTimeout(standing.perms, member?.communicationDisabledUntil ?? null);
  return { ok: true, server, roles, standing };
}

/** Like loadBotGuild, but also requires the bot to hold `perm` server-wide. */
async function requireBotPerm(serverId: string | null | undefined, botId: string, perm: bigint): Promise<BotGuildResult> {
  const g = await loadBotGuild(serverId, botId);
  if (!g.ok) return g;
  if (!standingHas(g.standing, perm)) return { ok: false, status: 403, body: MISSING_PERMISSIONS };
  return g;
}

/**
 * Bots may only manage their own application's commands. The application id
 * is the app's id everywhere (READY, interactions, these routes); its client
 * id is accepted as an alias.
 */
function ownsApp(auth: { app: { id: string; clientId?: string | null } }, appId: string): boolean {
  if (!appId) return false;
  return compareIds(appId, auth.app.id) || (!!auth.app.clientId && appId === auth.app.clientId);
}

const UNKNOWN_COMMAND = { code: 10063, message: 'Unknown application command' };

/** Send a service result ({ status, body }) through Elysia's `set`. */
function respond(set: { status?: number | string; headers: Record<string, string | number> }, r: { status: number; body: unknown; headers?: Record<string, string> }) {
  set.status = r.status;
  if (r.headers) Object.assign(set.headers, r.headers);
  return r.status === 204 ? '' : r.body;
}

// ─── Discord-compatible response formatters ────────────────

function formatUser(user: any) {
  return {
    id: user.id,
    username: user.username,
    global_name: user.displayName || user.username,
    avatar: user.avatar,
    discriminator: '0',
    banner: user.banner ?? null,
    accent_color: null,
    bot: user.isBot ?? false,
    system: user.isSystem ?? false,
    mfa_enabled: false,
    verified: user.isVerified ?? false,
    email: null,
    flags: 0,
    premium_type: 0,
    public_flags: 0,
    created_at: user.createdAt ? new Date(user.createdAt).toISOString() : undefined,
  };
}

function formatChannel(channel: any) {
  // Shared with the gateway (GUILD_CREATE): permission_overwrites, forum tags, thread metadata.
  return toDiscordChannel(channel);
}

async function formatGuild(server: any) {
  const [roles, emojis] = await Promise.all([
    Role.find({ serverId: server.id }).then(rs => rs.map(formatRole)).catch(() => []),
    ServerEmoji.find({ serverId: server.id }).then(es => es.map((e: any) => ({
      id: e.id,
      name: e.name,
      roles: [],
      user: null,
      require_colons: true,
      managed: false,
      animated: e.animated ?? false,
      available: true,
    }))).catch(() => []),
  ]);
  return {
    id: server.id,
    name: server.name,
    icon: server.icon ?? null,
    description: server.description ?? null,
    owner_id: server.ownerId ?? null,
    verification_level: 0,
    member_count: server.memberCount ?? 0,
    premium_tier: server.premiumTier ?? 0,
    features: server.features ?? [],
    roles,
    emojis,
    stickers: [],
    banner: server.banner ?? null,
    joined_at: server.createdAt ? new Date(server.createdAt).toISOString() : undefined,
  };
}

function formatRole(role: any) {
  return toDiscordRole(role);
}

function formatMember(member: any, user: any) {
  return {
    user: user ? formatUser(user) : null,
    nick: member.nickname ?? null,
    roles: (member.roles ?? []).map((r: { emoji: { name: string; id?: string }; count: number; userIds: string[] }) => r),
    joined_at: member.joinedAt ? new Date(member.joinedAt).toISOString() : undefined,
    premium_since: member.premiumSince ? new Date(member.premiumSince).toISOString() : null,
    deaf: member.deaf ?? false,
    mute: member.mute ?? false,
    flags: 0,
    pending: member.pending ?? false,
    permissions: '0',
    communication_disabled_until: member.communicationDisabledUntil
      ? new Date(member.communicationDisabledUntil).toISOString()
      : null,
    avatar: member.avatar ?? null,
    banner: member.banner ?? null,
  };
}

function formatInvite(invite: any) {
  return {
    code: invite.code,
    guild: invite.serverId ? { id: invite.serverId, name: '' } : null,
    channel: invite.channelId ? { id: invite.channelId, name: '' } : null,
    inviter: invite.inviterId ? { id: invite.inviterId } : null,
    approximate_member_count: 0,
    approximate_presence_count: 0,
    expires_at: invite.expiresAt ? new Date(invite.expiresAt).toISOString() : null,
    uses: invite.uses ?? 0,
    max_uses: invite.maxUses ?? 0,
    max_age: invite.maxAge ?? 86400,
    temporary: invite.temporary ?? false,
    created_at: invite.createdAt ? new Date(invite.createdAt).toISOString() : undefined,
  };
}

/** The bot's application as Discord returns it (owner, bot user, guild count). */
async function discordApplication(app: IApplication, botUser: unknown) {
  const [owner, guildCount] = await Promise.all([
    app.ownerId ? User.findById(app.ownerId).catch(() => null) : Promise.resolve(null),
    ServerMember.countByUser(app.botId ?? '').catch(() => 0),
  ]);
  return toDiscordApplication(app, {
    owner: owner ? formatUser(owner) : null,
    bot: botUser ? formatUser(botUser) : null,
    guildCount,
  });
}

/** PATCH /applications/@me (and /applications/{own id}): Discord's editable fields. */
async function patchOwnApplication(auth: BotAuth, body: unknown, set: { status?: number | string }) {
  const parsed = parseApplicationPatch(body);
  if (!parsed.ok) { set.status = 400; return parsed.error; }
  const updates = { ...parsed.updates };
  if (parsed.interactionsEndpointUrl !== undefined) {
    const url = parsed.interactionsEndpointUrl;
    if (url) {
      // Same check as the portal: a signed PING must come back as a PONG.
      // safeFetch re-checks the address on the call itself, follows no
      // redirects and the reply is capped (src/lib/botapi/endpointVerify.ts).
      const { ensureBotProvisioned } = await import('@/lib/services/appIdentity');
      const provisioned = await ensureBotProvisioned(auth.app);
      const { verifyInteractionsEndpointSafely } = await import('@/lib/botapi/endpointVerify');
      const ok = await verifyInteractionsEndpointSafely({ url, privateKeyPem: provisioned.privateKeyPem, clientId: provisioned.clientId });
      if (!ok) {
        set.status = 400;
        return invalidFormBodyAt([{ path: 'interactions_endpoint_url', code: 'APPLICATION_INTERACTION_ENDPOINT_URL_INVALID', message: 'The specified interactions endpoint url could not be verified.' }]);
      }
    }
    updates.interactionsEndpointUrl = url;
  }
  const { Application } = await import('@/lib/models');
  if (Object.keys(updates).length > 0) {
    await Application.updateById(auth.app.id, updates);
    const { invalidateBotTokenCache } = await import('@/lib/services/botTokens');
    invalidateBotTokenCache();
  }
  const fresh = (await Application.findById(auth.app.id)) ?? auth.app;
  return discordApplication(fresh, auth.botUser);
}

// ─── Bot API Routes (Discord v10 compatible) ───────────────

export const botApiRoutes = new Elysia({ prefix: '/v10' })

// ─── Snowflake id boundary ─────────────────────────────────
// Snowflakes in params/query/body become UUIDs before any hook or route runs;
// responses of snowflake-format apps get snowflake ids (src/lib/botapi/boundary.ts).
.use(botIdBoundary)

// ─── Uniform Discord-shaped errors ─────────────────────────
// Any thrown error, failed validation, or unmatched route returns a
// `{ code, message }` body with the right HTTP status — the same shape bots
// already expect from the explicit error returns below — instead of Elysia's
// default HTML/plain responses.
.onError(({ code, error, set }) => {
  switch (code) {
    case 'NOT_FOUND':
      set.status = 404;
      return { code: 0, message: '404: Not Found' };
    case 'VALIDATION':
      set.status = 400;
      return validationErrorBody(error);
    case 'PARSE':
      set.status = 400;
      return { code: 50109, message: 'The request body contains invalid JSON.' };
    default:
      set.status = 500;
      console.error('Bot API error:', (error as Error)?.message ?? error);
      return { code: 0, message: '500: Internal Server Error' };
  }
})

// ─── Per-bot rate limits ───────────────────────────────────
// Every request counts against the bot's global budget; writes also against a
// per-route bucket (src/lib/security/botRateLimit.ts). Discord-style
// X-RateLimit-* headers on every limited response, a Discord-shaped 429 body.
.onBeforeHandle(async ({ headers, request, route, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) return;
  const buckets = botRequestBuckets(auth.botUser.id, request.method, String(route ?? ''), params as Record<string, string | undefined>);
  let shown: Record<string, string> | null = null;
  for (const b of buckets) {
    const r = await checkRateLimit(b.limiter, b.key);
    const resetAfterSeconds = (r.resetAfterMs ?? (r.retryAfter ?? 1) * 1000) / 1000;
    if (!r.success) {
      const limited = rateLimitedResponse({ retryAfterSeconds: resetAfterSeconds, global: b.limiter === 'botGlobal' });
      Object.assign(set.headers, rateLimitHeaders({ limit: b.limit, remaining: 0, resetAfterSeconds, bucket: b.bucket }), limited.headers);
      set.status = 429;
      return limited.body;
    }
    if (!shown) shown = rateLimitHeaders({ limit: b.limit, remaining: r.remaining ?? 0, resetAfterSeconds, bucket: b.bucket });
  }
  if (shown) Object.assign(set.headers, shown);
})

// ─── Access guard ──────────────────────────────────────────
// A bot may only touch channels it can see and servers it's in. Without this,
// any bot token could read or post in any channel or DM by id. Message ids in
// the path must belong to that channel (they were looked up globally).
.onBeforeHandle(async ({ headers, params, set }) => {
  const p = (params ?? {}) as Record<string, string | undefined>;
  if (!p.channelId && !p.guildId) return;
  const auth = await authenticateBot(headers);
  if (!auth) return; // the route itself answers 401 (or is public)
  const botId = auth.botUser.id;
  if (p.guildId) {
    if (!isValidObjectId(p.guildId)) { set.status = 404; return { code: 10004, message: 'Unknown Guild' }; }
    const member = await ServerMember.findOne({ serverId: p.guildId, userId: botId });
    if (!member) { set.status = 403; return { code: 50001, message: 'Missing Access' }; }
  }
  if (p.channelId) {
    if (!isValidObjectId(p.channelId)) { set.status = 404; return { code: 10003, message: 'Unknown Channel' }; }
    const { checkChannelAccess } = await import('@/lib/api/channels');
    const { hasAccess, channel } = await checkChannelAccess(botId, p.channelId);
    if (!channel) { set.status = 404; return { code: 10003, message: 'Unknown Channel' }; }
    if (!hasAccess) { set.status = 403; return { code: 50001, message: 'Missing Access' }; }
    if (p.guildId && channel.serverId && !compareIds(channel.serverId, p.guildId)) {
      set.status = 404; return { code: 10003, message: 'Unknown Channel' };
    }
    if (p.messageId && isValidObjectId(p.messageId)) {
      const msg = await Message.findById(p.messageId);
      if (msg && !compareIds(msg.channelId, p.channelId)) {
        set.status = 404; return { code: 10008, message: 'Unknown Message' };
      }
    }
  }
})

// ─── API root (friendly index so /api/v10 isn't a bare 404) ─
.get('/', () => ({
  message: 'SerikaCord API v10 — a Discord-compatible bot API.',
  version: 10,
  documentation: `${config.API_BASE_URL}/developers/docs`,
  endpoints: {
    rest: `${config.API_BASE_URL}/api/v10`,
    gateway: config.GATEWAY_URL,
    user: `${config.API_BASE_URL}/api/v10/users/@me`,
  },
}))

// ─── Gateway ───────────────────────────────────────────────
.get('/gateway', () => ({ url: config.GATEWAY_URL }))
.get('/gateway/bot', async ({ headers, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  return {
    url: config.GATEWAY_URL,
    shards: 1,
    session_start_limit: { total: 1000, remaining: 1000, reset_after: 86400000, max_concurrency: 1 },
  };
})

// ─── Users ─────────────────────────────────────────────────
.get('/users/@me', async ({ headers, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  return formatUser(auth.botUser);
})
.get('/users/:userId', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  if (!isValidObjectId(params.userId)) { set.status = 404; return { code: 10013, message: 'Unknown User' }; }
  const user = await User.findById(params.userId);
  if (!user) { set.status = 404; return { code: 10013, message: 'Unknown User' }; }
  return formatUser(user);
})

// ─── Applications (WP6: the calling bot's own application) ─
// discord.py's login calls GET /oauth2/applications/@me; discord.js
// client.application.fetch() and command deploy scripts call /applications/@me.
.get('/applications/@me', async ({ headers, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  return discordApplication(auth.app, auth.botUser);
})
.get('/oauth2/applications/@me', async ({ headers, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  return discordApplication(auth.app, auth.botUser);
})
.get('/applications/:appId', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  // A bot may only read its own application (Discord: owner/team only).
  if (!ownsApp(auth, params.appId)) { set.status = 403; return MISSING_ACCESS; }
  return discordApplication(auth.app, auth.botUser);
})
.patch('/applications/@me', async ({ headers, body, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  return patchOwnApplication(auth, body, set);
})
.patch('/applications/:appId', async ({ headers, params, body, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  if (!ownsApp(auth, params.appId)) { set.status = 403; return MISSING_ACCESS; }
  return patchOwnApplication(auth, body, set);
})

// ─── Guilds ────────────────────────────────────────────────
.get('/guilds/:guildId', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  if (!isValidObjectId(params.guildId)) { set.status = 404; return { code: 10004, message: 'Unknown Guild' }; }
  const server = await Server.findById(params.guildId);
  if (!server) { set.status = 404; return { code: 10004, message: 'Unknown Guild' }; }
  return await formatGuild(server);
})
.patch('/guilds/:guildId', async ({ headers, params, body, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  const g = await requireBotPerm(params.guildId, auth.botUser.id, P.MANAGE_SERVER);
  if (!g.ok) { set.status = g.status; return g.body; }

  if (!isValidObjectId(params.guildId)) { set.status = 404; return { code: 10004, message: 'Unknown Guild' }; }
  const server = await Server.findById(params.guildId);
  if (!server) { set.status = 404; return { code: 10004, message: 'Unknown Guild' }; }

  const patch = body as Record<string, unknown>;
  const updates: Record<string, unknown> = {};
  if (patch.name !== undefined) updates.name = patch.name;
  if (patch.description !== undefined) updates.description = patch.description;
  if (patch.icon !== undefined) updates.icon = patch.icon;
  if (patch.banner !== undefined) updates.banner = patch.banner;
  if (patch.verification_level !== undefined) updates.verificationLevel = patch.verification_level;
  if (patch.default_notifications !== undefined) updates.defaultNotifications = patch.default_notifications;
  const updated = await Server.updateById(params.guildId, updates);
  return await formatGuild(updated || server);
})
.get('/guilds/:guildId/preview', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  if (!isValidObjectId(params.guildId)) { set.status = 404; return { code: 10004, message: 'Unknown Guild' }; }
  const server = await Server.findById(params.guildId);
  if (!server) { set.status = 404; return { code: 10004, message: 'Unknown Guild' }; }
  return {
    id: server.id,
    name: server.name,
    icon: server.icon ?? null,
    banner: server.banner ?? null,
    description: server.description ?? null,
    approximate_member_count: server.memberCount ?? 0,
    approximate_presence_count: server.onlineCount ?? 0,
    discovery_splash: null,
    features: server.features ?? [],
  };
})
.get('/guilds/:guildId/channels', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  if (!isValidObjectId(params.guildId)) { set.status = 404; return { code: 10004, message: 'Unknown Guild' }; }
  const channels = await Channel.find({ serverId: params.guildId });
  return channels.sort((a: any, b: any) => (a.position ?? 0) - (b.position ?? 0)).map(formatChannel);
})
.get('/guilds/:guildId/roles', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  if (!isValidObjectId(params.guildId)) { set.status = 404; return { code: 10004, message: 'Unknown Guild' }; }
  const roles = await Role.find({ serverId: params.guildId });
  return roles.sort((a: any, b: any) => (a.position ?? 0) - (b.position ?? 0)).map(formatRole);
})
.get('/guilds/:guildId/members', async ({ headers, params, query, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  if (!isValidObjectId(params.guildId)) { set.status = 404; return { code: 10004, message: 'Unknown Guild' }; }
  // Listing members needs the privileged GUILD_MEMBERS intent enabled for the app (Discord).
  if ((allowedPrivilegedIntents(auth.app) & INTENT.GUILD_MEMBERS) === 0) { set.status = 403; return MISSING_ACCESS; }
  const limit = Math.min(parseInt(query.limit as string) || 100, 1000);
  const after = typeof query.after === 'string' && isValidObjectId(query.after) ? query.after : null;
  // One page in SQL (ordered by user id, honouring `after`) instead of loading every member.
  const sliced = await ServerMember.listPage(params.guildId, { limit, afterUserId: after });
  const userIds = sliced.map((m: any) => m.userId);
  const users = userIds.length > 0 ? await User.find({ id: { in: userIds } }) : [];
  const userMap = new Map(users.map((u: any) => [u.id, u]));

  return sliced.map((m: any) => formatMember(m, userMap.get(m.userId)));
})
.get('/guilds/:guildId/members/:userId', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  if (!isValidObjectId(params.guildId) || !isValidObjectId(params.userId)) {
    set.status = 404; return { code: 10007, message: 'Unknown Member' };
  }
  const member = await ServerMember.findOne({ serverId: params.guildId, userId: params.userId });
  if (!member) { set.status = 404; return { code: 10007, message: 'Unknown Member' }; }
  const user = await User.findById(params.userId);
  return formatMember(member, user);
})
.get('/guilds/:guildId/emojis', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  if (!isValidObjectId(params.guildId)) { set.status = 404; return { code: 10004, message: 'Unknown Guild' }; }
  const emojis = await ServerEmoji.find({ serverId: params.guildId });
  return emojis.map((e: any) => ({
    id: e.id,
    name: e.name,
    roles: [],
    user: null,
    require_colons: true,
    managed: false,
    animated: e.animated ?? false,
    available: true,
  }));
})
.get('/guilds/:guildId/bans', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  if (!isValidObjectId(params.guildId)) { set.status = 404; return { code: 10004, message: 'Unknown Guild' }; }
  // Ban lists (and their reasons) are moderator data: BAN_MEMBERS, like Discord.
  const g = await requireBotPerm(params.guildId, auth.botUser.id, P.BAN_MEMBERS);
  if (!g.ok) { set.status = g.status; return g.body; }
  const bans = await ServerBan.find({ serverId: params.guildId });
  return bans.map((b: any) => ({
    reason: b.reason ?? null,
    user: { id: b.userId },
  }));
})
.get('/guilds/:guildId/invites', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  if (!isValidObjectId(params.guildId)) { set.status = 404; return { code: 10004, message: 'Unknown Guild' }; }
  // Discord: MANAGE_GUILD (Serika: Manage Server).
  const g = await requireBotPerm(params.guildId, auth.botUser.id, P.MANAGE_SERVER);
  if (!g.ok) { set.status = g.status; return g.body; }
  const invites = await Invite.find({ serverId: params.guildId });
  return invites.map(formatInvite);
})

// ─── Channels ──────────────────────────────────────────────
.get('/channels/:channelId', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  if (!isValidObjectId(params.channelId)) { set.status = 404; return { code: 10003, message: 'Unknown Channel' }; }
  const channel = await Channel.findById(params.channelId);
  if (!channel) { set.status = 404; return { code: 10003, message: 'Unknown Channel' }; }
  return formatChannel(channel);
})
.patch('/channels/:channelId', async ({ headers, params, body, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  // MANAGE_CHANNELS in this channel (overwrites apply). DMs are never editable here.
  const c = await requireChannelAction(params.channelId, auth.botUser.id, 'manage_channel');
  if (!c.ok) { set.status = c.status; return c.body; }
  const channel = c.channel;
  if (!channel.serverId) { set.status = 403; return MISSING_PERMISSIONS; }

  const patch = body as Record<string, unknown>;
  const updates: Record<string, unknown> = {};
  if (patch.name !== undefined) updates.name = patch.name;
  if (patch.topic !== undefined) updates.topic = patch.topic;
  if (patch.nsfw !== undefined) updates.nsfw = patch.nsfw;
  if (patch.rate_limit_per_user !== undefined) updates.rateLimitPerUser = patch.rate_limit_per_user;
  const updated = await Channel.updateById(params.channelId, updates);
  return formatChannel(updated || channel);
})
.delete('/channels/:channelId', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  const c = await requireChannelAction(params.channelId, auth.botUser.id, 'manage_channel');
  if (!c.ok) { set.status = c.status; return c.body; }
  // DMs and group DMs are never deleted through the bot API.
  if (!c.channel.serverId) { set.status = 403; return MISSING_PERMISSIONS; }
  await Channel.deleteById(params.channelId);
  return formatChannel({ id: params.channelId });
})

// ─── Messages ──────────────────────────────────────────────
.get('/channels/:channelId/messages', async ({ headers, params, query, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  // Discord: VIEW_CHANNEL + READ_MESSAGE_HISTORY (overwrites apply).
  const c = await requireChannelAction(params.channelId, auth.botUser.id, 'read_history');
  if (!c.ok) { set.status = c.status; return c.body; }
  // around / before / after (message ids or snowflakes), limit 1..100.
  const parsed = parseMessagePageQuery({ around: query.around, before: query.before, after: query.after, limit: query.limit });
  if (!parsed.ok) { set.status = 400; return invalidFormBody(parsed.errors); }
  const rows = await pageMessages(params.channelId, parsed.query);
  return presentMessages(rows, viewerOf(auth), { isThread: isThreadChannel(c.channel) });
})
// Pinned messages, newest pin first: { items: [{ pinned_at, message }], has_more }.
.get('/channels/:channelId/messages/pins', async ({ headers, params, query, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  const c = await requireChannelAction(params.channelId, auth.botUser.id, 'read_history');
  if (!c.ok) { set.status = c.status; return c.body; }
  const errors: FormErrorTree = {};
  const limit = parseLimit(query.limit, { def: 50, min: 1, max: 50 }, errors);
  let before: Date | null = null;
  if (query.before !== undefined && query.before !== '') {
    const t = Date.parse(String(query.before));
    if (!Number.isFinite(t)) addFormError(errors, ['before'], 'DATE_TYPE_PARSE', `Could not parse ${String(query.before)}. Should be ISO8601.`);
    else before = new Date(t);
  }
  if (hasFormErrors(errors)) { set.status = 400; return invalidFormBody(errors); }
  const rows = await Message.listPinned(params.channelId, { beforePinnedAt: before, limit: limit + 1 });
  const page = rows.slice(0, limit);
  const messages = await presentMessages(page, viewerOf(auth), { isThread: isThreadChannel(c.channel) });
  return {
    items: page.map((r, i) => ({ pinned_at: new Date(r.pinnedAt ?? r.createdAt ?? Date.now()).toISOString(), message: messages[i] })),
    has_more: rows.length > limit,
  };
})
.put('/channels/:channelId/messages/pins/:messageId', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  const r = await setBotPin(auth, params.channelId, params.messageId, true, headers);
  set.status = r.status;
  return r.body;
})
.delete('/channels/:channelId/messages/pins/:messageId', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  const r = await setBotPin(auth, params.channelId, params.messageId, false, headers);
  set.status = r.status;
  return r.body;
})
.get('/channels/:channelId/messages/:messageId', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  const c = await requireChannelAction(params.channelId, auth.botUser.id, 'read_history');
  if (!c.ok) { set.status = c.status; return c.body; }
  const msg = await loadChannelMessage(params.channelId, params.messageId);
  if (!msg) { set.status = 404; return UNKNOWN_MESSAGE; }
  return presentMessage(msg, viewerOf(auth), { isThread: isThreadChannel(c.channel) });
})
.post('/channels/:channelId/messages', async ({ headers, params, body, request, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  const botId = auth.botUser.id;

  // SEND_MESSAGES (SEND_MESSAGES_IN_THREADS in threads) after overwrites; a
  // timed-out bot can't send. DMs: only a DM the bot is in.
  const c = await requireChannelAction(params.channelId, botId, 'send');
  if (!c.ok) { set.status = c.status; return c.body; }
  const channel = c.channel;
  const isDm = isDmChannel(channel);
  const isThread = isThreadChannel(channel);
  // End-to-end encrypted conversations only take envelopes from members' devices.
  if ((channel as { e2ee?: boolean | null }).e2ee === true) { set.status = 403; return { code: 50007, message: 'Cannot send messages to this user' }; }

  // JSON, or Discord multipart: files[n] + payload_json (attachments[] = per-file metadata).
  const parsedBody = parseBotMessageBody(body);
  if (!parsedBody.ok) { set.status = 400; return { code: parsedBody.code, message: parsedBody.error }; }
  const {
    content, embeds, embed, tts, attachments: rawAttachments, allowed_mentions, sticker_ids, components, flags,
    poll: pollRequest, nonce: rawNonce, enforce_nonce, message_reference,
  } = parsedBody.payload as BotMessagePayload;
  // Components: v1 action rows, or v2 layouts with IS_COMPONENTS_V2 (then no
  // content / embeds / poll). See src/lib/botapi/components.ts.

  const badContent = contentError(content);
  if (badContent) { set.status = 400; return badContent; }
  const nonceResult = normalizeNonce(rawNonce);
  if (!nonceResult.ok) { set.status = 400; return invalidFormBody(nonceResult.errors); }
  const nonce = nonceResult.nonce;
  const mentionsResult = normalizeAllowedMentions(allowed_mentions);
  if (!mentionsResult.ok) { set.status = 400; return invalidFormBody(mentionsResult.errors); }
  if (flags !== undefined && flags !== null && (typeof flags !== 'number' || !Number.isInteger(flags))) {
    set.status = 400; return formError(['flags'], 'NUMBER_TYPE_COERCE', `Value "${String(flags)}" is not int.`);
  }
  const componentsV2 = isComponentsV2(typeof flags === 'number' ? flags : 0);
  const componentErrors = new FormErrors();
  const validatedComponents = validateMessageComponents(components, { flags: typeof flags === 'number' ? flags : 0, errors: componentErrors });
  if (componentsV2) {
    if (typeof content === 'string' && content) componentErrors.add(['content'], 'COMPONENT_INVALID', 'The content field cannot be used when using MessageFlags.IS_COMPONENTS_V2');
    if ((Array.isArray(embeds) && embeds.length) || embed) componentErrors.add(['embeds'], 'COMPONENT_INVALID', 'The embeds field cannot be used when using MessageFlags.IS_COMPONENTS_V2');
    if (pollRequest !== undefined && pollRequest !== null) componentErrors.add(['poll'], 'COMPONENT_INVALID', 'The poll field cannot be used when using MessageFlags.IS_COMPONENTS_V2');
  }
  if (!componentErrors.ok) { set.status = 400; return componentErrors.toBody(); }
  let messageComponents = validatedComponents?.components ?? null;

  // message_reference: reply (type 0, same channel) or forward (type 1).
  let replyTo: IMessage | null = null;
  let forwardSnapshot: StoredForward | null = null;
  if (message_reference !== undefined && message_reference !== null) {
    if (typeof message_reference !== 'object' || Array.isArray(message_reference)) {
      set.status = 400; return formError(['message_reference'], 'MODEL_TYPE_CONVERT', 'Only dictionaries may be used in a ModelType');
    }
    const ref = message_reference as { type?: unknown; message_id?: unknown; channel_id?: unknown; fail_if_not_exists?: unknown };
    const refType = ref.type === undefined || ref.type === null ? 0 : Number(ref.type);
    if (refType !== 0 && refType !== 1) { set.status = 400; return formError(['message_reference', 'type'], 'ENUM_TYPE_COERCE', `Value "${String(ref.type)}" is not a valid enum value.`); }
    const refMessageId = typeof ref.message_id === 'string' || typeof ref.message_id === 'number' ? String(ref.message_id) : '';
    if (!refMessageId) { set.status = 400; return formError(['message_reference', 'message_id'], 'BASE_TYPE_REQUIRED', 'This field is required'); }
    const refChannelId = typeof ref.channel_id === 'string' || typeof ref.channel_id === 'number' ? String(ref.channel_id) : null;
    if (refType === 1) {
      // Forward: a frozen copy of a message the bot can read, and nothing else.
      if (!refChannelId) { set.status = 400; return formError(['message_reference', 'channel_id'], 'BASE_TYPE_REQUIRED', 'This field is required'); }
      if ((typeof content === 'string' && content) || embeds || embed || parsedBody.files.length || (Array.isArray(rawAttachments) && rawAttachments.length) || (Array.isArray(sticker_ids) && sticker_ids.length) || pollRequest) {
        set.status = 400; return formError(['message_reference'], 'MESSAGE_FORWARD_CANNOT_HAVE_CONTENT', 'A forwarded message cannot have content, embeds, files, stickers or a poll.');
      }
      // Same visibility as the app (private threads, tickets, pending screening), then READ_MESSAGE_HISTORY.
      if (!isValidObjectId(refChannelId)) { set.status = 404; return { code: 10003, message: 'Unknown Channel' }; }
      const { checkChannelAccess } = await import('@/lib/api/channels');
      const srcAccess = await checkChannelAccess(botId, refChannelId);
      if (!srcAccess.channel) { set.status = 404; return { code: 10003, message: 'Unknown Channel' }; }
      if (!srcAccess.hasAccess) { set.status = 403; return MISSING_ACCESS; }
      const src = await requireChannelAction(refChannelId, botId, 'read_history');
      if (!src.ok) { set.status = src.status; return src.body; }
      const source = await loadChannelMessage(refChannelId, refMessageId);
      if (!source) { set.status = 400; return formError(['message_reference'], 'MESSAGE_REFERENCE_UNKNOWN_MESSAGE', 'Unknown message'); }
      const { buildForwardSnapshot } = await import('@/lib/services/messageExtras');
      const built = await buildForwardSnapshot(source);
      if ('error' in built) { set.status = 400; return formError(['message_reference'], 'MESSAGE_REFERENCE_INVALID', built.error); }
      forwardSnapshot = built.snapshot;
    } else {
      if (refChannelId && !compareIds(refChannelId, params.channelId)) {
        set.status = 400; return formError(['message_reference'], 'REPLIES_CANNOT_REFERENCE_OTHER_CHANNEL', 'Cannot reply to a message in a different channel');
      }
      if (!botCan(c.perms, 'read_history', { isThread })) {
        set.status = 403; return { code: 160002, message: 'Cannot reply without permission to read message history' };
      }
      replyTo = await loadChannelMessage(params.channelId, refMessageId);
      if (!replyTo && ref.fail_if_not_exists !== false) {
        set.status = 400; return formError(['message_reference'], 'MESSAGE_REFERENCE_UNKNOWN_MESSAGE', 'Unknown message');
      }
      if (replyTo && !isUserMessageType(replyTo.type) && replyTo.type !== 'poll_result') {
        set.status = 400; return { code: 50035, message: 'Invalid Form Body', errors: addFormError({}, ['message_reference'], 'REPLIES_CANNOT_REFERENCE_SYSTEM_MESSAGE', 'Cannot reply to a system message') };
      }
    }
  }

  let attachments: IncomingAttachment[] = [];
  let attachmentPlan: Map<number, AttachmentMeta> = new Map();
  const uploadNames: string[] = [];
  if (parsedBody.files.length > 0) {
    const plan = planAttachments({ payloadAttachments: rawAttachments, fileIndexes: parsedBody.files.map((f) => f.index), mode: 'create' });
    if (!plan.ok) { set.status = 400; return { code: 50035, message: `Invalid Form Body: ${plan.error}` }; }
    attachmentPlan = plan.meta;
    for (const f of parsedBody.files) {
      const name = effectiveFilename(f.file.name || `file${f.index}`, attachmentPlan.get(f.index)?.filename);
      if (name) uploadNames.push(name);
    }
  } else {
    // JSON attachments must be real uploads owned by this bot (same CDN
    // ownership rule as users); arbitrary URLs would render as native file cards.
    const normalized = normalizeBotAttachments(rawAttachments, { cdnUrl: config.CDN_URL, botId });
    if ('error' in normalized) { set.status = 400; return { code: 50035, message: `Invalid Form Body: ${normalized.error}` }; }
    attachments = normalized.attachments;
  }
  const attachmentCount = parsedBody.files.length + attachments.length;
  if (attachmentCount > 0 && !botCan(c.perms, 'attach', { isThread })) {
    set.status = 403; return MISSING_PERMISSIONS;
  }

  // Embeds: Discord limits + URL checks; checked against the file names now so a
  // bad embed fails before anything is uploaded, resolved to real URLs below.
  const rawEmbeds = embeds !== undefined && embeds !== null ? embeds : (embed !== undefined && embed !== null ? [embed] : undefined);
  const placeholderUrls = new Map<string, string>([
    ...uploadNames.map((n) => [n, 'https://attachment.invalid/'] as [string, string]),
    ...attachmentUrlMap(attachments),
  ]);
  const embedCheck = validateEmbeds(rawEmbeds, { attachments: placeholderUrls });
  if (!embedCheck.ok) { set.status = 400; return invalidFormBody(embedCheck.errors); }

  // sticker_ids: Serika messages carry one sticker; it must be usable here.
  let stickerData: { id: string; name: string; imageUrl: string; serverId?: string } | undefined;
  if (sticker_ids !== undefined && sticker_ids !== null) {
    if (!Array.isArray(sticker_ids)) { set.status = 400; return formError(['sticker_ids'], 'BASE_TYPE_ARRAY', 'Must be an array.'); }
    if (sticker_ids.length > 1) { set.status = 400; return formError(['sticker_ids'], 'BASE_TYPE_MAX_LENGTH', 'Must be 1 or fewer in length.'); }
    if (sticker_ids.length === 1) {
      const sid = String(sticker_ids[0]);
      const sticker = isValidObjectId(sid) ? await ServerSticker.findById(sid) : null;
      if (!sticker || sticker.available === false) { set.status = 400; return { code: 50081, message: 'Invalid sticker sent' }; }
      if (sticker.serverId && !(channel.serverId && compareIds(channel.serverId, sticker.serverId))) {
        const member = await ServerMember.findOne({ serverId: sticker.serverId, userId: botId });
        if (!member || !hasPermission(c.perms, P.USE_EXTERNAL_STICKERS)) { set.status = 400; return { code: 50081, message: 'Invalid sticker sent' }; }
      }
      stickerData = { id: sticker.id, name: sticker.name, imageUrl: sticker.imageUrl, ...(sticker.serverId ? { serverId: sticker.serverId } : {}) };
    }
  }

  // Discord-style polls: `poll` { question: { text }, answers: [{ poll_media }], duration, allow_multiselect }.
  let poll: StoredPoll | null = null;
  if (pollRequest !== undefined && pollRequest !== null) {
    const input = fromDiscordPollRequest(pollRequest);
    const parsed = input ? normalizePollInput(input) : { error: 'Invalid poll' };
    if ('error' in parsed) { set.status = 400; return { code: 50035, message: `Invalid Form Body: ${parsed.error}` }; }
    if (channel.serverId && !hasPermission(c.perms, P.SEND_POLLS)) { set.status = 403; return MISSING_PERMISSIONS; }
    poll = parsed.poll;
  }
  if (!(typeof content === 'string' && content) && !embedCheck.embeds.length && !attachmentCount && !stickerData && !poll && !forwardSnapshot && !messageComponents?.length) {
    set.status = 400; return { code: 50006, message: 'Cannot send an empty message' };
  }

  // enforce_nonce: a retry with the same nonce gets the first message back.
  const viewer = viewerOf(auth);
  const nonceSlot = nonce !== null && (enforce_nonce === true || enforce_nonce === 'true') ? nonceKey(botId, params.channelId, nonce) : null;
  const { claimNonce, settleNonce } = await import('@/lib/services/botMessages');
  if (nonceSlot) {
    const claim = await claimNonce(nonceSlot);
    if (claim.kind === 'existing') {
      const existing = await loadChannelMessage(params.channelId, claim.messageId);
      if (existing) return presentMessage(existing, viewer, { isThread, nonce: { messageId: existing.id, value: nonce as string | number } });
    }
  }
  let createdId: string | null = null;
  try {
    if (parsedBody.files.length > 0) {
      const uploaded = await uploadBotFiles({
        files: parsedBody.files,
        meta: attachmentPlan,
        botId,
        channelId: params.channelId,
        ip: getClientIP(request),
        isPremium: Boolean(auth.botUser.isPremium),
      });
      if (!uploaded.ok) { set.status = uploaded.status; return uploaded.body; }
      attachments = uploaded.attachments;
    }
    // SUPPRESS_EMBEDS / SUPPRESS_NOTIFICATIONS (@silent), as on Discord.
    // IS_VOICE_MESSAGE: one audio attachment with duration_secs (+ waveform), no text.
    const voice = normalizeVoiceMessage({
      requestedFlags: typeof flags === 'number' ? flags : undefined,
      content: typeof content === 'string' ? content : undefined,
      hasSticker: Boolean(stickerData),
      attachments,
    });
    if ('error' in voice) { set.status = 400; return { code: 50035, message: `Invalid Form Body: ${voice.error}` }; }
    const msgFlags = sendFlags(typeof flags === 'number' ? flags : undefined, false) | voice.flag | (componentsV2 ? IS_COMPONENTS_V2 : 0);
    const silent = isSilentMessage(msgFlags);
    const storedAttachments = voice.flag ? voice.attachments : attachments;
    if (messageComponents) {
      // attachment://name media in thumbnails / galleries / file components.
      const refs = resolveAttachmentRefs(messageComponents, storedAttachments.map((a) => ({ id: String(a.id), filename: a.filename, url: a.url, contentType: a.contentType, width: a.width, height: a.height })));
      if (!refs.ok) { set.status = 400; return formError(['components'], 'COMPONENT_INVALID', `Unknown attachment reference attachment://${refs.missing}`); }
      messageComponents = refs.components;
    }
    // Real URLs for attachment:// now that the files exist. Without EMBED_LINKS
    // a bot's embeds are dropped, like Discord.
    const resolved = validateEmbeds(rawEmbeds, { attachments: attachmentUrlMap(storedAttachments) });
    const finalEmbeds = resolved.ok && hasPermission(c.perms, P.EMBED_LINKS) ? resolved.embeds : [];
    const ttsOn = (tts === true || tts === 'true') && hasPermission(c.perms, P.SEND_TTS_MESSAGES);

    const text = await prepareContent(content);
    // allowed_mentions is applied BEFORE storing: only these ids are badged / notified.
    const mentions = await resolveBotMentions(text, channel, botId, mentionsResult.value, replyTo?.authorId ?? null);
    const msg = await Message.create({
      channelId: params.channelId,
      serverId: channel.serverId ?? null,
      authorId: botId,
      content: text ? await encryptForStorage(text) : '',
      embeds: finalEmbeds,
      attachments: storedAttachments,
      type: replyTo ? 'reply' : 'default',
      ...(replyTo ? { referencedMessageId: replyTo.id } : {}),
      ...(forwardSnapshot ? { messageSnapshot: forwardSnapshot } : {}),
      ...(stickerData ? { sticker: stickerData } : {}),
      pinned: false,
      edited: false,
      reactions: [],
      mentionEveryone: mentions.everyone,
      mentionedUserIds: mentions.userIds,
      mentionedRoleIds: mentions.roleIds,
      mentionedChannelIds: mentions.channelIds,
      ...(poll ? { poll } : {}),
      flags: msgFlags,
      ...((msgFlags & MESSAGE_FLAGS.SUPPRESS_EMBEDS) !== 0 ? { suppressEmbeds: true } : {}),
      ...(ttsOn ? { tts: true } : {}),
      ...(messageComponents?.length ? { components: messageComponents } : {}),
    });
    createdId = msg.id;
    void Channel.updateById(params.channelId, { lastMessageId: msg.id, updatedAt: new Date() }).catch(() => {});
    if (poll) {
      const { scheduleOpenPoll } = await import('@/lib/services/messageExtras');
      void scheduleOpenPoll(msg.id, poll.expiresAt);
    }
    if (isThread) void import('@/lib/services/threads').then((m) => m.refreshThreadAfterMessage(params.channelId)).catch(() => {});

    // Web clients: the internal message shape (createdAt, authorId, channelId), not Discord's.
    const author = auth.botUser;
    let referencedMessage: Record<string, unknown> | undefined;
    if (replyTo) {
      const refAuthor = await User.findById(replyTo.authorId).catch(() => null);
      referencedMessage = {
        id: replyTo.id,
        content: replyTo.content ? await decryptFromStorage(replyTo.content).catch(() => '') : '',
        author: refAuthor ? { id: refAuthor.id, username: refAuthor.username, displayName: refAuthor.displayName || refAuthor.username, avatar: refAuthor.avatar ?? undefined, isBot: Boolean(refAuthor.isBot) } : undefined,
        createdAt: replyTo.createdAt ?? undefined,
      };
    }
    const forwardView = forwardSnapshot
      ? await (await import('@/lib/services/messageExtras')).forwardViewFor(forwardSnapshot, null)
      : undefined;
    await publishConversation(channel, {
      type: 'message',
      message: {
        id: msg.id,
        content: text,
        authorId: botId,
        author: botAuthorPayload(author),
        channelId: params.channelId,
        serverId: channel.serverId ?? null,
        createdAt: msg.createdAt ?? new Date(),
        attachments: storedAttachments,
        embeds: finalEmbeds,
        edited: false,
        pinned: false,
        reactions: [],
        type: replyTo ? 'reply' : 'default',
        ...(replyTo ? { referencedMessageId: replyTo.id, referencedMessage } : {}),
        ...(forwardView ? { forward: forwardView } : {}),
        ...(stickerData ? { sticker: stickerData } : {}),
        mentionEveryone: mentions.everyone,
        mentionedUserIds: mentions.userIds,
        mentionedRoleIds: mentions.roleIds,
        mentionedChannelIds: mentions.channelIds,
        ...(poll ? { poll: buildPollView(poll, {}, 0, []) } : {}),
        flags: msgFlags,
        ...(ttsOn ? { tts: true } : {}),
        ...(messageComponents?.length ? { components: messageComponents } : {}),
      },
    }).catch(() => {});

    const botName = author.displayName || author.username;
    const preview = text || (forwardView?.content ? forwardView.content.slice(0, 200) : '') || (stickerData ? stickerData.name : '') || componentsPlainText(messageComponents, 200);
    const { signalChannelMessage, signalDmMessage } = await import('@/lib/services/messageSignals');
    if (isDm) {
      void signalDmMessage({
        channelId: params.channelId,
        recipientIds: (channel.recipientIds || []) as string[],
        messageId: msg.id,
        authorId: botId,
        authorName: botName,
        authorAvatar: author.avatar ?? null,
        content: preview,
        hasAttachments: storedAttachments.length > 0,
        createdAt: msg.createdAt,
        silent,
      });
    } else {
      void signalChannelMessage({
        channel: { id: channel.id, serverId: channel.serverId, name: channel.name, ...(isThread ? { parentId: channel.parentId ?? null } : {}) },
        messageId: msg.id,
        authorId: botId,
        authorName: botName,
        authorAvatar: author.avatar ?? null,
        content: preview,
        mentionedUserIds: mentions.userIds,
        mentionEveryone: mentions.everyone,
        mentionedRoleIds: mentions.roleIds,
        createdAt: msg.createdAt,
        silent,
      });
    }
    // Gateway fan-out is fire-and-forget (it resolves which bots may see the channel).
    void import('@/lib/services/gatewayEvents')
      .then(({ emitMessageCreate }) => emitMessageCreate({ id: msg.id, channelId: params.channelId, serverId: channel.serverId ?? null }, { nonce }))
      .catch(() => {});

    return presentMessage(msg, viewer, { isThread, nonce: nonce !== null ? { messageId: msg.id, value: nonce } : null });
  } finally {
    if (nonceSlot) await settleNonce(nonceSlot, createdId);
  }
})
.patch('/channels/:channelId/messages/:messageId', async ({ headers, params, body, request, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  const botId = auth.botUser.id;

  const msg = await loadChannelMessage(params.channelId, params.messageId);
  if (!msg) { set.status = 404; return UNKNOWN_MESSAGE; }
  const channel = await Channel.findById(params.channelId);
  if (!channel) { set.status = 404; return { code: 10003, message: 'Unknown Channel' }; }
  const isThread = isThreadChannel(channel);
  // End-to-end encrypted conversations never get plaintext edits.
  if ((channel as { e2ee?: boolean | null }).e2ee === true) { set.status = 403; return { code: 50007, message: 'Cannot send messages to this user' }; }

  const parsedBody = parseBotMessageBody(body);
  if (!parsedBody.ok) { set.status = 400; return { code: parsedBody.code, message: parsedBody.error }; }
  const { content, embeds, embed, flags, allowed_mentions, attachments: rawAttachments, components, sticker_ids } = parsedBody.payload as BotMessagePayload;
  // Discord ignores sticker_ids on edit.
  void sticker_ids;

  const isAuthor = compareIds(msg.authorId, botId);
  const perms = await botChannelPermissions(botId, channel);
  if (!isAuthor) {
    // Someone else's message: only flags (SUPPRESS_EMBEDS), with MANAGE_MESSAGES (Discord).
    const onlyFlags = content === undefined && embeds === undefined && embed === undefined && rawAttachments === undefined
      && parsedBody.files.length === 0 && allowed_mentions === undefined && components === undefined;
    if (!onlyFlags || flags === undefined) { set.status = 403; return { code: 50005, message: 'Cannot edit a message authored by another user' }; }
    if (!botCan(perms, 'manage_messages', { isThread })) { set.status = 403; return MISSING_PERMISSIONS; }
  }
  if (!isUserMessageType(msg.type)) { set.status = 400; return SYSTEM_MESSAGE; }

  const badContent = contentError(content);
  if (badContent) { set.status = 400; return badContent; }
  const mentionsResult = normalizeAllowedMentions(allowed_mentions);
  if (!mentionsResult.ok) { set.status = 400; return invalidFormBody(mentionsResult.errors); }
  if (flags !== undefined && flags !== null && (typeof flags !== 'number' || !Number.isInteger(flags))) {
    set.status = 400; return formError(['flags'], 'NUMBER_TYPE_COERCE', `Value "${String(flags)}" is not int.`);
  }

  const updates: NonNullable<Parameters<typeof Message.updateById>[1]> = {};
  let contentChanged = false;
  let text: string | null = null;
  // Attachments on edit (Discord): `attachments` lists the ones to keep (by id)
  // plus metadata for new files[n]; new files are appended.
  let nextAttachments = (msg.attachments ?? []) as IncomingAttachment[];
  if (parsedBody.files.length > 0 || rawAttachments !== undefined) {
    const existing = ((msg.attachments ?? []) as IncomingAttachment[]);
    const plan = planAttachments({
      payloadAttachments: rawAttachments,
      fileIndexes: parsedBody.files.map((f) => f.index),
      existingIds: existing.map((a) => String(a.id)),
      mode: 'edit',
    });
    if (!plan.ok) { set.status = 400; return { code: 50035, message: `Invalid Form Body: ${plan.error}` }; }
    const kept = plan.keepExistingIds === null ? existing : existing.filter((a) => plan.keepExistingIds!.includes(String(a.id)));
    let added: IncomingAttachment[] = [];
    if (parsedBody.files.length > 0) {
      if (!botCan(perms, 'attach', { isThread })) { set.status = 403; return MISSING_PERMISSIONS; }
      if (kept.length + parsedBody.files.length > MAX_BOT_FILES) {
        set.status = 400; return { code: 50035, message: `Invalid Form Body: at most ${MAX_BOT_FILES} attachments per message` };
      }
      const uploaded = await uploadBotFiles({
        files: parsedBody.files,
        meta: plan.meta,
        botId,
        channelId: params.channelId,
        ip: getClientIP(request),
        isPremium: Boolean(auth.botUser.isPremium),
      });
      if (!uploaded.ok) { set.status = uploaded.status; return uploaded.body; }
      added = uploaded.attachments;
    }
    nextAttachments = [...kept, ...added];
    updates.attachments = nextAttachments;
    contentChanged = true;
  }
  if (content !== undefined) {
    text = await prepareContent(content);
    updates.content = text ? await encryptForStorage(text) : '';
    contentChanged = true;
  }
  if (embeds !== undefined || embed !== undefined) {
    const rawEmbeds = embeds !== undefined ? (embeds ?? []) : (embed ? [embed] : []);
    const checked = validateEmbeds(rawEmbeds, { attachments: attachmentUrlMap(nextAttachments) });
    if (!checked.ok) { set.status = 400; return invalidFormBody(checked.errors); }
    updates.embeds = hasPermission(perms, P.EMBED_LINKS) ? checked.embeds : [];
    contentChanged = true;
  }
  let suppressNow: boolean | null = null;
  if (typeof flags === 'number') {
    // Only SUPPRESS_EMBEDS can be changed on an existing message (and
    // IS_COMPONENTS_V2 turned on, never off).
    suppressNow = (flags & MESSAGE_FLAGS.SUPPRESS_EMBEDS) !== 0;
    updates.flags = ((msg.flags ?? 0) & ~MESSAGE_FLAGS.SUPPRESS_EMBEDS) | (suppressNow ? MESSAGE_FLAGS.SUPPRESS_EMBEDS : 0) | (isAuthor && isComponentsV2(flags) ? IS_COMPONENTS_V2 : 0);
    updates.suppressEmbeds = suppressNow;
  }
  // Components on edit (null / [] clears them), only the author's own.
  let nextComponents = parseStoredComponents(msg.components);
  if (components !== undefined && isAuthor) {
    const componentErrors = new FormErrors();
    const v = validateMessageComponents(components, { flags: updates.flags ?? msg.flags ?? 0, errors: componentErrors });
    if (!componentErrors.ok) { set.status = 400; return componentErrors.toBody(); }
    let list = v?.components ?? [];
    if (list.length) {
      const refs = resolveAttachmentRefs(list, nextAttachments.map((a) => ({ id: String(a.id), filename: a.filename, url: a.url, contentType: a.contentType, width: a.width, height: a.height })));
      if (!refs.ok) { set.status = 400; return formError(['components'], 'COMPONENT_INVALID', `Unknown attachment reference attachment://${refs.missing}`); }
      list = refs.components;
    }
    nextComponents = list.length ? list : null;
    updates.components = nextComponents;
    contentChanged = true;
  }

  // Never leave an empty message behind.
  const finalText = text ?? (msg.content ? await decryptFromStorage(msg.content).catch(() => '') : '');
  const finalEmbeds = (updates.embeds ?? msg.embeds ?? []) as unknown[];
  if (!finalText && finalEmbeds.length === 0 && nextAttachments.length === 0 && !msg.sticker && !msg.poll && !msg.messageSnapshot && !nextComponents?.length) {
    set.status = 400; return { code: 50006, message: 'Cannot send an empty message' };
  }

  // Mentions follow the new text (allowed_mentions applies); a reply keeps its ping only if it had one.
  let removedMentions: string[] = [];
  if (isAuthor && content !== undefined) {
    let repliedAuthorId: string | null = null;
    if (msg.referencedMessageId) {
      const ref = await Message.findById(msg.referencedMessageId).catch(() => null);
      if (ref && ((msg.mentionedUserIds ?? []) as string[]).some((id) => compareIds(id, ref.authorId))) repliedAuthorId = ref.authorId;
    }
    const mentions = await resolveBotMentions(finalText, channel, botId, mentionsResult.value, repliedAuthorId);
    updates.mentionEveryone = mentions.everyone;
    updates.mentionedUserIds = mentions.userIds;
    updates.mentionedRoleIds = mentions.roleIds;
    updates.mentionedChannelIds = mentions.channelIds;
    const after = new Set(mentions.userIds.map((id) => id.toLowerCase()));
    removedMentions = ((msg.mentionedUserIds ?? []) as string[]).filter((id) => !after.has(id.toLowerCase()));
  }
  if (isAuthor && contentChanged) {
    updates.edited = true;
    updates.editedTimestamp = new Date();
  }
  const updated = (await Message.updateById(msg.id, updates)) ?? msg;

  await publishConversation(channel, {
    type: 'edit',
    messageId: msg.id,
    ...(text !== null ? { content: text } : {}),
    ...(updates.embeds !== undefined ? { embeds: updates.embeds } : {}),
    ...(updates.attachments !== undefined ? { attachments: updates.attachments } : {}),
    ...(updates.components !== undefined ? { components: updates.components ?? [] } : {}),
    ...(updates.flags !== undefined ? { flags: updates.flags } : {}),
    ...(updates.editedTimestamp ? { editedTimestamp: updates.editedTimestamp } : {}),
  }).catch(() => {});
  if (suppressNow === true && !msg.suppressEmbeds) {
    await publishConversation(channel, { type: 'suppress_embeds', messageId: msg.id }).catch(() => {});
  }
  if (removedMentions.length > 0) {
    void import('@/lib/api/activity')
      .then(({ notifyMentionRetract }) => notifyMentionRetract(removedMentions, params.channelId, msg.id))
      .catch(() => {});
  }
  void import('@/lib/services/gatewayEvents')
    .then(({ emitMessageUpdate }) => emitMessageUpdate({ id: msg.id, channelId: params.channelId, serverId: channel.serverId ?? null }))
    .catch(() => {});
  return presentMessage(updated, viewerOf(auth), { isThread });
})
.delete('/channels/:channelId/messages/:messageId', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  const msg = await loadChannelMessage(params.channelId, params.messageId);
  if (!msg) { set.status = 404; return UNKNOWN_MESSAGE; }
  const channel = await Channel.findById(params.channelId);
  if (!channel) { set.status = 404; return { code: 10003, message: 'Unknown Channel' }; }

  // Own messages always; anyone else's needs MANAGE_MESSAGES in this channel
  // (overwrites apply; never in DMs).
  const own = compareIds(msg.authorId, auth.botUser.id);
  if (!own) {
    const c = await requireChannelAction(params.channelId, auth.botUser.id, 'manage_messages');
    if (!c.ok) { set.status = c.status; return c.body; }
  }
  // The same soft delete as the app: live removal, unread fix-up, MESSAGE_DELETE.
  if (isDmChannel(channel)) {
    const { softDeleteDmMessage } = await import('@/lib/api/dms');
    await softDeleteDmMessage(channel as Parameters<typeof softDeleteDmMessage>[0], msg, auth.botUser.id);
  } else {
    const { softDeleteChannelMessage } = await import('@/lib/api/channels');
    await softDeleteChannelMessage(channel, msg);
    if (!own && channel.serverId) {
      audit({
        serverId: channel.serverId,
        userId: auth.botUser.id,
        actionType: AuditLogEvent.MESSAGE_DELETE,
        targetId: msg.authorId,
        options: { channel_id: channel.id, channel_name: channel.name, count: '1' },
        reason: auditReason(headers['x-audit-log-reason']),
      });
    }
  }
  set.status = 204;
  return '';
})
.post('/channels/:channelId/messages/bulk-delete', async ({ headers, params, body, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  const { messages } = (body ?? {}) as { messages?: unknown };
  if (!Array.isArray(messages)) { set.status = 400; return formError(['messages'], 'BASE_TYPE_REQUIRED', 'This field is required'); }
  if (messages.length < 2) { set.status = 400; return formError(['messages'], 'BASE_TYPE_MIN_LENGTH', 'Must be 2 or more in length.'); }
  if (messages.length > 100) { set.status = 400; return formError(['messages'], 'BASE_TYPE_MAX_LENGTH', 'Must be 100 or fewer in length.'); }
  const ids = messages.map((m) => String(m).toLowerCase());
  if (new Set(ids).size !== ids.length) { set.status = 400; return formError(['messages'], 'SET_TYPE_ALREADY_CONTAINS_VALUE', 'The set already contains this value.'); }

  // Bulk delete always requires MANAGE_MESSAGES in this channel (never in DMs).
  const c = await requireChannelAction(params.channelId, auth.botUser.id, 'manage_messages');
  if (!c.ok) { set.status = c.status; return c.body; }
  if (isDmChannel(c.channel)) { set.status = 403; return MISSING_PERMISSIONS; }

  // Only live messages that are actually in this channel; unknown ids still count toward 2..100.
  const valid = ids.filter((id) => isValidObjectId(id));
  const found = valid.length ? await Message.find({ id: { in: valid }, channelId: params.channelId, isDeleted: false }) : [];
  const now = Date.now();
  if (found.some((m) => m.createdAt && now - new Date(m.createdAt).getTime() > BULK_DELETE_MAX_AGE_MS)) {
    set.status = 400; return { code: 50034, message: 'You can only bulk delete messages that are under 14 days old.' };
  }
  const deletedAt = new Date();
  for (const m of found) {
    await Message.updateById(m.id, { isDeleted: true, deletedAt });
    await publishConversation(c.channel, { type: 'delete', messageId: m.id }).catch(() => {});
  }
  if (found.length > 0) {
    const channel = c.channel;
    void import('@/lib/services/gatewayEvents')
      .then(({ emitMessageDeleteBulk }) => emitMessageDeleteBulk({ ids: found.map((m) => m.id), channelId: channel.id, guildId: channel.serverId ?? null }))
      .catch(() => {});
    // Move the newest-message pointer and roll back unread badges, like /clear.
    void (async () => {
      const [latest] = await Message.find({ channelId: channel.id, isDeleted: false, _limit: 1 });
      await Channel.updateById(channel.id, { lastMessageId: latest?.id ?? null }).catch(() => {});
      const lastMessageAt = latest?.createdAt ? new Date(latest.createdAt).toISOString() : null;
      const { notifyUnreadReset } = await import('@/lib/api/activity');
      notifyUnreadReset(
        { serverId: channel.serverId || undefined },
        channel.id,
        lastMessageAt,
        found.map((m) => ({ id: m.id, at: m.createdAt ? new Date(m.createdAt).toISOString() : null })),
      );
    })().catch(() => {});
    if (isThreadChannel(channel)) void import('@/lib/services/threads').then((m) => m.refreshThreadAfterMessage(channel.id)).catch(() => {});
    if (channel.serverId) {
      audit({
        serverId: channel.serverId,
        userId: auth.botUser.id,
        actionType: AuditLogEvent.MESSAGE_BULK_DELETE,
        targetId: channel.id,
        options: { count: String(found.length), channel_name: channel.name },
        reason: auditReason(headers['x-audit-log-reason']),
      });
    }
  }
  set.status = 204;
  return '';
})
// Publish an announcement-channel message to the channels following it.
.post('/channels/:channelId/messages/:messageId/crosspost', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  const msg = await loadChannelMessage(params.channelId, params.messageId);
  if (!msg) { set.status = 404; return UNKNOWN_MESSAGE; }
  // Own message: SEND_MESSAGES; anyone else's: MANAGE_MESSAGES.
  const own = compareIds(msg.authorId, auth.botUser.id);
  const c = await requireChannelAction(params.channelId, auth.botUser.id, own ? 'send' : 'manage_messages');
  if (!c.ok) { set.status = c.status; return c.body; }
  if (c.channel.type !== 'announcement') { set.status = 400; return { code: 50024, message: 'Cannot execute action on this channel type' }; }
  const { crosspostMessage } = await import('@/lib/api/announcements');
  const result = await crosspostMessage(c.channel, msg);
  if (!result.ok) {
    if (result.code === 'already_published') { set.status = 400; return { code: 40033, message: 'This message has already been crossposted.' }; }
    if (result.code === 'rate_limited') {
      const limited = rateLimitedResponse({ retryAfterSeconds: result.retryAfter ?? 60, global: false });
      Object.assign(set.headers, limited.headers);
      set.status = 429;
      return limited.body;
    }
    set.status = result.status; return { code: 0, message: result.error };
  }
  return presentMessage(result.message, viewerOf(auth));
})

// ─── Polls ─────────────────────────────────────────────────
// Voters for one answer, ordered by user id: { users: [...] } (after / limit 1..100).
.get('/channels/:channelId/polls/:messageId/answers/:answerId', async ({ headers, params, query, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  const c = await requireChannelAction(params.channelId, auth.botUser.id, 'read_history');
  if (!c.ok) { set.status = c.status; return c.body; }
  const msg = await loadChannelMessage(params.channelId, params.messageId);
  const poll = msg && msg.type !== 'poll_result' ? parseStoredPoll(msg.poll) : null;
  if (!msg || !poll) { set.status = 404; return UNKNOWN_MESSAGE; }
  const answerId = Number(params.answerId);
  if (!Number.isInteger(answerId) || !poll.answers.some((a) => a.id === answerId)) {
    set.status = 400; return formError(['answer_id'], 'NUMBER_TYPE_COERCE', 'Unknown answer.');
  }
  const errors: FormErrorTree = {};
  const limit = parseLimit(query.limit, { def: 25, min: 1, max: 100 }, errors);
  if (hasFormErrors(errors)) { set.status = 400; return invalidFormBody(errors); }
  const after = typeof query.after === 'string' && isValidObjectId(query.after) ? query.after : null;
  const { pollAnswerVoterIds } = await import('@/lib/services/botMessages');
  const ids = await pollAnswerVoterIds(msg.id, answerId, { after, limit });
  const users = ids.length ? await User.find({ id: { in: ids } }) : [];
  const byId = new Map(users.map((u) => [u.id.toLowerCase(), u]));
  return { users: ids.map((id) => byId.get(id.toLowerCase())).filter(Boolean).map(formatUser) };
})
// End a poll early (its author only); returns the message with final results.
.post('/channels/:channelId/polls/:messageId/expire', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  const c = await requireChannelAction(params.channelId, auth.botUser.id, 'read_history');
  if (!c.ok) { set.status = c.status; return c.body; }
  const msg = await loadChannelMessage(params.channelId, params.messageId);
  const poll = msg && msg.type !== 'poll_result' ? parseStoredPoll(msg.poll) : null;
  if (!msg || !poll) { set.status = 404; return UNKNOWN_MESSAGE; }
  if (!compareIds(msg.authorId, auth.botUser.id)) { set.status = 403; return MISSING_PERMISSIONS; }
  if (!poll.finalizedAt) {
    const { finalizePoll } = await import('@/lib/services/messageExtras');
    await finalizePoll(msg.id, { early: !isPollClosed(poll) });
  }
  const fresh = (await Message.findById(msg.id)) ?? msg;
  return presentMessage(fresh, viewerOf(auth), { isThread: isThreadChannel(c.channel) });
})

// ─── Pins (legacy routes; see /messages/pins above) ────────
.get('/channels/:channelId/pins', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  const c = await requireChannelAction(params.channelId, auth.botUser.id, 'read_history');
  if (!c.ok) { set.status = c.status; return c.body; }
  const pinned = await Message.listPinned(params.channelId, { limit: 50 });
  return presentMessages(pinned, viewerOf(auth), { isThread: isThreadChannel(c.channel) });
})
.put('/channels/:channelId/pins/:messageId', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  const r = await setBotPin(auth, params.channelId, params.messageId, true, headers);
  set.status = r.status;
  return r.body;
})
.delete('/channels/:channelId/pins/:messageId', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  const r = await setBotPin(auth, params.channelId, params.messageId, false, headers);
  set.status = r.status;
  return r.body;
})

// ─── Reactions ─────────────────────────────────────────────
.put('/channels/:channelId/messages/:messageId/reactions/:emoji/@me', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  const botId = auth.botUser.id;

  const msg = await loadChannelMessage(params.channelId, params.messageId);
  if (!msg) { set.status = 404; return UNKNOWN_MESSAGE; }
  const pre = await requireChannelAction(params.channelId, botId, 'react_existing');
  if (!pre.ok) { set.status = pre.status; return pre.body; }
  const resolved = await resolveReactionEmoji(params.emoji, { forAdd: true, channel: pre.channel, botId, perms: pre.perms });
  if (!resolved.ok) { set.status = 400; return UNKNOWN_EMOJI; }
  const emoji = resolved.emoji;
  const match = reactionMatcher(emoji);
  // Joining an existing reaction needs VIEW_CHANNEL + READ_MESSAGE_HISTORY;
  // adding a new emoji also needs ADD_REACTIONS (Discord), and at most 20 emoji per message.
  const current = (msg.reactions as StoredReaction[] | null) ?? [];
  if (!current.some(match)) {
    if (!botCan(pre.perms, 'react_new', { isThread: isThreadChannel(pre.channel) })) { set.status = 403; return MISSING_PERMISSIONS; }
    if (current.length >= MAX_REACTION_EMOJIS) { set.status = 400; return { code: 30010, message: `Maximum number of reactions reached (${MAX_REACTION_EMOJIS})` }; }
  }
  // Row-locked so concurrent reactions can't overwrite each other.
  let added = false;
  let count = 0;
  await Message.mutateReactions<StoredReaction>(msg.id, (rows) => {
    const already = rows.find(match)?.userIds?.some((id) => compareIds(id, botId)) ?? false;
    const result = addReaction(rows, match, emoji, botId, compareIds);
    added = !already;
    count = result.count;
    return already ? null : result.reactions;
  });
  if (added) {
    await publishConversation(pre.channel, { type: 'reaction_add', messageId: msg.id, emoji: clientEmojiString(emoji), userId: botId, count }).catch(() => {});
    void import('@/lib/services/gatewayEvents')
      .then(({ emitReactionAdd }) => emitReactionAdd({
        channelId: params.channelId,
        guildId: pre.channel.serverId ?? null,
        messageId: msg.id,
        messageAuthorId: msg.authorId,
        userId: botId,
        emoji,
      }))
      .catch(() => {});
  }
  set.status = 204;
  return '';
})
.delete('/channels/:channelId/messages/:messageId/reactions/:emoji/@me', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  const r = await removeBotReaction(auth, params.channelId, params.messageId, params.emoji, auth.botUser.id);
  set.status = r.status;
  return r.body;
})
.delete('/channels/:channelId/messages/:messageId/reactions/:emoji/:userId', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  if (!isValidObjectId(params.userId)) { set.status = 404; return { code: 10013, message: 'Unknown User' }; }
  const r = await removeBotReaction(auth, params.channelId, params.messageId, params.emoji, params.userId);
  set.status = r.status;
  return r.body;
})
// Users who reacted with an emoji, ordered by id: after / limit 1..100 (default 25) / type.
.get('/channels/:channelId/messages/:messageId/reactions/:emoji', async ({ headers, params, query, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  const c = await requireChannelAction(params.channelId, auth.botUser.id, 'read_history');
  if (!c.ok) { set.status = c.status; return c.body; }
  const msg = await loadChannelMessage(params.channelId, params.messageId);
  if (!msg) { set.status = 404; return UNKNOWN_MESSAGE; }
  const resolved = await resolveReactionEmoji(params.emoji, { forAdd: false });
  if (!resolved.ok) { set.status = 400; return UNKNOWN_EMOJI; }
  const errors: FormErrorTree = {};
  const limit = parseLimit(query.limit, { def: 25, min: 1, max: 100 }, errors);
  const type = query.type === undefined || query.type === '' ? 0 : Number(query.type);
  if (type !== 0 && type !== 1) addFormError(errors, ['type'], 'ENUM_TYPE_COERCE', `Value "${String(query.type)}" is not a valid enum value.`);
  if (hasFormErrors(errors)) { set.status = 400; return invalidFormBody(errors); }

  const reaction = ((msg.reactions as StoredReaction[] | null) ?? []).find(reactionMatcher(resolved.emoji));
  if (!reaction) return [];
  const after = typeof query.after === 'string' && query.after ? query.after : null;
  const ids = pageReactionUsers(reaction.userIds ?? [], { after, limit, type });
  const users = ids.length > 0 ? await User.find({ id: { in: ids } }) : [];
  const byId = new Map(users.map((u: { id: string }) => [u.id.toLowerCase(), u]));
  return ids.map((id) => byId.get(id)).filter(Boolean).map(formatUser);
})
// Remove every reaction of one emoji (MANAGE_MESSAGES).
.delete('/channels/:channelId/messages/:messageId/reactions/:emoji', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  const msg = await loadChannelMessage(params.channelId, params.messageId);
  if (!msg) { set.status = 404; return UNKNOWN_MESSAGE; }
  const c = await requireChannelAction(params.channelId, auth.botUser.id, 'manage_messages');
  if (!c.ok) { set.status = c.status; return c.body; }
  const resolved = await resolveReactionEmoji(params.emoji, { forAdd: false });
  if (!resolved.ok) { set.status = 400; return UNKNOWN_EMOJI; }
  const match = reactionMatcher(resolved.emoji);
  let removed: StoredReaction | undefined;
  const stored = await Message.mutateReactions<StoredReaction>(msg.id, (rows) => {
    removed = rows.find(match);
    return removed ? rows.filter((r) => !match(r)) : null;
  });
  if (removed && stored) {
    await publishReactionsSet(c.channel, msg.id, stored).catch(() => {});
    void import('@/lib/services/gatewayEvents')
      .then(({ emitReactionRemoveEmoji }) => emitReactionRemoveEmoji({ channelId: params.channelId, guildId: c.channel.serverId ?? null, messageId: msg.id, emoji: removed!.emoji }))
      .catch(() => {});
  }
  set.status = 204;
  return '';
})
.delete('/channels/:channelId/messages/:messageId/reactions', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  const msg = await loadChannelMessage(params.channelId, params.messageId);
  if (!msg) { set.status = 404; return UNKNOWN_MESSAGE; }
  // Wiping every reaction needs MANAGE_MESSAGES in this channel (Discord).
  const c = await requireChannelAction(params.channelId, auth.botUser.id, 'manage_messages');
  if (!c.ok) { set.status = c.status; return c.body; }
  let had = false;
  await Message.mutateReactions<StoredReaction>(msg.id, (rows) => {
    had = rows.length > 0;
    return had ? [] : null;
  });
  if (had) {
    await publishReactionsSet(c.channel, msg.id, []).catch(() => {});
    void import('@/lib/services/gatewayEvents')
      .then(({ emitReactionRemoveAll }) => emitReactionRemoveAll({ channelId: params.channelId, guildId: c.channel.serverId ?? null, messageId: msg.id }))
      .catch(() => {});
  }
  set.status = 204;
  return '';
})

// ─── Typing ────────────────────────────────────────────────
// Shows "<bot> is typing…" to everyone in the channel for ~10 s and sends TYPING_START.
.post('/channels/:channelId/typing', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  const c = await requireChannelAction(params.channelId, auth.botUser.id, 'typing');
  if (!c.ok) { set.status = c.status; return c.body; }
  const bot = auth.botUser;
  const { cache } = await import('@/lib/db');
  await cache.setTyping(c.channel.id, bot.id).catch(() => {});
  await publishConversation(c.channel, { type: 'typing', userId: bot.id, username: bot.username }).catch(() => {});
  if (isDmChannel(c.channel)) {
    const { emitDmListUpdate } = await import('@/lib/api/dms');
    emitDmListUpdate((c.channel.recipientIds || []) as string[], { type: 'typing', channelId: c.channel.id, userId: bot.id, username: bot.username });
  }
  void import('@/lib/services/gatewayEvents')
    .then(({ emitTypingStart }) => emitTypingStart({ channelId: c.channel.id, guildId: c.channel.serverId ?? null, userId: bot.id }))
    .catch(() => {});
  set.status = 204;
  return '';
})

// ─── Application Commands ──────────────────────────────────
// Global (guildId null) and guild commands share the handlers in
// src/lib/services/appCommands.ts: POST upserts by name + type (201 / 200),
// PUT diffs instead of delete + recreate so ids stay stable, validation errors
// are 50035 trees. `:appId` is the application id (its client id also works).
.get('/applications/:appId/commands', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  if (!ownsApp(auth, params.appId)) { set.status = 403; return MISSING_ACCESS; }
  const { listCommands, serializeCommand } = await import('@/lib/services/appCommands');
  return (await listCommands(auth.app.id, null)).map((c) => serializeCommand(c, auth.app.id));
})
.put('/applications/:appId/commands', async ({ headers, params, body, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  if (!ownsApp(auth, params.appId)) { set.status = 403; return MISSING_ACCESS; }
  const { bulkOverwriteCommands } = await import('@/lib/services/appCommands');
  return respond(set, await bulkOverwriteCommands(auth.app.id, null, body));
})
.post('/applications/:appId/commands', async ({ headers, params, body, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  if (!ownsApp(auth, params.appId)) { set.status = 403; return MISSING_ACCESS; }
  const { upsertCommand } = await import('@/lib/services/appCommands');
  return respond(set, await upsertCommand(auth.app.id, null, body));
})
.get('/applications/:appId/commands/:commandId', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  if (!ownsApp(auth, params.appId)) { set.status = 403; return MISSING_ACCESS; }
  if (!isValidObjectId(params.commandId)) { set.status = 404; return UNKNOWN_COMMAND; }
  const { getCommand } = await import('@/lib/services/appCommands');
  return respond(set, await getCommand(auth.app.id, null, params.commandId));
})
.patch('/applications/:appId/commands/:commandId', async ({ headers, params, body, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  if (!ownsApp(auth, params.appId)) { set.status = 403; return MISSING_ACCESS; }
  if (!isValidObjectId(params.commandId)) { set.status = 404; return UNKNOWN_COMMAND; }
  const { patchCommand } = await import('@/lib/services/appCommands');
  return respond(set, await patchCommand(auth.app.id, null, params.commandId, body));
})
.delete('/applications/:appId/commands/:commandId', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  if (!ownsApp(auth, params.appId)) { set.status = 403; return MISSING_ACCESS; }
  if (!isValidObjectId(params.commandId)) { set.status = 404; return UNKNOWN_COMMAND; }
  const { deleteCommand } = await import('@/lib/services/appCommands');
  return respond(set, await deleteCommand(auth.app.id, null, params.commandId));
})
.get('/applications/:appId/guilds/:guildId/commands', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  if (!ownsApp(auth, params.appId)) { set.status = 403; return MISSING_ACCESS; }
  const { listCommands, serializeCommand } = await import('@/lib/services/appCommands');
  return (await listCommands(auth.app.id, params.guildId)).map((c) => serializeCommand(c, auth.app.id));
})
.put('/applications/:appId/guilds/:guildId/commands', async ({ headers, params, body, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  if (!ownsApp(auth, params.appId)) { set.status = 403; return MISSING_ACCESS; }
  const { bulkOverwriteCommands } = await import('@/lib/services/appCommands');
  return respond(set, await bulkOverwriteCommands(auth.app.id, params.guildId, body));
})
.post('/applications/:appId/guilds/:guildId/commands', async ({ headers, params, body, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  if (!ownsApp(auth, params.appId)) { set.status = 403; return MISSING_ACCESS; }
  const { upsertCommand } = await import('@/lib/services/appCommands');
  return respond(set, await upsertCommand(auth.app.id, params.guildId, body));
})
// Permissions v2. Discord only lets a Bearer token with
// applications.commands.permissions.update write these; SerikaCord also lets
// the app's own bot write them (there is no OAuth flow for that scope yet).
.get('/applications/:appId/guilds/:guildId/commands/permissions', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  if (!ownsApp(auth, params.appId)) { set.status = 403; return MISSING_ACCESS; }
  const { listGuildCommandPermissions } = await import('@/lib/services/appCommands');
  return listGuildCommandPermissions(auth.app.id, params.guildId);
})
.get('/applications/:appId/guilds/:guildId/commands/:commandId', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  if (!ownsApp(auth, params.appId)) { set.status = 403; return MISSING_ACCESS; }
  if (!isValidObjectId(params.commandId)) { set.status = 404; return UNKNOWN_COMMAND; }
  const { getCommand } = await import('@/lib/services/appCommands');
  return respond(set, await getCommand(auth.app.id, params.guildId, params.commandId));
})
.patch('/applications/:appId/guilds/:guildId/commands/:commandId', async ({ headers, params, body, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  if (!ownsApp(auth, params.appId)) { set.status = 403; return MISSING_ACCESS; }
  if (!isValidObjectId(params.commandId)) { set.status = 404; return UNKNOWN_COMMAND; }
  const { patchCommand } = await import('@/lib/services/appCommands');
  return respond(set, await patchCommand(auth.app.id, params.guildId, params.commandId, body));
})
.delete('/applications/:appId/guilds/:guildId/commands/:commandId', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  if (!ownsApp(auth, params.appId)) { set.status = 403; return MISSING_ACCESS; }
  if (!isValidObjectId(params.commandId)) { set.status = 404; return UNKNOWN_COMMAND; }
  const { deleteCommand } = await import('@/lib/services/appCommands');
  return respond(set, await deleteCommand(auth.app.id, params.guildId, params.commandId));
})
.get('/applications/:appId/guilds/:guildId/commands/:commandId/permissions', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  if (!ownsApp(auth, params.appId)) { set.status = 403; return MISSING_ACCESS; }
  const commandId = ownsApp(auth, params.commandId) ? auth.app.id : params.commandId;
  if (!isValidObjectId(commandId)) { set.status = 404; return UNKNOWN_COMMAND; }
  const { getCommandPermissions } = await import('@/lib/services/appCommands');
  return respond(set, await getCommandPermissions(auth.app.id, params.guildId, commandId));
})
.put('/applications/:appId/guilds/:guildId/commands/:commandId/permissions', async ({ headers, params, body, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  if (!ownsApp(auth, params.appId)) { set.status = 403; return MISSING_ACCESS; }
  const commandId = ownsApp(auth, params.commandId) ? auth.app.id : params.commandId;
  if (!isValidObjectId(commandId)) { set.status = 404; return UNKNOWN_COMMAND; }
  const { putCommandPermissions } = await import('@/lib/services/appCommands');
  return respond(set, await putCommandPermissions({ id: auth.app.id, botId: auth.app.botId ?? null }, params.guildId, commandId, body));
})

// ─── Interactions ──────────────────────────────────────────
// No bot token: the interaction token is the credential (Discord). Responses
// go through src/lib/services/interactions.ts (3 s deadline, single ack, types
// 1 4 5 6 7 8 9; with_response=true returns an InteractionCallbackResponse).
.post('/interactions/:interactionId/:interactionToken/callback', async ({ params, body, query, set }) => {
  const { handleInteractionCallback } = await import('@/lib/services/interactions');
  const { with_response } = query as Record<string, string | undefined>;
  return respond(set, await handleInteractionCallback(params.interactionId, params.interactionToken, body, { withResponse: with_response === 'true' }));
})

// ─── Invite ────────────────────────────────────────────────
.get('/invites/:code', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  const invite = await Invite.findOne({ code: params.code });
  if (!invite) { set.status = 404; return { code: 10006, message: 'Unknown Invite' }; }
  return formatInvite(invite);
})
.delete('/invites/:code', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  const invite = await Invite.findOne({ code: params.code });
  if (!invite) { set.status = 404; return { code: 10006, message: 'Unknown Invite' }; }
  {
    const g = await loadBotGuild(invite.serverId, auth.botUser.id);
    if (!g.ok) { set.status = 404; return { code: 10006, message: 'Unknown Invite' }; }
    if (!standingHas(g.standing, P.MANAGE_SERVER) && !standingHas(g.standing, P.MANAGE_CHANNELS)) {
      set.status = 403; return MISSING_PERMISSIONS;
    }
  }
  await Invite.deleteById(invite.id);
  return formatInvite(invite);
})

// ─── Guild Channel CRUD ────────────────────────────────────
.post('/guilds/:guildId/channels', async ({ headers, params, body, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  if (!isValidObjectId(params.guildId)) { set.status = 404; return { code: 10004, message: 'Unknown Guild' }; }
  const g = await requireBotPerm(params.guildId, auth.botUser.id, P.MANAGE_CHANNELS);
  if (!g.ok) { set.status = g.status; return g.body; }

  const existingChannels = await Channel.find({ serverId: params.guildId });
  if (existingChannels.length >= config.MAX_CHANNELS_PER_SERVER) {
    set.status = 400;
    return { code: 30013, message: 'Maximum number of guild channels reached' };
  }

  const { name, type, topic, nsfw, parent_id, rate_limit_per_user, position } = body as { name?: string; type?: number; topic?: string; nsfw?: boolean; parent_id?: string; rate_limit_per_user?: number; position?: number };
  if (!name) { set.status = 400; return { code: 50035, message: 'Name is required' }; }
  if (parent_id) {
    const parent = isValidObjectId(parent_id) ? await Channel.findById(parent_id) : null;
    if (!parent || !parent.serverId || !compareIds(parent.serverId, params.guildId)) {
      set.status = 400; return { code: 50035, message: 'Invalid parent_id' };
    }
  }

  const typeReverseMap: Record<number, 'text' | 'voice' | 'category' | 'announcement' | 'stage' | 'forum'> = {
    0: 'text', 2: 'voice', 4: 'category', 5: 'announcement',
    13: 'stage', 15: 'forum',
  };

  const channel = await Channel.create({
    serverId: params.guildId,
    name,
    type: (type !== undefined ? typeReverseMap[type] : undefined) ?? 'text',
    topic: topic ?? '',
    nsfw: nsfw ?? false,
    parentId: parent_id ?? undefined,
    rateLimitPerUser: rate_limit_per_user ?? 0,
    position: position ?? 0,
    bitrate: 64000,
    userLimit: 0,
    recipientIds: [],
    permissionOverwrites: [],
  });
  return formatChannel(channel);
})
.patch('/guilds/:guildId/channels/:channelId', async ({ headers, params, body, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  const c = await requireChannelAction(params.channelId, auth.botUser.id, 'manage_channel');
  if (!c.ok) { set.status = c.status; return c.body; }
  const channel = c.channel;
  if (!channel.serverId || !compareIds(channel.serverId, params.guildId)) { set.status = 404; return { code: 10003, message: 'Unknown Channel' }; }

  const patch = body as Record<string, unknown>;
  const updates: Record<string, unknown> = {};
  if (patch.name !== undefined) updates.name = patch.name;
  if (patch.topic !== undefined) updates.topic = patch.topic;
  if (patch.nsfw !== undefined) updates.nsfw = patch.nsfw;
  if (patch.position !== undefined) updates.position = patch.position;
  if (patch.rate_limit_per_user !== undefined) updates.rateLimitPerUser = patch.rate_limit_per_user;
  if (patch.parent_id !== undefined) {
    if (patch.parent_id) {
      const parentId = String(patch.parent_id);
      const parent = isValidObjectId(parentId) ? await Channel.findById(parentId) : null;
      if (!parent || !parent.serverId || !compareIds(parent.serverId, params.guildId)) {
        set.status = 400; return { code: 50035, message: 'Invalid parent_id' };
      }
    }
    updates.parentId = patch.parent_id ?? undefined;
  }
  const updated = await Channel.updateById(params.channelId, updates);
  return formatChannel(updated || channel);
})
.delete('/guilds/:guildId/channels/:channelId', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  const c = await requireChannelAction(params.channelId, auth.botUser.id, 'manage_channel');
  if (!c.ok) { set.status = c.status; return c.body; }
  if (!c.channel.serverId || !compareIds(c.channel.serverId, params.guildId)) { set.status = 404; return { code: 10003, message: 'Unknown Channel' }; }
  await Channel.deleteById(params.channelId);
  set.status = 204;
  return '';
})

// ─── Guild Role CRUD ───────────────────────────────────────
.post('/guilds/:guildId/roles', async ({ headers, params, body, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  if (!isValidObjectId(params.guildId)) { set.status = 404; return { code: 10004, message: 'Unknown Guild' }; }
  const g = await requireBotPerm(params.guildId, auth.botUser.id, P.MANAGE_ROLES);
  if (!g.ok) { set.status = g.status; return g.body; }
  const { name, color, hoist, permissions, mentionable } = body as { name?: string; color?: number; hoist?: boolean; permissions?: string; mentionable?: boolean; icon?: string; unicode_emoji?: string };
  const permBits = parseBitfield(permissions);
  if (permBits === null) { set.status = 400; return { code: 50035, message: 'Invalid permissions' }; }
  if (!canGrantBits(g.standing, permBits)) { set.status = 403; return MISSING_PERMISSIONS; }

  const role = await Role.create({
    serverId: params.guildId,
    name: name ?? 'new role',
    color: color ?? 0,
    hoist: hoist ?? false,
    permissions: String(permBits),
    mentionable: mentionable ?? false,
    isDefault: false,
    managed: false,
  });
  return formatRole(role);
})
.patch('/guilds/:guildId/roles/:roleId', async ({ headers, params, body, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  const role = isValidObjectId(params.roleId) ? await Role.findById(params.roleId) : null;
  if (!role || !compareIds(role.serverId, params.guildId)) { set.status = 404; return { code: 10011, message: 'Unknown Role' }; }
  const g = await requireBotPerm(params.guildId, auth.botUser.id, P.MANAGE_ROLES);
  if (!g.ok) { set.status = g.status; return g.body; }
  // Role hierarchy: only roles below the bot's top role (the @everyone role
  // sits at the bottom and is editable with Manage Roles).
  if (!role.isDefault && !outranks(g.standing, role.position ?? 0)) { set.status = 403; return MISSING_PERMISSIONS; }

  const patch = body as Record<string, unknown>;
  const updates: Record<string, unknown> = {};
  if (patch.name !== undefined) updates.name = patch.name;
  if (patch.color !== undefined) updates.color = patch.color;
  if (patch.hoist !== undefined) updates.hoist = patch.hoist;
  if (patch.permissions !== undefined) {
    const bits = parseBitfield(patch.permissions);
    if (bits === null) { set.status = 400; return { code: 50035, message: 'Invalid permissions' }; }
    if (!canGrantBits(g.standing, bits)) { set.status = 403; return MISSING_PERMISSIONS; }
    updates.permissions = String(bits);
  }
  if (patch.mentionable !== undefined) updates.mentionable = patch.mentionable;
  if (patch.position !== undefined && !role.isDefault) {
    const pos = Number(patch.position);
    if (!Number.isInteger(pos) || pos < 1) { set.status = 400; return { code: 50035, message: 'Invalid position' }; }
    if (!outranks(g.standing, pos)) { set.status = 403; return MISSING_PERMISSIONS; }
    updates.position = pos;
  }
  const updated = await Role.updateById(params.roleId, updates);
  return formatRole(updated || role);
})
.delete('/guilds/:guildId/roles/:roleId', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  const role = isValidObjectId(params.roleId) ? await Role.findById(params.roleId) : null;
  if (!role || !compareIds(role.serverId, params.guildId)) { set.status = 404; return { code: 10011, message: 'Unknown Role' }; }
  const g = await requireBotPerm(params.guildId, auth.botUser.id, P.MANAGE_ROLES);
  if (!g.ok) { set.status = g.status; return g.body; }
  if (role.isDefault || role.managed || !outranks(g.standing, role.position ?? 0)) {
    set.status = 403; return MISSING_PERMISSIONS;
  }
  await Role.deleteById(params.roleId);
  set.status = 204;
  return '';
})

// ─── Guild Member Management ───────────────────────────────
.patch('/guilds/:guildId/members/:userId', async ({ headers, params, body, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  if (!isValidObjectId(params.guildId) || !isValidObjectId(params.userId)) {
    set.status = 404; return { code: 10007, message: 'Unknown Member' };
  }
  const member = await ServerMember.findOne({ serverId: params.guildId, userId: params.userId });
  if (!member) { set.status = 404; return { code: 10007, message: 'Unknown Member' }; }

  const g = await loadBotGuild(params.guildId, auth.botUser.id);
  if (!g.ok) { set.status = g.status; return g.body; }
  const isSelf = compareIds(params.userId, auth.botUser.id);
  const targetIsOwner = compareIds(g.server.ownerId, params.userId);
  const targetOutranked = outranks(g.standing, memberTopPosition(g.roles, (member.roles || []) as string[]));
  const deny = () => { set.status = 403; return MISSING_PERMISSIONS; };

  const patch = body as Record<string, unknown>;
  const updates: Record<string, unknown> = {};
  if (patch.nick !== undefined) {
    if (isSelf) {
      if (!standingHas(g.standing, P.CHANGE_NICKNAME) && !standingHas(g.standing, P.MANAGE_NICKNAMES)) return deny();
    } else if (!standingHas(g.standing, P.MANAGE_NICKNAMES) || targetIsOwner || !targetOutranked) {
      return deny();
    }
    updates.nickname = patch.nick;
  }
  if (patch.roles !== undefined) {
    if (!Array.isArray(patch.roles) || patch.roles.some(r => typeof r !== 'string')) {
      set.status = 400; return { code: 50035, message: 'Invalid roles' };
    }
    if (!standingHas(g.standing, P.MANAGE_ROLES)) return deny();
    const roleById = new Map(g.roles.map(r => [normalizeId(r.id), r]));
    const before = new Set(((member.roles || []) as string[]).map(normalizeId));
    const after = new Set((patch.roles as string[]).map(normalizeId));
    for (const id of after) {
      if (!roleById.has(id)) { set.status = 400; return { code: 50035, message: 'Unknown role in roles' }; }
    }
    // Every role being added or removed must be an assignable role below the
    // bot's top role (Discord's hierarchy rule).
    const changed = [...after].filter(id => !before.has(id)).concat([...before].filter(id => !after.has(id)));
    for (const id of changed) {
      const r = roleById.get(id);
      if (!r) continue; // stale id on the member record; dropping it is fine
      if (r.isDefault || r.managed || !outranks(g.standing, r.position ?? 0)) return deny();
    }
    updates.roles = patch.roles;
  }
  if (patch.deaf !== undefined) {
    if (!standingHas(g.standing, P.DEAFEN_MEMBERS)) return deny();
    updates.deaf = patch.deaf;
  }
  if (patch.mute !== undefined) {
    if (!standingHas(g.standing, P.MUTE_MEMBERS)) return deny();
    updates.mute = patch.mute;
  }
  if (patch.communication_disabled_until !== undefined) {
    if (!standingHas(g.standing, P.MODERATE_MEMBERS) || targetIsOwner || isSelf || !targetOutranked) return deny();
    updates.communicationDisabledUntil = patch.communication_disabled_until ? new Date(patch.communication_disabled_until as string) : undefined;
  }
  const updated = await ServerMember.updateById(member.id, updates);
  // Server mute/deafen take effect in voice right away (lazy: voice.ts pulls
  // in the realtime buses).
  if (updates.mute !== undefined || updates.deaf !== undefined) {
    void import('./voice')
      .then((m) => m.applyServerVoiceState(params.guildId, member.userId, {
        mute: updates.mute as boolean | undefined,
        deaf: updates.deaf as boolean | undefined,
      }))
      .catch(() => {});
  }

  const user = await User.findById(params.userId);
  return formatMember(updated || member, user);
})
.patch('/guilds/:guildId/members/@me/nick', async ({ headers, params, body, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  const member = await ServerMember.findOne({ serverId: params.guildId, userId: auth.botUser.id });
  if (!member) { set.status = 404; return { code: 10007, message: 'Unknown Member' }; }

  const { nick } = body as { nick?: string };
  await ServerMember.updateById(member.id, { nickname: nick });
  return nick;
})
.delete('/guilds/:guildId/members/:userId', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  if (!isValidObjectId(params.guildId) || !isValidObjectId(params.userId)) {
    set.status = 404; return { code: 10007, message: 'Unknown Member' };
  }
  const g = await requireBotPerm(params.guildId, auth.botUser.id, P.KICK_MEMBERS);
  if (!g.ok) { set.status = g.status; return g.body; }
  if (compareIds(g.server.ownerId, params.userId)) { set.status = 403; return MISSING_PERMISSIONS; }
  const member = await ServerMember.findOne({ serverId: params.guildId, userId: params.userId });
  if (!member) { set.status = 404; return { code: 10007, message: 'Unknown Member' }; }
  if (!outranks(g.standing, memberTopPosition(g.roles, (member.roles || []) as string[]))) {
    set.status = 403; return MISSING_PERMISSIONS;
  }
  // Only decrements memberCount (atomically) when a member was really removed.
  await removeServerMember(params.guildId, params.userId);
  botAudit(params.guildId, auth.botUser.id, AuditLogEvent.MEMBER_KICK, params.userId, headers);
  set.status = 204;
  return '';
})

// ─── Guild Bans ────────────────────────────────────────────
.put('/guilds/:guildId/bans/:userId', async ({ headers, params, body, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  if (!isValidObjectId(params.guildId) || !isValidObjectId(params.userId)) {
    set.status = 404; return { code: 10004, message: 'Unknown Guild' };
  }
  const g = await requireBotPerm(params.guildId, auth.botUser.id, P.BAN_MEMBERS);
  if (!g.ok) { set.status = g.status; return g.body; }
  if (compareIds(g.server.ownerId, params.userId) || compareIds(params.userId, auth.botUser.id)) {
    set.status = 403; return MISSING_PERMISSIONS;
  }
  const { reason } = (body ?? {}) as { reason?: string };

  // Respect role hierarchy before touching the member
  const member = await ServerMember.findOne({ serverId: params.guildId, userId: params.userId });
  if (member && !outranks(g.standing, memberTopPosition(g.roles, (member.roles || []) as string[]))) {
    set.status = 403; return MISSING_PERMISSIONS;
  }
  // Create or update the ban (re-banning is idempotent, like Discord's PUT)
  await upsertServerBan(params.guildId, params.userId, auth.botUser.id, reason ?? null);
  // Remove member if exists; memberCount only changes when a row was deleted
  await removeServerMember(params.guildId, params.userId);
  botAudit(params.guildId, auth.botUser.id, AuditLogEvent.MEMBER_BAN_ADD, params.userId, headers, reason);
  set.status = 204;
  return '';
})
.get('/guilds/:guildId/bans/:userId', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  const g = await requireBotPerm(params.guildId, auth.botUser.id, P.BAN_MEMBERS);
  if (!g.ok) { set.status = g.status; return g.body; }
  if (!isValidObjectId(params.userId)) { set.status = 404; return { code: 10026, message: 'Unknown Ban' }; }
  const ban = await ServerBan.findOne({ serverId: params.guildId, userId: params.userId });
  if (!ban) { set.status = 404; return { code: 10026, message: 'Unknown Ban' }; }
  return { reason: ban.reason ?? null, user: { id: ban.userId } };
})
.delete('/guilds/:guildId/bans/:userId', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  const g = await requireBotPerm(params.guildId, auth.botUser.id, P.BAN_MEMBERS);
  if (!g.ok) { set.status = g.status; return g.body; }

  const ban = await ServerBan.findOne({ serverId: params.guildId, userId: params.userId });
  if (ban) {
    await ServerBan.deleteById(ban.id);
    botAudit(params.guildId, auth.botUser.id, AuditLogEvent.MEMBER_BAN_REMOVE, params.userId, headers);
  }
  set.status = 204;
  return '';
})

// ─── Guild Emoji CRUD ──────────────────────────────────────
.get('/guilds/:guildId/emojis/:emojiId', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  if (!isValidObjectId(params.emojiId)) { set.status = 404; return { code: 10011, message: 'Unknown Emoji' }; }
  const emoji = await ServerEmoji.findById(params.emojiId);
  if (!emoji || !compareIds(emoji.serverId, params.guildId)) { set.status = 404; return { code: 10014, message: 'Unknown Emoji' }; }
  return {
    id: emoji.id,
    name: emoji.name,
    roles: [],
    user: null,
    require_colons: true,
    managed: false,
    animated: emoji.animated ?? false,
    available: true,
  };
})
.post('/guilds/:guildId/emojis', async ({ headers, params, body, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  if (!isValidObjectId(params.guildId)) { set.status = 404; return { code: 10004, message: 'Unknown Guild' }; }
  const g = await requireBotPerm(params.guildId, auth.botUser.id, P.MANAGE_EMOJIS_AND_STICKERS);
  if (!g.ok) { set.status = g.status; return g.body; }
  const { name, image, roles } = body as { name?: string; image?: string; roles?: string[] };
  if (!name || !image) { set.status = 400; return { code: 50035, message: 'Name and image are required' }; }

  const emoji = await ServerEmoji.create({
    serverId: params.guildId,
    name,
    imageUrl: image,
    animated: image.startsWith('data:image/gif'),
    available: true,
    managed: false,
    requireColons: true,
    roles: [],
    uploadedBy: auth.botUser.id,
  });
  return {
    id: emoji.id,
    name: emoji.name,
    roles: [],
    user: null,
    require_colons: true,
    managed: false,
    animated: emoji.animated,
    available: true,
  };
})
.patch('/guilds/:guildId/emojis/:emojiId', async ({ headers, params, body, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  const emoji = isValidObjectId(params.emojiId) ? await ServerEmoji.findById(params.emojiId) : null;
  if (!emoji || !compareIds(emoji.serverId, params.guildId)) { set.status = 404; return { code: 10014, message: 'Unknown Emoji' }; }
  const g = await requireBotPerm(params.guildId, auth.botUser.id, P.MANAGE_EMOJIS_AND_STICKERS);
  if (!g.ok) { set.status = g.status; return g.body; }

  const { name, roles } = body as { name?: string; roles?: string[] };
  const updates: Record<string, unknown> = {};
  if (name !== undefined) updates.name = name;
  const updated = await ServerEmoji.updateById(params.emojiId, updates);
  const result = updated || emoji;
  return {
    id: result.id,
    name: result.name,
    roles: [],
    user: null,
    require_colons: true,
    managed: false,
    animated: result.animated,
    available: true,
  };
})
.delete('/guilds/:guildId/emojis/:emojiId', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  const emoji = isValidObjectId(params.emojiId) ? await ServerEmoji.findById(params.emojiId) : null;
  if (!emoji || !compareIds(emoji.serverId, params.guildId)) { set.status = 404; return { code: 10014, message: 'Unknown Emoji' }; }
  const g = await requireBotPerm(params.guildId, auth.botUser.id, P.MANAGE_EMOJIS_AND_STICKERS);
  if (!g.ok) { set.status = g.status; return g.body; }
  await ServerEmoji.deleteById(params.emojiId);
  set.status = 204;
  return '';
})

// ─── Guild Stickers ────────────────────────────────────────
.get('/guilds/:guildId/stickers', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  if (!isValidObjectId(params.guildId)) { set.status = 404; return { code: 10004, message: 'Unknown Guild' }; }
  const stickers = await ServerSticker.find({ serverId: params.guildId });
  return stickers.map((s: any) => ({
    id: s.id,
    name: s.name,
    description: s.description ?? null,
    tags: s.tags ?? [],
    type: 1,
    format_type: 1,
    available: s.available ?? true,
    guild_id: params.guildId,
    user: null,
  }));
})
.get('/guilds/:guildId/stickers/:stickerId', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  if (!isValidObjectId(params.stickerId)) { set.status = 404; return { code: 10011, message: 'Unknown Sticker' }; }
  const sticker = await ServerSticker.findById(params.stickerId);
  // Only stickers of this guild (the guard checked membership of :guildId, not of the sticker's guild).
  if (!sticker || !compareIds(sticker.serverId, params.guildId)) { set.status = 404; return { code: 10060, message: 'Unknown Sticker' }; }
  return {
    id: sticker.id,
    name: sticker.name,
    description: sticker.description ?? null,
    tags: sticker.tags ?? [],
    type: 1,
    format_type: 1,
    available: sticker.available ?? true,
    guild_id: params.guildId,
    user: null,
  };
})

// ─── Guild Webhooks ────────────────────────────────────────
.get('/guilds/:guildId/webhooks', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  if (!isValidObjectId(params.guildId)) { set.status = 404; return { code: 10004, message: 'Unknown Guild' }; }
  const g = await requireBotPerm(params.guildId, auth.botUser.id, P.MANAGE_WEBHOOKS);
  if (!g.ok) { set.status = g.status; return g.body; }
  const { serializeWebhook, mayShowWebhookToken } = await import('@/lib/services/channelWebhooks');
  const webhooks = await ChannelWebhook.find({ serverId: params.guildId });
  return webhooks.map((w) => serializeWebhook(w, { withToken: mayShowWebhookToken(w, auth.app.id) }));
})
.get('/channels/:channelId/webhooks', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  // MANAGE_WEBHOOKS in this channel (overwrites apply); never in DMs.
  const c = await requireChannelAction(params.channelId, auth.botUser.id, 'manage_webhooks');
  if (!c.ok) { set.status = c.status; return c.body; }
  const channel = c.channel;
  if (!channel.serverId) { set.status = 403; return MISSING_PERMISSIONS; }
  const { serializeWebhook, mayShowWebhookToken } = await import('@/lib/services/channelWebhooks');
  const webhooks = await ChannelWebhook.find({ channelId: params.channelId });
  return webhooks.map((w) => serializeWebhook(w, { withToken: mayShowWebhookToken(w, auth.app.id) }));
})
.post('/channels/:channelId/webhooks', async ({ headers, params, body, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  // MANAGE_WEBHOOKS in this channel (overwrites apply); never in DMs.
  const c = await requireChannelAction(params.channelId, auth.botUser.id, 'manage_webhooks');
  if (!c.ok) { set.status = c.status; return c.body; }
  const channel = c.channel;
  if (!channel.serverId) { set.status = 403; return MISSING_PERMISSIONS; }

  const { name, avatar } = (body ?? {}) as { name?: unknown; avatar?: unknown };
  const { cleanWebhookUsername, cleanWebhookAvatarUrl } = await import('@/lib/chat/webhook');
  const cleanName = cleanWebhookUsername(name);
  if (!cleanName) { set.status = 400; return { code: 50035, message: 'Invalid Form Body', errors: { name: { _errors: [{ code: 'BASE_TYPE_BAD_LENGTH', message: 'Must be between 1 and 80 in length.' }] } } }; }
  if (/clyde|discord/i.test(cleanName)) { set.status = 400; return { code: 50035, message: 'Invalid Form Body', errors: { name: { _errors: [{ code: 'USERNAME_INVALID_CONTAINS', message: 'Username cannot contain "clyde" or "discord"' }] } } }; }

  const token = crypto.randomBytes(34).toString('base64url');
  const { serializeWebhook, webhookUrl } = await import('@/lib/services/channelWebhooks');
  const created = await ChannelWebhook.create({
    channelId: params.channelId,
    serverId: channel.serverId ?? undefined,
    name: cleanName,
    avatar: typeof avatar === 'string' ? cleanWebhookAvatarUrl(avatar) : null,
    token,
    url: 'pending',
    creatorId: auth.botUser.id,
    applicationId: auth.app.id,
  });
  const webhook = (await ChannelWebhook.updateById(created.id, { url: webhookUrl(created) })) ?? created;
  return serializeWebhook(webhook, { withToken: true, user: formatUser(auth.botUser) });
})
.get('/webhooks/:webhookId', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  if (!isValidObjectId(params.webhookId)) { set.status = 404; return { code: 10015, message: 'Unknown Webhook' }; }
  const webhook = await ChannelWebhook.findById(params.webhookId);
  if (!webhook) { set.status = 404; return { code: 10015, message: 'Unknown Webhook' }; }
  // Only webhooks in a server the bot is in; the token only for its own
  // webhooks or with Manage Webhooks.
  const isCreator = !!webhook.creatorId && compareIds(webhook.creatorId, auth.botUser.id);
  let canManage = false;
  if (webhook.serverId) {
    const g = await loadBotGuild(webhook.serverId, auth.botUser.id);
    if (!g.ok && !isCreator) { set.status = 404; return { code: 10015, message: 'Unknown Webhook' }; }
    canManage = g.ok && standingHas(g.standing, P.MANAGE_WEBHOOKS);
  } else if (!isCreator) {
    set.status = 404; return { code: 10015, message: 'Unknown Webhook' };
  }
  const creator = webhook.creatorId ? await User.findById(webhook.creatorId) : null;
  const { serializeWebhook, mayShowWebhookToken } = await import('@/lib/services/channelWebhooks');
  return serializeWebhook(webhook, { withToken: (isCreator || canManage) && mayShowWebhookToken(webhook, auth.app.id), user: creator ? formatUser(creator) : undefined });
})
.patch('/webhooks/:webhookId', async ({ headers, params, body, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  if (!isValidObjectId(params.webhookId)) { set.status = 404; return { code: 10015, message: 'Unknown Webhook' }; }
  const webhook = await ChannelWebhook.findById(params.webhookId);
  if (!webhook || !webhook.serverId) { set.status = 404; return { code: 10015, message: 'Unknown Webhook' }; }
  // MANAGE_WEBHOOKS in the webhook's channel; moving it also needs it in the target channel (same guild).
  const c = await requireChannelAction(webhook.channelId, auth.botUser.id, 'manage_webhooks');
  if (!c.ok) { set.status = c.status === 403 ? 403 : 404; return c.status === 403 ? c.body : { code: 10015, message: 'Unknown Webhook' }; }
  const { patchWebhook } = await import('@/lib/services/channelWebhooks');
  const result = await patchWebhook(webhook, body, {
    allowChannel: async (channelId) => {
      const target = await requireChannelAction(channelId, auth.botUser.id, 'manage_webhooks');
      return target.ok && compareIds(target.channel.serverId ?? '', webhook.serverId ?? '') && target.channel.type !== 'category';
    },
  });
  return respond(set, result);
})
.delete('/webhooks/:webhookId', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  if (!isValidObjectId(params.webhookId)) { set.status = 404; return { code: 10015, message: 'Unknown Webhook' }; }
  const webhook = await ChannelWebhook.findById(params.webhookId);
  if (!webhook) { set.status = 404; return { code: 10015, message: 'Unknown Webhook' }; }
  const isCreator = !!webhook.creatorId && compareIds(webhook.creatorId, auth.botUser.id);
  if (!isCreator) {
    const g = webhook.serverId ? await loadBotGuild(webhook.serverId, auth.botUser.id) : null;
    if (!g || !g.ok) { set.status = 404; return { code: 10015, message: 'Unknown Webhook' }; }
    if (!standingHas(g.standing, P.MANAGE_WEBHOOKS)) { set.status = 403; return MISSING_PERMISSIONS; }
  }
  await ChannelWebhook.deleteById(params.webhookId);
  set.status = 204;
  return '';
})

// ─── Webhook router (token routes, no bot auth) ────────────
// /webhooks/{id}/{token} is either a channel webhook (id = webhook id, token
// compared in constant time) or an interaction (id = application id, token =
// interaction token: followups and @original). Interaction tokens are tried
// first; they're random 64-byte values looked up by hash.
.post('/webhooks/:webhookId/:webhookToken', async ({ params, body, query, request, set }) => {
  const { resolveInteractionWebhook, createFollowup } = await import('@/lib/services/interactions');
  const ix = await resolveInteractionWebhook(params.webhookId, params.webhookToken);
  if (ix) return respond(set, await createFollowup(ix, body));
  const { findWebhookByToken, executeWebhook } = await import('@/lib/services/channelWebhooks');
  const webhook = await findWebhookByToken(params.webhookId, params.webhookToken);
  if (!webhook) { set.status = 404; return { code: 10015, message: 'Unknown Webhook' }; }
  const { wait, thread_id, with_components } = query as Record<string, string | undefined>;
  return respond(set, await executeWebhook(webhook, body, { wait, thread_id, with_components }, { ip: getClientIP(request) }));
})
.get('/webhooks/:webhookId/:webhookToken', async ({ params, set }) => {
  const { resolveInteractionWebhook } = await import('@/lib/services/interactions');
  const ix = await resolveInteractionWebhook(params.webhookId, params.webhookToken);
  if (ix) {
    const bot = await User.findById(ix.botId);
    return { id: ix.applicationId, type: 3, application_id: ix.applicationId, name: bot?.username ?? '', avatar: bot?.avatar ?? null, channel_id: ix.channelId, guild_id: ix.guildId };
  }
  const { findWebhookByToken, serializeWebhook } = await import('@/lib/services/channelWebhooks');
  const webhook = await findWebhookByToken(params.webhookId, params.webhookToken);
  if (!webhook) { set.status = 404; return { code: 10015, message: 'Unknown Webhook' }; }
  return serializeWebhook(webhook, { withToken: true });
})
.patch('/webhooks/:webhookId/:webhookToken', async ({ params, body, set }) => {
  const { findWebhookByToken, patchWebhook } = await import('@/lib/services/channelWebhooks');
  const webhook = await findWebhookByToken(params.webhookId, params.webhookToken);
  if (!webhook) { set.status = 404; return { code: 10015, message: 'Unknown Webhook' }; }
  return respond(set, await patchWebhook(webhook, body));
})
.delete('/webhooks/:webhookId/:webhookToken', async ({ params, set }) => {
  const { findWebhookByToken, deleteWebhook } = await import('@/lib/services/channelWebhooks');
  const webhook = await findWebhookByToken(params.webhookId, params.webhookToken);
  if (!webhook) { set.status = 404; return { code: 10015, message: 'Unknown Webhook' }; }
  return respond(set, await deleteWebhook(webhook));
})
.get('/webhooks/:webhookId/:webhookToken/messages/@original', async ({ params, set }) => {
  const { resolveInteractionWebhook, getInteractionMessage } = await import('@/lib/services/interactions');
  const ix = await resolveInteractionWebhook(params.webhookId, params.webhookToken);
  if (!ix) { set.status = 404; return { code: 10015, message: 'Unknown Webhook' }; }
  return respond(set, await getInteractionMessage(ix, '@original'));
})
.patch('/webhooks/:webhookId/:webhookToken/messages/@original', async ({ params, body, set }) => {
  const { resolveInteractionWebhook, editInteractionMessage } = await import('@/lib/services/interactions');
  const ix = await resolveInteractionWebhook(params.webhookId, params.webhookToken);
  if (!ix) { set.status = 404; return { code: 10015, message: 'Unknown Webhook' }; }
  return respond(set, await editInteractionMessage(ix, '@original', body));
})
.delete('/webhooks/:webhookId/:webhookToken/messages/@original', async ({ params, set }) => {
  const { resolveInteractionWebhook, deleteInteractionMessage } = await import('@/lib/services/interactions');
  const ix = await resolveInteractionWebhook(params.webhookId, params.webhookToken);
  if (!ix) { set.status = 404; return { code: 10015, message: 'Unknown Webhook' }; }
  return respond(set, await deleteInteractionMessage(ix, '@original'));
})
.get('/webhooks/:webhookId/:webhookToken/messages/:messageId', async ({ params, query, set }) => {
  const { resolveInteractionWebhook, getInteractionMessage } = await import('@/lib/services/interactions');
  const ix = await resolveInteractionWebhook(params.webhookId, params.webhookToken);
  if (ix) return respond(set, await getInteractionMessage(ix, params.messageId));
  const { findWebhookByToken, getWebhookMessage } = await import('@/lib/services/channelWebhooks');
  const webhook = await findWebhookByToken(params.webhookId, params.webhookToken);
  if (!webhook) { set.status = 404; return { code: 10015, message: 'Unknown Webhook' }; }
  const { thread_id } = query as Record<string, string | undefined>;
  return respond(set, await getWebhookMessage(webhook, params.messageId, thread_id));
})
.patch('/webhooks/:webhookId/:webhookToken/messages/:messageId', async ({ params, body, query, request, set }) => {
  const { resolveInteractionWebhook, editInteractionMessage } = await import('@/lib/services/interactions');
  const ix = await resolveInteractionWebhook(params.webhookId, params.webhookToken);
  if (ix) return respond(set, await editInteractionMessage(ix, params.messageId, body));
  const { findWebhookByToken, editWebhookMessage } = await import('@/lib/services/channelWebhooks');
  const webhook = await findWebhookByToken(params.webhookId, params.webhookToken);
  if (!webhook) { set.status = 404; return { code: 10015, message: 'Unknown Webhook' }; }
  const { thread_id, with_components } = query as Record<string, string | undefined>;
  return respond(set, await editWebhookMessage(webhook, params.messageId, body, { thread_id, with_components }, { ip: getClientIP(request) }));
})
.delete('/webhooks/:webhookId/:webhookToken/messages/:messageId', async ({ params, query, set }) => {
  const { resolveInteractionWebhook, deleteInteractionMessage } = await import('@/lib/services/interactions');
  const ix = await resolveInteractionWebhook(params.webhookId, params.webhookToken);
  if (ix) return respond(set, await deleteInteractionMessage(ix, params.messageId));
  const { findWebhookByToken, deleteWebhookMessage } = await import('@/lib/services/channelWebhooks');
  const webhook = await findWebhookByToken(params.webhookId, params.webhookToken);
  if (!webhook) { set.status = 404; return { code: 10015, message: 'Unknown Webhook' }; }
  const { thread_id } = query as Record<string, string | undefined>;
  return respond(set, await deleteWebhookMessage(webhook, params.messageId, thread_id));
})

// ─── Audit Log ─────────────────────────────────────────────
.get('/guilds/:guildId/audit-logs', async ({ headers, params, query, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  if (!isValidObjectId(params.guildId)) { set.status = 404; return { code: 10004, message: 'Unknown Guild' }; }
  // Discord requires VIEW_AUDIT_LOG (this used to return any guild's log).
  const g = await requireBotPerm(params.guildId, auth.botUser.id, P.VIEW_AUDIT_LOG);
  if (!g.ok) { set.status = g.status; return g.body; }
  const { listAuditLogs, toDiscordEntry } = await import('@/lib/services/auditLog');
  const limit = Math.min(parseInt(query.limit as string) || 50, 100);
  const actionType = query.action_type !== undefined ? Number(query.action_type) : null;
  const entries = await listAuditLogs(params.guildId, {
    userId: typeof query.user_id === 'string' ? query.user_id : null,
    actionType: Number.isFinite(actionType) ? actionType : null,
    limit,
  });
  return {
    audit_log_entries: entries.map(toDiscordEntry),
    users: [],
    webhooks: [],
    threads: [],
    integrations: [],
    application_commands: [],
    auto_moderation_rules: [],
    guild_scheduled_events: [],
  };
})

// ─── User DMs ──────────────────────────────────────────────
.get('/users/@me/channels', async ({ headers, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  // Filtered in SQL (type + recipient array containment); both keys are in the
  // Channel.find whitelist, so the filter can't be silently dropped.
  const dmChannels = await Channel.find({ type: { in: ['dm', 'group_dm'] }, recipientId: auth.botUser.id });
  return dmChannels
    .filter((c: IChannel) => ((c.recipientIds || []) as string[]).some((r) => compareIds(r, auth.botUser.id)))
    .map(formatChannel);
})
.post('/users/@me/channels', async ({ headers, body, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  const { recipient_id } = body as { recipient_id?: string };
  if (!recipient_id || !isValidObjectId(recipient_id)) {
    set.status = 400; return { code: 50035, message: 'Invalid recipient_id' };
  }

  // Existing 1:1 DM between the two (type + recipientIds are whitelisted filter keys).
  let dm: IChannel | null = await Channel.findOne({ type: 'dm', recipientIds: [auth.botUser.id, recipient_id] });
  if (dm && !((dm.recipientIds || []) as string[]).some((r) => compareIds(r, recipient_id))) dm = null;

  if (!dm) {
    // A bot may only open a DM with someone who shares a server with it, has
    // not blocked it, and accepts DMs from non-friends.
    const recipient = await User.findById(recipient_id);
    if (!recipient) { set.status = 404; return { code: 10013, message: 'Unknown User' }; }
    const blocked = ((recipient.blockedUsers as string[] | undefined) ?? []).includes(auth.botUser.id);
    const [botMemberships, recipientMemberships] = await Promise.all([
      ServerMember.find({ userId: auth.botUser.id }),
      ServerMember.find({ userId: recipient_id }),
    ]);
    const botServers = new Set(botMemberships.map((m: { serverId: string }) => String(m.serverId)));
    const sharesServer = recipientMemberships.some((m: { serverId: string }) => botServers.has(String(m.serverId)));
    if (blocked || !sharesServer || !acceptsDmsFromNonFriends(recipient.settings as Parameters<typeof acceptsDmsFromNonFriends>[0])) {
      set.status = 403; return { code: 50007, message: 'Cannot send messages to this user' };
    }
    dm = await Channel.create({
      type: 'dm',
      recipientIds: [auth.botUser.id, recipient_id],
      name: '',
      position: 0,
      rateLimitPerUser: 0,
      nsfw: false,
      bitrate: 0,
      userLimit: 0,
      permissionOverwrites: [],
    });
  }
  return formatChannel(dm);
})

// ─── Leave Guild ───────────────────────────────────────────
.delete('/users/@me/guilds/:guildId', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  if (!isValidObjectId(params.guildId)) { set.status = 404; return { code: 10004, message: 'Unknown Guild' }; }
  await removeServerMember(params.guildId, auth.botUser.id);
  set.status = 204;
  return '';
})

// ─── Voice Regions ─────────────────────────────────────────
.get('/voice/regions', async ({ headers, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  return [
    { id: 'us-west', name: 'US West', optimal: false, deprecated: false, custom: false },
    { id: 'us-east', name: 'US East', optimal: false, deprecated: false, custom: false },
    { id: 'eu-central', name: 'EU Central', optimal: false, deprecated: false, custom: false },
    { id: 'eu-west', name: 'EU West', optimal: false, deprecated: false, custom: false },
    { id: 'japan', name: 'Japan', optimal: false, deprecated: false, custom: false },
    { id: 'singapore', name: 'Singapore', optimal: false, deprecated: false, custom: false },
  ];
});

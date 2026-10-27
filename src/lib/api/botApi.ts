import { Elysia, t } from 'elysia';
import { buildPollView, fromDiscordPollRequest, isPollClosed, normalizePollInput, parseStoredPoll, type StoredPoll } from '@/lib/chat/polls';
import { acceptsDmsFromNonFriends } from '@/lib/settings/privacy';
import { ChannelWebhook, type IApplication } from '@/lib/models';
import { addReaction, removeReaction, type StoredReaction } from '@/lib/chat/reactionMutations';
import { Channel, Message, Server, ServerMember, Role, User, ServerEmoji, ServerSticker, Invite, ServerBan, type IMessage, type IChannel } from '@/lib/models';
import { FormErrors } from '@/lib/botapi/formErrors';
import { IS_COMPONENTS_V2, componentsPlainText, componentsV2Conflicts, isComponentsV2, parseStoredComponents, resolveAttachmentRefs, validateMessageComponents } from '@/lib/botapi/components';
import { nanoid } from 'nanoid';
import { BoundedMap } from '@/lib/utils/boundedMap';
import { config } from '@/lib/config';
import { normalizeId } from '@/lib/db/normalizeId';
import { removeServerBan, removeServerMember, upsertServerBan } from '@/lib/services/serverMembership';
import { PERMISSION_BITS as P, hasPermission } from '@/lib/permissions/bits';
import {
  computeGuildStanding, standingHas, memberTopPosition, outranks, canGrantBits, parseBitfield,
  type BotGuildStanding,
} from '@/lib/permissions/botGuild';
import type { IServer, IRole, IServerSettings } from '@/lib/models';
import { isSilentMessage, MESSAGE_FLAGS, sendFlags } from '@/lib/chat/messageFlags';
import { normalizeVoiceMessage } from '@/lib/chat/voiceMessage';
import { audit } from '@/lib/services/auditLog';
import { AuditLogEvent, GUILD_AUDIT_KEYS, ROLE_AUDIT_KEYS, auditReason, diffChanges, diffMemberRoles, snapshotChanges } from '@/lib/audit/auditLog';
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
// Guild resources (WP4a): guild, channels, overwrites, roles, members, bans.
import { toDiscordEmoji, toDiscordGuildBase, toDiscordGuildMember, toDiscordSticker, type MemberRowLike, type UserRowLike } from '@/lib/services/gatewayEvents';
import { db, schema } from '@/lib/db/postgres';
import { and, asc, desc, eq, gt, ilike, inArray, lt, or, sql } from 'drizzle-orm';
import {
  applyChannelPositions, applyRolePositions, changedOverwriteBits, isPrunable, likePrefix,
  overwriteBits, parseBulkBan, parseChannelFields, parseChannelPositions, parseDeleteMessageSeconds, parseGuildFields,
  parseLimit as parseListLimit, parseOverwrite, parsePruneOptions, parseRoleFields, parseRolePositions, type ChannelFields,
} from '@/lib/botapi/guildResources';
import { FormErrors as GuildFormErrors } from '@/lib/botapi/formErrors';
import { decodeImageDataUri, uploadBotImage } from '@/lib/botapi/imageData';
import * as guildEvents from '@/lib/services/guildGatewayEvents';
import { deleteGuildChannel, purgeMemberMessages, updateGuildChannel } from '@/lib/services/guildOps';
import { sanitizeInput } from '@/lib/security';
import { normalizeOverwrites, type EditableOverwrite } from '@/lib/permissions/overwriteEditor';
import { invalidateRolePerms, getActorRoleContext } from '@/lib/permissions/serverPermissions';
import { checkRoleReorder, type HierarchyRole } from '@/lib/permissions/roleHierarchy';
import { normalizeRoleIconInput } from '@/lib/roles/roleIcon';
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
import { expandLinkedRoles, readRoleLinks } from '@/lib/roles/roleLinks';
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

// ─── OAuth2 Bearer auth (WP6) ──────────────────────────────
// `Authorization: Bearer <access token>` from the OAuth2 flows
// (src/lib/services/oauth2Tokens.ts) is accepted only where Discord accepts
// it: users/@me (identify), users/@me/guilds (guilds), users/@me/guilds/{id}/member
// (guilds.members.read), users/@me/connections (connections), oauth2/@me and
// the application command routes (applications.commands.update /
// applications.commands.permissions.update). Never on anything else.

type BearerAuth = { grant: import('@/lib/services/oauth2Tokens').OAuthGrant; user: NonNullable<Awaited<ReturnType<typeof User.findById>>>; app: IApplication };
const bearerMemo = new WeakMap<object, Promise<BearerAuth | null>>();

function authenticateBearer(headers: Record<string, string | undefined>): Promise<BearerAuth | null> {
  const memo = bearerMemo.get(headers);
  if (memo) return memo;
  const p = (async () => {
    const { parseBearer } = await import('@/lib/oauth/scopes');
    const token = parseBearer(headers.authorization);
    if (!token) return null;
    const { resolveBearerToken } = await import('@/lib/services/oauth2Tokens');
    const grant = await resolveBearerToken(token);
    if (!grant) return null;
    const { Application } = await import('@/lib/models');
    const [user, app] = await Promise.all([User.findById(grant.userId), Application.findById(grant.applicationId)]);
    if (!user || !app || user.isBanned) return null;
    return { grant, user, app };
  })();
  bearerMemo.set(headers, p);
  return p;
}

/** A Bearer caller with `scope`, or the Discord error to answer (401 no/invalid token, 403 missing scope). */
async function requireBearerScope(headers: Record<string, string | undefined>, scope: string): Promise<{ ok: true; auth: BearerAuth } | { ok: false; status: number; body: { code: number; message: string } }> {
  const auth = await authenticateBearer(headers);
  if (!auth) return { ok: false, status: 401, body: { code: 0, message: '401: Unauthorized' } };
  if (!auth.grant.scopes.includes(scope)) return { ok: false, status: 403, body: { code: 50026, message: 'Missing required OAuth2 scope' } };
  return { ok: true, auth };
}

/** The user object an OAuth2 app sees (`email` only with the email scope). */
function formatOAuthUser(user: Parameters<typeof formatUser>[0], scopes: readonly string[]) {
  const out = { ...formatUser(user), locale: 'en-US' } as Record<string, unknown>;
  delete out.created_at;
  if (scopes.includes('email')) {
    out.email = user.email ?? null;
    out.verified = user.isVerified ?? false;
  } else {
    delete out.email;
    delete out.verified;
  }
  return out;
}

/**
 * Who may call an application command route: the app's own bot, a
 * client_credentials Bearer token of that app with applications.commands.update,
 * or (permissions writes) a user's token with
 * applications.commands.permissions.update. Returns the app.
 */
async function authenticateCommandsCaller(
  headers: Record<string, string | undefined>,
  mode: 'read' | 'write' | 'permissions',
): Promise<{ app: IApplication; bearer: BearerAuth | null } | null> {
  const bot = await authenticateBot(headers);
  if (bot) return { app: bot.app, bearer: null };
  const bearer = await authenticateBearer(headers);
  if (!bearer) return null;
  // Managing commands: client_credentials tokens only (a user's consent must
  // never let them edit someone else's app); permissions: a user's token.
  const { commandsGrantOk } = await import('@/lib/oauth/scopes');
  if (!commandsGrantOk(bearer.grant, mode)) return null;
  return { app: bearer.app, bearer };
}

/**
 * Guild command routes with a Bearer token (the access guard only covers bot
 * tokens): the app's bot must be in the guild, and permission writes need a
 * user who can manage the guild and its roles (Discord).
 */
async function bearerGuildCommandsCheck(caller: { app: IApplication; bearer: BearerAuth | null }, guildId: string, mode: 'read' | 'write' | 'permissions'): Promise<{ status: number; body: ApiError } | null> {
  if (!caller.bearer) return null;
  if (!isValidObjectId(guildId)) return { status: 404, body: { code: 10004, message: 'Unknown Guild' } };
  if (!caller.app.botId || !(await ServerMember.findOne({ serverId: guildId, userId: caller.app.botId }))) return { status: 403, body: MISSING_ACCESS };
  if (mode !== 'permissions') return null;
  const g = await loadBotGuild(guildId, caller.bearer.user.id);
  if (!g.ok) return { status: g.status, body: g.body };
  if (!standingHas(g.standing, P.MANAGE_SERVER | P.MANAGE_ROLES)) return { status: 403, body: MISSING_PERMISSIONS };
  return null;
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

/**
 * Run a bot API route in-process as the same bot (forum posts send their
 * first message through POST /channels/{thread}/messages, so it gets every
 * check, file upload and event a normal send does). The response is in the
 * app's id format already; the outer boundary leaves it as is. (Only message
 * routes may go through here: their bodies carry no permission bitfields,
 * whose Discord <-> Serika permutation, unlike id rewriting, isn't idempotent.)
 */
async function internalBotRequest(
  request: Request,
  method: string,
  path: string,
  payload: Record<string, unknown>,
  files: Array<{ index: number; file: FileLike }>,
): Promise<{ status: number; body: unknown }> {
  const headers = new Headers();
  for (const k of ['authorization', 'user-agent', 'x-forwarded-for', 'x-real-ip', 'cf-connecting-ip']) {
    const v = request.headers.get(k);
    if (v) headers.set(k, v);
  }
  let reqBody: BodyInit;
  if (files.length > 0) {
    const form = new FormData();
    form.set('payload_json', JSON.stringify(payload));
    for (const f of files) form.set(`files[${f.index}]`, f.file as unknown as Blob, (f.file as { name?: string }).name || `file${f.index}`);
    reqBody = form;
  } else {
    headers.set('content-type', 'application/json');
    reqBody = JSON.stringify(payload);
  }
  const origin = new URL(request.url).origin;
  const res = await botApiRoutes.handle(new Request(`${origin}/v10${path}`, { method, headers, body: reqBody }));
  const text = await res.text();
  let parsed: unknown = '';
  try { parsed = text ? JSON.parse(text) : ''; } catch { parsed = text; }
  return { status: res.status, body: parsed };
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

/**
 * Discord guild object (GET/PATCH /guilds/{id}): every top-level field, the
 * roles (lowest first), emojis and stickers; `approximate_*` counts only with
 * `with_counts` (Discord).
 */
async function formatGuild(server: IServer, opts: { withCounts?: boolean } = {}) {
  const [roles, emojis, stickers, counts] = await Promise.all([
    Role.find({ serverId: server.id }).catch(() => [] as IRole[]),
    ServerEmoji.find({ serverId: server.id }).catch(() => []),
    ServerSticker.find({ serverId: server.id }).catch(() => []),
    opts.withCounts ? guildCounts(server.id) : Promise.resolve(null),
  ]);
  const widget = ((server.settings ?? {}) as { widget?: { enabled?: boolean; channelId?: string | null } }).widget;
  return {
    ...toDiscordGuildBase(server),
    widget_enabled: widget?.enabled === true,
    widget_channel_id: widget?.channelId ?? null,
    roles: [...roles].sort((a, b) => (a.isDefault ? -1 : b.isDefault ? 1 : (a.position ?? 0) - (b.position ?? 0))).map((r) => formatRole(r)),
    emojis: emojis.map((e) => toDiscordEmoji(e)),
    stickers: stickers.map((s) => toDiscordSticker(s)),
    ...(counts ? { approximate_member_count: counts.members, approximate_presence_count: counts.presences } : {}),
  };
}

/** Live member + online counts (with_counts). */
async function guildCounts(serverId: string): Promise<{ members: number; presences: number }> {
  const { computeOnlineCount } = await import('./servers');
  const [rows, presences] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(schema.serverMembers).where(eq(schema.serverMembers.serverId, normalizeId(serverId))),
    computeOnlineCount(serverId).catch(() => 0),
  ]);
  return { members: Number(rows[0]?.n ?? 0), presences };
}

function formatRole(role: any) {
  return toDiscordRole(role);
}

function formatMember(member: MemberRowLike, user: (UserRowLike & Record<string, unknown>) | null | undefined, everyoneRoleId?: string | null) {
  // Shared with the gateway (GUILD_MEMBER_*): @everyone is never listed in roles.
  return {
    ...toDiscordGuildMember(member, user ?? null, everyoneRoleId ?? null),
    ...(user ? { user: formatUser(user) } : {}),
  };
}

/** Members with their users (one query) and without @everyone in `roles`. */
async function presentMembers(serverId: string, members: Array<typeof schema.serverMembers.$inferSelect>) {
  if (members.length === 0) return [];
  const { getEveryoneRoleId } = await import('./channels');
  const ids = [...new Set(members.map((m) => m.userId))];
  const [users, everyone] = await Promise.all([
    db.select().from(schema.users).where(inArray(schema.users.id, ids)),
    getEveryoneRoleId(serverId).catch(() => null),
  ]);
  const byId = new Map(users.map((u) => [u.id, u]));
  return members.map((m) => formatMember(m, byId.get(m.userId) ?? null, everyone));
}

/** Discord ban objects ({ reason, user }) with full user objects (one query). */
async function presentBans(bans: Array<{ userId: string; reason?: string | null }>) {
  if (bans.length === 0) return [];
  const users = await db.select().from(schema.users).where(inArray(schema.users.id, [...new Set(bans.map((b) => b.userId))]));
  const byId = new Map(users.map((u) => [u.id, u]));
  return bans.map((b) => {
    const u = byId.get(b.userId);
    return { reason: b.reason ?? null, user: u ? formatUser(u) : { id: b.userId, username: '', discriminator: '0', global_name: null, avatar: null } };
  });
}

/** Discord order: @everyone first, then by position (ties by id, like Discord). */
function sortRoles<R extends { id: string; position?: number | null; isDefault?: boolean | null }>(roles: R[]): R[] {
  return [...roles].sort((a, b) => {
    if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
    return (a.position ?? 0) - (b.position ?? 0) || a.id.localeCompare(b.id);
  });
}

/** Caches the web app keeps per server (settings, gate) after a guild settings write. */
async function afterGuildChange(serverId: string) {
  const [{ cache }, { invalidateServerGate }] = await Promise.all([import('@/lib/db'), import('@/lib/services/serverGate')]);
  await cache.del(`server:${serverId}`).catch(() => {});
  await invalidateServerGate(serverId).catch(() => {});
}

/** widget.json is public: its counts are cached briefly per guild. */
const WIDGET_COUNTS_TTL_MS = 60_000;
const widgetCounts = new BoundedMap<string, { at: number; counts: { members: number; presences: number } }>(2000);

/** GET /guilds/{id}/regions (same static list as /voice/regions). */
const GUILD_VOICE_REGIONS = [
  { id: 'us-west', name: 'US West', optimal: false, deprecated: false, custom: false },
  { id: 'us-east', name: 'US East', optimal: false, deprecated: false, custom: false },
  { id: 'eu-central', name: 'EU Central', optimal: false, deprecated: false, custom: false },
  { id: 'eu-west', name: 'EU West', optimal: false, deprecated: false, custom: false },
  { id: 'japan', name: 'Japan', optimal: false, deprecated: false, custom: false },
  { id: 'singapore', name: 'Singapore', optimal: false, deprecated: false, custom: false },
];

// ─── Guild channel writes (WP4a) ───────────────────────────

type RouteSet = { status?: number | string; headers: Record<string, string | number> };
type Fail = { ok: false; status: number; body: unknown };

interface OverwriteContext {
  ok: true;
  channel: IChannel;
  roles: IRole[];
  standing: BotGuildStanding;
  /** The bot's resolved permissions in the channel. */
  perms: bigint;
}

/** A guild channel (not a thread) whose overwrites the bot may edit: VIEW_CHANNEL + MANAGE_ROLES (guild or channel). */
async function loadOverwriteContext(channelId: string, botId: string): Promise<OverwriteContext | Fail> {
  if (!isValidObjectId(channelId)) return { ok: false, status: 404, body: { code: 10003, message: 'Unknown Channel' } };
  const channel = await Channel.findById(channelId);
  if (!channel) return { ok: false, status: 404, body: { code: 10003, message: 'Unknown Channel' } };
  if (!channel.serverId || isThreadChannel(channel) || isDmChannel(channel)) {
    return { ok: false, status: 400, body: { code: 50024, message: 'Cannot execute action on this channel type' } };
  }
  const g = await loadBotGuild(channel.serverId, botId);
  if (!g.ok) return g;
  const perms = await botChannelPermissions(botId, channel);
  if (!hasPermission(perms, P.VIEW_CHANNEL)) return { ok: false, status: 403, body: MISSING_ACCESS };
  if (!standingHas(g.standing, P.MANAGE_ROLES) && !hasPermission(perms, P.MANAGE_ROLES)) {
    return { ok: false, status: 403, body: MISSING_PERMISSIONS };
  }
  return { ok: true, channel, roles: g.roles, standing: g.standing, perms };
}

/**
 * Discord: a bot may only allow or deny permissions it has itself in the
 * channel (owner and ADMINISTRATOR excepted), so it can't grant itself or
 * anyone more than it holds.
 */
function canSetOverwriteBits(ctx: { standing: BotGuildStanding; perms: bigint }, bits: bigint): boolean {
  if (ctx.standing.isOwner || hasPermission(ctx.standing.perms, P.ADMINISTRATOR)) return true;
  return (bits & ~ctx.perms) === 0n;
}

/**
 * An overwrite's target in Serika terms: role ids must be this guild's roles
 * (the guild id means @everyone, like Discord), member ids its members.
 */
async function resolveOverwriteTarget(
  serverId: string,
  roles: IRole[],
  o: EditableOverwrite,
): Promise<{ ok: true; overwrite: EditableOverwrite } | Fail> {
  if (!isValidObjectId(o.id)) return { ok: false, status: 404, body: o.type === 'role' ? { code: 10011, message: 'Unknown Role' } : { code: 10013, message: 'Unknown User' } };
  if (o.type === 'role') {
    const everyone = roles.find((r) => r.isDefault);
    if (everyone && compareIds(o.id, serverId)) return { ok: true, overwrite: { ...o, id: everyone.id } };
    const role = roles.find((r) => compareIds(r.id, o.id));
    if (!role) return { ok: false, status: 404, body: { code: 10011, message: 'Unknown Role' } };
    return { ok: true, overwrite: { ...o, id: role.id } };
  }
  const member = await ServerMember.findOne({ serverId, userId: o.id });
  if (!member) return { ok: false, status: 404, body: { code: 10013, message: 'Unknown User' } };
  return { ok: true, overwrite: { ...o, id: member.userId } };
}

/** Resolve every overwrite of a body list (ids, @everyone alias); one member query. */
async function resolveOverwriteList(serverId: string, roles: IRole[], list: EditableOverwrite[]): Promise<{ ok: true; list: EditableOverwrite[] } | Fail> {
  const out: EditableOverwrite[] = [];
  const memberIds = list.filter((o) => o.type === 'member').map((o) => o.id).filter(isValidObjectId);
  const members = memberIds.length
    ? await db.select({ userId: schema.serverMembers.userId }).from(schema.serverMembers)
      .where(and(eq(schema.serverMembers.serverId, normalizeId(serverId)), inArray(schema.serverMembers.userId, memberIds.map((id) => normalizeId(id)))))
    : [];
  const memberSet = new Set(members.map((m) => m.userId.toLowerCase()));
  const everyone = roles.find((r) => r.isDefault);
  for (const [i, o] of list.entries()) {
    if (o.type === 'role') {
      const id = everyone && compareIds(o.id, serverId) ? everyone.id : roles.find((r) => compareIds(r.id, o.id))?.id;
      if (!id) return { ok: false, status: 400, body: invalidFormBodyAt([{ path: ['permission_overwrites', i, 'id'], code: 'UNKNOWN_ROLE', message: 'Unknown role' }]) };
      out.push({ ...o, id });
    } else {
      if (!isValidObjectId(o.id) || !memberSet.has(normalizeId(o.id).toLowerCase())) {
        return { ok: false, status: 400, body: invalidFormBodyAt([{ path: ['permission_overwrites', i, 'id'], code: 'UNKNOWN_USER', message: 'Unknown member' }]) };
      }
      out.push({ ...o, id: normalizeId(o.id) });
    }
  }
  return { ok: true, list: out };
}

/**
 * Check a parsed channel body against the guild (parent category, overwrite
 * targets, permission rules) and turn it into column updates. `current` is
 * null on create; `perms` is the bot's permission set the overwrite bits are
 * checked against (channel permissions on edit, guild permissions on create).
 */
async function prepareChannelWrite(opts: {
  botId: string;
  g: Extract<BotGuildResult, { ok: true }>;
  current: IChannel | null;
  perms: bigint;
  fields: ChannelFields;
}): Promise<{ ok: true; updates: Partial<typeof schema.channels.$inferInsert> } | Fail> {
  const { botId, g, current, fields } = opts;
  const updates: Partial<typeof schema.channels.$inferInsert> = {};
  if (fields.name !== undefined) updates.name = fields.name;
  if (fields.type !== undefined) updates.type = fields.type;
  if (fields.topic !== undefined) updates.topic = fields.topic;
  if (fields.position !== undefined) updates.position = fields.position;
  if (fields.nsfw !== undefined) updates.nsfw = fields.nsfw;
  if (fields.rateLimitPerUser !== undefined) updates.rateLimitPerUser = fields.rateLimitPerUser;
  if (fields.bitrate !== undefined) updates.bitrate = fields.bitrate;
  if (fields.userLimit !== undefined) updates.userLimit = fields.userLimit;
  if (fields.rtcRegion !== undefined) updates.rtcRegion = fields.rtcRegion;
  if (fields.defaultAutoArchiveDuration !== undefined) updates.defaultAutoArchiveDuration = fields.defaultAutoArchiveDuration;

  if (fields.parentId !== undefined) {
    if (fields.parentId === null) updates.parentId = null;
    else {
      const parent = isValidObjectId(fields.parentId) ? await Channel.findById(fields.parentId) : null;
      if (!parent || parent.type !== 'category' || !parent.serverId || !compareIds(parent.serverId, g.server.id)) {
        return { ok: false, status: 400, body: invalidFormBodyAt([{ path: ['parent_id'], code: 'CHANNEL_PARENT_INVALID', message: 'Invalid parent category' }]) };
      }
      // Moving a channel into a category needs Manage Channels there too.
      const parentPerms = await botChannelPermissions(botId, parent);
      if (!hasPermission(parentPerms, P.MANAGE_CHANNELS)) return { ok: false, status: 403, body: MISSING_PERMISSIONS };
      updates.parentId = parent.id;
    }
  }

  if (fields.permissionOverwrites !== undefined) {
    if (!standingHas(g.standing, P.MANAGE_ROLES) && !hasPermission(opts.perms, P.MANAGE_ROLES)) {
      return { ok: false, status: 403, body: MISSING_PERMISSIONS };
    }
    const resolved = await resolveOverwriteList(g.server.id, g.roles, fields.permissionOverwrites);
    if (!resolved.ok) return resolved;
    const before = current ? normalizeOverwrites(current.permissionOverwrites) : [];
    const bits = current ? changedOverwriteBits(before, resolved.list) : overwriteBits(resolved.list);
    if (!canSetOverwriteBits({ standing: g.standing, perms: opts.perms }, bits)) return { ok: false, status: 403, body: MISSING_PERMISSIONS };
    updates.permissionOverwrites = resolved.list;
  }
  return { ok: true, updates };
}

/** PATCH /channels/{id} for a guild (non-thread) channel. */
async function applyBotChannelPatch(
  auth: BotAuth,
  channel: IChannel,
  perms: bigint,
  body: Record<string, unknown>,
  headers: Record<string, string | undefined>,
  set: RouteSet,
  /** Already-validated forum / media fields (src/lib/botapi/threads.ts forumPatchUpdates). */
  forumUpdates?: Record<string, unknown>,
) {
  const { fields, errors } = parseChannelFields(body, { type: String(channel.type) }, { clean: sanitizeInput });
  if (!errors.ok) { set.status = 400; return errors.toBody(); }
  const g = await loadBotGuild(channel.serverId, auth.botUser.id);
  if (!g.ok) { set.status = g.status; return g.body; }
  if (fields.lockPermissions && !fields.parentId) delete fields.lockPermissions;
  if (fields.lockPermissions && !standingHas(g.standing, P.MANAGE_ROLES) && !hasPermission(perms, P.MANAGE_ROLES)) {
    set.status = 403; return MISSING_PERMISSIONS;
  }
  const prepared = await prepareChannelWrite({ botId: auth.botUser.id, g, current: channel, perms, fields });
  if (!prepared.ok) { set.status = prepared.status; return prepared.body; }
  const updates = { ...prepared.updates, ...(forumUpdates ?? {}) };
  if (Object.keys(updates).length === 0 && !fields.lockPermissions) return formatChannel(channel);
  const updated = await updateGuildChannel({
    channel: channel as typeof schema.channels.$inferSelect,
    updates,
    actorId: auth.botUser.id,
    reason: auditReason(headers['x-audit-log-reason']),
    lockPermissions: fields.lockPermissions,
  });
  return formatChannel(updated || channel);
}

// ─── Roles, members, bans (WP4a) ───────────────────────────

type GuildOk = Extract<BotGuildResult, { ok: true }>;
const UNKNOWN_MEMBER = { code: 10007, message: 'Unknown Member' };
/** Discord's longest timeout. */
const MAX_TIMEOUT_MS = 28 * 24 * 60 * 60 * 1000;

/** Role icon fields: image data (uploaded, then checked like the web app) or a unicode emoji, mutually exclusive. */
async function roleIconFields(
  fields: { icon?: string | null; unicodeEmoji?: string | null },
  serverId: string,
  botId: string,
): Promise<{ ok: true; values: { icon?: string | null; unicodeEmoji?: string | null } } | { ok: false; body: unknown }> {
  if (fields.icon === undefined && fields.unicodeEmoji === undefined) return { ok: true, values: {} };
  let iconUrl: string | null | undefined = fields.icon === undefined ? undefined : null;
  if (typeof fields.icon === 'string') {
    // Discord: role icons are at most 256 KB.
    const decoded = decodeImageDataUri(fields.icon, 256 * 1024);
    if (!decoded.ok) return { ok: false, body: invalidFormBodyAt([{ path: ['icon'], code: 'IMAGE_INVALID', message: decoded.message }]) };
    const stored = await uploadBotImage({ image: decoded, category: 'emojis', serverId, botId, name: 'role-icon' });
    if (!stored.ok) return { ok: false, body: invalidFormBodyAt([{ path: ['icon'], code: 'IMAGE_INVALID', message: stored.message }]) };
    iconUrl = stored.url;
  }
  const normalized = normalizeRoleIconInput({ icon: iconUrl, unicodeEmoji: fields.unicodeEmoji }, config.CDN_URL);
  if ('error' in normalized) return { ok: false, body: invalidFormBodyAt([{ path: [fields.unicodeEmoji !== undefined ? 'unicode_emoji' : 'icon'], code: 'ROLE_ICON_INVALID', message: normalized.error }]) };
  return { ok: true, values: normalized };
}

/**
 * Apply Discord role position updates (PATCH /guilds/{id}/roles, or `position`
 * on one role): renumber 1..N, then enforce the hierarchy with the web app's
 * checkRoleReorder (roles at or above the bot's top role stay put).
 */
async function reorderGuildRoles(g: GuildOk, botId: string, updates: Array<{ id: string; position?: number }>): Promise<{ ok: true } | Fail> {
  const byId = new Map(g.roles.map((r) => [normalizeId(r.id), r]));
  for (const [i, u] of updates.entries()) {
    const r = byId.get(normalizeId(u.id));
    if (!r) return { ok: false, status: 400, body: invalidFormBodyAt([{ path: [i, 'id'], code: 'UNKNOWN_ROLE', message: 'Unknown role' }]) };
    if (r.isDefault && u.position !== undefined && u.position !== 0) {
      return { ok: false, status: 400, body: invalidFormBodyAt([{ path: [i, 'position'], code: 'ROLE_INVALID', message: 'The @everyone role cannot be moved' }]) };
    }
  }
  const resolved = updates.map((u) => ({ ...u, id: byId.get(normalizeId(u.id))!.id }));
  const { orderedHighestFirst, positions } = applyRolePositions(g.roles, resolved);
  if (!g.standing.isOwner) {
    const actor = await getActorRoleContext(g.server, botId, g.roles as HierarchyRole[]);
    const error = actor ? checkRoleReorder(actor, g.roles as HierarchyRole[], orderedHighestFirst) : 'not a member';
    if (error) return { ok: false, status: 403, body: MISSING_PERMISSIONS };
    // A role the bot can't manage may not be moved at all.
    for (const u of resolved) {
      const r = byId.get(normalizeId(u.id))!;
      if (!r.isDefault && (r.managed || !outranks(g.standing, r.position ?? 0)) && positions.get(r.id) !== r.position) {
        return { ok: false, status: 403, body: MISSING_PERMISSIONS };
      }
    }
  }
  const changed = g.roles.filter((r) => !r.isDefault && positions.has(r.id) && positions.get(r.id) !== (r.position ?? 0));
  for (const r of changed) await Role.updateById(r.id, { position: positions.get(r.id)! });
  if (changed.length > 0) {
    invalidateRolePerms(g.server.id);
    void guildEvents.emitRolesUpdate(g.server.id, changed.map((r) => r.id));
  }
  return { ok: true };
}

/** Member-related caches and bot audiences after a member write (roles change what a member can see). */
function afterMemberChange(serverId: string, userId: string, opts: { roles?: boolean } = {}) {
  void import('./activity').then((m) => m.invalidateServerMemberCache(serverId)).catch(() => {});
  if (opts.roles) {
    void import('@/lib/realtime/channelStreams').then((m) => m.requestUserChannelStreamRecheck(normalizeId(userId))).catch(() => {});
  }
  void guildEvents.emitMemberUpdate(serverId, userId);
}

/** PATCH a guild member as the bot: nick, roles, mute/deaf, timeout (Discord's permission and hierarchy rules). */
async function patchBotMember(
  auth: BotAuth,
  guildId: string,
  userId: string,
  body: {
    nick?: unknown; roles?: unknown; mute?: unknown; deaf?: unknown; channel_id?: unknown; communication_disabled_until?: unknown; flags?: unknown;
    /** @me only: the bot's own server avatar / banner (image data, null removes). */
    avatar?: unknown; banner?: unknown;
  },
  headers: Record<string, string | undefined>,
  set: RouteSet,
) {
  if (!isValidObjectId(guildId) || !isValidObjectId(userId)) { set.status = 404; return UNKNOWN_MEMBER; }
  const member = await ServerMember.findOne({ serverId: guildId, userId });
  if (!member) { set.status = 404; return UNKNOWN_MEMBER; }
  const g = await loadBotGuild(guildId, auth.botUser.id);
  if (!g.ok) { set.status = g.status; return g.body; }

  const isSelf = compareIds(userId, auth.botUser.id);
  const targetIsOwner = compareIds(g.server.ownerId, userId);
  const targetOutranked = outranks(g.standing, memberTopPosition(g.roles, (member.roles || []) as string[]));
  const deny = () => { set.status = 403; return MISSING_PERMISSIONS; };
  const errors = new GuildFormErrors();
  const updates: Partial<typeof schema.serverMembers.$inferInsert> = {};
  const changes: Array<{ key: string; old?: unknown; new?: unknown }> = [];
  const everyone = g.roles.find((r) => r.isDefault)?.id ?? null;
  let roleChanges: Array<{ key: string; old?: unknown; new?: unknown }> = [];

  if (body.nick !== undefined) {
    if (body.nick !== null && typeof body.nick !== 'string') errors.add(['nick'], 'BASE_TYPE_BAD_TYPE', 'Could not interpret value as string.');
    else {
      const nick = body.nick ? sanitizeInput(body.nick).trim() : '';
      if (nick.length > 32) errors.add(['nick'], 'BASE_TYPE_BAD_LENGTH', 'Must be between 1 and 32 in length.');
      else {
        if (isSelf) {
          if (!standingHas(g.standing, P.CHANGE_NICKNAME) && !standingHas(g.standing, P.MANAGE_NICKNAMES)) return deny();
        } else if (!standingHas(g.standing, P.MANAGE_NICKNAMES) || targetIsOwner || !targetOutranked) {
          return deny();
        }
        updates.nickname = nick || null;
        if ((member.nickname ?? null) !== (updates.nickname ?? null)) {
          changes.push({ key: 'nick', ...(member.nickname ? { old: member.nickname } : {}), ...(updates.nickname ? { new: updates.nickname } : {}) });
        }
      }
    }
  }
  if (body.roles !== undefined && body.roles !== null) {
    if (!Array.isArray(body.roles) || body.roles.some((r) => typeof r !== 'string')) {
      errors.add(['roles'], 'BASE_TYPE_BAD_TYPE', 'Must be an array of role ids.');
    } else {
      if (!standingHas(g.standing, P.MANAGE_ROLES)) return deny();
      // Like the web app: never the owner's roles, nor those of a member ranked at or above the bot.
      if (!isSelf && (targetIsOwner || !targetOutranked)) return deny();
      const roleById = new Map(g.roles.map((r) => [normalizeId(r.id), r]));
      const before = new Set(((member.roles || []) as string[]).map(normalizeId).filter((id) => !everyone || id !== normalizeId(everyone)));
      const after = new Set((body.roles as string[]).map(normalizeId).filter((id) => !everyone || id !== normalizeId(everyone)));
      for (const [i, id] of [...after].entries()) {
        if (!roleById.has(id)) errors.add(['roles', i], 'UNKNOWN_ROLE', 'Unknown role');
      }
      if (errors.ok) {
        // Every role being added or removed must be an assignable role below
        // the bot's top role (Discord's hierarchy rule).
        const changed = [...after].filter((id) => !before.has(id)).concat([...before].filter((id) => !after.has(id)));
        for (const id of changed) {
          const r = roleById.get(id);
          if (!r) continue; // stale id on the member record; dropping it is fine
          if (r.isDefault || r.managed || !outranks(g.standing, r.position ?? 0)) return deny();
        }
        const ids = [...after].map((id) => roleById.get(id)!.id);
        // Linked roles (CORD-57): newly granted roles add the roles they link to,
        // when the bot could assign those itself.
        for (const id of expandLinkedRoles({
          current: [...before],
          next: [...after],
          links: readRoleLinks(g.server.settings, g.roles),
          canAdd: (id) => { const r = roleById.get(id); return Boolean(r) && !r!.isDefault && !r!.managed && outranks(g.standing, r!.position ?? 0); },
        }).slice(after.size)) ids.push(roleById.get(id)!.id);
        updates.roles = everyone ? [everyone, ...ids] : ids;
        const names = new Map(g.roles.map((r) => [r.id, r.name] as const));
        roleChanges = diffMemberRoles([...before].map((id) => roleById.get(id)?.id ?? id), ids, names);
      }
    }
  }
  if (body.deaf !== undefined && body.deaf !== null) {
    if (typeof body.deaf !== 'boolean') errors.add(['deaf'], 'BASE_TYPE_BAD_TYPE', 'Must be either true or false.');
    else {
      if (!standingHas(g.standing, P.DEAFEN_MEMBERS)) return deny();
      updates.deaf = body.deaf;
      if (body.deaf !== (member.deaf ?? false)) changes.push({ key: 'deaf', old: member.deaf ?? false, new: body.deaf });
    }
  }
  if (body.mute !== undefined && body.mute !== null) {
    if (typeof body.mute !== 'boolean') errors.add(['mute'], 'BASE_TYPE_BAD_TYPE', 'Must be either true or false.');
    else {
      if (!standingHas(g.standing, P.MUTE_MEMBERS)) return deny();
      updates.mute = body.mute;
      if (body.mute !== (member.mute ?? false)) changes.push({ key: 'mute', old: member.mute ?? false, new: body.mute });
    }
  }
  // Voice move / disconnect (WP7): checked now, applied after the member update.
  let voiceMove: import('./voice').ServerVoiceMovePlan | null = null;
  if (body.channel_id !== undefined) {
    if (body.channel_id !== null && typeof body.channel_id !== 'string') errors.add(['channel_id'], 'NUMBER_TYPE_COERCE', 'Value is not snowflake.');
    else {
      const { planServerVoiceMove } = await import('./voice');
      const botMembership = await ServerMember.findOne({ serverId: guildId, userId: auth.botUser.id });
      voiceMove = await planServerVoiceMove({
        serverId: g.server.id,
        actorId: auth.botUser.id,
        targetUserId: member.userId,
        channelId: body.channel_id,
        reducePerms: (p) => (g.standing.isOwner ? p : applyTimeout(p, botMembership?.communicationDisabledUntil ?? null)),
      });
      if (!voiceMove.ok) { set.status = voiceMove.status; return { code: voiceMove.code, message: voiceMove.message }; }
    }
  }
  if (body.communication_disabled_until !== undefined) {
    if (!standingHas(g.standing, P.MODERATE_MEMBERS) || targetIsOwner || isSelf || !targetOutranked) return deny();
    // Administrators can't be timed out (Discord).
    const targetStanding = computeGuildStanding(g.roles, (member.roles || []) as string[], false);
    if (hasPermission(targetStanding.perms, P.ADMINISTRATOR)) return deny();
    let until: Date | null = null;
    if (body.communication_disabled_until !== null) {
      const t = typeof body.communication_disabled_until === 'string' ? Date.parse(body.communication_disabled_until) : NaN;
      if (!Number.isFinite(t)) errors.add(['communication_disabled_until'], 'DATE_TYPE_INVALID', 'Could not parse the date.');
      else if (t - Date.now() > MAX_TIMEOUT_MS) errors.add(['communication_disabled_until'], 'COMMUNICATION_DISABLED_UNTIL_TOO_LONG', 'The timeout can be at most 28 days.');
      else if (t > Date.now()) until = new Date(t);
    }
    if (errors.ok) {
      updates.communicationDisabledUntil = until;
      const prev = member.communicationDisabledUntil ? new Date(member.communicationDisabledUntil).toISOString() : null;
      const next = until ? until.toISOString() : null;
      if (prev !== next) changes.push({ key: 'communication_disabled_until', ...(prev ? { old: prev } : {}), ...(next ? { new: next } : {}) });
    }
  }
  if (!errors.ok) { set.status = 400; return errors.toBody(); }

  // Own server profile images (PATCH /guilds/{id}/members/@me), through the upload pipeline.
  if (isSelf) {
    for (const [key, category, max] of [['avatar', 'avatars', config.MAX_AVATAR_SIZE], ['banner', 'banners', config.MAX_BANNER_SIZE]] as const) {
      const value = body[key];
      if (value === undefined) continue;
      if (value === null) { updates[key] = null; continue; }
      const decoded = decodeImageDataUri(value, max);
      if (!decoded.ok) { set.status = 400; return invalidFormBodyAt([{ path: [key], code: 'IMAGE_INVALID', message: decoded.message }]); }
      const stored = await uploadBotImage({ image: decoded, category, serverId: g.server.id, userId: auth.botUser.id, botId: auth.botUser.id, name: key });
      if (!stored.ok) { set.status = 400; return invalidFormBodyAt([{ path: [key], code: 'IMAGE_INVALID', message: stored.message }]); }
      updates[key] = stored.url;
    }
  }

  const updated = Object.keys(updates).length > 0 ? await ServerMember.updateById(member.id, updates) : member;
  // Server mute/deafen take effect in voice right away (lazy: voice.ts pulls in the realtime buses).
  if (updates.mute !== undefined || updates.deaf !== undefined) {
    void import('./voice')
      .then((m) => m.applyServerVoiceState(guildId, member.userId, { mute: updates.mute ?? undefined, deaf: updates.deaf ?? undefined }))
      .catch(() => {});
  }
  const reason = auditReason(headers['x-audit-log-reason']);
  if (voiceMove?.ok) {
    await voiceMove.apply();
    audit({
      serverId: g.server.id,
      userId: auth.botUser.id,
      actionType: voiceMove.toChannelId ? AuditLogEvent.MEMBER_MOVE : AuditLogEvent.MEMBER_DISCONNECT,
      targetId: member.userId,
      options: voiceMove.toChannelId ? { channel_id: voiceMove.toChannelId, count: '1' } : { count: '1' },
      reason,
    });
  }
  if (changes.length > 0) audit({ serverId: g.server.id, userId: auth.botUser.id, actionType: AuditLogEvent.MEMBER_UPDATE, targetId: member.userId, changes, reason });
  if (roleChanges.length > 0) audit({ serverId: g.server.id, userId: auth.botUser.id, actionType: AuditLogEvent.MEMBER_ROLE_UPDATE, targetId: member.userId, changes: roleChanges, reason });
  if (Object.keys(updates).length > 0) afterMemberChange(g.server.id, member.userId, { roles: updates.roles !== undefined });

  const user = await User.findById(userId);
  return formatMember(updated || member, user, everyone);
}

/** PUT / DELETE /guilds/{id}/members/{uid}/roles/{rid}. */
async function changeMemberRole(
  auth: BotAuth,
  guildId: string,
  userId: string,
  roleId: string,
  op: 'add' | 'remove',
  headers: Record<string, string | undefined>,
  set: RouteSet,
) {
  const g = await requireBotPerm(guildId, auth.botUser.id, P.MANAGE_ROLES);
  if (!g.ok) { set.status = g.status; return g.body; }
  const role = isValidObjectId(roleId) ? g.roles.find((r) => compareIds(r.id, roleId)) : undefined;
  if (!role) { set.status = 404; return { code: 10011, message: 'Unknown Role' }; }
  if (!isValidObjectId(userId)) { set.status = 404; return UNKNOWN_MEMBER; }
  const member = await ServerMember.findOne({ serverId: guildId, userId });
  if (!member) { set.status = 404; return UNKNOWN_MEMBER; }
  if (role.isDefault || role.managed || !outranks(g.standing, role.position ?? 0)) { set.status = 403; return MISSING_PERMISSIONS; }
  // Like the web app: never the owner's roles, nor those of a member ranked at or above the bot.
  if (!compareIds(userId, auth.botUser.id)
    && (compareIds(g.server.ownerId, userId) || !outranks(g.standing, memberTopPosition(g.roles, (member.roles || []) as string[])))) {
    set.status = 403; return MISSING_PERMISSIONS;
  }

  const current = (member.roles || []) as string[];
  const has = current.some((r) => compareIds(r, role.id));
  if ((op === 'add' && has) || (op === 'remove' && !has)) { set.status = 204; return ''; }
  const everyone = g.roles.find((r) => r.isDefault)?.id ?? null;
  let next = op === 'add' ? [...current, role.id] : current.filter((r) => !compareIds(r, role.id));
  if (everyone && !next.some((r) => compareIds(r, everyone))) next = [everyone, ...next];
  let linked: typeof g.roles = [];
  if (op === 'add') {
    // Linked roles (CORD-57), limited to roles the bot could assign itself.
    const byId = new Map(g.roles.map((r) => [normalizeId(r.id), r]));
    const expanded = expandLinkedRoles({
      current: current.map(normalizeId),
      next: next.map(normalizeId),
      links: readRoleLinks(g.server.settings, g.roles),
      canAdd: (id) => { const r = byId.get(id); return Boolean(r) && !r!.isDefault && !r!.managed && outranks(g.standing, r!.position ?? 0); },
    });
    linked = expanded.slice(next.length).map((id) => byId.get(id)!).filter(Boolean);
    next = [...next, ...linked.map((r) => r.id)];
  }
  await ServerMember.updateById(member.id, { roles: next });
  audit({
    serverId: g.server.id, userId: auth.botUser.id, actionType: AuditLogEvent.MEMBER_ROLE_UPDATE, targetId: member.userId,
    changes: [{ key: op === 'add' ? '$add' : '$remove', new: [role, ...linked].map((r) => ({ id: r.id, name: r.name })) }],
    reason: auditReason(headers['x-audit-log-reason']),
  });
  afterMemberChange(g.server.id, member.userId, { roles: true });
  set.status = 204;
  return '';
}

/** Most members one prune removes (call again for more). */
const MAX_PRUNE = 1000;
/** Messages a bulk ban's delete_message_seconds may remove across all its users. */
const BULK_BAN_PURGE_BUDGET = 5000;

/** Who a prune would remove: the bot must outrank each of them (Discord). At most MAX_PRUNE per call. */
async function pruneTargets(
  g: GuildOk,
  botId: string,
  options: { days: number; includeRoles: string[] },
): Promise<{ ok: true; userIds: string[] } | Fail> {
  const include: string[] = [];
  for (const [i, id] of options.includeRoles.entries()) {
    const r = isValidObjectId(id) ? g.roles.find((x) => compareIds(x.id, id)) : undefined;
    if (!r) return { ok: false, status: 400, body: invalidFormBodyAt([{ path: ['include_roles', i], code: 'UNKNOWN_ROLE', message: 'Unknown role' }]) };
    include.push(r.id);
  }
  const cutoff = new Date(Date.now() - options.days * 86_400_000);
  // Last seen: the live heartbeat, else when they disconnected (the heartbeat is
  // cleared on disconnect), else when they joined. Nothing known: never pruned.
  const lastSeen = sql<Date | null>`COALESCE(${schema.users.presenceLastHeartbeatAt}, ${schema.users.presenceLastDisconnectAt}, ${schema.serverMembers.joinedAt})`;
  const rows = await db.select({
    userId: schema.serverMembers.userId,
    roles: schema.serverMembers.roles,
    isBot: schema.users.isBot,
    seen: lastSeen,
  })
    .from(schema.serverMembers)
    .innerJoin(schema.users, eq(schema.users.id, schema.serverMembers.userId))
    .where(and(
      eq(schema.serverMembers.serverId, normalizeId(g.server.id)),
      sql`${lastSeen} < ${cutoff}`,
    ))
    .limit(MAX_PRUNE);
  const everyone = g.roles.find((r) => r.isDefault)?.id ?? null;
  const ids = rows
    .filter((m) => isPrunable(
      { roles: (m.roles ?? []) as string[], isBot: !!m.isBot, isOwner: compareIds(m.userId, g.server.ownerId), lastSeenAt: m.seen ? new Date(m.seen) : null },
      { days: options.days, includeRoles: include, everyoneRoleId: everyone },
    ))
    .filter((m) => !compareIds(m.userId, botId) && outranks(g.standing, memberTopPosition(g.roles, (m.roles ?? []) as string[])))
    .map((m) => m.userId);
  return { ok: true, userIds: ids };
}

/** Ban one user as the bot (PUT ban, bulk-ban): hierarchy, message purge, ban row, removal, audit. */
async function banOne(
  g: GuildOk,
  botId: string,
  userId: string,
  deleteSeconds: number,
  reason: string | null,
  purgeBudget?: { left: number },
): Promise<{ ok: true } | Fail> {
  if (compareIds(g.server.ownerId, userId) || compareIds(userId, botId)) return { ok: false, status: 403, body: MISSING_PERMISSIONS };
  const target = await User.findById(userId);
  if (!target) return { ok: false, status: 404, body: { code: 10013, message: 'Unknown User' } };
  const member = await ServerMember.findOne({ serverId: g.server.id, userId });
  if (member && !outranks(g.standing, memberTopPosition(g.roles, (member.roles || []) as string[]))) {
    return { ok: false, status: 403, body: MISSING_PERMISSIONS };
  }
  // Create or update the ban (re-banning is idempotent, like Discord's PUT);
  // GUILD_BAN_ADD and GUILD_MEMBER_REMOVE come from the membership service.
  await upsertServerBan(g.server.id, userId, botId, reason);
  await removeServerMember(g.server.id, userId);
  if (deleteSeconds > 0 && (!purgeBudget || purgeBudget.left > 0)) {
    const removed = await purgeMemberMessages(g.server.id, userId, deleteSeconds, purgeBudget?.left).catch(() => 0);
    if (purgeBudget) purgeBudget.left -= removed;
  }
  audit({ serverId: g.server.id, userId: botId, actionType: AuditLogEvent.MEMBER_BAN_ADD, targetId: userId, reason });
  return { ok: true };
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

// ─── Voice / monetization helpers (WP7) ────────────────────

/** Serika voice is one peer-to-peer mesh: a single, always-optimal region. */
const VOICE_REGIONS = [{ id: 'serika', name: 'SerikaCord (peer-to-peer)', optimal: true, deprecated: false, custom: false }];
const UNKNOWN_VOICE_STATE = { code: 10065, message: 'Unknown voice state' };
const UNKNOWN_ENTITLEMENT = { code: 10029, message: 'Unknown entitlement' };

/**
 * The voice state of `userId` in a guild's voice channels (with member), or
 * null, also when `botId` can't view that voice channel.
 */
async function findVoiceState(guildId: string, userId: string, botId: string) {
  if (!isValidObjectId(guildId) || !isValidObjectId(userId)) return null;
  const { listGuildVoiceStates } = await import('@/lib/services/voiceStates');
  const state = (await listGuildVoiceStates(guildId)).find((v) => compareIds(v.user_id, userId));
  if (!state || !state.channel_id) return null;
  const { checkChannelAccess } = await import('@/lib/api/channels');
  if (!(await checkChannelAccess(botId, state.channel_id)).hasAccess) return null;
  const member = await ServerMember.findOne({ serverId: guildId, userId });
  const user = member ? await User.findById(userId) : null;
  return { ...state, guild_id: guildId, ...(member ? { member: formatMember(member, user) } : {}) };
}

/** Type checks of a voice state PATCH body (Discord 50035 tree), or null. */
function voiceStatePatchError(b: { channel_id?: unknown; suppress?: unknown; request_to_speak_timestamp?: unknown }) {
  const errs: Array<{ path: string; code: string; message: string }> = [];
  if (b.channel_id !== undefined && b.channel_id !== null && typeof b.channel_id !== 'string') errs.push({ path: 'channel_id', code: 'NUMBER_TYPE_COERCE', message: 'Value is not snowflake.' });
  if (b.suppress !== undefined && typeof b.suppress !== 'boolean') errs.push({ path: 'suppress', code: 'BOOLEAN_TYPE_COERCE', message: 'Must be either true or false.' });
  if (b.request_to_speak_timestamp !== undefined && b.request_to_speak_timestamp !== null && (typeof b.request_to_speak_timestamp !== 'string' || Number.isNaN(Date.parse(b.request_to_speak_timestamp)))) {
    errs.push({ path: 'request_to_speak_timestamp', code: 'DATE_TYPE_PARSE', message: 'Could not parse the date.' });
  }
  return errs.length > 0 ? invalidFormBodyAt(errs) : null;
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
  if (auth) return formatUser(auth.botUser);
  // OAuth2: Bearer with the identify scope (email needs the email scope).
  const bearer = await requireBearerScope(headers, 'identify');
  if (!bearer.ok) { set.status = bearer.status; return bearer.body; }
  return formatOAuthUser(bearer.auth.user, bearer.auth.grant.scopes);
})
// ─── Current user (WP1/WP6): bot profile, guild list, connections ─
// Bots edit their own username / avatar / banner (Discord's limits, the
// regular upload pipeline with Trust & Safety scanning) and get USER_UPDATE.
.patch('/users/@me', async ({ headers, body, request, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  const { parseBotUserPatch } = await import('@/lib/botapi/users');
  const { username: rawUsername, avatar: rawAvatar, banner: rawBanner } = (body ?? {}) as Record<string, unknown>;
  const parsed = parseBotUserPatch({ username: rawUsername, avatar: rawAvatar, banner: rawBanner });
  if (!parsed.ok) { set.status = 400; return invalidFormBodyAt(parsed.errors); }
  const { username, avatar, banner } = parsed.patch;
  const { updateBotProfile } = await import('@/lib/services/botProfile');
  const r = await updateBotProfile(auth.botUser, { username, avatar, banner }, { ip: getClientIP(request), ownerId: auth.app.ownerId });
  if (!r.ok) { set.status = r.status; if (r.headers) Object.assign(set.headers, r.headers); return r.body; }
  return formatUser(r.user);
})
.get('/users/@me/guilds', async ({ headers, query, set }) => {
  const auth = await authenticateBot(headers);
  let userId: string;
  if (auth) userId = auth.botUser.id;
  else {
    const bearer = await requireBearerScope(headers, 'guilds');
    if (!bearer.ok) { set.status = bearer.status; return bearer.body; }
    userId = bearer.auth.user.id;
  }
  const { parseGuildPageQuery, listCurrentUserGuilds } = await import('@/lib/botapi/users');
  const q = parseGuildPageQuery({ before: query.before, after: query.after, limit: query.limit, with_counts: query.with_counts });
  if ('error' in q) {
    set.status = 400;
    return invalidFormBodyAt([{ path: q.error, code: q.error === 'limit' ? 'NUMBER_TYPE_MAX' : 'NUMBER_TYPE_COERCE', message: q.error === 'limit' ? 'int value should be between 1 and 200.' : 'Value is not snowflake.' }]);
  }
  return listCurrentUserGuilds(userId, q);
})
.get('/users/@me/guilds/:guildId/member', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  let userId: string;
  if (auth) userId = auth.botUser.id; // the access guard already required membership
  else {
    const bearer = await requireBearerScope(headers, 'guilds.members.read');
    if (!bearer.ok) { set.status = bearer.status; return bearer.body; }
    userId = bearer.auth.user.id;
  }
  if (!isValidObjectId(params.guildId)) { set.status = 404; return { code: 10004, message: 'Unknown Guild' }; }
  const member = await ServerMember.findOne({ serverId: params.guildId, userId });
  if (!member) { set.status = 404; return { code: 10004, message: 'Unknown Guild' }; }
  const user = await User.findById(userId);
  return formatMember(member, user);
})
.get('/users/@me/connections', async ({ headers, set }) => {
  // Bearer only (Discord): a bot has no connections.
  const bearer = await requireBearerScope(headers, 'connections');
  if (!bearer.ok) { set.status = bearer.status; return bearer.body; }
  const { listConnections } = await import('@/lib/botapi/users');
  return listConnections(bearer.auth.user.id);
})
.get('/users/:userId', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  if (!isValidObjectId(params.userId)) { set.status = 404; return { code: 10013, message: 'Unknown User' }; }
  const user = await User.findById(params.userId);
  if (!user) { set.status = 404; return { code: 10013, message: 'Unknown User' }; }
  // Another user's object never carries account-private fields (Discord).
  const out = formatUser(user) as Record<string, unknown>;
  if (!compareIds(user.id, auth.botUser.id)) { delete out.email; delete out.verified; delete out.mfa_enabled; delete out.premium_type; delete out.created_at; }
  return out;
})

// ─── OAuth2 (WP6): /api/v10 aliases of /api/oauth2/* + /oauth2/@me ─
// Same handlers as the unversioned routes (src/lib/api/developers.ts):
// authorization codes are one-time, tokens are stored hashed, refresh
// tokens rotate, client_credentials acts as the app owner.
.get('/oauth2/authorize', async ({ query, headers, set }) => {
  const { oauthAuthorizeInfo } = await import('@/lib/api/developers');
  return oauthAuthorizeInfo(query as Record<string, unknown>, headers, set);
})
.post('/oauth2/token', async ({ body, headers, request, set }) => {
  const { oauthTokenEndpoint } = await import('@/lib/api/developers');
  const { grant_type, code, redirect_uri, refresh_token, scope, client_id, client_secret, code_verifier } = (body ?? {}) as Record<string, unknown>;
  return oauthTokenEndpoint({ grant_type, code, redirect_uri, refresh_token, scope, client_id, client_secret, code_verifier }, headers, set, getClientIP(request));
})
.post('/oauth2/token/revoke', async ({ body, headers, request, set }) => {
  const { oauthRevokeEndpoint } = await import('@/lib/api/developers');
  const { token, token_type_hint, client_id, client_secret } = (body ?? {}) as Record<string, unknown>;
  return oauthRevokeEndpoint({ token, token_type_hint, client_id, client_secret }, headers, set, getClientIP(request));
})
.get('/oauth2/@me', async ({ headers, set }) => {
  const auth = await authenticateBearer(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  // Discord's partial application here: public fields only.
  const full = toDiscordApplication(auth.app, {});
  const application = {
    id: full.id, name: full.name, icon: full.icon, description: full.description, summary: full.summary, type: full.type,
    hook: full.hook, bot_public: full.bot_public, bot_require_code_grant: full.bot_require_code_grant, verify_key: full.verify_key, flags: full.flags,
  };
  return {
    application,
    scopes: auth.grant.scopes,
    expires: auth.grant.expiresAt.toISOString(),
    ...(auth.grant.scopes.includes('identify') ? { user: formatOAuthUser(auth.user, auth.grant.scopes) } : {}),
  };
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
.get('/guilds/:guildId', async ({ headers, params, query, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  const g = await loadBotGuild(params.guildId, auth.botUser.id);
  if (!g.ok) { set.status = g.status; return g.body; }
  const withCounts = String(query.with_counts ?? '').toLowerCase() === 'true';
  return await formatGuild(g.server, { withCounts });
})
.patch('/guilds/:guildId', async ({ headers, params, body, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  const g = await requireBotPerm(params.guildId, auth.botUser.id, P.MANAGE_SERVER);
  if (!g.ok) { set.status = g.status; return g.body; }
  const server = g.server;

  const {
    name, description, verification_level, default_message_notifications, explicit_content_filter, afk_channel_id,
    afk_timeout, icon, banner, splash, discovery_splash, owner_id, system_channel_id, rules_channel_id,
    public_updates_channel_id,
  } = (body ?? {}) as Record<string, unknown>;
  const { fields, errors } = parseGuildFields({
    name, description, verification_level, default_message_notifications, explicit_content_filter, afk_channel_id,
    afk_timeout, icon, banner, splash, discovery_splash, owner_id, system_channel_id, rules_channel_id,
    public_updates_channel_id,
  }, { clean: sanitizeInput });
  if (!errors.ok) { set.status = 400; return errors.toBody(); }

  // Channel references must be this guild's channels of the right kind.
  const textLike = (t: string) => t === 'text' || t === 'announcement';
  const refs: Array<[string | null | undefined, string, (type: string) => boolean]> = [
    [fields.afkChannelId, 'afk_channel_id', (t) => t === 'voice'],
    [fields.systemChannelId, 'system_channel_id', textLike],
    [fields.rulesChannelId, 'rules_channel_id', textLike],
    [fields.publicUpdatesChannelId, 'public_updates_channel_id', textLike],
  ];
  for (const [id, field, okType] of refs) {
    if (!id) continue;
    const ch = isValidObjectId(id) ? await Channel.findById(id) : null;
    if (!ch || !ch.serverId || !compareIds(ch.serverId, server.id) || !okType(String(ch.type))) {
      errors.add([field], 'CHANNEL_INVALID', 'Unknown or unsuitable channel.');
    }
  }
  // Ownership transfer: only the owner may, and only to a member (Discord).
  if (fields.ownerId !== undefined) {
    if (!compareIds(server.ownerId, auth.botUser.id)) { set.status = 403; return MISSING_PERMISSIONS; }
    const target = isValidObjectId(fields.ownerId) ? await ServerMember.findOne({ serverId: server.id, userId: fields.ownerId }) : null;
    if (!target) errors.add(['owner_id'], 'USER_NOT_MEMBER', 'The new owner must be a member of the guild.');
  }
  if (!errors.ok) { set.status = 400; return errors.toBody(); }

  const updates: Partial<IServer> = {};
  if (fields.name !== undefined) updates.name = fields.name;
  if (fields.description !== undefined) updates.description = fields.description;
  if (fields.verificationLevel !== undefined) updates.verificationLevel = fields.verificationLevel;
  if (fields.defaultNotifications !== undefined) updates.defaultNotifications = fields.defaultNotifications;
  if (fields.explicitContentFilter !== undefined) updates.explicitContentFilter = fields.explicitContentFilter;
  if (fields.afkTimeout !== undefined) updates.afkTimeout = fields.afkTimeout;
  if (fields.afkChannelId !== undefined) updates.afkChannelId = fields.afkChannelId;
  if (fields.systemChannelId !== undefined) updates.systemChannelId = fields.systemChannelId;
  if (fields.rulesChannelId !== undefined) updates.rulesChannelId = fields.rulesChannelId;
  if (fields.publicUpdatesChannelId !== undefined) updates.publicUpdatesChannelId = fields.publicUpdatesChannelId;
  if (fields.ownerId !== undefined) updates.ownerId = normalizeId(fields.ownerId);

  // Image data URIs go through the upload pipeline (type sniffing + Trust & Safety scan).
  const images: Array<[string | null | undefined, 'icon' | 'banner' | 'splash' | 'discoverySplash', 'server-icons' | 'server-banners', number, string]> = [
    [fields.icon, 'icon', 'server-icons', config.MAX_AVATAR_SIZE, 'icon'],
    [fields.banner, 'banner', 'server-banners', config.MAX_BANNER_SIZE, 'banner'],
    [fields.splash, 'splash', 'server-banners', config.MAX_BANNER_SIZE, 'splash'],
    [fields.discoverySplash, 'discoverySplash', 'server-banners', config.MAX_BANNER_SIZE, 'discovery_splash'],
  ];
  for (const [value, column, category, max, field] of images) {
    if (value === undefined) continue;
    if (value === null) { updates[column] = null; continue; }
    const decoded = decodeImageDataUri(value, max);
    if (!decoded.ok) { set.status = 400; return invalidFormBodyAt([{ path: [field], code: 'IMAGE_INVALID', message: decoded.message }]); }
    const stored = await uploadBotImage({ image: decoded, category, serverId: server.id, botId: auth.botUser.id, name: field });
    if (!stored.ok) { set.status = 400; return invalidFormBodyAt([{ path: [field], code: 'IMAGE_INVALID', message: stored.message }]); }
    updates[column] = stored.url;
  }
  if (Object.keys(updates).length === 0) return await formatGuild(server);
  let updated = await Server.updateById(server.id, updates);
  // The web settings read verification / content filter from settings.moderation:
  // merge just those keys in SQL so a concurrent settings save isn't overwritten.
  if (updates.verificationLevel !== undefined || updates.explicitContentFilter !== undefined) {
    const moderation = {
      ...(updates.verificationLevel !== undefined ? { verificationLevel: updates.verificationLevel } : {}),
      ...(updates.explicitContentFilter !== undefined ? { explicitContentFilter: updates.explicitContentFilter } : {}),
    };
    const [row] = await db.update(schema.servers)
      .set({ settings: sql`jsonb_set(coalesce(${schema.servers.settings}, '{}'::jsonb), '{moderation}', coalesce(${schema.servers.settings}->'moderation', '{}'::jsonb) || ${JSON.stringify(moderation)}::jsonb)` })
      .where(eq(schema.servers.id, normalizeId(server.id)))
      .returning();
    if (row) updated = row;
  }
  await afterGuildChange(server.id);
  const changes = diffChanges(server as Record<string, unknown>, updates as Record<string, unknown>, GUILD_AUDIT_KEYS);
  if (changes.length > 0) {
    audit({ serverId: server.id, userId: auth.botUser.id, actionType: AuditLogEvent.GUILD_UPDATE, targetId: server.id, changes, reason: auditReason(headers['x-audit-log-reason']) });
  }
  void guildEvents.emitGuildUpdate(server.id);
  return await formatGuild(updated || server);
})
.get('/guilds/:guildId/preview', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  const g = await loadBotGuild(params.guildId, auth.botUser.id);
  if (!g.ok) { set.status = g.status; return g.body; }
  const server = g.server;
  const [emojis, stickers, counts] = await Promise.all([
    ServerEmoji.find({ serverId: server.id }).catch(() => []),
    ServerSticker.find({ serverId: server.id }).catch(() => []),
    guildCounts(server.id),
  ]);
  return {
    id: server.id,
    name: server.name,
    icon: server.icon ?? null,
    splash: server.splash ?? null,
    discovery_splash: server.discoverySplash ?? null,
    emojis: emojis.map((e) => toDiscordEmoji(e)),
    features: server.features ?? [],
    approximate_member_count: counts.members,
    approximate_presence_count: counts.presences,
    description: server.description ?? null,
    stickers: stickers.map((s) => toDiscordSticker(s)),
    banner: server.banner ?? null,
  };
})
.get('/guilds/:guildId/regions', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  const g = await loadBotGuild(params.guildId, auth.botUser.id);
  if (!g.ok) { set.status = g.status; return g.body; }
  return GUILD_VOICE_REGIONS;
})
.get('/guilds/:guildId/vanity-url', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  const g = await requireBotPerm(params.guildId, auth.botUser.id, P.MANAGE_SERVER);
  if (!g.ok) { set.status = g.status; return g.body; }
  return { code: g.server.vanityUrlCode ?? null, uses: g.server.vanityUrlUses ?? 0 };
})
.get('/guilds/:guildId/widget', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  const g = await requireBotPerm(params.guildId, auth.botUser.id, P.MANAGE_SERVER);
  if (!g.ok) { set.status = g.status; return g.body; }
  const widget = ((g.server.settings ?? {}) as IServerSettings).widget;
  return { enabled: widget?.enabled === true, channel_id: widget?.channelId ?? null };
})
.patch('/guilds/:guildId/widget', async ({ headers, params, body, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  const g = await requireBotPerm(params.guildId, auth.botUser.id, P.MANAGE_SERVER);
  if (!g.ok) { set.status = g.status; return g.body; }
  const { enabled, channel_id } = (body ?? {}) as { enabled?: unknown; channel_id?: unknown };
  const errors = new GuildFormErrors();
  if (enabled !== undefined && enabled !== null && typeof enabled !== 'boolean') errors.add(['enabled'], 'BASE_TYPE_BAD_TYPE', 'Must be either true or false.');
  let channelId: string | null | undefined;
  if (channel_id !== undefined) {
    if (channel_id === null) channelId = null;
    else {
      const ch = typeof channel_id === 'string' && isValidObjectId(channel_id) ? await Channel.findById(channel_id) : null;
      if (!ch || !ch.serverId || !compareIds(ch.serverId, g.server.id) || (ch.type !== 'text' && ch.type !== 'announcement')) {
        errors.add(['channel_id'], 'CHANNEL_INVALID', 'Unknown or unsuitable channel.');
      } else channelId = ch.id;
    }
  }
  if (!errors.ok) { set.status = 400; return errors.toBody(); }
  const settings = (g.server.settings ?? {}) as IServerSettings;
  const prev = { enabled: settings.widget?.enabled === true, channelId: settings.widget?.channelId ?? null };
  const widget = {
    ...(settings.widget || {}),
    enabled: typeof enabled === 'boolean' ? enabled : prev.enabled,
    channelId: channelId !== undefined ? channelId : prev.channelId,
  };
  const widgetPatch = { enabled: widget.enabled, channelId: widget.channelId ?? null };
  await db.update(schema.servers)
    .set({ settings: sql`jsonb_set(coalesce(${schema.servers.settings}, '{}'::jsonb), '{widget}', coalesce(${schema.servers.settings}->'widget', '{}'::jsonb) || ${JSON.stringify(widgetPatch)}::jsonb)` })
    .where(eq(schema.servers.id, normalizeId(g.server.id)));
  widgetCounts.delete(g.server.id);
  await afterGuildChange(g.server.id);
  const changes = diffChanges(
    { widget_enabled: prev.enabled, widget_channel_id: prev.channelId },
    { widget_enabled: widget.enabled, widget_channel_id: widget.channelId },
    { widget_enabled: 'widget_enabled', widget_channel_id: 'widget_channel_id' },
  );
  if (changes.length > 0) {
    audit({ serverId: g.server.id, userId: auth.botUser.id, actionType: AuditLogEvent.GUILD_UPDATE, targetId: g.server.id, changes, reason: auditReason(headers['x-audit-log-reason']) });
    void guildEvents.emitGuildUpdate(g.server.id);
  }
  return { enabled: widget.enabled, channel_id: widget.channelId ?? null };
})
// Public like Discord's, but only once the owner enabled the widget.
.get('/guilds/:guildId/widget.json', async ({ params, set }) => {
  if (!isValidObjectId(params.guildId)) { set.status = 404; return { code: 10004, message: 'Unknown Guild' }; }
  const server = await Server.findById(params.guildId);
  if (!server) { set.status = 404; return { code: 10004, message: 'Unknown Guild' }; }
  const widget = ((server.settings ?? {}) as IServerSettings).widget;
  if (widget?.enabled !== true) { set.status = 403; return { code: 50004, message: 'Widget Disabled' }; }
  const hit = widgetCounts.get(server.id);
  const counts = hit && Date.now() - hit.at < WIDGET_COUNTS_TTL_MS ? hit.counts : await guildCounts(server.id);
  if (!hit || hit.counts !== counts) widgetCounts.set(server.id, { at: Date.now(), counts });
  const vanity = server.isPartnered && server.vanityUrlCode ? server.vanityUrlCode : null;
  return {
    id: server.id,
    name: server.name,
    instant_invite: vanity ? `${config.FRONTEND_URL || 'https://serika.chat'}/invite/${vanity}` : null,
    channels: [],
    members: [],
    presence_count: counts.presences,
  };
})
.get('/guilds/:guildId/channels', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  if (!isValidObjectId(params.guildId)) { set.status = 404; return { code: 10004, message: 'Unknown Guild' }; }
  // Discord lists the guild's channels without threads (those come from the thread routes).
  const channels = (await Channel.find({ serverId: params.guildId }))
    .filter((c) => !isThreadChannel(c) && !isDmChannel(c));
  return channels.sort((a, b) => (a.position ?? 0) - (b.position ?? 0)).map(formatChannel);
})
// Serika extension: which of this guild's channels the Discord bridge links,
// so a bot that runs on both platforms can tell its two copies of a bridged
// channel apart (messages relayed in also carry `bridged_from`). Only links
// to channels the bot can see; ids are Serika channel ids + Discord ids.
.get('/guilds/:guildId/bridge', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  const server = await Server.findById(params.guildId);
  if (!server) { set.status = 404; return { code: 10004, message: 'Unknown Guild' }; }
  const { normalizeBridge, resolveLinkOptions, isInboundActive, isOutboundActive } = await import('@/lib/discord/bridgeConfig');
  const bridge = normalizeBridge((server as { integrations?: unknown }).integrations);
  if (!bridge.enabled || !bridge.guildId) return { platform: 'discord', enabled: false, guild_id: null, links: [] };
  const { checkChannelAccess } = await import('@/lib/api/channels');
  const links = [];
  for (const link of bridge.links) {
    const { hasAccess } = await checkChannelAccess(auth.botUser.id, link.serikaChannelId).catch(() => ({ hasAccess: false }));
    if (!hasAccess) continue;
    const options = resolveLinkOptions(bridge.defaults, link.overrides);
    links.push({
      channel_id: link.serikaChannelId,
      discord_channel_id: link.discordChannelId,
      inbound: isInboundActive(options),
      outbound: isOutboundActive(options),
      include_bots: options.includeBots !== false,
    });
  }
  return { platform: 'discord', enabled: true, guild_id: bridge.guildId, links };
})
.patch('/guilds/:guildId/channels', async ({ headers, params, body, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  const g = await requireBotPerm(params.guildId, auth.botUser.id, P.MANAGE_CHANNELS);
  if (!g.ok) { set.status = g.status; return g.body; }

  const { updates, errors } = parseChannelPositions(body);
  if (!errors.ok) { set.status = 400; return errors.toBody(); }
  const all = (await Channel.find({ serverId: g.server.id })).filter((c) => !isThreadChannel(c) && !isDmChannel(c));
  const byId = new Map(all.map((c) => [normalizeId(c.id), c]));
  for (const [i, u] of updates.entries()) {
    const ch = byId.get(normalizeId(u.id));
    if (!ch) { errors.add([i, 'id'], 'CHANNEL_INVALID', 'Unknown channel.'); continue; }
    if (u.parentId) {
      const parent = byId.get(normalizeId(u.parentId));
      if (ch.type === 'category' || !parent || parent.type !== 'category') errors.add([i, 'parent_id'], 'CHANNEL_PARENT_INVALID', 'Invalid parent category.');
    }
  }
  if (!errors.ok) { set.status = 400; return errors.toBody(); }

  // Moving a channel needs Manage Channels on it; syncing its permissions needs Manage Roles too.
  for (const u of updates) {
    const ch = byId.get(normalizeId(u.id))!;
    const perms = await botChannelPermissions(auth.botUser.id, ch);
    if (!hasPermission(perms, P.MANAGE_CHANNELS)) { set.status = 403; return MISSING_PERMISSIONS; }
    if (u.lockPermissions && u.parentId) {
      if (!standingHas(g.standing, P.MANAGE_ROLES) && !hasPermission(perms, P.MANAGE_ROLES)) { set.status = 403; return MISSING_PERMISSIONS; }
      const parent = byId.get(normalizeId(u.parentId))!;
      const parentPerms = await botChannelPermissions(auth.botUser.id, parent);
      if (!hasPermission(parentPerms, P.MANAGE_CHANNELS)) { set.status = 403; return MISSING_PERMISSIONS; }
      const bits = changedOverwriteBits(normalizeOverwrites(ch.permissionOverwrites), normalizeOverwrites(parent.permissionOverwrites));
      if (!canSetOverwriteBits({ standing: g.standing, perms }, bits)) { set.status = 403; return MISSING_PERMISSIONS; }
    } else if (u.parentId && !compareIds(u.parentId, ch.parentId ?? '')) {
      // Moving into a category needs Manage Channels there (like PATCH /channels/{id}).
      const parentPerms = await botChannelPermissions(auth.botUser.id, byId.get(normalizeId(u.parentId))!);
      if (!hasPermission(parentPerms, P.MANAGE_CHANNELS)) { set.status = 403; return MISSING_PERMISSIONS; }
    }
  }

  const finals = applyChannelPositions(all, updates);
  const reason = auditReason(headers['x-audit-log-reason']);
  for (const u of updates) {
    const ch = byId.get(normalizeId(u.id))!;
    const final = finals.get(ch.id);
    const change: Partial<typeof schema.channels.$inferInsert> = {};
    if (final) { change.position = final.position; change.parentId = final.parentId; }
    const lock = !!u.lockPermissions && !!u.parentId;
    if (lock) change.parentId = u.parentId;
    if (Object.keys(change).length === 0) continue;
    finals.delete(ch.id);
    await updateGuildChannel({ channel: ch, updates: change, actorId: auth.botUser.id, reason, lockPermissions: lock });
  }
  // Siblings that only shifted position: no audit entry (Discord doesn't log them either).
  const shifted = [...finals.entries()];
  for (const [id, final] of shifted) {
    await db.update(schema.channels).set({ position: final.position, updatedAt: new Date() }).where(eq(schema.channels.id, id));
  }
  if (shifted.length > 0) void guildEvents.emitChannelUpdates(g.server.id, shifted.map(([id]) => id));
  set.status = 204;
  return '';
})
.get('/guilds/:guildId/roles', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  if (!isValidObjectId(params.guildId)) { set.status = 404; return { code: 10004, message: 'Unknown Guild' }; }
  const roles = await Role.find({ serverId: params.guildId });
  return sortRoles(roles).map(formatRole);
})
.get('/guilds/:guildId/roles/member-counts', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  if (!isValidObjectId(params.guildId)) { set.status = 404; return { code: 10004, message: 'Unknown Guild' }; }
  // One grouped count over the members' role arrays (no member rows loaded).
  const rows = await db.execute(sql`
    SELECT r.role_id::text AS role_id, count(*)::int AS n
    FROM server_members m, unnest(m.roles) AS r(role_id)
    WHERE m.server_id = ${normalizeId(params.guildId)}
    GROUP BY r.role_id`);
  const roles = await Role.find({ serverId: params.guildId });
  const counts = new Map(((rows as unknown as { rows?: Array<{ role_id: string; n: number }> }).rows ?? (rows as unknown as Array<{ role_id: string; n: number }>))
    .map((r) => [String(r.role_id).toLowerCase(), Number(r.n)]));
  const out: Record<string, number> = {};
  for (const r of roles) if (!r.isDefault) out[r.id] = counts.get(r.id.toLowerCase()) ?? 0;
  return out;
})
.get('/guilds/:guildId/roles/:roleId', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  const role = isValidObjectId(params.roleId) ? await Role.findById(params.roleId) : null;
  if (!role || !compareIds(role.serverId, params.guildId)) { set.status = 404; return { code: 10011, message: 'Unknown Role' }; }
  return formatRole(role);
})
.get('/guilds/:guildId/members', async ({ headers, params, query, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  if (!isValidObjectId(params.guildId)) { set.status = 404; return { code: 10004, message: 'Unknown Guild' }; }
  // Listing members needs the privileged GUILD_MEMBERS intent enabled for the app (Discord).
  if ((allowedPrivilegedIntents(auth.app) & INTENT.GUILD_MEMBERS) === 0) { set.status = 403; return MISSING_ACCESS; }
  // Discord: limit 1..1000, default 1.
  const limit = parseListLimit(query.limit, 1, 1000);
  if (limit === null) { set.status = 400; return invalidFormBodyAt([{ path: ['limit'], code: 'NUMBER_TYPE_MAX', message: 'int value should be between 1 and 1000.' }]); }
  const after = typeof query.after === 'string' && isValidObjectId(query.after) ? query.after : null;
  // One page in SQL (ordered by user id, honouring `after`) instead of loading every member.
  const sliced = await ServerMember.listPage(params.guildId, { limit, afterUserId: after });
  return presentMembers(params.guildId, sliced);
})
.get('/guilds/:guildId/members/search', async ({ headers, params, query, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  if (!isValidObjectId(params.guildId)) { set.status = 404; return { code: 10004, message: 'Unknown Guild' }; }
  // Stricter than Discord: prefix searches would otherwise enumerate the member
  // list that GET /members keeps behind the privileged GUILD_MEMBERS intent.
  if ((allowedPrivilegedIntents(auth.app) & INTENT.GUILD_MEMBERS) === 0) { set.status = 403; return MISSING_ACCESS; }
  const q = typeof query.query === 'string' ? query.query.trim() : '';
  const limit = parseListLimit(query.limit, 1, 1000);
  if (!q || q.length > 100) { set.status = 400; return invalidFormBodyAt([{ path: ['query'], code: 'BASE_TYPE_REQUIRED', message: 'This field is required' }]); }
  if (limit === null) { set.status = 400; return invalidFormBodyAt([{ path: ['limit'], code: 'NUMBER_TYPE_MAX', message: 'int value should be between 1 and 1000.' }]); }
  // Prefix match on username, display name or server nickname (Discord).
  const like = likePrefix(q);
  const rows = await db.select({ member: schema.serverMembers })
    .from(schema.serverMembers)
    .innerJoin(schema.users, eq(schema.users.id, schema.serverMembers.userId))
    .where(and(
      eq(schema.serverMembers.serverId, normalizeId(params.guildId)),
      or(ilike(schema.users.username, like), ilike(schema.users.displayName, like), ilike(schema.serverMembers.nickname, like)),
    ))
    .orderBy(asc(schema.serverMembers.userId))
    .limit(limit);
  return presentMembers(params.guildId, rows.map((r) => r.member));
})
.get('/guilds/:guildId/members/:userId', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  if (!isValidObjectId(params.guildId) || !isValidObjectId(params.userId)) {
    set.status = 404; return { code: 10007, message: 'Unknown Member' };
  }
  const member = await ServerMember.findOne({ serverId: params.guildId, userId: params.userId });
  if (!member) { set.status = 404; return { code: 10007, message: 'Unknown Member' }; }
  const [one] = await presentMembers(params.guildId, [member]);
  return one;
})
.get('/guilds/:guildId/emojis', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  if (!isValidObjectId(params.guildId)) { set.status = 404; return { code: 10004, message: 'Unknown Guild' }; }
  const { listGuildEmojis } = await import('@/lib/botapi/expressions');
  return respond(set, await listGuildEmojis(params.guildId, auth.botUser.id));
})
.get('/guilds/:guildId/bans', async ({ headers, params, query, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  if (!isValidObjectId(params.guildId)) { set.status = 404; return { code: 10004, message: 'Unknown Guild' }; }
  // Ban lists (and their reasons) are moderator data: BAN_MEMBERS, like Discord.
  const g = await requireBotPerm(params.guildId, auth.botUser.id, P.BAN_MEMBERS);
  if (!g.ok) { set.status = g.status; return g.body; }
  // Discord: ordered by user id, limit 1..1000 (default 1000), before / after a user id.
  const limit = parseListLimit(query.limit, 1000, 1000);
  if (limit === null) { set.status = 400; return invalidFormBodyAt([{ path: ['limit'], code: 'NUMBER_TYPE_MAX', message: 'int value should be between 1 and 1000.' }]); }
  const before = typeof query.before === 'string' && isValidObjectId(query.before) ? normalizeId(query.before) : null;
  const after = typeof query.after === 'string' && isValidObjectId(query.after) ? normalizeId(query.after) : null;
  const where = [eq(schema.serverBans.serverId, normalizeId(params.guildId))];
  if (after) where.push(gt(schema.serverBans.userId, after));
  if (before && !after) where.push(lt(schema.serverBans.userId, before));
  let rows = await db.select().from(schema.serverBans).where(and(...where))
    .orderBy(before && !after ? desc(schema.serverBans.userId) : asc(schema.serverBans.userId))
    .limit(limit);
  if (before && !after) rows = rows.reverse();
  return presentBans(rows);
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
  // Threads follow Discord's thread rules (owner / MANAGE_THREADS), not MANAGE_CHANNELS (WP5).
  { const { patchBotThread } = await import('@/lib/botapi/threads'); const t = await patchBotThread(auth.botUser.id, params.channelId, body, headers); if (t) return respond(set, t); }

  // MANAGE_CHANNELS in this channel (overwrites apply). DMs are never editable here.
  const c = await requireChannelAction(params.channelId, auth.botUser.id, 'manage_channel');
  if (!c.ok) { set.status = c.status; return c.body; }
  const channel = c.channel;
  if (!channel.serverId) { set.status = 403; return MISSING_PERMISSIONS; }

  const {
    name, type, topic, position, nsfw, rate_limit_per_user, bitrate, user_limit, rtc_region,
    default_auto_archive_duration, parent_id, permission_overwrites, lock_permissions,
    available_tags, default_reaction_emoji, default_sort_order, default_forum_layout, default_thread_rate_limit_per_user, flags,
  } = (body ?? {}) as Record<string, unknown>;
  // Forum / media fields (WP5: src/lib/botapi/threads.ts), merged into the same write.
  const { forumPatchUpdates } = await import('@/lib/botapi/threads');
  const forum = forumPatchUpdates(channel, { available_tags, default_reaction_emoji, default_sort_order, default_forum_layout, default_thread_rate_limit_per_user, flags });
  if (forum && !forum.ok) return respond(set, forum);
  return applyBotChannelPatch(auth, channel, c.perms, {
    name, type, topic, position, nsfw, rate_limit_per_user, bitrate, user_limit, rtc_region,
    default_auto_archive_duration, parent_id, permission_overwrites, lock_permissions,
  }, headers, set, forum?.ok ? forum.updates : undefined);
})
.delete('/channels/:channelId', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  // Threads: MANAGE_THREADS, THREAD_DELETE (WP5).
  { const { deleteBotThread } = await import('@/lib/botapi/threads'); const t = await deleteBotThread(auth.botUser.id, params.channelId, headers); if (t) return respond(set, t); }

  const c = await requireChannelAction(params.channelId, auth.botUser.id, 'manage_channel');
  if (!c.ok) { set.status = c.status; return c.body; }
  // DMs and group DMs are never deleted through the bot API.
  if (!c.channel.serverId) { set.status = 403; return MISSING_PERMISSIONS; }
  // Same cascade as the web app: messages soft-deleted, a category's channels moved out, audit, CHANNEL_DELETE.
  await deleteGuildChannel({ channel: c.channel as typeof schema.channels.$inferSelect, actorId: auth.botUser.id, reason: auditReason(headers['x-audit-log-reason']) });
  return formatChannel(c.channel);
})
// Permission overwrites: MANAGE_ROLES (in the guild or through this channel's overwrites).
.put('/channels/:channelId/permissions/:overwriteId', async ({ headers, params, body, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  const ctx = await loadOverwriteContext(params.channelId, auth.botUser.id);
  if (!ctx.ok) { set.status = ctx.status; return ctx.body; }

  const { allow, deny, type } = (body ?? {}) as { allow?: unknown; deny?: unknown; type?: unknown };
  const errors = new GuildFormErrors();
  const parsed = parseOverwrite({ id: params.overwriteId, type, allow, deny }, errors, []);
  if (!parsed) { set.status = 400; return errors.toBody(); }
  const target = await resolveOverwriteTarget(ctx.channel.serverId!, ctx.roles, parsed);
  if (!target.ok) { set.status = target.status; return target.body; }

  const before = normalizeOverwrites(ctx.channel.permissionOverwrites);
  const key = (o: EditableOverwrite) => `${o.type}:${o.id.toLowerCase()}`;
  const next = [...before.filter((o) => key(o) !== key(target.overwrite)), target.overwrite];
  if (next.length > 100) { set.status = 400; return { code: 30059, message: 'Maximum number of permission overwrites reached (100)' }; }
  if (!canSetOverwriteBits(ctx, changedOverwriteBits(before, next))) { set.status = 403; return MISSING_PERMISSIONS; }
  await updateGuildChannel({
    channel: ctx.channel as typeof schema.channels.$inferSelect,
    updates: { permissionOverwrites: next },
    actorId: auth.botUser.id,
    reason: auditReason(headers['x-audit-log-reason']),
  });
  set.status = 204;
  return '';
})
.delete('/channels/:channelId/permissions/:overwriteId', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  const ctx = await loadOverwriteContext(params.channelId, auth.botUser.id);
  if (!ctx.ok) { set.status = ctx.status; return ctx.body; }

  // The guild id names the @everyone overwrite (Discord).
  const everyone = ctx.roles.find((r) => r.isDefault)?.id ?? null;
  const ids = new Set([params.overwriteId.toLowerCase()]);
  if (everyone && compareIds(params.overwriteId, ctx.channel.serverId!)) ids.add(everyone.toLowerCase());
  const before = normalizeOverwrites(ctx.channel.permissionOverwrites);
  const next = before.filter((o) => !ids.has(o.id.toLowerCase()));
  if (next.length !== before.length) {
    if (!canSetOverwriteBits(ctx, changedOverwriteBits(before, next))) { set.status = 403; return MISSING_PERMISSIONS; }
    await updateGuildChannel({
      channel: ctx.channel as typeof schema.channels.$inferSelect,
      updates: { permissionOverwrites: next },
      actorId: auth.botUser.id,
      reason: auditReason(headers['x-audit-log-reason']),
    });
  }
  set.status = 204;
  return '';
})
// Channel invites: list needs MANAGE_CHANNELS, create needs CREATE_INSTANT_INVITE (in the channel).
.get('/channels/:channelId/invites', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  const c = await requireChannelAction(params.channelId, auth.botUser.id, 'manage_channel');
  if (!c.ok) { set.status = c.status; return c.body; }
  if (!c.channel.serverId) { set.status = 403; return MISSING_PERMISSIONS; }
  const rows = await db.select().from(schema.invites).where(eq(schema.invites.channelId, c.channel.id));
  return rows.filter((i) => !i.isVanity).map(formatInvite);
})
.post('/channels/:channelId/invites', async ({ headers, params, body, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  if (!isValidObjectId(params.channelId)) { set.status = 404; return { code: 10003, message: 'Unknown Channel' }; }
  const channel = await Channel.findById(params.channelId);
  if (!channel) { set.status = 404; return { code: 10003, message: 'Unknown Channel' }; }
  if (!channel.serverId || isThreadChannel(channel) || channel.type === 'category') {
    set.status = 400; return { code: 50024, message: 'Cannot execute action on this channel type' };
  }
  const perms = await botChannelPermissions(auth.botUser.id, channel);
  if (!hasPermission(perms, P.VIEW_CHANNEL) || !hasPermission(perms, P.CREATE_INVITE)) { set.status = 403; return MISSING_PERMISSIONS; }
  const server = await Server.findById(channel.serverId);
  if (!server) { set.status = 404; return { code: 10004, message: 'Unknown Guild' }; }
  if ((server.settings as IServerSettings | undefined)?.invites?.lockToVanity && server.vanityUrlCode) {
    set.status = 403; return { code: 50013, message: 'This server only allows invites through its custom invite link' };
  }

  const { max_age, max_uses, temporary, unique } = (body ?? {}) as Record<string, unknown>;
  const errors = new GuildFormErrors();
  const int = (v: unknown, def: number, max: number, key: string) => {
    if (v === undefined || v === null) return def;
    const n = typeof v === 'number' ? v : Number(v);
    if (!Number.isInteger(n) || n < 0 || n > max) { errors.add([key], 'NUMBER_TYPE_MAX', `int value should be between 0 and ${max}.`); return def; }
    return n;
  };
  const maxAge = int(max_age, 86400, 604800, 'max_age');
  const maxUses = int(max_uses, 0, 100, 'max_uses');
  const isTemporary = temporary === true;
  if (!errors.ok) { set.status = 400; return errors.toBody(); }

  // Without `unique`, Discord hands back a matching live invite this bot already made.
  if (unique !== true) {
    const existing = await db.select().from(schema.invites).where(and(
      eq(schema.invites.channelId, channel.id),
      eq(schema.invites.inviterId, normalizeId(auth.botUser.id)),
      eq(schema.invites.maxAge, maxAge),
      eq(schema.invites.maxUses, maxUses),
      eq(schema.invites.temporary, isTemporary),
    )).limit(5);
    const live = existing.find((i) => (!i.expiresAt || i.expiresAt.getTime() > Date.now()) && (!i.maxUses || (i.uses ?? 0) < i.maxUses));
    if (live) return formatInvite(live);
  }
  const rl = await checkRateLimit('invite', `bot:${auth.botUser.id}`);
  if (!rl.success) { set.status = 429; return { message: 'You are being rate limited.', retry_after: rl.retryAfter ?? 1, global: false }; }

  const invite = await Invite.create({
    code: nanoid(8),
    serverId: server.id,
    channelId: channel.id,
    inviterId: auth.botUser.id,
    maxUses,
    maxAge,
    temporary: isTemporary,
    expiresAt: maxAge > 0 ? new Date(Date.now() + maxAge * 1000) : null,
  });
  audit({
    serverId: server.id,
    userId: auth.botUser.id,
    actionType: AuditLogEvent.INVITE_CREATE,
    targetId: invite.code,
    changes: [
      { key: 'code', new: invite.code },
      { key: 'channel_id', new: channel.id },
      { key: 'max_uses', new: maxUses },
      { key: 'max_age', new: maxAge },
      { key: 'temporary', new: isTemporary },
    ],
    options: { channel_name: channel.name },
    reason: auditReason(headers['x-audit-log-reason']),
  });
  void guildEvents.emitInviteCreate(invite);
  return formatInvite(invite);
})
// Follow an announcement channel into `webhook_channel_id` (MANAGE_WEBHOOKS there), like the web app.
.post('/channels/:channelId/followers', async ({ headers, params, body, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  const { webhook_channel_id } = (body ?? {}) as { webhook_channel_id?: unknown };
  if (typeof webhook_channel_id !== 'string' || !webhook_channel_id) {
    set.status = 400;
    return invalidFormBodyAt([{ path: ['webhook_channel_id'], code: 'BASE_TYPE_REQUIRED', message: 'This field is required' }]);
  }
  const { createChannelFollow } = await import('./announcements');
  const result = await createChannelFollow(auth.botUser.id, params.channelId, webhook_channel_id);
  if (!result.ok) {
    set.status = result.status;
    if (result.status === 429) return { message: 'You are being rate limited.', retry_after: 1, global: false };
    return { code: result.code, message: result.error };
  }
  return { channel_id: result.source.id, webhook_id: result.webhook.id };
})
// Group DM recipients. Adding someone needs their OAuth2 access token with gdm.join (Discord);
// removing needs the bot to own the group.
.put('/channels/:channelId/recipients/:userId', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  const channel = isValidObjectId(params.channelId) ? await Channel.findById(params.channelId) : null;
  if (!channel || channel.type !== 'group_dm') { set.status = 404; return { code: 10003, message: 'Unknown Channel' }; }
  set.status = 403;
  return { code: 50025, message: 'Invalid OAuth2 access token' };
})
.delete('/channels/:channelId/recipients/:userId', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  const channel = isValidObjectId(params.channelId) ? await Channel.findById(params.channelId) : null;
  if (!channel || channel.type !== 'group_dm') { set.status = 404; return { code: 10003, message: 'Unknown Channel' }; }
  if (!isValidObjectId(params.userId)) { set.status = 404; return { code: 10013, message: 'Unknown User' }; }
  const { removeGroupDmMember } = await import('./groupDms');
  const reply = await removeGroupDmMember(channel.id, auth.botUser as never, params.userId);
  if (reply.status === 404) { set.status = 404; return { code: 10013, message: 'Unknown User' }; }
  if (reply.status === 403) { set.status = 403; return MISSING_PERMISSIONS; }
  if (reply.status >= 400) { set.status = reply.status; return { code: 0, message: String(reply.body.error ?? 'Error') }; }
  set.status = 204;
  return '';
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
  // Threads: locked ones take moderators' messages only, archived ones reopen (WP5).
  if (isThread) { const { prepareThreadSend } = await import('@/lib/botapi/threads'); const gate = await prepareThreadSend(channel, c.perms); if (gate) return respond(set, gate); }

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
    // content / embeds / poll / sticker_ids must be absent with IS_COMPONENTS_V2.
    componentsV2Conflicts(componentErrors, { content, embeds, embed, poll: pollRequest, sticker_ids });
  }
  if (!componentErrors.ok) { set.status = 400; return componentErrors.toBody(); }
  let messageComponents = validatedComponents?.components ?? null;
  // A v2 message shows only its components (attachments appear through them).
  if (componentsV2 && !messageComponents?.length) { set.status = 400; return { code: 50006, message: 'Cannot send an empty message' }; }

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
      const refs = resolveAttachmentRefs(messageComponents, storedAttachments.map((a) => ({ id: String(a.id), filename: a.filename, url: a.url, contentType: a.contentType, width: a.width, height: a.height, size: a.size })));
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
    // Threads: the bot (and whoever it mentioned) joins; the chip / count refreshes (WP5).
    if (isThread) void import('@/lib/botapi/threads').then((m) => m.afterThreadSend(channel, botId, mentions.userIds, c.perms)).catch(() => {});

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
  // IS_COMPONENTS_V2 (already set, or turned on now): no text / embeds may be
  // left on the message, whether sent now or kept from before.
  const v2After = isComponentsV2(updates.flags ?? msg.flags ?? 0);
  if (isAuthor && v2After) {
    const v2Errors = new FormErrors();
    componentsV2Conflicts(v2Errors, { content, embeds, embed }, {
      content: Boolean(msg.content),
      embeds: Array.isArray(msg.embeds) && msg.embeds.length > 0,
    });
    if (!v2Errors.ok) { set.status = 400; return v2Errors.toBody(); }
  }
  // Components on edit (null / [] clears them), only the author's own.
  let nextComponents = parseStoredComponents(msg.components);
  if (components !== undefined && isAuthor) {
    const componentErrors = new FormErrors();
    const v = validateMessageComponents(components, { flags: updates.flags ?? msg.flags ?? 0, errors: componentErrors });
    if (!componentErrors.ok) { set.status = 400; return componentErrors.toBody(); }
    let list = v?.components ?? [];
    if (list.length) {
      const refs = resolveAttachmentRefs(list, nextAttachments.map((a) => ({ id: String(a.id), filename: a.filename, url: a.url, contentType: a.contentType, width: a.width, height: a.height, size: a.size })));
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
  // A v2 message shows only components, so it can't lose all of them.
  if (isAuthor && v2After && !nextComponents?.length) {
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
  const auth = await authenticateCommandsCaller(headers, 'read');
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  if (!ownsApp(auth, params.appId)) { set.status = 403; return MISSING_ACCESS; }
  const { listCommands, serializeCommand } = await import('@/lib/services/appCommands');
  return (await listCommands(auth.app.id, null)).map((c) => serializeCommand(c, auth.app.id));
})
.put('/applications/:appId/commands', async ({ headers, params, body, set }) => {
  const auth = await authenticateCommandsCaller(headers, 'write');
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  if (!ownsApp(auth, params.appId)) { set.status = 403; return MISSING_ACCESS; }
  const { bulkOverwriteCommands } = await import('@/lib/services/appCommands');
  return respond(set, await bulkOverwriteCommands(auth.app.id, null, body));
})
.post('/applications/:appId/commands', async ({ headers, params, body, set }) => {
  const auth = await authenticateCommandsCaller(headers, 'write');
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  if (!ownsApp(auth, params.appId)) { set.status = 403; return MISSING_ACCESS; }
  const { upsertCommand } = await import('@/lib/services/appCommands');
  return respond(set, await upsertCommand(auth.app.id, null, body));
})
.get('/applications/:appId/commands/:commandId', async ({ headers, params, set }) => {
  const auth = await authenticateCommandsCaller(headers, 'read');
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  if (!ownsApp(auth, params.appId)) { set.status = 403; return MISSING_ACCESS; }
  if (!isValidObjectId(params.commandId)) { set.status = 404; return UNKNOWN_COMMAND; }
  const { getCommand } = await import('@/lib/services/appCommands');
  return respond(set, await getCommand(auth.app.id, null, params.commandId));
})
.patch('/applications/:appId/commands/:commandId', async ({ headers, params, body, set }) => {
  const auth = await authenticateCommandsCaller(headers, 'write');
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  if (!ownsApp(auth, params.appId)) { set.status = 403; return MISSING_ACCESS; }
  if (!isValidObjectId(params.commandId)) { set.status = 404; return UNKNOWN_COMMAND; }
  const { patchCommand } = await import('@/lib/services/appCommands');
  return respond(set, await patchCommand(auth.app.id, null, params.commandId, body));
})
.delete('/applications/:appId/commands/:commandId', async ({ headers, params, set }) => {
  const auth = await authenticateCommandsCaller(headers, 'write');
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  if (!ownsApp(auth, params.appId)) { set.status = 403; return MISSING_ACCESS; }
  if (!isValidObjectId(params.commandId)) { set.status = 404; return UNKNOWN_COMMAND; }
  const { deleteCommand } = await import('@/lib/services/appCommands');
  return respond(set, await deleteCommand(auth.app.id, null, params.commandId));
})
.get('/applications/:appId/guilds/:guildId/commands', async ({ headers, params, set }) => {
  const auth = await authenticateCommandsCaller(headers, 'read');
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  const gc = await bearerGuildCommandsCheck(auth, params.guildId, 'read');
  if (gc) { set.status = gc.status; return gc.body; }
  if (!ownsApp(auth, params.appId)) { set.status = 403; return MISSING_ACCESS; }
  const { listCommands, serializeCommand } = await import('@/lib/services/appCommands');
  return (await listCommands(auth.app.id, params.guildId)).map((c) => serializeCommand(c, auth.app.id));
})
.put('/applications/:appId/guilds/:guildId/commands', async ({ headers, params, body, set }) => {
  const auth = await authenticateCommandsCaller(headers, 'write');
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  const gc = await bearerGuildCommandsCheck(auth, params.guildId, 'write');
  if (gc) { set.status = gc.status; return gc.body; }
  if (!ownsApp(auth, params.appId)) { set.status = 403; return MISSING_ACCESS; }
  const { bulkOverwriteCommands } = await import('@/lib/services/appCommands');
  return respond(set, await bulkOverwriteCommands(auth.app.id, params.guildId, body));
})
.post('/applications/:appId/guilds/:guildId/commands', async ({ headers, params, body, set }) => {
  const auth = await authenticateCommandsCaller(headers, 'write');
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  const gc = await bearerGuildCommandsCheck(auth, params.guildId, 'write');
  if (gc) { set.status = gc.status; return gc.body; }
  if (!ownsApp(auth, params.appId)) { set.status = 403; return MISSING_ACCESS; }
  const { upsertCommand } = await import('@/lib/services/appCommands');
  return respond(set, await upsertCommand(auth.app.id, params.guildId, body));
})
// Permissions v2. Discord only lets a Bearer token with
// applications.commands.permissions.update (of a user who can manage the
// guild and its roles) write these; SerikaCord also lets the app's own bot.
.get('/applications/:appId/guilds/:guildId/commands/permissions', async ({ headers, params, set }) => {
  const auth = await authenticateCommandsCaller(headers, 'read');
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  const gc = await bearerGuildCommandsCheck(auth, params.guildId, 'read');
  if (gc) { set.status = gc.status; return gc.body; }
  if (!ownsApp(auth, params.appId)) { set.status = 403; return MISSING_ACCESS; }
  const { listGuildCommandPermissions } = await import('@/lib/services/appCommands');
  return listGuildCommandPermissions(auth.app.id, params.guildId);
})
.get('/applications/:appId/guilds/:guildId/commands/:commandId', async ({ headers, params, set }) => {
  const auth = await authenticateCommandsCaller(headers, 'read');
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  const gc = await bearerGuildCommandsCheck(auth, params.guildId, 'read');
  if (gc) { set.status = gc.status; return gc.body; }
  if (!ownsApp(auth, params.appId)) { set.status = 403; return MISSING_ACCESS; }
  if (!isValidObjectId(params.commandId)) { set.status = 404; return UNKNOWN_COMMAND; }
  const { getCommand } = await import('@/lib/services/appCommands');
  return respond(set, await getCommand(auth.app.id, params.guildId, params.commandId));
})
.patch('/applications/:appId/guilds/:guildId/commands/:commandId', async ({ headers, params, body, set }) => {
  const auth = await authenticateCommandsCaller(headers, 'write');
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  const gc = await bearerGuildCommandsCheck(auth, params.guildId, 'write');
  if (gc) { set.status = gc.status; return gc.body; }
  if (!ownsApp(auth, params.appId)) { set.status = 403; return MISSING_ACCESS; }
  if (!isValidObjectId(params.commandId)) { set.status = 404; return UNKNOWN_COMMAND; }
  const { patchCommand } = await import('@/lib/services/appCommands');
  return respond(set, await patchCommand(auth.app.id, params.guildId, params.commandId, body));
})
.delete('/applications/:appId/guilds/:guildId/commands/:commandId', async ({ headers, params, set }) => {
  const auth = await authenticateCommandsCaller(headers, 'write');
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  const gc = await bearerGuildCommandsCheck(auth, params.guildId, 'write');
  if (gc) { set.status = gc.status; return gc.body; }
  if (!ownsApp(auth, params.appId)) { set.status = 403; return MISSING_ACCESS; }
  if (!isValidObjectId(params.commandId)) { set.status = 404; return UNKNOWN_COMMAND; }
  const { deleteCommand } = await import('@/lib/services/appCommands');
  return respond(set, await deleteCommand(auth.app.id, params.guildId, params.commandId));
})
.get('/applications/:appId/guilds/:guildId/commands/:commandId/permissions', async ({ headers, params, set }) => {
  const auth = await authenticateCommandsCaller(headers, 'read');
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  const gc = await bearerGuildCommandsCheck(auth, params.guildId, 'read');
  if (gc) { set.status = gc.status; return gc.body; }
  if (!ownsApp(auth, params.appId)) { set.status = 403; return MISSING_ACCESS; }
  const commandId = ownsApp(auth, params.commandId) ? auth.app.id : params.commandId;
  if (!isValidObjectId(commandId)) { set.status = 404; return UNKNOWN_COMMAND; }
  const { getCommandPermissions } = await import('@/lib/services/appCommands');
  return respond(set, await getCommandPermissions(auth.app.id, params.guildId, commandId));
})
.put('/applications/:appId/guilds/:guildId/commands/:commandId/permissions', async ({ headers, params, body, set }) => {
  const auth = await authenticateCommandsCaller(headers, 'permissions');
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  const gc = await bearerGuildCommandsCheck(auth, params.guildId, 'permissions');
  if (gc) { set.status = gc.status; return gc.body; }
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
// WP4b: src/lib/botapi/invites.ts
.get('/invites/:code', async ({ headers, params, query, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  // with_expiration is deprecated: expires_at is always returned.
  const { with_counts, guild_scheduled_event_id } = query as Record<string, string | undefined>;
  const { getInviteByCode } = await import('@/lib/botapi/invites');
  return respond(set, await getInviteByCode(params.code, { withCounts: with_counts === 'true', scheduledEventId: guild_scheduled_event_id ?? null }));
})
.delete('/invites/:code', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  const { deleteInviteByCode } = await import('@/lib/botapi/invites');
  return respond(set, await deleteInviteByCode(params.code, auth.botUser.id, headers));
})

// ─── Guild Channel CRUD ────────────────────────────────────
.post('/guilds/:guildId/channels', async ({ headers, params, body, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  if (!isValidObjectId(params.guildId)) { set.status = 404; return { code: 10004, message: 'Unknown Guild' }; }
  const g = await requireBotPerm(params.guildId, auth.botUser.id, P.MANAGE_CHANNELS);
  if (!g.ok) { set.status = g.status; return g.body; }

  const [{ n: channelCount } = { n: 0 }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.channels).where(eq(schema.channels.serverId, normalizeId(g.server.id)));
  if (Number(channelCount) >= config.MAX_CHANNELS_PER_SERVER) {
    set.status = 400;
    return { code: 30013, message: 'Maximum number of guild channels reached (500)' };
  }

  const {
    name, type, topic, bitrate, user_limit, rate_limit_per_user, position, permission_overwrites, parent_id, nsfw,
    rtc_region, default_auto_archive_duration,
  } = (body ?? {}) as Record<string, unknown>;
  const { fields, errors } = parseChannelFields({
    name, type, topic, bitrate, user_limit, rate_limit_per_user, position, permission_overwrites, parent_id, nsfw,
    rtc_region, default_auto_archive_duration,
  }, null, { clean: sanitizeInput });
  if (!errors.ok) { set.status = 400; return errors.toBody(); }
  const prepared = await prepareChannelWrite({ botId: auth.botUser.id, g, current: null, perms: g.standing.perms, fields });
  if (!prepared.ok) { set.status = prepared.status; return prepared.body; }
  const values = prepared.updates;
  const channelType = (values.type ?? 'text') as typeof schema.channels.$inferInsert['type'];

  // No explicit overwrites: start synced with the category, like the web app.
  let overwrites = values.permissionOverwrites as EditableOverwrite[] | undefined;
  if (overwrites === undefined && values.parentId) {
    const [parent] = await db.select().from(schema.channels).where(eq(schema.channels.id, normalizeId(values.parentId))).limit(1);
    overwrites = normalizeOverwrites(parent?.permissionOverwrites);
  }
  // Default position: after its siblings.
  let pos = values.position;
  if (pos === undefined) {
    const [{ max } = { max: null }] = await db.select({ max: sql<number | null>`max(${schema.channels.position})` }).from(schema.channels)
      .where(and(
        eq(schema.channels.serverId, normalizeId(g.server.id)),
        values.parentId ? eq(schema.channels.parentId, normalizeId(values.parentId)) : sql`${schema.channels.parentId} IS NULL`,
      ));
    pos = max === null || max === undefined ? 0 : Number(max) + 1;
  }

  // A channel created in an age-restricted category is age-restricted (CORD-60).
  let parentNsfw = false;
  if (values.parentId && channelType !== 'category') {
    const [parentRow] = await db.select({ nsfw: schema.channels.nsfw }).from(schema.channels).where(eq(schema.channels.id, normalizeId(values.parentId))).limit(1);
    parentNsfw = Boolean(parentRow?.nsfw);
  }

  const channel = await Channel.create({
    serverId: g.server.id,
    name: values.name ?? 'channel',
    type: channelType,
    topic: values.topic ?? null,
    nsfw: channelType === 'category' ? false : (values.nsfw ?? false) || parentNsfw,
    parentId: values.parentId ?? null,
    rateLimitPerUser: values.rateLimitPerUser ?? 0,
    position: pos,
    bitrate: values.bitrate ?? 64000,
    userLimit: values.userLimit ?? 0,
    rtcRegion: values.rtcRegion ?? null,
    ...(values.defaultAutoArchiveDuration !== undefined ? { defaultAutoArchiveDuration: values.defaultAutoArchiveDuration } : {}),
    recipientIds: [],
    permissionOverwrites: overwrites ?? [],
    ...(channelType === 'forum' ? { forumMode: 'posts' as const } : {}),
  });
  audit({
    serverId: g.server.id,
    userId: auth.botUser.id,
    actionType: AuditLogEvent.CHANNEL_CREATE,
    targetId: channel.id,
    changes: [
      ...snapshotChanges(channel as Record<string, unknown>, { name: 'name', type: 'type', nsfw: 'nsfw', parentId: 'parent_id' }),
      ...((overwrites ?? []).length ? [{ key: 'permission_overwrites', new: overwrites }] : []),
    ],
    options: { channel_name: channel.name, channel_type: channel.type },
    reason: auditReason(headers['x-audit-log-reason']),
  });
  void guildEvents.emitChannelCreate(channel);
  set.status = 201;
  return formatChannel(channel);
})
// Serika extra (no Discord counterpart): same as PATCH /channels/{id}, scoped to the guild.
.patch('/guilds/:guildId/channels/:channelId', async ({ headers, params, body, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  const c = await requireChannelAction(params.channelId, auth.botUser.id, 'manage_channel');
  if (!c.ok) { set.status = c.status; return c.body; }
  const channel = c.channel;
  if (!channel.serverId || !compareIds(channel.serverId, params.guildId) || isThreadChannel(channel)) { set.status = 404; return { code: 10003, message: 'Unknown Channel' }; }
  return applyBotChannelPatch(auth, channel, c.perms, (body ?? {}) as Record<string, unknown>, headers, set);
})
.delete('/guilds/:guildId/channels/:channelId', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  const c = await requireChannelAction(params.channelId, auth.botUser.id, 'manage_channel');
  if (!c.ok) { set.status = c.status; return c.body; }
  if (!c.channel.serverId || !compareIds(c.channel.serverId, params.guildId) || isThreadChannel(c.channel)) { set.status = 404; return { code: 10003, message: 'Unknown Channel' }; }
  await deleteGuildChannel({ channel: c.channel as typeof schema.channels.$inferSelect, actorId: auth.botUser.id, reason: auditReason(headers['x-audit-log-reason']) });
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
  if (g.roles.length >= config.MAX_ROLES_PER_SERVER) { set.status = 400; return { code: 30005, message: 'Maximum number of guild roles reached (250)' }; }

  const { name, permissions, color, colors, hoist, icon, unicode_emoji, mentionable } = (body ?? {}) as Record<string, unknown>;
  const { fields, errors } = parseRoleFields({ name, permissions, color, colors, hoist, icon, unicode_emoji, mentionable }, { clean: sanitizeInput });
  if (!errors.ok) { set.status = 400; return errors.toBody(); }
  // Default permissions are @everyone's (Discord), limited to what the bot holds.
  const everyone = g.roles.find((r) => r.isDefault);
  let permBits = fields.permissions;
  if (permBits === undefined) {
    permBits = parseBitfield(everyone?.permissions ?? '0') ?? 0n;
    if (!canGrantBits(g.standing, permBits)) permBits &= g.standing.perms;
  } else if (!canGrantBits(g.standing, permBits)) {
    set.status = 403; return MISSING_PERMISSIONS;
  }
  const iconFields = await roleIconFields(fields, g.server.id, auth.botUser.id);
  if (!iconFields.ok) { set.status = 400; return iconFields.body; }

  // New roles start at the bottom (position 1, just above @everyone), like Discord.
  const shifted = g.roles.filter((r) => !r.isDefault && (r.position ?? 0) >= 1);
  if (shifted.length > 0) {
    await db.update(schema.roles)
      .set({ position: sql`${schema.roles.position} + 1` })
      .where(and(eq(schema.roles.serverId, normalizeId(g.server.id)), eq(schema.roles.isDefault, false), sql`${schema.roles.position} >= 1`));
  }
  const role = await Role.create({
    serverId: g.server.id,
    name: fields.name ?? 'new role',
    color: fields.color ?? 0,
    hoist: fields.hoist ?? false,
    permissions: String(permBits),
    mentionable: fields.mentionable ?? false,
    position: 1,
    isDefault: false,
    managed: false,
    ...iconFields.values,
  });
  invalidateRolePerms(g.server.id);
  audit({
    serverId: g.server.id,
    userId: auth.botUser.id,
    actionType: AuditLogEvent.ROLE_CREATE,
    targetId: role.id,
    changes: snapshotChanges(role as Record<string, unknown>, ROLE_AUDIT_KEYS),
    options: { role_name: role.name },
    reason: auditReason(headers['x-audit-log-reason']),
  });
  void (async () => {
    await guildEvents.emitRoleCreate(g.server.id, role.id);
    await guildEvents.emitRolesUpdate(g.server.id, shifted.map((r) => r.id));
  })();
  return formatRole(role);
})
.patch('/guilds/:guildId/roles', async ({ headers, params, body, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  const g = await requireBotPerm(params.guildId, auth.botUser.id, P.MANAGE_ROLES);
  if (!g.ok) { set.status = g.status; return g.body; }
  const { updates, errors } = parseRolePositions(body);
  if (!errors.ok) { set.status = 400; return errors.toBody(); }
  const r = await reorderGuildRoles(g, auth.botUser.id, updates);
  if (!r.ok) { set.status = r.status; return r.body; }
  const roles = await Role.find({ serverId: g.server.id });
  return sortRoles(roles).map(formatRole);
})
.patch('/guilds/:guildId/roles/:roleId', async ({ headers, params, body, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  const role = isValidObjectId(params.roleId) ? await Role.findById(params.roleId) : null;
  if (!role || !compareIds(role.serverId, params.guildId)) { set.status = 404; return { code: 10011, message: 'Unknown Role' }; }
  const g = await requireBotPerm(params.guildId, auth.botUser.id, P.MANAGE_ROLES);
  if (!g.ok) { set.status = g.status; return g.body; }
  // Role hierarchy: only roles below the bot's top role (the @everyone role
  // sits at the bottom and is editable with Manage Roles). Integration roles stay as they are.
  if (!role.isDefault && (role.managed || !outranks(g.standing, role.position ?? 0))) { set.status = 403; return MISSING_PERMISSIONS; }

  const { name, permissions, color, colors, hoist, icon, unicode_emoji, mentionable, position } = (body ?? {}) as Record<string, unknown>;
  const { fields, errors } = parseRoleFields({ name, permissions, color, colors, hoist, icon, unicode_emoji, mentionable, position }, { clean: sanitizeInput });
  if (!errors.ok) { set.status = 400; return errors.toBody(); }
  if (role.isDefault && (fields.name !== undefined || fields.icon !== undefined || fields.unicodeEmoji !== undefined)) {
    set.status = 400; return invalidFormBodyAt([{ path: [fields.name !== undefined ? 'name' : 'icon'], code: 'ROLE_INVALID', message: 'The @everyone role cannot be renamed or given an icon' }]);
  }
  const updates: Partial<typeof schema.roles.$inferInsert> = {};
  if (fields.name !== undefined) updates.name = fields.name;
  if (fields.color !== undefined) updates.color = fields.color;
  if (fields.hoist !== undefined) updates.hoist = fields.hoist;
  if (fields.mentionable !== undefined) updates.mentionable = fields.mentionable;
  if (fields.permissions !== undefined) {
    // Only bits being added need to be held (removing is always fine).
    const prev = parseBitfield(role.permissions ?? '0') ?? 0n;
    if (!canGrantBits(g.standing, fields.permissions & ~prev)) { set.status = 403; return MISSING_PERMISSIONS; }
    updates.permissions = String(fields.permissions);
  }
  const iconFields = await roleIconFields(fields, g.server.id, auth.botUser.id);
  if (!iconFields.ok) { set.status = 400; return iconFields.body; }
  Object.assign(updates, iconFields.values);

  if (fields.position !== undefined && !role.isDefault) {
    const r = await reorderGuildRoles(g, auth.botUser.id, [{ id: role.id, position: fields.position }]);
    if (!r.ok) { set.status = r.status; return r.body; }
  }
  const updated = Object.keys(updates).length > 0 ? await Role.updateById(role.id, updates) : await Role.findById(role.id);
  if (updates.permissions !== undefined) invalidateRolePerms(g.server.id, role.id);
  const changes = diffChanges(role as Record<string, unknown>, updates as Record<string, unknown>, ROLE_AUDIT_KEYS);
  if (changes.length > 0) {
    audit({
      serverId: g.server.id, userId: auth.botUser.id, actionType: AuditLogEvent.ROLE_UPDATE, targetId: role.id, changes,
      options: { role_name: updated?.name ?? role.name }, reason: auditReason(headers['x-audit-log-reason']),
    });
  }
  if (Object.keys(updates).length > 0) void guildEvents.emitRoleUpdate(g.server.id, role.id);
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
  // Take the role off every member (one statement), like the web app.
  await db.update(schema.serverMembers)
    .set({ roles: sql`array_remove(${schema.serverMembers.roles}, ${role.id}::uuid)` })
    .where(and(eq(schema.serverMembers.serverId, normalizeId(g.server.id)), sql`${schema.serverMembers.roles} @> ARRAY[${role.id}]::uuid[]`));
  await Role.deleteById(role.id);
  invalidateRolePerms(g.server.id, role.id);
  audit({
    serverId: g.server.id, userId: auth.botUser.id, actionType: AuditLogEvent.ROLE_DELETE, targetId: role.id,
    changes: snapshotChanges(role as Record<string, unknown>, ROLE_AUDIT_KEYS, 'old'),
    options: { role_name: role.name }, reason: auditReason(headers['x-audit-log-reason']),
  });
  void guildEvents.emitRoleDelete(g.server.id, role.id);
  set.status = 204;
  return '';
})

// ─── Guild Member Management ───────────────────────────────
.patch('/guilds/:guildId/members/@me', async ({ headers, params, body, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  // Discord's `bio` has no per-server storage here and is ignored.
  const { nick, avatar, banner } = (body ?? {}) as { nick?: unknown; avatar?: unknown; banner?: unknown };
  return patchBotMember(auth, params.guildId, auth.botUser.id, { nick, avatar, banner }, headers, set);
})
.patch('/guilds/:guildId/members/:userId', async ({ headers, params, body, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  const { nick, roles, mute, deaf, channel_id, communication_disabled_until, flags } = (body ?? {}) as Record<string, unknown>;
  return patchBotMember(auth, params.guildId, params.userId, { nick, roles, mute, deaf, channel_id, communication_disabled_until, flags }, headers, set);
})
// Deprecated alias of PATCH /guilds/{id}/members/@me (returns the nickname).
.patch('/guilds/:guildId/members/@me/nick', async ({ headers, params, body, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  const { nick } = (body ?? {}) as { nick?: unknown };
  const r = await patchBotMember(auth, params.guildId, auth.botUser.id, { nick }, headers, set);
  return r && typeof r === 'object' && 'nick' in r ? (r as { nick: string | null }).nick : r;
})
.put('/guilds/:guildId/members/:userId/roles/:roleId', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  return changeMemberRole(auth, params.guildId, params.userId, params.roleId, 'add', headers, set);
})
.delete('/guilds/:guildId/members/:userId/roles/:roleId', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  return changeMemberRole(auth, params.guildId, params.userId, params.roleId, 'remove', headers, set);
})
// Add Guild Member needs the user's OAuth2 access token with guilds.join (Discord).
.put('/guilds/:guildId/members/:userId', async ({ headers, params, body, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  if (!isValidObjectId(params.userId)) { set.status = 404; return { code: 10013, message: 'Unknown User' }; }
  const existing = await ServerMember.findOne({ serverId: params.guildId, userId: params.userId });
  if (existing) { set.status = 204; return ''; }
  const { access_token, nick, roles, mute, deaf } = (body ?? {}) as { access_token?: unknown; nick?: unknown; roles?: unknown; mute?: unknown; deaf?: unknown };
  if (typeof access_token !== 'string' || !access_token) {
    set.status = 400;
    return invalidFormBodyAt([{ path: ['access_token'], code: 'BASE_TYPE_REQUIRED', message: 'This field is required' }]);
  }
  // The bot needs CREATE_INSTANT_INVITE; the token must be the user's own,
  // granted to this bot's application with guilds.join (src/lib/oauth/guildsJoin.ts).
  const g = await requireBotPerm(params.guildId, auth.botUser.id, P.CREATE_INVITE);
  if (!g.ok) { set.status = g.status; return g.body; }
  const { resolveGuildsJoinGrant } = await import('@/lib/oauth/guildsJoin');
  const grant = await resolveGuildsJoinGrant(access_token, params.userId, { applicationId: auth.app.id });
  if (!grant.ok) { set.status = grant.status; return grant.body; }
  const user = await User.findById(params.userId);
  if (!user || user.isBanned) { set.status = 404; return { code: 10013, message: 'Unknown User' }; }
  if (await ServerBan.findOne({ serverId: g.server.id, userId: user.id })) {
    set.status = 403; return { code: 40007, message: 'The user is banned from this guild.' };
  }
  // Optional fields need the matching permission, like PATCH.
  const deny = () => { set.status = 403; return MISSING_PERMISSIONS; };
  const errs: Array<{ path: Array<string | number>; code: string; message: string }> = [];
  const everyone = g.roles.find((r) => r.isDefault)?.id ?? null;
  let nickname: string | null = null;
  if (nick !== undefined && nick !== null) {
    if (typeof nick !== 'string' || nick.length > 32) errs.push({ path: ['nick'], code: 'BASE_TYPE_MAX_LENGTH', message: 'Must be 32 or fewer in length.' });
    else if (!standingHas(g.standing, P.MANAGE_NICKNAMES)) return deny();
    else nickname = nick.trim() || null;
  }
  const roleIds: string[] = [];
  if (roles !== undefined && roles !== null) {
    if (!Array.isArray(roles)) errs.push({ path: ['roles'], code: 'BASE_TYPE_BAD_TYPE', message: 'Must be an array.' });
    else {
      if (roles.length > 0 && !standingHas(g.standing, P.MANAGE_ROLES)) return deny();
      for (const [i, id] of roles.entries()) {
        const r = typeof id === 'string' ? g.roles.find((x) => compareIds(x.id, id)) : undefined;
        if (!r) { errs.push({ path: ['roles', i], code: 'UNKNOWN_ROLE', message: 'Unknown role' }); continue; }
        if (r.isDefault) continue;
        if (r.managed || !outranks(g.standing, r.position ?? 0)) return deny();
        if (!roleIds.includes(r.id)) roleIds.push(r.id);
      }
    }
  }
  for (const [key, value, bit] of [['mute', mute, P.MUTE_MEMBERS], ['deaf', deaf, P.DEAFEN_MEMBERS]] as const) {
    if (value === undefined || value === null) continue;
    if (typeof value !== 'boolean') errs.push({ path: [key], code: 'BASE_TYPE_BAD_TYPE', message: 'Must be either true or false.' });
    else if (value && !standingHas(g.standing, bit)) return deny();
  }
  if (errs.length > 0) { set.status = 400; return invalidFormBodyAt(errs); }
  // Same per-user server cap as invite joins.
  if ((await ServerMember.countByUser(user.id)) >= config.MAX_SERVERS_PER_USER) {
    set.status = 400;
    return { code: 30001, message: `Maximum number of guilds reached (${config.MAX_SERVERS_PER_USER})` };
  }
  // insertServerMember applies rules screening (pending) and sends GUILD_MEMBER_ADD.
  const { insertServerMember } = await import('@/lib/services/serverMembership');
  if (roleIds.length > 0) {
    // Linked roles (CORD-57), limited to roles the bot could assign itself.
    const byId = new Map(g.roles.map((r) => [normalizeId(r.id), r]));
    const expanded = expandLinkedRoles({
      current: [],
      next: roleIds.map(normalizeId),
      links: readRoleLinks(g.server.settings, g.roles),
      canAdd: (id) => { const r = byId.get(id); return Boolean(r) && !r!.isDefault && !r!.managed && outranks(g.standing, r!.position ?? 0); },
    });
    for (const id of expanded.slice(roleIds.length)) roleIds.push(byId.get(id)!.id);
  }
  const { membership, created } = await insertServerMember(g.server.id, user.id, {
    roles: everyone ? [everyone, ...roleIds] : roleIds,
    ...(nickname ? { nickname } : {}),
    ...(mute === true ? { mute: true } : {}),
    ...(deaf === true ? { deaf: true } : {}),
  });
  if (!membership) { set.status = 500; return { code: 0, message: '500: Internal Server Error' }; }
  if (!created) { set.status = 204; return ''; }
  set.status = 201;
  return formatMember(membership, user, everyone);
})
.delete('/guilds/:guildId/members/:userId', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  if (!isValidObjectId(params.guildId) || !isValidObjectId(params.userId)) {
    set.status = 404; return { code: 10007, message: 'Unknown Member' };
  }
  const g = await requireBotPerm(params.guildId, auth.botUser.id, P.KICK_MEMBERS);
  if (!g.ok) { set.status = g.status; return g.body; }
  if (compareIds(g.server.ownerId, params.userId) || compareIds(params.userId, auth.botUser.id)) { set.status = 403; return MISSING_PERMISSIONS; }
  const member = await ServerMember.findOne({ serverId: params.guildId, userId: params.userId });
  if (!member) { set.status = 404; return { code: 10007, message: 'Unknown Member' }; }
  if (!outranks(g.standing, memberTopPosition(g.roles, (member.roles || []) as string[]))) {
    set.status = 403; return MISSING_PERMISSIONS;
  }
  // Only decrements memberCount (atomically) when a member was really removed;
  // GUILD_MEMBER_REMOVE is sent by removeServerMember.
  await removeServerMember(params.guildId, params.userId);
  botAudit(params.guildId, auth.botUser.id, AuditLogEvent.MEMBER_KICK, params.userId, headers);
  set.status = 204;
  return '';
})
// Prune: members without roles (or only `include_roles`) not seen for `days` (KICK_MEMBERS + MANAGE_GUILD).
.get('/guilds/:guildId/prune', async ({ headers, params, query, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  const g = await requireBotPerm(params.guildId, auth.botUser.id, P.KICK_MEMBERS | P.MANAGE_SERVER);
  if (!g.ok) { set.status = g.status; return g.body; }
  const { options, errors } = parsePruneOptions({ days: query.days, include_roles: query.include_roles }, 'GET');
  if (!errors.ok) { set.status = 400; return errors.toBody(); }
  const targets = await pruneTargets(g, auth.botUser.id, options);
  if (!targets.ok) { set.status = targets.status; return targets.body; }
  return { pruned: targets.userIds.length };
})
.post('/guilds/:guildId/prune', async ({ headers, params, body, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  const g = await requireBotPerm(params.guildId, auth.botUser.id, P.KICK_MEMBERS | P.MANAGE_SERVER);
  if (!g.ok) { set.status = g.status; return g.body; }
  const { days, include_roles, compute_prune_count, reason } = (body ?? {}) as Record<string, unknown>;
  const { options, errors } = parsePruneOptions({ days, include_roles, compute_prune_count }, 'POST');
  if (!errors.ok) { set.status = 400; return errors.toBody(); }
  const targets = await pruneTargets(g, auth.botUser.id, options);
  if (!targets.ok) { set.status = targets.status; return targets.body; }
  let removed = 0;
  for (const userId of targets.userIds) {
    if (await removeServerMember(g.server.id, userId)) removed++;
  }
  if (removed > 0) {
    audit({
      serverId: g.server.id, userId: auth.botUser.id, actionType: AuditLogEvent.MEMBER_PRUNE, targetId: null,
      options: { delete_member_days: String(options.days), members_removed: String(removed) },
      reason: auditReason(headers['x-audit-log-reason'], typeof reason === 'string' ? reason : null),
    });
  }
  return { pruned: options.computeCount ? removed : null };
})

// ─── Guild Bans ────────────────────────────────────────────
.put('/guilds/:guildId/bans/:userId', async ({ headers, params, body, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  if (!isValidObjectId(params.guildId) || !isValidObjectId(params.userId)) {
    set.status = 404; return { code: 10013, message: 'Unknown User' };
  }
  const g = await requireBotPerm(params.guildId, auth.botUser.id, P.BAN_MEMBERS);
  if (!g.ok) { set.status = g.status; return g.body; }
  const { delete_message_seconds, delete_message_days, reason } = (body ?? {}) as Record<string, unknown>;
  const errors = new GuildFormErrors();
  const deleteSeconds = parseDeleteMessageSeconds({ delete_message_seconds, delete_message_days }, errors);
  if (!errors.ok) { set.status = 400; return errors.toBody(); }
  const r = await banOne(g, auth.botUser.id, params.userId, deleteSeconds, auditReason(headers['x-audit-log-reason'], typeof reason === 'string' ? reason : null));
  if (!r.ok) { set.status = r.status; return r.body; }
  set.status = 204;
  return '';
})
.post('/guilds/:guildId/bulk-ban', async ({ headers, params, body, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  // Discord: BAN_MEMBERS and MANAGE_GUILD.
  const g = await requireBotPerm(params.guildId, auth.botUser.id, P.BAN_MEMBERS | P.MANAGE_SERVER);
  if (!g.ok) { set.status = g.status; return g.body; }
  const { user_ids, delete_message_seconds } = (body ?? {}) as Record<string, unknown>;
  const { userIds, deleteMessageSeconds, errors } = parseBulkBan({ user_ids, delete_message_seconds });
  if (!errors.ok) { set.status = 400; return errors.toBody(); }
  const reason = auditReason(headers['x-audit-log-reason']);
  const banned: string[] = [];
  const failed: string[] = [];
  const budget = { left: BULK_BAN_PURGE_BUDGET };
  for (const id of userIds) {
    const r = isValidObjectId(id) ? await banOne(g, auth.botUser.id, id, deleteMessageSeconds, reason, budget) : { ok: false as const };
    (r.ok ? banned : failed).push(id);
  }
  if (banned.length === 0) { set.status = 400; return { code: 500000, message: 'Failed to ban users' }; }
  return { banned_users: banned, failed_users: failed };
})
.get('/guilds/:guildId/bans/:userId', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  const g = await requireBotPerm(params.guildId, auth.botUser.id, P.BAN_MEMBERS);
  if (!g.ok) { set.status = g.status; return g.body; }
  if (!isValidObjectId(params.userId)) { set.status = 404; return { code: 10026, message: 'Unknown Ban' }; }
  const ban = await ServerBan.findOne({ serverId: params.guildId, userId: params.userId });
  if (!ban) { set.status = 404; return { code: 10026, message: 'Unknown Ban' }; }
  const [one] = await presentBans([ban]);
  return one;
})
.delete('/guilds/:guildId/bans/:userId', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  const g = await requireBotPerm(params.guildId, auth.botUser.id, P.BAN_MEMBERS);
  if (!g.ok) { set.status = g.status; return g.body; }
  if (!isValidObjectId(params.userId)) { set.status = 404; return { code: 10026, message: 'Unknown Ban' }; }
  // GUILD_BAN_REMOVE is sent by removeServerBan.
  const removed = await removeServerBan(params.guildId, params.userId);
  if (!removed) { set.status = 404; return { code: 10026, message: 'Unknown Ban' }; }
  botAudit(params.guildId, auth.botUser.id, AuditLogEvent.MEMBER_BAN_REMOVE, params.userId, headers);
  set.status = 204;
  return '';
})

// ─── Guild Emoji CRUD (WP4b: src/lib/botapi/expressions.ts) ─
.get('/guilds/:guildId/emojis/:emojiId', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  const { getGuildEmoji } = await import('@/lib/botapi/expressions');
  return respond(set, await getGuildEmoji(params.guildId, params.emojiId, auth.botUser.id));
})
.post('/guilds/:guildId/emojis', async ({ headers, params, body, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  const { name, image, roles } = (body ?? {}) as { name?: unknown; image?: unknown; roles?: unknown };
  const { createGuildEmoji } = await import('@/lib/botapi/expressions');
  return respond(set, await createGuildEmoji(params.guildId, auth.botUser.id, { name, image, roles }, headers));
})
.patch('/guilds/:guildId/emojis/:emojiId', async ({ headers, params, body, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  const { name, roles } = (body ?? {}) as { name?: unknown; roles?: unknown };
  const { updateGuildEmoji } = await import('@/lib/botapi/expressions');
  return respond(set, await updateGuildEmoji(params.guildId, params.emojiId, auth.botUser.id, { name, roles }, headers));
})
.delete('/guilds/:guildId/emojis/:emojiId', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  const { deleteGuildEmoji } = await import('@/lib/botapi/expressions');
  return respond(set, await deleteGuildEmoji(params.guildId, params.emojiId, auth.botUser.id, headers));
})

// ─── Guild Stickers (WP4b) ─────────────────────────────────
.get('/guilds/:guildId/stickers', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  const { listGuildStickers } = await import('@/lib/botapi/expressions');
  return respond(set, await listGuildStickers(params.guildId, auth.botUser.id));
})
.get('/guilds/:guildId/stickers/:stickerId', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  const { getGuildSticker } = await import('@/lib/botapi/expressions');
  return respond(set, await getGuildSticker(params.guildId, params.stickerId, auth.botUser.id));
})
.post('/guilds/:guildId/stickers', async ({ headers, params, body, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  // Multipart form: name, description, tags + file (PNG / APNG / GIF / Lottie JSON, 512 KiB).
  const { name, description, tags, file } = (body ?? {}) as { name?: unknown; description?: unknown; tags?: unknown; file?: unknown };
  const { createGuildSticker } = await import('@/lib/botapi/expressions');
  const upload = file && typeof file === 'object' && typeof (file as { arrayBuffer?: unknown }).arrayBuffer === 'function'
    ? (file as Parameters<typeof createGuildSticker>[3])
    : null;
  return respond(set, await createGuildSticker(params.guildId, auth.botUser.id, { name, description, tags }, upload, headers));
})
.patch('/guilds/:guildId/stickers/:stickerId', async ({ headers, params, body, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  const { name, description, tags } = (body ?? {}) as { name?: unknown; description?: unknown; tags?: unknown };
  const { updateGuildSticker } = await import('@/lib/botapi/expressions');
  return respond(set, await updateGuildSticker(params.guildId, params.stickerId, auth.botUser.id, { name, description, tags }, headers));
})
.delete('/guilds/:guildId/stickers/:stickerId', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  const { deleteGuildSticker } = await import('@/lib/botapi/expressions');
  return respond(set, await deleteGuildSticker(params.guildId, params.stickerId, auth.botUser.id, headers));
})
.get('/stickers/:stickerId', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  const { getStickerById } = await import('@/lib/botapi/expressions');
  return respond(set, await getStickerById(params.stickerId, auth.botUser.id));
})
// Serika has no standard (Nitro) sticker packs.
.get('/sticker-packs', async ({ headers, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  return { sticker_packs: [] };
})
.get('/sticker-packs/:packId', async ({ headers, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  set.status = 404;
  return { code: 10061, message: 'Unknown Sticker Pack' };
})

// ─── Application emojis (WP4b) ─────────────────────────────
.get('/applications/:appId/emojis', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  if (!ownsApp(auth, params.appId)) { set.status = 403; return MISSING_ACCESS; }
  const { listAppEmojis } = await import('@/lib/botapi/expressions');
  return respond(set, await listAppEmojis(auth.app));
})
.get('/applications/:appId/emojis/:emojiId', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  if (!ownsApp(auth, params.appId)) { set.status = 403; return MISSING_ACCESS; }
  const { getAppEmoji } = await import('@/lib/botapi/expressions');
  return respond(set, await getAppEmoji(auth.app, params.emojiId));
})
.post('/applications/:appId/emojis', async ({ headers, params, body, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  if (!ownsApp(auth, params.appId)) { set.status = 403; return MISSING_ACCESS; }
  const { name, image } = (body ?? {}) as { name?: unknown; image?: unknown };
  const { createAppEmoji } = await import('@/lib/botapi/expressions');
  return respond(set, await createAppEmoji(auth.app, auth.botUser.id, { name, image }));
})
.patch('/applications/:appId/emojis/:emojiId', async ({ headers, params, body, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  if (!ownsApp(auth, params.appId)) { set.status = 403; return MISSING_ACCESS; }
  const { name } = (body ?? {}) as { name?: unknown };
  const { updateAppEmoji } = await import('@/lib/botapi/expressions');
  return respond(set, await updateAppEmoji(auth.app, params.emojiId, { name }));
})
.delete('/applications/:appId/emojis/:emojiId', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  if (!ownsApp(auth, params.appId)) { set.status = 403; return MISSING_ACCESS; }
  const { deleteAppEmoji } = await import('@/lib/botapi/expressions');
  return respond(set, await deleteAppEmoji(auth.app, params.emojiId));
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

  // Discord: name (1-80, no "clyde" / "discord") and avatar as image data.
  const { createChannelWebhook, serializeWebhook } = await import('@/lib/services/channelWebhooks');
  const created = await createChannelWebhook({
    channel: { id: channel.id, serverId: channel.serverId },
    body: (body ?? {}) as { name?: unknown; avatar?: unknown },
    creatorId: auth.botUser.id,
    applicationId: auth.app.id,
  });
  if (!created.ok) { set.status = created.status; return created.body; }
  const webhook = created.webhook;
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
    // Another app's webhook token stays with that app.
    viewerAppId: auth.app.id,
    actorId: auth.botUser.id,
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
  const { removeWebhook } = await import('@/lib/services/channelWebhooks');
  await removeWebhook(webhook);
  set.status = 204;
  return '';
})

// ─── Webhook router (token routes, no bot auth) ────────────
// /webhooks/{id}/{token} is either a channel webhook (id = webhook id, token
// compared in constant time) or an interaction (id = application id, token =
// interaction token: followups and @original). Interaction tokens are tried
// first; they're random 64-byte values looked up by hash.
.post('/webhooks/:webhookId/:webhookToken', async ({ params, body, query, request, set }) => {
  const { resolveInteractionWebhook, createFollowup, withAppIds } = await import('@/lib/services/interactions');
  const ix = await resolveInteractionWebhook(params.webhookId, params.webhookToken);
  if (ix) return respond(set, await withAppIds(ix.applicationId, body, (b) => createFollowup(ix, b)));
  const { findWebhookByToken, executeWebhook, runWebhookTokenRoute } = await import('@/lib/services/channelWebhooks');
  const webhook = await findWebhookByToken(params.webhookId, params.webhookToken);
  if (!webhook) { set.status = 404; return { code: 10015, message: 'Unknown Webhook' }; }
  const { wait, thread_id, with_components } = query as Record<string, string | undefined>;
  return respond(set, await runWebhookTokenRoute(webhook, 'execute', { body, threadId: thread_id }, (b, threadId) =>
    executeWebhook(webhook, b, { wait, thread_id: threadId, with_components }, { ip: getClientIP(request) })));
})
.get('/webhooks/:webhookId/:webhookToken', async ({ params, set }) => {
  const { resolveInteractionWebhook } = await import('@/lib/services/interactions');
  const ix = await resolveInteractionWebhook(params.webhookId, params.webhookToken);
  if (ix) {
    const bot = await User.findById(ix.botId);
    const { outboundForApp } = await import('@/lib/services/interactions');
    return outboundForApp(ix.applicationId, { id: ix.applicationId, type: 3, application_id: ix.applicationId, name: bot?.username ?? '', avatar: bot?.avatar ?? null, channel_id: ix.channelId, guild_id: ix.guildId });
  }
  const { findWebhookByToken, serializeWebhook, runWebhookTokenRoute } = await import('@/lib/services/channelWebhooks');
  const webhook = await findWebhookByToken(params.webhookId, params.webhookToken);
  if (!webhook) { set.status = 404; return { code: 10015, message: 'Unknown Webhook' }; }
  return respond(set, await runWebhookTokenRoute(webhook, 'manage', {}, async () => ({ status: 200, body: serializeWebhook(webhook, { withToken: true }) })));
})
.patch('/webhooks/:webhookId/:webhookToken', async ({ params, body, set }) => {
  const { findWebhookByToken, patchWebhook, runWebhookTokenRoute } = await import('@/lib/services/channelWebhooks');
  const webhook = await findWebhookByToken(params.webhookId, params.webhookToken);
  if (!webhook) { set.status = 404; return { code: 10015, message: 'Unknown Webhook' }; }
  return respond(set, await runWebhookTokenRoute(webhook, 'manage', { body }, (b) => patchWebhook(webhook, b)));
})
.delete('/webhooks/:webhookId/:webhookToken', async ({ params, set }) => {
  const { findWebhookByToken, deleteWebhook, runWebhookTokenRoute } = await import('@/lib/services/channelWebhooks');
  const webhook = await findWebhookByToken(params.webhookId, params.webhookToken);
  if (!webhook) { set.status = 404; return { code: 10015, message: 'Unknown Webhook' }; }
  return respond(set, await runWebhookTokenRoute(webhook, 'manage', {}, () => deleteWebhook(webhook)));
})
.get('/webhooks/:webhookId/:webhookToken/messages/@original', async ({ params, set }) => {
  const { resolveInteractionWebhook, getInteractionMessage, withAppIds } = await import('@/lib/services/interactions');
  const ix = await resolveInteractionWebhook(params.webhookId, params.webhookToken);
  if (!ix) { set.status = 404; return { code: 10015, message: 'Unknown Webhook' }; }
  return respond(set, await withAppIds(ix.applicationId, null, () => getInteractionMessage(ix, '@original')));
})
.patch('/webhooks/:webhookId/:webhookToken/messages/@original', async ({ params, body, set }) => {
  const { resolveInteractionWebhook, editInteractionMessage, withAppIds } = await import('@/lib/services/interactions');
  const ix = await resolveInteractionWebhook(params.webhookId, params.webhookToken);
  if (!ix) { set.status = 404; return { code: 10015, message: 'Unknown Webhook' }; }
  return respond(set, await withAppIds(ix.applicationId, body, (b) => editInteractionMessage(ix, '@original', b)));
})
.delete('/webhooks/:webhookId/:webhookToken/messages/@original', async ({ params, set }) => {
  const { resolveInteractionWebhook, deleteInteractionMessage, withAppIds } = await import('@/lib/services/interactions');
  const ix = await resolveInteractionWebhook(params.webhookId, params.webhookToken);
  if (!ix) { set.status = 404; return { code: 10015, message: 'Unknown Webhook' }; }
  return respond(set, await withAppIds(ix.applicationId, null, () => deleteInteractionMessage(ix, '@original')));
})
.get('/webhooks/:webhookId/:webhookToken/messages/:messageId', async ({ params, query, set }) => {
  const { resolveInteractionWebhook, getInteractionMessage, withAppIds } = await import('@/lib/services/interactions');
  const ix = await resolveInteractionWebhook(params.webhookId, params.webhookToken);
  if (ix) return respond(set, await withAppIds(ix.applicationId, null, () => getInteractionMessage(ix, params.messageId)));
  const { findWebhookByToken, getWebhookMessage, runWebhookTokenRoute } = await import('@/lib/services/channelWebhooks');
  const webhook = await findWebhookByToken(params.webhookId, params.webhookToken);
  if (!webhook) { set.status = 404; return { code: 10015, message: 'Unknown Webhook' }; }
  const { thread_id } = query as Record<string, string | undefined>;
  return respond(set, await runWebhookTokenRoute(webhook, 'manage', { threadId: thread_id }, (_b, threadId) => getWebhookMessage(webhook, params.messageId, threadId)));
})
.patch('/webhooks/:webhookId/:webhookToken/messages/:messageId', async ({ params, body, query, request, set }) => {
  const { resolveInteractionWebhook, editInteractionMessage, withAppIds } = await import('@/lib/services/interactions');
  const ix = await resolveInteractionWebhook(params.webhookId, params.webhookToken);
  if (ix) return respond(set, await withAppIds(ix.applicationId, body, (b) => editInteractionMessage(ix, params.messageId, b)));
  const { findWebhookByToken, editWebhookMessage, runWebhookTokenRoute } = await import('@/lib/services/channelWebhooks');
  const webhook = await findWebhookByToken(params.webhookId, params.webhookToken);
  if (!webhook) { set.status = 404; return { code: 10015, message: 'Unknown Webhook' }; }
  const { thread_id, with_components } = query as Record<string, string | undefined>;
  return respond(set, await runWebhookTokenRoute(webhook, 'manage', { body, threadId: thread_id }, (b, threadId) =>
    editWebhookMessage(webhook, params.messageId, b, { thread_id: threadId, with_components }, { ip: getClientIP(request) })));
})
.delete('/webhooks/:webhookId/:webhookToken/messages/:messageId', async ({ params, query, set }) => {
  const { resolveInteractionWebhook, deleteInteractionMessage, withAppIds } = await import('@/lib/services/interactions');
  const ix = await resolveInteractionWebhook(params.webhookId, params.webhookToken);
  if (ix) return respond(set, await withAppIds(ix.applicationId, null, () => deleteInteractionMessage(ix, params.messageId)));
  const { findWebhookByToken, deleteWebhookMessage, runWebhookTokenRoute } = await import('@/lib/services/channelWebhooks');
  const webhook = await findWebhookByToken(params.webhookId, params.webhookToken);
  if (!webhook) { set.status = 404; return { code: 10015, message: 'Unknown Webhook' }; }
  const { thread_id } = query as Record<string, string | undefined>;
  return respond(set, await runWebhookTokenRoute(webhook, 'manage', { threadId: thread_id }, (_b, threadId) => deleteWebhookMessage(webhook, params.messageId, threadId)));
})

// ─── Audit Log ─────────────────────────────────────────────
.get('/guilds/:guildId/audit-logs', async ({ headers, params, query, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  if (!isValidObjectId(params.guildId)) { set.status = 404; return { code: 10004, message: 'Unknown Guild' }; }
  // Discord requires VIEW_AUDIT_LOG (this used to return any guild's log).
  const g = await requireBotPerm(params.guildId, auth.botUser.id, P.VIEW_AUDIT_LOG);
  if (!g.ok) { set.status = g.status; return g.body; }
  const { listAuditLogs } = await import('@/lib/services/auditLog');
  const { user_id, target_id, action_type, before, after, limit } = query as Record<string, string | undefined>;
  const actionType = action_type !== undefined ? Number(action_type) : null;
  const entries = await listAuditLogs(params.guildId, {
    userId: user_id ?? null,
    targetId: target_id ?? null,
    actionType: actionType !== null && Number.isFinite(actionType) ? actionType : null,
    // Entry ids (the boundary turned snowflakes into UUIDs); after = the next page forward.
    beforeId: before ?? null,
    afterId: after ?? null,
    limit: Math.min(Math.max(parseInt(limit ?? '') || 50, 1), 100),
  });
  // WP4b: users / webhooks / threads / integrations / AutoMod rules the entries refer to.
  const { auditLogResponse } = await import('@/lib/botapi/auditLog');
  return auditLogResponse(params.guildId, entries);
})

// ─── AutoMod rules (WP4b: src/lib/botapi/automod.ts) ───────
.get('/guilds/:guildId/auto-moderation/rules', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  const { listBotRules } = await import('@/lib/botapi/automod');
  return respond(set, await listBotRules(params.guildId, auth.botUser.id));
})
.get('/guilds/:guildId/auto-moderation/rules/:ruleId', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  const { getBotRule } = await import('@/lib/botapi/automod');
  return respond(set, await getBotRule(params.guildId, params.ruleId, auth.botUser.id));
})
.post('/guilds/:guildId/auto-moderation/rules', async ({ headers, params, body, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  const { name, event_type, trigger_type, trigger_metadata, actions, enabled, exempt_roles, exempt_channels } = (body ?? {}) as Record<string, unknown>;
  const { createBotRule } = await import('@/lib/botapi/automod');
  return respond(set, await createBotRule(params.guildId, auth.botUser.id, { name, event_type, trigger_type, trigger_metadata, actions, enabled, exempt_roles, exempt_channels }, headers));
})
.patch('/guilds/:guildId/auto-moderation/rules/:ruleId', async ({ headers, params, body, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  const { name, event_type, trigger_type, trigger_metadata, actions, enabled, exempt_roles, exempt_channels } = (body ?? {}) as Record<string, unknown>;
  const { updateBotRule } = await import('@/lib/botapi/automod');
  return respond(set, await updateBotRule(params.guildId, params.ruleId, auth.botUser.id, { name, event_type, trigger_type, trigger_metadata, actions, enabled, exempt_roles, exempt_channels }, headers));
})
.delete('/guilds/:guildId/auto-moderation/rules/:ruleId', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  const { deleteBotRule } = await import('@/lib/botapi/automod');
  return respond(set, await deleteBotRule(params.guildId, params.ruleId, auth.botUser.id, headers));
})

// ─── Scheduled events (WP4b: src/lib/botapi/scheduledEvents.ts) ─
.get('/guilds/:guildId/scheduled-events', async ({ headers, params, query, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  const { with_user_count } = query as Record<string, string | undefined>;
  const { listBotEvents } = await import('@/lib/botapi/scheduledEvents');
  return respond(set, await listBotEvents(params.guildId, auth.botUser.id, with_user_count === 'true'));
})
.post('/guilds/:guildId/scheduled-events', async ({ headers, params, body, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  const { name, description, entity_type, channel_id, entity_metadata, privacy_level, scheduled_start_time, scheduled_end_time, image, recurrence_rule } = (body ?? {}) as Record<string, unknown>;
  const { createBotEvent } = await import('@/lib/botapi/scheduledEvents');
  return respond(set, await createBotEvent(params.guildId, auth.botUser.id, { name, description, entity_type, channel_id, entity_metadata, privacy_level, scheduled_start_time, scheduled_end_time, image, recurrence_rule }));
})
.get('/guilds/:guildId/scheduled-events/:eventId', async ({ headers, params, query, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  const { with_user_count } = query as Record<string, string | undefined>;
  const { getBotEvent } = await import('@/lib/botapi/scheduledEvents');
  return respond(set, await getBotEvent(params.guildId, params.eventId, auth.botUser.id, with_user_count === 'true'));
})
.patch('/guilds/:guildId/scheduled-events/:eventId', async ({ headers, params, body, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  const { name, description, entity_type, channel_id, entity_metadata, privacy_level, scheduled_start_time, scheduled_end_time, image, recurrence_rule, status } = (body ?? {}) as Record<string, unknown>;
  const fields = Object.fromEntries(Object.entries({ name, description, entity_type, channel_id, entity_metadata, privacy_level, scheduled_start_time, scheduled_end_time, image, recurrence_rule, status }).filter(([, v]) => v !== undefined));
  const { updateBotEvent } = await import('@/lib/botapi/scheduledEvents');
  return respond(set, await updateBotEvent(params.guildId, params.eventId, auth.botUser.id, fields));
})
.delete('/guilds/:guildId/scheduled-events/:eventId', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  const { deleteBotEvent } = await import('@/lib/botapi/scheduledEvents');
  return respond(set, await deleteBotEvent(params.guildId, params.eventId, auth.botUser.id));
})
.get('/guilds/:guildId/scheduled-events/:eventId/users', async ({ headers, params, query, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  const { with_member, limit, before, after } = query as Record<string, string | undefined>;
  // Member objects need the GUILD_MEMBERS intent, like member lists.
  const withMember = with_member === 'true' && (allowedPrivilegedIntents(auth.app) & INTENT.GUILD_MEMBERS) !== 0;
  const { listBotEventUsers } = await import('@/lib/botapi/scheduledEvents');
  return respond(set, await listBotEventUsers(params.guildId, params.eventId, auth.botUser.id, { withMember, limit, before: before ?? null, after: after ?? null }));
})

// ─── Stage instances ───────────────────────────────────────
// Serika's stage channels have no stage instances (topic / live state) yet:
// lookups answer Unknown Stage Instance, creation is not implemented.
.post('/stage-instances', async ({ headers, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  set.status = 501;
  return { code: 0, message: 'Stage instances are not supported yet' };
})
.get('/stage-instances/:channelId', async ({ headers, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  set.status = 404;
  return { code: 10067, message: 'Unknown Stage Instance' };
})
.patch('/stage-instances/:channelId', async ({ headers, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  set.status = 404;
  return { code: 10067, message: 'Unknown Stage Instance' };
})
.delete('/stage-instances/:channelId', async ({ headers, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  set.status = 404;
  return { code: 10067, message: 'Unknown Stage Instance' };
})

// ─── Onboarding, welcome screen, templates, integrations (WP4b: src/lib/botapi/community.ts) ─
.get('/guilds/:guildId/onboarding', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  const { getBotOnboarding } = await import('@/lib/botapi/community');
  return respond(set, await getBotOnboarding(params.guildId));
})
.put('/guilds/:guildId/onboarding', async ({ headers, params, body, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  const { prompts, enabled, default_channel_ids, mode } = (body ?? {}) as Record<string, unknown>;
  const { putBotOnboarding } = await import('@/lib/botapi/community');
  return respond(set, await putBotOnboarding(params.guildId, auth.botUser.id, { prompts, enabled, default_channel_ids, mode }));
})
.get('/guilds/:guildId/welcome-screen', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  const { getBotWelcomeScreen } = await import('@/lib/botapi/community');
  return respond(set, await getBotWelcomeScreen(params.guildId, auth.botUser.id));
})
.patch('/guilds/:guildId/welcome-screen', async ({ headers, params, body, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  const { enabled, description, welcome_channels } = (body ?? {}) as Record<string, unknown>;
  const { patchBotWelcomeScreen } = await import('@/lib/botapi/community');
  return respond(set, await patchBotWelcomeScreen(params.guildId, auth.botUser.id, { enabled, description, welcome_channels }));
})
.get('/guilds/templates/:code', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  const { getTemplateByCodeForBot } = await import('@/lib/botapi/community');
  return respond(set, await getTemplateByCodeForBot(params.code));
})
.get('/guilds/:guildId/templates', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  const { listBotTemplates } = await import('@/lib/botapi/community');
  return respond(set, await listBotTemplates(params.guildId, auth.botUser.id));
})
.post('/guilds/:guildId/templates', async ({ headers, params, body, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  const { name, description } = (body ?? {}) as Record<string, unknown>;
  const { createBotTemplate } = await import('@/lib/botapi/community');
  return respond(set, await createBotTemplate(params.guildId, auth.botUser.id, { name, description }));
})
.put('/guilds/:guildId/templates/:code', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  const { syncBotTemplate } = await import('@/lib/botapi/community');
  return respond(set, await syncBotTemplate(params.guildId, params.code, auth.botUser.id));
})
.patch('/guilds/:guildId/templates/:code', async ({ headers, params, body, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  const { name, description } = (body ?? {}) as Record<string, unknown>;
  const { patchBotTemplate } = await import('@/lib/botapi/community');
  return respond(set, await patchBotTemplate(params.guildId, params.code, auth.botUser.id, { name, description }));
})
.delete('/guilds/:guildId/templates/:code', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  const { deleteBotTemplate } = await import('@/lib/botapi/community');
  return respond(set, await deleteBotTemplate(params.guildId, params.code, auth.botUser.id));
})
.get('/guilds/:guildId/integrations', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  const { listBotIntegrations } = await import('@/lib/botapi/community');
  return respond(set, await listBotIntegrations(params.guildId, auth.botUser.id));
})
.delete('/guilds/:guildId/integrations/:integrationId', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  const { deleteBotIntegration } = await import('@/lib/botapi/community');
  return respond(set, await deleteBotIntegration(params.guildId, params.integrationId, auth.botUser.id, headers));
})

// ─── Threads + forums (WP5: src/lib/botapi/threads.ts) ─────
.post('/channels/:channelId/threads', async ({ headers, params, body, request, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  // JSON, or multipart for forum posts (payload_json + files[n] for the first message).
  const parsedBody = parseBotMessageBody(body);
  if (!parsedBody.ok) { set.status = 400; return { code: parsedBody.code, message: parsedBody.error }; }
  const { name, type, auto_archive_duration, rate_limit_per_user, invitable, applied_tags, message } = parsedBody.payload as Record<string, unknown>;
  const { createBotThread } = await import('@/lib/botapi/threads');
  return respond(set, await createBotThread({
    bot: auth.botUser,
    channelId: params.channelId,
    body: { name, type, auto_archive_duration, rate_limit_per_user, invitable, applied_tags, message },
    headers,
    sendStarter: (threadId, starter) => internalBotRequest(request, 'POST', `/channels/${threadId}/messages`, starter, parsedBody.files),
  }));
})
.post('/channels/:channelId/messages/:messageId/threads', async ({ headers, params, body, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  const { name, auto_archive_duration, rate_limit_per_user } = (body ?? {}) as Record<string, unknown>;
  const { createBotThread } = await import('@/lib/botapi/threads');
  return respond(set, await createBotThread({
    bot: auth.botUser,
    channelId: params.channelId,
    messageId: params.messageId,
    body: { name, auto_archive_duration, rate_limit_per_user },
    headers,
  }));
})
.get('/channels/:channelId/thread-members', async ({ headers, params, query, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  // Discord: restricted by the privileged GUILD_MEMBERS intent.
  if ((allowedPrivilegedIntents(auth.app) & INTENT.GUILD_MEMBERS) === 0) { set.status = 403; return MISSING_ACCESS; }
  const { with_member, after, limit } = query as Record<string, string | undefined>;
  const { listBotThreadMembers } = await import('@/lib/botapi/threads');
  return respond(set, await listBotThreadMembers(params.channelId, { withMember: with_member === 'true', after: after ?? null, limit }));
})
.put('/channels/:channelId/thread-members/@me', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  const { addBotThreadMember } = await import('@/lib/botapi/threads');
  return respond(set, await addBotThreadMember(auth.botUser.id, params.channelId, auth.botUser.id));
})
.delete('/channels/:channelId/thread-members/@me', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  const { removeBotThreadMember } = await import('@/lib/botapi/threads');
  return respond(set, await removeBotThreadMember(auth.botUser.id, params.channelId, auth.botUser.id));
})
.get('/channels/:channelId/thread-members/:userId', async ({ headers, params, query, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  const { with_member } = query as Record<string, string | undefined>;
  // A member object needs the GUILD_MEMBERS intent, like the list.
  const withMember = with_member === 'true' && (allowedPrivilegedIntents(auth.app) & INTENT.GUILD_MEMBERS) !== 0;
  const { getBotThreadMember } = await import('@/lib/botapi/threads');
  return respond(set, await getBotThreadMember(params.channelId, params.userId, withMember));
})
.put('/channels/:channelId/thread-members/:userId', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  const { addBotThreadMember } = await import('@/lib/botapi/threads');
  return respond(set, await addBotThreadMember(auth.botUser.id, params.channelId, params.userId));
})
.delete('/channels/:channelId/thread-members/:userId', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  const { removeBotThreadMember } = await import('@/lib/botapi/threads');
  return respond(set, await removeBotThreadMember(auth.botUser.id, params.channelId, params.userId));
})
.get('/channels/:channelId/threads/archived/public', async ({ headers, params, query, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  const { before, limit } = query as Record<string, string | undefined>;
  const { listArchivedThreads } = await import('@/lib/botapi/threads');
  return respond(set, await listArchivedThreads(auth.botUser.id, params.channelId, 'public', { before, limit }));
})
.get('/channels/:channelId/threads/archived/private', async ({ headers, params, query, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  const { before, limit } = query as Record<string, string | undefined>;
  const { listArchivedThreads } = await import('@/lib/botapi/threads');
  return respond(set, await listArchivedThreads(auth.botUser.id, params.channelId, 'private', { before, limit }));
})
.get('/channels/:channelId/users/@me/threads/archived/private', async ({ headers, params, query, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  const { before, limit } = query as Record<string, string | undefined>;
  const { listArchivedThreads } = await import('@/lib/botapi/threads');
  return respond(set, await listArchivedThreads(auth.botUser.id, params.channelId, 'joined', { before, limit }));
})
.get('/channels/:channelId/threads/search', async ({ headers, params, query, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  const { name, tag, tag_setting, archived, sort_by, sort_order, limit, offset } = query as Record<string, string | undefined>;
  const { searchBotThreads } = await import('@/lib/botapi/threads');
  return respond(set, await searchBotThreads(auth.botUser.id, params.channelId, { name, tag, tag_setting, archived, sort_by, sort_order, limit, offset }));
})
.get('/guilds/:guildId/threads/active', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  const { listActiveGuildThreads } = await import('@/lib/botapi/threads');
  return respond(set, await listActiveGuildThreads(auth.botUser.id, params.guildId));
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

  const { recipient_id, access_tokens, nicks } = (body ?? {}) as { recipient_id?: string; access_tokens?: unknown; nicks?: unknown };
  // Group DM create (access_tokens + nicks, the gdm.join scope): Discord's
  // deprecated GameBridge flow. Serika has no gdm.join grant, so it is refused.
  if (access_tokens !== undefined || nicks !== undefined) {
    set.status = 400;
    return invalidFormBodyAt([{ path: 'access_tokens', code: 'GROUP_DM_CREATE_UNSUPPORTED', message: 'Bots cannot create group DMs on SerikaCord.' }]);
  }
  if (!recipient_id || !isValidObjectId(recipient_id)) {
    set.status = 400;
    return invalidFormBodyAt([{ path: 'recipient_id', code: recipient_id ? 'NUMBER_TYPE_COERCE' : 'BASE_TYPE_REQUIRED', message: recipient_id ? 'Value is not snowflake.' : 'This field is required' }]);
  }
  if (compareIds(recipient_id, auth.botUser.id)) { set.status = 400; return { code: 50007, message: 'Cannot send messages to this user' }; }

  // Existing 1:1 DM between the two (type + recipientIds are whitelisted filter keys).
  let dm: IChannel | null = await Channel.findOne({ type: 'dm', recipientIds: [auth.botUser.id, recipient_id] });
  if (dm && !((dm.recipientIds || []) as string[]).some((r) => compareIds(r, recipient_id))) dm = null;

  if (!dm) {
    // A bot may only open a DM with someone who shares a server with it, has
    // not blocked it, and accepts DMs from non-friends.
    const recipient = await User.findById(recipient_id);
    if (!recipient) { set.status = 404; return { code: 10013, message: 'Unknown User' }; }
    // Bots can't DM other bots (Discord 50007).
    if (recipient.isBot) { set.status = 400; return { code: 50007, message: 'Cannot send messages to this user' }; }
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

// ─── Voice (WP7) ───────────────────────────────────────────
// Bots see voice state (who is in which voice channel, mute / deafen) from
// the voice room mirror; they cannot join voice themselves (op 4 answers
// VOICE_SERVER_UPDATE endpoint null). Serika voice has one peer-to-peer
// "region"; stage channels have no speaker / suppress model yet.
.get('/voice/regions', async ({ headers, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  return VOICE_REGIONS;
})
.get('/guilds/:guildId/regions', async ({ headers, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  return VOICE_REGIONS; // the access guard already required membership
})
.get('/guilds/:guildId/voice-states/@me', async ({ headers, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  set.status = 404;
  return UNKNOWN_VOICE_STATE; // bots never join Serika voice
})
.get('/guilds/:guildId/voice-states/:userId', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  const state = await findVoiceState(params.guildId, params.userId, auth.botUser.id);
  if (!state) { set.status = 404; return UNKNOWN_VOICE_STATE; }
  return state;
})
.patch('/guilds/:guildId/voice-states/@me', async ({ headers, body, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  const { channel_id, suppress, request_to_speak_timestamp } = (body ?? {}) as { channel_id?: unknown; suppress?: unknown; request_to_speak_timestamp?: unknown };
  const bad = voiceStatePatchError({ channel_id, suppress, request_to_speak_timestamp });
  if (bad) { set.status = 400; return bad; }
  set.status = 404;
  return UNKNOWN_VOICE_STATE; // the bot is never in a stage channel
})
.patch('/guilds/:guildId/voice-states/:userId', async ({ headers, params, body, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  const { channel_id, suppress } = (body ?? {}) as { channel_id?: unknown; suppress?: unknown };
  const bad = voiceStatePatchError({ channel_id, suppress });
  if (bad) { set.status = 400; return bad; }
  const g = await requireBotPerm(params.guildId, auth.botUser.id, P.MUTE_MEMBERS);
  if (!g.ok) { set.status = g.status; return g.body; }
  const state = await findVoiceState(params.guildId, params.userId, auth.botUser.id);
  if (!state) { set.status = 404; return UNKNOWN_VOICE_STATE; }
  // Serika voice channels are not stage channels: there is nothing to suppress.
  set.status = 400;
  return { code: 50024, message: 'Cannot execute action on this channel type' };
})

// ─── Soundboard (WP7) ──────────────────────────────────────
// Serika's soundboard sounds are URLs without Discord sound ids, so bots see
// none (op 31 answers the same).
.get('/soundboard-default-sounds', async ({ headers, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  return [];
})
.get('/guilds/:guildId/soundboard-sounds', async ({ headers, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  return { items: [] };
})
.get('/guilds/:guildId/soundboard-sounds/:soundId', async ({ headers, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  set.status = 404;
  return { code: 10097, message: 'Unknown sound' };
})

// ─── Monetization (WP7 stubs) ──────────────────────────────
// SerikaCord has no app payments: no SKUs, entitlements or subscriptions.
// Libraries' monetization helpers get empty lists instead of 404s.
.get('/applications/:appId/skus', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  if (!ownsApp(auth, params.appId)) { set.status = 403; return MISSING_ACCESS; }
  return [];
})
.get('/applications/:appId/entitlements', async ({ headers, params, query, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  if (!ownsApp(auth, params.appId)) { set.status = 403; return MISSING_ACCESS; }
  const { user_id, sku_ids, before, after, limit, guild_id, exclude_ended, exclude_deleted } = query as Record<string, string | undefined>;
  if (limit !== undefined && !(Number.isInteger(Number(limit)) && Number(limit) >= 1 && Number(limit) <= 100)) {
    set.status = 400;
    return invalidFormBodyAt([{ path: 'limit', code: 'NUMBER_TYPE_MAX', message: 'int value should be between 1 and 100.' }]);
  }
  void user_id; void sku_ids; void before; void after; void guild_id; void exclude_ended; void exclude_deleted;
  return [];
})
.get('/applications/:appId/entitlements/:entitlementId', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  if (!ownsApp(auth, params.appId)) { set.status = 403; return MISSING_ACCESS; }
  set.status = 404;
  return UNKNOWN_ENTITLEMENT;
})
.post('/applications/:appId/entitlements', async ({ headers, params, body, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  if (!ownsApp(auth, params.appId)) { set.status = 403; return MISSING_ACCESS; }
  // Test entitlements need a SKU; there are none.
  const { sku_id, owner_id, owner_type } = (body ?? {}) as { sku_id?: unknown; owner_id?: unknown; owner_type?: unknown };
  void owner_id; void owner_type;
  set.status = 404;
  return sku_id === undefined ? invalidFormBodyAt([{ path: 'sku_id', code: 'BASE_TYPE_REQUIRED', message: 'This field is required' }]) : { code: 10027, message: 'Unknown SKU' };
})
.delete('/applications/:appId/entitlements/:entitlementId', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  if (!ownsApp(auth, params.appId)) { set.status = 403; return MISSING_ACCESS; }
  set.status = 404;
  return UNKNOWN_ENTITLEMENT;
})
.post('/applications/:appId/entitlements/:entitlementId/consume', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  if (!ownsApp(auth, params.appId)) { set.status = 403; return MISSING_ACCESS; }
  set.status = 404;
  return UNKNOWN_ENTITLEMENT;
})
.get('/users/@me/applications/:appId/entitlements', async ({ headers, params, query, set }) => {
  // OAuth2 (applications.entitlements): the user's entitlements for the app.
  const bearer = await requireBearerScope(headers, 'applications.entitlements');
  if (!bearer.ok) { set.status = bearer.status; return bearer.body; }
  if (!compareIds(params.appId, bearer.auth.app.id) && params.appId !== bearer.auth.app.clientId) { set.status = 403; return MISSING_ACCESS; }
  const { sku_ids, exclude_ended } = query as Record<string, string | undefined>;
  void sku_ids; void exclude_ended;
  return [];
})
.get('/skus/:skuId/subscriptions', async ({ headers, query, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  const { before, after, limit, user_id } = query as Record<string, string | undefined>;
  void before; void after; void limit; void user_id;
  return [];
})
.get('/skus/:skuId/subscriptions/:subscriptionId', async ({ headers, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  set.status = 404;
  return { code: 10027, message: 'Unknown SKU' };
});

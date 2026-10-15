import { Elysia, t } from 'elysia';
import { buildPollView, fromDiscordPollRequest, normalizePollInput, parseStoredPoll, toDiscordPoll, type StoredPoll } from '@/lib/chat/polls';
import { acceptsDmsFromNonFriends } from '@/lib/settings/privacy';
import { ChannelWebhook, type IApplication } from '@/lib/models';
import { addReaction, removeReaction, type StoredReaction } from '@/lib/chat/reactionMutations';
import { Channel, Message, Server, ServerMember, Role, User, ServerEmoji, ServerSticker, Invite, ServerBan, type IMessage, type IChannel } from '@/lib/models';
import { AppCommand, type IAppCommand } from '@/lib/models/AppCommand';
import * as crypto from 'crypto';
import { config } from '@/lib/config';
import { normalizeId } from '@/lib/db/normalizeId';
import { removeServerMember, upsertServerBan } from '@/lib/services/serverMembership';
import { PERMISSION_BITS as P } from '@/lib/permissions/bits';
import {
  computeGuildStanding, standingHas, memberTopPosition, outranks, canGrantBits, parseBitfield,
  type BotGuildStanding,
} from '@/lib/permissions/botGuild';
import type { IServer, IRole } from '@/lib/models';
import { isSilentMessage, MESSAGE_FLAGS, sendFlags } from '@/lib/chat/messageFlags';
import { normalizeVoiceMessage, toDiscordVoiceFields } from '@/lib/chat/voiceMessage';
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
import { checkRateLimit, decryptFromStorage, getClientIP, isValidObjectId } from '@/lib/security';
import { botRequestBuckets, rateLimitedResponse, rateLimitHeaders } from '@/lib/security/botRateLimit';
import { botIdBoundary } from '@/lib/botapi/boundary';
import { invalidFormBody, validationErrorBody } from '@/lib/botapi/errors';
import { parseApplicationPatch, toDiscordApplication } from '@/lib/botapi/application';
import { toDiscordChannel, toDiscordRole } from '@/lib/services/gatewayEvents';

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
 * A stored message as the bot may see it: content decrypted from storage, and
 * content/embeds/attachments/components/poll blanked when the app lacks the
 * MESSAGE_CONTENT intent (except DMs, the bot's own messages and mentions).
 */
async function presentMessage(msg: IMessage, author: unknown, viewer: BotViewer) {
  let content = '';
  if (msg.content) {
    try { content = await decryptFromStorage(msg.content); } catch { content = ''; }
  }
  const formatted = formatMessage({ ...msg, content, authorId: author || msg.authorId }, viewer.botId);
  const redact = shouldRedactContent(
    { guildId: msg.serverId, authorId: msg.authorId, mentionedUserIds: (msg.mentionedUserIds ?? []) as string[] },
    viewer.botId,
    viewer.hasMessageContent,
  );
  return redact ? redactMessageContent(formatted, viewer.botId) : formatted;
}

/** presentMessage for a list, with one batched author lookup. */
async function presentMessages(messages: IMessage[], viewer: BotViewer) {
  const authorIds = [...new Set(messages.map((m) => m.authorId).filter(Boolean))] as string[];
  const authors = authorIds.length > 0 ? await User.find({ id: { in: authorIds } }) : [];
  const authorMap = new Map(authors.map((u: { id: string }) => [u.id, u]));
  return Promise.all(messages.map((m) => presentMessage(m, authorMap.get(m.authorId) || m.authorId, viewer)));
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

/** Bots may only manage their own application's commands. */
function ownsApp(auth: { app: { id: string } }, appId: string): boolean {
  return !!appId && compareIds(appId, auth.app.id);
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

function formatMessage(msg: any, viewerId?: string) {
  const author = msg.authorId && typeof msg.authorId === 'object' && msg.authorId.id
    ? formatUser(msg.authorId)
    : msg.authorId
      ? { id: msg.authorId, username: '' }
      : null;
  return {
    id: msg.id,
    channel_id: msg.channelId ?? null,
    author,
    content: msg.content ?? '',
    timestamp: msg.createdAt ? new Date(msg.createdAt).toISOString() : undefined,
    edited_timestamp: msg.edited ? new Date(msg.updatedAt).toISOString() : null,
    tts: false,
    mention_everyone: msg.mentionEveryone ?? false,
    mentions: (msg.mentionedUserIds ?? []).map((id: any) => ({ id, username: '' })),
    mention_roles: (msg.mentionedRoleIds ?? []).map((id: any) => id),
    mention_channels: (msg.mentionedChannelIds ?? []).map((id: any) => id),
    attachments: (msg.attachments ?? []).map((a: any) => ({
      id: a.id,
      filename: a.filename,
      content_type: a.contentType,
      size: a.size,
      url: a.url,
      proxy_url: a.proxyUrl ?? a.url,
      width: a.width,
      height: a.height,
      ...(typeof a.description === 'string' ? { description: a.description } : {}),
      ...toDiscordVoiceFields(a),
    })),
    embeds: msg.embeds ?? [],
    reactions: (msg.reactions ?? []).map((r: { emoji: { name: string; id?: string }; count: number; userIds: string[] }) => ({
      emoji: r.emoji,
      count: r.count,
      me: viewerId ? (r.userIds?.some((uid: string) => compareIds(uid, viewerId)) ?? false) : false,
    })),
    pinned: msg.pinned ?? false,
    type: msg.type === 'poll_result' ? 46 : 0,
    flags: typeof msg.flags === "number" ? msg.flags : 0,
    referenced_message: null,
    ...(msg.type !== 'poll_result' && parseStoredPoll(msg.poll) ? { poll: toDiscordPoll(parseStoredPoll(msg.poll)!) } : {}),
  };
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
      // Public hosts only, so a bot can't make the server probe internal ones.
      try {
        const { assertPublicUrl } = await import('@/lib/security/ssrf');
        await assertPublicUrl(url);
      } catch {
        set.status = 400;
        return invalidFormBody([{ path: 'interactions_endpoint_url', code: 'URL_TYPE_INVALID_URL', message: 'Not a well formed URL.' }]);
      }
      const { ensureBotProvisioned } = await import('@/lib/services/appIdentity');
      const provisioned = await ensureBotProvisioned(auth.app);
      const { verifyInteractionEndpoint } = await import('@/lib/services/interactions');
      const ok = await verifyInteractionEndpoint({ interactionsEndpointUrl: url, privateKeyPem: provisioned.privateKeyPem, clientId: provisioned.clientId });
      if (!ok) {
        set.status = 400;
        return invalidFormBody([{ path: 'interactions_endpoint_url', code: 'APPLICATION_INTERACTION_ENDPOINT_URL_INVALID', message: 'The specified interactions endpoint url could not be verified.' }]);
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
  const limit = Math.min(parseInt(query.limit as string) || 50, 100);
  const messages = await Message.find({ channelId: params.channelId, isDeleted: false, _limit: limit });
  return presentMessages(messages as IMessage[], viewerOf(auth));
})
.get('/channels/:channelId/messages/:messageId', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  const c = await requireChannelAction(params.channelId, auth.botUser.id, 'read_history');
  if (!c.ok) { set.status = c.status; return c.body; }
  const msg = await loadChannelMessage(params.channelId, params.messageId);
  if (!msg) { set.status = 404; return UNKNOWN_MESSAGE; }
  const author = msg.authorId ? await User.findById(msg.authorId) : null;
  return presentMessage(msg, author || msg.authorId, viewerOf(auth));
})
.post('/channels/:channelId/messages', async ({ headers, params, body, request, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  // SEND_MESSAGES (SEND_MESSAGES_IN_THREADS in threads) after overwrites; a
  // timed-out bot can't send. DMs: only a DM the bot is in.
  const c = await requireChannelAction(params.channelId, auth.botUser.id, 'send');
  if (!c.ok) { set.status = c.status; return c.body; }
  const channel = c.channel;

  // JSON, or Discord multipart: files[n] + payload_json (attachments[] = per-file metadata).
  const parsedBody = parseBotMessageBody(body);
  if (!parsedBody.ok) { set.status = 400; return { code: parsedBody.code, message: parsedBody.error }; }
  const { content, embeds, tts, attachments: rawAttachments, allowed_mentions, sticker_ids, components, flags, poll: pollRequest } = parsedBody.payload as { content?: string; embeds?: unknown[]; tts?: boolean; attachments?: unknown; allowed_mentions?: unknown; sticker_ids?: unknown[]; components?: unknown[]; flags?: number; poll?: unknown };
  void tts; void allowed_mentions; void components;
  if (content !== undefined && content !== null && typeof content !== 'string') { set.status = 400; return { code: 50035, message: 'Invalid Form Body: content must be a string' }; }
  let attachments: IncomingAttachment[] = [];
  let attachmentPlan: Map<number, AttachmentMeta> = new Map();
  if (parsedBody.files.length > 0) {
    const plan = planAttachments({ payloadAttachments: rawAttachments, fileIndexes: parsedBody.files.map((f) => f.index), mode: 'create' });
    if (!plan.ok) { set.status = 400; return { code: 50035, message: `Invalid Form Body: ${plan.error}` }; }
    attachmentPlan = plan.meta;
  } else {
    // JSON attachments must be real uploads owned by this bot (same CDN
    // ownership rule as users); arbitrary URLs would render as native file cards.
    const normalized = normalizeBotAttachments(rawAttachments, { cdnUrl: config.CDN_URL, botId: auth.botUser.id });
    if ('error' in normalized) { set.status = 400; return { code: 50035, message: `Invalid Form Body: ${normalized.error}` }; }
    attachments = normalized.attachments;
  }
  const attachmentCount = parsedBody.files.length + attachments.length;
  if (attachmentCount > 0 && !botCan(c.perms, 'attach', { isThread: isThreadChannel(channel) })) {
    set.status = 403; return MISSING_PERMISSIONS;
  }
  // Discord-style polls: `poll` { question: { text }, answers: [{ poll_media }], duration, allow_multiselect }.
  let poll: StoredPoll | null = null;
  if (pollRequest !== undefined && pollRequest !== null) {
    const input = fromDiscordPollRequest(pollRequest);
    const parsed = input ? normalizePollInput(input) : { error: 'Invalid poll' };
    if ('error' in parsed) { set.status = 400; return { code: 50035, message: `Invalid Form Body: ${parsed.error}` }; }
    poll = parsed.poll;
  }
  if (!content && !embeds?.length && !attachmentCount && !sticker_ids?.length && !poll) {
    set.status = 400; return { code: 50006, message: 'Cannot send an empty message' };
  }
  if (parsedBody.files.length > 0) {
    const uploaded = await uploadBotFiles({
      files: parsedBody.files,
      meta: attachmentPlan,
      botId: auth.botUser.id,
      channelId: params.channelId,
      ip: getClientIP(request),
      isPremium: Boolean(auth.botUser.isPremium),
    });
    if (!uploaded.ok) { set.status = uploaded.status; return uploaded.body; }
    attachments = uploaded.attachments;
  }

  const { extractUserMentionIds, signalChannelMessage, signalDmMessage } = await import('@/lib/services/messageSignals');
  const isDm = channel.type === 'dm' || channel.type === 'group_dm';
  const mentionedUserIds = extractUserMentionIds(content);
  // SUPPRESS_EMBEDS / SUPPRESS_NOTIFICATIONS (@silent), as on Discord.
  // IS_VOICE_MESSAGE: one audio attachment with duration_secs (+ waveform), no text.
  const voice = normalizeVoiceMessage({
    requestedFlags: flags,
    content,
    hasSticker: Boolean(sticker_ids?.length),
    attachments,
  });
  if ('error' in voice) { set.status = 400; return { code: 50035, message: `Invalid Form Body: ${voice.error}` }; }
  const msgFlags = sendFlags(flags, false) | voice.flag;
  const silent = isSilentMessage(msgFlags);
  const msg = await Message.create({
    channelId: params.channelId,
    serverId: channel.serverId ?? null,
    authorId: auth.botUser.id,
    content: content || '',
    embeds: embeds ?? [],
    attachments: voice.flag ? voice.attachments : attachments,
    type: 'default',
    pinned: false,
    edited: false,
    reactions: [],
    mentionedUserIds,
    ...(poll ? { poll } : {}),
    flags: msgFlags,
    ...((msgFlags & MESSAGE_FLAGS.SUPPRESS_EMBEDS) !== 0 ? { suppressEmbeds: true } : {}),
  });
  void Channel.updateById(params.channelId, { lastMessageId: msg.id, updatedAt: new Date() }).catch(() => {});
  if (poll) {
    const { scheduleOpenPoll } = await import('@/lib/services/messageExtras');
    void scheduleOpenPoll(msg.id, poll.expiresAt);
  }

  const populated = await Message.findById(msg.id);
  const author = populated?.authorId ? await User.findById(populated.authorId) : null;
  const formattedMsg = populated ? await presentMessage(populated, author || populated.authorId, viewerOf(auth)) : null;

  // Deliver to the web client SSE streams and the bot gateway.
  // The SSE client expects internal format (createdAt, authorId, channelId)
  // — NOT Discord format (timestamp, channel_id) — so build it from the raw row.
  try {
    // DM viewers listen on the DM bus, server channels on the channel bus.
    const publish = isDm
      ? (await import('@/lib/api/dms')).publishToDm
      : (await import('@/lib/api/channels')).publishToChannel;
    publish(params.channelId, {
      type: 'message',
      message: {
        id: msg.id,
        content: msg.content ?? '',
        authorId: auth.botUser.id,
        author: author ? {
          id: author.id,
          username: author.username,
          displayName: author.displayName ?? undefined,
          avatar: author.avatar,
          isBot: author.isBot ?? undefined,
          isSystem: author.isSystem ?? undefined,
        } : null,
        channelId: params.channelId,
        serverId: channel.serverId ?? null,
        createdAt: (populated as IMessage | undefined)?.createdAt ?? msg.createdAt ?? new Date(),
        attachments: (msg.attachments ?? []),
        embeds: msg.embeds ?? [],
        edited: false,
        pinned: false,
        reactions: [],
        mentionedUserIds,
        type: 'default',
        ...(poll ? { poll: buildPollView(poll, {}, 0, []) } : {}),
        flags: msgFlags,
      },
    });
  } catch {}
  const botName = author?.displayName || author?.username || auth.botUser.username;
  if (isDm) {
    void signalDmMessage({
      channelId: params.channelId,
      recipientIds: (channel.recipientIds || []) as string[],
      messageId: msg.id,
      authorId: auth.botUser.id,
      authorName: botName,
      authorAvatar: author?.avatar ?? null,
      content: content || '',
      hasAttachments: attachments.length > 0,
      createdAt: msg.createdAt,
      silent,
    });
  } else {
    void signalChannelMessage({
      channel: { id: channel.id, serverId: channel.serverId, name: channel.name },
      messageId: msg.id,
      authorId: auth.botUser.id,
      authorName: botName,
      authorAvatar: author?.avatar ?? null,
      content: content || '',
      mentionedUserIds,
      createdAt: msg.createdAt,
      silent,
    });
  }
  // Gateway fan-out is fire-and-forget (it resolves which bots may see the channel).
  void import('@/lib/services/gatewayEvents')
    .then(({ emitMessageCreate }) => emitMessageCreate({
      id: msg.id,
      content: msg.content ?? '',
      channelId: params.channelId,
      serverId: channel.serverId ?? null,
      createdAt: (populated as IMessage | undefined)?.createdAt ?? msg.createdAt ?? new Date(),
      author: author ? {
        id: author.id,
        username: author.username,
        displayName: author.displayName ?? undefined,
        avatar: author.avatar,
        isBot: author.isBot ?? undefined,
        isSystem: author.isSystem ?? undefined,
      } : null,
      attachments: (msg.attachments ?? []) as Array<Record<string, unknown>>,
      mentionedUserIds,
      ...(poll ? { poll } : {}),
    }))
    .catch(() => {});

  return formattedMsg;
})
.patch('/channels/:channelId/messages/:messageId', async ({ headers, params, body, request, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  const msg = await loadChannelMessage(params.channelId, params.messageId);
  if (!msg) { set.status = 404; return UNKNOWN_MESSAGE; }

  // Only the author can edit
  if (!compareIds(msg.authorId, auth.botUser.id)) {
    set.status = 403; return { code: 50005, message: 'Cannot edit a message authored by another user' };
  }

  const parsedBody = parseBotMessageBody(body);
  if (!parsedBody.ok) { set.status = 400; return { code: parsedBody.code, message: parsedBody.error }; }
  const { content, embeds, attachments: rawAttachments } = parsedBody.payload as { content?: string; embeds?: unknown[]; attachments?: unknown };
  if (content !== undefined && content !== null && typeof content !== 'string') { set.status = 400; return { code: 50035, message: 'Invalid Form Body: content must be a string' }; }
  const updates: Record<string, unknown> = { edited: true };
  if (content !== undefined) updates.content = content;
  if (embeds !== undefined) updates.embeds = embeds;
  // Attachments on edit (Discord): `attachments` lists the ones to keep (by id)
  // plus metadata for new files[n]; new files are appended.
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
      const c = await requireChannelAction(params.channelId, auth.botUser.id, 'attach');
      if (!c.ok) { set.status = c.status; return c.body; }
      if (kept.length + parsedBody.files.length > MAX_BOT_FILES) {
        set.status = 400; return { code: 50035, message: `Invalid Form Body: at most ${MAX_BOT_FILES} attachments per message` };
      }
      const uploaded = await uploadBotFiles({
        files: parsedBody.files,
        meta: plan.meta,
        botId: auth.botUser.id,
        channelId: params.channelId,
        ip: getClientIP(request),
        isPremium: Boolean(auth.botUser.isPremium),
      });
      if (!uploaded.ok) { set.status = uploaded.status; return uploaded.body; }
      added = uploaded.attachments;
    }
    updates.attachments = [...kept, ...added];
  }
  const updated = await Message.updateById(params.messageId, updates);
  const author = updated?.authorId ? await User.findById(updated.authorId) : null;
  return presentMessage(updated || msg, author || (updated || msg).authorId, viewerOf(auth));
})
.delete('/channels/:channelId/messages/:messageId', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  const msg = await loadChannelMessage(params.channelId, params.messageId);
  if (!msg) { set.status = 404; return UNKNOWN_MESSAGE; }

  // Own messages always; anyone else's needs MANAGE_MESSAGES in this channel
  // (overwrites apply; never in DMs).
  if (!compareIds(msg.authorId, auth.botUser.id)) {
    const c = await requireChannelAction(params.channelId, auth.botUser.id, 'manage_messages');
    if (!c.ok) { set.status = c.status; return c.body; }
  }

  await Message.deleteById(params.messageId);
  set.status = 204;
  return '';
})
.post('/channels/:channelId/messages/bulk-delete', async ({ headers, params, body, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  const { messages } = body as { messages?: string[] };
  if (!messages || !Array.isArray(messages) || messages.length < 2 || messages.length > 100) {
    set.status = 400; return { code: 50016, message: 'Invalid number of messages (2-100)' };
  }

  // Bulk delete always requires MANAGE_MESSAGES in this channel.
  const c = await requireChannelAction(params.channelId, auth.botUser.id, 'manage_messages');
  if (!c.ok) { set.status = c.status; return c.body; }

  // Only messages that are actually in this channel.
  const found = await Message.find({ id: { in: messages.filter((id) => typeof id === 'string' && isValidObjectId(id)) } });
  const deletable = found
    .filter((m: { channelId: string }) => compareIds(m.channelId, params.channelId))
    .map((m: { id: string }) => m.id);
  for (const id of deletable) {
    await Message.deleteById(id);
  }
  return { deleted_messages: deletable };
})

// ─── Pins ──────────────────────────────────────────────────
.get('/channels/:channelId/pins', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  const c = await requireChannelAction(params.channelId, auth.botUser.id, 'read_history');
  if (!c.ok) { set.status = c.status; return c.body; }
  const pinned = await Message.find({ channelId: params.channelId, pinned: true, isDeleted: false });
  return presentMessages(pinned as IMessage[], viewerOf(auth));
})
.put('/channels/:channelId/pins/:messageId', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  const msg = await loadChannelMessage(params.channelId, params.messageId);
  if (!msg) { set.status = 404; return UNKNOWN_MESSAGE; }
  const c = await requireChannelAction(params.channelId, auth.botUser.id, 'pin');
  if (!c.ok) { set.status = c.status; return c.body; }

  await Message.updateById(params.messageId, { pinned: true });
  try {
    const publish = c.channel.serverId
      ? (await import('@/lib/api/channels')).publishToChannel
      : (await import('@/lib/api/dms')).publishToDm;
    publish(params.channelId, { type: 'pin_update', messageId: params.messageId, pinned: true, updatedBy: auth.botUser.id });
  } catch {}
  set.status = 204;
  return '';
})
.delete('/channels/:channelId/pins/:messageId', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  const msg = await loadChannelMessage(params.channelId, params.messageId);
  if (!msg) { set.status = 404; return UNKNOWN_MESSAGE; }
  const c = await requireChannelAction(params.channelId, auth.botUser.id, 'pin');
  if (!c.ok) { set.status = c.status; return c.body; }

  await Message.updateById(params.messageId, { pinned: false });
  try {
    const publish = c.channel.serverId
      ? (await import('@/lib/api/channels')).publishToChannel
      : (await import('@/lib/api/dms')).publishToDm;
    publish(params.channelId, { type: 'pin_update', messageId: params.messageId, pinned: false, updatedBy: auth.botUser.id });
  } catch {}
  set.status = 204;
  return '';
})

// ─── Reactions ─────────────────────────────────────────────
.put('/channels/:channelId/messages/:messageId/reactions/:emoji/@me', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  const msg = await loadChannelMessage(params.channelId, params.messageId);
  if (!msg) { set.status = 404; return UNKNOWN_MESSAGE; }

  const emojiKey = params.emoji;
  const matchKey = (r: StoredReaction) => r.emoji?.name === emojiKey || r.emoji?.id === emojiKey;
  // Joining an existing reaction needs VIEW_CHANNEL + READ_MESSAGE_HISTORY;
  // adding a new emoji also needs ADD_REACTIONS (Discord).
  const exists = ((msg.reactions as StoredReaction[] | null) ?? []).some(matchKey);
  const c = await requireChannelAction(params.channelId, auth.botUser.id, exists ? 'react_existing' : 'react_new');
  if (!c.ok) { set.status = c.status; return c.body; }
  // Row-locked so concurrent reactions can't overwrite each other.
  await Message.mutateReactions<StoredReaction>(params.messageId, (current) =>
    addReaction(current, matchKey, { name: emojiKey }, auth.botUser.id).reactions,
  );
  set.status = 204;
  return '';
})
.delete('/channels/:channelId/messages/:messageId/reactions/:emoji/@me', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  const msg = await loadChannelMessage(params.channelId, params.messageId);
  if (!msg) { set.status = 404; return UNKNOWN_MESSAGE; }
  const c = await requireChannelAction(params.channelId, auth.botUser.id, 'react_existing');
  if (!c.ok) { set.status = c.status; return c.body; }

  const emojiKey = params.emoji;
  const matchKey = (r: StoredReaction) => r.emoji?.name === emojiKey || r.emoji?.id === emojiKey;
  await Message.mutateReactions<StoredReaction>(params.messageId, (current) => {
    const result = removeReaction(current, matchKey, auth.botUser.id);
    return result.changed ? result.reactions : null;
  });
  set.status = 204;
  return '';
})
.delete('/channels/:channelId/messages/:messageId/reactions/:emoji/:userId', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  const msg = await loadChannelMessage(params.channelId, params.messageId);
  if (!msg) { set.status = 404; return UNKNOWN_MESSAGE; }
  // Removing someone else's reaction needs MANAGE_MESSAGES in this channel
  // (never in DMs); the bot's own id behaves like @me.
  const own = compareIds(params.userId, auth.botUser.id);
  const c = await requireChannelAction(params.channelId, auth.botUser.id, own ? 'react_existing' : 'manage_messages');
  if (!c.ok) { set.status = c.status; return c.body; }

  const emojiKey = params.emoji;
  const matchKey = (r: StoredReaction) => r.emoji?.name === emojiKey || r.emoji?.id === emojiKey;
  await Message.mutateReactions<StoredReaction>(params.messageId, (current) => {
    const result = removeReaction(current, matchKey, own ? auth.botUser.id : params.userId);
    return result.changed ? result.reactions : null;
  });
  set.status = 204;
  return '';
})
.get('/channels/:channelId/messages/:messageId/reactions/:emoji', async ({ headers, params, query, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  const c = await requireChannelAction(params.channelId, auth.botUser.id, 'read_history');
  if (!c.ok) { set.status = c.status; return c.body; }
  const msg = await loadChannelMessage(params.channelId, params.messageId);
  if (!msg) { set.status = 404; return UNKNOWN_MESSAGE; }

  const emojiKey = params.emoji;
  const reaction = ((msg.reactions as Array<{ emoji: { name: string; id?: string }; count: number; userIds: string[] }> | undefined) || []).find((r: { emoji: { name: string; id?: string }; count: number; userIds: string[] }) => r.emoji.name === emojiKey || r.emoji.id === emojiKey);
  if (!reaction) return [];

  const limit = Math.min(parseInt(query.limit as string) || 25, 100);
  const userIds = reaction.userIds.slice(0, limit);
  const users = userIds.length > 0 ? await User.find({ id: { in: userIds } }) : [];
  return users.map(formatUser);
})
.delete('/channels/:channelId/messages/:messageId/reactions', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  const msg = await loadChannelMessage(params.channelId, params.messageId);
  if (!msg) { set.status = 404; return UNKNOWN_MESSAGE; }
  // Wiping every reaction needs MANAGE_MESSAGES in this channel (Discord).
  const c = await requireChannelAction(params.channelId, auth.botUser.id, 'manage_messages');
  if (!c.ok) { set.status = c.status; return c.body; }
  await Message.mutateReactions<StoredReaction>(params.messageId, (current) => (current.length ? [] : null));
  set.status = 204;
  return '';
})

// ─── Typing ────────────────────────────────────────────────
.post('/channels/:channelId/typing', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  const c = await requireChannelAction(params.channelId, auth.botUser.id, 'typing');
  if (!c.ok) { set.status = c.status; return c.body; }
  set.status = 204;
  return '';
})

// ─── Application Commands ──────────────────────────────────
.get('/applications/:appId/commands', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  if (!ownsApp(auth, params.appId)) { set.status = 403; return MISSING_ACCESS; }
  const cmds = await AppCommand.find({ applicationId: params.appId, guildId: null });
  return cmds.map((c: IAppCommand) => ({
    id: c.id,
    application_id: params.appId,
    name: c.name,
    description: c.description,
    options: c.options ?? [],
    default_permission: c.defaultPermission,
    type: c.type,
    version: c.version,
  }));
})
.put('/applications/:appId/commands', async ({ headers, params, body, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  if (!ownsApp(auth, params.appId)) { set.status = 403; return MISSING_ACCESS; }
  // Bulk overwrite global commands.
  const commands = (body as Array<{ name?: string; description?: string; options?: unknown[]; default_permission?: boolean; type?: number }>) ?? [];
  const existing = await AppCommand.find({ applicationId: params.appId, guildId: null });
  for (const cmd of existing) {
    await AppCommand.deleteById(cmd.id);
  }
  const created: IAppCommand[] = [];
  for (const c of commands) {
    const row = await AppCommand.create({
      applicationId: params.appId,
      guildId: null,
      name: c.name ?? '',
      description: c.description ?? '',
      options: c.options ?? [],
      defaultPermission: c.default_permission ?? true,
      type: c.type ?? 1,
    });
    created.push(row);
  }
  return created.map((c: IAppCommand) => ({
    id: c.id,
    application_id: params.appId,
    name: c.name,
    description: c.description,
    options: c.options,
    default_permission: c.defaultPermission,
    type: c.type,
    version: c.version,
  }));
})
.post('/interactions/:interactionId/:interactionToken/callback', async ({ params, body, set }) => {
  const { handleInteractionCallback } = await import('@/lib/services/interactions');
  const result = await handleInteractionCallback(params.interactionToken, body as { type?: number; data?: { content?: string; embeds?: unknown[]; flags?: number } });
  if (!result.ok) {
    set.status = 404;
    return { code: 10062, message: 'Interaction token not found or expired' };
  }
  set.status = 204;
  return '';
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
  const webhooks = await ChannelWebhook.find({ serverId: params.guildId });
  return webhooks.map((w: any) => ({
    id: w.id,
    type: 1,
    guild_id: params.guildId,
    channel_id: w.channelId,
    name: w.name,
    avatar: w.avatar,
    token: w.token,
    creator_id: w.creatorId,
  }));
})
.get('/channels/:channelId/webhooks', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  // MANAGE_WEBHOOKS in this channel (overwrites apply); never in DMs.
  const c = await requireChannelAction(params.channelId, auth.botUser.id, 'manage_webhooks');
  if (!c.ok) { set.status = c.status; return c.body; }
  const channel = c.channel;
  if (!channel.serverId) { set.status = 403; return MISSING_PERMISSIONS; }
  const webhooks = await ChannelWebhook.find({ channelId: params.channelId });
  return webhooks.map((w: any) => ({
    id: w.id,
    type: 1,
    guild_id: w.serverId ?? null,
    channel_id: params.channelId,
    name: w.name,
    avatar: w.avatar,
    token: w.token,
    creator_id: w.creatorId,
  }));
})
.post('/channels/:channelId/webhooks', async ({ headers, params, body, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }

  // MANAGE_WEBHOOKS in this channel (overwrites apply); never in DMs.
  const c = await requireChannelAction(params.channelId, auth.botUser.id, 'manage_webhooks');
  if (!c.ok) { set.status = c.status; return c.body; }
  const channel = c.channel;
  if (!channel.serverId) { set.status = 403; return MISSING_PERMISSIONS; }

  const { name, avatar } = body as { name?: string; avatar?: string };
  if (!name) { set.status = 400; return { code: 50035, message: 'Name is required' }; }

  const token = crypto.randomBytes(24).toString('hex');
  const webhook = await ChannelWebhook.create({
    channelId: params.channelId,
    serverId: channel.serverId ?? undefined,
    name,
    avatar: avatar ?? null,
    token,
    url: `${config.API_BASE_URL}/api/webhooks/${params.channelId}/${token}`,
    creatorId: auth.botUser.id,
  });
  return {
    id: webhook.id,
    type: 1,
    guild_id: channel.serverId ?? null,
    channel_id: params.channelId,
    name: webhook.name,
    avatar: webhook.avatar,
    token: webhook.token,
    creator_id: auth.botUser.id,
  };
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
  return {
    id: webhook.id,
    type: 1,
    guild_id: webhook.serverId ?? null,
    channel_id: webhook.channelId,
    name: webhook.name,
    avatar: webhook.avatar,
    token: isCreator || canManage ? webhook.token : undefined,
    creator_id: webhook.creatorId,
  };
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
// Interaction followup: Discord-style POST /webhooks/:appId/:interactionToken
// Used by bots that deferred their response (type 5) to send a followup message.
.post('/webhooks/:applicationId/:interactionToken', async ({ params, body, set }) => {
  const { handleInteractionCallback } = await import('@/lib/services/interactions');
  const result = await handleInteractionCallback(params.interactionToken, { data: body as { content?: string; embeds?: unknown[]; flags?: number } });
  if (!result.ok) {
    set.status = 404;
    return { code: 10062, message: 'Interaction token not found or expired' };
  }
  set.status = 204;
  return '';
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

// ─── Application Command CRUD ──────────────────────────────
.get('/applications/:appId/commands/:commandId', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  if (!ownsApp(auth, params.appId)) { set.status = 403; return MISSING_ACCESS; }

  if (!isValidObjectId(params.commandId)) { set.status = 404; return { code: 10063, message: 'Unknown Command' }; }
  const cmd = await AppCommand.findById(params.commandId);
  if (!cmd || !compareIds(cmd.applicationId, auth.app.id) || cmd.guildId != null) { set.status = 404; return { code: 10063, message: 'Unknown Command' }; }
  return {
    id: cmd.id,
    application_id: cmd.applicationId,
    name: cmd.name,
    description: cmd.description,
    options: cmd.options ?? [],
    default_permission: cmd.defaultPermission,
    type: cmd.type,
    version: cmd.version,
  };
})
.post('/applications/:appId/commands', async ({ headers, params, body, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  if (!ownsApp(auth, params.appId)) { set.status = 403; return MISSING_ACCESS; }

  const { name, description, options, default_permission, type } = body as { name?: string; description?: string; options?: unknown[]; default_permission?: boolean; type?: number };
  if (!name || !description) { set.status = 400; return { code: 50035, message: 'Name and description are required' }; }

  const cmd = await AppCommand.create({
    applicationId: auth.app.id,
    guildId: null,
    name,
    description,
    options: options ?? [],
    defaultPermission: default_permission ?? true,
    type: type ?? 1,
  });
  return {
    id: cmd.id,
    application_id: params.appId,
    name: cmd.name,
    description: cmd.description,
    options: cmd.options,
    default_permission: cmd.defaultPermission,
    type: cmd.type,
    version: cmd.version,
  };
})
.patch('/applications/:appId/commands/:commandId', async ({ headers, params, body, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  if (!ownsApp(auth, params.appId)) { set.status = 403; return MISSING_ACCESS; }

  const cmd = isValidObjectId(params.commandId) ? await AppCommand.findById(params.commandId) : null;
  if (!cmd || !compareIds(cmd.applicationId, auth.app.id) || cmd.guildId != null) { set.status = 404; return { code: 10063, message: 'Unknown Command' }; }

  const { name, description, options, default_permission } = body as { name?: string; description?: string; options?: unknown[]; default_permission?: boolean };
  const updates: Record<string, unknown> = {};
  if (name !== undefined) updates.name = name;
  if (description !== undefined) updates.description = description;
  if (options !== undefined) updates.options = options;
  if (default_permission !== undefined) updates.defaultPermission = default_permission;
  const updated = await AppCommand.updateById(params.commandId, updates);
  const result = updated || cmd;
  return {
    id: result.id,
    application_id: params.appId,
    name: result.name,
    description: result.description,
    options: result.options,
    default_permission: result.defaultPermission,
    type: result.type,
    version: result.version,
  };
})
.delete('/applications/:appId/commands/:commandId', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  if (!ownsApp(auth, params.appId)) { set.status = 403; return MISSING_ACCESS; }

  const cmd = isValidObjectId(params.commandId) ? await AppCommand.findById(params.commandId) : null;
  if (!cmd || !compareIds(cmd.applicationId, auth.app.id) || cmd.guildId != null) { set.status = 404; return { code: 10063, message: 'Unknown Command' }; }
  await AppCommand.deleteById(params.commandId);
  set.status = 204;
  return '';
})

// ─── Guild Application Commands ────────────────────────────
.get('/applications/:appId/guilds/:guildId/commands', async ({ headers, params, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  if (!ownsApp(auth, params.appId)) { set.status = 403; return MISSING_ACCESS; }

  const cmds = await AppCommand.find({ applicationId: params.appId, guildId: params.guildId });
  return cmds.map((c: IAppCommand) => ({
    id: c.id,
    application_id: params.appId,
    guild_id: params.guildId,
    name: c.name,
    description: c.description,
    options: c.options ?? [],
    default_permission: c.defaultPermission,
    type: c.type,
    version: c.version,
  }));
})
.put('/applications/:appId/guilds/:guildId/commands', async ({ headers, params, body, set }) => {
  const auth = await authenticateBot(headers);
  if (!auth) { set.status = 401; return { code: 0, message: '401: Unauthorized' }; }
  if (!ownsApp(auth, params.appId)) { set.status = 403; return MISSING_ACCESS; }

  // Bulk overwrite guild commands
  const commands = body as Array<{ name?: string; description?: string; options?: unknown[]; default_permission?: boolean; type?: number }>;
  const existing = await AppCommand.find({ applicationId: params.appId, guildId: params.guildId });
  for (const cmd of existing) {
    await AppCommand.deleteById(cmd.id);
  }
  const created: IAppCommand[] = [];
  for (const c of commands) {
    const row = await AppCommand.create({
      applicationId: params.appId,
      guildId: params.guildId,
      name: c.name ?? '',
      description: c.description ?? '',
      options: c.options ?? [],
      defaultPermission: c.default_permission ?? true,
      type: c.type ?? 1,
    });
    created.push(row);
  }
  return created.map((c: IAppCommand) => ({
    id: c.id,
    application_id: params.appId,
    guild_id: params.guildId,
    name: c.name,
    description: c.description,
    options: c.options,
    default_permission: c.defaultPermission,
    type: c.type,
    version: c.version,
  }));
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

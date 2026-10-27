// Discord v10 bot routes: lobbies, invite target users and Social SDK.
// Mounted at the end of botApiRoutes (src/lib/api/botApi.ts), so the id
// boundary, per-bot rate limits and the guild/channel access guard registered
// there run for every route here too. Same conventions as botApi.ts.
//
// Lobbies (Discord's Lobby resource) are app-scoped: a bot only ever sees and
// changes its own application's lobbies (others answer Unknown lobby), and the
// Bearer routes take a user's OAuth2 token with `sdk.social_layer` granted to
// that same application. Storage: src/lib/services/lobbies.ts; validation and
// serializers: src/lib/botapi/lobbies.ts.
//
// Invite target users: src/lib/services/inviteTargets.ts (the web join route
// in src/lib/api/servers.ts enforces the list).
//
// Partner SDK (provisional accounts): SerikaCord has no provisional accounts,
// so the token / unmerge routes validate like Discord and answer 530000; the
// DM moderation-metadata route stores app-scoped metadata (src/lib/botapi/partnerSdk.ts).
import { Elysia } from 'elysia';
import { createHash, timingSafeEqual } from 'crypto';
import type { IApplication, IUser } from '@/lib/models';
import { checkRateLimit, getClientIP, isValidObjectId } from '@/lib/security';
import { BOT_LIMITS, rateLimitedResponse, rateLimitHeaders } from '@/lib/security/botRateLimit';
import { FormErrors, formError, FE } from '@/lib/botapi/formErrors';
import {
  LOBBY_MEMBER_FLAGS, UNKNOWN_LOBBY, hashLobbySecret, linkedChannelForwardText, parseBulkMembers, parseCreateLobby,
  parseCreateOrJoin, parseLobbyMessage, parseMemberUpsert, parseMessageLimit, parseModerationMetadata, parseModifyLobby,
  toDiscordLobbyMember, type MemberInput,
} from '@/lib/botapi/lobbies';
import {
  INVITE_TARGET_LIMITS, buildTargetUsersCsv, parseTargetUsersCsv, parseUserIdList, targetUsersJobStatus, targetUsersMarker,
} from '@/lib/botapi/inviteTargets';
import {
  INVALID_CLIENT_SECRET, PROVISIONAL_ACCOUNTS_NOT_ENABLED, parseBotTokenRequest, parseTokenExchange,
} from '@/lib/botapi/partnerSdk';
import { PERMISSION_BITS as P, hasPermission } from '@/lib/permissions/bits';
import { applyTimeout, botCan } from '@/lib/permissions/botChannel';
import type { LobbyRow } from '@/lib/services/lobbies';

type Headers = Record<string, string | undefined>;
type SetLike = { status?: number | string; headers: Record<string, string | number> };
type ApiError = { code: number; message: string };

const UNAUTHORIZED: ApiError = { code: 0, message: '401: Unauthorized' };
const MISSING_ACCESS: ApiError = { code: 50001, message: 'Missing Access' };
const MISSING_PERMISSIONS: ApiError = { code: 50013, message: 'Missing Permissions' };
const MISSING_SCOPE: ApiError = { code: 50026, message: 'Missing required OAuth2 scope' };
const UNKNOWN_USER: ApiError = { code: 10013, message: 'Unknown User' };
const UNKNOWN_MEMBER: ApiError = { code: 10007, message: 'Unknown Member' };
const UNKNOWN_CHANNEL: ApiError = { code: 10003, message: 'Unknown Channel' };
const UNKNOWN_MESSAGE: ApiError = { code: 10008, message: 'Unknown Message' };
const UNKNOWN_INVITE: ApiError = { code: 10006, message: 'Unknown Invite' };
const BOTS_CANNOT_USE: ApiError = { code: 20001, message: 'Bots cannot use this endpoint' };
/** The OAuth2 scope Discord's Social SDK lobby routes take. */
const SOCIAL_SCOPE = 'sdk.social_layer';

const lower = (s: string) => s.toLowerCase();

// ─── Callers ─────────────────────────────────────────────────────────────────

/** A bot token of an application (the app acts as itself). */
type BotCaller = { kind: 'bot'; app: IApplication; userId: string };
/** A user's sdk.social_layer Bearer token for an application. */
type UserCaller = { kind: 'user'; app: IApplication; userId: string; user: IUser };
type Caller = BotCaller | UserCaller;
type Fail = { ok: false; status: number; body: ApiError };

async function botCaller(headers: Headers): Promise<BotCaller | null> {
  const h = headers.authorization;
  if (!h || /^Bearer\s/i.test(h) || /^Basic\s/i.test(h)) return null;
  const token = h.startsWith('Bot ') ? h.slice(4).trim() : h.trim();
  if (!token) return null;
  const { resolveBotToken } = await import('@/lib/services/botTokens');
  const app = await resolveBotToken(token);
  if (!app?.botId) return null;
  return { kind: 'bot', app, userId: app.botId };
}

/** The Bearer caller, null without a Bearer header, or the error to answer. */
async function bearerCaller(headers: Headers): Promise<UserCaller | Fail | null> {
  const { parseBearer } = await import('@/lib/oauth/scopes');
  if (!headers.authorization || !/^Bearer\s/i.test(headers.authorization)) return null;
  const token = parseBearer(headers.authorization);
  if (!token) return { ok: false, status: 401, body: UNAUTHORIZED };
  const { resolveBearerToken } = await import('@/lib/services/oauth2Tokens');
  const grant = await resolveBearerToken(token);
  if (!grant) return { ok: false, status: 401, body: UNAUTHORIZED };
  // A client_credentials token acts as the app owner, never as a lobby player.
  if (grant.grantType === 'client_credentials' || !grant.scopes.includes(SOCIAL_SCOPE)) return { ok: false, status: 403, body: MISSING_SCOPE };
  const { User, Application } = await import('@/lib/models');
  const [user, app] = await Promise.all([User.findById(grant.userId), Application.findById(grant.applicationId)]);
  if (!user || !app || user.isBanned || user.isBot) return { ok: false, status: 401, body: UNAUTHORIZED };
  return { kind: 'user', app, userId: user.id, user };
}

/** Bot token or (when `bearer`) an sdk.social_layer Bearer token. */
async function callerOf(headers: Headers, opts: { bearer: boolean }): Promise<{ ok: true; caller: Caller } | Fail> {
  const bot = await botCaller(headers);
  if (bot) return { ok: true, caller: bot };
  if (opts.bearer) {
    const b = await bearerCaller(headers);
    if (b && 'kind' in b) return { ok: true, caller: b };
    if (b) return b;
  }
  return { ok: false, status: 401, body: UNAUTHORIZED };
}

/**
 * Bearer callers aren't covered by the per-bot limiter hook: give them the
 * same budgets keyed by user (writes, message sends, invites).
 */
async function limitUser(caller: Caller, set: SetLike, limiter: 'botWrite' | 'botMessageSend'): Promise<unknown | null> {
  if (caller.kind !== 'user') return null;
  for (const [name, key] of [['botGlobal', `oauth:${caller.userId}`], [limiter, `oauth:${caller.userId}:${limiter}`]] as const) {
    const r = await checkRateLimit(name, key);
    if (!r.success) {
      const retry = (r.resetAfterMs ?? (r.retryAfter ?? 1) * 1000) / 1000;
      const limited = rateLimitedResponse({ retryAfterSeconds: retry, global: name === 'botGlobal' });
      Object.assign(set.headers, rateLimitHeaders({ limit: BOT_LIMITS[name].points, remaining: 0, resetAfterSeconds: retry, bucket: name }), limited.headers);
      set.status = 429;
      return limited.body;
    }
  }
  return null;
}

function fail(set: SetLike, status: number, body: unknown) {
  set.status = status;
  return body;
}

function noContent(set: SetLike) {
  set.status = 204;
  return '';
}

// ─── Lobby helpers ───────────────────────────────────────────────────────────

const lobbies = () => import('@/lib/services/lobbies');

/** The caller's application's lobby, or the error. Bearer callers must be members unless `memberOptional`. */
async function lobbyFor(caller: Caller, lobbyId: string, opts: { requireMember?: boolean } = {}): Promise<{ ok: true; lobby: LobbyRow } | Fail> {
  if (!isValidObjectId(lobbyId)) return { ok: false, status: 404, body: UNKNOWN_LOBBY };
  const svc = await lobbies();
  const lobby = await svc.loadLobby(lobbyId, caller.app.id);
  if (!lobby) return { ok: false, status: 404, body: UNKNOWN_LOBBY };
  if (caller.kind === 'user' && opts.requireMember) {
    const m = await svc.getMember(lobby.id, caller.userId);
    if (!m) return { ok: false, status: 403, body: MISSING_ACCESS };
  }
  return { ok: true, lobby };
}

/**
 * Upsert a list of members for an application (create / modify / bulk).
 * Unknown users fail the request (404 Unknown User) before anything changes;
 * users who never authorized the app, bots, banned users, and users at the
 * lobby / per-user caps are dropped silently, as on Discord.
 */
async function preflightMembers(app: IApplication, members: MemberInput[]): Promise<{ ok: true; eligible: Set<string> } | Fail> {
  const svc = await lobbies();
  const upserts = members.filter((m) => !m.remove).map((m) => m.id);
  const check = await svc.checkLobbyUsers(app.id, upserts);
  if (check.unknown.length > 0) return { ok: false, status: 404, body: UNKNOWN_USER };
  return { ok: true, eligible: check.eligible };
}

async function applyMembers(lobby: LobbyRow, members: MemberInput[], eligible: Set<string>) {
  const svc = await lobbies();
  const out: ReturnType<typeof toDiscordLobbyMember>[] = [];
  const removals = members.filter((m) => m.remove).map((m) => m.id).filter(isValidObjectId);
  await svc.removeMembers(lobby.id, removals);
  for (const m of members) {
    if (m.remove || !eligible.has(lower(m.id))) continue;
    const r = await svc.upsertMember(lobby, m.id, { metadata: m.metadata, flags: m.flags, additionalName: m.additionalName });
    if (r.ok) out.push(toDiscordLobbyMember(r.member));
  }
  return out;
}

/** Permissions `userId` holds in a server channel (timeouts applied), or null if not a member. */
async function channelPerms(userId: string, channel: { id: string; serverId: string | null; [k: string]: unknown }): Promise<bigint | null> {
  if (!channel.serverId) return null;
  const { ServerMember } = await import('@/lib/models');
  const member = await ServerMember.findOne({ serverId: channel.serverId, userId });
  const { getMemberChannelPermissions } = await import('@/lib/api/channels');
  const perms = await getMemberChannelPermissions(userId, channel as never, member ?? null);
  if (!member && perms === 0n) return null;
  return applyTimeout(perms, member?.communicationDisabledUntil ?? null);
}

/**
 * Forward a lobby message into its linked channel, as the application's bot
 * (best-effort: only when the bot is in that server and may send there).
 */
async function forwardToLinkedChannel(lobby: LobbyRow, app: IApplication, authorName: string, content: string): Promise<void> {
  if (!lobby.linkedChannelId || !app.botId) return;
  const { Channel } = await import('@/lib/models');
  const channel = await Channel.findById(lobby.linkedChannelId);
  if (!channel?.serverId) return;
  const perms = await channelPerms(app.botId, channel as never);
  if (perms === null || !botCan(perms, 'send')) return;
  const { createAppMessage } = await import('@/lib/services/appMessages');
  await createAppMessage({
    author: { kind: 'bot', botId: app.botId, applicationId: app.id },
    channel,
    body: { content: linkedChannelForwardText(authorName, content), embeds: [], components: null, attachments: [], flags: 0, mentionedUserIds: [] },
  });
}

/** A single-use, one-hour invite to the lobby's linked channel that only `userId` may accept. */
async function createLobbyInvite(lobby: LobbyRow, app: IApplication, userId: string): Promise<{ ok: true; code: string } | Fail> {
  if (!lobby.linkedChannelId) return { ok: false, status: 404, body: UNKNOWN_CHANNEL };
  const { Channel, Server, Invite } = await import('@/lib/models');
  const channel = await Channel.findById(lobby.linkedChannelId);
  if (!channel?.serverId) return { ok: false, status: 404, body: UNKNOWN_CHANNEL };
  const server = await Server.findById(channel.serverId);
  if (!server) return { ok: false, status: 404, body: UNKNOWN_CHANNEL };
  const settings = server.settings as { invites?: { lockToVanity?: boolean } } | null | undefined;
  if (settings?.invites?.lockToVanity && server.vanityUrlCode) return { ok: false, status: 403, body: MISSING_PERMISSIONS };
  const inviterId = lobby.linkedById ?? app.botId;
  if (!inviterId) return { ok: false, status: 403, body: MISSING_ACCESS };
  // Linking was checked once; access can change since. The inviter must still
  // be in the server and able to see the channel and create invites there,
  // or a kicked bot (or a user who lost access) could keep minting invites.
  const inviterPerms = await channelPerms(inviterId, channel as never);
  const { PERMISSION_BITS: P, hasPermission } = await import('@/lib/permissions/bits');
  if (
    inviterPerms === null
    || !(hasPermission(inviterPerms, P.ADMINISTRATOR)
      || (hasPermission(inviterPerms, P.VIEW_CHANNEL) && hasPermission(inviterPerms, P.CREATE_INVITE)))
  ) {
    return { ok: false, status: 403, body: MISSING_PERMISSIONS };
  }
  const { nanoid } = await import('nanoid');
  const now = Date.now();
  const invite = await Invite.create({
    code: nanoid(10),
    serverId: server.id,
    channelId: channel.id,
    inviterId,
    maxUses: 1,
    maxAge: 3600,
    temporary: false,
    expiresAt: new Date(now + 3600 * 1000),
    metadata: { source: 'lobby', lobby_id: lobby.id, application_id: app.id },
  });
  const { addTargetUsers } = await import('@/lib/services/inviteTargets');
  await addTargetUsers(invite, [userId]);
  void import('@/lib/services/guildGatewayEvents').then((m) => m.emitInviteCreate(invite)).catch(() => {});
  return { ok: true, code: invite.code };
}

// ─── Invite target helpers ───────────────────────────────────────────────────

const targets = () => import('@/lib/services/inviteTargets');

async function inviteFor(headers: Headers, code: string, mode: 'read' | 'write') {
  const caller = await botCaller(headers);
  if (!caller) return { ok: false as const, status: 401, body: UNAUTHORIZED };
  const svc = await targets();
  const inv = await svc.loadLiveInvite(code);
  if (!inv) return { ok: false as const, status: 404, body: UNKNOWN_INVITE };
  const denied = await svc.checkTargetAccess(inv, caller.userId, mode);
  if (denied) return { ok: false as const, ...denied };
  return { ok: true as const, inv, caller };
}

function tooManyTargets() {
  return formError(['user_ids'], FE.MAX_LENGTH, `An invite may target at most ${INVITE_TARGET_LIMITS.perInvite} users.`);
}

/** Constant-time compare of two secrets (hash first so lengths don't leak). */
function secretEquals(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

// ─── Routes ──────────────────────────────────────────────────────────────────

export const socialBotRoutes = new Elysia()

// ─── Lobbies ─────────────────────────────────────────────────────────────────
.post('/lobbies', async ({ headers, body, set }) => {
  const caller = await botCaller(headers);
  if (!caller) return fail(set, 401, UNAUTHORIZED);
  const { metadata: rawMetadata, members: rawMembers, idle_timeout_seconds, flags: rawFlags } = (body ?? {}) as Record<string, unknown>;
  const parsed = parseCreateLobby({ metadata: rawMetadata, members: rawMembers, idle_timeout_seconds, flags: rawFlags });
  if (!parsed.ok) return fail(set, 400, parsed.errors.toBody());
  const { metadata, members, idleTimeoutSeconds, flags } = parsed.value;
  const pre = await preflightMembers(caller.app, members);
  if (!pre.ok) return fail(set, pre.status, pre.body);
  const svc = await lobbies();
  const created = await svc.createLobby(caller.app.id, { metadata: metadata ?? null, idleTimeoutSeconds, flags });
  if (!created.ok) return fail(set, 400, { code: 0, message: 'Maximum number of lobbies reached for this application' });
  await applyMembers(created.lobby, members, pre.eligible);
  return svc.lobbyView(created.lobby);
})
// Create or join by secret. A user's token joins the lobby; a bot token only gets / creates it.
.put('/lobbies', async ({ headers, body, set }) => {
  const c = await callerOf(headers, { bearer: true });
  if (!c.ok) return fail(set, c.status, c.body);
  const caller = c.caller;
  const limited = await limitUser(caller, set, 'botWrite');
  if (limited) return limited;
  const { secret: rawSecret, lobby_metadata, member_metadata, idle_timeout_seconds, flags: rawFlags } = (body ?? {}) as Record<string, unknown>;
  const parsed = parseCreateOrJoin({ secret: rawSecret, lobby_metadata, member_metadata, idle_timeout_seconds, flags: rawFlags });
  if (!parsed.ok) return fail(set, 400, parsed.errors.toBody());
  const { secret, lobbyMetadata, memberMetadata, idleTimeoutSeconds, flags } = parsed.value;
  const svc = await lobbies();
  const r = await svc.createLobby(caller.app.id, {
    metadata: lobbyMetadata ?? null,
    idleTimeoutSeconds,
    flags,
    secretHash: hashLobbySecret(caller.app.id, secret),
  });
  if (!r.ok) return fail(set, 400, { code: 0, message: 'Maximum number of lobbies reached for this application' });
  let lobby = r.lobby;
  if (!r.created && (lobbyMetadata !== undefined || idleTimeoutSeconds !== undefined || flags !== undefined)) {
    lobby = (await svc.updateLobby(lobby.id, { metadata: lobbyMetadata, idleTimeoutSeconds, flags })) ?? lobby;
  }
  if (caller.kind === 'user') {
    const joined = await svc.upsertMember(lobby, caller.userId, memberMetadata !== undefined ? { metadata: memberMetadata } : {});
    if (!joined.ok) {
      return fail(set, 400, joined.reason === 'lobby_full'
        ? { code: 0, message: 'Maximum number of lobby members reached (1000)' }
        : { code: 0, message: 'Maximum number of lobbies reached for this user (100)' });
    }
    await svc.touchLobby(lobby.id);
  }
  return svc.lobbyView(lobby);
})
.get('/lobbies/:lobbyId', async ({ headers, params, set }) => {
  const caller = await botCaller(headers);
  if (!caller) return fail(set, 401, UNAUTHORIZED);
  const l = await lobbyFor(caller, params.lobbyId);
  if (!l.ok) return fail(set, l.status, l.body);
  return (await lobbies()).lobbyView(l.lobby);
})
.patch('/lobbies/:lobbyId', async ({ headers, params, body, set }) => {
  const caller = await botCaller(headers);
  if (!caller) return fail(set, 401, UNAUTHORIZED);
  const { metadata: rawMetadata, members: rawMembers, idle_timeout_seconds, flags: rawFlags } = (body ?? {}) as Record<string, unknown>;
  const parsed = parseModifyLobby({ metadata: rawMetadata, members: rawMembers, idle_timeout_seconds, flags: rawFlags });
  if (!parsed.ok) return fail(set, 400, parsed.errors.toBody());
  const { metadata, members, idleTimeoutSeconds, flags } = parsed.value;
  const l = await lobbyFor(caller, params.lobbyId);
  if (!l.ok) return fail(set, l.status, l.body);
  const svc = await lobbies();
  if (members !== undefined) {
    const pre = await preflightMembers(caller.app, members);
    if (!pre.ok) return fail(set, pre.status, pre.body);
    const keep = members.map((m) => m.id).filter((id) => pre.eligible.has(lower(id)));
    await svc.removeMembersExcept(l.lobby.id, keep);
    await applyMembers(l.lobby, members, pre.eligible);
  }
  const lobby = (await svc.updateLobby(l.lobby.id, { metadata, idleTimeoutSeconds, flags })) ?? l.lobby;
  return svc.lobbyView(lobby);
})
// Safe to call for a lobby that is already gone (Discord), so unknown ids answer 204 too.
.delete('/lobbies/:lobbyId', async ({ headers, params, set }) => {
  const caller = await botCaller(headers);
  if (!caller) return fail(set, 401, UNAUTHORIZED);
  if (isValidObjectId(params.lobbyId)) {
    const svc = await lobbies();
    const lobby = await svc.loadLobby(params.lobbyId, caller.app.id);
    if (lobby) await svc.deleteLobbyRows([lobby.id]);
  }
  return noContent(set);
})
// Link (channel_id) or unlink (no channel_id) a text channel. Bearer: a member
// with CanLinkLobby; linking also needs View Channel + Send Messages + Manage
// Channels there. A bot token links for its app with the same channel permissions.
.patch('/lobbies/:lobbyId/channel-linking', async ({ headers, params, body, set }) => {
  const c = await callerOf(headers, { bearer: true });
  if (!c.ok) return fail(set, c.status, c.body);
  const caller = c.caller;
  const limited = await limitUser(caller, set, 'botWrite');
  if (limited) return limited;
  const { channel_id } = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const l = await lobbyFor(caller, params.lobbyId, { requireMember: true });
  if (!l.ok) return fail(set, l.status, l.body);
  const svc = await lobbies();
  if (caller.kind === 'user') {
    const me = await svc.getMember(l.lobby.id, caller.userId);
    if (!me || (Number(me.flags) & LOBBY_MEMBER_FLAGS.CAN_LINK_LOBBY) === 0) return fail(set, 403, MISSING_PERMISSIONS);
  }
  if (channel_id === undefined || channel_id === null || channel_id === '') {
    const r = await svc.setLinkedChannel(l.lobby.id, null, null);
    if (!r.ok) return fail(set, 404, UNKNOWN_LOBBY);
    return svc.lobbyView(r.lobby);
  }
  if (typeof channel_id !== 'string' || !isValidObjectId(channel_id)) return fail(set, 404, UNKNOWN_CHANNEL);
  const { Channel } = await import('@/lib/models');
  const channel = await Channel.findById(channel_id);
  if (!channel) return fail(set, 404, UNKNOWN_CHANNEL);
  const perms = channel.serverId ? await channelPerms(caller.userId, channel as never) : null;
  if (perms === null || !hasPermission(perms, P.VIEW_CHANNEL)) return fail(set, 404, UNKNOWN_CHANNEL);
  if (channel.type !== 'text') return fail(set, 400, formError(['channel_id'], 'CHANNEL_TYPE_INVALID', 'Only text channels in a server can be linked to a lobby.'));
  if (channel.nsfw) return fail(set, 400, formError(['channel_id'], 'CHANNEL_AGE_RESTRICTED', 'Age-restricted channels cannot be linked to a lobby.'));
  if (!hasPermission(perms, P.SEND_MESSAGES) || !hasPermission(perms, P.MANAGE_CHANNELS)) return fail(set, 403, MISSING_PERMISSIONS);
  const r = await svc.setLinkedChannel(l.lobby.id, channel.id, caller.userId);
  if (!r.ok) {
    return r.reason === 'conflict'
      ? fail(set, 400, formError(['channel_id'], 'CHANNEL_ALREADY_LINKED', 'This channel is already linked to another lobby.'))
      : fail(set, 404, UNKNOWN_LOBBY);
  }
  return svc.lobbyView(r.lobby);
})
// Leave (Bearer). A bot is never a lobby member: nothing to do once the lobby exists.
.delete('/lobbies/:lobbyId/members/@me', async ({ headers, params, set }) => {
  const c = await callerOf(headers, { bearer: true });
  if (!c.ok) return fail(set, c.status, c.body);
  const limitedLeave = await limitUser(c.caller, set, 'botWrite');
  if (limitedLeave) return limitedLeave;
  const l = await lobbyFor(c.caller, params.lobbyId);
  if (!l.ok) return fail(set, l.status, l.body);
  if (c.caller.kind === 'user') {
    const svc = await lobbies();
    await svc.removeMembers(l.lobby.id, [c.caller.userId]);
    await svc.touchLobby(l.lobby.id);
  }
  return noContent(set);
})
.post('/lobbies/:lobbyId/members/@me/invites', async ({ headers, params, set }) => {
  const c = await callerOf(headers, { bearer: true });
  if (!c.ok) return fail(set, c.status, c.body);
  if (c.caller.kind === 'bot') return fail(set, 403, BOTS_CANNOT_USE);
  const caller = c.caller;
  const limited = await limitUser(caller, set, 'botWrite');
  if (limited) return limited;
  const rl = await checkRateLimit('invite', `lobby:${caller.userId}`);
  if (!rl.success) {
    const limitedBody = rateLimitedResponse({ retryAfterSeconds: rl.retryAfter ?? 1, global: false });
    Object.assign(set.headers, limitedBody.headers);
    return fail(set, 429, limitedBody.body);
  }
  const l = await lobbyFor(caller, params.lobbyId, { requireMember: true });
  if (!l.ok) return fail(set, l.status, l.body);
  const r = await createLobbyInvite(l.lobby, caller.app, caller.userId);
  if (!r.ok) return fail(set, r.status, r.body);
  await (await lobbies()).touchLobby(l.lobby.id);
  return { code: r.code };
})
.post('/lobbies/:lobbyId/members/bulk', async ({ headers, params, body, set }) => {
  const caller = await botCaller(headers);
  if (!caller) return fail(set, 401, UNAUTHORIZED);
  const parsed = parseBulkMembers(body);
  if (!parsed.ok) return fail(set, 400, parsed.errors.toBody());
  const l = await lobbyFor(caller, params.lobbyId);
  if (!l.ok) return fail(set, l.status, l.body);
  const pre = await preflightMembers(caller.app, parsed.value);
  if (!pre.ok) return fail(set, pre.status, pre.body);
  const out = await applyMembers(l.lobby, parsed.value, pre.eligible);
  await (await lobbies()).touchLobby(l.lobby.id);
  return out;
})
.put('/lobbies/:lobbyId/members/:userId', async ({ headers, params, body, set }) => {
  const caller = await botCaller(headers);
  if (!caller) return fail(set, 401, UNAUTHORIZED);
  const { metadata: rawMetadata, flags: rawFlags, additional_name } = (body ?? {}) as Record<string, unknown>;
  const parsed = parseMemberUpsert({ metadata: rawMetadata, flags: rawFlags, additional_name });
  if (!parsed.ok) return fail(set, 400, parsed.errors.toBody());
  const { metadata, flags, additionalName } = parsed.value;
  const l = await lobbyFor(caller, params.lobbyId);
  if (!l.ok) return fail(set, l.status, l.body);
  const svc = await lobbies();
  const check = await svc.checkLobbyUsers(caller.app.id, [params.userId]);
  if (check.unknown.length > 0) return fail(set, 404, UNKNOWN_USER);
  // Only people who authorized this application can be put in its lobbies.
  if (!check.eligible.has(lower(params.userId))) return fail(set, 403, MISSING_ACCESS);
  const r = await svc.upsertMember(l.lobby, params.userId, { metadata, flags, additionalName });
  if (!r.ok) {
    return fail(set, 400, r.reason === 'lobby_full'
      ? { code: 0, message: 'Maximum number of lobby members reached (1000)' }
      : { code: 0, message: 'Maximum number of lobbies reached for this user (100)' });
  }
  await svc.touchLobby(l.lobby.id);
  return toDiscordLobbyMember(r.member);
})
// Safe when the user is not a member; the lobby must exist.
.delete('/lobbies/:lobbyId/members/:userId', async ({ headers, params, set }) => {
  const caller = await botCaller(headers);
  if (!caller) return fail(set, 401, UNAUTHORIZED);
  const l = await lobbyFor(caller, params.lobbyId);
  if (!l.ok) return fail(set, l.status, l.body);
  if (isValidObjectId(params.userId)) {
    const svc = await lobbies();
    await svc.removeMembers(l.lobby.id, [params.userId]);
    await svc.touchLobby(l.lobby.id);
  }
  return noContent(set);
})
.post('/lobbies/:lobbyId/members/:userId/invites', async ({ headers, params, set }) => {
  const caller = await botCaller(headers);
  if (!caller) return fail(set, 401, UNAUTHORIZED);
  const l = await lobbyFor(caller, params.lobbyId);
  if (!l.ok) return fail(set, l.status, l.body);
  if (!isValidObjectId(params.userId)) return fail(set, 404, UNKNOWN_USER);
  const member = await (await lobbies()).getMember(l.lobby.id, params.userId);
  if (!member) return fail(set, 404, UNKNOWN_MEMBER);
  const r = await createLobbyInvite(l.lobby, caller.app, params.userId);
  if (!r.ok) return fail(set, r.status, r.body);
  return { code: r.code };
})
.get('/lobbies/:lobbyId/messages', async ({ headers, params, query, set }) => {
  const c = await callerOf(headers, { bearer: true });
  if (!c.ok) return fail(set, c.status, c.body);
  // Bearer callers skip the per-bot limiter hook: limit reads here too.
  const limitedRead = await limitUser(c.caller, set, 'botWrite');
  if (limitedRead) return limitedRead;
  const { limit } = query as Record<string, string | undefined>;
  const lim = parseMessageLimit(limit);
  if (!lim.ok) return fail(set, 400, lim.errors.toBody());
  const l = await lobbyFor(c.caller, params.lobbyId, { requireMember: true });
  if (!l.ok) return fail(set, l.status, l.body);
  const svc = await lobbies();
  if (c.caller.kind === 'user') await svc.touchLobby(l.lobby.id);
  return svc.listLobbyMessages(l.lobby.id, lim.value);
})
// Send as the Bearer user (a member) or as the application's bot. Content is
// sanitized like channel messages and encrypted at rest.
.post('/lobbies/:lobbyId/messages', async ({ headers, params, body, set }) => {
  const c = await callerOf(headers, { bearer: true });
  if (!c.ok) return fail(set, c.status, c.body);
  const caller = c.caller;
  const limited = await limitUser(caller, set, 'botMessageSend');
  if (limited) return limited;
  // Lobby messages are text: rich fields (embeds, attachments, components,
  // polls, stickers, replies, tts) are rejected by parseLobbyMessage.
  const {
    content: rawContent, metadata: rawMetadata, flags: rawFlags, nonce: rawNonce, enforce_nonce, allowed_mentions,
    embeds, attachments, components, poll, sticker_ids, message_reference, tts, shared_client_theme,
  } = (body ?? {}) as Record<string, unknown>;
  const parsed = parseLobbyMessage({
    content: rawContent, metadata: rawMetadata, flags: rawFlags, nonce: rawNonce, enforce_nonce, allowed_mentions,
    embeds, attachments, components, poll, sticker_ids, message_reference, tts, shared_client_theme,
  });
  if (!parsed.ok) return fail(set, 400, parsed.errors.toBody());
  const { content, metadata, flags, nonce, enforceNonce } = parsed.value;
  const l = await lobbyFor(caller, params.lobbyId, { requireMember: true });
  if (!l.ok) return fail(set, l.status, l.body);
  const { sanitizeMessageContent } = await import('@/lib/api/channels');
  const clean = sanitizeMessageContent(content).trim();
  if (!clean) return fail(set, 400, { code: 50006, message: 'Cannot send an empty message' });
  const svc = await lobbies();
  // enforce_nonce: a repeat send by the same author returns the first message.
  const { nonceKey } = await import('@/lib/chat/messageNonce');
  const { claimNonce, settleNonce } = await import('@/lib/services/botMessages');
  const slot = enforceNonce && nonce !== null ? nonceKey(caller.userId, l.lobby.id, nonce) : null;
  if (slot) {
    const claim = await claimNonce(slot);
    if (claim.kind === 'existing') {
      const prior = await svc.getLobbyMessage(l.lobby.id, claim.messageId);
      if (prior) return { ...prior, nonce };
    }
  }
  const member = caller.kind === 'user' ? await svc.getMember(l.lobby.id, caller.userId) : null;
  let message: Record<string, unknown>;
  try {
    message = await svc.createLobbyMessage(l.lobby, {
      authorId: caller.userId,
      content: clean,
      flags,
      additionalName: member?.additionalName ?? null,
      metadata,
      nonce,
    });
  } catch (err) {
    if (slot) await settleNonce(slot, null);
    throw err;
  }
  if (slot) await settleNonce(slot, String(message.id));
  if (l.lobby.linkedChannelId) {
    const author = message.author as { username?: string; global_name?: string | null } | undefined;
    const name = member?.additionalName || author?.global_name || author?.username || 'Player';
    void forwardToLinkedChannel(l.lobby, caller.app, name, clean).catch((err) => {
      console.error('[lobbies] linked channel forward failed:', (err as Error)?.message ?? err);
    });
  }
  return message;
})
.put('/lobbies/:lobbyId/messages/:messageId/moderation-metadata', async ({ headers, params, body, set }) => {
  const caller = await botCaller(headers);
  if (!caller) return fail(set, 401, UNAUTHORIZED);
  const parsed = parseModerationMetadata(body);
  if (!parsed.ok) return fail(set, 400, parsed.errors.toBody());
  const l = await lobbyFor(caller, params.lobbyId);
  if (!l.ok) return fail(set, l.status, l.body);
  if (!isValidObjectId(params.messageId)) return fail(set, 404, UNKNOWN_MESSAGE);
  const ok = await (await lobbies()).setLobbyMessageModeration(l.lobby.id, params.messageId, parsed.value);
  if (!ok) return fail(set, 404, UNKNOWN_MESSAGE);
  return noContent(set);
})

// ─── Invite target users ─────────────────────────────────────────────────────
// CSV out, ids in the app's id format (the boundary only rewrites JSON).
.get('/invites/:code/target-users', async ({ headers, params, set }) => {
  const r = await inviteFor(headers, params.code, 'read');
  if (!r.ok) return fail(set, r.status, r.body);
  let ids = await (await targets()).listTargetUsers(r.inv.id);
  const { idFormatOf } = await import('@/lib/botapi/boundary');
  if (idFormatOf(r.caller.app) === 'snowflake' && ids.length > 0) {
    const { snowflakesForUuids } = await import('@/lib/botapi/snowflakeStore');
    const { map } = await snowflakesForUuids(ids);
    ids = ids.map((id) => map.get(id) ?? id);
  }
  set.headers['content-type'] = 'text/csv; charset=utf-8';
  return buildTargetUsersCsv(ids);
})
// Replace the list from a CSV (multipart `target_users_file`). Applied synchronously.
.put('/invites/:code/target-users', async ({ headers, params, body, set }) => {
  const r = await inviteFor(headers, params.code, 'write');
  if (!r.ok) return fail(set, r.status, r.body);
  const { target_users_file } = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const file = target_users_file as Blob | undefined;
  if (!file || typeof (file as Blob).text !== 'function') {
    return fail(set, 400, formError(['target_users_file'], FE.REQUIRED, 'This field is required'));
  }
  if (file.size > INVITE_TARGET_LIMITS.fileBytes) {
    return fail(set, 400, formError(['target_users_file'], FE.MAX_LENGTH, `Must be ${INVITE_TARGET_LIMITS.fileBytes} bytes or smaller.`));
  }
  const csv = parseTargetUsersCsv(await file.text());
  const errors = [...csv.errors];
  // Snowflakes in the file -> internal user ids.
  const snowflakes = csv.entries.filter((e) => /^\d+$/.test(e.id)).map((e) => e.id);
  const { uuidsForSnowflakes, SF_KIND } = await import('@/lib/botapi/snowflakeStore');
  const resolved = snowflakes.length > 0 ? (await uuidsForSnowflakes(snowflakes)).map : new Map<string, { uuid: string; kind: number }>();
  const ids: string[] = [];
  for (const e of csv.entries) {
    if (isValidObjectId(e.id)) { ids.push(e.id); continue; }
    const hit = resolved.get(e.id);
    if (hit && hit.kind === SF_KIND.user) ids.push(hit.uuid);
    else errors.push(`Line ${e.line}: unknown user ID`);
  }
  const svc = await targets();
  const unknown = new Set(await svc.unknownUsers(ids));
  if (unknown.size > 0) {
    for (const e of csv.entries) {
      const id = isValidObjectId(e.id) ? e.id : resolved.get(e.id)?.uuid;
      if (id && unknown.has(id)) errors.push(`Line ${e.line}: unknown user ID`);
    }
  }
  if (errors.length > 0) {
    return fail(set, 400, { code: 50035, message: 'Invalid Form Body', target_users_file: errors.slice(0, 100) });
  }
  const w = await svc.replaceTargetUsers(r.inv, ids);
  if (!w.ok) return fail(set, 400, tooManyTargets());
  return noContent(set);
})
.get('/invites/:code/target-users/job-status', async ({ headers, params, set }) => {
  const r = await inviteFor(headers, params.code, 'read');
  if (!r.ok) return fail(set, r.status, r.body);
  return targetUsersJobStatus(targetUsersMarker(r.inv.metadata));
})
.post('/invites/:code/target-users/bulk-add', async ({ headers, params, body, set }) => {
  const r = await inviteFor(headers, params.code, 'write');
  if (!r.ok) return fail(set, r.status, r.body);
  const { user_ids } = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const parsed = parseUserIdList(user_ids);
  if (!parsed.ok) return fail(set, 400, parsed.errors.toBody());
  const svc = await targets();
  const unknown = await svc.unknownUsers(parsed.ids);
  if (unknown.length > 0) {
    const errors = new FormErrors();
    const bad = new Set(unknown);
    (user_ids as unknown[]).forEach((v, i) => { if (typeof v === 'string' && bad.has(lower(v))) errors.add(['user_ids', i], 'UNKNOWN_USER', 'Unknown user.'); });
    return fail(set, 400, errors.toBody());
  }
  const w = await svc.addTargetUsers(r.inv, parsed.ids);
  if (!w.ok) return fail(set, 400, tooManyTargets());
  return noContent(set);
})
.post('/invites/:code/target-users/bulk-delete', async ({ headers, params, body, set }) => {
  const r = await inviteFor(headers, params.code, 'write');
  if (!r.ok) return fail(set, r.status, r.body);
  const { user_ids } = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const parsed = parseUserIdList(user_ids);
  if (!parsed.ok) return fail(set, 400, parsed.errors.toBody());
  await (await targets()).removeTargetUsers(r.inv, parsed.ids);
  return noContent(set);
})
.put('/invites/:code/target-users/:userId', async ({ headers, params, set }) => {
  const r = await inviteFor(headers, params.code, 'write');
  if (!r.ok) return fail(set, r.status, r.body);
  if (!isValidObjectId(params.userId)) return fail(set, 404, UNKNOWN_USER);
  const svc = await targets();
  if ((await svc.unknownUsers([params.userId])).length > 0) return fail(set, 404, UNKNOWN_USER);
  const w = await svc.addTargetUsers(r.inv, [params.userId]);
  if (!w.ok) return fail(set, 400, tooManyTargets());
  return noContent(set);
})
.delete('/invites/:code/target-users/:userId', async ({ headers, params, set }) => {
  const r = await inviteFor(headers, params.code, 'write');
  if (!r.ok) return fail(set, r.status, r.body);
  if (isValidObjectId(params.userId)) await (await targets()).removeTargetUsers(r.inv, [params.userId]);
  return noContent(set);
})

// ─── Partner SDK (provisional accounts) ──────────────────────────────────────
// Public client-credential exchange: authenticate the client like Discord
// (530007 on a bad secret), then 530000: no application can use provisional
// accounts on SerikaCord.
.post('/partner-sdk/token', async ({ body, request, set }) => {
  const rl = await checkRateLimit('oauthToken', `partner-sdk:${getClientIP(request)}`);
  if (!rl.success) return fail(set, 429, rateLimitedResponse({ retryAfterSeconds: rl.retryAfter ?? 1, global: false }).body);
  const { client_id, client_secret, external_auth_type, external_auth_token } = (body ?? {}) as Record<string, unknown>;
  const parsed = parseTokenExchange({ client_id, client_secret, external_auth_type, external_auth_token });
  if (!parsed.ok) return fail(set, 400, parsed.errors.toBody());
  const { clientId, clientSecret } = parsed.value;
  const app = await applicationByClient(clientId);
  if (!app) return fail(set, 404, { code: 10002, message: 'Unknown Application' });
  if (!app.clientSecret || !secretEquals(app.clientSecret, clientSecret)) return fail(set, 401, INVALID_CLIENT_SECRET);
  return fail(set, 403, PROVISIONAL_ACCOUNTS_NOT_ENABLED);
})
.post('/partner-sdk/token/bot', async ({ headers, body, set }) => {
  const caller = await botCaller(headers);
  if (!caller) return fail(set, 401, UNAUTHORIZED);
  const { external_user_id, preferred_global_name, provisional_user_id } = (body ?? {}) as Record<string, unknown>;
  const parsed = parseBotTokenRequest({ external_user_id, preferred_global_name, provisional_user_id });
  if (!parsed.ok) return fail(set, 400, parsed.errors.toBody());
  return fail(set, 403, PROVISIONAL_ACCOUNTS_NOT_ENABLED);
})
.post('/partner-sdk/provisional-accounts/unmerge', async ({ body, request, set }) => {
  const rl = await checkRateLimit('oauthToken', `partner-sdk:${getClientIP(request)}`);
  if (!rl.success) return fail(set, 429, rateLimitedResponse({ retryAfterSeconds: rl.retryAfter ?? 1, global: false }).body);
  const { client_id, client_secret, external_auth_type, external_auth_token } = (body ?? {}) as Record<string, unknown>;
  const parsed = parseTokenExchange({ client_id, client_secret, external_auth_type, external_auth_token });
  if (!parsed.ok) return fail(set, 400, parsed.errors.toBody());
  const { clientId, clientSecret } = parsed.value;
  const app = await applicationByClient(clientId);
  if (!app) return fail(set, 404, { code: 10002, message: 'Unknown Application' });
  if (!app.clientSecret || !secretEquals(app.clientSecret, clientSecret)) return fail(set, 401, INVALID_CLIENT_SECRET);
  return fail(set, 403, PROVISIONAL_ACCOUNTS_NOT_ENABLED);
})
.post('/partner-sdk/provisional-accounts/unmerge/bot', async ({ headers, body, set }) => {
  const caller = await botCaller(headers);
  if (!caller) return fail(set, 401, UNAUTHORIZED);
  const { external_user_id } = (body ?? {}) as Record<string, unknown>;
  const parsed = parseBotTokenRequest({ external_user_id }, { unmerge: true });
  if (!parsed.ok) return fail(set, 400, parsed.errors.toBody());
  return fail(set, 403, PROVISIONAL_ACCOUNTS_NOT_ENABLED);
})
// App-scoped moderation metadata on a 1:1 DM message between two users who
// both authorized the application. Anything else looks like Unknown Message.
.put('/partner-sdk/dms/:firstUserId/:secondUserId/messages/:messageId/moderation-metadata', async ({ headers, params, body, set }) => {
  const caller = await botCaller(headers);
  if (!caller) return fail(set, 401, UNAUTHORIZED);
  const parsed = parseModerationMetadata(body);
  if (!parsed.ok) return fail(set, 400, parsed.errors.toBody());
  const { firstUserId, secondUserId, messageId } = params;
  if (![firstUserId, secondUserId, messageId].every(isValidObjectId) || lower(firstUserId) === lower(secondUserId)) {
    return fail(set, 404, UNKNOWN_MESSAGE);
  }
  const { Message, Channel } = await import('@/lib/models');
  const msg = await Message.findById(messageId);
  if (!msg || msg.isDeleted) return fail(set, 404, UNKNOWN_MESSAGE);
  const channel = await Channel.findById(msg.channelId);
  const recipients = new Set(((channel?.recipientIds ?? []) as string[]).map(lower));
  if (!channel || channel.type !== 'dm' || recipients.size !== 2 || !recipients.has(lower(firstUserId)) || !recipients.has(lower(secondUserId))) {
    return fail(set, 404, UNKNOWN_MESSAGE);
  }
  const check = await (await lobbies()).checkLobbyUsers(caller.app.id, [firstUserId, secondUserId]);
  if (!check.eligible.has(lower(firstUserId)) || !check.eligible.has(lower(secondUserId))) return fail(set, 404, UNKNOWN_MESSAGE);
  const { db, schema } = await import('@/lib/db/postgres');
  const { ensureSocialParitySchema } = await import('@/lib/services/socialParitySchema');
  await ensureSocialParitySchema();
  const T = schema.appMessageModeration;
  await db.insert(T).values({ applicationId: lower(caller.app.id), messageId: lower(msg.id), metadata: parsed.value, updatedAt: new Date() })
    .onConflictDoUpdate({ target: [T.applicationId, T.messageId], set: { metadata: parsed.value, updatedAt: new Date() } });
  return noContent(set);
});

/** The application for a client id (also accepts the app's own id, which the id boundary may have produced). */
async function applicationByClient(clientId: string): Promise<IApplication | null> {
  const { Application } = await import('@/lib/models');
  if (isValidObjectId(clientId)) return Application.findById(clientId).catch(() => null);
  return Application.findOne({ clientId }).catch(() => null);
}

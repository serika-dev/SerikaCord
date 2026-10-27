// Welcome Screen, Rules Screening and Server Templates, mounted at /api.
//
//   GET    /servers/:serverId/onboarding           what a member sees: welcome, questions, guide, rules, my state
//                                                   (?preview=1, MANAGE_SERVER: everything as a brand-new member)
//   GET    /servers/:serverId/onboarding/config    editable questions + guide, assignable roles (MANAGE_SERVER)
//   PUT    /servers/:serverId/onboarding/config    save them                       (MANAGE_SERVER)
//   POST   /servers/:serverId/onboarding/responses my picks { optionIds }
//   POST   /servers/:serverId/onboarding/todos/:todoId  tick a Server Guide to-do
//   GET    /servers/:serverId/screening/pending    members waiting to be let in   (MANAGE_SERVER)
//   POST   /servers/:serverId/screening/approve/:userId  let a waiting member in  (MANAGE_SERVER)
//   GET    /servers/:serverId/application-form     rules + questions for Apply to Join
//   GET    /servers/:serverId/connections          the accounts the server shows (+ owner: management data)
//   PUT    /servers/:serverId/connections          pick the owner's own ones { connectionIds } (owner only)
//   POST   /servers/:serverId/owned-connections/domains           add a server domain { domain } (owner only)
//   POST   /servers/:serverId/owned-connections/link              start an OAuth link for the server { provider } → { url }
//   POST   /servers/:serverId/owned-connections/:connectionId/verify  check the domain's TXT record (owner only)
//   PATCH  /servers/:serverId/owned-connections/:connectionId     show / hide { visible }         (owner only)
//   DELETE /servers/:serverId/owned-connections/:connectionId     remove it                        (owner only)
//   GET    /servers/:serverId/welcome-screen       the editable welcome screen      (MANAGE_SERVER)
//   PATCH  /servers/:serverId/welcome-screen       save it                          (MANAGE_SERVER)
//   GET    /servers/:serverId/screening            the rules screening config       (MANAGE_SERVER)
//   PUT    /servers/:serverId/screening            save it                          (MANAGE_SERVER)
//   POST   /servers/:serverId/screening/accept     accept the rules { accepted: true, answers? }
//                                                   (manual approval: queues an application instead)
//   GET    /servers/:serverId/template             the server's template or null    (MANAGE_SERVER)
//   POST   /servers/:serverId/template             create it { name, description? } (MANAGE_SERVER)
//   PATCH  /servers/:serverId/template             rename { name?, description? }   (MANAGE_SERVER)
//   PUT    /servers/:serverId/template/sync        re-snapshot the server           (MANAGE_SERVER)
//   DELETE /servers/:serverId/template             delete it                        (MANAGE_SERVER)
//   GET    /server-templates/:code                 preview a template by code
//   POST   /server-templates/:code                 create a server from it { name }
//
// Pure rules: lib/servers/community.ts. Storage: services/serverCommunity.ts,
// services/serverTemplates.ts. Enforcement of screening: services/serverGate.ts.
import { Elysia, t } from 'elysia';
import { Channel, Role, Server, ServerEmoji, ServerMember, ServerMemberApplication, User, UserConnection } from '@/lib/models';
import { authenticateRequest } from '@/lib/services/auth';
import { checkRateLimit, getClientIP, isValidObjectId, rejectInvalidObjectIdParams, sanitizeInput } from '@/lib/security';
import { config } from '@/lib/config';
import { PERMISSION_BITS } from '@/lib/permissions/bits';
import { hasServerPermission } from '@/lib/permissions/serverPermissions';
import {
  WELCOME_CHANNEL_TYPES,
  isWelcomeScreenVisible,
  normalizeTemplateMeta,
  normalizeWelcomeScreen,
  parseServerSnapshot,
  parseTemplateCode,
  validateApplicationAnswers,
  type WelcomeScreen,
} from '@/lib/servers/community';
import {
  isGuideVisible,
  isOnboardingVisible,
  isSafeOnboardingRole,
  normalizeLinkedConnectionIds,
  incompleteOnboardingQuestions,
  normalizeOnboardingConfig,
  rolesWithUnsafeChannelGrants,
  validateOnboardingSelection,
  withBotOnboardingFields,
  type OnboardingConfig,
} from '@/lib/servers/onboarding';
import {
  communityEmojiViews,
  customEmojiIds,
  serverEmojiLookup,
  welcomeEmojiValue,
  type CommunityEmojiView,
} from '@/lib/servers/communityEmoji';
import {
  admitScreenedMember,
  applyMemberOnboardingRoles,
  getLinkedConnectionIds,
  getOnboardingConfig,
  getOnboardingResponse,
  getScreeningConfig,
  getWelcomeScreen,
  listPendingMembers,
  markGuideTodoDone,
  saveLinkedConnectionIds,
  saveOnboardingConfig,
  saveOnboardingSelection,
  saveScreeningConfig,
  saveWelcomeScreen,
} from '@/lib/services/serverCommunity';
import { memberScreeningBlocked } from '@/lib/services/serverGate';
import { canAssignRole, type HierarchyRole } from '@/lib/permissions/roleHierarchy';
import { getActorRoleContext } from '@/lib/permissions/serverPermissions';
import { OAUTH_ONLY_PROVIDERS } from '@/lib/connections/policy';
import { isVerifiedDomainConnection, normalizeDomain } from '@/lib/connections/domain';
import {
  MAX_DOMAINS_PER_SERVER,
  MAX_SERVER_OWNED_CONNECTIONS,
  allowedServerOAuthProviders,
  isServerOAuthProvider,
  mergeServerConnections,
  pendingDomainToken,
  serverDomainsAllowed,
  serverOwnedCapacity,
  serverOwnedOwnView,
  type ServerConnectionView,
} from '@/lib/connections/serverOwned';
import {
  addServerDomain,
  createServerLinkTicket,
  deleteServerOwnedConnection,
  getServerOwnedConnection,
  listServerOwnedConnections,
  markServerDomainVerified,
  setServerOwnedVisible,
} from '@/lib/services/serverOwnedConnections';
import { getPlatformSettings } from '@/lib/models/PlatformSettings';
import { fanoutToUsers } from '@/lib/api/activity';
import { normalizeId } from '@/lib/db/normalizeId';
import { requestUserChannelStreamRecheck } from '@/lib/realtime/channelStreams';
import { sameId } from '@/lib/servers/guards';
import {
  bumpTemplateUsage,
  createServerFromSnapshot,
  createTemplate,
  deleteTemplate,
  getTemplateByCode,
  getTemplateForServer,
  syncTemplate,
  templateDirty,
  templateDto,
  updateTemplateMeta,
} from '@/lib/services/serverTemplates';

type Cookie = Record<string, { value?: unknown }>;
type AuthUser = NonNullable<Awaited<ReturnType<typeof authenticateRequest>>['user']>;
type ServerRow = NonNullable<Awaited<ReturnType<typeof Server.findById>>>;

async function getAuth(headers: Record<string, string | undefined>, cookie: Cookie) {
  const cookies: Record<string, string> = {};
  const token = cookie.auth_token?.value;
  if (typeof token === 'string') cookies.auth_token = token;
  return authenticateRequest(headers.authorization ?? null, cookies);
}

type Access = { server: ServerRow; member: Awaited<ReturnType<typeof ServerMember.findOne>> } | { status: number; error: string };

/** The server plus the caller's membership; `manage` also requires MANAGE_SERVER. */
async function serverAccess(user: AuthUser, serverId: string, manage: boolean): Promise<Access> {
  const server = await Server.findById(serverId);
  if (!server) return { status: 404, error: 'Server not found' };
  const member = await ServerMember.findOne({ serverId: server.id, userId: user.id });
  const isOwner = server.ownerId === user.id;
  if (!member && !isOwner) return { status: 403, error: 'Not a member of this server' };
  if (manage && !isOwner && !(await hasServerPermission(server, user.id, PERMISSION_BITS.MANAGE_SERVER, member))) {
    return { status: 403, error: 'Missing permission: Manage Server' };
  }
  return { server, member };
}

const WELCOME_BODY = t.Object({
  enabled: t.Optional(t.Boolean()),
  description: t.Optional(t.String({ maxLength: 1000 })),
  welcomeChannels: t.Optional(t.Array(t.Object({
    channelId: t.String(),
    description: t.Optional(t.String({ maxLength: 500 })),
    emojiName: t.Optional(t.Union([t.String({ maxLength: 128 }), t.Null()])),
    emojiId: t.Optional(t.Union([t.String({ maxLength: 64 }), t.Null()])),
  }), { maxItems: 20 })),
});

const SCREENING_BODY = t.Object({
  enabled: t.Optional(t.Boolean()),
  description: t.Optional(t.String({ maxLength: 2000 })),
  rules: t.Optional(t.Array(t.String({ maxLength: 2000 }), { maxItems: 50 })),
  restrictChannels: t.Optional(t.Boolean()),
  accessibleChannelIds: t.Optional(t.Array(t.String({ maxLength: 64 }), { maxItems: 100 })),
  manualApproval: t.Optional(t.Boolean()),
  questions: t.Optional(t.Array(t.Object({
    id: t.Optional(t.String({ maxLength: 64 })),
    type: t.Optional(t.String({ maxLength: 20 })),
    label: t.String({ maxLength: 500 }),
    required: t.Optional(t.Boolean()),
    choices: t.Optional(t.Array(t.String({ maxLength: 200 }), { maxItems: 20 })),
  }), { maxItems: 20 })),
});

const ANSWERS_BODY = t.Optional(t.Array(t.Object({
  questionId: t.String({ maxLength: 64 }),
  answer: t.String({ maxLength: 4000 }),
}), { maxItems: 20 }));

const ONBOARDING_BODY = t.Object({
  enabled: t.Optional(t.Boolean()),
  questions: t.Optional(t.Array(t.Unknown(), { maxItems: 20 })),
  guide: t.Optional(t.Unknown()),
});

const TEMPLATE_BODY = t.Object({
  name: t.Optional(t.String({ maxLength: 200 })),
  description: t.Optional(t.String({ maxLength: 500 })),
});

/** Ids of the server's channels a welcome screen may recommend. */
export async function eligibleWelcomeChannelIds(serverId: string): Promise<Set<string>> {
  const channels = await Channel.find({ serverId });
  return new Set(channels.filter((c) => WELCOME_CHANNEL_TYPES.has(String(c.type))).map((c) => c.id));
}

async function creatorView(userId: string) {
  const u = await User.findById(userId).catch(() => null);
  return u ? { id: u.id, username: u.username, displayName: u.displayName ?? null, avatar: u.avatar ?? null } : null;
}

const sameUser = (a: string | null | undefined, b: string | null | undefined) => sameId(a, b);

/**
 * HTML-escapes every string in a submitted JSON tree (the client decodes for
 * display). `emoji` strings are left for normalizeCommunityEmoji, which only
 * keeps one unicode emoji or an exact `<:name:id>` token (escaping would turn
 * the token into nothing).
 */
function sanitizeDeep(value: unknown, depth = 0, key: string | null = null): unknown {
  if (depth > 6) return null;
  if (typeof value === 'string') return key === 'emoji' ? value.slice(0, 120) : sanitizeInput(value.slice(0, 2000));
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => sanitizeDeep(v, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>).slice(0, 30)) out[k] = sanitizeDeep(v, depth + 1, k);
    return out;
  }
  return value;
}

/**
 * The server's own custom emojis, keyed for normalizeOnboardingConfig /
 * normalizeWelcomeScreen (CORD-71). A failed read throws: an empty list would
 * strip every custom emoji from the save.
 */
export async function serverEmojiLookupFor(serverId: string) {
  return serverEmojiLookup(await ServerEmoji.find({ serverId }));
}

/**
 * Display data (image url) for the custom emojis the join flow, Server Guide
 * and Channels & Roles show. `all` (the admin preview) returns every emoji so
 * unsaved edits render too.
 */
async function communityEmojisFor(
  serverId: string,
  parts: { welcome: WelcomeScreen | null; onboarding: OnboardingConfig | null; all?: boolean },
): Promise<CommunityEmojiView[]> {
  const ids = customEmojiIds([
    ...(parts.welcome?.welcomeChannels ?? []).map(welcomeEmojiValue),
    ...(parts.onboarding?.questions ?? []).flatMap((q) => q.options.map((o) => o.emoji)),
    ...(parts.onboarding?.guide.todos ?? []).map((t) => t.emoji),
    ...(parts.onboarding?.guide.resources ?? []).map((r) => r.emoji),
  ]);
  if (!parts.all && ids.size === 0) return [];
  const rows = await ServerEmoji.find({ serverId }).catch(() => []);
  return communityEmojiViews(rows, parts.all ? undefined : ids);
}

/** Ids of every channel in the server (guide to-dos / resources, accessible channels). */
export async function serverChannelIds(serverId: string): Promise<Set<string>> {
  const channels = await Channel.find({ serverId });
  return new Set(channels.filter((c) => c.type !== 'public_thread' && c.type !== 'private_thread').map((c) => c.id));
}

/** Roles this user may offer through onboarding: safe to self-assign and below their top role. */
export async function assignableOnboardingRoleIds(server: ServerRow, userId: string): Promise<Set<string>> {
  const roles = await Role.find({ serverId: server.id });
  const actor = await getActorRoleContext(server, userId, roles as HierarchyRole[]);
  if (!actor) return new Set();
  const canManageRoles = actor.isOwner || actor.isAdmin || (actor.perms & PERMISSION_BITS.MANAGE_ROLES) === PERMISSION_BITS.MANAGE_ROLES;
  if (!canManageRoles) return new Set();
  const viaChannels = rolesWithUnsafeChannelGrants(await Channel.find({ serverId: server.id }));
  return new Set(roles.filter((r) => isSafeOnboardingRole(r) && !viaChannels.has(r.id) && canAssignRole(actor, r as HierarchyRole)).map((r) => r.id));
}

export type { ServerConnectionView };

/** May the owner show this connection on a server? Unverified domains never. */
function isLinkableConnection(c: { provider: string; metadata?: unknown }): boolean {
  return c.provider !== 'website' || isVerifiedDomainConnection(c);
}

/**
 * The owner's own linked accounts a server shows. Resolved live from the
 * current owner's rows, so a disconnected account or an ownership transfer
 * drops it.
 */
async function ownerLinkedConnectionsView(serverId: string, ownerId: string): Promise<ServerConnectionView[]> {
  const ids = await getLinkedConnectionIds(serverId).catch(() => []);
  if (ids.length === 0) return [];
  const rows = await UserConnection.find({ userId: ownerId }).catch(() => []);
  const byId = new Map(rows.map((r) => [normalizeId(r.id), r]));
  const out: ServerConnectionView[] = [];
  for (const id of ids) {
    const c = byId.get(normalizeId(id));
    if (!c || c.visible === false || !isLinkableConnection(c)) continue;
    out.push({
      id: c.id,
      provider: c.provider,
      accountId: c.accountId,
      username: c.username ?? null,
      displayName: c.displayName ?? null,
      verified: (OAUTH_ONLY_PROVIDERS as readonly string[]).includes(c.provider) || isVerifiedDomainConnection(c),
      source: 'owner',
    });
  }
  return out;
}

/**
 * Everything a server shows on its invite page, Server Guide and join
 * preview: its own verified accounts / domains, then the owner's linked ones.
 */
export async function serverConnectionsView(serverId: string, ownerId: string): Promise<ServerConnectionView[]> {
  const [owned, linked] = await Promise.all([
    listServerOwnedConnections(serverId).catch(() => []),
    ownerLinkedConnectionsView(serverId, ownerId),
  ]);
  return mergeServerConnections(owned, linked);
}

/** OAuth providers this deployment has credentials for (lazy: auth.ts is a big module). */
async function configuredOAuthProviders(): Promise<string[]> {
  const { configuredOAuthConnectionProviders } = await import('@/lib/api/auth');
  return configuredOAuthConnectionProviders();
}

/** The owner's management data for server-owned connections. */
async function serverOwnedOwnerData(serverId: string) {
  const [rows, settings, configured] = await Promise.all([
    listServerOwnedConnections(serverId, { fresh: true }),
    getPlatformSettings(),
    configuredOAuthProviders().catch(() => [] as string[]),
  ]);
  return {
    serverOwned: rows.map(serverOwnedOwnView),
    linkableProviders: allowedServerOAuthProviders(settings, configured),
    domainsAllowed: serverDomainsAllowed(settings),
    limits: { total: MAX_SERVER_OWNED_CONNECTIONS, domains: MAX_DOMAINS_PER_SERVER },
  };
}

type OwnerOnly = { server: ServerRow } | { status: number; error: string };

/** Server-owned connections are managed by the server owner only (like owner-linked ones). */
async function ownerOnly(user: AuthUser, serverId: string): Promise<OwnerOnly> {
  const server = await Server.findById(serverId);
  if (!server) return { status: 404, error: 'Server not found' };
  if (!sameUser(server.ownerId, user.id)) return { status: 403, error: 'Only the server owner can manage server connections' };
  return { server };
}

async function ownerView(ownerId: string) {
  const u = await User.findById(ownerId).catch(() => null);
  return u ? { id: u.id, username: u.username, displayName: u.displayName ?? null, avatar: u.avatar ?? null } : null;
}

async function latestApplication(serverId: string, userId: string) {
  const apps = await ServerMemberApplication.find({ serverId, userId }).catch(() => []);
  apps.sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime());
  return apps[0] ?? null;
}

function notifyOnboardingChange(serverId: string, userId: string) {
  void fanoutToUsers({ userIds: [normalizeId(userId)] }, { type: 'server_onboarding_update', serverId }).catch(() => {});
}

export const communityRoutes = new Elysia()
  .onBeforeHandle(rejectInvalidObjectIdParams)
  // ─── Member view ───────────────────────────────────────────────────────────
  .get('/servers/:serverId/onboarding', async ({ headers, cookie, params, query, set }) => {
    const { user, error } = await getAuth(headers, cookie as Cookie);
    if (!user) { set.status = 401; return { error: error || 'Unauthorized' }; }
    const access = await serverAccess(user, params.serverId, false);
    if ('error' in access) { set.status = access.status; return { error: access.error }; }
    const { server, member } = access;
    const isOwner = sameUser(server.ownerId, user.id);
    const canManage = isOwner || await hasServerPermission(server, user.id, PERMISSION_BITS.MANAGE_SERVER, member).catch(() => false);
    // Admins preview the whole join experience as a brand-new member, with
    // everything shown even while it's still switched off.
    const preview = query.preview === '1' && canManage;
    const [welcome, screening, validIds, onboarding, response, connections, owner, application] = await Promise.all([
      getWelcomeScreen(server.id).catch(() => normalizeWelcomeScreen(null)),
      getScreeningConfig(server.id),
      eligibleWelcomeChannelIds(server.id),
      getOnboardingConfig(server.id).catch(() => normalizeOnboardingConfig(null)),
      preview ? Promise.resolve(null) : getOnboardingResponse(server.id, user.id),
      serverConnectionsView(server.id, server.ownerId),
      ownerView(server.ownerId),
      preview || !member ? Promise.resolve(null) : latestApplication(server.id, user.id),
    ]);
    const visibleWelcome = normalizeWelcomeScreen(welcome, validIds);
    // Picks saved while screening or the verification level still held the
    // member back: hand the roles out once they're through (retried per visit).
    if (!preview && member && response?.completedAt && !response.rolesApplied) {
      void memberScreeningBlocked(server.id, user, member)
        .then((stillBlocked) => (stillBlocked ? false : applyMemberOnboardingRoles(server.id, user.id)))
        .catch(() => {});
    }
    const blocked = preview
      ? screening.rules.length > 0
      : member ? await memberScreeningBlocked(server.id, user, member).catch(() => false) : false;
    const { computeOnlineCount } = await import('@/lib/api/servers');
    const onlineCount = await computeOnlineCount(server.id).catch(() => 0);
    const showWelcome = preview ? visibleWelcome.description.length > 0 || visibleWelcome.welcomeChannels.length > 0 : isWelcomeScreenVisible(visibleWelcome);
    const showQuestions = preview ? onboarding.questions.length > 0 : isOnboardingVisible(onboarding);
    const showGuide = preview ? isGuideVisible({ ...onboarding.guide, enabled: true }) : isGuideVisible(onboarding.guide);
    const showScreening = preview ? screening.rules.length > 0 : screening.enabled;
    const customEmojis = await communityEmojisFor(server.id, {
      welcome: showWelcome ? visibleWelcome : null,
      onboarding: showQuestions || showGuide ? onboarding : null,
      all: preview,
    });
    return {
      preview,
      canManage,
      isOwner,
      server: {
        id: server.id,
        name: server.name,
        icon: server.icon ?? null,
        banner: server.banner ?? null,
        description: server.description ?? null,
        memberCount: server.memberCount ?? 0,
        onlineCount,
        createdAt: server.createdAt ?? null,
        ownerId: server.ownerId,
        joinMode: server.joinMode || 'invite_only',
      },
      owner,
      welcomeScreen: showWelcome ? { ...visibleWelcome, enabled: true } : null,
      onboarding: showQuestions ? { questions: onboarding.questions } : null,
      guide: showGuide ? onboarding.guide : null,
      screening: showScreening
        ? {
            description: screening.description,
            rules: screening.rules,
            manualApproval: screening.manualApproval,
            questions: screening.manualApproval ? screening.questions : [],
            restrictChannels: screening.restrictChannels,
          }
        : null,
      connections,
      // Custom emojis used above, with their images (CORD-71).
      customEmojis,
      member: {
        pending: preview ? showScreening : Boolean(member?.pending),
        screeningBlocked: blocked && showScreening,
        joinedAt: preview ? new Date().toISOString() : member?.joinedAt ?? null,
        onboardingCompleted: Boolean(response?.completedAt),
        optionIds: response?.optionIds ?? [],
        todosDone: response?.todosDone ?? [],
        application: application
          ? {
              status: application.status,
              rejectionReason: application.rejectionReason ?? null,
              createdAt: application.createdAt ?? null,
              // Lets "Edit and resubmit" start from what they sent.
              answers: (Array.isArray(application.answers) ? application.answers : [])
                .map((a) => a as { questionId?: unknown; answer?: unknown })
                .filter((a) => typeof a.questionId === 'string')
                .map((a) => ({ questionId: a.questionId as string, answer: typeof a.answer === 'string' ? a.answer : '' })),
            }
          : null,
      },
    };
  }, { params: t.Object({ serverId: t.String() }), query: t.Object({ preview: t.Optional(t.String()) }) })
  // ─── Onboarding (questions + Server Guide) ─────────────────────────────────
  .get('/servers/:serverId/onboarding/config', async ({ headers, cookie, params, set }) => {
    const { user, error } = await getAuth(headers, cookie as Cookie);
    if (!user) { set.status = 401; return { error: error || 'Unauthorized' }; }
    const access = await serverAccess(user, params.serverId, true);
    if ('error' in access) { set.status = access.status; return { error: access.error }; }
    const [onboarding, assignable] = await Promise.all([
      getOnboardingConfig(access.server.id),
      assignableOnboardingRoleIds(access.server, user.id),
    ]);
    return { onboarding, assignableRoleIds: [...assignable] };
  }, { params: t.Object({ serverId: t.String() }) })
  .put('/servers/:serverId/onboarding/config', async ({ headers, cookie, params, body, set }) => {
    const { user, error } = await getAuth(headers, cookie as Cookie);
    if (!user) { set.status = 401; return { error: error || 'Unauthorized' }; }
    const access = await serverAccess(user, params.serverId, true);
    if ('error' in access) { set.status = access.status; return { error: access.error }; }
    const [channelIds, assignable, current, emojis] = await Promise.all([
      serverChannelIds(access.server.id),
      assignableOnboardingRoleIds(access.server, user.id),
      getOnboardingConfig(access.server.id),
      serverEmojiLookupFor(access.server.id),
    ]);
    // Roles already on an option that this editor can't assign (a higher
    // admin set them up) stay; they just can't add new ones.
    const keepable = new Set([...assignable, ...current.questions.flatMap((q) => q.options.flatMap((o) => o.roleIds))]);
    const safe = new Set((await Role.find({ serverId: access.server.id })).filter((r) => isSafeOnboardingRole(r)).map((r) => r.id));
    const roleIds = new Set([...keepable].filter((r) => safe.has(r)));
    const sanitized = sanitizeDeep(body) as Record<string, unknown>;
    // Refuse half-finished questions instead of silently dropping them (CORD-68).
    const incomplete = incompleteOnboardingQuestions(sanitized.questions);
    if (incomplete.length > 0) {
      set.status = 400;
      return { error: 'Each question needs a title and at least one option', code: 'incomplete_question', questionIndex: incomplete[0] };
    }
    const config = normalizeOnboardingConfig(
      // Option / default channels and mode are set by bots only: keep them.
      withBotOnboardingFields({ enabled: body.enabled ?? current.enabled, questions: sanitized.questions ?? current.questions, guide: sanitized.guide ?? current.guide }, current),
      { channelIds, roleIds, emojis },
    );
    await saveOnboardingConfig(access.server.id, config);
    return { onboarding: config, assignableRoleIds: [...assignable] };
  }, { params: t.Object({ serverId: t.String() }), body: ONBOARDING_BODY })
  .post('/servers/:serverId/onboarding/responses', async ({ headers, cookie, params, body, set }) => {
    const { user, error } = await getAuth(headers, cookie as Cookie);
    if (!user) { set.status = 401; return { error: error || 'Unauthorized' }; }
    const access = await serverAccess(user, params.serverId, false);
    if ('error' in access) { set.status = access.status; return { error: access.error }; }
    if (!access.member) { set.status = 403; return { error: 'Not a member of this server' }; }
    const limit = await checkRateLimit('onboardingResponse', `${access.server.id}:${user.id}`);
    if (!limit.success) { set.status = 429; return { error: 'You are changing your picks too quickly', retryAfter: limit.retryAfter }; }
    const config = await getOnboardingConfig(access.server.id);
    if (!isOnboardingVisible(config)) { set.status = 400; return { error: 'This server has no onboarding questions' }; }
    const checked = validateOnboardingSelection(config, body.optionIds);
    if ('error' in checked) { set.status = 400; return { error: checked.error, questionId: checked.questionId }; }
    await saveOnboardingSelection(access.server.id, user.id, checked.optionIds);
    // Roles wait until rules screening lets them in: any role would skip it.
    const blocked = await memberScreeningBlocked(access.server.id, user, access.member).catch(() => true);
    const rolesApplied = blocked ? false : await applyMemberOnboardingRoles(access.server.id, user.id).catch(() => false);
    return { optionIds: checked.optionIds, rolesApplied };
  }, { params: t.Object({ serverId: t.String() }), body: t.Object({ optionIds: t.Array(t.String({ maxLength: 64 }), { maxItems: 100 }) }) })
  .post('/servers/:serverId/onboarding/todos/:todoId', async ({ headers, cookie, params, set }) => {
    const { user, error } = await getAuth(headers, cookie as Cookie);
    if (!user) { set.status = 401; return { error: error || 'Unauthorized' }; }
    const access = await serverAccess(user, params.serverId, false);
    if ('error' in access) { set.status = access.status; return { error: access.error }; }
    if (!access.member) return { todosDone: [] };
    const config = await getOnboardingConfig(access.server.id);
    if (!config.guide.todos.some((td) => td.id === params.todoId)) { set.status = 404; return { error: 'Unknown to-do' }; }
    return { todosDone: await markGuideTodoDone(access.server.id, user.id, params.todoId) };
  }, { params: t.Object({ serverId: t.String(), todoId: t.String({ maxLength: 64 }) }) })
  // ─── Server connections (owner's linked accounts) ──────────────────────────
  .get('/servers/:serverId/connections', async ({ headers, cookie, params, set }) => {
    const { user, error } = await getAuth(headers, cookie as Cookie);
    if (!user) { set.status = 401; return { error: error || 'Unauthorized' }; }
    const access = await serverAccess(user, params.serverId, false);
    if ('error' in access) { set.status = access.status; return { error: access.error }; }
    const isOwner = sameUser(access.server.ownerId, user.id);
    const [connections, linkedConnectionIds, owned] = await Promise.all([
      serverConnectionsView(access.server.id, access.server.ownerId),
      isOwner ? getLinkedConnectionIds(access.server.id) : Promise.resolve(undefined),
      isOwner ? serverOwnedOwnerData(access.server.id) : Promise.resolve(null),
    ]);
    return { connections, linkedConnectionIds, ...(owned ?? {}) };
  }, { params: t.Object({ serverId: t.String() }) })
  .put('/servers/:serverId/connections', async ({ headers, cookie, params, body, set }) => {
    const { user, error } = await getAuth(headers, cookie as Cookie);
    if (!user) { set.status = 401; return { error: error || 'Unauthorized' }; }
    const server = await Server.findById(params.serverId);
    if (!server) { set.status = 404; return { error: 'Server not found' }; }
    // Only the owner can put their own accounts on the server's profile.
    if (!sameUser(server.ownerId, user.id)) { set.status = 403; return { error: 'Only the server owner can link connections' }; }
    const wanted = normalizeLinkedConnectionIds(body.connectionIds);
    const own = await UserConnection.find({ userId: user.id });
    const linkable = new Set(own.filter(isLinkableConnection).map((c) => normalizeId(c.id)));
    const ids = wanted.filter((id) => linkable.has(normalizeId(id)));
    if (ids.length !== wanted.length) {
      set.status = 400;
      return { error: 'You can only link your own connections (websites must be verified first)' };
    }
    await saveLinkedConnectionIds(server.id, ids);
    return { connections: await serverConnectionsView(server.id, server.ownerId), linkedConnectionIds: ids };
  }, { params: t.Object({ serverId: t.String() }), body: t.Object({ connectionIds: t.Array(t.String({ maxLength: 64 }), { maxItems: 20 }) }) })
  // ─── Server-owned connections (the server's own domains / accounts) ────────
  .post('/servers/:serverId/owned-connections/domains', async ({ headers, cookie, params, body, set }) => {
    const { user, error } = await getAuth(headers, cookie as Cookie);
    if (!user) { set.status = 401; return { error: error || 'Unauthorized' }; }
    const access = await ownerOnly(user, params.serverId);
    if ('error' in access) { set.status = access.status; return { error: access.error }; }
    if (!serverDomainsAllowed(await getPlatformSettings())) { set.status = 403; return { error: 'Domain connections are currently disabled' }; }
    const domain = normalizeDomain(body.domain);
    if (!domain) { set.status = 400; return { error: 'Enter a valid domain, like example.com' }; }
    const limit = await checkRateLimit('serverConnection', user.id);
    if (!limit.success) { set.status = 429; return { error: 'Too many changes. Try again in a few minutes.', retryAfter: limit.retryAfter }; }
    const rows = await listServerOwnedConnections(access.server.id, { fresh: true });
    const existing = rows.find((r) => r.provider === 'website' && r.accountId === domain);
    if (existing) return { connection: serverOwnedOwnView(existing) };
    const room = serverOwnedCapacity(rows, 'website');
    if (room === 'too_many') { set.status = 400; return { error: `A server can own up to ${MAX_SERVER_OWNED_CONNECTIONS} connections`, code: room }; }
    if (room === 'too_many_domains') { set.status = 400; return { error: `A server can own up to ${MAX_DOMAINS_PER_SERVER} domains`, code: room }; }
    const row = await addServerDomain(access.server.id, domain, user.id);
    if (!row) { set.status = 500; return { error: 'Failed to add domain' }; }
    return { connection: serverOwnedOwnView(row) };
  }, { params: t.Object({ serverId: t.String() }), body: t.Object({ domain: t.String({ minLength: 1, maxLength: 300 }) }) })
  .post('/servers/:serverId/owned-connections/link', async ({ headers, cookie, params, body, set }) => {
    const { user, error } = await getAuth(headers, cookie as Cookie);
    if (!user) { set.status = 401; return { error: error || 'Unauthorized' }; }
    const access = await ownerOnly(user, params.serverId);
    if ('error' in access) { set.status = access.status; return { error: access.error }; }
    const [settings, configured] = await Promise.all([getPlatformSettings(), configuredOAuthProviders().catch(() => [] as string[])]);
    const provider = body.provider;
    if (!isServerOAuthProvider(provider) || !allowedServerOAuthProviders(settings, configured).includes(provider)) {
      set.status = 400;
      return { error: 'This provider can not be linked right now' };
    }
    const limit = await checkRateLimit('serverConnection', user.id);
    if (!limit.success) { set.status = 429; return { error: 'Too many changes. Try again in a few minutes.', retryAfter: limit.retryAfter }; }
    const rows = await listServerOwnedConnections(access.server.id, { fresh: true });
    // Re-linking an account the server already has refreshes it, so only refuse when nothing could fit.
    if (serverOwnedCapacity(rows, 'oauth') !== 'ok' && !rows.some((r) => r.provider === provider)) {
      set.status = 400;
      return { error: `A server can own up to ${MAX_SERVER_OWNED_CONNECTIONS} connections`, code: 'too_many' };
    }
    const ticket = await createServerLinkTicket({ provider, userId: user.id, serverId: access.server.id });
    return { url: `/api/auth/${provider}/initiate?link=${ticket}` };
  }, { params: t.Object({ serverId: t.String() }), body: t.Object({ provider: t.String({ maxLength: 32 }) }) })
  .post('/servers/:serverId/owned-connections/:connectionId/verify', async ({ headers, cookie, params, set }) => {
    const { user, error } = await getAuth(headers, cookie as Cookie);
    if (!user) { set.status = 401; return { error: error || 'Unauthorized' }; }
    const access = await ownerOnly(user, params.serverId);
    if ('error' in access) { set.status = access.status; return { error: access.error }; }
    const row = isValidObjectId(normalizeId(params.connectionId))
      ? await getServerOwnedConnection(access.server.id, params.connectionId)
      : null;
    if (!row || row.provider !== 'website') { set.status = 404; return { error: 'Connection not found' }; }
    const token = pendingDomainToken(row);
    if (!token) {
      if (row.verified) return { connection: serverOwnedOwnView(row) };
      set.status = 409;
      return { error: 'Remove and re-add this domain to get a verification record', code: 'verification_not_started' };
    }
    const rate = await checkRateLimit('domainVerify', user.id);
    if (!rate.success) { set.status = 429; return { error: 'Too many verification attempts. Try again in a few minutes.', retryAfter: rate.retryAfter }; }
    const { checkDomainOwnership } = await import('@/lib/services/domainVerification');
    const result = await checkDomainOwnership(row.accountId, token);
    if (result.error) { set.status = 502; return { error: 'Could not look up DNS for this domain. Try again in a minute.', code: 'dns_error' }; }
    if (!result.ok && result.found?.length) {
      set.status = 400;
      return { error: "A serika-verification record was found, but its code doesn't match this domain's.", code: 'token_mismatch', found: result.found, connection: serverOwnedOwnView(row) };
    }
    if (!result.ok) {
      set.status = 400;
      return { error: 'TXT record not found yet. DNS changes can take a few minutes to show up.', code: 'record_not_found', connection: serverOwnedOwnView(row) };
    }
    const updated = await markServerDomainVerified(access.server.id, row.id, token);
    const { forgetFaviconDomainStatus } = await import('@/lib/services/favicons');
    await forgetFaviconDomainStatus(row.accountId);
    return { connection: serverOwnedOwnView(updated ?? row) };
  }, { params: t.Object({ serverId: t.String(), connectionId: t.String({ maxLength: 64 }) }) })
  .patch('/servers/:serverId/owned-connections/:connectionId', async ({ headers, cookie, params, body, set }) => {
    const { user, error } = await getAuth(headers, cookie as Cookie);
    if (!user) { set.status = 401; return { error: error || 'Unauthorized' }; }
    const access = await ownerOnly(user, params.serverId);
    if ('error' in access) { set.status = access.status; return { error: access.error }; }
    const row = isValidObjectId(normalizeId(params.connectionId))
      ? await setServerOwnedVisible(access.server.id, params.connectionId, body.visible)
      : null;
    if (!row) { set.status = 404; return { error: 'Connection not found' }; }
    return { connection: serverOwnedOwnView(row) };
  }, { params: t.Object({ serverId: t.String(), connectionId: t.String({ maxLength: 64 }) }), body: t.Object({ visible: t.Boolean() }) })
  .delete('/servers/:serverId/owned-connections/:connectionId', async ({ headers, cookie, params, set }) => {
    const { user, error } = await getAuth(headers, cookie as Cookie);
    if (!user) { set.status = 401; return { error: error || 'Unauthorized' }; }
    const access = await ownerOnly(user, params.serverId);
    if ('error' in access) { set.status = access.status; return { error: access.error }; }
    const deleted = isValidObjectId(normalizeId(params.connectionId))
      && await deleteServerOwnedConnection(access.server.id, params.connectionId);
    if (!deleted) { set.status = 404; return { error: 'Connection not found' }; }
    return { success: true };
  }, { params: t.Object({ serverId: t.String(), connectionId: t.String({ maxLength: 64 }) }) })
  // ─── Apply to Join form ────────────────────────────────────────────────────
  .get('/servers/:serverId/application-form', async ({ headers, cookie, params, set }) => {
    const { user, error } = await getAuth(headers, cookie as Cookie);
    if (!user) { set.status = 401; return { error: error || 'Unauthorized' }; }
    const server = await Server.findById(params.serverId);
    if (!server) { set.status = 404; return { error: 'Server not found' }; }
    const member = await ServerMember.findOne({ serverId: server.id, userId: user.id });
    if (!member && server.joinMode !== 'apply_to_join') { set.status = 404; return { error: 'This server is not accepting applications' }; }
    const screening = await getScreeningConfig(server.id);
    return {
      rules: screening.enabled ? screening.rules : [],
      description: screening.description,
      questions: screening.questions,
    };
  }, { params: t.Object({ serverId: t.String() }) })
  // ─── Welcome screen ────────────────────────────────────────────────────────
  .get('/servers/:serverId/welcome-screen', async ({ headers, cookie, params, set }) => {
    const { user, error } = await getAuth(headers, cookie as Cookie);
    if (!user) { set.status = 401; return { error: error || 'Unauthorized' }; }
    const access = await serverAccess(user, params.serverId, true);
    if ('error' in access) { set.status = access.status; return { error: access.error }; }
    return { welcomeScreen: await getWelcomeScreen(access.server.id) };
  }, { params: t.Object({ serverId: t.String() }) })
  .patch('/servers/:serverId/welcome-screen', async ({ headers, cookie, params, body, set }) => {
    const { user, error } = await getAuth(headers, cookie as Cookie);
    if (!user) { set.status = 401; return { error: error || 'Unauthorized' }; }
    const access = await serverAccess(user, params.serverId, true);
    if ('error' in access) { set.status = access.status; return { error: access.error }; }
    const current = await getWelcomeScreen(access.server.id);
    const merged = {
      enabled: body.enabled ?? current.enabled,
      description: body.description !== undefined ? sanitizeInput(body.description) : current.description,
      welcomeChannels: body.welcomeChannels
        ? body.welcomeChannels.map((c) => ({ ...c, description: c.description ? sanitizeInput(c.description) : '' }))
        : current.welcomeChannels,
    };
    const [eligible, emojis] = await Promise.all([eligibleWelcomeChannelIds(access.server.id), serverEmojiLookupFor(access.server.id)]);
    const screen = normalizeWelcomeScreen(merged, eligible, emojis);
    await saveWelcomeScreen(access.server.id, screen);
    return { welcomeScreen: screen };
  }, { params: t.Object({ serverId: t.String() }), body: WELCOME_BODY })
  // ─── Rules screening ───────────────────────────────────────────────────────
  .get('/servers/:serverId/screening', async ({ headers, cookie, params, set }) => {
    const { user, error } = await getAuth(headers, cookie as Cookie);
    if (!user) { set.status = 401; return { error: error || 'Unauthorized' }; }
    const access = await serverAccess(user, params.serverId, true);
    if ('error' in access) { set.status = access.status; return { error: access.error }; }
    return { screening: await getScreeningConfig(access.server.id) };
  }, { params: t.Object({ serverId: t.String() }) })
  .put('/servers/:serverId/screening', async ({ headers, cookie, params, body, set }) => {
    const { user, error } = await getAuth(headers, cookie as Cookie);
    if (!user) { set.status = 401; return { error: error || 'Unauthorized' }; }
    const access = await serverAccess(user, params.serverId, true);
    if ('error' in access) { set.status = access.status; return { error: access.error }; }
    const [current, channelIds] = await Promise.all([getScreeningConfig(access.server.id), serverChannelIds(access.server.id)]);
    const screening = await saveScreeningConfig(access.server.id, {
      enabled: body.enabled ?? current.enabled,
      description: body.description !== undefined ? sanitizeInput(body.description) : current.description,
      rules: body.rules ? body.rules.map((r) => sanitizeInput(r)) : current.rules,
      restrictChannels: body.restrictChannels ?? current.restrictChannels,
      accessibleChannelIds: body.accessibleChannelIds ?? current.accessibleChannelIds,
      manualApproval: body.manualApproval ?? current.manualApproval,
      questions: body.questions ? sanitizeDeep(body.questions) : current.questions,
    }, channelIds);
    // Channel access for waiting members may have changed: re-check their open streams.
    if (screening.restrictChannels || current.restrictChannels) {
      void listPendingMembers(access.server.id, 500)
        .then((rows) => rows.forEach((r) => requestUserChannelStreamRecheck(normalizeId(r.userId))))
        .catch(() => {});
    }
    return { screening };
  }, { params: t.Object({ serverId: t.String() }), body: SCREENING_BODY })
  .post('/servers/:serverId/screening/accept', async ({ headers, cookie, params, body, set }) => {
    const { user, error } = await getAuth(headers, cookie as Cookie);
    if (!user) { set.status = 401; return { error: error || 'Unauthorized' }; }
    if (body.accepted !== true) { set.status = 400; return { error: 'You must accept the rules' }; }
    const access = await serverAccess(user, params.serverId, false);
    if ('error' in access) { set.status = access.status; return { error: access.error }; }
    if (!access.member) return { pending: false };
    const screening = await getScreeningConfig(access.server.id);
    // On a lookup error assume they're still blocked: never skip manual approval.
    const blocked = await memberScreeningBlocked(access.server.id, user, access.member).catch(() => true);
    if (screening.enabled && screening.manualApproval && blocked) {
      // Manual approval: the rules + answers become an application a moderator
      // approves in Server Settings → Member Applications.
      const checked = validateApplicationAnswers(screening.questions, body.answers);
      if ('error' in checked) { set.status = 400; return { error: checked.error, questionId: checked.questionId }; }
      // Labels were escaped when the questions were saved; only the answers are new input.
      const answers = checked.answers.map((a) => ({ questionId: a.questionId, question: a.question, answer: sanitizeInput(a.answer), isPrivate: true }));
      const limit = await checkRateLimit('screeningSubmit', `${access.server.id}:${user.id}`);
      if (!limit.success) { set.status = 429; return { error: 'Please wait before submitting again', retryAfter: limit.retryAfter }; }
      const existing = await latestApplication(access.server.id, user.id);
      const application = existing && (existing.status === 'pending' || existing.status === 'rejected' || existing.status === 'interviewed')
        ? await ServerMemberApplication.updateById(existing.id, { status: 'pending', answers, rejectionReason: null, processedAt: null, processedBy: null })
        : await ServerMemberApplication.create({ serverId: access.server.id, userId: user.id, status: 'pending', answers });
      return {
        pending: true,
        application: application ? { status: application.status, rejectionReason: null, createdAt: application.createdAt ?? null } : null,
      };
    }
    await admitScreenedMember(access.server.id, user.id);
    return { pending: false };
  }, { params: t.Object({ serverId: t.String() }), body: t.Object({ accepted: t.Boolean(), answers: ANSWERS_BODY }) })
  .get('/servers/:serverId/screening/pending', async ({ headers, cookie, params, set }) => {
    const { user, error } = await getAuth(headers, cookie as Cookie);
    if (!user) { set.status = 401; return { error: error || 'Unauthorized' }; }
    const access = await serverAccess(user, params.serverId, true);
    if ('error' in access) { set.status = access.status; return { error: access.error }; }
    const rows = await listPendingMembers(access.server.id);
    const [users, apps] = await Promise.all([
      rows.length ? User.find({ id: { in: rows.map((r) => r.userId) } }) : Promise.resolve([]),
      ServerMemberApplication.find({ serverId: access.server.id, status: 'pending' }).catch(() => []),
    ]);
    const userById = new Map(users.map((u) => [normalizeId(u.id), u]));
    const appByUser = new Map(apps.map((a) => [normalizeId(a.userId), a]));
    return {
      members: rows.map((r) => {
        const u = userById.get(normalizeId(r.userId));
        const app = appByUser.get(normalizeId(r.userId));
        return {
          user: u ? { id: u.id, username: u.username, displayName: u.displayName ?? null, avatar: u.avatar ?? null, createdAt: u.createdAt ?? null } : { id: r.userId, username: null, displayName: null, avatar: null, createdAt: null },
          joinedAt: r.joinedAt,
          // A moderator-given role already lets them in.
          hasRole: r.roles.length > 1,
          applicationId: app?.id ?? null,
        };
      }),
    };
  }, { params: t.Object({ serverId: t.String() }) })
  .post('/servers/:serverId/screening/approve/:userId', async ({ headers, cookie, params, set }) => {
    const { user, error } = await getAuth(headers, cookie as Cookie);
    if (!user) { set.status = 401; return { error: error || 'Unauthorized' }; }
    const access = await serverAccess(user, params.serverId, true);
    if ('error' in access) { set.status = access.status; return { error: access.error }; }
    const ok = await admitScreenedMember(access.server.id, params.userId);
    if (!ok) { set.status = 404; return { error: 'Member not found' }; }
    const pendingApp = await ServerMemberApplication.findOne({ serverId: access.server.id, userId: params.userId, status: 'pending' }).catch(() => null);
    if (pendingApp) {
      await ServerMemberApplication.updateById(pendingApp.id, { status: 'approved', processedBy: user.id, processedAt: new Date() });
    }
    notifyOnboardingChange(access.server.id, params.userId);
    return { success: true };
  }, { params: t.Object({ serverId: t.String(), userId: t.String() }) })
  // ─── Templates (server side) ───────────────────────────────────────────────
  .get('/servers/:serverId/template', async ({ headers, cookie, params, set }) => {
    const { user, error } = await getAuth(headers, cookie as Cookie);
    if (!user) { set.status = 401; return { error: error || 'Unauthorized' }; }
    const access = await serverAccess(user, params.serverId, true);
    if ('error' in access) { set.status = access.status; return { error: access.error }; }
    const row = await getTemplateForServer(access.server.id);
    if (!row) return { template: null };
    const [isDirty, creator] = await Promise.all([templateDirty(row), creatorView(row.creatorId)]);
    return { template: templateDto(row, { isDirty, creator }) };
  }, { params: t.Object({ serverId: t.String() }) })
  .post('/servers/:serverId/template', async ({ headers, cookie, params, body, set }) => {
    const { user, error } = await getAuth(headers, cookie as Cookie);
    if (!user) { set.status = 401; return { error: error || 'Unauthorized' }; }
    const access = await serverAccess(user, params.serverId, true);
    if ('error' in access) { set.status = access.status; return { error: access.error }; }
    if (await getTemplateForServer(access.server.id)) {
      set.status = 409;
      return { error: 'This server already has a template' };
    }
    const meta = normalizeTemplateMeta(
      { name: body.name ? sanitizeInput(body.name) : undefined, description: body.description ? sanitizeInput(body.description) : undefined },
      access.server.name,
    );
    const row = await createTemplate(access.server.id, user.id, meta);
    if (!row) { set.status = 500; return { error: 'Could not create the template' }; }
    return { template: templateDto(row, { isDirty: false, creator: await creatorView(row.creatorId) }) };
  }, { params: t.Object({ serverId: t.String() }), body: TEMPLATE_BODY })
  .patch('/servers/:serverId/template', async ({ headers, cookie, params, body, set }) => {
    const { user, error } = await getAuth(headers, cookie as Cookie);
    if (!user) { set.status = 401; return { error: error || 'Unauthorized' }; }
    const access = await serverAccess(user, params.serverId, true);
    if ('error' in access) { set.status = access.status; return { error: access.error }; }
    const row = await getTemplateForServer(access.server.id);
    if (!row) { set.status = 404; return { error: 'Template not found' }; }
    const meta = normalizeTemplateMeta(
      {
        name: body.name !== undefined ? sanitizeInput(body.name) : row.name,
        description: body.description !== undefined ? sanitizeInput(body.description) : row.description,
      },
      row.name,
    );
    const updated = await updateTemplateMeta(row, meta);
    if (!updated) { set.status = 404; return { error: 'Template not found' }; }
    const [isDirty, creator] = await Promise.all([templateDirty(updated), creatorView(updated.creatorId)]);
    return { template: templateDto(updated, { isDirty, creator }) };
  }, { params: t.Object({ serverId: t.String() }), body: TEMPLATE_BODY })
  .put('/servers/:serverId/template/sync', async ({ headers, cookie, params, set }) => {
    const { user, error } = await getAuth(headers, cookie as Cookie);
    if (!user) { set.status = 401; return { error: error || 'Unauthorized' }; }
    const access = await serverAccess(user, params.serverId, true);
    if ('error' in access) { set.status = access.status; return { error: access.error }; }
    const row = await getTemplateForServer(access.server.id);
    if (!row) { set.status = 404; return { error: 'Template not found' }; }
    const updated = await syncTemplate(row);
    if (!updated) { set.status = 404; return { error: 'Template not found' }; }
    return { template: templateDto(updated, { isDirty: false, creator: await creatorView(updated.creatorId) }) };
  }, { params: t.Object({ serverId: t.String() }) })
  .delete('/servers/:serverId/template', async ({ headers, cookie, params, set }) => {
    const { user, error } = await getAuth(headers, cookie as Cookie);
    if (!user) { set.status = 401; return { error: error || 'Unauthorized' }; }
    const access = await serverAccess(user, params.serverId, true);
    if ('error' in access) { set.status = access.status; return { error: access.error }; }
    const row = await getTemplateForServer(access.server.id);
    if (row) await deleteTemplate(row);
    return { success: true };
  }, { params: t.Object({ serverId: t.String() }) })
  // ─── Templates (public by code) ────────────────────────────────────────────
  .get('/server-templates/:code', async ({ headers, cookie, params, set }) => {
    const { user, error } = await getAuth(headers, cookie as Cookie);
    if (!user) { set.status = 401; return { error: error || 'Unauthorized' }; }
    const code = parseTemplateCode(params.code);
    const row = code ? await getTemplateByCode(code) : null;
    if (!row) { set.status = 404; return { error: 'Unknown template' }; }
    const [creator, source] = await Promise.all([creatorView(row.creatorId), Server.findById(row.serverId).catch(() => null)]);
    return {
      template: templateDto(row, {
        creator,
        sourceServer: source ? { id: source.id, name: source.name, icon: source.icon ?? null } : null,
      }),
    };
  }, { params: t.Object({ code: t.String({ maxLength: 64 }) }) })
  .post('/server-templates/:code', async ({ headers, cookie, params, body, request, set }) => {
    const { user, error } = await getAuth(headers, cookie as Cookie);
    if (!user) { set.status = 401; return { error: error || 'Unauthorized' }; }
    const code = parseTemplateCode(params.code);
    const row = code ? await getTemplateByCode(code) : null;
    if (!row) { set.status = 404; return { error: 'Unknown template' }; }
    const snapshot = parseServerSnapshot(row.serialized);
    if (!snapshot) { set.status = 422; return { error: 'This template is broken' }; }

    // Same limits as creating a server from scratch.
    const limit = await checkRateLimit('serverCreate', `${user.id}:${getClientIP(request)}`);
    if (!limit.success) { set.status = 429; return { error: 'Server creation rate limited', retryAfter: limit.retryAfter }; }
    const memberships = await ServerMember.find({ userId: user.id });
    if (memberships.length >= config.MAX_SERVERS_PER_USER) {
      set.status = 400;
      return { error: `You can only be in ${config.MAX_SERVERS_PER_USER} servers` };
    }

    const name = sanitizeInput(body.name).trim().slice(0, 100);
    if (name.length < 2) { set.status = 400; return { error: 'Server name must be at least 2 characters' }; }
    const serverId = await createServerFromSnapshot(snapshot, user.id, { name, templateCode: row.code });
    await bumpTemplateUsage(row.code).catch(() => {});
    const { recalculateUserBadges } = await import('@/lib/services/badges');
    void recalculateUserBadges(user.id).catch(() => {});
    const server = await Server.findById(serverId);
    return { success: true, server };
  }, {
    params: t.Object({ code: t.String({ maxLength: 64 }) }),
    body: t.Object({ name: t.String({ minLength: 2, maxLength: 100 }) }),
  });

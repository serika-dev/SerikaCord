// Welcome Screen, Rules Screening and Server Templates, mounted at /api.
//
//   GET    /servers/:serverId/onboarding           what a member sees: welcome screen, rules, my pending state
//   GET    /servers/:serverId/welcome-screen       the editable welcome screen      (MANAGE_SERVER)
//   PATCH  /servers/:serverId/welcome-screen       save it                          (MANAGE_SERVER)
//   GET    /servers/:serverId/screening            the rules screening config       (MANAGE_SERVER)
//   PUT    /servers/:serverId/screening            save it                          (MANAGE_SERVER)
//   POST   /servers/:serverId/screening/accept     accept the rules { accepted: true }
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
import { Channel, Server, ServerMember, User } from '@/lib/models';
import { authenticateRequest } from '@/lib/services/auth';
import { checkRateLimit, getClientIP, rejectInvalidObjectIdParams, sanitizeInput } from '@/lib/security';
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
} from '@/lib/servers/community';
import {
  acceptScreening,
  getScreeningConfig,
  getWelcomeScreen,
  saveScreeningConfig,
  saveWelcomeScreen,
} from '@/lib/services/serverCommunity';
import { memberScreeningBlocked } from '@/lib/services/serverGate';
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
    emojiName: t.Optional(t.Union([t.String({ maxLength: 64 }), t.Null()])),
    emojiId: t.Optional(t.Union([t.String({ maxLength: 64 }), t.Null()])),
  }), { maxItems: 20 })),
});

const SCREENING_BODY = t.Object({
  enabled: t.Optional(t.Boolean()),
  description: t.Optional(t.String({ maxLength: 2000 })),
  rules: t.Optional(t.Array(t.String({ maxLength: 2000 }), { maxItems: 50 })),
});

const TEMPLATE_BODY = t.Object({
  name: t.Optional(t.String({ maxLength: 200 })),
  description: t.Optional(t.String({ maxLength: 500 })),
});

/** Ids of the server's channels a welcome screen may recommend. */
async function eligibleWelcomeChannelIds(serverId: string): Promise<Set<string>> {
  const channels = await Channel.find({ serverId });
  return new Set(channels.filter((c) => WELCOME_CHANNEL_TYPES.has(String(c.type))).map((c) => c.id));
}

async function creatorView(userId: string) {
  const u = await User.findById(userId).catch(() => null);
  return u ? { id: u.id, username: u.username, displayName: u.displayName ?? null, avatar: u.avatar ?? null } : null;
}

export const communityRoutes = new Elysia()
  .onBeforeHandle(rejectInvalidObjectIdParams)
  // ─── Member view ───────────────────────────────────────────────────────────
  .get('/servers/:serverId/onboarding', async ({ headers, cookie, params, set }) => {
    const { user, error } = await getAuth(headers, cookie as Cookie);
    if (!user) { set.status = 401; return { error: error || 'Unauthorized' }; }
    const access = await serverAccess(user, params.serverId, false);
    if ('error' in access) { set.status = access.status; return { error: access.error }; }
    const { server, member } = access;
    const [welcome, screening, validIds] = await Promise.all([
      getWelcomeScreen(server.id).catch(() => normalizeWelcomeScreen(null)),
      getScreeningConfig(server.id),
      eligibleWelcomeChannelIds(server.id),
    ]);
    const visibleWelcome = normalizeWelcomeScreen(welcome, validIds);
    const blocked = member ? await memberScreeningBlocked(server.id, user, member).catch(() => false) : false;
    return {
      server: { id: server.id, name: server.name, icon: server.icon ?? null, description: server.description ?? null },
      welcomeScreen: isWelcomeScreenVisible(visibleWelcome) ? visibleWelcome : null,
      screening: screening.enabled ? { description: screening.description, rules: screening.rules } : null,
      member: {
        pending: Boolean(member?.pending),
        screeningBlocked: blocked,
        joinedAt: member?.joinedAt ?? null,
      },
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
    const screen = normalizeWelcomeScreen(merged, await eligibleWelcomeChannelIds(access.server.id));
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
    const current = await getScreeningConfig(access.server.id);
    const screening = await saveScreeningConfig(access.server.id, {
      enabled: body.enabled ?? current.enabled,
      description: body.description !== undefined ? sanitizeInput(body.description) : current.description,
      rules: body.rules ? body.rules.map((r) => sanitizeInput(r)) : current.rules,
    });
    return { screening };
  }, { params: t.Object({ serverId: t.String() }), body: SCREENING_BODY })
  .post('/servers/:serverId/screening/accept', async ({ headers, cookie, params, body, set }) => {
    const { user, error } = await getAuth(headers, cookie as Cookie);
    if (!user) { set.status = 401; return { error: error || 'Unauthorized' }; }
    if (body.accepted !== true) { set.status = 400; return { error: 'You must accept the rules' }; }
    const access = await serverAccess(user, params.serverId, false);
    if ('error' in access) { set.status = access.status; return { error: access.error }; }
    if (!access.member) return { pending: false };
    await acceptScreening(access.server.id, user.id);
    return { pending: false };
  }, { params: t.Object({ serverId: t.String() }), body: t.Object({ accepted: t.Boolean() }) })
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

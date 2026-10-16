/**
 * Onboarding, welcome screen, guild templates and integrations for the
 * Discord-compatible bot API (WP4b), over the same storage as the web routes
 * (src/lib/api/community.ts, src/lib/services/serverCommunity.ts,
 * src/lib/services/serverTemplates.ts). Shapes: ./communityRules.ts.
 *
 * Integrations: Serika's only integrations are bots. Each bot member is a
 * `discord` integration whose id is its application id; deleting one removes
 * the bot from the guild (Discord kicks the integration's bot too).
 */
import { Application, Role, Server, ServerMember, User } from '@/lib/models';
import { PERMISSION_BITS as P, hasPermission } from '@/lib/permissions/bits';
import { applyTimeout } from '@/lib/permissions/botChannel';
import { computeGuildStanding, memberTopPosition, outranks } from '@/lib/permissions/botGuild';
import { isValidObjectId, sanitizeInput } from '@/lib/security';
import { audit } from '@/lib/services/auditLog';
import { AuditLogEvent, auditReason } from '@/lib/audit/auditLog';
import { normalizeTemplateMeta, normalizeWelcomeScreen, parseServerSnapshot, parseTemplateCode } from '@/lib/servers/community';
import { isSafeOnboardingRole, normalizeOnboardingConfig } from '@/lib/servers/onboarding';
import { toDiscordUserRow } from '@/lib/services/gatewayEvents';
import { fromDiscordOnboarding, templateFieldError, toDiscordOnboarding, toDiscordSerializedGuild, toDiscordWelcomeScreen } from './communityRules';

type Result = { status: number; body: unknown };
type Headers = Record<string, string | undefined>;

const MISSING_PERMISSIONS = { code: 50013, message: 'Missing Permissions' };
const UNKNOWN_TEMPLATE = { code: 10057, message: 'Unknown Guild Template' };
const formError = (path: string, code: string, message: string) => ({ code: 50035, message: 'Invalid Form Body', errors: { [path]: { _errors: [{ code, message }] } } });

async function guildPerms(guildId: string, botId: string): Promise<bigint> {
  const member = await ServerMember.findOne({ serverId: guildId, userId: botId });
  const { getMemberChannelPermissions } = await import('@/lib/api/channels');
  return applyTimeout(await getMemberChannelPermissions(botId, { serverId: guildId }, member ?? null), member?.communicationDisabledUntil ?? null);
}
const has = (perms: bigint, bit: bigint) => hasPermission(perms, P.ADMINISTRATOR) || hasPermission(perms, bit);

// ─── Onboarding ───────────────────────────────────────────────────────────────

export async function getBotOnboarding(guildId: string): Promise<Result> {
  const { getOnboardingConfig } = await import('@/lib/services/serverCommunity');
  return { status: 200, body: toDiscordOnboarding(guildId, await getOnboardingConfig(guildId)) };
}

/** PUT /guilds/{id}/onboarding: MANAGE_GUILD + MANAGE_ROLES; options only grant roles the bot may assign. */
export async function putBotOnboarding(guildId: string, botId: string, body: unknown): Promise<Result> {
  const perms = await guildPerms(guildId, botId);
  if (!has(perms, P.MANAGE_SERVER) || !has(perms, P.MANAGE_ROLES)) return { status: 403, body: MISSING_PERMISSIONS };
  const server = await Server.findById(guildId);
  if (!server) return { status: 404, body: { code: 10004, message: 'Unknown Guild' } };
  const { getOnboardingConfig, saveOnboardingConfig } = await import('@/lib/services/serverCommunity');
  const { assignableOnboardingRoleIds, serverChannelIds } = await import('@/lib/api/community');
  const [current, assignable, channelIds, roles] = await Promise.all([
    getOnboardingConfig(guildId),
    assignableOnboardingRoleIds(server, botId),
    serverChannelIds(guildId),
    Role.find({ serverId: guildId }),
  ]);
  // Same rule as the web editor: roles already on an option stay, new ones must be assignable and safe.
  const keepable = new Set([...assignable, ...current.questions.flatMap((q) => q.options.flatMap((o) => o.roleIds))]);
  const safe = new Set(roles.filter((r) => isSafeOnboardingRole(r)).map((r) => r.id));
  const roleIds = new Set([...keepable].filter((r) => safe.has(r)));
  const config = normalizeOnboardingConfig(fromDiscordOnboarding(body, current, (s) => sanitizeInput(s)), { channelIds, roleIds });
  await saveOnboardingConfig(guildId, config);
  return { status: 200, body: toDiscordOnboarding(guildId, config) };
}

// ─── Welcome screen ───────────────────────────────────────────────────────────

/** GET /guilds/{id}/welcome-screen: MANAGE_GUILD unless it is enabled; 10069 when never set up. */
export async function getBotWelcomeScreen(guildId: string, botId: string): Promise<Result> {
  const { getWelcomeScreen } = await import('@/lib/services/serverCommunity');
  const screen = await getWelcomeScreen(guildId);
  if (!screen.enabled && !has(await guildPerms(guildId, botId), P.MANAGE_SERVER)) return { status: 403, body: MISSING_PERMISSIONS };
  if (!screen.description && screen.welcomeChannels.length === 0) return { status: 404, body: { code: 10069, message: 'Unknown Welcome Screen' } };
  return { status: 200, body: toDiscordWelcomeScreen(screen) };
}

/** PATCH /guilds/{id}/welcome-screen (MANAGE_GUILD). */
export async function patchBotWelcomeScreen(guildId: string, botId: string, body: { enabled?: unknown; description?: unknown; welcome_channels?: unknown }): Promise<Result> {
  if (!has(await guildPerms(guildId, botId), P.MANAGE_SERVER)) return { status: 403, body: MISSING_PERMISSIONS };
  if (body.welcome_channels !== undefined && body.welcome_channels !== null && !Array.isArray(body.welcome_channels)) {
    return { status: 400, body: formError('welcome_channels', 'BASE_TYPE_ARRAY', 'Must be an array.') };
  }
  const { getWelcomeScreen, saveWelcomeScreen } = await import('@/lib/services/serverCommunity');
  const { eligibleWelcomeChannelIds } = await import('@/lib/api/community');
  const current = await getWelcomeScreen(guildId);
  const merged = {
    enabled: typeof body.enabled === 'boolean' ? body.enabled : current.enabled,
    description: body.description !== undefined ? (typeof body.description === 'string' ? sanitizeInput(body.description) : '') : current.description,
    welcomeChannels: Array.isArray(body.welcome_channels)
      ? (body.welcome_channels as Array<Record<string, unknown>>).map((c) => ({
        channelId: c?.channel_id,
        description: typeof c?.description === 'string' ? sanitizeInput(c.description) : '',
        emojiId: c?.emoji_id ?? null,
        emojiName: c?.emoji_name ?? null,
      }))
      : body.welcome_channels === null ? [] : current.welcomeChannels,
  };
  const screen = normalizeWelcomeScreen(merged, await eligibleWelcomeChannelIds(guildId));
  await saveWelcomeScreen(guildId, screen);
  return { status: 200, body: toDiscordWelcomeScreen(screen) };
}

// ─── Templates ────────────────────────────────────────────────────────────────

type TemplateRow = NonNullable<Awaited<ReturnType<typeof import('@/lib/services/serverTemplates').getTemplateByCode>>>;

async function templateView(row: TemplateRow, isDirty: boolean | null) {
  const creator = await User.findById(row.creatorId).catch(() => null);
  const snapshot = parseServerSnapshot(row.serialized);
  return {
    code: row.code,
    name: row.name,
    description: row.description ?? null,
    usage_count: row.usageCount,
    creator_id: row.creatorId,
    creator: creator ? toDiscordUserRow(creator) : null,
    created_at: row.createdAt ? new Date(row.createdAt).toISOString() : null,
    updated_at: row.updatedAt ? new Date(row.updatedAt).toISOString() : null,
    source_guild_id: row.serverId,
    serialized_source_guild: snapshot ? toDiscordSerializedGuild(snapshot) : null,
    is_dirty: isDirty,
  };
}

async function requireManageGuild(guildId: string, botId: string): Promise<Result | null> {
  return has(await guildPerms(guildId, botId), P.MANAGE_SERVER) ? null : { status: 403, body: MISSING_PERMISSIONS };
}

/** The guild's template when `code` names it. */
async function ownTemplate(guildId: string, code: string): Promise<TemplateRow | null> {
  const svc = await import('@/lib/services/serverTemplates');
  const row = await svc.getTemplateForServer(guildId);
  return row && row.code === code ? row : null;
}

export async function listBotTemplates(guildId: string, botId: string): Promise<Result> {
  const denied = await requireManageGuild(guildId, botId);
  if (denied) return denied;
  const svc = await import('@/lib/services/serverTemplates');
  const row = await svc.getTemplateForServer(guildId);
  return { status: 200, body: row ? [await templateView(row, await svc.templateDirty(row))] : [] };
}

export async function createBotTemplate(guildId: string, botId: string, body: { name?: unknown; description?: unknown }): Promise<Result> {
  const denied = await requireManageGuild(guildId, botId);
  if (denied) return denied;
  const bad = templateFieldError(body as Record<string, unknown>, true);
  if (bad) return { status: 400, body: formError(bad.path, bad.code, bad.message) };
  const svc = await import('@/lib/services/serverTemplates');
  if (await svc.getTemplateForServer(guildId)) return { status: 400, body: { code: 30031, message: 'A server can only have a single template.' } };
  const server = await Server.findById(guildId);
  if (!server) return { status: 404, body: { code: 10004, message: 'Unknown Guild' } };
  const meta = normalizeTemplateMeta({ name: sanitizeInput(String(body.name)), description: typeof body.description === 'string' ? sanitizeInput(body.description) : undefined }, server.name);
  const row = await svc.createTemplate(guildId, botId, meta);
  if (!row) return { status: 500, body: { code: 0, message: '500: Internal Server Error' } };
  return { status: 200, body: await templateView(row, false) };
}

export async function syncBotTemplate(guildId: string, code: string, botId: string): Promise<Result> {
  const denied = await requireManageGuild(guildId, botId);
  if (denied) return denied;
  const row = await ownTemplate(guildId, code);
  if (!row) return { status: 404, body: UNKNOWN_TEMPLATE };
  const svc = await import('@/lib/services/serverTemplates');
  const updated = await svc.syncTemplate(row);
  return updated ? { status: 200, body: await templateView(updated, false) } : { status: 404, body: UNKNOWN_TEMPLATE };
}

export async function patchBotTemplate(guildId: string, code: string, botId: string, body: { name?: unknown; description?: unknown }): Promise<Result> {
  const denied = await requireManageGuild(guildId, botId);
  if (denied) return denied;
  const bad = templateFieldError(body as Record<string, unknown>, false);
  if (bad) return { status: 400, body: formError(bad.path, bad.code, bad.message) };
  const row = await ownTemplate(guildId, code);
  if (!row) return { status: 404, body: UNKNOWN_TEMPLATE };
  const svc = await import('@/lib/services/serverTemplates');
  const meta = normalizeTemplateMeta({
    name: typeof body.name === 'string' ? sanitizeInput(body.name) : row.name,
    description: body.description !== undefined ? (typeof body.description === 'string' ? sanitizeInput(body.description) : null) : row.description,
  }, row.name);
  const updated = await svc.updateTemplateMeta(row, meta);
  return updated ? { status: 200, body: await templateView(updated, await svc.templateDirty(updated)) } : { status: 404, body: UNKNOWN_TEMPLATE };
}

export async function deleteBotTemplate(guildId: string, code: string, botId: string): Promise<Result> {
  const denied = await requireManageGuild(guildId, botId);
  if (denied) return denied;
  const row = await ownTemplate(guildId, code);
  if (!row) return { status: 404, body: UNKNOWN_TEMPLATE };
  const svc = await import('@/lib/services/serverTemplates');
  const view = await templateView(row, null);
  await svc.deleteTemplate(row);
  return { status: 200, body: view };
}

/** GET /guilds/templates/{code}: templates are shareable by code, like Discord. */
export async function getTemplateByCodeForBot(rawCode: string): Promise<Result> {
  const code = parseTemplateCode(rawCode);
  const svc = await import('@/lib/services/serverTemplates');
  const row = code ? await svc.getTemplateByCode(code) : null;
  if (!row) return { status: 404, body: UNKNOWN_TEMPLATE };
  return { status: 200, body: await templateView(row, null) };
}

// ─── Integrations (bots) ──────────────────────────────────────────────────────

/** GET /guilds/{id}/integrations (MANAGE_GUILD): one `discord` integration per bot in the guild. */
export async function listBotIntegrations(guildId: string, botId: string): Promise<Result> {
  const denied = await requireManageGuild(guildId, botId);
  if (denied) return denied;
  const botIds = await ServerMember.findBotUserIds(guildId);
  const [apps, users] = await Promise.all([
    Promise.all(botIds.map((id) => Application.findOne({ botId: id }).catch(() => null))),
    botIds.length ? User.find({ id: { in: botIds } }).catch(() => []) : Promise.resolve([]),
  ]);
  const userBy = new Map(users.map((u) => [u.id.toLowerCase(), u]));
  const out = [];
  for (let i = 0; i < botIds.length; i++) {
    const app = apps[i];
    const user = userBy.get(botIds[i].toLowerCase());
    if (!app || !user || !app.botId || app.botId.toLowerCase() !== botIds[i].toLowerCase()) continue;
    const botUser = toDiscordUserRow(user);
    out.push({
      id: app.id,
      name: app.name,
      type: 'discord',
      enabled: true,
      account: { id: user.id, name: user.username },
      application: { id: app.id, name: app.name, icon: app.icon ?? null, description: app.description ?? '', bot: botUser },
      scopes: ['bot', 'applications.commands'],
    });
  }
  return { status: 200, body: out };
}

/** DELETE /guilds/{id}/integrations/{id} (MANAGE_GUILD): removes that application's bot from the guild. */
export async function deleteBotIntegration(guildId: string, integrationId: string, botId: string, headers: Headers): Promise<Result> {
  const app = isValidObjectId(integrationId) ? await Application.findById(integrationId) : null;
  const self = !!app?.botId && app.botId.toLowerCase() === botId.toLowerCase();
  // A bot may always remove its own integration (that is leaving the guild).
  if (!self) {
    const denied = await requireManageGuild(guildId, botId);
    if (denied) return denied;
  }
  if (!app?.botId) return { status: 404, body: { code: 10005, message: 'Unknown Integration' } };
  const member = await ServerMember.findOne({ serverId: guildId, userId: app.botId });
  if (!member) return { status: 404, body: { code: 10005, message: 'Unknown Integration' } };
  const server = await Server.findById(guildId);
  if (server && server.ownerId.toLowerCase() === app.botId.toLowerCase()) return { status: 403, body: MISSING_PERMISSIONS };
  if (!self && server) {
    // Removing another bot is a kick: it must sit below the caller's top role.
    const roles = await Role.find({ serverId: guildId });
    const actor = await ServerMember.findOne({ serverId: guildId, userId: botId });
    const standing = computeGuildStanding(roles, (actor?.roles ?? []) as string[], server.ownerId.toLowerCase() === botId.toLowerCase());
    if (!outranks(standing, memberTopPosition(roles, (member.roles ?? []) as string[]))) return { status: 403, body: MISSING_PERMISSIONS };
  }
  const { removeServerMember } = await import('@/lib/services/serverMembership');
  await removeServerMember(guildId, app.botId);
  audit({ serverId: guildId, userId: botId, actionType: AuditLogEvent.MEMBER_KICK, targetId: app.botId, reason: auditReason(headers['x-audit-log-reason']) });
  void import('@/lib/services/gatewayEvents')
    .then((m) => m.emitIntegrationDelete({ guildId, integrationId: app.id, applicationId: app.id }))
    .catch(() => {});
  return { status: 204, body: '' };
}

// AutoMod rule routes (Discord's /guilds/:id/auto-moderation/rules, for the
// web app), mounted at /api. Managing rules needs MANAGE_SERVER (or owner /
// ADMINISTRATOR), like Discord's MANAGE_GUILD.
//
//   GET    /servers/:serverId/auto-moderation/rules
//   GET    /servers/:serverId/auto-moderation/rules/:ruleId
//   POST   /servers/:serverId/auto-moderation/rules           create
//   PATCH  /servers/:serverId/auto-moderation/rules/:ruleId   edit (trigger type is fixed)
//   DELETE /servers/:serverId/auto-moderation/rules/:ruleId
//
// Enforcement lives in src/lib/services/automod.ts (called by the message
// write routes in channels.ts); matching rules in src/lib/automod/rules.ts.
import { Elysia } from 'elysia';
import { Channel, Role, Server } from '@/lib/models';
import { authenticateRequest } from '@/lib/services/auth';
import { rejectInvalidObjectIdParams } from '@/lib/security';
import { normalizeId } from '@/lib/db/normalizeId';
import { hasServerPermission } from '@/lib/permissions/serverPermissions';
import { PERMISSION_BITS } from '@/lib/permissions/bits';
import { auditReason } from '@/lib/audit/auditLog';
import { canAddRule, normalizeRuleInput, type AutoModRuleInput } from '@/lib/automod/rules';
import {
  createAutoModRule,
  deleteAutoModRule,
  getAutoModRule,
  listAutoModRules,
  updateAutoModRule,
} from '@/lib/services/automod';

type Cookie = Record<string, { value?: unknown }>;
type Set = { status?: number | string };

async function getAuth(headers: Record<string, string | undefined>, cookie: Cookie) {
  const authHeader = headers.authorization ?? null;
  const authToken = cookie.auth_token?.value;
  const cookies: Record<string, string> = {};
  if (typeof authToken === 'string') cookies.auth_token = authToken;
  return authenticateRequest(authHeader, cookies);
}

/** The signed-in user, if they may manage AutoMod in this server; otherwise the error reply. */
async function requireManager(
  headers: Record<string, string | undefined>,
  cookie: Cookie,
  serverId: string,
  set: Set,
): Promise<{ userId: string } | { error: string }> {
  const { user, error } = await getAuth(headers, cookie);
  if (!user) {
    set.status = 401;
    return { error: error || 'Unauthorized' };
  }
  const server = await Server.findById(serverId);
  if (!server) {
    set.status = 404;
    return { error: 'Server not found' };
  }
  if (!(await hasServerPermission(server, user.id, PERMISSION_BITS.MANAGE_SERVER))) {
    set.status = 403;
    return { error: 'You need the Manage Server permission to manage AutoMod' };
  }
  return { userId: user.id };
}

/** Drops exempt roles / channels from other servers and checks the alert channel. */
export async function scopeToServer(serverId: string, input: AutoModRuleInput): Promise<{ value: AutoModRuleInput } | { error: string }> {
  const sid = normalizeId(serverId);
  const [roles, channels] = await Promise.all([
    input.exemptRoles.length ? Role.find({ serverId: sid }) : Promise.resolve([]),
    Promise.all([...new Set([...input.exemptChannels, ...input.actions.flatMap((a) => (a.type === 'send_alert' ? [a.channelId] : []))])]
      .map((id) => Channel.findById(id).catch(() => null))),
  ]);
  const roleIds = new Set(roles.map((r: { id: string }) => normalizeId(r.id)));
  const inServer = new Map<string, string>();
  for (const c of channels) {
    if (c?.serverId && normalizeId(c.serverId) === sid) inServer.set(normalizeId(c.id), String(c.type));
  }
  for (const a of input.actions) {
    if (a.type !== 'send_alert') continue;
    const type = inServer.get(normalizeId(a.channelId));
    if (!type || !['text', 'announcement'].includes(type)) return { error: 'The alert channel must be a text channel in this server' };
  }
  return {
    value: {
      ...input,
      exemptRoles: input.exemptRoles.filter((id) => roleIds.has(normalizeId(id))),
      exemptChannels: input.exemptChannels.filter((id) => inServer.has(normalizeId(id))),
    },
  };
}

export const automodRoutes = new Elysia({ prefix: '/servers' })
  .onBeforeHandle(rejectInvalidObjectIdParams)
  .get('/:serverId/auto-moderation/rules', async ({ headers, cookie, params, set }) => {
    const auth = await requireManager(headers, cookie as Cookie, params.serverId, set);
    if ('error' in auth) return auth;
    return { rules: await listAutoModRules(params.serverId) };
  })
  .get('/:serverId/auto-moderation/rules/:ruleId', async ({ headers, cookie, params, set }) => {
    const auth = await requireManager(headers, cookie as Cookie, params.serverId, set);
    if ('error' in auth) return auth;
    const rule = await getAutoModRule(params.serverId, params.ruleId);
    if (!rule) {
      set.status = 404;
      return { error: 'Unknown AutoMod rule' };
    }
    return { rule };
  })
  .post('/:serverId/auto-moderation/rules', async ({ headers, cookie, params, body, set }) => {
    const auth = await requireManager(headers, cookie as Cookie, params.serverId, set);
    if ('error' in auth) return auth;
    const parsed = normalizeRuleInput(body);
    if (!parsed.ok) {
      set.status = 400;
      return { error: parsed.error };
    }
    const existing = await listAutoModRules(params.serverId);
    if (!canAddRule(existing, parsed.value.triggerType)) {
      set.status = 400;
      return { error: 'This server already has the maximum number of rules of this type' };
    }
    const scoped = await scopeToServer(params.serverId, parsed.value);
    if ('error' in scoped) {
      set.status = 400;
      return { error: scoped.error };
    }
    const reason = auditReason(headers['x-audit-log-reason'], (body as { reason?: string } | null)?.reason);
    const rule = await createAutoModRule(params.serverId, auth.userId, scoped.value, reason);
    set.status = 201;
    return { rule };
  })
  .patch('/:serverId/auto-moderation/rules/:ruleId', async ({ headers, cookie, params, body, set }) => {
    const auth = await requireManager(headers, cookie as Cookie, params.serverId, set);
    if ('error' in auth) return auth;
    const before = await getAutoModRule(params.serverId, params.ruleId);
    if (!before) {
      set.status = 404;
      return { error: 'Unknown AutoMod rule' };
    }
    const parsed = normalizeRuleInput(body, before);
    if (!parsed.ok) {
      set.status = 400;
      return { error: parsed.error };
    }
    const scoped = await scopeToServer(params.serverId, parsed.value);
    if ('error' in scoped) {
      set.status = 400;
      return { error: scoped.error };
    }
    const reason = auditReason(headers['x-audit-log-reason'], (body as { reason?: string } | null)?.reason);
    const rule = await updateAutoModRule(params.serverId, auth.userId, before, scoped.value, reason);
    if (!rule) {
      set.status = 404;
      return { error: 'Unknown AutoMod rule' };
    }
    return { rule };
  })
  .delete('/:serverId/auto-moderation/rules/:ruleId', async ({ headers, cookie, params, set }) => {
    const auth = await requireManager(headers, cookie as Cookie, params.serverId, set);
    if ('error' in auth) return auth;
    const rule = await getAutoModRule(params.serverId, params.ruleId);
    if (!rule) {
      set.status = 404;
      return { error: 'Unknown AutoMod rule' };
    }
    await deleteAutoModRule(params.serverId, auth.userId, rule, auditReason(headers['x-audit-log-reason']));
    return { success: true };
  });

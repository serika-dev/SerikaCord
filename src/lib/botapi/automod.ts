/**
 * AutoMod rule CRUD for the Discord-compatible bot API (WP4b), wrapping the
 * same service as the web settings (src/lib/services/automod.ts: storage,
 * audit log, AUTO_MODERATION_RULE_CREATE / _UPDATE / _DELETE). Needs
 * MANAGE_GUILD (Serika: Manage Server); a timeout action also needs
 * MODERATE_MEMBERS, like Discord. Body mapping: ./automodRules.ts.
 */
import { ServerMember } from '@/lib/models';
import { PERMISSION_BITS as P, hasPermission } from '@/lib/permissions/bits';
import { applyTimeout } from '@/lib/permissions/botChannel';
import { auditReason } from '@/lib/audit/auditLog';
import { canAddRule, normalizeRuleInput, toDiscordRule } from '@/lib/automod/rules';
import { isValidObjectId } from '@/lib/security';
import { fromDiscordRuleBody, hasTimeoutAction } from './automodRules';

type Result = { status: number; body: unknown };
type Headers = Record<string, string | undefined>;

const UNKNOWN_RULE = { code: 10066, message: 'Unknown auto moderation rule' };
const MISSING_PERMISSIONS = { code: 50013, message: 'Missing Permissions' };
const invalid = (message: string, path = 'trigger_metadata', code = 'AUTO_MODERATION_INVALID') =>
  ({ code: 50035, message: `Invalid Form Body (${message})`, errors: { [path]: { _errors: [{ code, message }] } } });

async function guildPerms(guildId: string, botId: string): Promise<bigint> {
  const member = await ServerMember.findOne({ serverId: guildId, userId: botId });
  const { getMemberChannelPermissions } = await import('@/lib/api/channels');
  return applyTimeout(await getMemberChannelPermissions(botId, { serverId: guildId }, member ?? null), member?.communicationDisabledUntil ?? null);
}
const has = (perms: bigint, bit: bigint) => hasPermission(perms, P.ADMINISTRATOR) || hasPermission(perms, bit);

async function requireManager(guildId: string, botId: string): Promise<{ perms: bigint } | Result> {
  const perms = await guildPerms(guildId, botId);
  if (!has(perms, P.MANAGE_SERVER)) return { status: 403, body: MISSING_PERMISSIONS };
  return { perms };
}

export async function listBotRules(guildId: string, botId: string): Promise<Result> {
  const g = await requireManager(guildId, botId);
  if ('status' in g) return g;
  const { listAutoModRules } = await import('@/lib/services/automod');
  return { status: 200, body: (await listAutoModRules(guildId)).map(toDiscordRule) };
}

export async function getBotRule(guildId: string, ruleId: string, botId: string): Promise<Result> {
  const g = await requireManager(guildId, botId);
  if ('status' in g) return g;
  if (!isValidObjectId(ruleId)) return { status: 404, body: UNKNOWN_RULE };
  const { getAutoModRule } = await import('@/lib/services/automod');
  const rule = await getAutoModRule(guildId, ruleId);
  return rule ? { status: 200, body: toDiscordRule(rule) } : { status: 404, body: UNKNOWN_RULE };
}

export async function createBotRule(guildId: string, botId: string, body: unknown, headers: Headers): Promise<Result> {
  const g = await requireManager(guildId, botId);
  if ('status' in g) return g;
  const mapped = fromDiscordRuleBody(body);
  if (!mapped.ok) return { status: 400, body: mapped.error };
  const parsed = normalizeRuleInput(mapped.input);
  if (!parsed.ok) return { status: 400, body: invalid(parsed.error) };
  if (hasTimeoutAction(parsed.value) && !has(g.perms, P.MODERATE_MEMBERS)) return { status: 403, body: MISSING_PERMISSIONS };
  const svc = await import('@/lib/services/automod');
  const existing = await svc.listAutoModRules(guildId);
  if (!canAddRule(existing, parsed.value.triggerType)) {
    return { status: 400, body: invalid('Maximum number of rules of this trigger type reached', 'trigger_type', 'AUTO_MODERATION_MAX_RULES_OF_TYPE_EXCEEDED') };
  }
  const { scopeToServer } = await import('@/lib/api/automod');
  const scoped = await scopeToServer(guildId, parsed.value);
  if ('error' in scoped) return { status: 400, body: invalid(scoped.error, 'actions') };
  const reason = auditReason(headers['x-audit-log-reason']);
  const rule = await svc.createAutoModRule(guildId, botId, scoped.value, reason);
  return { status: 200, body: toDiscordRule(rule) };
}

export async function updateBotRule(guildId: string, ruleId: string, botId: string, body: unknown, headers: Headers): Promise<Result> {
  const g = await requireManager(guildId, botId);
  if ('status' in g) return g;
  if (!isValidObjectId(ruleId)) return { status: 404, body: UNKNOWN_RULE };
  const svc = await import('@/lib/services/automod');
  const before = await svc.getAutoModRule(guildId, ruleId);
  if (!before) return { status: 404, body: UNKNOWN_RULE };
  const mapped = fromDiscordRuleBody(body, before);
  if (!mapped.ok) return { status: 400, body: mapped.error };
  // trigger_metadata fields left out keep their stored value.
  if (mapped.input.triggerMetadata) mapped.input.triggerMetadata = { ...before.triggerMetadata, ...(mapped.input.triggerMetadata as object) };
  const parsed = normalizeRuleInput(mapped.input, before);
  if (!parsed.ok) return { status: 400, body: invalid(parsed.error) };
  if (hasTimeoutAction(parsed.value) && !hasTimeoutAction(before) && !has(g.perms, P.MODERATE_MEMBERS)) return { status: 403, body: MISSING_PERMISSIONS };
  const { scopeToServer } = await import('@/lib/api/automod');
  const scoped = await scopeToServer(guildId, parsed.value);
  if ('error' in scoped) return { status: 400, body: invalid(scoped.error, 'actions') };
  const rule = await svc.updateAutoModRule(guildId, botId, before, scoped.value, auditReason(headers['x-audit-log-reason']));
  return rule ? { status: 200, body: toDiscordRule(rule) } : { status: 404, body: UNKNOWN_RULE };
}

export async function deleteBotRule(guildId: string, ruleId: string, botId: string, headers: Headers): Promise<Result> {
  const g = await requireManager(guildId, botId);
  if ('status' in g) return g;
  if (!isValidObjectId(ruleId)) return { status: 404, body: UNKNOWN_RULE };
  const svc = await import('@/lib/services/automod');
  const rule = await svc.getAutoModRule(guildId, ruleId);
  if (!rule) return { status: 404, body: UNKNOWN_RULE };
  await svc.deleteAutoModRule(guildId, botId, rule, auditReason(headers['x-audit-log-reason']));
  return { status: 204, body: '' };
}

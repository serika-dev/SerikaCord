/**
 * Smaller Discord v10 guild endpoints for the bot API:
 *   GET /gateway/bot                      shard recommendation + identify budget
 *   GET /guilds/{id}/new-member-welcome   the Server Guide (./guildWelcomeRules.ts)
 *   PUT /guilds/{id}/incident-actions     pause invites / DMs (./guildIncidentRules.ts)
 */
import { eq, sql } from 'drizzle-orm';
import { db, schema } from '@/lib/db/postgres';
import { normalizeId } from '@/lib/db/normalizeId';
import { config } from '@/lib/config';
import { Server, ServerMember } from '@/lib/models';
import { PERMISSION_BITS as P, hasPermission } from '@/lib/permissions/bits';
import { applyTimeout } from '@/lib/permissions/botChannel';
import { isGuideVisible } from '@/lib/servers/onboarding';
import { decodeHtmlEntities } from '@/lib/chat/messages';
import { invalidFormBody } from './errors';
import { parseIncidentActions, readIncidents } from './guildIncidentRules';
import { toDiscordNewMemberWelcome } from './guildWelcomeRules';
import { recommendedShards, sessionStartLimit } from './guildGatewayRules';

type Result = { status: number; body: unknown };

const MISSING_PERMISSIONS = { code: 50013, message: 'Missing Permissions' };
const UNKNOWN_GUILD = { code: 10004, message: 'Unknown Guild' };

async function guildPerms(guildId: string, botId: string): Promise<bigint> {
  const member = await ServerMember.findOne({ serverId: guildId, userId: botId });
  const { getMemberChannelPermissions } = await import('@/lib/api/channels');
  return applyTimeout(await getMemberChannelPermissions(botId, { serverId: guildId }, member ?? null), member?.communicationDisabledUntil ?? null);
}
const has = (perms: bigint, bit: bigint) => hasPermission(perms, P.ADMINISTRATOR) || hasPermission(perms, bit);

// ─── Gateway ──────────────────────────────────────────────────────────────────

/**
 * GET /gateway/bot: the shard count for the bot's guilds and what is left of
 * its daily IDENTIFY budget (the gateway's gatewayIdentifyDaily limiter, read
 * without consuming a point).
 */
export async function gatewayBotInfo(botId: string) {
  const [guilds, budget] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(schema.serverMembers).where(eq(schema.serverMembers.userId, normalizeId(botId)))
      .then((r) => Number(r[0]?.n ?? 0)).catch(() => 0),
    (async () => {
      try {
        const [{ getRateLimiter }, { GATEWAY_LIMITS }] = await Promise.all([import('@/lib/security'), import('@/lib/security/botRateLimit')]);
        // get() reads the window without consuming a point.
        const res = await getRateLimiter('gatewayIdentifyDaily', GATEWAY_LIMITS.gatewayIdentifyDaily).get(botId);
        return sessionStartLimit(res ? { consumedPoints: res.consumedPoints, msBeforeNext: res.msBeforeNext } : null);
      } catch {
        return sessionStartLimit(null);
      }
    })(),
  ]);
  return { url: config.GATEWAY_URL, shards: recommendedShards(guilds), session_start_limit: budget };
}

// ─── New member welcome (Server Guide) ────────────────────────────────────────

/** GET /guilds/{id}/new-member-welcome: anyone in the guild while the guide is on, else MANAGE_GUILD. */
export async function getNewMemberWelcomeForBot(guildId: string, botId: string): Promise<Result> {
  const server = await Server.findById(guildId);
  if (!server) return { status: 404, body: UNKNOWN_GUILD };
  const { getOnboardingConfig } = await import('@/lib/services/serverCommunity');
  const cfg = await getOnboardingConfig(guildId);
  if (!isGuideVisible(cfg.guide) && !has(await guildPerms(guildId, botId), P.MANAGE_SERVER)) return { status: 403, body: MISSING_PERMISSIONS };
  return { status: 200, body: toDiscordNewMemberWelcome(server.id, cfg.guide, { ownerId: server.ownerId, decode: decodeHtmlEntities }) };
}

// ─── Incident actions ─────────────────────────────────────────────────────────

/** PUT /guilds/{id}/incident-actions: MANAGE_GUILD; GUILD_UPDATE when something changed. */
export async function putIncidentActionsForBot(guildId: string, botId: string, body: unknown): Promise<Result> {
  if (!has(await guildPerms(guildId, botId), P.MANAGE_SERVER)) return { status: 403, body: MISSING_PERMISSIONS };
  const server = await Server.findById(guildId);
  if (!server) return { status: 404, body: UNKNOWN_GUILD };
  const parsed = parseIncidentActions(body, server.settings);
  if (!parsed.ok) return { status: 400, body: invalidFormBody(parsed.errors) };
  const before = readIncidents(server.settings);
  const value = parsed.value;
  await db.update(schema.servers)
    .set({ settings: sql`jsonb_set(coalesce(${schema.servers.settings}, '{}'::jsonb), '{incidents}', ${JSON.stringify(value)}::jsonb)` })
    .where(eq(schema.servers.id, normalizeId(server.id)));
  const after = { invites_disabled_until: value.invitesDisabledUntil, dms_disabled_until: value.dmsDisabledUntil };
  if (before.invites_disabled_until !== after.invites_disabled_until || before.dms_disabled_until !== after.dms_disabled_until) {
    const [{ cache }, guildEvents, widget] = await Promise.all([import('@/lib/db'), import('@/lib/services/guildGatewayEvents'), import('./guildWidget')]);
    await cache.del(`server:${server.id}`).catch(() => {});
    widget.invalidateWidgetCache(server.id);
    void guildEvents.emitGuildUpdate(server.id);
  }
  return { status: 200, body: after };
}

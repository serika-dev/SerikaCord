/**
 * Scheduled event user counts and exceptions for the Discord-compatible bot
 * API (rules in ./guildEventExceptionRules.ts). The event itself is looked up
 * with the same visibility as GET .../scheduled-events/{id} (./scheduledEvents.ts):
 * events in channels the bot can't see are unknown.
 */
import { ServerMember } from '@/lib/models';
import { PERMISSION_BITS as P, hasPermission } from '@/lib/permissions/bits';
import { applyTimeout } from '@/lib/permissions/botChannel';
import { invalidFormBody } from './errors';
import { NOT_RECURRING_ERROR, parseExceptionBody, parseExceptionIds, parseExceptionUsersQuery } from './guildEventExceptionRules';

type Result = { status: number; body: unknown };

const MISSING_PERMISSIONS = { code: 50013, message: 'Missing Permissions' };
const UNKNOWN_EXCEPTION = { code: 0, message: 'Unknown Guild Scheduled Event Exception' };

/** The event as the bot may see it (with user_count), or the error to answer. */
async function visibleEvent(guildId: string, eventId: string, botId: string): Promise<{ ok: true; event: { user_count?: number; creator_id?: string | null } } | { ok: false; result: Result }> {
  const { getBotEvent } = await import('./scheduledEvents');
  const res = await getBotEvent(guildId, eventId, botId, true);
  if (res.status !== 200) return { ok: false, result: res };
  return { ok: true, event: res.body as { user_count?: number; creator_id?: string | null } };
}

/** MANAGE_EVENTS, or CREATE_EVENTS for the bot's own event (Discord). */
async function mayManage(guildId: string, botId: string, creatorId: string | null | undefined): Promise<boolean> {
  const member = await ServerMember.findOne({ serverId: guildId, userId: botId });
  const { getMemberChannelPermissions } = await import('@/lib/api/channels');
  const perms = applyTimeout(await getMemberChannelPermissions(botId, { serverId: guildId }, member ?? null), member?.communicationDisabledUntil ?? null);
  const has = (bit: bigint) => hasPermission(perms, P.ADMINISTRATOR) || hasPermission(perms, bit);
  const own = !!creatorId && creatorId.toLowerCase() === botId.toLowerCase();
  return has(P.MANAGE_EVENTS) || (own && has(P.CREATE_EVENTS));
}

/** GET .../scheduled-events/{id}/users/counts */
export async function countEventUsersForBot(guildId: string, eventId: string, botId: string, query: Record<string, unknown>): Promise<Result> {
  const ids = parseExceptionIds(query.guild_scheduled_event_exception_ids);
  if (!ids.ok) return { status: 400, body: invalidFormBody(ids.errors) };
  const ev = await visibleEvent(guildId, eventId, botId);
  if (!ev.ok) return ev.result;
  // No exceptions exist (events don't recur), so there are no per-exception counts.
  return { status: 200, body: { guild_scheduled_event_count: ev.event.user_count ?? 0, guild_scheduled_event_exception_counts: {} } };
}

/** POST .../scheduled-events/{id}/exceptions */
export async function createEventExceptionForBot(guildId: string, eventId: string, botId: string, body: unknown): Promise<Result> {
  const ev = await visibleEvent(guildId, eventId, botId);
  if (!ev.ok) return ev.result;
  if (!(await mayManage(guildId, botId, ev.event.creator_id))) return { status: 403, body: MISSING_PERMISSIONS };
  const parsed = parseExceptionBody(body, { create: true });
  if (!parsed.ok) return { status: 400, body: invalidFormBody(parsed.errors) };
  return { status: 400, body: invalidFormBody([NOT_RECURRING_ERROR]) };
}

/** PATCH / DELETE .../exceptions/{exception_id} and GET .../{exception_id}/users */
export async function missingEventExceptionForBot(guildId: string, eventId: string, botId: string, opts: { manage: boolean; body?: unknown; query?: Record<string, unknown> }): Promise<Result> {
  if (opts.query) {
    const q = parseExceptionUsersQuery(opts.query);
    if (!q.ok) return { status: 400, body: invalidFormBody(q.errors) };
  }
  const ev = await visibleEvent(guildId, eventId, botId);
  if (!ev.ok) return ev.result;
  if (opts.manage) {
    if (!(await mayManage(guildId, botId, ev.event.creator_id))) return { status: 403, body: MISSING_PERMISSIONS };
    if (opts.body !== undefined) {
      const parsed = parseExceptionBody(opts.body, { create: false });
      if (!parsed.ok) return { status: 400, body: invalidFormBody(parsed.errors) };
    }
  }
  return { status: 404, body: UNKNOWN_EXCEPTION };
}

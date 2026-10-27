/**
 * GET /guilds/{id}/requests and PATCH /guilds/{id}/requests/{request_id} for
 * the Discord-compatible bot API, over Serika's member applications (the same
 * rows Server Settings -> Member Applications reviews; shapes in
 * ./guildJoinRequestRules.ts).
 *
 * Permission: MANAGE_GUILD, the same reviewers as Server Settings -> Member
 * Applications (the answers are private to them).
 *
 * Approving does what the web review does: a member waiting in rules
 * screening is let in (onboarding roles follow), an apply-to-join applicant
 * joins the server (never if banned since). Rejecting stores the reason; it
 * doesn't remove anyone.
 */
import { and, asc, count, desc, eq, gt, inArray, lt, or, type SQL } from 'drizzle-orm';
import { db, schema } from '@/lib/db/postgres';
import { normalizeId } from '@/lib/db/normalizeId';
import { Role, Server, ServerBan, ServerMember, ServerMemberApplication, User } from '@/lib/models';
import { SERVER_MEMBER_APPLICATION_FIELDS } from '@/lib/models/ServerMemberApplication';
import { decryptRows } from '@/lib/security/fieldEncryption';
import { PERMISSION_BITS as P, hasPermission } from '@/lib/permissions/bits';
import { applyTimeout } from '@/lib/permissions/botChannel';
import { isValidObjectId, sanitizeInput } from '@/lib/security';
import { decodeHtmlEntities } from '@/lib/chat/messages';
import { toDiscordUserRow } from '@/lib/services/gatewayEvents';
import { invalidFormBody } from './errors';
import {
  parseJoinRequestAction, parseJoinRequestListQuery, serikaStatusesFor, toDiscordJoinRequest, toFormResponses,
  type JoinRequestRow,
} from './guildJoinRequestRules';

type Result = { status: number; body: unknown };

const a = schema.serverMemberApplications;
const MISSING_PERMISSIONS = { code: 50013, message: 'Missing Permissions' };
const UNKNOWN_REQUEST = { code: 0, message: 'Unknown Guild Join Request' };

async function guildPerms(guildId: string, botId: string): Promise<bigint> {
  const member = await ServerMember.findOne({ serverId: guildId, userId: botId });
  const { getMemberChannelPermissions } = await import('@/lib/api/channels');
  return applyTimeout(await getMemberChannelPermissions(botId, { serverId: guildId }, member ?? null), member?.communicationDisabledUntil ?? null);
}

async function mayReview(guildId: string, botId: string): Promise<boolean> {
  const perms = await guildPerms(guildId, botId);
  return hasPermission(perms, P.ADMINISTRATOR) || hasPermission(perms, P.MANAGE_SERVER);
}

/** Join request objects for application rows (users, reviewers and form fields in a few queries). */
async function present(guildId: string, rows: JoinRequestRow[]) {
  if (rows.length === 0) return [];
  const userIds = [...new Set(rows.flatMap((r) => [r.userId, r.processedBy]).filter((id): id is string => !!id && isValidObjectId(id)))];
  const { getScreeningConfig } = await import('@/lib/services/serverCommunity');
  const [users, screening] = await Promise.all([
    userIds.length ? User.find({ id: { in: userIds } }).catch(() => []) : Promise.resolve([]),
    getScreeningConfig(guildId).catch(() => null),
  ]);
  const userBy = new Map(users.map((u) => [normalizeId(u.id), toDiscordUserRow(u)]));
  const ctx = { rules: screening?.rules ?? [], questions: screening?.questions ?? [], decode: decodeHtmlEntities };
  return rows.map((r) => toDiscordJoinRequest(r, {
    user: userBy.get(normalizeId(r.userId)) ?? null,
    actionedBy: r.processedBy ? userBy.get(normalizeId(r.processedBy)) ?? null : null,
    formResponses: toFormResponses(r.answers, ctx),
  }));
}

export async function listJoinRequestsForBot(guildId: string, botId: string, query: Record<string, unknown>): Promise<Result> {
  if (!(await mayReview(guildId, botId))) return { status: 403, body: MISSING_PERMISSIONS };
  const parsed = parseJoinRequestListQuery(query);
  if (!parsed.ok) return { status: 400, body: invalidFormBody(parsed.errors) };
  const statuses = serikaStatusesFor(parsed.status);
  if (statuses && statuses.length === 0) return { status: 200, body: { total: 0, guild_join_requests: [] } };

  const base: SQL[] = [eq(a.serverId, normalizeId(guildId))];
  if (statuses) base.push(inArray(a.status, statuses));
  // before / after are request ids; pages follow creation order (ids are random UUIDs).
  const cursorId = parsed.after ?? parsed.before;
  const conds = [...base];
  if (cursorId) {
    if (!isValidObjectId(cursorId)) return { status: 200, body: { total: 0, guild_join_requests: [] } };
    const [cursor] = await db.select({ id: a.id, createdAt: a.createdAt }).from(a)
      .where(and(eq(a.id, normalizeId(cursorId)), eq(a.serverId, normalizeId(guildId)))).limit(1);
    if (cursor?.createdAt) {
      const at = cursor.createdAt;
      conds.push(parsed.after
        ? or(gt(a.createdAt, at), and(eq(a.createdAt, at), gt(a.id, cursor.id)))!
        : or(lt(a.createdAt, at), and(eq(a.createdAt, at), lt(a.id, cursor.id)))!);
    }
  }
  const order = parsed.after ? [asc(a.createdAt), asc(a.id)] : [desc(a.createdAt), desc(a.id)];
  const [[{ n }], raw] = await Promise.all([
    db.select({ n: count() }).from(a).where(and(...base)),
    db.select().from(a).where(and(...conds)).orderBy(...order).limit(parsed.limit),
  ]);
  const rows = await decryptRows(SERVER_MEMBER_APPLICATION_FIELDS, raw);
  return { status: 200, body: { total: Number(n) || 0, guild_join_requests: await present(guildId, rows) } };
}

export async function actionJoinRequestForBot(guildId: string, requestId: string, botId: string, body: unknown): Promise<Result> {
  if (!(await mayReview(guildId, botId))) return { status: 403, body: MISSING_PERMISSIONS };
  const parsed = parseJoinRequestAction(body);
  if (!parsed.ok) return { status: 400, body: invalidFormBody(parsed.errors) };
  if (!isValidObjectId(requestId)) return { status: 404, body: UNKNOWN_REQUEST };
  const application = await ServerMemberApplication.findOne({ id: requestId, serverId: guildId });
  if (!application) return { status: 404, body: UNKNOWN_REQUEST };

  const updates: Record<string, unknown> = { processedBy: botId, processedAt: new Date() };
  if (parsed.action === 'APPROVED') {
    const server = await Server.findById(guildId);
    if (!server) return { status: 404, body: { code: 10004, message: 'Unknown Guild' } };
    const member = await ServerMember.findOne({ serverId: guildId, userId: application.userId });
    const { admitScreenedMember } = await import('@/lib/services/serverCommunity');
    if (member) {
      await admitScreenedMember(guildId, application.userId);
    } else if ((server.joinMode || 'invite_only') !== 'apply_to_join') {
      // A rules-screening application whose author left: approving must not pull them back in.
      return { status: 400, body: { code: 0, message: 'This user is no longer in the guild' } };
    } else {
      if (await ServerBan.findOne({ serverId: guildId, userId: application.userId })) {
        return { status: 403, body: { code: 40007, message: 'The user is banned from this guild.' } };
      }
      const everyone = await Role.findOne({ serverId: guildId, isDefault: true });
      const { insertServerMember } = await import('@/lib/services/serverMembership');
      await insertServerMember(guildId, application.userId, { roles: everyone ? [everyone.id] : [], pending: false });
    }
    Object.assign(updates, { status: 'approved', rejectionReason: null });
  } else {
    Object.assign(updates, {
      status: 'rejected',
      rejectionReason: parsed.rejectionReason ? sanitizeInput(parsed.rejectionReason).slice(0, 500) : null,
    });
  }
  const updated = await ServerMemberApplication.updateById(application.id, updates);
  // The applicant's open apps refresh their onboarding / screening state.
  void import('@/lib/api/activity')
    .then(({ fanoutToUsers }) => fanoutToUsers({ userIds: [normalizeId(application.userId)] }, { type: 'server_onboarding_update', serverId: guildId }))
    .catch(() => {});
  const [view] = await present(guildId, [(updated ?? { ...application, ...updates }) as JoinRequestRow]);
  return { status: 200, body: view };
}

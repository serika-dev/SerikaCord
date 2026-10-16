/**
 * Invites by code for the Discord-compatible bot API (WP4b):
 * GET /invites/{code} (public, like Discord: any bot may resolve a code) and
 * DELETE /invites/{code} (MANAGE_GUILD, or MANAGE_CHANNELS on the invite's
 * channel), which audit-logs and sends INVITE_DELETE.
 */
import { Channel, Invite, Server, ServerMember, User } from '@/lib/models';
import { PERMISSION_BITS as P, hasPermission } from '@/lib/permissions/bits';
import { applyTimeout } from '@/lib/permissions/botChannel';
import { audit } from '@/lib/services/auditLog';
import { AuditLogEvent, auditReason } from '@/lib/audit/auditLog';
import { CHANNEL_TYPE_NUMBERS, toDiscordGuildBase, toDiscordUserRow } from '@/lib/services/gatewayEvents';
import { isValidObjectId } from '@/lib/security';

type Result = { status: number; body: unknown };
type InviteRow = NonNullable<Awaited<ReturnType<typeof Invite.findOne>>>;

const UNKNOWN_INVITE = { code: 10006, message: 'Unknown Invite' };
const MISSING_PERMISSIONS = { code: 50013, message: 'Missing Permissions' };

const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);

/** An invite that can no longer be used (expired or used up). */
export function inviteExpired(inv: { expiresAt?: Date | string | null; maxUses?: number | null; uses?: number | null }, now = Date.now()): boolean {
  if (inv.expiresAt && new Date(inv.expiresAt).getTime() <= now) return true;
  if ((inv.maxUses ?? 0) > 0 && (inv.uses ?? 0) >= (inv.maxUses ?? 0)) return true;
  return false;
}

/** Discord invite object (type 0 GUILD): guild / channel partials, inviter, optional counts and metadata. */
export async function toDiscordInvite(inv: InviteRow, opts: { withCounts?: boolean; withMetadata?: boolean; scheduledEventId?: string | null } = {}) {
  const [server, channel, inviter] = await Promise.all([
    Server.findById(inv.serverId).catch(() => null),
    Channel.findById(inv.channelId).catch(() => null),
    inv.inviterId ? User.findById(inv.inviterId).catch(() => null) : Promise.resolve(null),
  ]);
  const base = server ? toDiscordGuildBase(server) : null;
  const out: Record<string, unknown> = {
    type: 0,
    code: inv.code,
    guild_id: inv.serverId,
    guild: base ? {
      id: base.id,
      name: base.name,
      splash: base.splash,
      banner: base.banner,
      description: base.description,
      icon: base.icon,
      features: base.features,
      verification_level: base.verification_level,
      vanity_url_code: base.vanity_url_code,
      nsfw_level: base.nsfw_level,
      nsfw: base.nsfw,
      premium_subscription_count: base.premium_subscription_count,
    } : null,
    channel: channel ? { id: channel.id, type: CHANNEL_TYPE_NUMBERS[String(channel.type)] ?? 0, name: channel.name } : null,
    ...(inviter ? { inviter: toDiscordUserRow(inviter) } : {}),
    expires_at: iso(inv.expiresAt),
    flags: 0,
  };
  if (opts.withCounts && server) {
    out.approximate_member_count = server.memberCount ?? 0;
    out.approximate_presence_count = server.onlineCount ?? 0;
  }
  if (opts.withMetadata) {
    Object.assign(out, {
      uses: inv.uses ?? 0,
      max_uses: inv.maxUses ?? 0,
      max_age: inv.maxAge ?? 0,
      temporary: inv.temporary ?? false,
      created_at: iso(inv.createdAt),
    });
  }
  if (opts.scheduledEventId && isValidObjectId(opts.scheduledEventId)) {
    try {
      const { loadDiscordScheduledEvent } = await import('./scheduledEvents');
      const ev = await loadDiscordScheduledEvent(inv.serverId, opts.scheduledEventId);
      // Anyone may resolve an invite: only events anyone with it could see
      // (somewhere else, or in the invite's own channel).
      const evChannel = (ev as { channel_id?: string | null } | null)?.channel_id ?? null;
      if (ev && (!evChannel || evChannel.toLowerCase() === inv.channelId.toLowerCase())) out.guild_scheduled_event = ev;
    } catch { /* optional */ }
  }
  return out;
}

/** GET /invites/{code}. */
export async function getInviteByCode(code: string, q: { withCounts: boolean; scheduledEventId?: string | null }): Promise<Result> {
  const inv = code ? await Invite.findOne({ code }) : null;
  if (!inv || inviteExpired(inv)) return { status: 404, body: UNKNOWN_INVITE };
  return { status: 200, body: await toDiscordInvite(inv, { withCounts: q.withCounts, scheduledEventId: q.scheduledEventId }) };
}

/** DELETE /invites/{code}. */
export async function deleteInviteByCode(code: string, botId: string, headers: Record<string, string | undefined>): Promise<Result> {
  const inv = code ? await Invite.findOne({ code }) : null;
  if (!inv) return { status: 404, body: UNKNOWN_INVITE };
  const member = await ServerMember.findOne({ serverId: inv.serverId, userId: botId });
  const server = await Server.findById(inv.serverId);
  const isOwner = !!server && server.ownerId.toLowerCase() === botId.toLowerCase();
  if (!member && !isOwner) return { status: 404, body: UNKNOWN_INVITE };
  const { getMemberChannelPermissions } = await import('@/lib/api/channels');
  const until = member?.communicationDisabledUntil ?? null;
  const guildPerms = applyTimeout(await getMemberChannelPermissions(botId, { serverId: inv.serverId }, member ?? null), until);
  let allowed = hasPermission(guildPerms, P.ADMINISTRATOR) || hasPermission(guildPerms, P.MANAGE_SERVER);
  if (!allowed) {
    const channel = await Channel.findById(inv.channelId).catch(() => null);
    if (channel?.serverId) {
      const perms = applyTimeout(await getMemberChannelPermissions(botId, channel as typeof channel & { serverId: string }, member ?? null), until);
      allowed = hasPermission(perms, P.MANAGE_CHANNELS) && hasPermission(perms, P.VIEW_CHANNEL);
    }
  }
  if (!allowed) return { status: 403, body: MISSING_PERMISSIONS };
  const body = await toDiscordInvite(inv, { withMetadata: true });
  await Invite.deleteById(inv.id);
  audit({
    serverId: inv.serverId,
    userId: botId,
    actionType: AuditLogEvent.INVITE_DELETE,
    targetId: inv.code,
    changes: [
      { key: 'code', old: inv.code },
      { key: 'channel_id', old: inv.channelId },
      { key: 'uses', old: inv.uses ?? 0 },
    ],
    reason: auditReason(headers['x-audit-log-reason']),
  });
  void import('@/lib/services/gatewayEvents')
    .then((m) => m.emitInviteDelete({ guildId: inv.serverId, channelId: inv.channelId, code: inv.code }))
    .catch(() => {});
  return { status: 200, body };
}

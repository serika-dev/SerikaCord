/**
 * GET /guilds/{id}/widget.json (Discord's public guild widget). Pure; tested
 * in tests/guildparity-widget.test.ts. Served only while the owner has the
 * widget enabled (same opt-in as Serika's own /widget page).
 *
 *   channels   voice / stage channels @everyone can see and join, by position
 *   members    up to 100 online members (invisible / offline never listed),
 *              with anonymized ids "0", "1", ... like Discord, and their
 *              voice state when they sit in one of the listed channels
 */
import { PERMISSION_BITS } from '@/lib/permissions/bits';
import { computeChannelPermissions, hasBit, type ChannelOverwrite } from '@/lib/permissions/channelOverwrites';

export const WIDGET_MEMBER_LIMIT = 100;

export interface WidgetChannelLike {
  id: string;
  name: string;
  type?: string | null;
  position?: number | null;
  nsfw?: boolean | null;
  permissionOverwrites?: unknown;
}

export interface WidgetVoiceLike {
  user_id: string;
  channel_id: string | null;
  deaf?: boolean;
  mute?: boolean;
  self_deaf?: boolean;
  self_mute?: boolean;
  suppress?: boolean;
}

export interface WidgetMemberLike {
  userId: string;
  username: string;
  displayName?: string | null;
  avatarUrl: string;
  status: 'online' | 'idle' | 'dnd';
  activityName?: string | null;
}

/** Voice / stage channels anyone in the guild (@everyone, no roles) can view and connect to. */
export function publicVoiceChannels(
  channels: readonly WidgetChannelLike[],
  ctx: { serverId: string; everyoneRoleId: string | null; everyonePermissions: bigint | null },
): Array<{ id: string; name: string; position: number }> {
  const need = PERMISSION_BITS.VIEW_CHANNEL | PERMISSION_BITS.CONNECT;
  return channels
    .filter((c) => c.type === 'voice' || c.type === 'stage')
    .filter((c) => c.nsfw !== true)
    .filter((c) => {
      const perms = computeChannelPermissions({
        everyonePermissions: ctx.everyonePermissions,
        overwrites: (Array.isArray(c.permissionOverwrites) ? c.permissionOverwrites : []) as ChannelOverwrite[],
        ctx: { serverId: ctx.serverId, everyoneRoleId: ctx.everyoneRoleId, memberRoleIds: [], userId: null },
      });
      return hasBit(perms, need);
    })
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || a.id.localeCompare(b.id))
    .map((c) => ({ id: c.id, name: c.name, position: c.position ?? 0 }));
}

/** The widget object. Members are listed in the given order (callers sort them). */
export function buildWidget(opts: {
  id: string;
  name: string;
  instantInvite: string | null;
  channels: Array<{ id: string; name: string; position: number }>;
  members: readonly WidgetMemberLike[];
  voiceStates: readonly WidgetVoiceLike[];
  presenceCount: number;
}) {
  const listed = new Set(opts.channels.map((c) => c.id.toLowerCase()));
  const voiceBy = new Map<string, WidgetVoiceLike>();
  for (const v of opts.voiceStates) if (v.channel_id && listed.has(v.channel_id.toLowerCase())) voiceBy.set(v.user_id.toLowerCase(), v);
  return {
    id: opts.id,
    name: opts.name,
    instant_invite: opts.instantInvite,
    channels: opts.channels,
    members: opts.members.slice(0, WIDGET_MEMBER_LIMIT).map((m, i) => {
      const v = voiceBy.get(m.userId.toLowerCase());
      return {
        id: String(i),
        username: m.displayName || m.username,
        discriminator: '0000',
        avatar: null,
        status: m.status,
        avatar_url: m.avatarUrl,
        ...(m.activityName ? { activity: { name: m.activityName } } : {}),
        ...(v
          ? {
            channel_id: v.channel_id,
            deaf: v.deaf === true,
            mute: v.mute === true,
            self_deaf: v.self_deaf === true,
            self_mute: v.self_mute === true,
            suppress: v.suppress === true,
          }
          : {}),
      };
    }),
    presence_count: opts.presenceCount,
  };
}

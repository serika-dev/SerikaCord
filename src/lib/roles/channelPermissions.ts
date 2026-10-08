"use client";

import { PERMISSION_BITS } from "@/lib/permissions/bits";
import {
  computeChannelPermissions,
  hasBit,
  type ChannelOverwrite,
} from "@/lib/permissions/channelOverwrites";

interface PermissionOverwrite {
  id: string;
  type: string;
  allow: string;
  deny: string;
}

/**
 * Extra context so the client resolves overwrites exactly like the server:
 * the @everyone role (overwrites may be keyed by its id, and its permissions are
 * the base every member starts from) and the user's id (member overwrites).
 */
export interface ChannelPermissionOptions {
  everyoneRoleId?: string | null;
  /** The @everyone role's bitfield; unknown (null) falls back to the default. */
  everyonePermissions?: bigint | null;
  userId?: string | null;
}

function resolve(
  channel: { permissionOverwrites?: PermissionOverwrite[]; serverId?: string | null },
  userRoleIds: string[],
  rolePermissions: bigint[],
  opts: ChannelPermissionOptions | undefined,
): bigint {
  return computeChannelPermissions({
    everyonePermissions: opts?.everyonePermissions ?? null,
    rolePermissions,
    overwrites: (channel.permissionOverwrites || []) as ChannelOverwrite[],
    ctx: {
      serverId: channel.serverId,
      everyoneRoleId: opts?.everyoneRoleId ?? null,
      memberRoleIds: userRoleIds,
      userId: opts?.userId ?? null,
    },
  });
}

/**
 * Whether the current user can send messages in a channel. Mirrors the server's
 * canSendInChannel: base role permissions, then overwrites in Discord order
 * (@everyone, the member's roles, the member). Owner, admin flag, ADMINISTRATOR
 * and MANAGE_CHANNELS bypass the overwrites.
 */
export function canSendInChannel(
  channel: { permissionOverwrites?: PermissionOverwrite[]; serverId?: string | null } | null | undefined,
  userRoleIds: string[],
  rolePermissions: bigint[],
  isOwner: boolean,
  isAdmin: boolean,
  opts?: ChannelPermissionOptions,
): boolean {
  if (!channel) return true;
  if (isOwner || isAdmin) return true;
  return hasBit(resolve(channel, userRoleIds, rolePermissions, opts), PERMISSION_BITS.SEND_MESSAGES);
}

/**
 * Whether the current user can view a channel. Mirrors the server's canViewChannel.
 */
export function canViewChannel(
  channel: { permissionOverwrites?: PermissionOverwrite[]; serverId?: string | null } | null | undefined,
  userRoleIds: string[],
  rolePermissions: bigint[],
  isOwner: boolean,
  isAdmin: boolean,
  opts?: ChannelPermissionOptions,
): boolean {
  if (!channel) return true;
  if (isOwner || isAdmin) return true;
  return hasBit(resolve(channel, userRoleIds, rolePermissions, opts), PERMISSION_BITS.VIEW_CHANNEL);
}

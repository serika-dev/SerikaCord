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
  // Threads speak with SEND_MESSAGES_IN_THREADS; callers pass the parent's overwrites.
  const isThread = (channel as { type?: string }).type === "public_thread" || (channel as { type?: string }).type === "private_thread";
  return hasBit(
    resolve(channel, userRoleIds, rolePermissions, opts),
    isThread ? PERMISSION_BITS.SEND_MESSAGES_IN_THREADS : PERMISSION_BITS.SEND_MESSAGES,
  );
}

/**
 * Whether the current user holds `bit` in a channel (base role permissions,
 * then overwrites). For a thread pass its parent (threads inherit overwrites).
 * Owner, admin flag and ADMINISTRATOR hold everything. Used for thread perms:
 * CREATE_PUBLIC_THREADS / CREATE_PRIVATE_THREADS / SEND_MESSAGES_IN_THREADS /
 * MANAGE_THREADS.
 */
export function hasChannelPermission(
  channel: { permissionOverwrites?: PermissionOverwrite[]; serverId?: string | null } | null | undefined,
  bit: bigint,
  userRoleIds: string[],
  rolePermissions: bigint[],
  isOwner: boolean,
  isAdmin: boolean,
  opts?: ChannelPermissionOptions,
): boolean {
  if (!channel) return false;
  if (isOwner || isAdmin) return true;
  return hasBit(resolve(channel, userRoleIds, rolePermissions, opts), bit);
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

"use client";

import { PERMISSION_BITS } from "@/lib/permissions/bits";

interface PermissionOverwrite {
  id: string;
  type: string;
  allow: string;
  deny: string;
}

/**
 * Check if the current user can send messages in a channel based on
 * permissionOverwrites. Mirrors the backend canSendInChannel logic.
 *
 * Returns true if:
 * - User is server owner (isOwner bypass)
 * - User has Administrator or Manage Channels via role permissions
 * - No overwrites deny SEND_MESSAGES to the user's roles or @everyone
 */
export function canSendInChannel(
  channel: { permissionOverwrites?: PermissionOverwrite[]; serverId?: string | null } | null | undefined,
  userRoleIds: string[],
  rolePermissions: bigint[],
  isOwner: boolean,
  isAdmin: boolean,
): boolean {
  if (!channel) return true;
  if (isOwner || isAdmin) return true;

  const overwrites = channel.permissionOverwrites || [];
  if (!overwrites || overwrites.length === 0) return true;

  const PERM_SEND_MESSAGES = PERMISSION_BITS.SEND_MESSAGES;
  const PERM_ADMINISTRATOR = PERMISSION_BITS.ADMINISTRATOR;
  const PERM_MANAGE_CHANNELS = PERMISSION_BITS.MANAGE_CHANNELS;

  // Check if user has Administrator or Manage Channels via roles (bypasses overwrites)
  for (const perms of rolePermissions) {
    if ((perms & PERM_ADMINISTRATOR) === PERM_ADMINISTRATOR) return true;
    if ((perms & PERM_MANAGE_CHANNELS) === PERM_MANAGE_CHANNELS) return true;
  }

  // Find @everyone overwrite (type 'role', id matches serverId)
  const everyoneOverwrite = overwrites.find(
    (o) => o.type === "role" && o.id === channel.serverId,
  );
  let baseAllow = 0n;
  let baseDeny = 0n;
  if (everyoneOverwrite) {
    baseAllow = BigInt(everyoneOverwrite.allow || "0");
    baseDeny = BigInt(everyoneOverwrite.deny || "0");
  }

  let effectiveAllow = baseAllow;
  let effectiveDeny = baseDeny;

  // Apply role-specific overwrites
  for (const roleId of userRoleIds) {
    const roleOverwrite = overwrites.find(
      (o) => o.type === "role" && o.id === roleId,
    );
    if (roleOverwrite) {
      effectiveAllow |= BigInt(roleOverwrite.allow || "0");
      effectiveDeny |= BigInt(roleOverwrite.deny || "0");
    }
  }

  // If explicitly denied SEND_MESSAGES, block
  if ((effectiveDeny & PERM_SEND_MESSAGES) === PERM_SEND_MESSAGES) return false;
  // If explicitly allowed SEND_MESSAGES, permit
  if ((effectiveAllow & PERM_SEND_MESSAGES) === PERM_SEND_MESSAGES) return true;
  // Default: allow if @everyone doesn't deny it
  if ((baseDeny & PERM_SEND_MESSAGES) === PERM_SEND_MESSAGES) return false;
  return true;
}

/**
 * Check if the current user can view a channel based on permissionOverwrites.
 * Mirrors the backend canViewChannel logic.
 */
export function canViewChannel(
  channel: { permissionOverwrites?: PermissionOverwrite[]; serverId?: string | null } | null | undefined,
  userRoleIds: string[],
  rolePermissions: bigint[],
  isOwner: boolean,
  isAdmin: boolean,
): boolean {
  if (!channel) return true;
  if (isOwner || isAdmin) return true;

  const overwrites = channel.permissionOverwrites || [];
  if (!overwrites || overwrites.length === 0) return true;

  const PERM_VIEW_CHANNEL = PERMISSION_BITS.VIEW_CHANNEL;
  const PERM_ADMINISTRATOR = PERMISSION_BITS.ADMINISTRATOR;
  const PERM_MANAGE_CHANNELS = PERMISSION_BITS.MANAGE_CHANNELS;

  // Check if user has Administrator or Manage Channels via roles (bypasses overwrites)
  for (const perms of rolePermissions) {
    if ((perms & PERM_ADMINISTRATOR) === PERM_ADMINISTRATOR) return true;
    if ((perms & PERM_MANAGE_CHANNELS) === PERM_MANAGE_CHANNELS) return true;
  }

  const everyoneOverwrite = overwrites.find(
    (o) => o.type === "role" && o.id === channel.serverId,
  );
  let baseAllow = 0n;
  let baseDeny = 0n;
  if (everyoneOverwrite) {
    baseAllow = BigInt(everyoneOverwrite.allow || "0");
    baseDeny = BigInt(everyoneOverwrite.deny || "0");
  }

  let effectiveAllow = baseAllow;
  let effectiveDeny = baseDeny;

  for (const roleId of userRoleIds) {
    const roleOverwrite = overwrites.find(
      (o) => o.type === "role" && o.id === roleId,
    );
    if (roleOverwrite) {
      effectiveAllow |= BigInt(roleOverwrite.allow || "0");
      effectiveDeny |= BigInt(roleOverwrite.deny || "0");
    }
  }

  if ((effectiveDeny & PERM_VIEW_CHANNEL) === PERM_VIEW_CHANNEL) return false;
  if ((effectiveAllow & PERM_VIEW_CHANNEL) === PERM_VIEW_CHANNEL) return true;
  if ((baseDeny & PERM_VIEW_CHANNEL) === PERM_VIEW_CHANNEL) return false;
  return true;
}

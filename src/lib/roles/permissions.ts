/**
 * Named permission bits, mirroring the server-side definitions in
 * rolePermissions.ts. Used for client-side UI gating (hiding controls the
 * user can't use). The server still enforces every mutation independently.
 */
export const PERMISSIONS = {
  CREATE_INVITE: 1n << 0n,
  KICK_MEMBERS: 1n << 1n,
  BAN_MEMBERS: 1n << 2n,
  ADMINISTRATOR: 1n << 3n,
  MANAGE_CHANNELS: 1n << 4n,
  MANAGE_SERVER: 1n << 5n,
  MANAGE_MESSAGES: 1n << 13n,
  VIEW_AUDIT_LOG: 1n << 7n,
  MANAGE_NICKNAMES: 1n << 27n,
  MANAGE_ROLES: 1n << 28n,
  MANAGE_EMOJIS: 1n << 30n,
} as const;

export type PermissionKey = keyof typeof PERMISSIONS;

/** True if the bitfield includes the given permission (Administrator implies all). */
export function bitfieldHas(bitfield: bigint, permission: bigint): boolean {
  if ((bitfield & PERMISSIONS.ADMINISTRATOR) === PERMISSIONS.ADMINISTRATOR) return true;
  return (bitfield & permission) === permission;
}

/**
 * Named permission bits used for client-side UI gating (hiding controls the
 * user can't use). Derived from the canonical bit map in
 * `@/lib/permissions/bits`. The server still enforces every mutation
 * independently.
 */
import { PERMISSION_BITS, hasPermission } from "@/lib/permissions/bits";

export const PERMISSIONS = PERMISSION_BITS;

export type PermissionKey = keyof typeof PERMISSIONS;

/** True if the bitfield includes the given permission (Administrator implies all). */
export function bitfieldHas(bitfield: bigint, permission: bigint): boolean {
  return hasPermission(bitfield, permission);
}

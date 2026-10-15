/** Platform staff capabilities. Deliberately separate from server role bitfields. */
export const STAFF_PERMISSIONS = [
  'stats.view', 'users.view', 'users.moderate', 'badges.manage',
  'servers.view', 'servers.manage', 'settings.manage', 'broadcast.send',
  'logs.view', 'experiments.manage', 'instances.manage', 'tts.manage',
  'translations.manage', 'reports.manage', 'changelog.manage', 'changelog.publish',
  'staff.manage', 'safety.review',
] as const;

export type StaffPermission = typeof STAFF_PERMISSIONS[number];
export interface StaffRole {
  id: string;
  name: string;
  description: string;
  permissions: StaffPermission[];
  createdAt: string | Date;
  updatedAt: string | Date;
}
export interface StaffAccess {
  permissions: StaffPermission[];
  isSuperAdmin: boolean;
  roles: StaffRole[];
}
export interface StaffIdentity {
  id?: string;
  isStaff?: boolean | null;
  staffRole?: string | null;
  badges?: readonly string[] | null;
  isBanned?: boolean | null;
}
export interface StaffMember {
  id: string;
  username: string;
  displayName: string | null;
  avatar: string | null;
  isSuperAdmin: boolean;
  roleIds: string[];
  permissions: StaffPermission[];
}

const permissionSet: ReadonlySet<string> = new Set(STAFF_PERMISSIONS);
export const PRIVILEGED_STAFF_BADGES = ['staff', 'admin', 'moderator', 'serikacord_developer'] as const;

export function isStaffPermission(value: string): value is StaffPermission {
  return permissionSet.has(value);
}

/** Unknown persisted values never grant access, including wildcard strings. */
export function normalizeStaffPermissions(values: readonly string[]): StaffPermission[] {
  const requested = new Set(values);
  return STAFF_PERMISSIONS.filter((permission) => requested.has(permission));
}

/** Preserve the platform's existing explicit administrator/developer accounts. */
export function isLegacySuperAdmin(user: StaffIdentity | null | undefined): boolean {
  if (!user) return false;
  return !!((user.isStaff && user.staffRole === 'admin') ||
    user.badges?.includes('admin') || user.badges?.includes('serikacord_developer'));
}

export function resolveStaffAccess(user: StaffIdentity, roles: readonly StaffRole[] = []): StaffAccess {
  if (user.isBanned) return { permissions: [], isSuperAdmin: false, roles: [] };
  const isSuperAdmin = isLegacySuperAdmin(user);
  return {
    permissions: isSuperAdmin ? [...STAFF_PERMISSIONS] : normalizeStaffPermissions(roles.flatMap((role) => role.permissions)),
    isSuperAdmin,
    roles: [...roles],
  };
}

export function hasStaffPermission(access: Pick<StaffAccess, 'permissions' | 'isSuperAdmin'> | null | undefined, permission: StaffPermission): boolean {
  return !!access && (access.isSuperAdmin || access.permissions.includes(permission));
}

export function canDelegateStaffPermissions(access: StaffAccess, permissions: readonly string[]): boolean {
  return permissions.every((permission) => isStaffPermission(permission) && hasStaffPermission(access, permission));
}

/** Used for both updates and deletes, before writes and within their transaction. */
export function staffRoleMutationError(
  actorId: string,
  access: StaffAccess,
  previous: readonly string[],
  next: readonly string[],
  assignedUserIds: readonly string[] = [],
): string | null {
  if (!hasStaffPermission(access, 'staff.manage')) return 'Staff management permission required';
  if (!canDelegateStaffPermissions(access, previous) || !canDelegateStaffPermissions(access, next)) {
    return 'You can only manage permissions you have';
  }
  if (!access.isSuperAdmin && assignedUserIds.includes(actorId)) {
    return 'Ask another staff manager to change a role assigned to you';
  }
  return null;
}

export function staffAssignmentError(
  actorId: string,
  access: StaffAccess,
  target: StaffIdentity,
  previous: readonly string[],
  next: readonly string[],
): string | null {
  if (!hasStaffPermission(access, 'staff.manage')) return 'Staff management permission required';
  if (target.id === actorId) return 'Ask another staff manager to change your assignments';
  if (isLegacySuperAdmin(target)) return 'Legacy administrators are managed through their existing administrator access';
  if (target.isBanned && next.length > 0) return 'Cannot assign staff roles to a banned account';
  if (!canDelegateStaffPermissions(access, previous) || !canDelegateStaffPermissions(access, next)) {
    return 'You can only manage members whose permissions you have';
  }
  return null;
}

export function privilegedBadgeMutationError(
  actorId: string,
  access: StaffAccess,
  target: StaffIdentity,
  next: StaffIdentity,
): string | null {
  const authorityChanged = PRIVILEGED_STAFF_BADGES.some((badge) =>
    !!target.badges?.includes(badge) !== !!next.badges?.includes(badge)) ||
    !!target.isStaff !== !!next.isStaff || target.staffRole !== next.staffRole;
  if (authorityChanged && !access.isSuperAdmin) return 'Only a super administrator can change legacy staff access';
  if (target.id === actorId && isLegacySuperAdmin(target) && !isLegacySuperAdmin(next)) {
    return 'You cannot remove your own administrator access';
  }
  return null;
}

/** Compare the exact authority snapshot that a badge replacement was prepared from. */
export function sameStaffAuthoritySnapshot(left: StaffIdentity, right: StaffIdentity): boolean {
  if ((left.isStaff ?? null) !== (right.isStaff ?? null) ||
      (left.staffRole ?? null) !== (right.staffRole ?? null)) return false;
  const before = left.badges ?? null;
  const after = right.badges ?? null;
  if (before === null || after === null) return before === after;
  return before.length === after.length && before.every((badge, index) => badge === after[index]);
}

/** Unsuspending staff restores their grants, even though banned access resolves empty. */
export function staffUnbanError(access: StaffAccess, target: StaffIdentity, roles: readonly StaffRole[] = []): string | null {
  if (!hasStaffPermission(access, 'users.moderate')) return 'User moderation permission required';
  const restored = resolveStaffAccess({ ...target, isBanned: false }, roles);
  if (!access.isSuperAdmin && (target.isStaff || restored.isSuperAdmin || roles.length > 0)) {
    return 'Only a super administrator can restore a staff account';
  }
  return null;
}

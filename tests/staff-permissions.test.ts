import { describe, expect, test } from 'bun:test';
import {
  STAFF_PERMISSIONS, canDelegateStaffPermissions, hasStaffPermission, isLegacySuperAdmin,
  normalizeStaffPermissions, privilegedBadgeMutationError, resolveStaffAccess,
  sameStaffAuthoritySnapshot, staffAssignmentError, staffRoleMutationError, staffUnbanError,
  type StaffPermission, type StaffRole,
} from '../src/lib/staff/permissions';

function role(id: string, permissions: StaffPermission[]): StaffRole {
  return { id, name: id, description: '', permissions, createdAt: '', updatedAt: '' };
}
const manager = resolveStaffAccess({ id: 'manager' }, [role('manager-role', ['staff.manage', 'users.view', 'reports.manage'])]);
const superAdmin = resolveStaffAccess({ isStaff: true, staffRole: 'admin' });

describe('platform staff capability resolution', () => {
  test('ordinary and legacy moderator/staff accounts do not inherit admin access', () => {
    for (const user of [{}, { isStaff: true, staffRole: 'moderator', badges: ['staff', 'moderator'] }, { badges: ['staff', 'active_developer'] }]) {
      expect(resolveStaffAccess(user).permissions).toEqual([]);
      expect(isLegacySuperAdmin(user)).toBe(false);
    }
  });
  test('existing explicit administrators and platform developers retain access', () => {
    for (const user of [{ isStaff: true, staffRole: 'admin' }, { badges: ['admin'] }, { badges: ['serikacord_developer'] }]) {
      expect(resolveStaffAccess(user).permissions).toEqual([...STAFF_PERMISSIONS]);
      expect(isLegacySuperAdmin(user)).toBe(true);
    }
  });
  test('combines independent role grants and does not imply publish or moderation access', () => {
    const access = resolveStaffAccess({}, [role('editor', ['changelog.manage']), role('reader', ['users.view', 'changelog.manage'])]);
    expect(access.permissions).toEqual(['users.view', 'changelog.manage']);
    expect(hasStaffPermission(access, 'changelog.publish')).toBe(false);
    expect(hasStaffPermission(access, 'users.moderate')).toBe(false);
  });
  test('unknown grants are ignored and banned accounts have no access', () => {
    expect(normalizeStaffPermissions(['*', 'admin', 'users.view', 'users.view'])).toEqual(['users.view']);
    expect(resolveStaffAccess({ isBanned: true, badges: ['admin'] }, [role('manager', ['staff.manage'])])).toEqual({ permissions: [], roles: [], isSuperAdmin: false });
  });
});

describe('staff delegation boundaries', () => {
  test('managers can delegate only exact known capabilities they hold', () => {
    expect(canDelegateStaffPermissions(manager, ['users.view'])).toBe(true);
    expect(canDelegateStaffPermissions(manager, ['users.moderate'])).toBe(false);
    expect(canDelegateStaffPermissions(superAdmin, ['*'])).toBe(false);
    expect(staffRoleMutationError('manager', manager, [], ['users.view'])).toBeNull();
  });
  test('managing an existing more powerful role is denied even when stripping grants', () => {
    expect(staffRoleMutationError('manager', manager, ['users.moderate'], [])).not.toBeNull();
    expect(staffRoleMutationError('manager', manager, [], ['changelog.publish'])).not.toBeNull();
  });
  test('a delegated manager cannot change their assigned role or own assignments', () => {
    expect(staffRoleMutationError('manager', manager, ['users.view'], [], ['manager'])).not.toBeNull();
    expect(staffAssignmentError('manager', manager, { id: 'manager' }, [], [])).not.toBeNull();
    expect(staffRoleMutationError('admin', superAdmin, ['staff.manage'], [], ['admin'])).toBeNull();
  });
  test('member assignment checks both removed and granted access', () => {
    expect(staffAssignmentError('manager', manager, { id: 'other' }, ['users.view'], ['reports.manage'])).toBeNull();
    expect(staffAssignmentError('manager', manager, { id: 'other' }, ['changelog.publish'], [])).not.toBeNull();
    expect(staffAssignmentError('manager', manager, { id: 'other' }, [], ['users.moderate'])).not.toBeNull();
  });
  test('legacy administrators stay protected and banned accounts may only lose access', () => {
    expect(staffAssignmentError('admin', superAdmin, { id: 'other', badges: ['admin'] }, [], [])).not.toBeNull();
    expect(staffAssignmentError('admin', superAdmin, { id: 'other', isBanned: true }, [], ['users.view'])).not.toBeNull();
    expect(staffAssignmentError('admin', superAdmin, { id: 'other', isBanned: true }, ['users.view'], [])).toBeNull();
  });
  test('non-managers cannot manage otherwise delegable capabilities', () => {
    const access = resolveStaffAccess({}, [role('reader', ['users.view'])]);
    expect(staffRoleMutationError('reader', access, [], ['users.view'])).not.toBeNull();
    expect(staffAssignmentError('reader', access, { id: 'other' }, [], ['users.view'])).not.toBeNull();
  });
});

describe('legacy badge authority boundaries', () => {
  test('badge editors cannot grant platform developer/admin or alter legacy staff flags', () => {
    const editor = resolveStaffAccess({}, [role('editor', ['badges.manage'])]);
    for (const badge of ['admin', 'serikacord_developer', 'staff', 'moderator']) {
      expect(privilegedBadgeMutationError('editor', editor, { id: 'other' }, { badges: [badge] })).not.toBeNull();
    }
    expect(privilegedBadgeMutationError('editor', editor, {}, { isStaff: true, staffRole: 'admin' })).not.toBeNull();
    expect(privilegedBadgeMutationError('editor', editor, { badges: ['admin'] }, { badges: [] })).not.toBeNull();
    expect(privilegedBadgeMutationError('editor', editor, { badges: [] }, { badges: ['supporter'] })).toBeNull();
  });
  test('superadmins cannot remove their own last source of legacy access', () => {
    expect(privilegedBadgeMutationError('admin', superAdmin, { id: 'admin', badges: ['serikacord_developer'] }, { badges: [] })).not.toBeNull();
    expect(privilegedBadgeMutationError('admin', superAdmin, { id: 'admin', badges: ['admin'] }, { isStaff: true, staffRole: 'admin', badges: [] })).toBeNull();
    expect(privilegedBadgeMutationError('admin', superAdmin, { id: 'other', badges: ['admin'] }, { badges: [] })).toBeNull();
  });
});

describe('concurrent badge replacements', () => {
  test('a snapshot cannot restore revoked developer access', () => {
    const snapshot = { id: 'target', badges: ['serikacord_developer', 'supporter'], isStaff: false, staffRole: null };
    expect(sameStaffAuthoritySnapshot(snapshot, { ...snapshot })).toBe(true);
    expect(sameStaffAuthoritySnapshot(snapshot, { ...snapshot, badges: ['supporter'] })).toBe(false);
  });
  test('badge, staff flag and role changes each invalidate an in-flight replacement', () => {
    const snapshot = { badges: ['admin', 'staff'], isStaff: true, staffRole: 'admin' };
    expect(sameStaffAuthoritySnapshot(snapshot, { ...snapshot, isStaff: false })).toBe(false);
    expect(sameStaffAuthoritySnapshot(snapshot, { ...snapshot, staffRole: 'moderator' })).toBe(false);
    expect(sameStaffAuthoritySnapshot(snapshot, { ...snapshot, badges: ['admin', 'staff', 'supporter'] })).toBe(false);
    expect(sameStaffAuthoritySnapshot({ badges: null }, { badges: [] })).toBe(false);
  });
  test('freshly revoked acting badge permission cannot authorize a pending edit', () => {
    const before = resolveStaffAccess({}, [role('badges', ['badges.manage'])]);
    const after = resolveStaffAccess({}, []);
    expect(hasStaffPermission(before, 'badges.manage')).toBe(true);
    expect(hasStaffPermission(after, 'badges.manage')).toBe(false);
  });
});

describe('restoring suspended staff', () => {
  const moderator = resolveStaffAccess({}, [role('moderator', ['users.moderate'])]);
  test('delegated moderation can restore ordinary accounts but not dormant staff grants', () => {
    expect(staffUnbanError(moderator, { isBanned: true })).toBeNull();
    expect(staffUnbanError(moderator, { isBanned: true, badges: ['admin'] })).not.toBeNull();
    expect(staffUnbanError(moderator, { isBanned: true, badges: ['serikacord_developer'] })).not.toBeNull();
    expect(staffUnbanError(moderator, { isBanned: true }, [role('staff', ['changelog.publish'])])).not.toBeNull();
    expect(staffUnbanError(moderator, { isBanned: true }, [role('empty-staff', [])])).not.toBeNull();
  });
  test('superadmins can restore staff accounts and ordinary users cannot unban', () => {
    expect(staffUnbanError(superAdmin, { isBanned: true, badges: ['admin'] })).toBeNull();
    expect(staffUnbanError(superAdmin, { isBanned: true }, [role('staff', ['staff.manage'])])).toBeNull();
    expect(staffUnbanError(resolveStaffAccess({}), { isBanned: true })).not.toBeNull();
  });
});

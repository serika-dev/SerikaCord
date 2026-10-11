import { User } from '../models/User';
import { AdminLog } from '../models/AdminLog';
import { StaffRole } from '../models/StaffRole';
import { checkRateLimit } from '../security';
import { hasStaffPermission, resolveStaffAccess, type StaffIdentity, type StaffPermission } from '../staff/permissions';

/** Missing additive tables mean no custom grants; other database errors fail closed. */
export function isMissingStaffTable(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const dbError = error as { code?: string; cause?: unknown };
  return dbError.code === '42P01' || (!!dbError.cause && isMissingStaffTable(dbError.cause));
}

export async function getUserStaffAccess(user: StaffIdentity & { id: string }) {
  try {
    return resolveStaffAccess(user, await StaffRole.rolesForUser(user.id));
  } catch (error) {
    if (isMissingStaffTable(error)) return resolveStaffAccess(user);
    throw error;
  }
}

/** Re-read identity and assignments on every request, never trust cached JWT grants. */
export async function getStaffAuth(
  headers: Record<string, string | undefined>,
  cookie: Record<string, { value?: unknown }>,
  requiredPermission?: StaffPermission,
) {
  const { authenticateRequest } = await import('./auth');
  const token = cookie.auth_token?.value;
  const { user, error } = await authenticateRequest(headers.authorization ?? null,
    typeof token === 'string' ? { auth_token: token } : {});
  if (!user) return { user: null, error: error || 'Unauthorized', isAdmin: false, status: 401 as const };
  const freshUser = await User.findById(user.id);
  if (!freshUser) return { user: null, error: 'User not found', isAdmin: false, status: 401 as const };
  if (freshUser.isBanned) return { user: null, error: 'Account banned', isAdmin: false, status: 403 as const };

  const rateLimit = await checkRateLimit('admin', `admin:${freshUser.id}`);
  if (!rateLimit.success) return { user: null, error: 'Rate limited', isAdmin: false, status: 429 as const };
  const access = await getUserStaffAccess(freshUser);
  if (requiredPermission && !hasStaffPermission(access, requiredPermission)) {
    await AdminLog.create({
      adminId: freshUser.id, action: 'update_settings', targetType: 'platform', targetId: 'admin_panel',
      details: { denied: true, reason: 'insufficient_privileges', requiredPermission },
    }).catch(() => {});
    return { user: null, error: 'Staff permission required', isAdmin: false, status: 403 as const, access };
  }
  return { user: freshUser, error: null, isAdmin: access.permissions.length > 0, status: 200 as const, access };
}

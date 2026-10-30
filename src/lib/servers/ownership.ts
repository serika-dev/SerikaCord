/**
 * Server ownership checks shared by the leave-server API and the UI (CORD-77).
 * Pure and client-safe: no database or drizzle imports.
 */

/** Error the leave endpoint returns when the owner tries to leave. */
export const OWNER_CANNOT_LEAVE_ERROR = 'Server owner cannot leave. Transfer ownership first or delete the server.';

/** Lowercases and turns a legacy 24-hex Mongo id into its UUID form. */
function idKey(id: string): string {
  const trimmed = id.trim().toLowerCase();
  if (/^[0-9a-f]{24}$/.test(trimmed)) {
    const padded = trimmed.padEnd(32, '0');
    return `${padded.slice(0, 8)}-${padded.slice(8, 12)}-${padded.slice(12, 16)}-${padded.slice(16, 20)}-${padded.slice(20)}`;
  }
  return trimmed;
}

/** True when `userId` owns the server (by `ownerId`, or an `isOwner` flag from the API). */
export function isServerOwner(
  server: { ownerId?: string | null; isOwner?: boolean | null } | null | undefined,
  userId: string | null | undefined,
): boolean {
  if (!server) return false;
  if (server.isOwner === true) return true;
  if (!server.ownerId || !userId) return false;
  return idKey(server.ownerId) === idKey(userId);
}

/** Owners can't leave their own server: they must transfer it or delete it. */
export function canLeaveServer(
  server: { ownerId?: string | null; isOwner?: boolean | null } | null | undefined,
  userId: string | null | undefined,
): boolean {
  return !!server && !isServerOwner(server, userId);
}

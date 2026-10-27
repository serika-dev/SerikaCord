/**
 * Invite target users: the users allowed to see and accept an invite
 * (Discord's /invites/{code}/target-users routes, src/lib/api/botApi/social.ts).
 * An invite with no list is open to anyone, as before. Invites that have one
 * carry `metadata.target_users = { count, updated_at }`, so the join path only
 * queries the list for those (isInviteTargetAllowed).
 */
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from '@/lib/db/postgres';
import { ensureSocialParitySchema } from '@/lib/services/socialParitySchema';
import { INVITE_TARGET_LIMITS, targetUsersMarker, withTargetUsersMarker } from '@/lib/botapi/inviteTargets';
import { PERMISSION_BITS as P, hasPermission } from '@/lib/permissions/bits';
import { applyTimeout } from '@/lib/permissions/botChannel';

export type InviteRow = typeof schema.invites.$inferSelect;
const T = schema.inviteTargetUsers;
const lower = (s: string) => s.toLowerCase();

type Denied = { status: number; body: { code: number; message: string } };
const UNKNOWN_INVITE: Denied = { status: 404, body: { code: 10006, message: 'Unknown Invite' } };
const MISSING_PERMISSIONS: Denied = { status: 403, body: { code: 50013, message: 'Missing Permissions' } };

/** A live (not expired, not used up) invite by code, or null. Vanity URLs have no invite row. */
export async function loadLiveInvite(code: string): Promise<InviteRow | null> {
  if (!code || code.length > 64) return null;
  const [inv] = await db.select().from(schema.invites).where(eq(schema.invites.code, code)).limit(1);
  if (!inv) return null;
  if (inv.expiresAt && inv.expiresAt.getTime() <= Date.now()) return null;
  if ((inv.maxUses ?? 0) > 0 && (inv.uses ?? 0) >= (inv.maxUses ?? 0)) return null;
  return inv;
}

/**
 * May `callerId` manage the invite's target users? The inviter, or MANAGE_GUILD
 * (reads also VIEW_AUDIT_LOG), as on Discord. Callers outside the guild get
 * Unknown Invite (they can't tell private invites apart from missing ones).
 */
export async function checkTargetAccess(inv: InviteRow, callerId: string, mode: 'read' | 'write'): Promise<Denied | null> {
  const { ServerMember, Server } = await import('@/lib/models');
  const [member, server] = await Promise.all([
    ServerMember.findOne({ serverId: inv.serverId, userId: callerId }),
    Server.findById(inv.serverId),
  ]);
  const isOwner = !!server && lower(server.ownerId) === lower(callerId);
  if (!member && !isOwner) return UNKNOWN_INVITE;
  if (lower(inv.inviterId) === lower(callerId)) return null;
  const { getMemberChannelPermissions } = await import('@/lib/api/channels');
  const perms = applyTimeout(
    await getMemberChannelPermissions(callerId, { serverId: inv.serverId }, member ?? null),
    member?.communicationDisabledUntil ?? null,
  );
  if (hasPermission(perms, P.MANAGE_SERVER)) return null;
  if (mode === 'read' && hasPermission(perms, P.VIEW_AUDIT_LOG)) return null;
  return MISSING_PERMISSIONS;
}

export async function listTargetUsers(inviteId: string): Promise<string[]> {
  await ensureSocialParitySchema();
  const rows = await db.select({ userId: T.userId }).from(T).where(eq(T.inviteId, inviteId)).orderBy(asc(T.createdAt)).limit(INVITE_TARGET_LIMITS.perInvite);
  return rows.map((r) => lower(r.userId));
}

/** Ids among `ids` that are not users. */
export async function unknownUsers(ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const U = schema.users;
  const rows = await db.select({ id: U.id }).from(U).where(inArray(U.id, ids.map(lower)));
  const found = new Set(rows.map((r) => lower(r.id)));
  return ids.filter((id) => !found.has(lower(id)));
}

/** Recount the list and write the marker on the invite. */
async function refreshMarker(inv: InviteRow): Promise<number> {
  const [{ n } = { n: 0 }] = await db.select({ n: sql<number>`count(*)::int` }).from(T).where(eq(T.inviteId, inv.id));
  const count = Number(n) || 0;
  const [fresh] = await db.select({ metadata: schema.invites.metadata }).from(schema.invites).where(eq(schema.invites.id, inv.id)).limit(1);
  await db.update(schema.invites).set({ metadata: withTargetUsersMarker(fresh?.metadata ?? inv.metadata, count), updatedAt: new Date() })
    .where(eq(schema.invites.id, inv.id));
  return count;
}

export type TargetWrite = { ok: true; count: number } | { ok: false; reason: 'too_many' };

/** Add users (existing entries are kept). */
export async function addTargetUsers(inv: InviteRow, ids: string[]): Promise<TargetWrite> {
  await ensureSocialParitySchema();
  const uniq = [...new Set(ids.map(lower))];
  if (uniq.length > 0) {
    const [{ n } = { n: 0 }] = await db.select({ n: sql<number>`count(*)::int` }).from(T).where(eq(T.inviteId, inv.id));
    const already = await db.select({ userId: T.userId }).from(T).where(and(eq(T.inviteId, inv.id), inArray(T.userId, uniq)));
    if (Number(n) + uniq.length - already.length > INVITE_TARGET_LIMITS.perInvite) return { ok: false, reason: 'too_many' };
    const now = new Date();
    for (let i = 0; i < uniq.length; i += 500) {
      await db.insert(T).values(uniq.slice(i, i + 500).map((userId) => ({ inviteId: inv.id, userId, createdAt: now }))).onConflictDoNothing();
    }
  }
  return { ok: true, count: await refreshMarker(inv) };
}

/** Remove users (missing ones are ignored). */
export async function removeTargetUsers(inv: InviteRow, ids: string[]): Promise<number> {
  await ensureSocialParitySchema();
  const uniq = [...new Set(ids.map(lower))];
  if (uniq.length > 0) await db.delete(T).where(and(eq(T.inviteId, inv.id), inArray(T.userId, uniq)));
  return refreshMarker(inv);
}

/** Replace the whole list (an empty list opens the invite to anyone again). */
export async function replaceTargetUsers(inv: InviteRow, ids: string[]): Promise<TargetWrite> {
  await ensureSocialParitySchema();
  const uniq = [...new Set(ids.map(lower))];
  if (uniq.length > INVITE_TARGET_LIMITS.perInvite) return { ok: false, reason: 'too_many' };
  await db.delete(T).where(eq(T.inviteId, inv.id));
  return addTargetUsers(inv, uniq);
}

/**
 * Whether `userId` may see / accept the invite: always for invites without a
 * target list; otherwise only listed users. Fails closed if the list can't be read.
 */
export async function isInviteTargetAllowed(inv: { id: string; metadata?: unknown }, userId: string): Promise<boolean> {
  if (!targetUsersMarker(inv.metadata)) return true;
  try {
    await ensureSocialParitySchema();
    const [row] = await db.select({ userId: T.userId }).from(T).where(and(eq(T.inviteId, inv.id), eq(T.userId, lower(userId)))).limit(1);
    return !!row;
  } catch {
    return false;
  }
}

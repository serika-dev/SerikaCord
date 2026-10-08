import { eq, and, sql } from 'drizzle-orm';
import { db, schema } from '../db/postgres';
import { User, type BadgeId } from '../models/User';
import { AUTOMATIC_BADGE_IDS } from '../constants/badges';
import { getBadgeRegistry } from './badgeRegistry';

/**
 * Badges that are auto-assigned based on user state (computeAutoBadges below).
 * If the condition no longer holds, the badge is removed. Every other badge is
 * manual — granted from the admin panel (including badges created at runtime
 * in the `badges` table) — and preserved as-is by recalculateUserBadges.
 */
const AUTO_BADGES: ReadonlySet<string> = new Set(AUTOMATIC_BADGE_IDS);

export function isAutomaticBadgeId(id: string): boolean {
  return AUTO_BADGES.has(id);
}

/**
 * Compute which auto-badges a user should have based on their current state.
 * Returns the set of auto-earned badge IDs.
 */
async function computeAutoBadges(userId: string): Promise<BadgeId[]> {
  const earned: BadgeId[] = [];

  // Fetch the user
  const user = await User.findById(userId);
  if (!user) return earned;

  // Staff / Admin / Moderator — based on isStaff flag and staffRole
  if (user.isStaff) {
    if (user.staffRole === 'admin') {
      earned.push('admin');
      earned.push('staff');
    } else if (user.staffRole === 'moderator') {
      earned.push('moderator');
      earned.push('staff');
    } else {
      earned.push('staff');
    }
  }

  // Serika+ — based on isPremium flag
  if (user.isPremium) {
    earned.push('serika_plus');
  }

  // Server Owner — owns at least one server
  const [serverRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.servers)
    .where(eq(schema.servers.ownerId, userId));
  if ((serverRow?.count ?? 0) > 0) {
    earned.push('server_owner');
  }

  // Partner — owns at least one partnered server
  const [partnerRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.servers)
    .where(and(eq(schema.servers.ownerId, userId), eq(schema.servers.isPartnered, true)));
  if ((partnerRow?.count ?? 0) > 0) {
    earned.push('partner');
  }

  // Active Developer — owns at least one application
  const [appRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.applications)
    .where(eq(schema.applications.ownerId, userId));
  if ((appRow?.count ?? 0) > 0) {
    earned.push('active_developer');
  }

  // Verified Bot Developer — owns at least one verified application
  const [verifiedAppRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.applications)
    .where(and(eq(schema.applications.ownerId, userId), eq(schema.applications.verified, true)));
  if ((verifiedAppRow?.count ?? 0) > 0) {
    earned.push('verified_bot_developer');
  }

  return earned;
}

/**
 * Recalculate a user's badges by merging manually-assigned badges with
 * auto-earned badges. Only auto-badges are added/removed; manual badges
 * are preserved exactly as they are.
 *
 * @param userId The user whose badges should be recalculated
 * @returns The new badge array, or null if the user doesn't exist
 */
export async function recalculateUserBadges(userId: string): Promise<BadgeId[] | null> {
  const user = await User.findById(userId);
  if (!user) return null;

  const currentBadges = (user.badges || []) as BadgeId[];
  const autoEarned = await computeAutoBadges(userId);

  // Keep every manual badge that still has a definition. Ids whose definition
  // is gone (e.g. retired badges) are dropped — but only on an authoritative
  // DB read, re-checked fresh so a badge created moments ago on another server
  // process isn't stripped by a stale cache. If the DB read fails we keep them.
  const candidates = currentBadges.filter((b) => !AUTO_BADGES.has(b));
  let registry = await getBadgeRegistry();
  if (registry.authoritative && candidates.some((b) => !registry.byId.has(b))) {
    registry = await getBadgeRegistry({ fresh: true });
  }
  const manualBadges = registry.authoritative
    ? candidates.filter((b) => registry.byId.has(b))
    : candidates;

  // Merge: manual badges + auto-earned (deduplicated)
  const merged = new Set<BadgeId>([...manualBadges, ...autoEarned]);
  const newBadges = Array.from(merged);

  // Only update if badges actually changed
  const currentSet = new Set(currentBadges);
  const newSet = new Set(newBadges);
  const changed =
    currentSet.size !== newSet.size ||
    Array.from(currentSet).some((b) => !newSet.has(b));

  if (changed) {
    await User.updateById(userId, { badges: newBadges });
  }

  return newBadges;
}

/**
 * Recalculate badges for multiple users in one call.
 */
export async function recalculateBadgesForUsers(userIds: string[]): Promise<void> {
  await Promise.all(userIds.map((id) => recalculateUserBadges(id)));
}

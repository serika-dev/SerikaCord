// Built-in badges for SerikaCord.
//
// Badge definitions live in the `badges` database table so staff can create
// and edit them from Settings → Admin → Badge Management without a deploy.
// This file is only:
//   1. the seed the API inserts at boot (INSERT … ON CONFLICT DO NOTHING, so
//      edits made in the admin panel are never overwritten), and
//   2. the offline fallback the client renders when /api/badges is unreachable.
// Changing a value here does NOT update an existing database row.
import type { BadgeDefinition } from '@/lib/badges/shared';

export const BUILTIN_BADGE_IDS = [
  'serikacord_developer',
  'serikacord_contributor',
  'serikacord_tester',
  'staff',
  'admin',
  'moderator',
  'partner',
  'serika_plus',
  'early_supporter',
  'verified_bot_developer',
  'bug_hunter',
  'bug_hunter_gold',
  'server_owner',
  'active_developer',
] as const;

export type BuiltinBadgeId = (typeof BUILTIN_BADGE_IDS)[number];

const BUILTIN_SET: ReadonlySet<string> = new Set(BUILTIN_BADGE_IDS);

/** Built-in badges can be edited or hidden but never deleted (admin auth and
 *  recalculateUserBadges depend on their ids). */
export function isBuiltinBadgeId(id: string): id is BuiltinBadgeId {
  return BUILTIN_SET.has(id);
}

export const DEFAULT_BADGES: readonly (BadgeDefinition & { id: BuiltinBadgeId })[] = [
  // SerikaCord project badges (granted by hand)
  { id: 'serikacord_developer', name: 'SerikaCord Developer', description: 'Core developer of SerikaCord', icon: 'Code', iconUrl: null, color: '#e2b714', priority: 150, automatic: false, hidden: false },
  { id: 'serikacord_contributor', name: 'SerikaCord Contributor', description: 'Contributed to SerikaCord', icon: 'HandHeart', iconUrl: null, color: '#A78BFA', priority: 145, automatic: false, hidden: false },
  { id: 'serikacord_tester', name: 'SerikaCord Tester', description: 'Helped test SerikaCord', icon: 'FlaskConical', iconUrl: null, color: '#23A55A', priority: 140, automatic: false, hidden: false },

  // Staff (synced from users.is_staff / staff_role)
  { id: 'staff', name: 'Serika Staff', description: 'Official Serika staff member', icon: 'ShieldCheck', iconUrl: null, color: '#8B5CF6', priority: 100, automatic: true, hidden: false },
  { id: 'admin', name: 'Administrator', description: 'Platform administrator', icon: 'Shield', iconUrl: null, color: '#EF4444', priority: 99, automatic: true, hidden: false },
  { id: 'moderator', name: 'Moderator', description: 'Platform moderator', icon: 'ShieldHalf', iconUrl: null, color: '#A78BFA', priority: 98, automatic: true, hidden: false },

  // Partner & premium
  { id: 'partner', name: 'Partnered Server Owner', description: 'Owner of a partnered server', icon: 'Handshake', iconUrl: null, color: '#8B5CF6', priority: 90, automatic: true, hidden: false },
  { id: 'serika_plus', name: 'Serika+', description: 'Serika+ subscriber', icon: 'UserStar', iconUrl: null, color: '#F47FFF', priority: 85, automatic: true, hidden: false },
  { id: 'early_supporter', name: 'Early Supporter', description: 'Supported Serika in its early days', icon: 'Heart', iconUrl: null, color: '#A78BFA', priority: 80, automatic: false, hidden: false },

  // Achievements
  { id: 'verified_bot_developer', name: 'Verified Bot Developer', description: 'Developer of a verified bot', icon: 'Bot', iconUrl: null, color: '#8B5CF6', priority: 70, automatic: true, hidden: false },
  { id: 'bug_hunter_gold', name: 'Bug Hunter (Gold)', description: 'Elite bug hunter', icon: 'Bug', iconUrl: null, color: '#FFD700', priority: 66, automatic: false, hidden: false },
  { id: 'bug_hunter', name: 'Bug Hunter', description: 'Found and reported critical bugs', icon: 'Bug', iconUrl: null, color: '#7C3AED', priority: 65, automatic: false, hidden: false },

  // Server & developer
  { id: 'active_developer', name: 'Active Developer', description: 'Active application developer', icon: 'Code', iconUrl: null, color: '#8B5CF6', priority: 55, automatic: true, hidden: false },
  { id: 'server_owner', name: 'Server Owner', description: 'Owns at least one server', icon: 'Crown', iconUrl: null, color: '#FFD700', priority: 50, automatic: true, hidden: false },
];

/** Ids recalculateUserBadges adds/removes from user state. */
export const AUTOMATIC_BADGE_IDS: readonly BuiltinBadgeId[] = DEFAULT_BADGES
  .filter((b) => b.automatic)
  .map((b) => b.id);

/**
 * Official ("Made by SerikaCord") apps in chat and profiles (pure, client-safe).
 *
 * Staff mark an app official with POST /api/admin/apps/:id/official
 * (applications.official). Its bot user then holds the automatic
 * `official_app` badge (src/lib/services/badges.ts recalculateUserBadges),
 * which already travels in every author/member payload, so chat and profile
 * UIs read the flag from `badges` instead of a new field on every message.
 * The bot's users.is_verified is kept in step with "verified or official"
 * (the BOT tag's check).
 */

export const OFFICIAL_APP_BADGE = 'official_app' as const;

export function hasOfficialAppBadge(badges: readonly string[] | null | undefined): boolean {
  return Array.isArray(badges) && badges.includes(OFFICIAL_APP_BADGE);
}

/** Whether a bot's BOT tag shows the verified check. */
export function isVerifiedBotUser(user: { isVerified?: boolean | null; badges?: readonly string[] | null }): boolean {
  return user.isVerified === true || hasOfficialAppBadge(user.badges);
}

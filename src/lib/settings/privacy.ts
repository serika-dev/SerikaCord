/**
 * Privacy gates read from a user's stored settings. `privacy.*` is the source
 * of truth; the legacy `friendRequests.allowEveryone` / `allowServerMembers`
 * keys (written by older desktop settings builds) are honored when explicitly
 * false so those users stay protected.
 */
type SettingsLike = {
  privacy?: { friendRequests?: unknown; directMessages?: unknown } | null;
  friendRequests?: { allowEveryone?: unknown; allowServerMembers?: unknown } | null;
} | null | undefined;

export function acceptsFriendRequests(settings: SettingsLike): boolean {
  if (settings?.privacy?.friendRequests === "none") return false;
  if (settings?.friendRequests?.allowEveryone === false) return false;
  return true;
}

/** Whether people who aren't friends may open a DM with this user. */
export function acceptsDmsFromNonFriends(settings: SettingsLike): boolean {
  // Never-saved settings mean the default, "everyone" (what the UI shows).
  const dm = settings?.privacy?.directMessages;
  if (dm === "friends" || dm === "none") return false;
  if (settings?.friendRequests?.allowServerMembers === false) return false;
  return true;
}

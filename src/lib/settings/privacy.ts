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

type FriendSourceSettings = {
  privacy?: {
    friendRequests?: unknown;
    friendRequestSources?: { everyone?: unknown; friendsOfFriends?: unknown; serverMembers?: unknown } | null;
    messageRequests?: unknown;
  } | null;
  friendRequests?: { allowEveryone?: unknown; allowFriendsOfFriends?: unknown; allowServerMembers?: unknown } | null;
} | null | undefined;

export interface FriendRequestSources {
  everyone: boolean;
  friendsOfFriends: boolean;
  serverMembers: boolean;
}

/**
 * Discord's "Who can send you a friend request": Everyone, Friends of Friends,
 * Server Members. Everyone on implies the other two. Stored as
 * `privacy.friendRequestSources`; absent = everyone (the default).
 */
export function friendRequestSources(settings: FriendSourceSettings): FriendRequestSources {
  const src = settings?.privacy?.friendRequestSources;
  const off = settings?.privacy?.friendRequests === "none";
  if (off) return { everyone: false, friendsOfFriends: false, serverMembers: false };
  if (!src || typeof src !== "object") {
    // Legacy keys: only an explicit `allowEveryone: false` narrowed anything,
    // and it used to mean "nobody" (see acceptsFriendRequests).
    if (settings?.friendRequests?.allowEveryone === false) return { everyone: false, friendsOfFriends: false, serverMembers: false };
    return { everyone: true, friendsOfFriends: true, serverMembers: true };
  }
  const everyone = src.everyone !== false;
  return {
    everyone,
    friendsOfFriends: everyone || src.friendsOfFriends !== false,
    serverMembers: everyone || src.serverMembers !== false,
  };
}

/** Whether `recipient` takes a friend request from someone with these ties to them. */
export function friendRequestAllowedFrom(
  recipientSettings: FriendSourceSettings,
  ties: { mutualFriend: boolean; mutualServer: boolean },
): boolean {
  if (!acceptsFriendRequests(recipientSettings as SettingsLike)) return false;
  const s = friendRequestSources(recipientSettings);
  if (s.everyone) return true;
  if (s.friendsOfFriends && ties.mutualFriend) return true;
  if (s.serverMembers && ties.mutualServer) return true;
  return false;
}

/**
 * Discord's "Enable message requests from server members you may not know":
 * new DMs from non-friends land in Message Requests instead of the DM list.
 * On by default.
 */
export function messageRequestsEnabled(settings: FriendSourceSettings): boolean {
  return settings?.privacy?.messageRequests !== false;
}

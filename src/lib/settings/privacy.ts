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

/**
 * Who may start (and keep writing in) a 1:1 DM with this user, besides
 * friends:
 *  - "everyone": anyone with a SerikaCord account
 *  - "servers":  people who share at least one server with them (minus the
 *                servers listed in `privacy.dmBlockedServerIds`)
 *  - "friends":  friends only (plus members of `privacy.dmAllowedServerIds`)
 * Never-saved settings mean the default, "everyone" (what the UI shows). The
 * legacy `directMessages: "none"` and `friendRequests.allowServerMembers:
 * false` keys mean friends only.
 */
export type DmAudience = "everyone" | "servers" | "friends";

export function dmAudience(settings: unknown): DmAudience {
  const s = settings as SettingsLike;
  const dm = s?.privacy?.directMessages;
  if (dm === "friends" || dm === "none") return "friends";
  if (s?.friendRequests?.allowServerMembers === false) return "friends";
  if (dm === "servers") return "servers";
  return "everyone";
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Cap on each per-server DM override list (more than anyone joins). */
export const MAX_DM_SERVER_OVERRIDES = 500;

function idList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out = new Set<string>();
  for (const v of value) if (typeof v === "string" && UUID_RE.test(v)) out.add(v.toLowerCase());
  return [...out];
}

/**
 * Per-server DM overrides (Discord's per-server "Direct Messages" toggle):
 * `block` servers don't count as a shared server in "servers" mode; `allow`
 * servers let their members DM you even in "friends" mode.
 */
export function dmServerOverrides(settings: unknown): { allow: string[]; block: string[] } {
  const p = (settings as { privacy?: { dmAllowedServerIds?: unknown; dmBlockedServerIds?: unknown } } | null | undefined)?.privacy;
  return { allow: idList(p?.dmAllowedServerIds), block: idList(p?.dmBlockedServerIds) };
}

/**
 * Whether members of `serverId` may DM this user because of that server
 * (what the per-server toggle shows). Always true in "everyone" mode.
 */
export function dmAllowedViaServer(settings: unknown, serverId: string): boolean {
  const audience = dmAudience(settings);
  if (audience === "everyone") return true;
  const id = serverId.toLowerCase();
  const { allow, block } = dmServerOverrides(settings);
  return audience === "servers" ? !block.includes(id) : allow.includes(id);
}

/** Whether deciding a non-friend's DM needs the servers the two share. */
export function dmNeedsSharedServers(settings: unknown): boolean {
  const audience = dmAudience(settings);
  if (audience === "everyone") return false;
  if (audience === "servers") return true;
  return dmServerOverrides(settings).allow.length > 0;
}

/**
 * Whether a non-friend may DM this user. `sharedServerIds` are the servers
 * both are members of; leaving it out when `dmNeedsSharedServers` is true
 * fails closed (no shared server).
 */
export function dmAllowedFromNonFriend(settings: unknown, sharedServerIds?: readonly string[] | null): boolean {
  const audience = dmAudience(settings);
  if (audience === "everyone") return true;
  const shared = (sharedServerIds ?? []).map((id) => String(id).toLowerCase());
  const { allow, block } = dmServerOverrides(settings);
  if (audience === "servers") return shared.some((id) => !block.includes(id));
  return shared.some((id) => allow.includes(id));
}

/**
 * Whether some non-friends may open a DM with this user at all (a quick
 * check; deciding for a specific sender needs `dmAllowedFromNonFriend`).
 */
export function acceptsDmsFromNonFriends(settings: SettingsLike): boolean {
  return dmAudience(settings) !== "friends" || dmServerOverrides(settings).allow.length > 0;
}

/** What the user lets others see of their live activity. */
export interface ActivitySharing {
  /** Master switch (`privacy.showActivity`). */
  enabled: boolean;
  /** Games and apps the desktop app detects, and Rich Presence from apps. */
  games: boolean;
  /** "Now Watching" from a linked serika.moe account. */
  watching: boolean;
  /** "Listening to" from a linked Last.fm account. */
  music: boolean;
}

export function activitySharing(settings: unknown): ActivitySharing {
  const p = (settings as { privacy?: { showActivity?: unknown; activitySharing?: { games?: unknown; watching?: unknown; music?: unknown } | null } } | null | undefined)?.privacy;
  const enabled = p?.showActivity !== false;
  const src = p?.activitySharing && typeof p.activitySharing === "object" ? p.activitySharing : {};
  return {
    enabled,
    games: enabled && src.games !== false,
    watching: enabled && src.watching !== false,
    music: enabled && src.music !== false,
  };
}

/** Invisible users show as offline, so their live activity is hidden too. */
export function activityHiddenByStatus(status: unknown): boolean {
  return status === "invisible";
}

/** Whether others see "<name> is typing…" for this user. Default on. */
export function typingIndicatorsEnabled(settings: unknown): boolean {
  return (settings as { privacy?: { typingIndicators?: unknown } } | null | undefined)?.privacy?.typingIndicators !== false;
}

const PRIVACY_BOOLEAN_KEYS = ["showActivity", "storeActivityHistory", "messageRequests", "typingIndicators", "allowDataCollection"] as const;
const DM_AUDIENCES = new Set(["everyone", "servers", "friends"]);
const FRIEND_REQUEST_MODES = new Set(["everyone", "friends", "none"]);

function booleanMap(value: unknown, keys: readonly string[], field: string): { error: string } | { value: Record<string, boolean> } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { error: `privacy.${field} must be an object` };
  const out: Record<string, boolean> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (!keys.includes(key)) continue;
    if (typeof v !== "boolean") return { error: `privacy.${field}.${key} must be a boolean` };
    out[key] = v;
  }
  return { value: out };
}

/**
 * Validates a `privacy` settings patch (PATCH /api/users/me/settings). Known
 * keys must have the right type; per-server lists must be server ids. Other
 * keys pass through untouched (older clients may still write them).
 */
export function sanitizePrivacyPatch(patch: unknown): { error: string } | { patch: Record<string, unknown> } {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return { error: "privacy must be an object" };
  const out: Record<string, unknown> = { ...(patch as Record<string, unknown>) };
  if (out.directMessages !== undefined && !DM_AUDIENCES.has(out.directMessages as string)) {
    return { error: "privacy.directMessages must be one of 'everyone', 'servers' or 'friends'" };
  }
  if (out.friendRequests !== undefined && !FRIEND_REQUEST_MODES.has(out.friendRequests as string)) {
    return { error: "privacy.friendRequests must be one of 'everyone', 'friends' or 'none'" };
  }
  for (const key of PRIVACY_BOOLEAN_KEYS) {
    if (out[key] !== undefined && typeof out[key] !== "boolean") return { error: `privacy.${key} must be a boolean` };
  }
  if (out.friendRequestSources !== undefined) {
    const r = booleanMap(out.friendRequestSources, ["everyone", "friendsOfFriends", "serverMembers"], "friendRequestSources");
    if ("error" in r) return r;
    out.friendRequestSources = r.value;
  }
  if (out.activitySharing !== undefined) {
    const r = booleanMap(out.activitySharing, ["games", "watching", "music"], "activitySharing");
    if ("error" in r) return r;
    out.activitySharing = r.value;
  }
  for (const key of ["dmAllowedServerIds", "dmBlockedServerIds"] as const) {
    if (out[key] === undefined) continue;
    const raw = out[key];
    if (!Array.isArray(raw) || raw.some((v) => typeof v !== "string" || !UUID_RE.test(v))) {
      return { error: `privacy.${key} must be a list of server ids` };
    }
    const ids = idList(raw);
    if (ids.length > MAX_DM_SERVER_OVERRIDES) return { error: `privacy.${key} can hold at most ${MAX_DM_SERVER_OVERRIDES} servers` };
    out[key] = ids;
  }
  return { patch: out };
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

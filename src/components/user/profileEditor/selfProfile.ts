import {
  resolvedTagOf,
  serverTagPointer,
  type ResolvedServerTag,
  type ServerTagConfig,
} from "@/lib/servers/serverProfile";

/**
 * Pure helpers for editing your own profile from the full profile dialog.
 * Kept free of React so tests/self-profile-editor.test.ts can cover them.
 */

/** Same limits the PUT /api/users/me body schema enforces. */
export const PROFILE_LIMITS = {
  displayName: 32,
  nickname: 32,
  pronouns: 32,
  customStatus: 128,
  bio: 1000,
} as const;

export type InlineField = keyof typeof PROFILE_LIMITS;

/**
 * Clean an inline edit before saving: single-line fields collapse to one
 * trimmed line; the bio keeps its inner newlines but loses trailing space.
 * Always clamped to the field's limit.
 */
export function normalizeInlineValue(field: InlineField, raw: string): string {
  const limit = PROFILE_LIMITS[field];
  const value = field === "bio"
    ? raw.replace(/\r\n?/g, "\n").replace(/\s+$/, "")
    : raw.replace(/[\r\n]+/g, " ").trim();
  return Array.from(value).slice(0, limit).join("");
}

/** A server from the viewer's own server list, as far as tags are concerned. */
export interface TaggedServerLike {
  id: string;
  name: string;
  icon?: string | null;
  serverTag?: ServerTagConfig | null;
}

/** The resolved tag a server would give you, or null when it has none enabled. */
export function tagFromServer(server: TaggedServerLike): ResolvedServerTag | null {
  const st = server.serverTag;
  if (!st?.enabled || !st.tag) return null;
  return {
    serverId: server.id,
    serverName: server.name,
    tag: st.tag,
    icon: st.icon,
    color: st.color,
    emoji: st.emoji ?? null,
    emojiUrl: st.emojiUrl ?? null,
  };
}

/** Servers with a tag turned on, filtered by a case-insensitive name/tag query. */
export function filterTaggedServers<T extends TaggedServerLike>(servers: readonly T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  return servers.filter((s) => {
    if (!s.serverTag?.enabled || !s.serverTag.tag) return false;
    if (!q) return true;
    return s.name.toLowerCase().includes(q) || s.serverTag.tag.toLowerCase().includes(q);
  });
}

/** The profile fields the signed-in user can change from the dialog. */
export interface SelfProfileSource {
  displayName?: string | null;
  avatar?: string | null;
  banner?: string | null;
  bio?: string | null;
  pronouns?: string | null;
  customStatus?: string | null;
  customization?: Record<string, unknown> | null;
}

/**
 * The tag to show for yourself. Your own (auth) customization only stores a
 * pointer (`{ serverId }`) or, after picking one here, the resolved tag; the
 * profile payload carries the resolved tag. The pointer decides which server,
 * and the resolved data comes from whichever source has it.
 */
export function resolveSelfTag(
  authCustomization: unknown,
  profileCustomization: unknown,
  servers: readonly TaggedServerLike[] = [],
): ResolvedServerTag | null {
  const pointer = serverTagPointer(authCustomization);
  if (!pointer) return null;
  const own = resolvedTagOf(authCustomization);
  if (own && own.serverId === pointer) return own;
  const shown = resolvedTagOf(profileCustomization);
  if (shown && shown.serverId === pointer) return shown;
  const server = servers.find((s) => s.id === pointer);
  return server ? tagFromServer(server) : null;
}

/**
 * Overlay the signed-in user's live (AuthContext) profile onto the fetched
 * profile so edits made here, in settings or in the status dialog show up
 * immediately. Fields the auth user doesn't carry keep the fetched value.
 */
export function overlaySelfProfile<T extends SelfProfileSource>(
  profile: T,
  self: SelfProfileSource,
  servers: readonly TaggedServerLike[] = [],
): T {
  const out = { ...profile } as T & Record<string, unknown>;
  const keys = ["displayName", "avatar", "banner", "bio", "pronouns", "customStatus"] as const;
  for (const key of keys) {
    if (self[key] !== undefined) (out as Record<string, unknown>)[key] = self[key];
  }
  if (self.customization) {
    const merged: Record<string, unknown> = { ...(profile.customization || {}), ...self.customization };
    const tag = resolveSelfTag(self.customization, profile.customization, servers);
    if (tag) merged.serverTag = tag;
    else delete merged.serverTag;
    out.customization = merged;
  }
  return out;
}

/**
 * Apply a profile patch to a local user object the way the server will:
 * customization is merged key by key, and clearing the status text also
 * clears its emoji and expiry.
 */
export function applyProfilePatch<T extends SelfProfileSource>(
  user: T,
  patch: { displayName?: string; bio?: string; pronouns?: string; customStatus?: string; customization?: Record<string, unknown> },
): T {
  const next = { ...user } as T;
  if (patch.displayName !== undefined) next.displayName = patch.displayName;
  if (patch.bio !== undefined) next.bio = patch.bio;
  if (patch.pronouns !== undefined) next.pronouns = patch.pronouns;
  let customization = patch.customization
    ? { ...(user.customization || {}), ...patch.customization }
    : user.customization;
  if (patch.customStatus !== undefined) {
    next.customStatus = patch.customStatus;
    if (!patch.customStatus.trim()) {
      customization = { ...(customization || {}), customStatusEmoji: null, customStatusExpiresAt: null };
    }
  }
  if (customization !== user.customization) next.customization = customization;
  return next;
}

const EDITOR_OPEN_KEY = "serika:profileEditorOpen";

/** Whether the editor panel was left open (per browser); false when unreadable. */
export function readEditorOpen(): boolean {
  try {
    return window.localStorage.getItem(EDITOR_OPEN_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeEditorOpen(open: boolean): void {
  try {
    window.localStorage.setItem(EDITOR_OPEN_KEY, open ? "1" : "0");
  } catch {
    // storage blocked (private window etc.): the panel just starts closed
  }
}

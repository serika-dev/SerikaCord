// Per-user voice preferences that only affect what *you* hear, like Discord's
// "User Volume" slider and local "Mute" in a voice user's right-click menu.
// Saved in this browser (localStorage) and shared by every tab via the
// `storage` event; nobody else is told.

export const USER_VOLUME_MIN = 0;
export const USER_VOLUME_MAX = 200;
export const USER_VOLUME_DEFAULT = 100;

export interface UserVoicePref {
  /** 0..200 percent; 100 is unchanged. */
  volume: number;
  /** Locally muted: you don't hear them at all. */
  muted: boolean;
}

export type UserVoicePrefs = Record<string, UserVoicePref>;

export const USER_VOICE_PREFS_KEY = "serika-voice-user-prefs";

export function clampUserVolume(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return USER_VOLUME_DEFAULT;
  return Math.min(Math.max(Math.round(value), USER_VOLUME_MIN), USER_VOLUME_MAX);
}

const keyOf = (userId: string) => userId.toLowerCase();

/** Parse the stored map, dropping anything malformed or default. */
export function parseUserVoicePrefs(raw: string | null | undefined): UserVoicePrefs {
  if (!raw) return {};
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return {};
  const out: UserVoicePrefs = {};
  for (const [id, value] of Object.entries(data as Record<string, unknown>)) {
    if (!id || !value || typeof value !== "object") continue;
    const v = value as Record<string, unknown>;
    const pref = { volume: clampUserVolume(v.volume), muted: v.muted === true };
    if (pref.volume !== USER_VOLUME_DEFAULT || pref.muted) out[keyOf(id)] = pref;
  }
  return out;
}

export function getUserVoicePref(prefs: UserVoicePrefs, userId: string): UserVoicePref {
  return prefs[keyOf(userId)] ?? { volume: USER_VOLUME_DEFAULT, muted: false };
}

/** A copy of `prefs` with one user's preference changed (defaults are removed). */
export function withUserVoicePref(prefs: UserVoicePrefs, userId: string, patch: Partial<UserVoicePref>): UserVoicePrefs {
  const current = getUserVoicePref(prefs, userId);
  const next: UserVoicePref = {
    volume: patch.volume !== undefined ? clampUserVolume(patch.volume) : current.volume,
    muted: patch.muted !== undefined ? patch.muted : current.muted,
  };
  const out = { ...prefs };
  if (next.volume === USER_VOLUME_DEFAULT && !next.muted) delete out[keyOf(userId)];
  else out[keyOf(userId)] = next;
  return out;
}

/**
 * The playback level for one remote voice: your Output Volume times their
 * User Volume, or silence when they're locally or server muted.
 */
export function effectivePlaybackPercent(outputPercent: number, pref: UserVoicePref, serverMuted = false): number {
  if (pref.muted || serverMuted) return 0;
  const output = Math.min(Math.max(Number.isFinite(outputPercent) ? outputPercent : 100, 0), 200);
  return Math.round((output * clampUserVolume(pref.volume)) / 100);
}

// ── Browser store ───────────────────────────────────────────────────────────

let cache: UserVoicePrefs | null = null;
const listeners = new Set<() => void>();
let storageHooked = false;

function load(): UserVoicePrefs {
  if (cache) return cache;
  let raw: string | null = null;
  try {
    raw = typeof localStorage !== "undefined" ? localStorage.getItem(USER_VOICE_PREFS_KEY) : null;
  } catch {
    raw = null;
  }
  cache = parseUserVoicePrefs(raw);
  return cache;
}

function hookStorage() {
  if (storageHooked || typeof window === "undefined") return;
  storageHooked = true;
  window.addEventListener("storage", (e) => {
    if (e.key !== USER_VOICE_PREFS_KEY) return;
    cache = parseUserVoicePrefs(e.newValue);
    listeners.forEach((fn) => fn());
  });
}

/** Current preferences (stable object until something changes). */
export function getUserVoicePrefs(): UserVoicePrefs {
  return load();
}

const EMPTY: UserVoicePrefs = {};
export function getServerUserVoicePrefs(): UserVoicePrefs {
  return EMPTY;
}

export function subscribeUserVoicePrefs(fn: () => void): () => void {
  hookStorage();
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function setUserVoicePref(userId: string, patch: Partial<UserVoicePref>) {
  cache = withUserVoicePref(load(), userId, patch);
  try {
    localStorage.setItem(USER_VOICE_PREFS_KEY, JSON.stringify(cache));
  } catch {
    // storage blocked: still applies for this session
  }
  listeners.forEach((fn) => fn());
}

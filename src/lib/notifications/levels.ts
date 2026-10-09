/**
 * Per-server / per-channel notification settings (Discord-style), as pure
 * logic shared by the API (sanitizing what a client sends) and the client
 * (deciding whether a message badges, glows, chimes or pops a notification).
 *
 * Stored per user as one JSON document in `user_notification_settings`:
 *   { servers: { [serverId]: Override }, channels: { [channelId]: Override } }
 * Channel overrides cover text channels, categories, threads and DMs; a
 * channel without its own level inherits from its parent (category / forum),
 * then from the server, then from the server's default.
 */

export type NotificationLevel = "all" | "mentions" | "nothing";

/** `muteUntil` value meaning "until I turn it back on". */
export const MUTE_FOREVER = -1;

/** Mute durations offered in menus, in minutes (null = until turned back on). */
export const MUTE_DURATIONS: ReadonlyArray<{ key: string; minutes: number | null }> = [
  { key: "15m", minutes: 15 },
  { key: "1h", minutes: 60 },
  { key: "8h", minutes: 8 * 60 },
  { key: "24h", minutes: 24 * 60 },
  { key: "forever", minutes: null },
];

export interface NotificationOverride {
  /** Unset = inherit. */
  level?: NotificationLevel;
  /** Epoch ms the mute ends, MUTE_FOREVER, or unset/0 for not muted. */
  muteUntil?: number;
  /** Servers only: ignore @everyone / @here. */
  suppressEveryone?: boolean;
  /** Servers only: ignore role mentions. */
  suppressRoles?: boolean;
}

export interface NotificationSettingsDoc {
  servers: Record<string, NotificationOverride>;
  channels: Record<string, NotificationOverride>;
}

export type NotificationScope = "server" | "channel";

export const EMPTY_NOTIFICATION_SETTINGS: NotificationSettingsDoc = Object.freeze({
  servers: {},
  channels: {},
}) as NotificationSettingsDoc;

const LEVELS = new Set<NotificationLevel>(["all", "mentions", "nothing"]);
const ID_RE = /^[0-9a-zA-Z_-]{1,64}$/;
/** Hard cap on stored entries per scope, so the row can't grow unbounded. */
export const MAX_OVERRIDES_PER_SCOPE = 2000;

export function isNotificationLevel(v: unknown): v is NotificationLevel {
  return typeof v === "string" && LEVELS.has(v as NotificationLevel);
}

/** Map a server's `default_notifications` column to a level. */
export function serverDefaultLevel(value: string | null | undefined): NotificationLevel {
  if (value === "all_messages" || value === "all") return "all";
  if (value === "nothing" || value === "none") return "nothing";
  return "mentions";
}

/** Clean one override; returns null when it carries nothing worth storing. */
export function sanitizeOverride(input: unknown, now = Date.now()): NotificationOverride | null {
  if (!input || typeof input !== "object") return null;
  const src = input as Record<string, unknown>;
  const out: NotificationOverride = {};
  if (isNotificationLevel(src.level)) out.level = src.level;
  if (typeof src.muteUntil === "number" && Number.isFinite(src.muteUntil)) {
    if (src.muteUntil === MUTE_FOREVER) out.muteUntil = MUTE_FOREVER;
    // Expired mutes are dropped instead of stored.
    else if (src.muteUntil > now) out.muteUntil = Math.floor(src.muteUntil);
  }
  if (src.suppressEveryone === true) out.suppressEveryone = true;
  if (src.suppressRoles === true) out.suppressRoles = true;
  return Object.keys(out).length > 0 ? out : null;
}

/** Clean a whole document (unknown keys and bad ids dropped, expired mutes pruned). */
export function sanitizeSettingsDoc(input: unknown, now = Date.now()): NotificationSettingsDoc {
  const doc: NotificationSettingsDoc = { servers: {}, channels: {} };
  if (!input || typeof input !== "object") return doc;
  const src = input as Record<string, unknown>;
  for (const scope of ["servers", "channels"] as const) {
    const map = src[scope];
    if (!map || typeof map !== "object") continue;
    let n = 0;
    for (const [id, value] of Object.entries(map as Record<string, unknown>)) {
      if (n >= MAX_OVERRIDES_PER_SCOPE) break;
      if (!ID_RE.test(id)) continue;
      const clean = sanitizeOverride(value, now);
      if (clean) {
        doc[scope][id] = clean;
        n += 1;
      }
    }
  }
  return doc;
}

/**
 * Apply a patch to one scope entry. `patch === null` clears the entry; fields
 * set to `null` inside the patch reset that field to "inherit"/off.
 */
export function applyOverridePatch(
  doc: NotificationSettingsDoc,
  scope: NotificationScope,
  id: string,
  patch: Record<string, unknown> | null,
  now = Date.now(),
): NotificationSettingsDoc {
  const key = scope === "server" ? "servers" : "channels";
  const next: NotificationSettingsDoc = {
    servers: { ...doc.servers },
    channels: { ...doc.channels },
  };
  if (patch === null) {
    delete next[key][id];
    return next;
  }
  const merged: Record<string, unknown> = { ...(doc[key][id] ?? {}) };
  for (const [field, value] of Object.entries(patch)) {
    if (value === null || value === undefined) delete merged[field];
    else merged[field] = value;
  }
  if (scope === "channel") {
    // Suppression is a server-level switch.
    delete merged.suppressEveryone;
    delete merged.suppressRoles;
  }
  const clean = sanitizeOverride(merged, now);
  if (clean) next[key][id] = clean;
  else delete next[key][id];
  return next;
}

export function isMuteActive(o: NotificationOverride | undefined | null, now = Date.now()): boolean {
  if (!o || !o.muteUntil) return false;
  return o.muteUntil === MUTE_FOREVER || o.muteUntil > now;
}

/** Epoch ms for a mute of `minutes` from now (null = until turned back on). */
export function muteUntilFor(minutes: number | null, now = Date.now()): number {
  return minutes === null ? MUTE_FOREVER : now + minutes * 60_000;
}

export interface ResolveInput {
  doc: NotificationSettingsDoc;
  /** Undefined for DMs. */
  serverId?: string | null;
  /** Defaults to "no serverId". A server channel whose server isn't known yet passes false. */
  isDM?: boolean;
  channelId: string;
  /** Parent chain, nearest first (category / forum, then its category). */
  ancestorIds?: Array<string | null | undefined>;
  /** The server's `default_notifications`. */
  serverDefault?: NotificationLevel;
  /** The user's global "notify on all messages" switch. */
  globalAllMessages?: boolean;
  now?: number;
}

export interface ResolvedNotification {
  level: NotificationLevel;
  /** This channel (or a parent) is muted. */
  channelMuted: boolean;
  /** The whole server is muted. */
  serverMuted: boolean;
  muted: boolean;
  suppressEveryone: boolean;
  suppressRoles: boolean;
}

/** Effective settings for one conversation. */
export function resolveNotification(input: ResolveInput): ResolvedNotification {
  const now = input.now ?? Date.now();
  const { doc } = input;
  const chain = [input.channelId, ...(input.ancestorIds ?? [])].filter(
    (id): id is string => typeof id === "string" && id.length > 0,
  );
  const server = input.serverId ? doc.servers[input.serverId] : undefined;

  let level: NotificationLevel | undefined;
  let channelMuted = false;
  for (const id of chain) {
    const o = doc.channels[id];
    if (!o) continue;
    if (!level && o.level) level = o.level;
    if (isMuteActive(o, now)) channelMuted = true;
  }
  if (!level) {
    if (input.isDM ?? !input.serverId) level = "all"; // DMs: every message notifies
    else if (server?.level) level = server.level;
    else if (input.globalAllMessages) level = "all";
    else level = input.serverDefault ?? "mentions";
  }
  const serverMuted = isMuteActive(server, now);
  return {
    level,
    channelMuted,
    serverMuted,
    muted: channelMuted || serverMuted,
    suppressEveryone: server?.suppressEveryone === true,
    suppressRoles: server?.suppressRoles === true,
  };
}

export interface MessageAlertInput {
  resolved: ResolvedNotification;
  isDM: boolean;
  mentionedDirectly: boolean;
  mentionedEveryone: boolean;
  mentionedRole: boolean;
}

export interface MessageAlert {
  /** Counts toward the red mention badge. */
  mention: boolean;
  /** Sound / desktop notification / toast may fire (global switches still apply). */
  notify: boolean;
  /** Shows the white unread glow. Muted conversations are dimmed instead. */
  glow: boolean;
}

/**
 * What a message from someone else does, given the effective settings.
 * Muting silences alerts and the glow but keeps mention badges (Discord
 * parity); "Nothing" drops both alerts and badges.
 */
export function decideMessageAlert(input: MessageAlertInput): MessageAlert {
  const { resolved } = input;
  const glow = !resolved.muted;
  if (input.isDM) {
    return { mention: true, notify: !resolved.muted && resolved.level !== "nothing", glow };
  }
  const pinged =
    input.mentionedDirectly ||
    (input.mentionedEveryone && !resolved.suppressEveryone) ||
    (input.mentionedRole && !resolved.suppressRoles);
  const mention = pinged && resolved.level !== "nothing";
  const notify =
    !resolved.muted &&
    (resolved.level === "all" || (resolved.level === "mentions" && pinged));
  return { mention, notify, glow };
}

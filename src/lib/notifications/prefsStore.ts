"use client";

/**
 * Client store for the user's per-server / per-channel notification settings
 * (server-side, synced across devices). Synchronous reads for the notification
 * path (evaluateNotification, unread glow), a hook for UI, optimistic writes.
 */

import { useSyncExternalStore } from "react";
import {
  EMPTY_NOTIFICATION_SETTINGS,
  MUTE_FOREVER,
  applyOverridePatch,
  decideMessageAlert,
  isMuteActive,
  resolveNotification,
  sanitizeSettingsDoc,
  type NotificationLevel,
  type NotificationOverride,
  type NotificationScope,
  type NotificationSettingsDoc,
  type ResolvedNotification,
} from "./levels";

export interface NotificationPrefsSnapshot {
  doc: NotificationSettingsDoc;
  serverDefaults: Record<string, NotificationLevel>;
  loaded: boolean;
  /** Bumps on every change, including a mute running out. */
  version: number;
}

const CACHE_KEY = "sc:notif:prefs";
const LEGACY_MIGRATED_KEY = "sc:notif:legacy-migrated";

function readCache(): Pick<NotificationPrefsSnapshot, "doc" | "serverDefaults"> {
  if (typeof localStorage === "undefined") return { doc: EMPTY_NOTIFICATION_SETTINGS, serverDefaults: {} };
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return { doc: EMPTY_NOTIFICATION_SETTINGS, serverDefaults: {} };
    const parsed = JSON.parse(raw) as { doc?: unknown; serverDefaults?: Record<string, NotificationLevel> };
    return { doc: sanitizeSettingsDoc(parsed.doc), serverDefaults: parsed.serverDefaults ?? {} };
  } catch {
    return { doc: EMPTY_NOTIFICATION_SETTINGS, serverDefaults: {} };
  }
}

let snapshot: NotificationPrefsSnapshot = { ...readCache(), loaded: false, version: 0 };
const listeners = new Set<() => void>();
let expiryTimer: ReturnType<typeof setTimeout> | null = null;

function writeCache() {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ doc: snapshot.doc, serverDefaults: snapshot.serverDefaults }));
  } catch {
    /* quota */
  }
}

/** Re-render when the next timed mute runs out, so the glow/badge come back. */
function scheduleExpiry() {
  if (typeof window === "undefined") return;
  if (expiryTimer) clearTimeout(expiryTimer);
  expiryTimer = null;
  const now = Date.now();
  let next = Infinity;
  for (const scope of [snapshot.doc.servers, snapshot.doc.channels]) {
    for (const o of Object.values(scope)) {
      if (o.muteUntil && o.muteUntil !== MUTE_FOREVER && o.muteUntil > now) next = Math.min(next, o.muteUntil);
    }
  }
  if (next === Infinity) return;
  // setTimeout caps at ~24.8 days; re-arm in steps.
  const delay = Math.min(next - now + 50, 2 ** 31 - 1);
  expiryTimer = setTimeout(() => {
    snapshot = { ...snapshot, version: snapshot.version + 1 };
    emit();
    scheduleExpiry();
  }, delay);
}

function emit() {
  listeners.forEach((fn) => fn());
}

function setSnapshot(next: Partial<NotificationPrefsSnapshot>) {
  snapshot = { ...snapshot, ...next, version: snapshot.version + 1 };
  writeCache();
  scheduleExpiry();
  emit();
}

export function getNotificationPrefs(): NotificationPrefsSnapshot {
  return snapshot;
}

export function subscribeNotificationPrefs(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

const SERVER_SNAPSHOT: NotificationPrefsSnapshot = {
  doc: EMPTY_NOTIFICATION_SETTINGS,
  serverDefaults: {},
  loaded: false,
  version: 0,
};

/** Reactive snapshot for components. */
export function useNotificationPrefs(): NotificationPrefsSnapshot {
  return useSyncExternalStore(subscribeNotificationPrefs, getNotificationPrefs, () => SERVER_SNAPSHOT);
}

let loading: Promise<void> | null = null;

/** Fetch the authoritative settings (once per call; dedupes concurrent loads). */
export function loadNotificationPrefs(): Promise<void> {
  if (loading) return loading;
  loading = (async () => {
    try {
      const res = await fetch("/api/users/@me/notification-settings", { credentials: "include" });
      if (!res.ok) return;
      const data = (await res.json()) as { settings?: unknown; serverDefaults?: Record<string, NotificationLevel> };
      setSnapshot({
        doc: sanitizeSettingsDoc(data.settings),
        serverDefaults: data.serverDefaults ?? {},
        loaded: true,
      });
      void migrateLegacyMutes();
    } catch {
      /* keep the cached copy */
    } finally {
      loading = null;
    }
  })();
  return loading;
}

/** Another device changed the settings (activity stream event). */
export function applyRemoteNotificationSettings(settings: unknown) {
  setSnapshot({ doc: sanitizeSettingsDoc(settings), loaded: true });
}

/**
 * Change one server or channel entry. `patch === null` resets it to defaults;
 * a field set to null resets that field.
 */
export async function updateNotificationOverride(
  scope: NotificationScope,
  id: string,
  patch: { [K in keyof NotificationOverride]?: NotificationOverride[K] | null } | null,
): Promise<boolean> {
  const before = snapshot.doc;
  setSnapshot({ doc: applyOverridePatch(before, scope, id, patch as Record<string, unknown> | null) });
  try {
    const res = await fetch("/api/users/@me/notification-settings", {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope, id, settings: patch }),
    });
    if (!res.ok) throw new Error(String(res.status));
    const data = (await res.json()) as { settings?: unknown };
    if (data.settings) setSnapshot({ doc: sanitizeSettingsDoc(data.settings) });
    return true;
  } catch {
    setSnapshot({ doc: before });
    return false;
  }
}

/** Effective settings for a conversation, from the current snapshot. */
export function resolveConversation(opts: {
  serverId?: string | null;
  channelId: string;
  ancestorIds?: Array<string | null | undefined>;
  globalAllMessages?: boolean;
  isDM?: boolean;
}): ResolvedNotification {
  return resolveNotification({
    doc: snapshot.doc,
    serverId: opts.serverId,
    isDM: opts.isDM,
    channelId: opts.channelId,
    ancestorIds: opts.ancestorIds,
    serverDefault: opts.serverId ? snapshot.serverDefaults[opts.serverId] : undefined,
    globalAllMessages: opts.globalAllMessages,
  });
}

/**
 * Whether a past mention still counts (badge / Inbox) under the current
 * settings: "Nothing" and @everyone / role suppression drop it.
 */
export function isMentionCounted(opts: {
  serverId?: string | null;
  channelId: string;
  ancestorIds?: Array<string | null | undefined>;
  kind?: "user" | "role" | "everyone";
  muteEveryoneGlobally?: boolean;
}): boolean {
  const resolved = resolveConversation(opts);
  return decideMessageAlert({
    resolved: { ...resolved, suppressEveryone: resolved.suppressEveryone || opts.muteEveryoneGlobally === true },
    isDM: !opts.serverId,
    mentionedDirectly: !opts.kind || opts.kind === "user",
    mentionedRole: opts.kind === "role",
    mentionedEveryone: opts.kind === "everyone",
  }).mention;
}

export function isServerMutedNow(serverId: string): boolean {
  return isMuteActive(snapshot.doc.servers[serverId]);
}

export function isChannelMutedNow(channelId: string): boolean {
  return isMuteActive(snapshot.doc.channels[channelId]);
}

// ── One-time migration of the old device-local mutes ──────────────────────
// Channel mutes used `channel-muted:<id>` = "1" and server mutes the
// `server-mutes` JSON list in localStorage. Carry them over once so nobody's
// muted channels suddenly start pinging.
async function migrateLegacyMutes() {
  if (typeof localStorage === "undefined") return;
  try {
    if (localStorage.getItem(LEGACY_MIGRATED_KEY) === "1") return;
    const channelIds: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith("channel-muted:") && localStorage.getItem(key) === "1") {
        channelIds.push(key.slice("channel-muted:".length));
      }
    }
    let serverIds: string[] = [];
    try {
      serverIds = JSON.parse(localStorage.getItem("server-mutes") || "[]") as string[];
    } catch {
      serverIds = [];
    }
    for (const id of channelIds) {
      if (!snapshot.doc.channels[id]?.muteUntil) await updateNotificationOverride("channel", id, { muteUntil: MUTE_FOREVER });
    }
    for (const id of serverIds) {
      if (typeof id === "string" && !snapshot.doc.servers[id]?.muteUntil) {
        await updateNotificationOverride("server", id, { muteUntil: MUTE_FOREVER });
      }
    }
    localStorage.setItem(LEGACY_MIGRATED_KEY, "1");
  } catch {
    /* retried next load */
  }
}

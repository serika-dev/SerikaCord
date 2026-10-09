"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";

export interface MentionData {
  id: string;
  /** How you were pinged (direct, a role you hold, or @everyone/@here). */
  kind?: "user" | "role" | "everyone";
  content: string;
  channelId: string;
  channelName: string;
  serverId: string;
  createdAt: string;
  author: {
    id: string;
    username: string;
    displayName: string;
    avatar?: string;
  } | null;
}

interface MentionApiResponse {
  servers: { id: string }[];
  mentions: MentionData[];
}

const READ_KEY_PREFIX = "mention-read:";
const POLL_INTERVAL = 30_000;

function getChannelReadTimestamp(channelId: string): number {
  if (typeof localStorage === "undefined") return 0;
  const raw = localStorage.getItem(`${READ_KEY_PREFIX}${channelId}`);
  return raw ? parseInt(raw, 10) : 0;
}

function setChannelReadTimestamp(channelId: string, ts: number) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(`${READ_KEY_PREFIX}${channelId}`, String(ts));
}

// ── Shared store ─────────────────────────────────────────────────────────
// ChatArea and ServerSidebar both use this hook; one module-level store per
// URL runs a single poll for all of them (it used to be one poll per hook
// instance, doubling an expensive endpoint) and shares read-marker changes so
// a channel marked read in one place clears the badge everywhere.

interface MentionState {
  mentions: MentionData[];
  loading: boolean;
  error: string | null;
}

interface MentionEntry {
  state: MentionState;
  sig: string;
  listeners: Set<() => void>;
  timer: ReturnType<typeof setInterval> | null;
  lastFetch: number;
  inflight: Promise<void> | null;
  detach: (() => void) | null;
}

const EMPTY_STATE: MentionState = { mentions: [], loading: true, error: null };
const entries = new Map<string, MentionEntry>();
let readVersionGlobal = 0;
const readListeners = new Set<() => void>();

function bumpReadVersion() {
  readVersionGlobal += 1;
  readListeners.forEach((fn) => fn());
}

/**
 * The unread engine read a channel (here or on another device): drop its
 * mentions from the inbox / server-rail counts. `ts` is the read time in ms.
 */
export function markMentionsReadLocal(channelId: string, ts = Date.now()) {
  if (getChannelReadTimestamp(channelId) >= ts) return;
  setChannelReadTimestamp(channelId, ts);
  bumpReadVersion();
}

/** Mention list refresh (e.g. a new ping arrived over the activity stream). */
export function refreshMentionsNow() {
  for (const [url, e] of entries) {
    if (e.listeners.size > 0) void fetchEntry(url);
  }
}

function getEntry(url: string): MentionEntry {
  let e = entries.get(url);
  if (!e) {
    e = { state: EMPTY_STATE, sig: "", listeners: new Set(), timer: null, lastFetch: 0, inflight: null, detach: null };
    entries.set(url, e);
  }
  return e;
}

function setEntryState(e: MentionEntry, next: Partial<MentionState>) {
  const merged = { ...e.state, ...next };
  if (
    merged.mentions === e.state.mentions &&
    merged.loading === e.state.loading &&
    merged.error === e.state.error
  ) return;
  e.state = merged;
  e.listeners.forEach((fn) => fn());
}

function fetchEntry(url: string): Promise<void> {
  const e = getEntry(url);
  if (e.inflight) return e.inflight;
  e.lastFetch = Date.now();
  e.inflight = (async () => {
    try {
      const res = await fetch(url);
      if (!res.ok) {
        setEntryState(e, { error: "Failed to fetch mentions", loading: false });
        return;
      }
      const data: MentionApiResponse = await res.json();
      const list = data.mentions || [];
      const sig = `${list.length}:${list.map((m) => m.id).join(",")}`;
      if (sig !== e.sig) {
        e.sig = sig;
        setEntryState(e, { mentions: list, error: null, loading: false });
      } else {
        setEntryState(e, { error: null, loading: false });
      }
    } catch {
      setEntryState(e, { error: "Failed to fetch mentions", loading: false });
    } finally {
      e.inflight = null;
    }
  })();
  return e.inflight;
}

function attachPoll(url: string, e: MentionEntry) {
  const start = () => {
    if (e.timer) clearInterval(e.timer);
    e.timer = setInterval(() => void fetchEntry(url), POLL_INTERVAL);
  };
  const stop = () => {
    if (e.timer) {
      clearInterval(e.timer);
      e.timer = null;
    }
  };
  const onVisibility = () => {
    if (document.visibilityState !== "visible") {
      stop();
      return;
    }
    // visibilitychange + focus both fire on tab return: fetch once.
    if (Date.now() - e.lastFetch >= 1000) void fetchEntry(url);
    if (!e.timer) start();
  };
  const onFocus = () => {
    if (!e.timer) onVisibility();
  };
  void fetchEntry(url);
  if (document.visibilityState === "visible") start();
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("focus", onFocus);
  e.detach = () => {
    stop();
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("focus", onFocus);
  };
}

function subscribeEntry(url: string, listener: () => void): () => void {
  const e = getEntry(url);
  e.listeners.add(listener);
  if (e.listeners.size === 1 && !e.detach) attachPoll(url, e);
  return () => {
    e.listeners.delete(listener);
    if (e.listeners.size === 0 && e.detach) {
      e.detach();
      e.detach = null;
    }
  };
}

function subscribeRead(listener: () => void): () => void {
  readListeners.add(listener);
  return () => {
    readListeners.delete(listener);
  };
}

export function useMentions(serverId?: string) {
  const url = serverId
    ? `/api/users/@me/mentions?serverId=${encodeURIComponent(serverId)}`
    : "/api/users/@me/mentions";
  const subscribe = useCallback((fn: () => void) => subscribeEntry(url, fn), [url]);
  const { mentions, loading, error } = useSyncExternalStore(
    subscribe,
    () => getEntry(url).state,
    () => EMPTY_STATE
  );
  const readVersion = useSyncExternalStore(subscribeRead, () => readVersionGlobal, () => 0);
  const fetchMentions = useCallback(() => fetchEntry(url), [url]);

  // Recompute unread state when readVersion changes (after markChannelRead)
  const unreadMentions = useMemo(
    () =>
      mentions.filter((m) => {
        const readTs = getChannelReadTimestamp(m.channelId);
        return new Date(m.createdAt).getTime() > readTs;
      }),
    // readVersion bumps when any instance marks something read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mentions, readVersion]
  );

  // Per-channel unread counts (memoized to avoid recreating Maps every render)
  const { channelMentionCounts, serverMentionCounts } = useMemo(() => {
    const chCounts = new Map<string, number>();
    for (const m of unreadMentions) {
      chCounts.set(m.channelId, (chCounts.get(m.channelId) || 0) + 1);
    }
    const srvCounts = new Map<string, number>();
    for (const m of unreadMentions) {
      if (m.serverId) {
        srvCounts.set(m.serverId, (srvCounts.get(m.serverId) || 0) + 1);
      }
    }
    return { channelMentionCounts: chCounts, serverMentionCounts: srvCounts };
  }, [unreadMentions]);

  const totalUnread = unreadMentions.length;

  const markChannelRead = useCallback((channelId: string) => {
    setChannelReadTimestamp(channelId, Date.now());
    bumpReadVersion();
  }, []);

  const markServerRead = useCallback((sid: string) => {
    const channelIds = new Set(
      mentions.filter((m) => m.serverId === sid).map((m) => m.channelId)
    );
    for (const chId of channelIds) {
      setChannelReadTimestamp(chId, Date.now());
    }
    bumpReadVersion();
  }, [mentions]);

  const markAllRead = useCallback(() => {
    const channelIds = new Set(mentions.map((m) => m.channelId));
    for (const chId of channelIds) {
      setChannelReadTimestamp(chId, Date.now());
    }
    bumpReadVersion();
  }, [mentions]);

  const getChannelCount = useCallback(
    (channelId: string): number => channelMentionCounts.get(channelId) || 0,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [readVersion, mentions]
  );

  const getServerCount = useCallback(
    (sid: string): number => serverMentionCounts.get(sid) || 0,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [readVersion, mentions]
  );

  return {
    mentions: unreadMentions,
    allMentions: mentions,
    loading,
    error,
    totalUnread,
    channelMentionCounts,
    serverMentionCounts,
    getChannelCount,
    getServerCount,
    markChannelRead,
    markServerRead,
    markAllRead,
    refresh: fetchMentions,
  };
}

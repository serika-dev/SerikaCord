"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { MentionNames } from "@/lib/chat/mentionText";
import { isMessageRead } from "@/lib/unread/engine";
import { feedMentions, getServerUnreadState, getUnreadState, subscribeUnread } from "@/lib/unread/store";

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
  /** Names for the mention markup in `content` (users, roles, channels). */
  mentionNames?: MentionNames;
}

const POLL_INTERVAL = 30_000;

// ── Shared store ─────────────────────────────────────────────────────────
// The Inbox and the mobile server list use this hook; one module-level store
// per URL runs a single poll for all of them. Read state is NOT tracked here:
// a mention is unread exactly when the unread engine's read marker for its
// channel doesn't cover it (the same marker the badges use, synced across
// devices), so the Inbox and the badges always agree.

interface MentionState {
  mentions: MentionData[];
  names: MentionNames;
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

const EMPTY_NAMES: MentionNames = {};
const EMPTY_STATE: MentionState = { mentions: [], names: EMPTY_NAMES, loading: true, error: null };
const entries = new Map<string, MentionEntry>();

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
    merged.names === e.state.names &&
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
      // Anything the live stream missed reaches the badges too.
      feedMentions(list);
      const sig = `${list.length}:${list.map((m) => `${m.id}:${m.content.length}`).join(",")}`;
      if (sig !== e.sig) {
        e.sig = sig;
        setEntryState(e, { mentions: list, names: data.mentionNames ?? EMPTY_NAMES, error: null, loading: false });
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

export function useMentions(serverId?: string) {
  const url = serverId
    ? `/api/users/@me/mentions?serverId=${encodeURIComponent(serverId)}`
    : "/api/users/@me/mentions";
  const subscribe = useCallback((fn: () => void) => subscribeEntry(url, fn), [url]);
  const { mentions, names, loading, error } = useSyncExternalStore(
    subscribe,
    () => getEntry(url).state,
    () => EMPTY_STATE
  );
  const unread = useSyncExternalStore(subscribeUnread, getUnreadState, getServerUnreadState);
  const fetchMentions = useCallback(() => fetchEntry(url), [url]);

  const unreadMentions = useMemo(
    () => mentions.filter((m) => !isMessageRead(unread, m.channelId, m.id, m.createdAt)),
    [mentions, unread]
  );

  // Per-channel / per-server unread counts.
  const { channelMentionCounts, serverMentionCounts } = useMemo(() => {
    const chCounts = new Map<string, number>();
    const srvCounts = new Map<string, number>();
    for (const m of unreadMentions) {
      chCounts.set(m.channelId, (chCounts.get(m.channelId) || 0) + 1);
      if (m.serverId) srvCounts.set(m.serverId, (srvCounts.get(m.serverId) || 0) + 1);
    }
    return { channelMentionCounts: chCounts, serverMentionCounts: srvCounts };
  }, [unreadMentions]);

  return {
    mentions: unreadMentions,
    allMentions: mentions,
    /** Names for mention markup in `content`. */
    mentionNames: names,
    loading,
    error,
    totalUnread: unreadMentions.length,
    channelMentionCounts,
    serverMentionCounts,
    refresh: fetchMentions,
  };
}

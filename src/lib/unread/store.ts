"use client";

/**
 * The one unread engine instance for this tab, as an external store:
 * UnreadContext dispatches into it and renders from it, and the Inbox
 * (useMentions) reads the same read markers, so the badges, the tab title and
 * the Inbox can never disagree about what's read.
 */

import {
  EMPTY_UNREAD_STATE,
  hydrateUnread,
  persistUnread,
  reduceUnread,
  type UnreadEvent,
  type UnreadState,
} from "./engine";

const LS_READ = "sc:unread:read";
const LS_READ_IDS = "sc:unread:readids";
// v2: v1 seeded activity from channel `updatedAt`, which also moves on
// renames / permission edits and left channels glowing; start that map over.
const LS_ACTIVITY = "sc:unread:activity:v2";
const LS_ACTIVITY_V1 = "sc:unread:activity";

let state: UnreadState = EMPTY_UNREAD_STATE;
let hydrated = false;
const listeners = new Set<() => void>();
let persistTimer: ReturnType<typeof setTimeout> | null = null;

function loadMap(key: string): Record<string, string> {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function hydrate() {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  state = hydrateUnread({ read: loadMap(LS_READ), readIds: loadMap(LS_READ_IDS), activity: loadMap(LS_ACTIVITY) });
  try {
    localStorage.removeItem(LS_ACTIVITY_V1);
  } catch {
    /* storage blocked */
  }
}

function persistSoon() {
  if (persistTimer || typeof window === "undefined") return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    const p = persistUnread(state);
    try {
      localStorage.setItem(LS_READ, JSON.stringify(p.read));
      localStorage.setItem(LS_READ_IDS, JSON.stringify(p.readIds));
      localStorage.setItem(LS_ACTIVITY, JSON.stringify(p.activity));
    } catch {
      /* quota / blocked: the server markers are the source of truth anyway */
    }
  }, 400);
}

export function getUnreadState(): UnreadState {
  hydrate();
  return state;
}

export function getServerUnreadState(): UnreadState {
  return EMPTY_UNREAD_STATE;
}

export function subscribeUnread(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Apply an event; returns the new state (synchronously, for follow-up checks). */
export function dispatchUnread(event: UnreadEvent): UnreadState {
  hydrate();
  const next = reduceUnread(state, event);
  if (next !== state) {
    state = next;
    persistSoon();
    listeners.forEach((fn) => fn());
  }
  return state;
}

/** Apply several events with one notification to subscribers. */
export function dispatchUnreadBatch(events: UnreadEvent[]): UnreadState {
  hydrate();
  let next = state;
  for (const e of events) next = reduceUnread(next, e);
  if (next !== state) {
    state = next;
    persistSoon();
    listeners.forEach((fn) => fn());
  }
  return state;
}

// ── Mention list feed ────────────────────────────────────────────────────
// The Inbox polls the mentions API; whatever it learns also feeds the badges
// (UnreadContext registers the handler, which applies notification settings).

type MentionFeed = (mentions: Array<{ id: string; channelId: string; serverId?: string; createdAt: string; kind?: "user" | "role" | "everyone" }>) => void;
let mentionFeed: MentionFeed | null = null;

export function setMentionFeed(fn: MentionFeed | null): void {
  mentionFeed = fn;
}

export function feedMentions(mentions: Parameters<MentionFeed>[0]): void {
  mentionFeed?.(mentions);
}

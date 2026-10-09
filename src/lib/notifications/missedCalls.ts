"use client";

/**
 * Missed calls for the Inbox, kept per device (the call log message itself is
 * in the DM history; this is just the "you missed these" list). Fed by the
 * activity stream's `call_missed` event.
 */

import { useSyncExternalStore } from "react";
import { callConversationHref, type CallMissed } from "@/lib/chat/dmCall";

export interface MissedCallEntry {
  callId: string;
  channelId: string;
  callerName: string;
  callerAvatar: string | null;
  groupName: string | null;
  endedAt: string;
  /** Where clicking the entry goes (jumps to the call message in 1:1 DMs). */
  href: string;
  seen: boolean;
}

const KEY = "sc:missed-calls";
const MAX = 30;
const listeners = new Set<() => void>();
const EMPTY: MissedCallEntry[] = [];

function load(): MissedCallEntry[] {
  if (typeof localStorage === "undefined") return EMPTY;
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as MissedCallEntry[]) : [];
    return Array.isArray(list) ? list.slice(0, MAX) : EMPTY;
  } catch {
    return EMPTY;
  }
}

let entries: MissedCallEntry[] = load();

function save(next: MissedCallEntry[]) {
  entries = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* quota */
  }
  listeners.forEach((fn) => fn());
}

export function recordMissedCall(missed: CallMissed) {
  if (entries.some((e) => e.callId === missed.callId)) return;
  const base = callConversationHref(missed);
  const entry: MissedCallEntry = {
    callId: missed.callId,
    channelId: missed.channelId,
    callerName: missed.caller.displayName || missed.caller.username,
    callerAvatar: missed.caller.avatar,
    groupName: missed.group?.name ?? null,
    endedAt: missed.endedAt,
    href: missed.group ? base : `${base}?jump=${encodeURIComponent(missed.callId)}`,
    seen: false,
  };
  save([entry, ...entries].slice(0, MAX));
}

export function markMissedCallsSeen() {
  if (!entries.some((e) => !e.seen)) return;
  save(entries.map((e) => (e.seen ? e : { ...e, seen: true })));
}

export function clearMissedCalls() {
  save([]);
}

export function removeMissedCall(callId: string) {
  save(entries.filter((e) => e.callId !== callId));
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) {
      entries = load();
      fn();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(fn);
    window.removeEventListener("storage", onStorage);
  };
}

export function useMissedCalls(): MissedCallEntry[] {
  return useSyncExternalStore(subscribe, () => entries, () => EMPTY);
}

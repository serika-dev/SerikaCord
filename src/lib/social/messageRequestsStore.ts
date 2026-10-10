"use client";

import { useSyncExternalStore } from "react";

/** One DM held in Message Requests (GET /api/dms/requests). */
export interface MessageRequestItem {
  channelId: string;
  createdAt?: string | null;
  updatedAt?: string | null;
  user: {
    id: string;
    username: string;
    displayName?: string | null;
    avatar?: string | null;
    status?: "online" | "idle" | "dnd" | "offline";
    customization?: unknown;
  };
  lastMessage: { id: string; content: string; authorId: string; createdAt?: string | null } | null;
}

interface State {
  loaded: boolean;
  count: number;
  items: MessageRequestItem[];
}

let state: State = { loaded: false, count: 0, items: [] };
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit(next: State) {
  state = next;
  listeners.forEach((l) => l());
}

export function refreshMessageRequests(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await fetch("/api/dms/requests", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      const items = (Array.isArray(data?.requests) ? data.requests : []) as MessageRequestItem[];
      emit({ loaded: true, count: items.length, items });
    } catch {
      /* keep */
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** The DM list response carries the count; use it until the list is loaded. */
export function seedMessageRequestCount(count: number) {
  if (state.loaded || state.count === count) return;
  emit({ ...state, count });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const getSnapshot = () => state;
const SERVER: State = { loaded: false, count: 0, items: [] };

export function useMessageRequests(): State {
  return useSyncExternalStore(subscribe, getSnapshot, () => SERVER);
}

/** Accept or ignore a request. Resolves to whether the server agreed. */
export async function resolveMessageRequest(channelId: string, action: "accept" | "ignore"): Promise<boolean> {
  const prev = state;
  const items = state.items.filter((i) => i.channelId !== channelId);
  emit({ ...state, items, count: Math.max(0, state.loaded ? items.length : state.count - 1) });
  try {
    const res = await fetch(`/api/dms/requests/${encodeURIComponent(channelId)}/${action}`, { method: "POST" });
    if (!res.ok) {
      emit(prev);
      return false;
    }
    return true;
  } catch {
    emit(prev);
    return false;
  }
}

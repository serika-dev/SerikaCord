"use client";

import { useSyncExternalStore } from "react";

/**
 * The signed-in user's friends / pending / blocked ids, shared by every user
 * menu, the blocked-messages rows in chat and notification suppression.
 * Loaded once from GET /api/friends and refreshed on `relationships_changed`
 * (activity stream) and after each relationship action.
 */
export interface RelationshipsState {
  loaded: boolean;
  friends: ReadonlySet<string>;
  blocked: ReadonlySet<string>;
  incoming: ReadonlySet<string>;
  outgoing: ReadonlySet<string>;
}

const EMPTY: RelationshipsState = {
  loaded: false,
  friends: new Set(),
  blocked: new Set(),
  incoming: new Set(),
  outgoing: new Set(),
};

let state: RelationshipsState = EMPTY;
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

const norm = (id: string) => String(id).toLowerCase();
const idsOf = (list: unknown): Set<string> =>
  new Set((Array.isArray(list) ? list : []).map((u) => norm(typeof u === "string" ? u : (u as { id?: string })?.id ?? "")).filter(Boolean));

function emit(next: RelationshipsState) {
  state = next;
  listeners.forEach((l) => l());
}

export function refreshRelationships(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await fetch("/api/friends", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      emit({
        loaded: true,
        friends: idsOf(data?.friends),
        blocked: idsOf(data?.blocked),
        incoming: idsOf(data?.pending?.incoming),
        outgoing: idsOf(data?.pending?.outgoing),
      });
    } catch {
      /* keep what we have */
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!state.loaded) void refreshRelationships();
  return () => listeners.delete(listener);
}

const getSnapshot = () => state;
const getServerSnapshot = () => EMPTY;

export function useRelationships(): RelationshipsState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Non-hook read (notification filtering). */
export function getRelationships(): RelationshipsState {
  return state;
}

/** Optimistic local change after an action; the server refresh follows. */
export function patchRelationship(userId: string, change: Partial<Record<"friend" | "blocked" | "incoming" | "outgoing", boolean>>) {
  const id = norm(userId);
  const toggle = (set: ReadonlySet<string>, on: boolean | undefined) => {
    if (on === undefined) return set;
    const next = new Set(set);
    if (on) next.add(id); else next.delete(id);
    return next;
  };
  emit({
    ...state,
    friends: toggle(state.friends, change.friend),
    blocked: toggle(state.blocked, change.blocked),
    incoming: toggle(state.incoming, change.incoming),
    outgoing: toggle(state.outgoing, change.outgoing),
  });
}

export function isBlockedId(set: ReadonlySet<string>, id: string | null | undefined): boolean {
  return Boolean(id) && set.has(norm(String(id)));
}

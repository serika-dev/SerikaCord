"use client";

import { useCallback, useSyncExternalStore } from "react";
import { DEFAULT_BADGES } from "@/lib/constants/badges";
import { resolveBadgeIds, sanitizeBadgeList, compareBadges, type BadgeDefinition } from "@/lib/badges/shared";

// Badge definitions come from GET /api/badges (the staff-editable `badges`
// table). Badges render in every message header, so this is a single
// module-level store shared by every subscriber via useSyncExternalStore:
//   • one network request per session (refreshBadges() re-fetches after an
//     admin edit);
//   • the last good list is mirrored to localStorage so a reload paints real
//     badges instantly, before the request returns;
//   • the built-in constants are the fallback when both of those are missing.
// The server render (and hydration) always uses the built-ins so markup
// matches; the cached/fetched list swaps in right after.

const STORAGE_KEY = "serika-badges-v1";

export interface BadgeStore {
  list: BadgeDefinition[];
  byId: ReadonlyMap<string, BadgeDefinition>;
}

function buildStore(list: BadgeDefinition[]): BadgeStore {
  const sorted = [...list].sort(compareBadges);
  return { list: sorted, byId: new Map(sorted.map((b) => [b.id, b])) };
}

const FALLBACK_STORE = buildStore(DEFAULT_BADGES.map((b) => ({ ...b })));

let store: BadgeStore = FALLBACK_STORE;
let hydratedFromStorage = false;
let fetchPromise: Promise<void> | null = null;
let fetched = false;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function readStorage(): BadgeDefinition[] | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? sanitizeBadgeList(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function writeStorage(list: BadgeDefinition[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    // ignore (private mode / quota)
  }
}

function hydrateFromStorage() {
  if (hydratedFromStorage || typeof window === "undefined") return;
  hydratedFromStorage = true;
  const cached = readStorage();
  if (cached && cached.length > 0) store = buildStore(cached);
}

function load(force = false): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (fetchPromise) return fetchPromise;
  if (fetched && !force) return Promise.resolve();
  fetchPromise = (async () => {
    try {
      const res = await fetch("/api/badges", force ? { cache: "no-store" } : undefined);
      if (!res.ok) return;
      const data = (await res.json().catch(() => null)) as { badges?: unknown } | null;
      const list = sanitizeBadgeList(data?.badges);
      // An empty list from a healthy API would mean "no badges at all"; that is
      // never true in practice, so treat it like a failure and keep what we have.
      if (!list || list.length === 0) return;
      store = buildStore(list);
      writeStorage(list);
      emit();
    } catch {
      // Network error: keep the cached/built-in definitions.
    } finally {
      fetched = true;
      fetchPromise = null;
    }
  })();
  return fetchPromise;
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  if (!hydratedFromStorage) {
    const before = store;
    hydrateFromStorage();
    // Notify after subscribe returns so the hydrated snapshot is picked up.
    if (store !== before) queueMicrotask(emit);
  }
  void load();
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot(): BadgeStore {
  return store;
}

function getServerSnapshot(): BadgeStore {
  return FALLBACK_STORE;
}

/** Re-fetch definitions, bypassing the HTTP cache (call after an admin edit). */
export function refreshBadges(): Promise<void> {
  return load(true);
}

export interface UseBadgesReturn extends BadgeStore {
  /** A user's badge ids → visible definitions, de-duplicated and sorted. */
  resolve: (ids: readonly string[] | null | undefined) => BadgeDefinition[];
}

export function useBadges(): UseBadgesReturn {
  const current = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const resolve = useCallback(
    (ids: readonly string[] | null | undefined) => resolveBadgeIds(ids, current.byId),
    [current],
  );
  return { list: current.list, byId: current.byId, resolve };
}

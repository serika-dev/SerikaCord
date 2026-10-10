"use client";

/**
 * This device's emoji frecency (localStorage), shared by the emoji picker
 * ("Frequently Used"), the message menu's quick-reaction row, the hover bar
 * and the phone action sheet. Ranking is recomputed when it changes, never
 * during render.
 */

import { useSyncExternalStore } from "react";
import {
  frecencyFromRecentList,
  rankFrecentEmojis,
  recordEmojiUse,
  sanitizeFrecencyState,
  type FrecencyEmoji,
  type FrecencyState,
} from "./emojiFrecency";

const STORAGE_KEY = "serika-emoji-frecency";
/** The pre-frecency "recently used" list, migrated once. */
const LEGACY_RECENT_KEY = "serika-recent-emojis";

interface Snapshot {
  state: FrecencyState;
  ranked: FrecencyEmoji[];
}

const EMPTY: Snapshot = { state: {}, ranked: [] };
let snapshot: Snapshot | null = null;
const listeners = new Set<() => void>();

function build(state: FrecencyState): Snapshot {
  return { state, ranked: rankFrecentEmojis(state, Date.now(), 48) };
}

function load(): Snapshot {
  if (typeof window === "undefined") return EMPTY;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return build(sanitizeFrecencyState(JSON.parse(raw)));
    const legacy = localStorage.getItem(LEGACY_RECENT_KEY);
    if (legacy) {
      const list = (JSON.parse(legacy) as unknown[]).filter(
        (e): e is FrecencyEmoji => !!e && typeof e === "object" && ((e as FrecencyEmoji).kind === "unicode" || (e as FrecencyEmoji).kind === "custom"),
      );
      return build(sanitizeFrecencyState(frecencyFromRecentList(list, Date.now())));
    }
  } catch {
    /* unavailable / corrupt storage */
  }
  return EMPTY;
}

function getSnapshot(): Snapshot {
  if (!snapshot) snapshot = load();
  return snapshot;
}

function getServerSnapshot(): Snapshot {
  return EMPTY;
}

function emit() {
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1 && typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}

// Another tab used an emoji.
function onStorage(e: StorageEvent) {
  if (e.key !== STORAGE_KEY) return;
  snapshot = load();
  emit();
}

/** Count one use of an emoji (picked, reacted with, quick-reacted). */
export function recordEmoji(emoji: FrecencyEmoji): void {
  const next = recordEmojiUse(getSnapshot().state, emoji, Date.now());
  snapshot = build(next);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* storage full or unavailable: still ranked for this session */
  }
  emit();
}

/** Emojis by frecency, best first. */
export function useFrecentEmojis(): FrecencyEmoji[] {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot).ranked;
}

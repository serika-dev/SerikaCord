"use client";

import { useSyncExternalStore } from "react";
import { normalizeUserNote } from "@/lib/social/userNotes";

/**
 * Private user notes (only visible to you), loaded once from
 * GET /api/users/@me/notes and kept in sync across tabs/devices through the
 * `user_note_update` activity event. Saves are debounced per user.
 */
let notes: Record<string, string> = {};
let loaded = false;
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

const norm = (id: string) => String(id).toLowerCase();

function emit() {
  notes = { ...notes };
  listeners.forEach((l) => l());
}

export function loadNotes(): Promise<void> {
  if (typeof window === "undefined" || loaded) return Promise.resolve();
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await fetch("/api/users/@me/notes", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      const next: Record<string, string> = {};
      for (const [k, v] of Object.entries((data?.notes ?? {}) as Record<string, string>)) next[norm(k)] = v;
      // Keep anything typed while this was loading.
      notes = { ...next, ...notes };
      loaded = true;
      emit();
    } catch {
      /* retry on next subscribe */
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  void loadNotes();
  return () => listeners.delete(listener);
}

/** The note you keep about `userId` ("" when none). */
export function useUserNote(userId: string | null | undefined): string {
  return useSyncExternalStore(
    subscribe,
    () => (userId ? notes[norm(userId)] ?? "" : ""),
    () => "",
  );
}

/** Apply a note received from the server (another tab, or a profile fetch). */
export function receiveUserNote(userId: string, note: string) {
  const id = norm(userId);
  if ((notes[id] ?? "") === note || timers.has(id)) return;
  if (note) notes[id] = note; else delete notes[id];
  emit();
}

/** Update locally now; persist after a short pause in typing (or immediately). */
export function saveUserNote(userId: string, raw: string, opts: { immediate?: boolean } = {}): Promise<void> {
  const id = norm(userId);
  if (raw) notes[id] = raw; else delete notes[id];
  emit();
  const existing = timers.get(id);
  if (existing) clearTimeout(existing);
  return new Promise((resolve) => {
    const run = async () => {
      timers.delete(id);
      try {
        await fetch(`/api/users/@me/notes/${encodeURIComponent(userId)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ note: normalizeUserNote(raw) }),
        });
      } catch {
        /* the next edit retries */
      }
      resolve();
    };
    if (opts.immediate) void run();
    else timers.set(id, setTimeout(() => void run(), 600));
  });
}

/** Save a note that's still waiting for its typing pause right now (on blur / close). */
export function flushUserNote(userId: string): void {
  const id = norm(userId);
  if (!timers.has(id)) return;
  void saveUserNote(userId, notes[id] ?? "", { immediate: true });
}

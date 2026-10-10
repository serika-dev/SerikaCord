"use client";

/**
 * Which thread the right-hand thread panel shows, Discord style: one panel
 * next to the channel it belongs to (closing the channel's view keeps it per
 * channel, so coming back to the channel shows nothing until reopened).
 *
 *   openThreadPanel(parentId, threadId)  "N Messages ›" chip, threads browser
 *   openCreateThread(parentId, starter)  "Create Thread" (message menu / header)
 *   closeThreadPanel()                   X / Escape / opening the full view
 *
 * Plus two small app-wide signals: "open the threads browser" (the "See all
 * threads" link on a "started a thread" row) and "my threads changed" (joined,
 * left, archived: the sidebar refetches the server's channels).
 */

import { useSyncExternalStore } from "react";

export interface ThreadStarterDraft {
  id: string;
  content: string;
  createdAt: string;
  author: { id: string; username: string; displayName?: string; avatar?: string } | null;
  attachments?: unknown[];
}

export type ThreadPanelState =
  | { mode: "closed" }
  | { mode: "thread"; parentId: string; threadId: string }
  | { mode: "create"; parentId: string; starter: ThreadStarterDraft | null };

const CLOSED: ThreadPanelState = { mode: "closed" };
let state: ThreadPanelState = CLOSED;
const listeners = new Set<() => void>();

function set(next: ThreadPanelState) {
  state = next;
  listeners.forEach((fn) => fn());
}

export function openThreadPanel(parentId: string, threadId: string): void {
  set({ mode: "thread", parentId, threadId });
}

export function openCreateThread(parentId: string, starter: ThreadStarterDraft | null): void {
  set({ mode: "create", parentId, starter });
}

export function closeThreadPanel(): void {
  if (state.mode !== "closed") set(CLOSED);
}

export function getThreadPanelState(): ThreadPanelState {
  return state;
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** The panel state for `parentId` (closed when the panel belongs to another channel). */
export function useThreadPanel(parentId: string | null | undefined): ThreadPanelState {
  const s = useSyncExternalStore(subscribe, getThreadPanelState, () => CLOSED);
  if (!parentId || s.mode === "closed" || s.parentId !== parentId) return CLOSED;
  return s;
}

// ── "Open the threads browser" ────────────────────────────────────────────
const browserListeners = new Set<(parentId: string) => void>();

export function requestThreadsBrowser(parentId: string): void {
  browserListeners.forEach((fn) => fn(parentId));
}

export function onThreadsBrowserRequest(fn: (parentId: string) => void): () => void {
  browserListeners.add(fn);
  return () => {
    browserListeners.delete(fn);
  };
}

// ── "My joined threads changed" ───────────────────────────────────────────
const changeListeners = new Set<(serverId: string) => void>();

/** Joined / left / archived / created: the sidebar's thread list is stale for `serverId`. */
export function emitThreadsChanged(serverId: string): void {
  changeListeners.forEach((fn) => fn(serverId));
}

export function onThreadsChanged(fn: (serverId: string) => void): () => void {
  changeListeners.add(fn);
  return () => {
    changeListeners.delete(fn);
  };
}

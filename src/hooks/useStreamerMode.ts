"use client";

// Streamer Mode live state, per device (like Discord): preferences in
// localStorage (synced across tabs), plus "streaming software is running"
// pushed by the Qt desktop app's process scan as the
// `serika:desktop-activities` window event. Non-React code (notification
// builders) reads it with streamerHidesNow().
import { useSyncExternalStore } from "react";
import {
  DEFAULT_STREAMER_PREFS,
  STREAMER_MODE_STORAGE_KEY,
  isStreamerModeActive,
  isStreamingSoftwareRunning,
  parseStreamerPrefs,
  streamerHides,
  type StreamerHideKind,
  type StreamerModePrefs,
} from "@/lib/streamer/streamerMode";

export interface StreamerModeState {
  prefs: StreamerModePrefs;
  active: boolean;
  /** Streaming software detected by the desktop app. */
  detected: boolean;
}

const DESKTOP_ACTIVITIES_EVENT = "serika:desktop-activities";
const SERVER_STATE: StreamerModeState = { prefs: DEFAULT_STREAMER_PREFS, active: false, detected: false };

let state: StreamerModeState | null = null;
let installed = false;
const listeners = new Set<() => void>();

function readPrefs(): StreamerModePrefs {
  try {
    return parseStreamerPrefs(window.localStorage.getItem(STREAMER_MODE_STORAGE_KEY));
  } catch {
    return DEFAULT_STREAMER_PREFS;
  }
}

function build(prefs: StreamerModePrefs, detected: boolean): StreamerModeState {
  return { prefs, detected, active: isStreamerModeActive(prefs, detected) };
}

function current(): StreamerModeState {
  if (typeof window === "undefined") return SERVER_STATE;
  if (!state) state = build(readPrefs(), false);
  return state;
}

function emit(next: StreamerModeState) {
  state = next;
  listeners.forEach((l) => l());
}

function install() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("storage", (e) => {
    if (e.key === STREAMER_MODE_STORAGE_KEY) emit(build(readPrefs(), current().detected));
  });
  window.addEventListener(DESKTOP_ACTIVITIES_EVENT, (e) => {
    const detected = isStreamingSoftwareRunning((e as CustomEvent).detail);
    if (detected !== current().detected) emit(build(current().prefs, detected));
  });
}

// Install on import (client only) so OBS detection works before any
// component subscribes; the desktop app re-reports every ~45s anyway.
if (typeof window !== "undefined") install();

export function setStreamerPrefs(patch: Partial<StreamerModePrefs>) {
  const prefs = { ...current().prefs, ...patch };
  try {
    window.localStorage.setItem(STREAMER_MODE_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* storage blocked: still applies to this tab */
  }
  emit(build(prefs, current().detected));
}

/** Current Streamer Mode decision for non-React code. */
export function streamerHidesNow(kind: StreamerHideKind): boolean {
  const s = current();
  return streamerHides(s.prefs, s.active, kind);
}

function subscribe(cb: () => void) {
  install();
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

const getServerSnapshot = () => SERVER_STATE;

export function useStreamerMode(): StreamerModeState {
  return useSyncExternalStore(subscribe, current, getServerSnapshot);
}

/** Whether Streamer Mode currently hides this kind of information. */
export function useStreamerHides(kind: StreamerHideKind): boolean {
  const s = useStreamerMode();
  return streamerHides(s.prefs, s.active, kind);
}

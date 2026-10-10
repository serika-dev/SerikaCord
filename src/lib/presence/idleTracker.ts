"use client";

import { AUTO_IDLE_AFTER_MS } from "@/lib/presence/autoIdle";

/**
 * Client side of automatic Idle: notices whether this device has seen input
 * in the last 10 minutes. In the browser that is keyboard / pointer / touch /
 * wheel input in the app; the desktop shell reports real system idle instead
 * (`setExternalIdle`). Listeners fire on each idle <-> active transition so
 * the presence heartbeat can report it right away.
 */
let lastInput = Date.now();
let external: boolean | null = null;
let idle = false;
let started = false;
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<(idle: boolean) => void>();

function setIdle(next: boolean) {
  if (next === idle) return;
  idle = next;
  listeners.forEach((l) => l(next));
}

function schedule() {
  if (timer) clearTimeout(timer);
  if (external !== null) return;
  const wait = Math.max(1000, lastInput + AUTO_IDLE_AFTER_MS - Date.now());
  timer = setTimeout(() => {
    if (external === null && Date.now() - lastInput >= AUTO_IDLE_AFTER_MS) setIdle(true);
    else schedule();
  }, wait);
}

let lastMark = 0;
function onInput() {
  const now = Date.now();
  lastInput = now;
  if (external === null && idle) setIdle(false);
  // Re-arming the timer on every mouse move is wasteful; once a second is plenty.
  if (now - lastMark > 1000) {
    lastMark = now;
    schedule();
  }
}

const EVENTS = ["keydown", "pointerdown", "pointermove", "wheel", "touchstart"] as const;

/** Start watching input (idempotent). Returns a stop function. */
export function startIdleTracker(): () => void {
  if (typeof window === "undefined" || started) return () => {};
  started = true;
  lastInput = Date.now();
  for (const e of EVENTS) window.addEventListener(e, onInput, { passive: true, capture: true });
  schedule();
  return () => {
    started = false;
    for (const e of EVENTS) window.removeEventListener(e, onInput, { capture: true } as EventListenerOptions);
    if (timer) clearTimeout(timer);
    timer = null;
  };
}

/** Whether this device currently counts as idle (no input for 10 minutes). */
export function isDeviceIdle(): boolean {
  if (external !== null) return external;
  return idle || Date.now() - lastInput >= AUTO_IDLE_AFTER_MS;
}

/** The desktop shell's system-wide idle signal replaces in-app input tracking. */
export function setExternalIdle(value: boolean) {
  external = value;
  if (timer) clearTimeout(timer);
  setIdle(value);
}

export function onIdleChange(listener: (idle: boolean) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

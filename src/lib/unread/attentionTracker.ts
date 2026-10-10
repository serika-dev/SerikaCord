"use client";

/**
 * Browser side of `attention.ts`: records the last interaction with the page
 * and tells subscribers when the user starts / stops attending, or touches
 * the page (so the open conversation can ack right away).
 */

import { attentionExpiresAt, isAttending } from "./attention";

type Listener = () => void;

let installed = false;
let lastInteractionAt = 0;
let lastEmitAt = 0;
let lastAttending = false;
let expiryTimer: ReturnType<typeof setTimeout> | null = null;
let touchDevice: boolean | null = null;
// The conversation list on screen sits at its newest message.
let listAtBottom = false;
const listeners = new Set<Listener>();

function isTouchDevice(): boolean {
  if (touchDevice !== null) return touchDevice;
  if (typeof window === "undefined") return false;
  const w = window as Window & { Capacitor?: { isNativePlatform?: () => boolean } };
  let native = false;
  try {
    native = Boolean(w.Capacitor?.isNativePlatform?.());
  } catch {
    native = false;
  }
  let coarse = false;
  try {
    coarse = window.matchMedia?.("(hover: none) and (pointer: coarse)").matches ?? false;
  } catch {
    coarse = false;
  }
  touchDevice = native || coarse;
  return touchDevice;
}

function snapshot(now = Date.now()) {
  const visible = typeof document !== "undefined" && document.visibilityState === "visible";
  let focused = false;
  try {
    focused = typeof document !== "undefined" && document.hasFocus();
  } catch {
    focused = false;
  }
  return { visible, focused, lastInteractionAt, now, touchDevice: isTouchDevice() };
}

/** The user is looking at the app (see `isAttending`). */
export function isUserAttending(): boolean {
  if (typeof document === "undefined") return false;
  install();
  return isAttending(snapshot());
}

function emit() {
  lastEmitAt = Date.now();
  listeners.forEach((fn) => {
    try {
      fn();
    } catch {
      /* a broken subscriber must not stop the others */
    }
  });
}

function reschedule() {
  if (expiryTimer) {
    clearTimeout(expiryTimer);
    expiryTimer = null;
  }
  const s = snapshot();
  const at = attentionExpiresAt(s);
  if (at === null) return;
  expiryTimer = setTimeout(() => {
    expiryTimer = null;
    check(true);
  }, at - s.now + 50);
}

/** Re-evaluate; emit when attention flipped (or `force`). */
function check(force = false) {
  const now = isAttending(snapshot());
  const flipped = now !== lastAttending;
  lastAttending = now;
  reschedule();
  if (flipped || force) emit();
}

function onInteraction() {
  const now = Date.now();
  lastInteractionAt = now;
  // Pointer moves and scrolls fire constantly; tell subscribers at most
  // twice a second unless attention just flipped.
  if (!lastAttending || now - lastEmitAt > 500) check(true);
  else reschedule();
}

function install() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const opts: AddEventListenerOptions = { capture: true, passive: true };
  for (const type of ["pointerdown", "pointermove", "keydown", "wheel", "touchstart"] as const) {
    window.addEventListener(type, onInteraction, opts);
  }
  // Scrolls of inner panes don't bubble; capture them at the document.
  document.addEventListener("scroll", onInteraction, opts);
  window.addEventListener("focus", () => check(true));
  window.addEventListener("blur", () => check());
  document.addEventListener("visibilitychange", () => check(true));
  lastAttending = isAttending(snapshot());
}

/**
 * Called when attention flips (focus, blur, tab hidden/shown, the one-minute
 * window running out) and on interactions with the page (throttled).
 */
export function subscribeAttention(fn: Listener): () => void {
  install();
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** The message list on screen reports whether it shows the newest message. */
export function setListAtBottom(atBottom: boolean): void {
  listAtBottom = atBottom;
}

/** The open conversation is being read live (attending and at the bottom). */
export function isReadingLive(): boolean {
  return listAtBottom && isUserAttending();
}

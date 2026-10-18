"use client";

import { useEffect, useSyncExternalStore } from "react";
import { isNativeApp } from "@/lib/native/bridge";

/** Shrink of the visual viewport (px) that counts as an on-screen keyboard. */
const KEYBOARD_THRESHOLD_PX = 80;

/**
 * Tracks `window.visualViewport` on phones and exposes it as CSS variables on
 * `<html>`, because iOS Safari ignores `interactive-widget=resizes-content`:
 * the keyboard only shrinks the visual viewport, so an `h-dvh` shell keeps its
 * full height and the header scrolls away.
 *
 * - `--app-height`: the visible height in px (size the phone shell with
 *   `height: var(--app-height, 100dvh)`).
 * - `--keyboard-inset`: how much of the layout viewport the keyboard covers.
 * - `html.keyboard-open` while the keyboard is up (hides the bottom nav and
 *   collapses the bottom safe-area padding, see globals.css).
 *
 * Writes are coalesced to one per animation frame and skipped when unchanged.
 * No-op without visualViewport and inside the native app (NativeAppBridge
 * measures insets there). Mount it once, in the phone shell.
 */
export function useVisualViewportVars(enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const vv = window.visualViewport;
    if (!vv || isNativeApp()) return;
    const root = document.documentElement;
    let frame: number | null = null;
    let lastKey = "";

    const write = () => {
      frame = null;
      // Pinch zoom also shrinks the visual viewport: keep the last values.
      if (vv.scale > 1.01) return;
      const height = Math.round(vv.height);
      const inset = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
      const open = inset > KEYBOARD_THRESHOLD_PX;
      const key = `${height}:${inset}:${open}`;
      if (key !== lastKey) {
        lastKey = key;
        root.style.setProperty("--app-height", `${height}px`);
        root.style.setProperty("--keyboard-inset", `${inset}px`);
        root.classList.toggle("keyboard-open", open);
      }
      // iOS scrolls the layout viewport to reveal the focused field; the
      // shell already fits the visible area, so keep the header in view.
      if (open && window.scrollY !== 0) window.scrollTo(0, 0);
    };
    const schedule = () => {
      if (frame === null) frame = requestAnimationFrame(write);
    };

    schedule();
    vv.addEventListener("resize", schedule);
    vv.addEventListener("scroll", schedule);
    return () => {
      vv.removeEventListener("resize", schedule);
      vv.removeEventListener("scroll", schedule);
      if (frame !== null) cancelAnimationFrame(frame);
      root.style.removeProperty("--app-height");
      root.style.removeProperty("--keyboard-inset");
      root.classList.remove("keyboard-open");
    };
  }, [enabled]);
}

const COARSE_QUERY = "(pointer: coarse)";
const FINE_ANY_QUERY = "(any-pointer: fine)";

function subscribeQueries(onChange: () => void) {
  const mqls = [window.matchMedia(COARSE_QUERY), window.matchMedia(FINE_ANY_QUERY)];
  mqls.forEach((m) => m.addEventListener("change", onChange));
  return () => mqls.forEach((m) => m.removeEventListener("change", onChange));
}
const getServerFalse = () => false;

/** True when the primary pointer is a finger (phones, tablets). */
export function isCoarsePointer(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(COARSE_QUERY).matches;
}

/**
 * Touch-only device (no mouse / trackpad attached): the on-screen keyboard
 * has no Shift+Enter, so Enter should insert a newline and the send button
 * sends. A tablet with a trackpad keyboard keeps Enter-to-send.
 */
export function isTouchOnlyInput(): boolean {
  return isCoarsePointer() && !window.matchMedia(FINE_ANY_QUERY).matches;
}

export function useCoarsePointer(): boolean {
  return useSyncExternalStore(subscribeQueries, isCoarsePointer, getServerFalse);
}

export function useTouchOnlyInput(): boolean {
  return useSyncExternalStore(subscribeQueries, isTouchOnlyInput, getServerFalse);
}

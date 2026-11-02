"use client";

import { useEffect, useSyncExternalStore } from "react";
import { isNativeApp } from "@/lib/native/bridge";
import { measureKeyboard, type ViewportBaseline } from "@/lib/layout/keyboardViewport";

/** A text field has focus (the keyboard can only be up then). */
function editableFocused(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el || el === document.body) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === "TEXTAREA") return true;
  if (tag !== "INPUT") return false;
  const type = (el as HTMLInputElement).type;
  return !["button", "checkbox", "radio", "range", "color", "file", "submit", "reset", "image", "hidden"].includes(type);
}

/**
 * Tracks `window.visualViewport` on phones and exposes it as CSS variables on
 * `<html>`, so the phone shell is exactly the visible area whichever way the
 * browser reports the keyboard (see lib/layout/keyboardViewport.ts): iOS
 * Safari ignores `interactive-widget=resizes-content` and only shrinks the
 * visual viewport; Chrome and Samsung Internet shrink the layout viewport;
 * the app's WebView may do either, or neither (native insets then).
 *
 * - `--app-height`: the visible height in px (size the phone shell with
 *   `height: var(--app-height, 100dvh)`).
 * - `--keyboard-inset`: how much of the layout viewport the keyboard covers.
 * - `html.keyboard-open` while the keyboard is up (hides the bottom nav and
 *   collapses the bottom safe-area padding, see globals.css). In the app,
 *   NativeAppBridge owns the class (the native keyboard state is exact).
 *
 * Writes are coalesced to one per animation frame and skipped when unchanged.
 * No-op without visualViewport. Mount it once, in the phone shell.
 */
export function useVisualViewportVars(enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const vv = window.visualViewport;
    if (!vv) return;
    const native = isNativeApp();
    const root = document.documentElement;
    let frame: number | null = null;
    let lastKey = "";
    let baseline: ViewportBaseline | null = null;

    const write = () => {
      frame = null;
      // Pinch zoom also shrinks the visual viewport: keep the last values.
      if (vv.scale > 1.01) return;
      const m = measureKeyboard(
        { width: window.innerWidth, innerHeight: window.innerHeight, vvHeight: vv.height, vvOffsetTop: vv.offsetTop, editableFocused: editableFocused() },
        baseline,
      );
      baseline = m.baseline;
      const height = Math.round(vv.height);
      const key = `${height}:${m.inset}:${m.open}`;
      if (key !== lastKey) {
        lastKey = key;
        root.style.setProperty("--app-height", `${height}px`);
        root.style.setProperty("--keyboard-inset", `${m.inset}px`);
        if (!native) root.classList.toggle("keyboard-open", m.open);
      }
      // The shell already fits the visible area, so the document itself never
      // scrolls. Browsers scroll it anyway to reveal the focused field while
      // the keyboard opens (iOS, Samsung Internet), which hid the header and
      // left a gap under the composer after the keyboard closed.
      if (window.scrollY !== 0) window.scrollTo(0, 0);
    };
    const schedule = () => {
      if (frame === null) frame = requestAnimationFrame(write);
    };

    schedule();
    vv.addEventListener("resize", schedule);
    vv.addEventListener("scroll", schedule);
    // Focus moving in or out of a text field decides whether a shrink is the keyboard.
    document.addEventListener("focusin", schedule);
    document.addEventListener("focusout", schedule);
    return () => {
      vv.removeEventListener("resize", schedule);
      vv.removeEventListener("scroll", schedule);
      document.removeEventListener("focusin", schedule);
      document.removeEventListener("focusout", schedule);
      if (frame !== null) cancelAnimationFrame(frame);
      root.style.removeProperty("--app-height");
      root.style.removeProperty("--keyboard-inset");
      if (!native) root.classList.remove("keyboard-open");
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

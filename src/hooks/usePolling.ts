"use client";

import { useEffect, useRef } from "react";

/**
 * Visibility-aware polling: runs `fn` immediately, then on an interval while
 * the tab is visible. Pauses in background tabs and re-fires the moment the
 * tab regains visibility/focus, so data feels live without wasted requests.
 *
 * Pass `enabled: false` (or interval <= 0) to stop polling entirely.
 */
export function usePolling(
  fn: () => void,
  intervalMs: number,
  enabled = true,
  /** Re-runs immediately (and restarts the interval) when this changes. */
  key?: unknown
) {
  const fnRef = useRef(fn);
  useEffect(() => {
    fnRef.current = fn;
  });

  useEffect(() => {
    if (!enabled || intervalMs <= 0) return;

    let timer: NodeJS.Timeout | null = null;
    let lastRun = 0;
    // visibilitychange + focus both fire on tab return, and focus alone fires
    // on every alt-tab; throttle so those collapse into a single refetch.
    const minGap = Math.min(2000, intervalMs / 2);
    const run = () => {
      lastRun = Date.now();
      fnRef.current();
    };

    const start = () => {
      if (timer) clearInterval(timer);
      timer = setInterval(run, intervalMs);
    };
    const stop = () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    };

    const handleVisibility = () => {
      if (document.visibilityState !== "visible") {
        stop();
        return;
      }
      if (Date.now() - lastRun >= minGap) {
        run();
        start();
      } else if (!timer) {
        start();
      }
    };
    // A focus while the interval is still running (alt-tab back to a window
    // that never went hidden) needs no refetch: the interval keeps it fresh.
    const handleFocus = () => {
      if (!timer) handleVisibility();
    };

    run();
    if (document.visibilityState === "visible") start();

    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("focus", handleFocus);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("focus", handleFocus);
    };
     
  }, [intervalMs, enabled, key]);
}

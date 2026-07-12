"use client";

import { useEffect, useState } from "react";

/**
 * Flipped true once any consumer has hydrated. Before that we must return the
 * SSR value (false) so the first client render matches server HTML; after it,
 * components that mount later (e.g. an interaction-triggered popover) can read
 * the real viewport synchronously with no false→true flip / remount.
 */
let hydrated = false;

/**
 * True below the given viewport width (default 768px).
 *
 * Subscribes to a `matchMedia` change event rather than a `resize` listener —
 * a lightweight subscription instead of a handler firing on every pixel of a
 * drag.
 */
export function useIsMobile(breakpoint = 768): boolean {
  const query = `(max-width: ${breakpoint - 1}px)`;

  const [isMobile, setIsMobile] = useState<boolean>(() => {
    if (typeof window === "undefined" || !window.matchMedia || !hydrated) return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    hydrated = true;
    const mql = window.matchMedia(query);
    const update = () => setIsMobile(mql.matches);
    update();
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, [query]);

  return isMobile;
}

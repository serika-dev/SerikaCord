"use client";

import { useSyncExternalStore } from "react";

const noopSubscribe = () => () => {};

/**
 * False during SSR and the hydration render, true afterwards. Use it to gate
 * markup that depends on `window`/`navigator` (e.g. "is this the desktop
 * app?") so the first client render matches the server HTML (React #418).
 */
export function useIsClient(): boolean {
  return useSyncExternalStore(noopSubscribe, () => true, () => false);
}

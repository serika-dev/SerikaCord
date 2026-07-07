"use client";

import { useEffect } from "react";

export function TauriUpdater() {
  useEffect(() => {
    if (typeof window === "undefined" || !(window as any).__TAURI__) return;

    let cancelled = false;

    void (async () => {
      try {
        const { check } = await import("@tauri-apps/plugin-updater");
        if (cancelled) return;
        await check();
      } catch {
        // ignore updater errors
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}

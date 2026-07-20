"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";

const CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

export function TauriUpdater() {
  const dismissedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (typeof window === "undefined" || !(window as any).__TAURI__) return;

    let cancelled = false;

    const checkForUpdates = async () => {
      if (cancelled) return;
      try {
        const { check } = await import("@tauri-apps/plugin-updater");
        const update = await check();
        if (cancelled || !update) return;

        // Don't re-notify for a version the user already dismissed
        if (dismissedRef.current.has(update.version)) return;

        toast.info(`A new version is available! v${update.version}`, {
          description: update.body
            ? update.body.slice(0, 200)
            : `Update from v${update.currentVersion} to v${update.version}`,
          duration: 15000,
          action: {
            label: "Download & Install",
            onClick: async () => {
              try {
                toast.loading("Downloading update…");
                await update.downloadAndInstall();
                toast.success("Update installed — restarting…");
                const { relaunch } = await import("@tauri-apps/plugin-process");
                await relaunch();
              } catch (e) {
                toast.error("Failed to install update");
                console.error("[updater] install failed:", e);
              }
            },
          },
          cancel: {
            label: "Later",
            onClick: () => {
              dismissedRef.current.add(update.version);
            },
          },
        });
      } catch {
        // ignore updater errors
      }
    };

    // Initial check after a short delay (let the Rust-side splash check finish first)
    const initialTimer = setTimeout(checkForUpdates, 5000);

    // Recurring check every hour
    const interval = setInterval(checkForUpdates, CHECK_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearTimeout(initialTimer);
      clearInterval(interval);
    };
  }, []);

  return null;
}

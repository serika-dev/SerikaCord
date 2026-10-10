"use client";

import { useEffect, useState } from "react";
import { useGT } from "gt-next";
import { Download, X } from "lucide-react";
import { getDesktopUpdateState, installDesktopUpdate, onDesktopSignal } from "@/lib/desktop/bridge";
import { normalizeUpdateState, type DesktopUpdateState } from "@/lib/desktop/protocol";

const DISMISS_KEY = "serika-desktop-update-dismissed";

function readDismissed(): string | null {
  try {
    return sessionStorage.getItem(DISMISS_KEY);
  } catch {
    return null;
  }
}

/**
 * "Update ready" card, like Discord's green download button: the shell has
 * already downloaded and verified the new version; restarting installs it.
 * Dismissing hides it for this session (the tray keeps "Restart to Update").
 */
export function DesktopUpdateBanner() {
  const gt = useGT();
  const [update, setUpdate] = useState<DesktopUpdateState | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(() => readDismissed());

  useEffect(() => {
    let alive = true;
    void getDesktopUpdateState().then((s) => { if (alive && s) setUpdate(s); });
    const off = onDesktopSignal("updateStateChanged", (raw) => setUpdate(normalizeUpdateState(raw)));
    return () => {
      alive = false;
      off();
    };
  }, []);

  if (!update || update.state !== "ready" || !update.version || dismissed === update.version) return null;
  const version = update.version;

  const dismiss = () => {
    setDismissed(version);
    try { sessionStorage.setItem(DISMISS_KEY, version); } catch { /* private mode */ }
  };

  return (
    <div
      role="status"
      className="fixed bottom-4 right-4 z-[60] w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4 shadow-2xl"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--app-accent)] text-[var(--text-on-accent)]">
          <Download className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-[var(--text-primary)]">{gt("Update ready")}</p>
          <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
            {gt("SerikaCord {version} is downloaded. Restart to finish updating.", { version })}
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={installDesktopUpdate}
              className="rounded-md bg-[var(--app-accent)] px-3 py-1.5 text-xs font-semibold text-[var(--text-on-accent)] transition-opacity hover:opacity-90"
            >
              {gt("Restart now")}
            </button>
            <button
              type="button"
              onClick={dismiss}
              className="rounded-md border border-[var(--border-subtle)] px-3 py-1.5 text-xs text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
            >
              {gt("Later")}
            </button>
          </div>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label={gt("Dismiss")}
          className="rounded p-1 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

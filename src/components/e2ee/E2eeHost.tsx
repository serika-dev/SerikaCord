"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useGT } from "gt-next";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useE2ee } from "@/hooks/useE2ee";
import { MountWhenOpened } from "@/components/ui/MountWhenOpened";
import { getE2eeSnapshot, loadE2eeSession, onE2eeDialogRequest, openE2eeDialog, type E2eeDialogRequest } from "@/lib/e2ee/client/state";

const E2eeSetupDialog = dynamic(() => import("./E2eeSetupDialog").then((m) => m.E2eeSetupDialog), { ssr: false });

/**
 * App-wide end-to-end encryption bootstrap (mounted once in AppShellProviders):
 * once the app is idle, loads the crypto module and sets up / checks this
 * device's keys without ever blocking startup; hosts the passphrase, restore
 * and reset dialogs (opened from anywhere with openE2eeDialog).
 */
export function E2eeHost() {
  const gt = useGT();
  const { user } = useAuth();
  const e2ee = useE2ee();
  const userId = user?.id ?? null;
  const [dialog, setDialog] = useState<E2eeDialogRequest | null>(null);
  const promptedRef = useRef<string | null>(null);

  useEffect(() => onE2eeDialogRequest(setDialog), []);

  // Start after startup work has settled; re-run on account switches.
  useEffect(() => {
    if (!userId) {
      if (getE2eeSnapshot().phase !== "idle") void loadE2eeSession().then((s) => s.shutdownE2ee()).catch(() => {});
      return;
    }
    type IdleWindow = Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number };
    const w = window as IdleWindow;
    let cancelled = false;
    const start = () => {
      if (cancelled) return;
      void loadE2eeSession().then((s) => s.initE2ee({ id: userId })).catch(() => {});
    };
    const timer = window.setTimeout(() => {
      if (w.requestIdleCallback) w.requestIdleCallback(start, { timeout: 5000 });
      else start();
    }, 3000);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [userId]);

  // One prompt per session: set a recovery passphrase, or restore on a new device.
  useEffect(() => {
    if (!userId || promptedRef.current === `${userId}:${e2ee.phase}`) return;
    if (e2ee.phase === "ready" && e2ee.remindPassphrase) {
      promptedRef.current = `${userId}:${e2ee.phase}`;
      openE2eeDialog("onboard");
    } else if (e2ee.phase === "needs-restore" && e2ee.enabled) {
      promptedRef.current = `${userId}:${e2ee.phase}`;
      toast(gt("Your encrypted messages are locked on this device"), {
        description: gt("Enter your recovery passphrase to read them here."),
        action: { label: gt("Restore"), onClick: () => openE2eeDialog("restore") },
        duration: 15_000,
      });
    }
  }, [userId, e2ee.phase, e2ee.remindPassphrase, e2ee.enabled, gt]);

  return (
    <MountWhenOpened open={dialog !== null}>
      <E2eeSetupDialog mode={dialog} onClose={() => setDialog(null)} onModeChange={setDialog} />
    </MountWhenOpened>
  );
}

export default E2eeHost;

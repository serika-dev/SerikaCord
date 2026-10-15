"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { useGT } from "gt-next";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useE2ee } from "@/hooks/useE2ee";
import { MountWhenOpened } from "@/components/ui/MountWhenOpened";
import { isNativeApp } from "@/lib/native/bridge";
import {
  E2EE_LINK_INPUT_KEY,
  getE2eeSnapshot,
  loadE2eeSession,
  onE2eeDialogRequest,
  openE2eeDialog,
  type E2eeDialogOptions,
  type E2eeDialogRequest,
} from "@/lib/e2ee/client/state";

const E2eeSetupDialog = dynamic(() => import("./E2eeSetupDialog").then((m) => m.E2eeSetupDialog), { ssr: false });
const E2eeLinkDialog = dynamic(() => import("./E2eeLinkDialog").then((m) => m.E2eeLinkDialog), { ssr: false });
const E2eePinDialog = dynamic(() => import("./E2eePinDialog").then((m) => m.E2eePinDialog), { ssr: false });

type IdleWindow = Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };

/**
 * App-wide end-to-end encryption bootstrap (mounted once in AppShellProviders):
 * right after sign-in (first idle moment, at most half a second later) it
 * loads the crypto module and this device's keys, then checks them with the
 * server in the background, without ever blocking first paint; hosts the
 * passphrase, restore, reset and device-linking dialogs (opened from anywhere
 * with openE2eeDialog) and applies realtime key changes.
 */
export function E2eeHost() {
  const gt = useGT();
  const { user } = useAuth();
  const e2ee = useE2ee();
  const userId = user?.id ?? null;
  const [dialog, setDialog] = useState<{ mode: E2eeDialogRequest; options?: E2eeDialogOptions; seq: number } | null>(null);
  const seqRef = useRef(0);
  const promptedRef = useRef<string | null>(null);
  const pinPromptedRef = useRef<string | null>(null);
  const pathname = usePathname() || "";
  const onDmPage = pathname.startsWith("/dm/");

  useEffect(
    () => onE2eeDialogRequest((mode, options) => {
      seqRef.current += 1;
      setDialog({ mode, options, seq: seqRef.current });
    }),
    [],
  );

  // Start as soon as the app is idle (decryption waits for the keys, not for a timer).
  useEffect(() => {
    if (!userId) {
      if (getE2eeSnapshot().phase !== "idle") void loadE2eeSession().then((s) => s.shutdownE2ee()).catch(() => {});
      return;
    }
    const w = window as IdleWindow;
    let cancelled = false;
    const start = () => {
      if (cancelled) return;
      void loadE2eeSession().then((s) => s.initE2ee({ id: userId })).catch(() => {});
    };
    if (w.requestIdleCallback) {
      const id = w.requestIdleCallback(start, { timeout: 500 });
      return () => {
        cancelled = true;
        w.cancelIdleCallback?.(id);
      };
    }
    const timer = window.setTimeout(start, 50);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [userId]);

  // Someone's keys changed (a device added / removed, keys reset): refresh cached key sets.
  useEffect(() => {
    if (!userId) return;
    const onKeys = (ev: Event) => {
      const changed = (ev as CustomEvent<{ userId?: string }>).detail?.userId;
      if (!changed || getE2eeSnapshot().phase === "idle") return;
      void loadE2eeSession().then((s) => s.onRemoteKeysChanged(changed)).catch(() => {});
    };
    window.addEventListener("serika:e2ee-keys", onKeys);
    return () => window.removeEventListener("serika:e2ee-keys", onKeys);
  }, [userId]);

  // Android app: encrypted push previews need this phone's notification key
  // and the senders this device trusts in native storage (APKs that can't
  // decrypt pushes skip all of it). Lazy: nothing loads on the web.
  useEffect(() => {
    if (!userId || !isNativeApp()) return;
    const phase = e2ee.phase;
    if (phase !== "ready" && phase !== "needs-restore") return;
    let cancelled = false;
    void import("@/lib/e2ee/client/notifyKey").then((m) => {
      if (cancelled) return;
      if (phase === "needs-restore") {
        // This device can't read new messages: no stale key or trust stays in native storage.
        m.stopTrustedSignerSync();
        void m.clearNativeNotificationKey();
        return;
      }
      void m.ensureNotificationKey(userId);
      void m.startTrustedSignerSync(userId);
    }).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [userId, e2ee.phase, e2ee.deviceId]);

  // Signed out: stop handing trust changes to native code.
  useEffect(() => {
    if (userId || !isNativeApp()) return;
    void import("@/lib/e2ee/client/notifyKey").then((m) => m.stopTrustedSignerSync()).catch(() => {});
  }, [userId]);

  // Opened from a scanned linking QR (/e2ee/link): once this device's state is
  // known, open the approve dialog (it explains when this device has to be set
  // up first). The stored link is consumed either way.
  useEffect(() => {
    if (!userId || e2ee.phase === "idle") return;
    let input: string | null = null;
    try {
      input = sessionStorage.getItem(E2EE_LINK_INPUT_KEY);
      if (input) sessionStorage.removeItem(E2EE_LINK_INPUT_KEY);
    } catch {
      input = null;
    }
    if (!input) return;
    const linkInput = input;
    queueMicrotask(() => openE2eeDialog("link-approve", { linkInput }));
  }, [userId, e2ee.phase]);

  // One prompt per session: create (or upgrade to) a 6-digit PIN, set a
  // recovery passphrase (servers without PIN backups), or set this device up.
  useEffect(() => {
    if (!userId || promptedRef.current === `${userId}:${e2ee.phase}`) return;
    if (e2ee.phase === "ready" && e2ee.requirePinSetup) {
      promptedRef.current = `${userId}:${e2ee.phase}`;
      // DM pages show the same setup inline instead of the conversation.
      if (!onDmPage) queueMicrotask(() => openE2eeDialog("pin-setup"));
    } else if (e2ee.phase === "needs-restore" && e2ee.hasPin && !e2ee.resetElsewhere) {
      // "Enter your PIN" comes up where encrypted messages are (DM list, DM pages).
      return;
    } else if (e2ee.phase === "ready" && e2ee.remindPassphrase) {
      promptedRef.current = `${userId}:${e2ee.phase}`;
      queueMicrotask(() => openE2eeDialog("onboard"));
    } else if (e2ee.phase === "needs-restore" && e2ee.resetElsewhere) {
      // The account's keys changed elsewhere: this device's keys were archived
      // (old messages stay readable here), never silently deleted.
      promptedRef.current = `${userId}:${e2ee.phase}`;
      toast.warning(gt("Encryption was reset on another device"), {
        description: gt("Your older encrypted messages stay readable here. Set this device up again to read and send new ones. If you didn't reset it, change your password."),
        action: { label: gt("Set up"), onClick: () => openE2eeDialog("restore") },
        duration: 30_000,
      });
    } else if (e2ee.phase === "needs-restore" && e2ee.enabled) {
      promptedRef.current = `${userId}:${e2ee.phase}`;
      toast(e2ee.keysLost ? gt("This browser cleared your encryption keys") : gt("Your encrypted messages are locked on this device"), {
        description: gt("Scan a code with a device that's already set up, or enter your recovery passphrase."),
        action: { label: gt("Set up"), onClick: () => openE2eeDialog("restore") },
        duration: 15_000,
      });
    }
    // Decided when the state changes, not on every navigation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, e2ee.phase, e2ee.remindPassphrase, e2ee.requirePinSetup, e2ee.hasPin, e2ee.enabled, e2ee.resetElsewhere, e2ee.keysLost, gt]);

  // New device whose account has a PIN: "Enter your PIN" the first time the
  // DM list opens this session (DM pages show it inline).
  const onDmList = pathname === "/channels/me" || pathname === "/channels/messages";
  useEffect(() => {
    if (!userId || !onDmList || e2ee.phase !== "needs-restore" || !e2ee.hasPin || !e2ee.enabled || e2ee.unlockGateDeferred) return;
    if (pinPromptedRef.current === userId) return;
    pinPromptedRef.current = userId;
    queueMicrotask(() => openE2eeDialog("pin-unlock"));
  }, [userId, onDmList, e2ee.phase, e2ee.hasPin, e2ee.enabled, e2ee.unlockGateDeferred]);

  const linkMode = dialog && (dialog.mode === "link-new" || dialog.mode === "link-approve") ? dialog.mode : null;
  const pinMode = dialog && (dialog.mode === "pin-setup" || dialog.mode === "pin-unlock" || dialog.mode === "pin-change") ? dialog.mode : null;
  const setupMode = dialog && !linkMode && !pinMode ? dialog.mode : null;

  return (
    <>
      <MountWhenOpened open={setupMode !== null}>
        <E2eeSetupDialog
          mode={setupMode}
          onClose={() => setDialog(null)}
          onModeChange={(mode) => openE2eeDialog(mode)}
        />
      </MountWhenOpened>
      <MountWhenOpened open={pinMode !== null}>
        <E2eePinDialog key={dialog?.seq} mode={pinMode} onClose={() => setDialog((d) => (d && d.seq === dialog?.seq ? null : d))} />
      </MountWhenOpened>
      {linkMode && dialog && (
        <E2eeLinkDialog
          key={dialog.seq}
          mode={linkMode}
          initialInput={dialog.options?.linkInput}
          onClose={() => setDialog((d) => (d && d.seq === dialog.seq ? null : d))}
          onUsePassphrase={linkMode === "link-new"
            ? () => {
                void loadE2eeSession().then((s) => s.cancelDeviceLink()).catch(() => {});
                openE2eeDialog("restore");
              }
            : undefined}
        />
      )}
    </>
  );
}

export default E2eeHost;

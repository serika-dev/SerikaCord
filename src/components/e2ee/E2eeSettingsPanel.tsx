"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useGT, useLocale } from "gt-next";
import { toast } from "sonner";
import { AlertTriangle, KeyRound, Lock, MonitorSmartphone, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { MountWhenOpened } from "@/components/ui/MountWhenOpened";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useE2ee } from "@/hooks/useE2ee";
import { loadE2eeSession, openE2eeDialog } from "@/lib/e2ee/client/state";
import type { OwnDevice } from "@/lib/e2ee/client/session";

const SafetyNumberDialog = dynamic(() => import("./SafetyNumberDialog").then((m) => m.SafetyNumberDialog), { ssr: false });

interface Contact {
  userId: string;
  name: string;
  verified: boolean;
  changed: boolean;
}

/**
 * Settings → Encryption: this device's status, the recovery passphrase, the
 * account's encrypted devices (revoke), contacts' safety numbers, and
 * "Reset encryption". Used by the desktop settings dialog and the mobile
 * settings page.
 */
export function E2eeSettingsPanel() {
  const gt = useGT();
  const locale = useLocale();
  const confirm = useConfirm();
  const e2ee = useE2ee();
  const [devices, setDevices] = useState<OwnDevice[] | null>(null);
  const [contacts, setContacts] = useState<Contact[] | null>(null);
  const [safetyUser, setSafetyUser] = useState<{ id: string; name: string } | null>(null);
  const ready = e2ee.phase === "ready";

  const [devicesVersion, setDevicesVersion] = useState(0);
  useEffect(() => {
    if (e2ee.phase === "idle" || e2ee.phase === "unavailable") return;
    let cancelled = false;
    void loadE2eeSession()
      .then((session) => session.listOwnDevices())
      .then((list) => {
        if (!cancelled) setDevices(list);
      })
      .catch(() => {
        if (!cancelled) setDevices([]);
      });
    return () => {
      cancelled = true;
    };
  }, [e2ee.phase, e2ee.deviceId, devicesVersion]);

  // Contacts whose keys this device pinned (trust on first use).
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    void (async () => {
      const session = await loadE2eeSession();
      const pins = session.listPins().slice(0, 30);
      const named = await Promise.all(
        pins.map(async (p) => {
          const res = await fetch(`/api/users/${p.userId}`).catch(() => null);
          const u = res && res.ok ? await res.json().catch(() => null) : null;
          return { userId: p.userId, name: u?.displayName || u?.username || p.userId.slice(0, 8), verified: p.verified, changed: Boolean(p.pending) };
        }),
      );
      if (!cancelled) setContacts(named);
    })().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [ready, e2ee.pinsVersion]);

  const revoke = async (device: OwnDevice) => {
    const ok = await confirm({
      title: gt("Remove this device?"),
      description: device.current
        ? gt("This device stops receiving encrypted messages until you set it up again.")
        : gt("That device stops receiving new encrypted messages. Remove devices you lost or don't use anymore."),
      confirmLabel: gt("Remove"),
    });
    if (!ok) return;
    try {
      const session = await loadE2eeSession();
      await session.revokeDevice(device.id);
      toast.success(gt("Device removed"));
      setDevicesVersion((v) => v + 1);
    } catch {
      toast.error(gt("Couldn't remove the device"));
    }
  };

  const card = "rounded-lg bg-[var(--bg-app)] p-4";
  const dateOf = (value: string | null) => (value ? new Date(value).toLocaleDateString(locale) : "");

  return (
    <div className="space-y-4">
      <div className={cn(card, "flex items-start gap-3")}>
        <div className="w-10 h-10 rounded-lg bg-[var(--bg-card)] flex items-center justify-center flex-shrink-0">
          {ready ? <Lock className="w-5 h-5 text-green-500" /> : <AlertTriangle className="w-5 h-5 text-amber-500" />}
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-sm font-medium text-[var(--text-primary)]">
            {ready
              ? gt("End-to-end encryption is on for this device")
              : e2ee.phase === "needs-restore"
                ? gt("This device doesn't have your encryption keys yet")
                : e2ee.phase === "unavailable"
                  ? gt("Encryption isn't available in this browser")
                  : e2ee.phase === "disabled"
                    ? gt("End-to-end encryption isn't available yet")
                    : e2ee.phase === "error"
                      ? gt("Encryption couldn't start on this device")
                      : gt("Loading...")}
          </p>
          <p className="text-xs text-[var(--text-secondary)]">
            {ready
              ? gt("Direct messages, group messages and calls in encrypted conversations can only be read by the people in them. Not even SerikaCord can read them.")
              : e2ee.phase === "needs-restore"
                ? gt("Set it up with a device that's already set up (scan a code), or with your recovery passphrase, to read and send encrypted messages here.")
                : e2ee.phase === "unavailable"
                  ? gt("Your browser blocks the storage encryption keys need (for example in a private window).")
                  : gt("Your messages are still protected in transit and encrypted at rest on our servers.")}
          </p>
          {e2ee.phase === "needs-restore" && (
            <div className="flex flex-wrap gap-2 pt-2">
              <Button size="sm" onClick={() => openE2eeDialog("link-new")}>{gt("Use another device")}</Button>
              <Button size="sm" variant="secondary" onClick={() => openE2eeDialog("restore")}>{gt("Use recovery passphrase")}</Button>
              <Button size="sm" variant="ghost" onClick={() => openE2eeDialog("reset")}>{gt("Reset encryption")}</Button>
            </div>
          )}
        </div>
      </div>

      {ready && (
        <div className={cn(card, "flex items-start gap-3")}>
          <div className="w-10 h-10 rounded-lg bg-[var(--bg-card)] flex items-center justify-center flex-shrink-0">
            <KeyRound className="w-5 h-5 text-[var(--app-accent)]" />
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <p className="text-sm font-medium text-[var(--text-primary)]">{gt("Recovery passphrase")}</p>
            <p className="text-xs text-[var(--text-secondary)]">
              {e2ee.hasPassphrase
                ? gt("Set. Use it to read your encrypted messages on a new device.")
                : gt("Not set. If you lose this device, you lose your encrypted message history.")}
            </p>
            <div className="flex flex-wrap gap-2 pt-2">
              <Button size="sm" onClick={() => openE2eeDialog(e2ee.hasPassphrase ? "change-passphrase" : "onboard")}>
                {e2ee.hasPassphrase ? gt("Change passphrase") : gt("Set passphrase")}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => openE2eeDialog("reset")}>
                {gt("Reset encryption")}
              </Button>
            </div>
          </div>
        </div>
      )}

      {ready && (
        <div className={cn(card, "flex items-start gap-3")}>
          <div className="w-10 h-10 rounded-lg bg-[var(--bg-card)] flex items-center justify-center flex-shrink-0">
            <MonitorSmartphone className="w-5 h-5 text-[var(--app-accent)]" />
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <p className="text-sm font-medium text-[var(--text-primary)]">{gt("Link a new device")}</p>
            <p className="text-xs text-[var(--text-secondary)]">
              {gt("Signed in on a new phone or computer? It shows a code while setting up encryption: scan or type it here. No passphrase needed.")}
            </p>
            <div className="flex flex-wrap gap-2 pt-2">
              <Button size="sm" onClick={() => openE2eeDialog("link-approve")}>{gt("Link a new device")}</Button>
            </div>
          </div>
        </div>
      )}

      {devices && devices.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-xs font-bold uppercase text-[var(--text-secondary)]">{gt("Encrypted devices")}</h3>
          {devices.map((device) => (
            <div key={device.id} className={cn(card, "flex items-center justify-between gap-3", device.current && "ring-1 ring-[var(--app-accent)]/40")}>
              <div className="flex items-center gap-3 min-w-0">
                <MonitorSmartphone className="w-5 h-5 text-[var(--app-accent)] flex-shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-[var(--text-primary)] truncate">
                    {device.name || gt("Unknown device")}
                    {device.current && (
                      <span className="ml-2 px-1.5 py-0.5 text-[10px] font-bold rounded bg-[var(--app-accent)]/20 text-[var(--app-accent)]">
                        {gt("This device")}
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-[var(--text-secondary)]">
                    {gt("Added {date} · last seen {seen}", { date: dateOf(device.createdAt), seen: dateOf(device.lastSeenAt) })}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => void revoke(device)}
                className="px-3 py-1.5 rounded bg-red-500/10 text-red-400 hover:bg-red-500/20 text-sm flex-shrink-0"
              >
                {gt("Remove")}
              </button>
            </div>
          ))}
        </section>
      )}

      {ready && contacts && contacts.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-xs font-bold uppercase text-[var(--text-secondary)]">{gt("Safety numbers")}</h3>
          <p className="text-xs text-[var(--text-secondary)]">
            {gt("Compare a safety number with the other person to make sure nobody is in the middle of your conversation.")}
          </p>
          {contacts.map((c) => (
            <button
              key={c.userId}
              type="button"
              onClick={() => setSafetyUser({ id: c.userId, name: c.name })}
              className={cn(card, "w-full flex items-center justify-between gap-3 text-left hover:bg-[var(--bg-hover)] transition-colors")}
            >
              <span className="text-sm text-[var(--text-primary)] truncate">{c.name}</span>
              <span className={cn("text-xs flex items-center gap-1 flex-shrink-0", c.changed ? "text-amber-500" : c.verified ? "text-green-500" : "text-[var(--text-secondary)]")}>
                {c.changed ? <AlertTriangle className="w-3.5 h-3.5" /> : <ShieldCheck className="w-3.5 h-3.5" />}
                {c.changed ? gt("Security code changed") : c.verified ? gt("Verified") : gt("Not verified")}
              </span>
            </button>
          ))}
        </section>
      )}

      <MountWhenOpened open={safetyUser !== null}>
        <SafetyNumberDialog user={safetyUser} onClose={() => setSafetyUser(null)} />
      </MountWhenOpened>
    </div>
  );
}

export default E2eeSettingsPanel;

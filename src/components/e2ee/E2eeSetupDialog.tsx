"use client";

import { useState } from "react";
import { useGT } from "gt-next";
import { toast } from "sonner";
import { KeyRound, Lock, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { loadE2eeSession, type E2eeDialogRequest } from "@/lib/e2ee/client/state";
import { useE2ee } from "@/hooks/useE2ee";

const MIN_LENGTH = 10;

/** 0 (weak) … 4 (strong): length plus character variety. */
function passphraseStrength(value: string): number {
  const v = value.normalize("NFKC").trim();
  if (v.length < MIN_LENGTH) return 0;
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/, /\s/].filter((re) => re.test(v)).length;
  let score = 1;
  if (v.length >= 14) score++;
  if (v.length >= 20) score++;
  if (classes >= 3) score++;
  return Math.min(4, score);
}

interface E2eeSetupDialogProps {
  mode: E2eeDialogRequest | null;
  onClose: () => void;
  onModeChange: (mode: E2eeDialogRequest) => void;
}

/**
 * Recovery passphrase onboarding / change, restore on a new device, and
 * "Reset encryption". Keys never leave the device unencrypted: the passphrase
 * seals them before upload (lib/e2ee/backup).
 */
export function E2eeSetupDialog({ mode, onClose, onModeChange }: E2eeSetupDialogProps) {
  const gt = useGT();
  const e2ee = useE2ee();
  const [passphrase, setPassphrase] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setPassphrase("");
    setConfirmation("");
    setError(null);
    setBusy(false);
  };
  const close = () => {
    reset();
    onClose();
  };

  const strength = passphraseStrength(passphrase);
  const strengthLabel = [gt("Too short"), gt("Weak"), gt("Okay"), gt("Good"), gt("Strong")][strength];
  const settingPassphrase = mode === "onboard" || mode === "change-passphrase";
  const canSave = strength > 0 && passphrase === confirmation;

  const savePassphrase = async () => {
    if (!canSave) return;
    setBusy(true);
    setError(null);
    try {
      const session = await loadE2eeSession();
      await session.setRecoveryPassphrase(passphrase);
      toast.success(gt("Recovery passphrase saved"));
      close();
    } catch {
      setError(gt("Couldn't save the passphrase. Try again."));
      setBusy(false);
    }
  };

  const snooze = async () => {
    try {
      const session = await loadE2eeSession();
      await session.snoozePassphraseReminder();
    } catch {
      /* the reminder just shows again */
    }
    close();
  };

  const restore = async () => {
    if (!passphrase) return;
    setBusy(true);
    setError(null);
    try {
      const session = await loadE2eeSession();
      await session.restoreFromPassphrase(passphrase);
      toast.success(gt("Encryption restored on this device"));
      close();
    } catch (err) {
      const name = err instanceof Error ? err.name : "";
      setError(name === "E2eeVerifyError" ? gt("That passphrase isn't right.") : gt("Couldn't restore your keys. Try again."));
      setBusy(false);
    }
  };

  const resetEncryption = async () => {
    setBusy(true);
    setError(null);
    try {
      const session = await loadE2eeSession();
      await session.resetEncryption();
      toast.success(gt("Encryption was reset. Set a recovery passphrase for your new keys."));
      reset();
      onModeChange("onboard");
    } catch {
      setError(gt("Couldn't reset encryption. Try again."));
      setBusy(false);
    }
  };

  return (
    <Dialog open={mode !== null} onOpenChange={(open) => !open && !busy && close()}>
      <DialogContent className="bg-[var(--bg-card)] border-[var(--border-subtle)] text-[var(--text-primary)] max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {mode === "reset" ? <ShieldAlert className="h-5 w-5 text-red-500" /> : mode === "restore" ? <KeyRound className="h-5 w-5 text-[var(--app-accent)]" /> : <Lock className="h-5 w-5 text-[var(--app-accent)]" />}
            {mode === "onboard"
              ? gt("Protect your encrypted messages")
              : mode === "change-passphrase"
                ? gt("Change recovery passphrase")
                : mode === "restore"
                  ? gt("Restore encrypted messages")
                  : gt("Reset encryption")}
          </DialogTitle>
          <DialogDescription className="text-[var(--text-secondary)]">
            {mode === "onboard"
              ? gt("Your direct messages and calls are end-to-end encrypted. Choose a recovery passphrase so you can read them on a new device. We never see it, and we can't recover it for you.")
              : mode === "change-passphrase"
                ? gt("Your keys are sealed again with the new passphrase. The old one stops working.")
                : mode === "restore"
                  ? gt("This device doesn't have your encryption keys yet. Enter your recovery passphrase to read your encrypted messages here.")
                  : gt("This creates new encryption keys. Encrypted messages from before can't be read on new devices anymore, and your contacts will see that your security code changed.")}
          </DialogDescription>
        </DialogHeader>

        {settingPassphrase && (
          <div className="flex flex-col gap-2">
            <Input
              type="password"
              autoComplete="new-password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              placeholder={gt("Recovery passphrase (at least 10 characters)")}
              aria-label={gt("Recovery passphrase")}
            />
            <div className="flex items-center gap-2" aria-live="polite">
              <div className="flex flex-1 gap-1">
                {[1, 2, 3, 4].map((i) => (
                  <span
                    key={i}
                    className={cn(
                      "h-1 flex-1 rounded-full",
                      strength >= i
                        ? strength >= 3 ? "bg-green-500" : strength === 2 ? "bg-amber-500" : "bg-red-500"
                        : "bg-[var(--app-border)]",
                    )}
                  />
                ))}
              </div>
              <span className="text-xs text-[var(--app-muted)] w-16 text-right">{strengthLabel}</span>
            </div>
            <Input
              type="password"
              autoComplete="new-password"
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
              placeholder={gt("Repeat the passphrase")}
              aria-label={gt("Repeat the passphrase")}
            />
            {confirmation && passphrase !== confirmation && (
              <p className="text-xs text-red-400">{gt("The passphrases don't match.")}</p>
            )}
            {mode === "onboard" && (
              <p className="text-xs text-[var(--app-muted)]">
                {gt("If you skip this and lose this device, you lose your encrypted message history.")}
              </p>
            )}
          </div>
        )}

        {mode === "restore" && (
          e2ee.serverHasBackup ? (
            <Input
              type="password"
              autoComplete="current-password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void restore();
              }}
              placeholder={gt("Recovery passphrase")}
              aria-label={gt("Recovery passphrase")}
            />
          ) : (
            <p className="text-sm text-[var(--text-secondary)]">
              {gt("You didn't set a recovery passphrase, so your keys can't be restored here. Open SerikaCord on a device that still has them, or reset encryption.")}
            </p>
          )
        )}

        {error && <p className="text-sm text-red-400">{error}</p>}

        <DialogFooter className="gap-2 sm:justify-between">
          {mode === "onboard" && (
            <Button variant="ghost" onClick={() => void snooze()} disabled={busy}>
              {gt("Not now")}
            </Button>
          )}
          {mode === "restore" && (
            <Button variant="ghost" onClick={() => { reset(); onModeChange("reset"); }} disabled={busy}>
              {gt("Forgot it? Reset encryption")}
            </Button>
          )}
          {(mode === "change-passphrase" || mode === "reset") && (
            <Button variant="ghost" onClick={close} disabled={busy}>
              {gt("Cancel")}
            </Button>
          )}
          {settingPassphrase && (
            <Button onClick={() => void savePassphrase()} disabled={!canSave || busy}>
              {gt("Save passphrase")}
            </Button>
          )}
          {mode === "restore" && e2ee.serverHasBackup && (
            <Button onClick={() => void restore()} disabled={!passphrase || busy}>
              {busy ? gt("Restoring…") : gt("Restore")}
            </Button>
          )}
          {mode === "reset" && (
            <Button onClick={() => void resetEncryption()} disabled={busy} className="bg-red-600 text-white hover:bg-red-700">
              {gt("Reset encryption")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

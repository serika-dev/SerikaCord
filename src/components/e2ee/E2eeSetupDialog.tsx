"use client";

import { useState } from "react";
import { useGT } from "gt-next";
import { toast } from "sonner";
import { KeyRound, Lock, MonitorSmartphone, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { loadE2eeSession, type E2eeDialogRequest } from "@/lib/e2ee/client/state";
import { MIN_RECOVERY_PASSPHRASE_STRENGTH, passphraseStrength } from "@/lib/e2ee/passphrase";
import { useE2ee } from "@/hooks/useE2ee";

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
  // Changing a sealed passphrase: the current one (keys here can't be exported).
  const [currentPassphrase, setCurrentPassphrase] = useState("");
  // Reset: the account password (step-up check on the server).
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setPassphrase("");
    setConfirmation("");
    setCurrentPassphrase("");
    setPassword("");
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
  const needsCurrent = settingPassphrase && !e2ee.keysExtractable && e2ee.serverHasBackup;
  const canSave = strength >= MIN_RECOVERY_PASSPHRASE_STRENGTH && passphrase === confirmation && (!needsCurrent || currentPassphrase.length > 0);

  const savePassphrase = async () => {
    if (!canSave) return;
    setBusy(true);
    setError(null);
    try {
      const session = await loadE2eeSession();
      await session.setRecoveryPassphrase(passphrase, needsCurrent ? currentPassphrase : undefined);
      toast.success(gt("Recovery passphrase saved"));
      close();
    } catch (err) {
      const name = err instanceof Error ? err.name : "";
      setError(
        name === "E2eeVerifyError" || name === "E2eeCurrentPassphraseError"
          ? gt("Your current passphrase isn't right.")
          : gt("Couldn't save the passphrase. Try again."),
      );
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
      const status = (err as { status?: number } | null)?.status;
      setError(
        name === "E2eeVerifyError"
          ? gt("That passphrase isn't right.")
          : name === "E2eeFormatError"
            ? gt("This backup doesn't match your current keys. Reset encryption to start over.")
            : status === 409
              ? gt("You can have up to 10 encrypted devices. Remove one in Settings → Encryption on another device first.")
              : gt("Couldn't restore your keys. Try again."),
      );
      setBusy(false);
    }
  };

  const resetEncryption = async () => {
    if (!password) return;
    setBusy(true);
    setError(null);
    try {
      const session = await loadE2eeSession();
      await session.resetEncryption(password);
      toast.success(gt("Encryption was reset. Set a recovery passphrase for your new keys."));
      reset();
      onModeChange("onboard");
    } catch (err) {
      const status = err instanceof Error && err.name === "E2eeApiError" ? (err as Error & { status?: number }).status : null;
      setError(
        status === 403
          ? gt("That password isn't right.")
          : status === 429
            ? gt("Too many attempts. Wait a moment and try again.")
            : gt("Couldn't reset encryption. Try again."),
      );
      setBusy(false);
    }
  };

  return (
    <Dialog open={mode !== null} onOpenChange={(open) => !open && !busy && close()}>
      <DialogContent className="bg-[var(--bg-card)] border-[var(--border-subtle)] text-[var(--text-primary)] max-w-md max-h-[100dvh] sm:max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {mode === "reset" ? <ShieldAlert className="h-5 w-5 text-red-500" /> : mode === "restore" ? <KeyRound className="h-5 w-5 text-[var(--app-accent)]" /> : <Lock className="h-5 w-5 text-[var(--app-accent)]" />}
            {mode === "onboard"
              ? gt("Protect your encrypted messages")
              : mode === "change-passphrase"
                ? gt("Change recovery passphrase")
                : mode === "restore"
                  ? gt("Set up encryption on this device")
                  : gt("Reset encryption")}
          </DialogTitle>
          <DialogDescription className="text-[var(--text-secondary)]">
            {mode === "onboard"
              ? gt("Your direct messages and calls are end-to-end encrypted. Choose a recovery passphrase so you can read them on a new device. We never see it, and we can't recover it for you.")
              : mode === "change-passphrase"
                ? gt("Your keys are sealed again with the new passphrase. The old one stops working.")
                : mode === "restore"
                  ? e2ee.keysLost
                    ? gt("This browser cleared the encryption keys it had (for example after clearing site data). Set it up again with another device or your recovery passphrase.")
                    : gt("This device doesn't have your encryption keys yet. Set it up with a device that already has them, or with your recovery passphrase.")
                  : gt("This creates new encryption keys. Encrypted messages from before stay readable on this device only, and your contacts will see that your security code changed. Enter your account password to confirm.")}
          </DialogDescription>
        </DialogHeader>

        {settingPassphrase && (
          <div className="flex flex-col gap-2">
            {needsCurrent && (
              <Input
                type="password"
                autoComplete="current-password"
                value={currentPassphrase}
                onChange={(e) => setCurrentPassphrase(e.target.value)}
                placeholder={gt("Current recovery passphrase")}
                aria-label={gt("Current recovery passphrase")}
              />
            )}
            <Input
              type="password"
              autoComplete="new-password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              placeholder={gt("Recovery passphrase")}
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
            {passphrase && strength < MIN_RECOVERY_PASSPHRASE_STRENGTH && (
              <p className="text-xs text-[var(--app-muted)]">
                {gt("Use at least 14 characters mixing letters, numbers and symbols, or a phrase of several uncommon words. Common passwords don't count.")}
              </p>
            )}
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
          <div className="flex flex-col gap-2 rounded-lg border border-[var(--border-subtle)] p-3">
            <p className="text-sm font-medium text-[var(--text-primary)]">{gt("Use a device that's already set up")}</p>
            <p className="text-xs text-[var(--text-secondary)]">
              {gt("Show a code here and scan it with your phone or another computer where you can read your encrypted messages. No passphrase needed.")}
            </p>
            <Button onClick={() => { reset(); onModeChange("link-new"); }} disabled={busy}>
              <MonitorSmartphone className="h-4 w-4 mr-1" />
              {gt("Show a code")}
            </Button>
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
              {gt("You didn't set a recovery passphrase, so use a device that's already set up, or reset encryption.")}
            </p>
          )
        )}

        {mode === "reset" && (
          <Input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void resetEncryption();
            }}
            placeholder={gt("Account password")}
            aria-label={gt("Account password")}
          />
        )}

        {busy && (mode === "restore" || settingPassphrase) && (
          <p className="text-xs text-[var(--app-muted)]" aria-live="polite">
            {gt("Protecting your keys with the passphrase takes a few seconds on some phones.")}
          </p>
        )}
        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}

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
              {busy ? gt("Saving…") : gt("Save passphrase")}
            </Button>
          )}
          {mode === "restore" && e2ee.serverHasBackup && (
            <Button onClick={() => void restore()} disabled={!passphrase || busy}>
              {busy ? gt("Restoring…") : gt("Restore")}
            </Button>
          )}
          {mode === "reset" && (
            <Button onClick={() => void resetEncryption()} disabled={busy || !password} className="bg-red-600 text-white hover:bg-red-700">
              {gt("Reset encryption")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

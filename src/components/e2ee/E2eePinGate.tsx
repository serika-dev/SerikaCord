"use client";

import { useState } from "react";
import { useGT } from "gt-next";
import { toast } from "sonner";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useE2ee } from "@/hooks/useE2ee";
import { loadE2eeSession, openE2eeDialog, setE2eeSnapshot } from "@/lib/e2ee/client/state";
import { PinSetupFlow, PinUnlockFlow } from "./PinFlows";

const linkButton = "text-sm font-medium text-[var(--app-accent)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-accent)] rounded disabled:opacity-50";

/**
 * Shown by DM / group DM pages instead of the conversation while this
 * account has no PIN yet ("Create a 6-digit PIN" / "Upgrade to a 6-digit
 * PIN") or this device has no keys ("Enter your PIN"). Server channels are
 * never gated.
 */
export function E2eePinGate({ mode }: { mode: "setup" | "unlock" }) {
  const e2ee = useE2ee();
  return (
    <div className="flex flex-1 min-h-0 items-start sm:items-center justify-center overflow-y-auto p-4">
      <div className="w-full max-w-sm rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-5 shadow-sm">
        <div className="mb-3 flex justify-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--app-accent)]/15">
            <Lock className="h-5 w-5 text-[var(--app-accent)]" aria-hidden />
          </span>
        </div>
        {mode === "setup" ? (
          <PinSetupFlow />
        ) : e2ee.hasPin ? (
          <>
            <PinUnlockFlow />
            <LaterButton />
          </>
        ) : (
          <PassphraseUnlock />
        )}
      </div>
    </div>
  );
}

/** "Not now": the conversation shows (with its "set up this device" notice) for the rest of this session. */
function LaterButton() {
  const gt = useGT();
  return (
    <div className="mt-3 flex justify-center">
      <Button variant="ghost" size="sm" onClick={() => setE2eeSnapshot({ unlockGateDeferred: true })}>
        {gt("Not now")}
      </Button>
    </div>
  );
}

/** A device without keys on an account without a PIN: the recovery passphrase (then a PIN is created), another device, or a reset. */
function PassphraseUnlock() {
  const gt = useGT();
  const e2ee = useE2ee();
  const [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const restore = async () => {
    if (!passphrase || busy) return;
    setBusy(true);
    setError(null);
    try {
      const session = await loadE2eeSession();
      await session.restoreFromPassphrase(passphrase);
      setPassphrase("");
      toast.success(gt("Your encrypted messages are unlocked on this device."));
    } catch (err) {
      const name = err instanceof Error ? err.name : "";
      const status = (err as { status?: number } | null)?.status;
      setError(
        name === "E2eeVerifyError"
          ? gt("That passphrase isn't right.")
          : name === "E2eeFormatError"
            ? gt("This backup doesn't match your current keys. Start over with new keys to keep using encryption.")
            : status === 409
              ? gt("You can have up to 10 encrypted devices. Remove one in Settings → Encryption on another device first.")
              : gt("Couldn't restore your keys. Try again."),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="space-y-1 text-center">
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">{gt("Unlock your encrypted messages")}</h2>
        <p className="text-sm text-[var(--text-secondary)]">
          {e2ee.serverHasBackup
            ? gt("Enter your recovery passphrase. You'll then create a 6-digit PIN, so new devices are easier to set up.")
            : gt("This device doesn't have your encryption keys yet. To read your encrypted messages here, approve it from a device that's already set up.")}
        </p>
        {!e2ee.serverHasBackup && (
          <p className="text-xs text-[var(--app-muted)]">
            {gt("Your account has no PIN yet, so it can't be used here. On a device that's already set up, create one in Settings → Encryption, then you can unlock any new device with it.")}
          </p>
        )}
      </div>
      {e2ee.serverHasBackup && (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void restore();
          }}
        >
          <Input
            type="password"
            autoComplete="off"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            placeholder={gt("Recovery passphrase")}
            aria-label={gt("Recovery passphrase")}
            disabled={busy}
          />
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
          {busy && <p className="text-xs text-[var(--app-muted)]" aria-live="polite">{gt("Protecting your keys with the passphrase takes a few seconds on some phones.")}</p>}
          <Button type="submit" disabled={!passphrase || busy}>{busy ? gt("Restoring…") : gt("Unlock")}</Button>
        </form>
      )}
      <div className="flex flex-col items-center gap-2 pt-1">
        <button type="button" className={linkButton} disabled={busy} onClick={() => openE2eeDialog("link-new")}>
          {gt("Use another device instead")}
        </button>
        <button type="button" className={linkButton} disabled={busy} onClick={() => openE2eeDialog("reset")}>
          {e2ee.serverHasBackup ? gt("Forgot your passphrase? Start over with new keys") : gt("Start over with new keys")}
        </button>
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => setE2eeSnapshot({ unlockGateDeferred: true })}>
          {gt("Not now")}
        </Button>
      </div>
    </div>
  );
}

export default E2eePinGate;

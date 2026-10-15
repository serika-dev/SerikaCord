"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useGT } from "gt-next";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PinInput } from "./PinInput";
import { PIN_LENGTH, isEasyPin } from "@/lib/e2ee/pin";
import { loadE2eeSession, openE2eeDialog } from "@/lib/e2ee/client/state";
import { useE2ee } from "@/hooks/useE2ee";

/** How a flow renders its heading (a DialogTitle inside dialogs, an h2 inline). */
export type TitleRenderer = (children: ReactNode) => ReactNode;

const defaultTitle: TitleRenderer = (children) => <h2 className="text-lg font-semibold text-[var(--text-primary)]">{children}</h2>;

function errorName(err: unknown): string {
  return err instanceof Error ? err.name : "";
}

function errorStatus(err: unknown): number | null {
  const status = (err as { status?: unknown } | null)?.status;
  return typeof status === "number" ? status : null;
}

function Busy({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 py-4 text-sm text-[var(--text-secondary)]" role="status" aria-live="polite">
      <Loader2 className="h-6 w-6 animate-spin text-[var(--app-accent)]" />
      {children}
    </div>
  );
}

function Description({ children }: { children: ReactNode }) {
  return <p className="text-sm text-[var(--text-secondary)]">{children}</p>;
}

function ErrorText({ children }: { children: ReactNode }) {
  return <p className="text-center text-sm text-destructive" role="alert">{children}</p>;
}

const linkButton = "text-sm font-medium text-[var(--app-accent)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-accent)] rounded disabled:opacity-50";

/** Translated text for a wrong PIN / locked backup / other PIN errors. */
function usePinErrorText() {
  const gt = useGT();
  return (err: unknown): string => {
    if (errorName(err) === "E2eePinError") {
      const e = err as { reason?: string; attemptsLeft?: number | null };
      if (e.reason === "wrong") {
        const left = typeof e.attemptsLeft === "number" ? e.attemptsLeft : null;
        if (left === null) return gt("Wrong PIN. Try again.");
        if (left === 1) return gt("Wrong PIN. 1 try left before your encrypted messages are reset.");
        if (left <= 3) return gt("Wrong PIN. {count} tries left before your encrypted messages are reset.", { count: left });
        return gt("Wrong PIN. {count} tries left.", { count: left });
      }
      if (e.reason === "locked") return gt("Too many wrong PINs, so your PIN backup was reset. Use another device or your recovery passphrase, or reset encryption.");
      if (e.reason === "no_pin") return gt("Your account doesn't have a PIN yet. Use another device or your recovery passphrase.");
      if (e.reason === "rate_limited") return gt("Too many attempts. Wait a moment and try again.");
      return gt("PINs aren't available right now. Use another device or your recovery passphrase.");
    }
    if (errorName(err) === "E2eeFormatError") return gt("This PIN backup doesn't match your current keys. Reset encryption to start over.");
    if (errorStatus(err) === 409) return gt("You can have up to 10 encrypted devices. Remove one in Settings → Encryption on another device first.");
    return gt("Something went wrong. Check your connection and try again.");
  };
}

// ─── New device: enter the PIN ────────────────────────────────────────────────

/**
 * "Enter your PIN" on a device without keys (like X): six boxes, the sixth
 * digit submits, everything decrypts right after. Tries left are shown after
 * a wrong PIN; other ways in are one tap away.
 */
export function PinUnlockFlow({ onDone, renderTitle = defaultTitle }: { onDone?: () => void; renderTitle?: TitleRenderer }) {
  const gt = useGT();
  const e2ee = useE2ee();
  const pinError = usePinErrorText();
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [locked, setLocked] = useState(false);

  const submit = async (value: string) => {
    if (busy || value.length !== PIN_LENGTH) return;
    setBusy(true);
    setError(null);
    try {
      const session = await loadE2eeSession();
      await session.unlockWithPin(value);
      toast.success(gt("Your encrypted messages are unlocked on this device."));
      onDone?.();
    } catch (err) {
      setError(pinError(err));
      if (errorName(err) === "E2eePinError" && (err as { reason?: string }).reason !== "wrong" && (err as { reason?: string }).reason !== "rate_limited") setLocked(true);
      setPin("");
      setAttempt((n) => n + 1);
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="space-y-1 text-center">
        {renderTitle(gt("Enter your PIN"))}
        <Description>{gt("Enter the 6-digit PIN you created to read your encrypted messages on this device.")}</Description>
      </div>
      {busy ? (
        <Busy>{gt("Unlocking…")}</Busy>
      ) : (
        !locked && (
          <PinInput
            key={attempt}
            value={pin}
            onChange={setPin}
            onComplete={(v) => void submit(v)}
            label={gt("Enter your PIN")}
            invalid={Boolean(error)}
            autoFocus
            purpose="current"
          />
        )
      )}
      {error && <ErrorText>{error}</ErrorText>}
      <div className="flex flex-col items-center gap-2 pt-1">
        <button type="button" className={linkButton} disabled={busy} onClick={() => openE2eeDialog("link-new")}>
          {gt("Use another device instead")}
        </button>
        {e2ee.serverHasBackup && (
          <button type="button" className={linkButton} disabled={busy} onClick={() => openE2eeDialog("restore")}>
            {gt("Use recovery passphrase")}
          </button>
        )}
        <button type="button" className={linkButton} disabled={busy} onClick={() => openE2eeDialog("reset")}>
          {gt("Forgot PIN? Reset encryption")}
        </button>
      </div>
    </div>
  );
}

// ─── Create / upgrade / change ────────────────────────────────────────────────

type SetupStep =
  | "loading"
  /** Upgrade: prove the account with the recovery passphrase first. */
  | "passphrase"
  /** Upgrade, passphrase forgotten: the account password instead (keys at hand here). */
  | "password"
  /** Upgrade, passphrase forgotten and the keys here are sealed: only a reset helps. */
  | "forgot-sealed"
  /** Change: the current PIN first. */
  | "current"
  | "create"
  | "confirm"
  | "saving"
  /** No PIN, no passphrase, sealed keys: set the PIN on the first device. */
  | "impossible";

/**
 * Create a 6-digit PIN (two entries), upgrade an account that has a recovery
 * passphrase (enter it once first; forgotten → account password when this
 * device still holds the keys, else a reset), or change the PIN (current
 * PIN first).
 */
export function PinSetupFlow({
  change = false,
  onDone,
  onCancel,
  renderTitle = defaultTitle,
}: {
  change?: boolean;
  onDone?: () => void;
  onCancel?: () => void;
  renderTitle?: TitleRenderer;
}) {
  const gt = useGT();
  const e2ee = useE2ee();
  const pinError = usePinErrorText();
  const [step, setStep] = useState<SetupStep>(change ? "current" : "loading");
  const [pin, setPin] = useState("");
  const [first, setFirst] = useState("");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  // Where to start: the passphrase (upgrade), the PIN itself, or nowhere here.
  useEffect(() => {
    if (change) return;
    let cancelled = false;
    void (async () => {
      const session = await loadE2eeSession();
      const recent = await session.hasRecentProof().catch(() => false);
      const proof = await session.pinSetupProof().catch(() => "impossible" as const);
      if (cancelled) return;
      if (e2ee.pinUpgrade && !recent) setStep(e2ee.serverHasBackup ? "passphrase" : proof === "none" ? "create" : "impossible");
      else setStep(proof === "none" ? "create" : proof === "passphrase" ? "passphrase" : proof === "pin" ? "current" : "impossible");
    })();
    return () => {
      cancelled = true;
    };
    // Decided once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const restart = (message: string | null, to: SetupStep = "create") => {
    setError(message);
    setPin("");
    setFirst("");
    setAttempt((n) => n + 1);
    setStep(to);
    setBusy(false);
  };

  const provePassphrase = async () => {
    if (!secret || busy) return;
    setBusy(true);
    setError(null);
    try {
      const session = await loadE2eeSession();
      await session.unlockLinkingWithPassphrase(secret);
      setSecret("");
      restart(null);
    } catch (err) {
      setBusy(false);
      setError(errorName(err) === "E2eeVerifyError" ? gt("That passphrase isn't right.") : gt("Something went wrong. Check your connection and try again."));
    }
  };

  const forgotPassphrase = async () => {
    setError(null);
    setSecret("");
    const session = await loadE2eeSession();
    const proof = await session.pinSetupProof().catch(() => "impossible" as const);
    setStep(proof === "none" ? "password" : "forgot-sealed");
  };

  const provePassword = async () => {
    if (!secret || busy) return;
    setBusy(true);
    setError(null);
    try {
      const session = await loadE2eeSession();
      await session.proveWithAccountPassword(secret);
      setSecret("");
      restart(null);
    } catch (err) {
      setBusy(false);
      const status = errorStatus(err);
      setError(
        status === 403
          ? gt("That password isn't right.")
          : status === 429
            ? gt("Too many attempts. Wait a moment and try again.")
            : errorName(err) === "E2eePinProofError"
              ? gt("This device can't create a PIN without your passphrase anymore. Start again.")
              : gt("Something went wrong. Check your connection and try again."),
      );
    }
  };

  const proveCurrentPin = async (value: string) => {
    if (busy || value.length !== PIN_LENGTH) return;
    setBusy(true);
    setError(null);
    try {
      const session = await loadE2eeSession();
      await session.unlockSecretsWithPin(value);
      restart(null);
    } catch (err) {
      restart(pinError(err), "current");
    }
  };

  const save = async (value: string) => {
    setStep("saving");
    setBusy(true);
    setError(null);
    try {
      const session = await loadE2eeSession();
      await session.setPin(value);
      toast.success(change ? gt("Your PIN was changed.") : gt("PIN created. Use it to unlock your encrypted messages on new devices."));
      setBusy(false);
      onDone?.();
    } catch (err) {
      const needs = errorName(err) === "E2eePinProofError" ? (err as { needs?: string }).needs : null;
      if (needs === "pin") restart(gt("Enter your current PIN first."), "current");
      else if (needs === "passphrase") restart(gt("Enter your recovery passphrase first."), "passphrase");
      else if (needs === "impossible") restart(null, "impossible");
      else if (errorName(err) === "E2eeFormatError") restart(gt("That PIN is too easy to guess. Avoid repeated or consecutive digits."));
      else if (errorStatus(err) === 503) restart(gt("PINs aren't available right now. Try again later."));
      else restart(gt("Couldn't save your PIN. Try again."));
    }
  };

  const onCreate = (value: string) => {
    if (isEasyPin(value)) {
      restart(gt("That PIN is too easy to guess. Avoid repeated or consecutive digits."));
      return;
    }
    setFirst(value);
    setPin("");
    setError(null);
    setAttempt((n) => n + 1);
    setStep("confirm");
  };

  const onConfirm = (value: string) => {
    if (value !== first) {
      restart(gt("The PINs didn't match. Try again."));
      return;
    }
    void save(value);
  };

  const cancel = onCancel ? (
    <Button variant="ghost" onClick={onCancel} disabled={busy}>
      {gt("Cancel")}
    </Button>
  ) : null;

  if (step === "loading") return <Busy>{gt("Loading...")}</Busy>;

  if (step === "saving") {
    return (
      <div className="flex flex-col gap-2">
        <div className="text-center">{renderTitle(change ? gt("Change your PIN") : gt("Create a 6-digit PIN"))}</div>
        <Busy>
          {gt("Securing your PIN…")}
          <span className="text-xs text-[var(--app-muted)]">{gt("This takes a few seconds on some phones.")}</span>
        </Busy>
      </div>
    );
  }

  if (step === "passphrase" || step === "password") {
    const isPassword = step === "password";
    return (
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void (isPassword ? provePassword() : provePassphrase());
        }}
      >
        <div className="space-y-1">
          {renderTitle(gt("Upgrade to a 6-digit PIN"))}
          <Description>
            {isPassword
              ? gt("Confirm it's you with your account password instead. Then create your PIN.")
              : gt("Encrypted messages now unlock with a 6-digit PIN on new devices. Enter your recovery passphrase once to switch, then create your PIN.")}
          </Description>
        </div>
        <Input
          type="password"
          autoComplete={isPassword ? "current-password" : "off"}
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          placeholder={isPassword ? gt("Account password") : gt("Recovery passphrase")}
          aria-label={isPassword ? gt("Account password") : gt("Recovery passphrase")}
          disabled={busy}
          autoFocus
        />
        {error && <ErrorText>{error}</ErrorText>}
        {busy && <p className="text-xs text-[var(--app-muted)]" aria-live="polite">{gt("Checking…")}</p>}
        <div className="flex flex-wrap items-center justify-between gap-2">
          {isPassword ? (
            <button type="button" className={linkButton} disabled={busy} onClick={() => restart(null, "passphrase")}>
              {gt("Use my passphrase instead")}
            </button>
          ) : (
            <button type="button" className={linkButton} disabled={busy} onClick={() => void forgotPassphrase()}>
              {gt("Forgot your passphrase?")}
            </button>
          )}
          <div className="flex gap-2">
            {cancel}
            <Button type="submit" disabled={!secret || busy}>{gt("Continue")}</Button>
          </div>
        </div>
      </form>
    );
  }

  if (step === "forgot-sealed" || step === "impossible") {
    return (
      <div className="flex flex-col gap-3">
        {renderTitle(step === "impossible" ? gt("Set your PIN on your other device") : gt("Forgot your passphrase?"))}
        <Description>
          {step === "impossible"
            ? gt("This device can't export your encryption keys. Create your PIN on the device where you first set up encryption, or reset encryption to start over.")
            : gt("Without your passphrase, this device can't put your encryption keys into a PIN backup. You can reset encryption instead: messages from before stay readable on this device, and your contacts will see that your security code changed.")}
        </Description>
        <div className="flex flex-wrap justify-end gap-2">
          {step === "forgot-sealed" && (
            <Button variant="ghost" onClick={() => restart(null, "passphrase")}>{gt("Back")}</Button>
          )}
          {cancel}
          <Button variant="destructive" onClick={() => openE2eeDialog("reset")}>{gt("Reset encryption")}</Button>
        </div>
      </div>
    );
  }

  const heading = step === "current"
    ? gt("Enter your current PIN")
    : step === "confirm"
      ? gt("Confirm your PIN")
      : change ? gt("Choose a new PIN") : gt("Create a 6-digit PIN");
  const description = step === "current"
    ? gt("Enter the PIN you use now to change it.")
    : step === "confirm"
      ? gt("Enter the same 6 digits again.")
      : gt("You'll use it to unlock your encrypted messages on new devices. We can't see it.");

  return (
    <div className="flex flex-col gap-4">
      <div className="space-y-1 text-center">
        {renderTitle(heading)}
        <Description>{description}</Description>
      </div>
      {busy ? (
        <Busy>{gt("Checking…")}</Busy>
      ) : (
        <PinInput
          key={`${step}-${attempt}`}
          value={pin}
          onChange={setPin}
          onComplete={(v) => {
            if (step === "current") void proveCurrentPin(v);
            else if (step === "create") onCreate(v);
            else onConfirm(v);
          }}
          label={heading}
          invalid={Boolean(error)}
          autoFocus
          purpose={step === "current" ? "current" : "new"}
        />
      )}
      {error && <ErrorText>{error}</ErrorText>}
      {(cancel || step === "confirm") && (
        <div className="flex justify-center gap-2">
          {step === "confirm" && (
            <Button variant="ghost" onClick={() => restart(null)}>{gt("Start over")}</Button>
          )}
          {cancel}
        </div>
      )}
    </div>
  );
}

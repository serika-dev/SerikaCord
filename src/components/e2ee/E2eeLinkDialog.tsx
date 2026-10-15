"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useGT, useLocale } from "gt-next";
import { toast } from "sonner";
import { Camera, CheckCircle2, KeyRound, Loader2, MonitorSmartphone, ShieldAlert, ShieldCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { loadE2eeSession, type E2eeDialogRequest } from "@/lib/e2ee/client/state";
import { formatLinkCode, formatSas } from "@/lib/e2ee/link";
import type { LinkProgress, LinkRequestInfo } from "@/lib/e2ee/client/session";

const POLL_MS = 1500;

interface E2eeLinkDialogProps {
  mode: Extract<E2eeDialogRequest, "link-new" | "link-approve">;
  /** link-approve: a code / scanned link to start with. */
  initialInput?: string;
  onClose: () => void;
  /** link-new: "Use my recovery passphrase instead". */
  onUsePassphrase?: () => void;
}

/** Calls `fn` every POLL_MS and whenever the account's sessions are told the request moved on. */
function usePoll(active: boolean, fn: () => void) {
  const fnRef = useRef(fn);
  useEffect(() => {
    fnRef.current = fn;
  });
  useEffect(() => {
    if (!active) return;
    const tick = () => fnRef.current();
    const timer = window.setInterval(tick, POLL_MS);
    window.addEventListener("serika:e2ee-link", tick);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("serika:e2ee-link", tick);
    };
  }, [active]);
}

/**
 * A poll error that ends the flow: the server refused (expired, used, rate
 * limited, unavailable) or a check failed. Anything else (a network blip) just
 * waits for the next poll.
 */
function isFatalLinkError(err: unknown): boolean {
  const status = (err as { status?: number } | null)?.status;
  const name = err instanceof Error ? err.name : "";
  return typeof status === "number" || name === "E2eeVerifyError" || name === "E2eeFormatError";
}

/** The short code both devices show, large and easy to compare. */
function SasCode({ sas }: { sas: string }) {
  return (
    <div className="rounded-lg bg-[var(--app-surface-alt)] py-4 text-center font-mono text-3xl font-semibold tracking-[0.2em] text-[var(--app-text)]" aria-live="polite">
      {formatSas(sas)}
    </div>
  );
}

/**
 * Link a device without retyping the recovery passphrase
 * (docs/architecture/e2ee.md "Linking a device"):
 *  - link-new: this device shows a QR code + short code, both devices show
 *    the same 6 digits, and the keys arrive encrypted from the other device;
 *  - link-approve: this (already set up) device scans / types that code,
 *    compares the digits and sends the keys.
 */
export function E2eeLinkDialog({ mode, initialInput, onClose, onUsePassphrase }: E2eeLinkDialogProps) {
  const gt = useGT();
  const [open, setOpen] = useState(true);
  const close = useCallback(() => {
    setOpen(false);
    void loadE2eeSession().then((s) => (mode === "link-new" ? s.cancelDeviceLink() : s.cancelLinkApproval())).catch(() => {});
    onClose();
  }, [mode, onClose]);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent className="bg-[var(--bg-card)] border-[var(--border-subtle)] text-[var(--text-primary)] max-w-md max-h-[100dvh] sm:max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MonitorSmartphone className="h-5 w-5 text-[var(--app-accent)]" />
            {mode === "link-new" ? gt("Set up with another device") : gt("Link a new device")}
          </DialogTitle>
          <DialogDescription className="text-[var(--text-secondary)]">
            {mode === "link-new"
              ? gt("On a phone or computer where SerikaCord already shows your encrypted messages, open Settings → Encryption → Link a new device, then scan this code or type it in.")
              : gt("Scan the code shown on your new device, or type it in. Your encryption keys are sent to it end-to-end encrypted.")}
          </DialogDescription>
        </DialogHeader>
        {mode === "link-new" ? (
          <NewDeviceFlow onDone={close} onUsePassphrase={onUsePassphrase} />
        ) : (
          <ApproveFlow initialInput={initialInput} onDone={close} />
        )}
      </DialogContent>
    </Dialog>
  );
}

type NewState =
  | { kind: "starting" }
  | { kind: "showing"; code: string; qr: string; expiresAt: number }
  | { kind: "compare"; code: string; sas: string; received: boolean; confirmed: boolean }
  | { kind: "applying" }
  | { kind: "expired" }
  | { kind: "error"; message: string };

function NewDeviceFlow({ onDone, onUsePassphrase }: { onDone: () => void; onUsePassphrase?: () => void }) {
  const gt = useGT();
  const [state, setState] = useState<NewState>({ kind: "starting" });
  const [attempt, setAttempt] = useState(0);
  const confirmedRef = useRef(false);
  const finishingRef = useRef(false);

  const errorText = useCallback((err: unknown) => {
    const name = err instanceof Error ? err.name : "";
    const status = (err as { status?: number } | null)?.status;
    if (status === 429) return gt("Too many attempts. Wait a moment and try again.");
    if (status === 503) return gt("Linking devices is unavailable right now. Use your recovery passphrase instead.");
    if (status === 409) return gt("You can have up to 10 encrypted devices. Remove one in Settings → Encryption on another device first.");
    if (name === "E2eeVerifyError") return gt("The other device's answer didn't check out, so nothing was linked. Start again.");
    if (name === "E2eeFormatError") return gt("The keys from your other device don't match your account's current keys.");
    return gt("Couldn't link this device. Check your connection and try again.");
  }, [gt]);

  const finish = useCallback(async () => {
    if (finishingRef.current) return;
    finishingRef.current = true;
    setState({ kind: "applying" });
    try {
      const session = await loadE2eeSession();
      await session.completeDeviceLink();
      toast.success(gt("This device is set up. Your encrypted messages are readable here now."));
      onDone();
    } catch (err) {
      finishingRef.current = false;
      setState({ kind: "error", message: errorText(err) });
    }
  }, [gt, onDone, errorText]);

  // The request must open once per attempt, whatever re-renders `gt` causes.
  const errorTextRef = useRef(errorText);
  useEffect(() => {
    errorTextRef.current = errorText;
  });

  // Open a request (again on "Start again").
  useEffect(() => {
    let cancelled = false;
    confirmedRef.current = false;
    finishingRef.current = false;
    void (async () => {
      try {
        const session = await loadE2eeSession();
        const link = await session.startDeviceLink();
        if (cancelled) {
          // Closed while the request was opening: don't leave it on the server.
          void session.cancelDeviceLink();
          return;
        }
        const QRCode = (await import("qrcode")).default;
        // Black on white whatever the theme: phone cameras read that best.
        const qr = await QRCode.toDataURL(link.qr, { width: 280, margin: 1, errorCorrectionLevel: "M", color: { dark: "#000000", light: "#ffffff" } });
        if (!cancelled) setState({ kind: "showing", code: link.code, qr, expiresAt: link.expiresAt });
      } catch (err) {
        if (!cancelled) setState({ kind: "error", message: errorTextRef.current(err) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const polling = state.kind === "showing" || state.kind === "compare";
  usePoll(polling, () => {
    void (async () => {
      let progress: LinkProgress;
      try {
        progress = await (await loadE2eeSession()).pollDeviceLink();
      } catch (err) {
        if (isFatalLinkError(err)) setState({ kind: "error", message: errorText(err) });
        return;
      }
      if (progress.step === "expired") {
        if (!finishingRef.current) setState({ kind: "expired" });
        return;
      }
      if (progress.step === "compare" || progress.step === "received") {
        const received = progress.step === "received";
        setState((prev) => ({
          kind: "compare",
          code: prev.kind === "showing" || prev.kind === "compare" ? prev.code : "",
          sas: progress.sas,
          received,
          confirmed: confirmedRef.current,
        }));
        if (received && confirmedRef.current) void finish();
      }
    })();
  });

  const confirm = () => {
    confirmedRef.current = true;
    if (state.kind !== "compare") return;
    if (state.received) void finish();
    else setState({ ...state, confirmed: true });
  };

  const mismatch = () => {
    void loadE2eeSession().then((s) => s.cancelDeviceLink()).catch(() => {});
    setState({ kind: "error", message: gt("Linking was stopped because the numbers didn't match. If you didn't start this, someone may be trying to get your keys: change your password.") });
  };

  if (state.kind === "starting" || state.kind === "applying") {
    return (
      <div className="flex flex-col items-center gap-3 py-6 text-sm text-[var(--text-secondary)]">
        <Loader2 className="h-6 w-6 animate-spin text-[var(--app-accent)]" />
        {state.kind === "applying" ? gt("Setting up encryption on this device…") : gt("Preparing a code…")}
      </div>
    );
  }

  if (state.kind === "showing") {
    return (
      <div className="flex flex-col items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={state.qr} alt={gt("QR code to link this device")} width={220} height={220} className="h-[220px] w-[220px] rounded-lg bg-white p-2" />
        <div className="text-center">
          <p className="text-xs text-[var(--app-muted)]">{gt("Or type this code on the other device")}</p>
          <p className="font-mono text-2xl font-semibold tracking-widest text-[var(--app-text)] select-all">{formatLinkCode(state.code)}</p>
        </div>
        <p className="text-xs text-[var(--app-muted)] text-center">{gt("The code works once and expires in 5 minutes.")}</p>
        {onUsePassphrase && (
          <Button variant="ghost" size="sm" onClick={onUsePassphrase}>
            <KeyRound className="h-4 w-4 mr-1" />
            {gt("Use my recovery passphrase instead")}
          </Button>
        )}
      </div>
    );
  }

  if (state.kind === "compare") {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-[var(--text-secondary)]">{gt("Check that your other device shows exactly this number:")}</p>
        <SasCode sas={state.sas} />
        {state.confirmed ? (
          <p className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
            <Loader2 className="h-4 w-4 animate-spin" />
            {gt("Now confirm on your other device…")}
          </p>
        ) : (
          <DialogFooter className="gap-2 sm:justify-between">
            <Button variant="ghost" onClick={mismatch}>
              <X className="h-4 w-4 mr-1" />
              {gt("The numbers are different")}
            </Button>
            <Button onClick={confirm}>
              <ShieldCheck className="h-4 w-4 mr-1" />
              {gt("They match")}
            </Button>
          </DialogFooter>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-destructive" role="alert">
        {state.kind === "expired" ? gt("This code expired. Start again to get a new one.") : state.message}
      </p>
      <DialogFooter className="gap-2 sm:justify-between">
        {onUsePassphrase && (
          <Button variant="ghost" onClick={onUsePassphrase}>
            {gt("Use my recovery passphrase instead")}
          </Button>
        )}
        <Button onClick={() => { setState({ kind: "starting" }); setAttempt((a) => a + 1); }}>{gt("Start again")}</Button>
      </DialogFooter>
    </div>
  );
}

type ApproveState =
  | { kind: "input" }
  | { kind: "checking" }
  | { kind: "confirm"; input: string; info: LinkRequestInfo }
  | { kind: "joining" }
  | { kind: "waiting" }
  | { kind: "compare"; sas: string }
  | { kind: "passphrase"; sas: string }
  | { kind: "sending"; sas: string }
  | { kind: "sent"; sas: string }
  | { kind: "error"; message: string };

function ApproveFlow({ initialInput, onDone }: { initialInput?: string; onDone: () => void }) {
  const gt = useGT();
  const [input, setInput] = useState(initialInput ?? "");
  const [state, setState] = useState<ApproveState>(initialInput ? { kind: "checking" } : { kind: "input" });
  const locale = useLocale();
  const [scanning, setScanning] = useState(false);
  const [passphrase, setPassphrase] = useState("");
  const [passphraseError, setPassphraseError] = useState<string | null>(null);
  const startedRef = useRef(false);

  const errorText = useCallback((err: unknown) => {
    const name = err instanceof Error ? err.name : "";
    const status = (err as { status?: number } | null)?.status;
    if (status === 404) return gt("That code isn't valid or has expired. Check it, or start again on the new device.");
    if (status === 409) return gt("Another device already answered this request. Start again on the new device.");
    if (status === 429) return gt("Too many attempts. Wait a moment and try again.");
    if (status === 503) return gt("Linking devices is unavailable right now. Use your recovery passphrase instead.");
    if (name === "E2eeUnavailableError") return gt("Set up encryption on this device first.");
    if (name === "E2eeVerifyError") return gt("The new device's answer didn't check out, so no keys were sent. Start again.");
    if (name === "E2eeFormatError") return gt("That code doesn't look right. It has 10 letters and numbers.");
    return gt("Couldn't link the device. Check your connection and try again.");
  }, [gt]);

  // Look the request up first (nothing is sent) and let the user check it.
  const inspect = useCallback(async (value: string) => {
    if (!value.trim()) return;
    setState({ kind: "checking" });
    try {
      const session = await loadE2eeSession();
      const info = await session.inspectLinkRequest(value);
      setState({ kind: "confirm", input: value, info });
    } catch (err) {
      setState({ kind: "error", message: errorText(err) });
    }
  }, [errorText]);

  const begin = useCallback(async (value: string) => {
    if (!value.trim()) return;
    setState({ kind: "joining" });
    try {
      const session = await loadE2eeSession();
      await session.beginLinkApproval(value);
      setState({ kind: "waiting" });
    } catch (err) {
      setState({ kind: "error", message: errorText(err) });
    }
  }, [errorText]);

  // Opened from a scanned link (/e2ee/link#…): look it up right away (approving still needs a tap).
  useEffect(() => {
    if (startedRef.current || !initialInput) return;
    startedRef.current = true;
    void Promise.resolve().then(() => inspect(initialInput));
  }, [initialInput, inspect]);

  usePoll(state.kind === "waiting" || state.kind === "sent", () => {
    void (async () => {
      try {
        const progress = await (await loadE2eeSession()).pollLinkApproval();
        if (progress.step === "compare") setState((prev) => (prev.kind === "waiting" ? { kind: "compare", sas: progress.sas } : prev));
        else if (progress.step === "done") {
          toast.success(gt("Your new device is set up."));
          onDone();
        } else if (progress.step === "expired") {
          setState({ kind: "error", message: gt("The new device didn't finish in time. Check it, and start again there if it isn't set up.") });
        }
      } catch (err) {
        if (isFatalLinkError(err)) setState({ kind: "error", message: errorText(err) });
      }
    })();
  });

  const send = async (sas: string) => {
    setState({ kind: "sending", sas });
    try {
      const session = await loadE2eeSession();
      await session.confirmLinkApproval();
      setState({ kind: "sent", sas });
    } catch (err) {
      if (err instanceof Error && err.name === "E2eeLinkPassphraseError") {
        setState({ kind: "passphrase", sas });
        return;
      }
      if (err instanceof Error && err.name === "E2eeLinkNeedsPassphraseError") {
        void loadE2eeSession().then((s) => s.cancelLinkApproval()).catch(() => {});
        setState({ kind: "error", message: gt("To link devices from this one, set a recovery passphrase first (Settings → Encryption), then start again on the new device.") });
        return;
      }
      setState({ kind: "error", message: errorText(err) });
    }
  };

  const unlock = async (sas: string) => {
    if (!passphrase) return;
    setPassphraseError(null);
    setState({ kind: "sending", sas });
    try {
      const session = await loadE2eeSession();
      await session.unlockLinkingWithPassphrase(passphrase);
      setPassphrase("");
      await send(sas);
    } catch (err) {
      setState({ kind: "passphrase", sas });
      setPassphraseError(err instanceof Error && err.name === "E2eeVerifyError" ? gt("That passphrase isn't right.") : errorText(err));
    }
  };

  const mismatch = () => {
    void loadE2eeSession().then((s) => s.cancelLinkApproval()).catch(() => {});
    setState({ kind: "error", message: gt("Nothing was sent because the numbers didn't match. If you didn't start this, someone may be trying to get your keys: change your password.") });
  };

  if (state.kind === "input" || state.kind === "error") {
    return (
      <div className="flex flex-col gap-3">
        {scanning ? (
          <QrScanner
            onResult={(value) => {
              setScanning(false);
              setInput(value);
              void inspect(value);
            }}
            onClose={() => setScanning(false)}
          />
        ) : (
          <Button variant="secondary" onClick={() => setScanning(true)}>
            <Camera className="h-4 w-4 mr-1" />
            {gt("Scan QR code")}
          </Button>
        )}
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void inspect(input);
          }}
          placeholder={gt("Code from the new device")}
          aria-label={gt("Code from the new device")}
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          className="font-mono tracking-widest"
        />
        {state.kind === "error" && <p className="text-sm text-destructive" role="alert">{state.message}</p>}
        <DialogFooter>
          <Button onClick={() => void inspect(input)} disabled={!input.trim()}>{gt("Continue")}</Button>
        </DialogFooter>
      </div>
    );
  }

  if (state.kind === "confirm") {
    const requested = new Date(state.info.createdAt).toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
    return (
      <div className="flex flex-col gap-3">
        <div className="rounded-lg border border-[var(--border-subtle)] p-3 text-sm">
          <p className="font-medium text-[var(--text-primary)]">
            {state.info.name
              ? gt("{device} wants to read your encrypted messages", { device: state.info.name })
              : gt("A new device wants to read your encrypted messages")}
          </p>
          <p className="text-xs text-[var(--text-secondary)]">{gt("Requested at {time}", { time: requested })}</p>
        </div>
        <p className="flex items-start gap-2 text-sm text-[var(--text-primary)]" role="alert">
          <ShieldAlert className="h-4 w-4 mt-0.5 shrink-0 text-amber-500" />
          {gt("Only continue if you are holding that device and just asked it to set up encryption. Someone who gets you to approve their device can read all your encrypted messages.")}
        </p>
        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="ghost" onClick={() => setState({ kind: "input" })}>{gt("Cancel")}</Button>
          <Button onClick={() => void begin(state.input)}>{gt("It's my device, continue")}</Button>
        </DialogFooter>
      </div>
    );
  }

  if (state.kind === "checking") {
    return (
      <div className="flex flex-col items-center gap-3 py-6 text-sm text-[var(--text-secondary)]">
        <Loader2 className="h-6 w-6 animate-spin text-[var(--app-accent)]" />
        {gt("Checking the code…")}
      </div>
    );
  }

  if (state.kind === "joining" || state.kind === "waiting") {
    return (
      <div className="flex flex-col items-center gap-3 py-6 text-sm text-[var(--text-secondary)]">
        <Loader2 className="h-6 w-6 animate-spin text-[var(--app-accent)]" />
        {gt("Waiting for the new device…")}
      </div>
    );
  }

  if (state.kind === "passphrase") {
    return (
      <div className="flex flex-col gap-3">
        <SasCode sas={state.sas} />
        <p className="text-sm text-[var(--text-secondary)]">
          {gt("Enter your recovery passphrase to send your keys to the new device. It's asked again for every link made more than 10 minutes after you last entered it here.")}
        </p>
        <Input
          type="password"
          autoComplete="current-password"
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void unlock(state.sas);
          }}
          placeholder={gt("Recovery passphrase")}
          aria-label={gt("Recovery passphrase")}
        />
        {passphraseError && <p className="text-sm text-destructive" role="alert">{passphraseError}</p>}
        <DialogFooter>
          <Button onClick={() => void unlock(state.sas)} disabled={!passphrase}>{gt("Continue")}</Button>
        </DialogFooter>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-[var(--text-secondary)]">{gt("Check that your new device shows exactly this number:")}</p>
      <SasCode sas={state.sas} />
      {state.kind === "compare" ? (
        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="ghost" onClick={mismatch}>
            <X className="h-4 w-4 mr-1" />
            {gt("The numbers are different")}
          </Button>
          <Button onClick={() => void send(state.sas)}>
            <ShieldCheck className="h-4 w-4 mr-1" />
            {gt("They match, link it")}
          </Button>
        </DialogFooter>
      ) : (
        <p className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
          {state.kind === "sent" ? <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-500" /> : <Loader2 className="h-4 w-4 animate-spin" />}
          {state.kind === "sent" ? gt("Keys sent. Confirm the number on your new device to finish.") : gt("Sending your keys…")}
        </p>
      )}
    </div>
  );
}

/** Camera QR scanner (jsQR, like /qr/scan): reports the first SerikaCord link code it sees. */
function QrScanner({ onResult, onClose }: { onResult: (value: string) => void; onClose: () => void }) {
  const gt = useGT();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [failed, setFailed] = useState(false);
  // The camera starts once per mount, whatever the parent re-renders.
  const onResultRef = useRef(onResult);
  useEffect(() => {
    onResultRef.current = onResult;
  });

  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;
    const canvas = document.createElement("canvas");
    void (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("no camera");
        const [{ default: jsQR }, { parseLinkInput }] = await Promise.all([import("jsqr"), import("@/lib/e2ee/link")]);
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
        if (stopped) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        video.setAttribute("playsinline", "true");
        await video.play();
        const tick = () => {
          if (stopped) return;
          if (video.readyState === video.HAVE_ENOUGH_DATA) {
            const ctx = canvas.getContext("2d", { willReadFrequently: true });
            if (ctx) {
              canvas.width = video.videoWidth;
              canvas.height = video.videoHeight;
              ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
              const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
              const code = jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" });
              if (code?.data && parseLinkInput(code.data)) {
                stopped = true;
                stream?.getTracks().forEach((t) => t.stop());
                onResultRef.current(code.data);
                return;
              }
            }
          }
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      } catch {
        if (!stopped) setFailed(true);
      }
    })();
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <div className="relative overflow-hidden rounded-lg bg-[var(--app-surface-alt)]">
      {failed ? (
        <p className="p-4 text-sm text-[var(--text-secondary)]">{gt("The camera isn't available here. Type the code instead.")}</p>
      ) : (
        <video ref={videoRef} className="aspect-square w-full object-cover" muted playsInline />
      )}
      <button
        type="button"
        onClick={onClose}
        className="absolute right-2 top-2 rounded-full bg-[var(--bg-card)]/80 p-1.5 text-[var(--app-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-accent)]"
        aria-label={gt("Close")}
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

export default E2eeLinkDialog;

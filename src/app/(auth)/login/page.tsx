"use client";

import { useState, useEffect, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Eye, EyeOff, KeyRound } from "lucide-react";
import { T, useGT } from "gt-next";
import { useAuth } from "@/contexts/AuthContext";
import { Loader } from "@/components/ui/Loader";
import { QRLoginPanel } from "@/components/auth/QRLoginPanel";
import { safeRedirect } from "@/lib/safeRedirect";
import { clearMessageCache } from "@/lib/chat/messageCache";
import {
  handoffReasonForLoginCode,
  parseHandoffError,
  passkeyStartHref,
  type HandoffErrorCode,
  type LoginHandoffReason,
} from "@/lib/accountsHandoff";

type GTFunc = ReturnType<typeof useGT>;

/** Message for a `/login?error=` code set by the passkey sign-in callback. */
function handoffErrorMessage(code: HandoffErrorCode, gt: GTFunc): string {
  switch (code) {
    case "passkey_expired":
      return gt("Your passkey sign-in expired or was already used. Please try again.");
    case "passkey_cancelled":
      return gt("Passkey sign-in was cancelled.");
    case "passkey_unavailable":
      return gt("Serika Accounts is unavailable right now. Please try again in a moment.");
    case "passkey_age":
      return gt("This account is suspended until the age requirement is met.");
    case "passkey_rate_limited":
      return gt("Too many sign-in attempts. Please wait a few minutes and try again.");
    default:
      return gt("Passkey sign-in failed. Please try again.");
  }
}

/** Message for a password login that needs the Serika Accounts sign-in. */
function loginHandoffMessage(reason: LoginHandoffReason, gt: GTFunc): string {
  return reason === "passkey"
    ? gt("This account requires a passkey to sign in.")
    : gt("This account uses two-factor authentication. Continue on Serika Accounts to sign in.");
}

/**
 * "Sign in with passkey": a plain same-origin link (full-page navigation, no
 * popup) so it also works in the desktop and mobile app shells. The server
 * sends the browser on to Serika Accounts and back.
 */
function PasskeyButton({
  href,
  pending,
  onStart,
  prominent = false,
  label,
}: {
  href: string;
  pending: boolean;
  onStart: () => void;
  prominent?: boolean;
  label: string;
}) {
  const gt = useGT();
  return (
    <a
      href={href}
      onClick={(e) => {
        // A plain click navigates this tab; modified clicks open another one.
        if (e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) onStart();
      }}
      aria-busy={pending || undefined}
      className={
        prominent
          ? "flex w-full h-11 items-center justify-center gap-2 rounded-xl bg-[var(--app-accent)] px-4 text-sm font-semibold text-[var(--text-on-accent)] transition-all hover:brightness-110 active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--app-accent)]"
          : "flex w-full h-11 items-center justify-center gap-2 rounded-xl border border-white/[0.12] bg-white/[0.04] px-4 text-sm font-semibold text-white transition-colors hover:bg-white/[0.08] active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--app-accent)]"
      }
    >
      {pending ? <Loader size={16} /> : <KeyRound className="h-4 w-4 shrink-0" aria-hidden />}
      <span className="truncate">{pending ? gt("Redirecting to Serika Accounts…") : label}</span>
    </a>
  );
}

function LoginForm() {
  const gt = useGT();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, isLoading: authLoading, login } = useAuth();
  // Only same-site paths: a raw ?redirect= reaches router.replace(), which
  // would follow javascript: or off-site URLs.
  const redirectTo = safeRedirect(searchParams.get("redirect"));
  // Set by the passkey sign-in callback (/api/auth/accounts/callback).
  const handoffError = parseHandoffError(searchParams.get("error"));
  const signedIn = searchParams.get("signed_in") === "1";
  const passkeyHref = passkeyStartHref(redirectTo);
  const [passkeyPending, setPasskeyPending] = useState(false);
  // A password login that Serika Accounts refused with PASSKEY_REQUIRED /
  // TWO_FACTOR_REQUIRED: offer its sign-in instead of a generic error.
  const [loginHandoff, setLoginHandoff] = useState<LoginHandoffReason | null>(null);
  // QR login is the default on desktop (scan with your phone). On mobile there's
  // no second device to scan with, so we go straight to the password form and
  // don't offer QR at all.
  const [isDesktop, setIsDesktop] = useState(false);
  const [usePassword, setUsePassword] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const update = () => setIsDesktop(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  // On mobile, force the password form; QR is desktop-only.
  const showQr = isDesktop && !usePassword;
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [formData, setFormData] = useState({
    email: "",
    password: "",
  });

  // Coming back from a passkey sign-in: drop the previous account's cached
  // messages, like a password login does.
  useEffect(() => {
    if (signedIn) clearMessageCache();
  }, [signedIn]);

  // Back button from Serika Accounts restores this page from the bfcache with
  // the "Redirecting…" state still set.
  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) setPasskeyPending(false);
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  // Redirect if already authenticated (via AuthContext). After a passkey
  // sign-in, continue even without a user: a suspended account then lands on
  // Account Standing, exactly like after a password login.
  useEffect(() => {
    if (!authLoading && (user || signedIn)) {
      router.replace(redirectTo);
    }
  }, [user, authLoading, router, redirectTo, signedIn]);

  const startPasskey = () => setPasskeyPending(true);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError("");
    setLoginHandoff(null);

    try {
      // Use AuthContext.login() which calls refresh() internally,
      // ensuring the user state is updated before we navigate.
      await login(formData.email, formData.password);
      router.replace(redirectTo);
    } catch (err) {
      const reason = handoffReasonForLoginCode((err as { code?: unknown } | null)?.code);
      if (reason) {
        setLoginHandoff(reason);
      } else {
        setError(err instanceof Error ? err.message : gt("Something went wrong"));
      }
      setIsLoading(false);
    }
  };

  if (signedIn) {
    return (
      <div className="flex flex-col items-center gap-4 py-16 text-center" role="status">
        <Loader size={28} />
        <p className="text-sm text-white/70">
          <T>Signing you in…</T>
        </p>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="text-center mb-8">
        <h1 className="text-[1.6rem] font-bold tracking-[-0.02em] text-white mb-1">
          <T>Welcome back</T>
        </h1>
        <p className="text-[#a1a1aa] text-sm">
          <T>Sign in to your Serika account</T>
        </p>
      </div>

      {handoffError && (
        <div
          role="alert"
          className="mb-5 p-3 rounded-md bg-red-500/10 border border-red-500/20 text-red-400 text-sm"
        >
          {handoffErrorMessage(handoffError, gt)}
        </div>
      )}

      {!showQr ? (
        /* ── Password / email login ─────────────────────────────────── */
        <form onSubmit={handleSubmit} className="space-y-5">
          {error && (
            <div className="p-3 rounded-md bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
              {error}
            </div>
          )}

          {/* Email Field */}
          <div className="space-y-2">
            <Label className="text-sm font-medium text-[#888888]">
              {gt("Email")}
            </Label>
            <Input
              type="email"
              required
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              className="h-11 bg-[#111111] border-white/[0.08] text-white placeholder:text-[#555555] rounded-xl focus:border-[#8B5CF6]/60 focus:ring-1 focus:ring-[#8B5CF6]/40 focus-visible:ring-[#8B5CF6]/40 transition-colors"
              placeholder="you@example.com"
            />
          </div>

          {/* Password Field */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium text-[#888888]">
                {gt("Password")}
              </Label>
              {/* Passwords are owned by Serika Accounts, which serves the reset flow. */}
              <a
                href="https://accounts.serika.dev/forgot-password"
                className="text-xs text-[#8B5CF6] hover:text-[#A78BFA] transition-colors"
              >
                <T>Forgot password?</T>
              </a>
            </div>
            <div className="relative">
              <Input
                type={showPassword ? "text" : "password"}
                required
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                className="h-11 bg-[#111111] border-white/[0.08] text-white placeholder:text-[#555555] rounded-xl focus:border-[#8B5CF6]/60 focus:ring-1 focus:ring-[#8B5CF6]/40 focus-visible:ring-[#8B5CF6]/40 transition-colors pr-11"
                placeholder={gt("Enter your password")}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[#555555] hover:text-white transition-colors"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Accounts that need a passkey / 2FA: sign in on Serika Accounts */}
          {loginHandoff && (
            <div
              role="alert"
              className="space-y-3 rounded-xl border border-[var(--app-accent)]/40 bg-[var(--app-accent)]/10 p-4"
            >
              <p className="text-sm text-white">{loginHandoffMessage(loginHandoff, gt)}</p>
              <PasskeyButton
                href={loginHandoff === "passkey" ? passkeyHref : passkeyStartHref(redirectTo, { passkey: false })}
                pending={passkeyPending}
                onStart={startPasskey}
                prominent
                label={loginHandoff === "passkey" ? gt("Sign in with passkey") : gt("Continue on Serika Accounts")}
              />
            </div>
          )}

          {/* Submit Button */}
          <Button
            type="submit"
            disabled={isLoading}
            className="w-full h-11 bg-[#8B5CF6] hover:bg-[#7C3AED] text-white font-semibold rounded-xl transition-all hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50 shadow-[0_0_20px_rgba(139,92,246,0.25)]"
          >
            {isLoading ? <Loader size={16} /> : gt("Sign in")}
          </Button>

          {!loginHandoff && (
            <>
              <div className="flex items-center gap-3 text-xs uppercase tracking-wide text-white/40" aria-hidden>
                <span className="h-px flex-1 bg-white/[0.08]" />
                <T>or</T>
                <span className="h-px flex-1 bg-white/[0.08]" />
              </div>
              <PasskeyButton href={passkeyHref} pending={passkeyPending} onStart={startPasskey} label={gt("Sign in with passkey")} />
            </>
          )}

          {/* Switch back to QR login (desktop only) */}
          {isDesktop && (
            <button
              type="button"
              onClick={() => {
                setError("");
                setLoginHandoff(null);
                setUsePassword(false);
              }}
              className="block w-full text-sm text-center text-[#888888] hover:text-white transition-colors pt-1"
            >
              <T>Log in with a QR code instead</T>
            </button>
          )}

          {/* Register Link */}
          <p className="text-sm text-center text-[#888888] pt-3 border-t border-white/[0.06]">
            <T>Don&apos;t have an account?</T>{" "}
            <Link
              href={`/register${redirectTo !== "/channels/me" ? `?redirect=${encodeURIComponent(redirectTo)}` : ""}`}
              className="text-[#8B5CF6] hover:text-[#A78BFA] transition-colors font-medium"
            >
              <T>Sign up</T>
            </Link>
          </p>
        </form>
      ) : (
        /* ── QR login (default) ─────────────────────────────────────── */
        <div className="space-y-6">
          <QRLoginPanel
            redirectTo={redirectTo}
            onApproved={(to) => router.replace(safeRedirect(to))}
          />

          <PasskeyButton href={passkeyHref} pending={passkeyPending} onStart={startPasskey} label={gt("Sign in with passkey")} />

          {/* Switch to password/email login */}
          <button
            type="button"
            onClick={() => setUsePassword(true)}
            className="block w-full text-sm text-center text-[#888888] hover:text-white transition-colors"
          >
            <T>Want to log in with password/email instead?</T>
          </button>

          {/* Register Link */}
          <p className="text-sm text-center text-[#888888] pt-3 border-t border-white/[0.06]">
            <T>Don&apos;t have an account?</T>{" "}
            <Link
              href={`/register${redirectTo !== "/channels/me" ? `?redirect=${encodeURIComponent(redirectTo)}` : ""}`}
              className="text-[#8B5CF6] hover:text-[#A78BFA] transition-colors font-medium"
            >
              <T>Sign up</T>
            </Link>
          </p>
        </div>
      )}
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="h-64 rounded-xl bg-white/[0.04] animate-pulse" />}>
      <LoginForm />
    </Suspense>
  );
}

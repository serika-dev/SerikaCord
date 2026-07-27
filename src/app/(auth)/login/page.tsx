"use client";

import { useState, useEffect, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Eye, EyeOff } from "lucide-react";
import { T, useGT } from "gt-next";
import { useAuth } from "@/contexts/AuthContext";
import { Loader } from "@/components/ui/Loader";
import { QRLoginPanel } from "@/components/auth/QRLoginPanel";

function LoginForm() {
  const gt = useGT();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, isLoading: authLoading, login } = useAuth();
  const redirectTo = searchParams.get("redirect") || "/channels/me";
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

  // Redirect if already authenticated (via AuthContext)
  useEffect(() => {
    if (!authLoading && user) {
      router.replace(redirectTo);
    }
  }, [user, authLoading, router, redirectTo]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError("");

    try {
      // Use AuthContext.login() which calls refresh() internally,
      // ensuring the user state is updated before we navigate.
      await login(formData.email, formData.password);
      router.replace(redirectTo);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setIsLoading(false);
    }
  };

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
              <Link
                href="/forgot-password"
                className="text-xs text-[#8B5CF6] hover:text-[#A78BFA] transition-colors"
              >
                <T>Forgot password?</T>
              </Link>
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

          {/* Submit Button */}
          <Button
            type="submit"
            disabled={isLoading}
            className="w-full h-11 bg-[#8B5CF6] hover:bg-[#7C3AED] text-white font-semibold rounded-xl transition-all hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50 shadow-[0_0_20px_rgba(139,92,246,0.25)]"
          >
            {isLoading ? <Loader size={16} /> : gt("Sign in")}
          </Button>

          {/* Switch back to QR login (desktop only) */}
          {isDesktop && (
            <button
              type="button"
              onClick={() => {
                setError("");
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
              href={`/register${redirectTo !== "/channels/me" ? `?redirect=${redirectTo}` : ""}`}
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
            onApproved={(to) => router.replace(to)}
          />

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
              href={`/register${redirectTo !== "/channels/me" ? `?redirect=${redirectTo}` : ""}`}
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

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

function LoginForm() {
  const gt = useGT();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, isLoading: authLoading, login } = useAuth();
  const redirectTo = searchParams.get("redirect") || "/channels/me";
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
    <div className="bg-[#0a0a0a]/90 backdrop-blur-sm border border-white/[0.08] rounded-2xl p-8 shadow-2xl shadow-black/60">
      {/* Header */}
      <div className="text-center mb-8">
        <h1 className="text-2xl font-semibold text-white mb-2">
          <T>Welcome back</T>
        </h1>
        <p className="text-[#888888] text-sm">
          <T>Sign in to your account to continue</T>
        </p>
      </div>

      {/* Form */}
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
          {isLoading ? (
            <Loader size={16} />
          ) : (
            gt("Sign in")
          )}
        </Button>

        {/* Register Link */}
        <p className="text-sm text-center text-[#888888] pt-4">
          <T>Don&apos;t have an account?</T>{" "}
          <Link 
            href={`/register${redirectTo !== "/channels/me" ? `?redirect=${redirectTo}` : ""}`}
            className="text-[#8B5CF6] hover:text-[#A78BFA] transition-colors font-medium"
          >
            <T>Sign up</T>
          </Link>
        </p>
      </form>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="bg-[#0a0a0a]/90 border border-white/[0.08] rounded-2xl p-8 h-64 animate-pulse" />}>
      <LoginForm />
    </Suspense>
  );
}

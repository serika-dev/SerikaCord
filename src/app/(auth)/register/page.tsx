"use client";

import { useState, useEffect, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Eye, EyeOff,  Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { T, useGT } from "gt-next";
import { useAuth } from "@/contexts/AuthContext";
import { Loader } from "@/components/ui/Loader";

const passwordRequirements = [
  { id: 'length', labelKey: 'At least 8 characters', test: (p: string) => p.length >= 8 },
  { id: 'number', labelKey: 'Contains a number', test: (p: string) => /\d/.test(p) },
  { id: 'special', labelKey: 'Contains a special character', test: (p: string) => /[!@#$%^&*(),.?":{}|<>]/.test(p) },
];

function RegisterForm() {
  const gt = useGT();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, isLoading: authLoading, register } = useAuth();
  const redirectTo = searchParams.get("redirect") || "/channels/me";
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [formData, setFormData] = useState({
    email: "",
    displayName: "",
    username: "",
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
      await register(formData);
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="bg-[#0a0a0a]/90 backdrop-blur-sm border border-white/[0.08] rounded-2xl p-8 shadow-2xl shadow-black/60">
      {/* Header */}
      <div className="text-center mb-6">
        <h1 className="text-2xl font-semibold text-white mb-2">
          <T>Create an account</T>
        </h1>
        <p className="text-[#888888] text-sm">
          <T>Join SerikaCord and start chatting</T>
        </p>
      </div>

      {/* Form */}
      {success ? (
        <div className="space-y-5">
          <div className="p-4 rounded-md bg-green-500/10 border border-green-500/20 text-green-400 text-sm text-center">
            <T>Account created! Please check your email to verify your account before signing in.</T>
          </div>
          <Button
            onClick={() => router.push("/login")}
            className="w-full h-11 bg-[#8B5CF6] hover:bg-[#7C3AED] text-white font-semibold rounded-xl transition-all hover:scale-[1.01] active:scale-[0.99] shadow-[0_0_20px_rgba(139,92,246,0.25)]"
          >
            {gt("Go to Login")}
          </Button>
        </div>
      ) : (
      <form onSubmit={handleSubmit} className="space-y-4">
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
            placeholder={gt("you@example.com")}
          />
        </div>

        {/* Display Name Field */}
        <div className="space-y-2">
          <Label className="text-sm font-medium text-[#888888]">
            {gt("Display Name")}
          </Label>
          <Input
            type="text"
            required
            value={formData.displayName}
            onChange={(e) => setFormData({ ...formData, displayName: e.target.value })}
            className="h-11 bg-[#111111] border-white/[0.08] text-white placeholder:text-[#555555] rounded-xl focus:border-[#8B5CF6]/60 focus:ring-1 focus:ring-[#8B5CF6]/40 focus-visible:ring-[#8B5CF6]/40 transition-colors"
            placeholder={gt("John Doe")}
          />
        </div>

        {/* Username Field */}
        <div className="space-y-2">
          <Label className="text-sm font-medium text-[#888888]">
            {gt("Username")}
          </Label>
          <Input
            type="text"
            required
            value={formData.username}
            onChange={(e) => setFormData({ ...formData, username: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') })}
            className="h-11 bg-[#111111] border-white/[0.08] text-white placeholder:text-[#555555] rounded-xl focus:border-[#8B5CF6]/60 focus:ring-1 focus:ring-[#8B5CF6]/40 focus-visible:ring-[#8B5CF6]/40 transition-colors"
            placeholder={gt("johndoe")}
          />
          <p className="text-xs text-[#555555]"><T>Only letters, numbers, and underscores</T></p>
        </div>

        {/* Password Field */}
        <div className="space-y-2">
          <Label className="text-sm font-medium text-[#888888]">
            {gt("Password")}
          </Label>
          <div className="relative">
            <Input
              type={showPassword ? "text" : "password"}
              required
              minLength={8}
              value={formData.password}
              onChange={(e) => setFormData({ ...formData, password: e.target.value })}
              className="h-11 bg-[#111111] border-white/[0.08] text-white placeholder:text-[#555555] rounded-xl focus:border-[#8B5CF6]/60 focus:ring-1 focus:ring-[#8B5CF6]/40 focus-visible:ring-[#8B5CF6]/40 transition-colors pr-11"
              placeholder={gt("Create a password")}
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[#555555] hover:text-white transition-colors"
            >
              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          
          {/* Password Requirements */}
          {formData.password && (
            <div className="mt-2 space-y-1">
              {passwordRequirements.map((req) => (
                <div 
                  key={req.id}
                  className={cn(
                    "flex items-center gap-2 text-xs transition-colors",
                    req.test(formData.password) ? "text-[#8B5CF6]" : "text-[#555555]"
                  )}
                >
                  {req.test(formData.password) ? (
                    <Check className="w-3 h-3" />
                  ) : (
                    <X className="w-3 h-3" />
                  )}
                  {req.id === 'length' ? gt('At least 8 characters') : req.id === 'number' ? gt('Contains a number') : req.id === 'special' ? gt('Contains a special character') : req.labelKey}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Submit Button */}
        <Button
          type="submit"
          disabled={isLoading}
          className="w-full h-11 bg-[#8B5CF6] hover:bg-[#7C3AED] text-white font-semibold rounded-xl transition-all hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50 mt-2 shadow-[0_0_20px_rgba(139,92,246,0.25)]"
        >
          {isLoading ? (
            <Loader size={16} />
          ) : (
            gt("Create account")
          )}
        </Button>

        {/* Terms */}
        <p className="text-xs text-[#555555] leading-relaxed">
          <T>By registering, you agree to our</T>{" "}
          <Link href="/terms" className="text-[#8B5CF6] hover:underline">
            <T>Terms of Service</T>
          </Link>{" "}
          <T>and</T>{" "}
          <Link href="/privacy" className="text-[#8B5CF6] hover:underline">
            <T>Privacy Policy</T>
          </Link>
        </p>

        {/* Login Link */}
        <p className="text-sm text-center text-[#888888] pt-2">
          <T>Already have an account?</T>{" "}
          <Link 
            href="/login" 
            className="text-[#8B5CF6] hover:text-[#A78BFA] transition-colors font-medium"
          >
            <T>Sign in</T>
          </Link>
        </p>
      </form>
      )}
    </div>
  );
}

export default function RegisterPage() {
  return (
    <Suspense fallback={<div className="bg-[#0a0a0a]/90 border border-white/[0.08] rounded-2xl p-8 h-64 animate-pulse" />}>
      <RegisterForm />
    </Suspense>
  );
}

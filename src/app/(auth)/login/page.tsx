"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Eye, EyeOff, Loader2 } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [formData, setFormData] = useState({
    email: "",
    password: "",
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError("");

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to login");
      }

      router.push("/channels/me");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="bg-[#0a0a0a] border border-[#1a1a1a] rounded-lg p-8">
      {/* Header */}
      <div className="text-center mb-8">
        <h1 className="text-2xl font-semibold text-white mb-2">
          Welcome back
        </h1>
        <p className="text-[#888888] text-sm">
          Sign in to your account to continue
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
            Email
          </Label>
          <Input
            type="email"
            required
            value={formData.email}
            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
            className="h-11 bg-[#111111] border-[#222222] text-white placeholder:text-[#555555] rounded-md focus:border-[#8B5CF6] focus:ring-1 focus:ring-[#8B5CF6] focus-visible:ring-[#8B5CF6] transition-colors"
            placeholder="you@example.com"
          />
        </div>

        {/* Password Field */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium text-[#888888]">
              Password
            </Label>
            <Link 
              href="/forgot-password" 
              className="text-xs text-[#8B5CF6] hover:text-[#A78BFA] transition-colors"
            >
              Forgot password?
            </Link>
          </div>
          <div className="relative">
            <Input
              type={showPassword ? "text" : "password"}
              required
              value={formData.password}
              onChange={(e) => setFormData({ ...formData, password: e.target.value })}
              className="h-11 bg-[#111111] border-[#222222] text-white placeholder:text-[#555555] rounded-md focus:border-[#8B5CF6] focus:ring-1 focus:ring-[#8B5CF6] focus-visible:ring-[#8B5CF6] transition-colors pr-11"
              placeholder="Enter your password"
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
          className="w-full h-11 bg-[#8B5CF6] hover:bg-[#7C3AED] text-white font-medium rounded-md transition-colors disabled:opacity-50"
        >
          {isLoading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            "Sign in"
          )}
        </Button>

        {/* Register Link */}
        <p className="text-sm text-center text-[#888888] pt-4">
          Don&apos;t have an account?{" "}
          <Link 
            href="/register" 
            className="text-[#8B5CF6] hover:text-[#A78BFA] transition-colors font-medium"
          >
            Sign up
          </Link>
        </p>
      </form>
    </div>
  );
}

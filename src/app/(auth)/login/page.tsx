"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function LoginPage() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
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

      router.push("/channels/@me");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Card className="bg-[#313338] border-none shadow-2xl">
      <CardHeader className="text-center space-y-1">
        <CardTitle className="text-2xl font-bold text-white">Welcome back!</CardTitle>
        <CardDescription className="text-[#b5bac1]">
          We&apos;re so excited to see you again!
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="p-3 rounded-md bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
              {error}
            </div>
          )}
          
          <div className="space-y-2">
            <Label htmlFor="email" className="text-xs font-bold uppercase text-[#b5bac1]">
              Email or Phone Number <span className="text-red-400">*</span>
            </Label>
            <Input
              id="email"
              type="email"
              required
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              className="bg-[#1e1f22] border-none text-white placeholder:text-[#6d6f78] focus-visible:ring-[#5865F2] focus-visible:ring-offset-0"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password" className="text-xs font-bold uppercase text-[#b5bac1]">
              Password <span className="text-red-400">*</span>
            </Label>
            <Input
              id="password"
              type="password"
              required
              value={formData.password}
              onChange={(e) => setFormData({ ...formData, password: e.target.value })}
              className="bg-[#1e1f22] border-none text-white placeholder:text-[#6d6f78] focus-visible:ring-[#5865F2] focus-visible:ring-offset-0"
            />
            <Link 
              href="/forgot-password" 
              className="text-sm text-[#00a8fc] hover:underline"
            >
              Forgot your password?
            </Link>
          </div>

          <Button
            type="submit"
            disabled={isLoading}
            className="w-full bg-[#5865F2] hover:bg-[#4752c4] text-white font-medium h-11"
          >
            {isLoading ? "Logging in..." : "Log In"}
          </Button>

          <p className="text-sm text-[#949ba4]">
            Need an account?{" "}
            <Link href="/register" className="text-[#00a8fc] hover:underline">
              Register
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  );
}

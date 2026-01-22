"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function RegisterPage() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [formData, setFormData] = useState({
    email: "",
    displayName: "",
    username: "",
    password: "",
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError("");

    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to register");
      }

      router.push("/channels/me");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Card className="bg-[#313338] border-none shadow-2xl">
      <CardHeader className="text-center space-y-1">
        <CardTitle className="text-2xl font-bold text-white">Create an account</CardTitle>
        <CardDescription className="text-[#b5bac1]">
          Join SerikaCord and start chatting!
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
              Email <span className="text-red-400">*</span>
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
            <Label htmlFor="displayName" className="text-xs font-bold uppercase text-[#b5bac1]">
              Display Name <span className="text-red-400">*</span>
            </Label>
            <Input
              id="displayName"
              type="text"
              required
              value={formData.displayName}
              onChange={(e) => setFormData({ ...formData, displayName: e.target.value })}
              className="bg-[#1e1f22] border-none text-white placeholder:text-[#6d6f78] focus-visible:ring-[#5865F2] focus-visible:ring-offset-0"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="username" className="text-xs font-bold uppercase text-[#b5bac1]">
              Username <span className="text-red-400">*</span>
            </Label>
            <Input
              id="username"
              type="text"
              required
              value={formData.username}
              onChange={(e) => setFormData({ ...formData, username: e.target.value })}
              className="bg-[#1e1f22] border-none text-white placeholder:text-[#6d6f78] focus-visible:ring-[#5865F2] focus-visible:ring-offset-0"
              placeholder="This is how others will see you"
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
              minLength={8}
              value={formData.password}
              onChange={(e) => setFormData({ ...formData, password: e.target.value })}
              className="bg-[#1e1f22] border-none text-white placeholder:text-[#6d6f78] focus-visible:ring-[#5865F2] focus-visible:ring-offset-0"
            />
          </div>

          <Button
            type="submit"
            disabled={isLoading}
            className="w-full bg-[#5865F2] hover:bg-[#4752c4] text-white font-medium h-11"
          >
            {isLoading ? "Creating account..." : "Continue"}
          </Button>

          <p className="text-xs text-[#949ba4]">
            By registering, you agree to SerikaCord&apos;s{" "}
            <Link href="/terms" className="text-[#00a8fc] hover:underline">
              Terms of Service
            </Link>{" "}
            and{" "}
            <Link href="/privacy" className="text-[#00a8fc] hover:underline">
              Privacy Policy
            </Link>
            .
          </p>

          <p className="text-sm text-[#949ba4]">
            Already have an account?{" "}
            <Link href="/login" className="text-[#00a8fc] hover:underline">
              Log In
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  );
}

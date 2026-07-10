"use client";

import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { ArrowRight, Loader2 } from "lucide-react";
import { T, useGT } from "gt-next";

export function HomeNavActions() {
  const { user, isLoading } = useAuth();
  const gt = useGT();

  if (isLoading) {
    return (
      <div className="flex items-center gap-2">
        <Loader2 className="w-4 h-4 animate-spin text-[#666]" />
      </div>
    );
  }

  if (user) {
    return (
      <Link href="/channels/me" className="flex items-center gap-2 group">
        {user.avatar ? (
          <img
            src={user.avatar}
            alt={user.username}
            className="w-8 h-8 rounded-full ring-2 ring-white/10 group-hover:ring-white/30 transition-all"
          />
        ) : (
          <div className="w-8 h-8 rounded-full bg-[#8B5CF6] flex items-center justify-center text-xs font-bold text-white ring-2 ring-white/10 group-hover:ring-white/30 transition-all">
            {(user.displayName || user.username).charAt(0).toUpperCase()}
          </div>
        )}
        <span className="hidden md:block text-sm text-[#ccc] group-hover:text-white transition-colors max-w-[120px] truncate">
          {user.displayName || user.username}
        </span>
      </Link>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Link
        href="/login"
        className="px-4 py-2 text-sm font-medium text-[#ccc] hover:text-white transition-colors"
      >
        {gt("Log In")}
      </Link>
      <Link
        href="/register"
        className="px-4 py-2 text-sm font-semibold bg-white text-black hover:bg-white/90 rounded-full transition-all"
      >
        {gt("Sign Up")}
      </Link>
    </div>
  );
}

export function HomeHeroActions() {
  const { user, isLoading } = useAuth();
  const gt = useGT();

  if (isLoading) {
    return (
      <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
        <div className="w-full sm:w-auto px-8 py-4 text-[15px] font-bold bg-white/10 text-[#666] rounded-full">
          {gt("Loading…")}
        </div>
      </div>
    );
  }

  if (user) {
    return (
      <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
        <Link
          href="/channels/me"
          className="w-full sm:w-auto px-8 py-4 text-[15px] font-bold bg-white text-black hover:bg-white/90 rounded-full transition-all hover:scale-[1.03] active:scale-[0.98] shadow-[0_0_0_0_rgba(255,255,255,0)] hover:shadow-[0_0_40px_rgba(255,255,255,0.12)] flex items-center justify-center gap-2"
        >
          {gt("Welcome back")}, {user.displayName || user.username}
          <ArrowRight className="w-4 h-4" />
        </Link>
        <Link
          href="/channels/me"
          className="w-full sm:w-auto px-8 py-4 text-[15px] font-bold bg-[#8B5CF6] hover:bg-[#7C3AED] text-white rounded-full transition-all hover:scale-[1.03] active:scale-[0.98] shadow-[0_0_30px_rgba(139,92,246,0.35)] hover:shadow-[0_0_50px_rgba(139,92,246,0.5)] flex items-center justify-center gap-2"
        >
          {gt("Open SerikaCord")}
          <ArrowRight className="w-4 h-4" />
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
      <Link
        href="/register"
        className="w-full sm:w-auto px-8 py-4 text-[15px] font-bold bg-white text-black hover:bg-white/90 rounded-full transition-all hover:scale-[1.03] active:scale-[0.98] shadow-[0_0_0_0_rgba(255,255,255,0)] hover:shadow-[0_0_40px_rgba(255,255,255,0.12)]"
      >
        {gt("Get Started — it's free")}
      </Link>
      <Link
        href="/channels/me"
        className="w-full sm:w-auto px-8 py-4 text-[15px] font-bold bg-[#8B5CF6] hover:bg-[#7C3AED] text-white rounded-full transition-all hover:scale-[1.03] active:scale-[0.98] shadow-[0_0_30px_rgba(139,92,246,0.35)] hover:shadow-[0_0_50px_rgba(139,92,246,0.5)] flex items-center justify-center gap-2"
      >
        {gt("Open in browser")}
        <ArrowRight className="w-4 h-4" />
      </Link>
    </div>
  );
}

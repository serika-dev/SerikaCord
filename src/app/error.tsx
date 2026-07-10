"use client";

import { useEffect } from "react";
import Link from "next/link";
import { RefreshCw, Home } from "lucide-react";
import { T } from "gt-next";

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Route error:", error);
  }, [error]);

  return (
    <div className="min-h-dvh bg-[#0a0a0a] flex flex-col items-center justify-center px-4 text-center">
      <div className="w-16 h-16 rounded-2xl bg-[#111111] border border-[#222222] flex items-center justify-center mb-6">
        <span className="text-3xl" role="img" aria-label="Warning">⚠️</span>
      </div>
      <h1 className="text-2xl font-bold text-white mb-2"><T>Something went wrong</T></h1>
      <p className="text-[#888888] text-sm mb-8 max-w-sm">
        <T>An unexpected error occurred. Your messages are safe — try reloading this view.</T>
      </p>
      <div className="flex gap-3">
        <button
          onClick={reset}
          className="flex items-center gap-2 px-6 py-3 bg-[#8B5CF6] hover:bg-[#7C3AED] text-white font-medium rounded-lg transition-colors text-sm"
        >
          <RefreshCw className="w-4 h-4" />
          <T>Try Again</T>
        </button>
        <Link
          href="/channels/me"
          className="flex items-center gap-2 px-6 py-3 bg-[#1a1a1a] hover:bg-[#222222] border border-[#222222] text-white font-medium rounded-lg transition-colors text-sm"
        >
          <Home className="w-4 h-4" />
          <T>Go Home</T>
        </Link>
      </div>
    </div>
  );
}

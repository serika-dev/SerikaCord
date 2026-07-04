"use client";

import { cn } from "@/lib/utils";

interface SystemPillProps {
  isSystem?: boolean;
  className?: string;
}

export function SystemPill({ isSystem, className }: SystemPillProps) {
  if (!isSystem) return null;

  return (
    <span
      className={cn(
        "inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold leading-none bg-blue-500/20 text-blue-400 whitespace-nowrap",
        className
      )}
    >
      System
    </span>
  );
}

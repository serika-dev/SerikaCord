"use client";

import { cn } from "@/lib/utils";

/** Discord-style red "NEW" line drawn above the first unread message. */
export function UnreadDivider({ label, className }: { label: string; className?: string }) {
  return (
    <div
      className={cn("relative flex items-center my-2 select-none", className)}
      role="separator"
      aria-label={label}
      data-unread-divider="true"
    >
      <div className="h-px flex-1 bg-red-500" />
      <span className="ml-1 rounded-sm bg-red-500 px-1 text-[10px] font-bold uppercase leading-4 tracking-wide text-white">
        {label}
      </span>
    </div>
  );
}

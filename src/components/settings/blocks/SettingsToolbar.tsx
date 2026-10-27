"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Sticky search / filter bar for list pages. Sits under the desktop sticky
 * page header (64px) and at the top of the phone page scroller.
 */
export function SettingsToolbar({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "theme-solid sticky top-0 md:top-16 z-10 -mx-1 px-1 py-2",
        "bg-[var(--bg-app)] md:bg-[var(--bg-card)]",
        "flex flex-wrap items-center gap-2",
        className,
      )}
    >
      {children}
    </div>
  );
}

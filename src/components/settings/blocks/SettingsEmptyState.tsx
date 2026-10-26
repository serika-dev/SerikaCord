"use client";

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Empty list / nothing-here-yet state: a soft icon tile, one line of title,
 * an optional muted line and an optional call to action.
 */
export function SettingsEmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
  compact = false,
}: {
  icon?: LucideIcon;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
  /** Less vertical padding (inside a card next to other content). */
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center",
        compact ? "px-4 py-6" : "rounded-lg border border-dashed border-[var(--border-subtle)] px-6 py-10",
        className,
      )}
    >
      {Icon && (
        <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--bg-hover)] text-[var(--text-muted)]">
          <Icon className="h-6 w-6" aria-hidden />
        </span>
      )}
      <p className="text-[15px] font-semibold text-[var(--text-primary)]">{title}</p>
      {description && <p className="mt-1 max-w-sm text-[13px] leading-snug text-[var(--text-secondary)]">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

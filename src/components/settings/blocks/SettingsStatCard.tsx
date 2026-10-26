"use client";

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** Dashboard tile: label, big number and an optional muted/positive hint. */
export function SettingsStatCard({
  icon: Icon,
  label,
  value,
  hint,
  hintTone = "muted",
  valueTone = "default",
  className,
}: {
  icon?: LucideIcon;
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  hintTone?: "muted" | "positive";
  valueTone?: "default" | "positive" | "danger" | "accent";
  className?: string;
}) {
  return (
    <div className={cn("rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-app)] p-4", className)}>
      <div className="flex items-center gap-2 text-[var(--text-muted)]">
        {Icon && <Icon className="h-4 w-4 shrink-0" aria-hidden />}
        <span className="truncate text-[11px] font-bold uppercase tracking-[0.04em]">{label}</span>
      </div>
      <p
        className={cn(
          "mt-2 text-2xl font-bold tabular-nums leading-none",
          valueTone === "default" && "text-[var(--text-primary)]",
          valueTone === "positive" && "text-green-500",
          valueTone === "danger" && "text-red-500",
          valueTone === "accent" && "text-[var(--app-accent)]",
        )}
      >
        {value}
      </p>
      {hint && <p className={cn("mt-1.5 text-xs", hintTone === "positive" ? "text-green-500" : "text-[var(--text-muted)]")}>{hint}</p>}
    </div>
  );
}

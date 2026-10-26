"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const TONES = {
  success: "bg-green-500/12 text-green-600 dark:text-green-400",
  warning: "bg-yellow-500/12 text-yellow-700 dark:text-yellow-400",
  danger: "bg-red-500/12 text-red-600 dark:text-red-400",
  info: "bg-blue-500/12 text-blue-600 dark:text-blue-400",
  neutral: "bg-[var(--bg-hover)] text-[var(--text-secondary)]",
  accent: "bg-[color-mix(in_srgb,var(--app-accent)_14%,transparent)] text-[var(--app-accent)]",
} as const;

export type SettingsStatusTone = keyof typeof TONES;

/** Small rounded status label ("Connected", "Pending", "Managed"). */
export function SettingsStatusPill({
  tone = "neutral",
  dot = false,
  children,
  className,
}: {
  tone?: SettingsStatusTone;
  /** Leading dot in the text colour. */
  dot?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold leading-4",
        TONES[tone],
        className,
      )}
    >
      {dot && <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

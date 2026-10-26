"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface SettingsSubTab<Id extends string = string> {
  id: Id;
  label: ReactNode;
  disabled?: boolean;
}

/**
 * Discord's in-page tab strip ("Security | Standing", "User Profile | Per-server
 * Profiles"): text tabs with an accent underline on a hairline. `variant
 * "segmented"` draws a compact pill group instead (filters, small toggles).
 */
export function SettingsSubTabs<Id extends string>({
  tabs,
  value,
  onChange,
  variant = "underline",
  ariaLabel,
  className,
}: {
  tabs: SettingsSubTab<Id>[];
  value: Id;
  onChange: (id: Id) => void;
  variant?: "underline" | "segmented";
  ariaLabel?: string;
  className?: string;
}) {
  if (variant === "segmented") {
    return (
      <div
        role="tablist"
        aria-label={ariaLabel}
        className={cn("inline-flex max-w-full gap-0.5 overflow-x-auto rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-app)] p-0.5 scrollbar-none", className)}
      >
        {tabs.map((tab) => {
          const active = tab.id === value;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              disabled={tab.disabled}
              onClick={() => onChange(tab.id)}
              className={cn(
                "h-7 shrink-0 rounded-md px-3 text-xs font-semibold transition-colors duration-(--motion-fast) disabled:opacity-50",
                active
                  ? "bg-[var(--app-accent)] text-[var(--text-on-accent)] shadow-sm"
                  : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]",
              )}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
    );
  }
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn("flex gap-6 overflow-x-auto border-b border-[var(--border-subtle)] scrollbar-none", className)}
    >
      {tabs.map((tab) => {
        const active = tab.id === value;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active}
            disabled={tab.disabled}
            onClick={() => onChange(tab.id)}
            className={cn(
              "relative -mb-px shrink-0 border-b-2 pb-2.5 pt-1 text-[15px] font-medium transition-colors duration-(--motion-fast) disabled:opacity-50",
              active
                ? "border-[var(--app-accent)] text-[var(--text-primary)]"
                : "border-transparent text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]",
            )}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

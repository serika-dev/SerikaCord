"use client";

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SettingsRadioOption<V extends string = string> {
  value: V;
  label: ReactNode;
  description?: ReactNode;
  icon?: LucideIcon;
}

/**
 * Discord-style radio list: each option is a full-width card with a radio
 * dot, label and description; the selected one is outlined in the accent.
 * `layout="tiles"` puts icon tiles side by side (Access: how people join).
 */
export function SettingsRadioCards<V extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  layout = "list",
  disabled,
  className,
}: {
  options: readonly SettingsRadioOption<V>[];
  value: V;
  onChange: (value: V) => void;
  ariaLabel?: string;
  layout?: "list" | "tiles";
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(layout === "tiles" ? "grid grid-cols-1 gap-2 sm:grid-cols-3" : "space-y-2", className)}
    >
      {options.map((opt) => {
        const selected = opt.value === value;
        const Icon = opt.icon;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onChange(opt.value)}
            className={cn(
              "w-full rounded-lg border text-left transition-colors duration-(--motion-fast) disabled:cursor-not-allowed disabled:opacity-60",
              layout === "tiles" ? "flex flex-col items-center gap-1.5 px-4 py-4 text-center" : "flex items-start gap-3 px-4 py-3",
              selected
                ? "border-[var(--app-accent)] bg-[color-mix(in_srgb,var(--app-accent)_10%,transparent)]"
                : "border-[var(--border-subtle)] bg-[var(--bg-app)] hover:bg-[var(--bg-hover)]",
            )}
          >
            {layout === "tiles" ? (
              Icon && <Icon className={cn("h-5 w-5", selected ? "text-[var(--app-accent)]" : "text-[var(--text-secondary)]")} />
            ) : (
              <span
                aria-hidden
                className={cn(
                  "mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border-2",
                  selected ? "border-[var(--app-accent)]" : "border-[var(--text-muted)]",
                )}
              >
                {selected && <span className="h-2 w-2 rounded-full bg-[var(--app-accent)]" />}
              </span>
            )}
            <span className="min-w-0">
              <span className="block text-sm font-medium text-[var(--text-primary)]">{opt.label}</span>
              {opt.description && (
                <span className="mt-0.5 block text-[13px] leading-snug text-[var(--text-secondary)]">{opt.description}</span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}

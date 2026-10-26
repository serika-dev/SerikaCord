"use client";

import { cn } from "@/lib/utils";

interface ToggleSwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  size?: "sm" | "md";
  "aria-label"?: string;
  className?: string;
}

/**
 * The app-wide toggle switch. Replaces raw checkboxes so every boolean
 * setting looks and behaves the same (Discord-style sliding toggle).
 */
export function ToggleSwitch({
  checked,
  onCheckedChange,
  disabled = false,
  size = "md",
  "aria-label": ariaLabel,
  className,
}: ToggleSwitchProps) {
  const isSmall = size === "sm";
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "relative shrink-0 rounded-full transition-colors duration-(--motion-fast) ease-(--motion-ease-out) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--app-accent)] disabled:opacity-50 disabled:cursor-not-allowed",
        // Phones: an invisible ~44px hit area around the small track.
        "max-sm:before:absolute max-sm:before:-inset-x-2 max-sm:before:-inset-y-2.5 max-sm:before:content-['']",
        isSmall ? "w-9 h-5" : "w-12 h-6",
        checked ? "bg-[var(--app-accent)]" : "bg-[var(--border-strong)]",
        className
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 left-0.5 rounded-full bg-white shadow-sm transition-transform duration-(--motion-fast) ease-(--motion-ease-out)",
          isSmall ? "w-4 h-4" : "w-5 h-5",
          checked && (isSmall ? "translate-x-4" : "translate-x-6")
        )}
      />
    </button>
  );
}

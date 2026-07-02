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
        "relative shrink-0 rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8B5CF6] disabled:opacity-50 disabled:cursor-not-allowed",
        isSmall ? "w-9 h-5" : "w-12 h-6",
        checked ? "bg-[#8B5CF6]" : "bg-[#2a2a2a]",
        className
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 left-0.5 rounded-full bg-white shadow transition-transform",
          isSmall ? "w-4 h-4" : "w-5 h-5",
          checked && (isSmall ? "translate-x-4" : "translate-x-6")
        )}
      />
    </button>
  );
}

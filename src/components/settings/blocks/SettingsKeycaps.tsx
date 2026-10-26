"use client";

import { cn } from "@/lib/utils";

/**
 * Renders a shortcut string ("Ctrl+Shift+K", "Alt + ↑") as separate keycaps,
 * like Discord's keybind table.
 */
export function SettingsKeycaps({ combo, tone = "neutral", className }: { combo: string; tone?: "neutral" | "danger"; className?: string }) {
  // "Ctrl + Shift + K" (spaced, so a literal "+" key survives) or "Ctrl+K".
  const keys = (combo.includes(" + ") ? combo.split(" + ") : combo.length > 1 ? combo.split(/\+(?!$)/) : [combo])
    .map((k) => k.trim())
    .filter(Boolean);
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1", className)}>
      {keys.map((key, i) => (
        <kbd
          key={`${key}:${i}`}
          className={cn(
            "inline-flex h-6 min-w-6 items-center justify-center rounded-md border border-b-2 px-1.5 font-mono text-[11px] font-semibold leading-none",
            tone === "danger"
              ? "border-red-500/40 bg-red-500/10 text-red-500"
              : "border-[var(--border-strong)] bg-[var(--bg-app)] text-[var(--text-primary)]",
          )}
        >
          {key}
        </kbd>
      ))}
    </span>
  );
}

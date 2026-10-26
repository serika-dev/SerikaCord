"use client";

import type { InputHTMLAttributes } from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

/** Search field for list pages (members, roles, emoji ...) with a clear button. */
export function SettingsSearchInput({
  value,
  onValueChange,
  clearLabel,
  className,
  inputClassName,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> & {
  value: string;
  onValueChange: (value: string) => void;
  /** Accessible label of the clear button. */
  clearLabel?: string;
  inputClassName?: string;
}) {
  return (
    <div className={cn("relative min-w-0", className)}>
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
      <input
        type="text"
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        aria-label={props["aria-label"] ?? props.placeholder}
        {...props}
        className={cn(
          "h-9 w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-input)] pl-8 pr-8 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)]",
          "outline-none transition-[border-color,box-shadow] duration-(--motion-fast) focus:border-[color-mix(in_srgb,var(--app-accent)_60%,transparent)] focus:ring-2 focus:ring-[var(--app-accent)]/25",
          inputClassName,
        )}
      />
      {value && (
        <button
          type="button"
          onClick={() => onValueChange("")}
          aria-label={clearLabel}
          className="absolute right-1.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

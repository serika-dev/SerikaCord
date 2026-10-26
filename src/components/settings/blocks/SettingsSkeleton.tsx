"use client";

import { cn } from "@/lib/utils";

function Bar({ className }: { className?: string }) {
  return <span className={cn("block animate-pulse rounded bg-[var(--bg-hover)]", className)} />;
}

/**
 * Placeholder shaped like the final page so nothing jumps when data lands:
 * `rows` = setting rows with a switch, `list` = avatar + two lines + action,
 * `stats` = a grid of stat tiles.
 */
export function SettingsSkeleton({
  variant = "rows",
  count,
  rows,
  className,
}: {
  /** `grid` = square tiles (emoji, stickers, badges). */
  variant?: "rows" | "list" | "stats" | "grid";
  count?: number;
  /** Alias of `count`. */
  rows?: number;
  className?: string;
}) {
  const items = Array.from({ length: count ?? rows ?? 4 }, (_, i) => i);
  if (variant === "grid") {
    return (
      <div aria-hidden className={cn("grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6", className)}>
        {items.map((i) => (
          <Bar key={i} className="aspect-square w-full rounded-lg" />
        ))}
      </div>
    );
  }
  if (variant === "stats") {
    return (
      <div aria-hidden className={cn("grid grid-cols-2 gap-3 md:grid-cols-4", className)}>
        {items.map((i) => (
          <div key={i} className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-app)] p-4">
            <Bar className="h-3 w-20" />
            <Bar className="mt-3 h-7 w-24" />
            <Bar className="mt-2 h-3 w-16" />
          </div>
        ))}
      </div>
    );
  }
  return (
    <div
      aria-hidden
      className={cn(
        "overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-app)] divide-y divide-[var(--border-subtle)]",
        className,
      )}
    >
      {items.map((i) =>
        variant === "list" ? (
          <div key={i} className="flex items-center gap-3 px-4 py-3">
            <Bar className="h-10 w-10 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1 space-y-2">
              <Bar className="h-3.5 w-40 max-w-[60%]" />
              <Bar className="h-3 w-56 max-w-[80%]" />
            </div>
            <Bar className="h-7 w-16 shrink-0 rounded-md" />
          </div>
        ) : (
          <div key={i} className="flex items-center justify-between gap-4 px-4 py-3.5">
            <div className="min-w-0 flex-1 space-y-2">
              <Bar className="h-3.5 w-44 max-w-[60%]" />
              <Bar className="h-3 w-72 max-w-[85%]" />
            </div>
            <Bar className="h-5 w-9 shrink-0 rounded-full" />
          </div>
        ),
      )}
    </div>
  );
}

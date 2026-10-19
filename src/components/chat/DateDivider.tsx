"use client";

import { cn } from "@/lib/utils";

/**
 * Discord-style day break: a thin line with the date centered on it, drawn
 * above the first message of each day. When the unread run starts at the same
 * message, the line turns red and carries the "NEW" badge too, so the two
 * dividers never stack.
 */
export function DateDivider({
  label,
  unreadLabel,
  className,
}: {
  /** The localized date, e.g. "October 18, 2026". */
  label: string;
  /** Set when the first unread message starts this day ("New"). */
  unreadLabel?: string;
  className?: string;
}) {
  const line = unreadLabel ? "bg-red-500" : "bg-[var(--app-border)]";
  return (
    <div
      className={cn("relative flex items-center my-2 select-none", className)}
      role="separator"
      aria-label={label}
      data-date-divider="true"
      data-unread-divider={unreadLabel ? "true" : undefined}
    >
      <div className={cn("h-px flex-1", line)} />
      <span
        className={cn(
          "shrink-0 px-2 text-xs font-semibold leading-4",
          unreadLabel ? "text-red-500" : "text-[var(--app-muted)]",
        )}
      >
        {label}
      </span>
      <div className={cn("h-px flex-1", line)} />
      {unreadLabel && (
        <span className="ml-1 rounded-sm bg-red-500 px-1 text-[10px] font-bold uppercase leading-4 tracking-wide text-white">
          {unreadLabel}
        </span>
      )}
    </div>
  );
}

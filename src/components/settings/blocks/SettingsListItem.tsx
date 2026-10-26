"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * One row of a settings list (devices, apps, connections, search results):
 * leading media (avatar / icon tile), title + optional inline badges,
 * subtitle and meta lines, and trailing actions. Put several inside a
 * SettingsCard for hairline dividers. `actionsOnHover` keeps secondary
 * actions out of the way until the row is hovered or focused (always shown
 * on touch screens).
 */
export function SettingsListItem({
  leading,
  title,
  badges,
  subtitle,
  meta,
  actions,
  actionsOnHover = false,
  selected = false,
  onClick,
  className,
  children,
}: {
  leading?: ReactNode;
  title: ReactNode;
  badges?: ReactNode;
  subtitle?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  actionsOnHover?: boolean;
  selected?: boolean;
  /** Makes the whole row a button (actions stop propagation themselves). */
  onClick?: () => void;
  className?: string;
  /** Extra content under the row (scopes, expanded details). */
  children?: ReactNode;
}) {
  const body = (
    <>
      {leading && <div className="shrink-0">{leading}</div>}
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-[15px] font-medium leading-snug text-[var(--text-primary)]">{title}</span>
          {badges}
        </div>
        {subtitle && <div className="mt-0.5 truncate text-[13px] leading-snug text-[var(--text-secondary)]">{subtitle}</div>}
        {meta && <div className="mt-0.5 truncate text-xs leading-snug text-[var(--text-muted)]">{meta}</div>}
      </div>
    </>
  );
  return (
    <div
      data-settings-row
      className={cn(
        "group/list-item relative transition-colors duration-(--motion-fast)",
        selected ? "bg-[var(--bg-active)]" : "[@media(hover:hover)]:hover:bg-[var(--bg-hover)]/60",
        className,
      )}
    >
      <div className="flex items-center gap-3 px-4 py-3">
        {onClick ? (
          <button type="button" onClick={onClick} className="flex min-w-0 flex-1 items-center gap-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-accent)]/40 rounded-md">
            {body}
          </button>
        ) : (
          body
        )}
        {actions && (
          <div
            className={cn(
              "flex shrink-0 items-center gap-2",
              actionsOnHover &&
                "[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/list-item:opacity-100 [@media(hover:hover)]:group-focus-within/list-item:opacity-100 transition-opacity duration-(--motion-fast)",
            )}
          >
            {actions}
          </div>
        )}
      </div>
      {children && <div className="px-4 pb-3">{children}</div>}
    </div>
  );
}

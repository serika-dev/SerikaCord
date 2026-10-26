"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Discord's red-tinted group for irreversible actions (delete server, account
 * removal). Children are usually SettingsRow with a `danger` button control.
 */
export function SettingsDangerZone({
  title,
  description,
  action,
  children,
  className,
}: {
  title?: ReactNode;
  description?: ReactNode;
  /**
   * Single-row form: `title` + `description` on the left and this control on
   * the right, all inside the red group (no children needed).
   */
  action?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  if (action !== undefined) {
    return (
      <div
        data-settings-row
        className={cn(
          "flex items-center justify-between gap-4 rounded-xl border border-red-500/30 bg-red-500/[0.04] px-4 py-3.5 max-sm:flex-col max-sm:items-stretch",
          className,
        )}
      >
        <div className="min-w-0">
          {title && <p className="text-sm font-medium text-[var(--text-primary)]">{title}</p>}
          {description && <p className="mt-0.5 text-[13px] leading-snug text-[var(--text-secondary)]">{description}</p>}
        </div>
        <div className="shrink-0">{action}</div>
      </div>
    );
  }
  return (
    <section className={cn("space-y-3", className)}>
      {(title || description) && (
        <div className="px-0.5">
          {title && <h3 className="text-xs font-bold uppercase tracking-[0.04em] text-red-500">{title}</h3>}
          {description && <p className="mt-1 text-[13px] leading-snug text-[var(--text-secondary)]">{description}</p>}
        </div>
      )}
      <div className="overflow-hidden rounded-xl border border-red-500/30 bg-red-500/[0.04] divide-y divide-red-500/20">
        {children}
      </div>
    </section>
  );
}

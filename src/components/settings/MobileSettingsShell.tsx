"use client";

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { ArrowLeft, ChevronRight, X } from "lucide-react";
import { useGT } from "gt-next";
import { cn } from "@/lib/utils";

export interface MobileSettingsItem<S extends string = string> {
  id: S;
  label: string;
  icon: LucideIcon;
  /** Red count pill on the right (pending applications, ...). */
  badge?: number;
  /** Red row for destructive entries (Delete Channel). */
  destructive?: boolean;
}

export interface MobileSettingsGroup<S extends string = string> {
  title?: string;
  items: MobileSettingsItem<S>[];
}

/**
 * Discord-mobile style grouped list of settings sections: rounded cards of
 * 52px rows with an icon tile, label and chevron.
 */
export function MobileSettingsList<S extends string>({
  groups,
  onSelect,
  header,
}: {
  groups: MobileSettingsGroup<S>[];
  onSelect: (id: S) => void;
  header?: ReactNode;
}) {
  return (
    <div className="px-4 pt-4 pb-8 space-y-6">
      {header}
      {groups.map((group, gi) => (
        <section key={group.title ?? gi}>
          {group.title && (
            <h3 className="px-1 mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)] truncate">
              {group.title}
            </h3>
          )}
          <div className="rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] overflow-hidden divide-y divide-[var(--border-subtle)]">
            {group.items.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSelect(item.id)}
                  className={cn(
                    "w-full min-h-[52px] flex items-center gap-3 px-3 text-left touch-manipulation transition-colors active:bg-[var(--bg-active)]",
                    item.destructive ? "text-red-500" : "text-[var(--text-primary)]",
                  )}
                >
                  <span
                    className={cn(
                      "w-8 h-8 rounded-lg flex items-center justify-center shrink-0",
                      item.destructive ? "bg-red-500/10" : "bg-[var(--bg-hover)] text-[var(--text-secondary)]",
                    )}
                  >
                    <Icon className="w-[18px] h-[18px]" />
                  </span>
                  <span className="flex-1 min-w-0 truncate text-[15px] font-medium">{item.label}</span>
                  {item.badge ? (
                    <span className="px-1.5 py-0.5 bg-red-500 text-white text-[11px] font-bold rounded-full min-w-[20px] text-center">
                      {item.badge > 99 ? "99+" : item.badge}
                    </span>
                  ) : null}
                  {!item.destructive && <ChevronRight className="w-5 h-5 text-[var(--text-muted)] shrink-0" />}
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

/**
 * Full-screen phone settings page: safe-area header with a 44px back / close
 * button, centred title and an optional right action (Save), a smoothly
 * scrolling body (inputs forced to 16px so iOS doesn't zoom) and an optional
 * footer pinned above the home indicator.
 */
export function MobileSettingsScreen({
  title,
  subtitle,
  leading,
  onLeading,
  action,
  footer,
  children,
  animate = true,
  ariaLabel,
  embedded = false,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  /** "back" shows an arrow, "close" an X. */
  leading: "back" | "close";
  onLeading: () => void;
  action?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  /** Slide the page in from the right (pushed pages). */
  animate?: boolean;
  ariaLabel?: string;
  /** Fill a parent that is already a (portaled) dialog instead of being one. */
  embedded?: boolean;
}) {
  const gt = useGT();
  return (
    <div
      role={embedded ? undefined : "dialog"}
      aria-modal={embedded ? undefined : true}
      aria-label={ariaLabel}
      className={cn(
        "flex flex-col bg-[var(--bg-app)] text-[var(--text-primary)]",
        embedded ? "h-full w-full min-h-0" : "fixed inset-0 z-50",
        animate && "animate-in slide-in-from-right-8 fade-in duration-200",
      )}
    >
      <header className="shrink-0 pt-[env(safe-area-inset-top)] bg-[var(--bg-app)] border-b border-[var(--border-subtle)]">
        <div className="h-14 grid grid-cols-[56px_1fr_auto] items-center px-1">
          <button
            type="button"
            onClick={onLeading}
            aria-label={leading === "back" ? gt("Back") : gt("Close")}
            className="w-11 h-11 ml-1 flex items-center justify-center rounded-full text-[var(--text-primary)] active:bg-[var(--bg-active)] touch-manipulation"
          >
            {leading === "back" ? <ArrowLeft className="w-6 h-6" /> : <X className="w-6 h-6" />}
          </button>
          <div className="min-w-0 text-center">
            <h2 className="text-[17px] font-semibold truncate leading-tight">{title}</h2>
            {subtitle && <p className="text-xs text-[var(--text-muted)] truncate">{subtitle}</p>}
          </div>
          <div className="min-w-[56px] flex justify-end pr-2">{action}</div>
        </div>
      </header>
      <div className="mobile-settings-body flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain [-webkit-overflow-scrolling:touch]">
        {children}
      </div>
      {footer && (
        <div className="shrink-0 px-3 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] bg-[var(--bg-app)]">
          {footer}
        </div>
      )}
    </div>
  );
}

/** Header "Save" text button for MobileSettingsScreen. */
export function MobileSaveAction({
  onSave,
  disabled,
  saving,
  label,
}: {
  onSave: () => void;
  disabled?: boolean;
  saving?: boolean;
  label?: string;
}) {
  const gt = useGT();
  return (
    <button
      type="button"
      onClick={onSave}
      disabled={disabled || saving}
      className="h-11 px-3 rounded-full text-[15px] font-semibold text-[var(--app-accent)] disabled:text-[var(--text-muted)] active:bg-[var(--bg-active)] touch-manipulation"
    >
      {saving ? gt("Saving...") : label || gt("Save")}
    </button>
  );
}

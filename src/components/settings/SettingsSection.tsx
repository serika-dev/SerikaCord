"use client";

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { ToggleSwitch } from "@/components/ui/toggle-switch";

/**
 * Building blocks shared by every settings page (user + server settings):
 *
 *   <SettingsPageHeader title description />
 *   <SettingsSection title description>
 *     <SettingsCard>
 *       <SettingsToggleRow label description checked onCheckedChange />
 *       <SettingsRow label description control={<Select …/>} />
 *     </SettingsCard>
 *   </SettingsSection>
 *
 * Rows inside a card get hairline dividers; label + description sit on the
 * left and the control on the right (stacking under the text on phones when
 * the control is wide). Presentation only: callers keep their own state.
 */

export function SettingsPageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-6 flex items-start justify-between gap-4", className)}>
      <div className="min-w-0">
        {/* Hidden on phones: the pushed page header already names the page. */}
        <h2 className="text-xl font-bold text-[var(--text-primary)] leading-tight max-md:hidden">{title}</h2>
        {description && <p className="mt-1 text-sm text-[var(--text-secondary)]">{description}</p>}
      </div>
      {actions && <div className="shrink-0 flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function SettingsSection({
  title,
  description,
  icon: Icon,
  action,
  children,
  className,
}: {
  title?: ReactNode;
  description?: ReactNode;
  icon?: LucideIcon;
  /** Small control aligned with the section title (e.g. "Reset"). */
  action?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("space-y-3", className)}>
      {(title || description || action) && (
        <div className="flex items-end justify-between gap-3 px-0.5">
          <div className="min-w-0">
            {title && (
              <h3
                className="flex items-center gap-2 rounded-md text-[15px] font-semibold text-[var(--text-primary)]"
                data-settings-label={typeof title === "string" ? title : undefined}
              >
                {Icon && <Icon className="w-4 h-4 text-[var(--text-secondary)] shrink-0" />}
                {title}
              </h3>
            )}
            {description && <p className="mt-0.5 text-[13px] leading-snug text-[var(--text-secondary)]">{description}</p>}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

/** Rounded group of rows separated by hairlines (Linear / Discord style). */
export function SettingsCard({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-app)] divide-y divide-[var(--border-subtle)] overflow-hidden",
        className,
      )}
    >
      {children}
    </div>
  );
}

interface SettingsRowBaseProps {
  label: ReactNode;
  description?: ReactNode;
  icon?: LucideIcon;
  /** Red label for destructive rows. */
  danger?: boolean;
  disabled?: boolean;
  /** Extra content under the row (sliders, pickers, conditional sub-settings). */
  children?: ReactNode;
  className?: string;
}

function RowText({ label, description, icon: Icon, danger }: Pick<SettingsRowBaseProps, "label" | "description" | "icon" | "danger">) {
  return (
    <div className="flex min-w-0 flex-1 items-start gap-3">
      {Icon && (
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--bg-hover)] text-[var(--text-secondary)]">
          <Icon className="h-4 w-4" />
        </span>
      )}
      <div className="min-w-0">
        <div
          className={cn("text-sm font-medium leading-snug", danger ? "text-red-500" : "text-[var(--text-primary)]")}
          data-settings-label={typeof label === "string" ? label : undefined}
        >
          {label}
        </div>
        {description && <div className="mt-0.5 text-[13px] leading-snug text-[var(--text-secondary)]">{description}</div>}
      </div>
    </div>
  );
}

/** A setting with any control (select, button, input) on the right. */
export function SettingsRow({
  label,
  description,
  icon,
  danger,
  disabled,
  control,
  stackOnMobile = false,
  children,
  className,
}: SettingsRowBaseProps & {
  control?: ReactNode;
  /** Put the control under the text on phones (wide selects / inputs). */
  stackOnMobile?: boolean;
}) {
  return (
    <div data-settings-row className={cn("px-4 py-3.5", disabled && "opacity-60", className)}>
      <div className={cn("flex items-center justify-between gap-4", stackOnMobile && "max-sm:flex-col max-sm:items-stretch max-sm:gap-2.5")}>
        <RowText label={label} description={description} icon={icon} danger={danger} />
        {control && <div className="shrink-0 flex items-center gap-2">{control}</div>}
      </div>
      {children && <div className="mt-3">{children}</div>}
    </div>
  );
}

/**
 * A boolean setting: the whole row is a <label>, so clicking the text flips
 * the switch too.
 */
export function SettingsToggleRow({
  label,
  description,
  icon,
  danger,
  disabled,
  checked,
  onCheckedChange,
  children,
  className,
}: SettingsRowBaseProps & {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div data-settings-row className={cn(disabled && "opacity-60", className)}>
      <label
        className={cn(
          "flex items-center justify-between gap-4 px-4 py-3.5 list-row-interactive",
          disabled ? "cursor-not-allowed" : "cursor-pointer [@media(hover:hover)]:hover:bg-[var(--bg-hover)]/50",
        )}
      >
        <RowText label={label} description={description} icon={icon} danger={danger} />
        <ToggleSwitch size="sm" checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} />
      </label>
      {children && <div className="px-4 pb-3.5">{children}</div>}
    </div>
  );
}

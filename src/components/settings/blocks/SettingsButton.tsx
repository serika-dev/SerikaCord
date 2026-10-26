"use client";

import { forwardRef, type AnchorHTMLAttributes, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/**
 * Discord-style settings buttons: `primary` (accent fill), `secondary`
 * (neutral fill), `danger` (red outline, fills on hover), `dangerFilled`,
 * `ghost` (text only). Two sizes: `sm` (28px, row actions) and `md` (32px).
 */
export type SettingsButtonVariant = "primary" | "secondary" | "danger" | "dangerFilled" | "danger-solid" | "success" | "ghost";
export type SettingsButtonSize = "sm" | "md";

export function settingsButtonClass(variant: SettingsButtonVariant = "secondary", size: SettingsButtonSize = "md", className?: string) {
  return cn(
    "inline-flex shrink-0 select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium",
    "transition-[background-color,border-color,color,opacity,transform] duration-(--motion-fast) active:scale-[0.98]",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--app-accent)]",
    "disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50",
    size === "sm" ? "h-7 px-2.5 text-xs [&_svg]:h-3.5 [&_svg]:w-3.5" : "h-8 px-3.5 text-sm [&_svg]:h-4 [&_svg]:w-4",
    variant === "primary" && "bg-[var(--app-accent)] text-[var(--text-on-accent)] hover:brightness-110",
    variant === "secondary" &&
      "border border-[var(--border-subtle)] bg-[var(--bg-hover)] text-[var(--text-primary)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-active)]",
    variant === "danger" && "border border-red-500/60 text-red-500 hover:bg-red-500 hover:text-white",
    (variant === "dangerFilled" || variant === "danger-solid") && "bg-red-500 text-white hover:bg-red-600",
    variant === "success" && "bg-green-600 text-white hover:bg-green-700",
    variant === "ghost" && "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]",
    className,
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: SettingsButtonVariant;
  size?: SettingsButtonSize;
};

export const SettingsButton = forwardRef<HTMLButtonElement, ButtonProps>(function SettingsButton(
  { variant = "secondary", size = "md", className, type = "button", ...props },
  ref,
) {
  return <button ref={ref} type={type} className={settingsButtonClass(variant, size, className)} {...props} />;
});

/** Same look for links (external management pages, OAuth "Connect"). */
export function SettingsLinkButton({
  variant = "secondary",
  size = "md",
  className,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & { variant?: SettingsButtonVariant; size?: SettingsButtonSize }) {
  return <a className={settingsButtonClass(variant, size, className)} {...props} />;
}

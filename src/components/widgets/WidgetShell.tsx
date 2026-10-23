"use client";

import { useState, type ComponentType, type ReactNode } from "react";
import { cn, cdnImage } from "@/lib/utils";

/**
 * Building blocks shared by every profile widget (game library sections, app
 * widgets, Serika Wishlist) so they read as one system: same card, header,
 * radii, focus states, skeletons and image fallbacks. Tokens live in
 * globals.css under "Serika widgets" (`--sw-*`, `.sw-card`, `.sw-stage`).
 */

type IconType = ComponentType<{ className?: string; "aria-hidden"?: boolean }>;

export function WidgetCard({
  children,
  className,
  interactive = false,
  as: Tag = "section",
  ...rest
}: {
  children: ReactNode;
  className?: string;
  /** Adds the violet hover glow; use for cards that are (or contain) a primary link. */
  interactive?: boolean;
  as?: "section" | "div" | "article";
} & Omit<React.HTMLAttributes<HTMLElement>, "className" | "children">) {
  return (
    <Tag className={cn("sw-card overflow-hidden", className)} data-interactive={interactive ? "true" : undefined} {...rest}>
      {children}
    </Tag>
  );
}

export function WidgetHeader({
  icon: Icon,
  iconSlot,
  title,
  meta,
  actions,
  className,
  titleId,
}: {
  icon?: IconType;
  /** Custom leading visual (e.g. an app icon) instead of a lucide icon. */
  iconSlot?: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  className?: string;
  titleId?: string;
}) {
  return (
    <header className={cn("flex items-center gap-2.5 px-3.5 pt-3 pb-2.5 min-w-0", className)}>
      {iconSlot ?? (Icon && (
        <span className="grid place-items-center size-7 shrink-0 rounded-[var(--sw-radius-inner)] bg-[var(--sw-accent)]/15 ring-1 ring-inset ring-[var(--sw-accent)]/25">
          <Icon className="size-3.5 text-[var(--sw-accent-soft)]" aria-hidden />
        </span>
      ))}
      <div className="min-w-0 flex-1 flex items-baseline gap-2">
        <h4 id={titleId} className="font-display text-[14px] font-semibold tracking-[-0.01em] text-[var(--sw-text)] truncate">
          {title}
        </h4>
        {meta != null && meta !== "" && (
          <span className="text-[11px] tabular-nums text-[var(--sw-faint)] shrink-0">{meta}</span>
        )}
      </div>
      {actions && <div className="flex items-center gap-0.5 shrink-0">{actions}</div>}
    </header>
  );
}

/**
 * Small icon-only button for widget toolbars. Always labelled; visible on
 * hover and on keyboard focus (never hover-only for keyboard users).
 */
export function WidgetIconButton({
  icon: Icon,
  label,
  onClick,
  tone = "default",
  revealOnHover = false,
  className,
  disabled,
}: {
  icon: IconType;
  label: string;
  onClick: () => void;
  tone?: "default" | "danger";
  /** Hide until the parent `.group` is hovered or the button is focused. */
  revealOnHover?: boolean;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cn(
        "sw-focus grid place-items-center size-7 rounded-[var(--sw-radius-inner)] transition-[background-color,color,opacity] duration-150 disabled:opacity-40",
        tone === "danger"
          ? "text-[var(--sw-muted)] hover:text-red-300 hover:bg-red-500/15"
          : "text-[var(--sw-muted)] hover:text-[var(--sw-text)] hover:bg-[var(--sw-surface-hover)]",
        revealOnHover && "sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 focus-visible:opacity-100",
        className
      )}
    >
      <Icon className="size-3.5" aria-hidden />
    </button>
  );
}

/** Uppercase eyebrow label used for small sub-sections inside a widget. */
export function WidgetEyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn("text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--sw-faint)]", className)}>
      {children}
    </p>
  );
}

/**
 * <img> with a graceful fallback when the URL 404s / is hotlink-blocked, plus
 * lazy loading and async decoding. `fallback` renders in place of a broken image.
 */
export function WidgetImage({
  src,
  alt,
  className,
  fallback,
  cdn = true,
  referrerPolicy = "no-referrer",
}: {
  src: string | null | undefined;
  alt: string;
  className?: string;
  fallback?: ReactNode;
  /** Route serika CDN URLs through cdnImage() (WebP). */
  cdn?: boolean;
  referrerPolicy?: React.ImgHTMLAttributes<HTMLImageElement>["referrerPolicy"];
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  if (!src || failedSrc === src) return <>{fallback ?? null}</>;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={cdn ? cdnImage(src) : src}
      alt={alt}
      loading="lazy"
      decoding="async"
      referrerPolicy={referrerPolicy}
      draggable={false}
      onError={() => setFailedSrc(src)}
      className={className}
    />
  );
}

/** Shimmer block in widget radii. */
export function WidgetSkeletonBlock({ className }: { className?: string }) {
  return <div aria-hidden className={cn("skeleton-shimmer rounded-[var(--sw-radius-inner)]", className)} />;
}

/** Generic loading state for a widget card: header + a row of tiles. */
export function WidgetSkeleton({ tiles = 5, label, tileClassName }: { tiles?: number; label: string; tileClassName?: string }) {
  return (
    <div className="sw-card overflow-hidden" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">{label}</span>
      <div className="flex items-center gap-2.5 px-3.5 pt-3 pb-2.5">
        <WidgetSkeletonBlock className="size-7" />
        <WidgetSkeletonBlock className="h-3.5 w-28" />
        <WidgetSkeletonBlock className="ml-auto h-3 w-10" />
      </div>
      <div className="grid grid-cols-5 gap-2 px-3.5 pb-3.5">
        {Array.from({ length: tiles }, (_, i) => (
          <WidgetSkeletonBlock key={i} className={cn("aspect-[3/4]", tileClassName)} />
        ))}
      </div>
    </div>
  );
}

/** Dashed call-to-action used for empty slots the owner can fill. */
export function WidgetAddSlot({
  onClick,
  label,
  className,
  children,
}: {
  onClick: () => void;
  label: string;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        "sw-focus group/add grid w-full place-items-center rounded-[var(--sw-radius-inner)] border border-dashed border-[var(--sw-hairline-strong)] bg-white/[0.015] text-[var(--sw-faint)] transition-colors duration-150 hover:border-[var(--sw-accent)]/60 hover:bg-[var(--sw-accent)]/[0.07] hover:text-[var(--sw-accent-soft)]",
        className
      )}
    >
      {children}
    </button>
  );
}

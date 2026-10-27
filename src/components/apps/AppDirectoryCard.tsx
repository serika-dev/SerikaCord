import type { ReactNode } from "react";
import Link from "next/link";
import { BadgeCheck, Bot, Server } from "lucide-react";
import { cdnImage, cn } from "@/lib/utils";

/**
 * One app in the App Directory: the public bot library (/bots, server
 * component) and Server Settings → App Discovery (client). No hooks, so it
 * renders in both; callers pass translated labels. Colors are app theme
 * tokens, so it follows light / dark / midnight in both places.
 */

export interface AppCardData {
  id: string;
  name: string;
  icon: string | null;
  shortDescription: string;
  categories: string[];
  tags: string[];
  verified: boolean;
  /** Made by SerikaCord (official apps also report verified). */
  official?: boolean;
  serverCount: number;
}

export interface AppCardLabels {
  verified: string;
  /** Short pill text for official apps, e.g. "Official". */
  official?: string;
  /** Tooltip for the official pill, e.g. "Made by SerikaCord". */
  officialHint?: string;
  noDescription: string;
  /** e.g. "1.2K servers" for this app. */
  servers: string;
  /** Display names for the app's categories. */
  categories: string[];
}

export function AppIcon({ icon, name, size = 56, className }: { icon: string | null; name: string; size?: number; className?: string }) {
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden rounded-[22%] bg-[color-mix(in_srgb,var(--app-accent)_16%,var(--app-surface-alt))]",
        className,
      )}
      style={{ width: size, height: size }}
    >
      {icon ? (
        // eslint-disable-next-line @next/next/no-img-element -- CDN image (wsrv), sized by the box
        <img src={cdnImage(icon)} alt="" width={size} height={size} loading="lazy" className="h-full w-full object-cover" />
      ) : (
        <Bot className="h-1/2 w-1/2 text-[var(--app-accent)]" aria-hidden />
      )}
      <span className="sr-only">{name}</span>
    </span>
  );
}

export function VerifiedMark({ label, className }: { label: string; className?: string }) {
  return (
    <span title={label} className={cn("inline-flex shrink-0 text-[var(--app-accent)]", className)}>
      <BadgeCheck className="h-4 w-4" aria-hidden />
      <span className="sr-only">{label}</span>
    </span>
  );
}

/** "Official" pill for apps made by SerikaCord; `hint` is the tooltip. */
export function OfficialPill({ label, hint, className }: { label: string; hint?: string; className?: string }) {
  return (
    <span
      title={hint || label}
      className={cn(
        "inline-flex shrink-0 items-center rounded-full bg-[var(--app-accent)] px-1.5 py-0.5 text-[10px] font-bold uppercase leading-none tracking-wide text-[var(--text-on-accent)]",
        className,
      )}
    >
      {label}
      {hint && <span className="sr-only">: {hint}</span>}
    </span>
  );
}

export function AppDirectoryCard({
  app,
  labels,
  href,
  action,
  className,
}: {
  app: AppCardData;
  labels: AppCardLabels;
  /** Detail page; the whole card links there. */
  href?: string;
  /** Extra control under the card body (e.g. "Add to Server"), outside the link. */
  action?: ReactNode;
  className?: string;
}) {
  const body = (
    <>
      <div className="flex items-start gap-3">
        <AppIcon icon={app.icon} name={app.name} size={48} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <h3 className="truncate text-[0.95rem] font-semibold text-[var(--app-text)]">{app.name}</h3>
            {app.verified && <VerifiedMark label={labels.verified} />}
            {app.official && labels.official && <OfficialPill label={labels.official} hint={labels.officialHint} />}
          </div>
          <p className="mt-0.5 flex items-center gap-1 text-xs text-[var(--app-muted)]">
            <Server className="h-3 w-3 shrink-0" aria-hidden />
            {labels.servers}
          </p>
        </div>
      </div>
      <p className="mt-3 line-clamp-2 min-h-[2.5rem] text-sm leading-5 text-[var(--app-muted)]">
        {app.shortDescription || labels.noDescription}
      </p>
      {(labels.categories.length > 0 || app.tags.length > 0) && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {labels.categories.slice(0, 2).map((c) => (
            <span key={`c-${c}`} className="rounded-full bg-[color-mix(in_srgb,var(--app-accent)_14%,transparent)] px-2 py-0.5 text-[11px] font-medium text-[var(--app-accent)]">
              {c}
            </span>
          ))}
          {app.tags.slice(0, 3).map((t) => (
            <span key={`t-${t}`} className="max-w-[10rem] truncate rounded-full bg-[var(--app-surface-alt)] px-2 py-0.5 text-[11px] font-medium text-[var(--app-muted)]">
              {t}
            </span>
          ))}
        </div>
      )}
    </>
  );

  return (
    <article
      className={cn(
        "group flex h-full flex-col rounded-2xl border border-[var(--app-border)] bg-[var(--app-surface)] p-4 transition-colors hover:border-[color-mix(in_srgb,var(--app-accent)_45%,var(--app-border))]",
        className,
      )}
    >
      {href ? (
        <Link href={href} className="flex flex-1 flex-col rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-accent)]">
          {body}
        </Link>
      ) : (
        <div className="flex flex-1 flex-col">{body}</div>
      )}
      {action && <div className="mt-4 flex flex-wrap gap-2">{action}</div>}
    </article>
  );
}

/** "1.2K" style counts in the viewer's locale. */
export function formatCount(n: number, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }).format(n);
  } catch {
    return String(n);
  }
}

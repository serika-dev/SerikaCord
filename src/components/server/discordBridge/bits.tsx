"use client";

import type { ReactNode } from "react";
import { useGT, useLocale } from "gt-next";
import { cn } from "@/lib/utils";
import type { BridgeHealth } from "./types";

export function DiscordMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn("fill-current", className)} aria-hidden="true">
      <path d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.872-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.009c.12.099.246.198.373.292a.077.077 0 0 1-.006.127 12.3 12.3 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.06.06 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
    </svg>
  );
}

export type PillTone = "ok" | "warn" | "error" | "muted" | "accent";

const TONES: Record<PillTone, string> = {
  ok: "bg-emerald-500/15 text-emerald-500",
  warn: "bg-amber-500/15 text-amber-500",
  error: "bg-red-500/15 text-red-500",
  muted: "bg-[var(--bg-hover)] text-[var(--text-secondary)]",
  accent: "bg-[var(--app-accent)]/15 text-[var(--app-accent)]",
};

export function StatusPill({ tone, children, dot = true, className }: { tone: PillTone; children: ReactNode; dot?: boolean; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap", TONES[tone], className)}>
      {dot && <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />}
      {children}
    </span>
  );
}

/** Label + description on the left, control on the right; hairline divider between rows. */
export function SettingRow({ label, description, children, className }: { label: ReactNode; description?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-start justify-between gap-4 py-3 border-b border-[var(--border-subtle)] last:border-b-0", className)}>
      <div className="min-w-0">
        <p className="text-sm font-medium text-[var(--text-primary)]">{label}</p>
        {description && <p className="mt-0.5 text-xs text-[var(--text-secondary)] leading-relaxed">{description}</p>}
      </div>
      <div className="shrink-0 pt-0.5">{children}</div>
    </div>
  );
}

export const btnBase =
  "inline-flex items-center justify-center gap-1.5 h-9 px-3.5 rounded-lg text-sm font-medium transition-[background-color,color,opacity,transform] duration-150 ease-out active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--app-accent)] disabled:opacity-50 disabled:pointer-events-none motion-reduce:transition-none motion-reduce:active:scale-100";
export const btnPrimary = cn(btnBase, "bg-[var(--app-accent)] text-[var(--text-on-accent)] hover:bg-[var(--accent-hover)]");
export const btnDiscord = cn(btnBase, "bg-[var(--discord-brand)] text-white hover:brightness-110");
export const btnSecondary = cn(btnBase, "border border-[var(--border-subtle)] bg-[var(--bg-card)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)]");
export const btnGhost = cn(btnBase, "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]");
export const btnDanger = cn(btnBase, "bg-red-500/10 text-red-500 hover:bg-red-500/20");

/** "5 minutes ago" in the viewer's locale. */
export function useRelativeTime(): (iso: string | null | undefined) => string | null {
  const locale = useLocale();
  return (iso) => {
    if (!iso) return null;
    const then = new Date(iso).getTime();
    if (!Number.isFinite(then)) return null;
    const seconds = Math.round((then - Date.now()) / 1000);
    const rtf = new Intl.RelativeTimeFormat(locale || "en", { numeric: "auto" });
    const abs = Math.abs(seconds);
    if (abs < 60) return rtf.format(seconds, "second");
    if (abs < 3600) return rtf.format(Math.round(seconds / 60), "minute");
    if (abs < 86400) return rtf.format(Math.round(seconds / 3600), "hour");
    return rtf.format(Math.round(seconds / 86400), "day");
  };
}

/** What a stored health error means, and what to do about it. */
export function useHealthMessage(): (health: BridgeHealth | null | undefined) => string | null {
  const gt = useGT();
  return (health) => {
    switch (health?.error?.code) {
      case "webhook_missing":
        return gt("The bridge webhook was deleted on Discord. Repair it to resume SerikaCord → Discord messages.");
      case "missing_permissions":
        return gt("The Serika bot lost a permission in this Discord channel (Manage Webhooks or Send Messages).");
      case "rate_limited":
        return gt("Discord rate limited the bridge. Messages will resume on their own.");
      case "discord_error":
        return gt("Discord rejected the last mirrored message.");
      default:
        return null;
    }
  };
}

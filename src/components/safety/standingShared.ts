"use client";

import { useSyncExternalStore } from "react";
import type { useGT } from "gt-next";
import type { StandingLevel } from "@/lib/safety/standing";
import { decodeHtmlEntities } from "@/lib/chat/messages";

// Client mirror of StandingView (src/lib/services/trustSafety.ts), shared by
// the user's Account Standing screen and the staff Trust & Safety panel.

export type GT = ReturnType<typeof useGT>;
export type { StandingLevel };

export interface AppealRef {
  id: string;
  status: string;
  staffNote: string | null;
}

export interface StandingStrike {
  id: string;
  category: string;
  reason: string;
  source: string;
  createdAt: string;
  expiresAt: string | null;
  active: boolean;
  revoked: boolean;
  appeal: AppealRef | null;
}

export interface StandingRestriction {
  id: string;
  type: string;
  reason: string;
  until: string;
  active: boolean;
  createdAt: string;
}

export interface StandingAppeal {
  id: string;
  targetType: string;
  targetId: string | null;
  status: string;
  staffNote: string | null;
  createdAt: string;
  message: string;
}

export interface StandingData {
  level: StandingLevel;
  banned: boolean;
  banReason: string | null;
  maxStrikes: number;
  activeStrikes: number;
  strikes: StandingStrike[];
  restrictions: StandingRestriction[];
  appeals: StandingAppeal[];
  banAppeal: AppealRef | null;
}

export interface SafetyUserCard {
  id: string;
  username: string;
  displayName: string | null;
  avatar: string | null;
  isBanned?: boolean;
}

export const STANDING_LEVELS: readonly StandingLevel[] = ["all_good", "limited", "very_limited", "at_risk", "suspended"];

/** Static Tailwind classes per level (status colors, not theme roles). */
export const LEVEL_STYLE: Record<StandingLevel, { dot: string; text: string; soft: string; ring: string; border: string }> = {
  all_good: { dot: "bg-emerald-500", text: "text-emerald-500", soft: "bg-emerald-500/10", ring: "ring-emerald-500/30", border: "border-emerald-500/40" },
  limited: { dot: "bg-yellow-500", text: "text-yellow-500", soft: "bg-yellow-500/10", ring: "ring-yellow-500/30", border: "border-yellow-500/40" },
  very_limited: { dot: "bg-amber-500", text: "text-amber-500", soft: "bg-amber-500/10", ring: "ring-amber-500/30", border: "border-amber-500/40" },
  at_risk: { dot: "bg-orange-500", text: "text-orange-500", soft: "bg-orange-500/10", ring: "ring-orange-500/30", border: "border-orange-500/40" },
  suspended: { dot: "bg-red-500", text: "text-red-500", soft: "bg-red-500/10", ring: "ring-red-500/30", border: "border-red-500/40" },
};

export function levelLabel(level: StandingLevel, gt: GT): string {
  switch (level) {
    case "all_good": return gt("All good");
    case "limited": return gt("Limited");
    case "very_limited": return gt("Very limited");
    case "at_risk": return gt("At risk");
    case "suspended": return gt("Suspended");
    default: return String(level);
  }
}

export function categoryLabel(category: string, gt: GT): string {
  switch (category) {
    case "scam": return gt("Scams and fraud");
    case "csam": return gt("Child safety");
    case "spam": return gt("Spam");
    case "harassment": return gt("Harassment");
    case "hate": return gt("Hateful conduct");
    case "impersonation": return gt("Impersonation");
    case "nsfw": return gt("Sexual content");
    case "other": return gt("Other violation");
    default: return category;
  }
}

/** Server text is HTML-escaped at rest; render it as plain React text. */
export function plain(value: string | null | undefined): string {
  return decodeHtmlEntities(value ?? "");
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

/** Compact remaining time: "3d 4h", "23h 12m", "12m", "<1m". */
export function formatRemaining(ms: number): string {
  if (ms <= 60_000) return "<1m";
  const totalMinutes = Math.floor(ms / 60_000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  return `${minutes}m`;
}

// ─── A shared ticking clock (one interval for every countdown on screen) ─────

const CLOCK_TICK_MS = 15_000;
let clockNow = 0;
let clockTimer: number | null = null;
const clockListeners = new Set<() => void>();

function subscribeClock(onChange: () => void) {
  clockListeners.add(onChange);
  if (clockTimer === null) {
    clockNow = Date.now();
    clockTimer = window.setInterval(() => {
      clockNow = Date.now();
      clockListeners.forEach((listener) => listener());
    }, CLOCK_TICK_MS);
  }
  return () => {
    clockListeners.delete(onChange);
    if (clockListeners.size === 0 && clockTimer !== null) {
      window.clearInterval(clockTimer);
      clockTimer = null;
    }
  };
}

function getClock() {
  if (clockNow === 0) clockNow = Date.now();
  return clockNow;
}

/** Current time, refreshed every 15s while any countdown is mounted. */
export function useClock(): number {
  return useSyncExternalStore(subscribeClock, getClock, getClock);
}

/** The user's appeal for a restriction (restrictions carry no appeal field). */
export function appealFor(standing: StandingData, targetType: "strike" | "restriction", targetId: string): AppealRef | null {
  const a = standing.appeals.find((x) => x.targetType === targetType && x.targetId === targetId);
  return a ? { id: a.id, status: a.status, staffNote: a.staffNote } : null;
}

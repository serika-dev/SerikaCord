import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Format a millisecond duration as a short human string, e.g. "2d 3h", "5m", "45s".
 */
export function formatDuration(ms: number): string {
  if (ms <= 0) return "0s";
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${seconds}s`;
}

/**
 * Given a server member's `communicationDisabledUntil` timestamp, report whether
 * they are currently timed out and a human-readable remaining-time label.
 * Server-only concept; returns inactive for null/past values.
 */
export function getTimeoutRemaining(until?: string | Date | null): { active: boolean; label: string } {
  if (!until) return { active: false, label: "" };
  const untilMs = typeof until === "string" ? Date.parse(until) : until.getTime();
  if (Number.isNaN(untilMs)) return { active: false, label: "" };
  const remaining = untilMs - Date.now();
  if (remaining <= 0) return { active: false, label: "" };
  return { active: true, label: formatDuration(remaining) };
}

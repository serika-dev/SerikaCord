"use client";

import { Badge, getBadgeMeta, type BadgeId } from "@/components/ui/badges";
import { useGT } from "gt-next";
import { cn } from "@/lib/utils";

interface StaffPillProps {
  badges?: string[];
  className?: string;
}

// Priority order — the first matching rank is shown as a compact icon badge.
const STAFF_RANKS: BadgeId[] = [
  "serikacord_developer",
  "staff",
  "admin",
  "moderator",
];

export function StaffPill({ badges, className }: StaffPillProps) {
  const gt = useGT();
  if (!badges || badges.length === 0) return null;

  const rank = STAFF_RANKS.find((r) => badges.includes(r));
  if (!rank) return null;

  const meta = getBadgeMeta(rank);

  return (
    <span
      aria-label={meta?.name || gt("Badge")}
      className={cn("self-center shrink-0 rounded-md", className)}
    >
      <Badge id={rank} size="xs" showTooltip />
    </span>
  );
}

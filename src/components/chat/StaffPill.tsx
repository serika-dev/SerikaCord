"use client";

import { Badge, badgeLabel, type BadgeId } from "@/components/ui/badges";
import { useBadges } from "@/hooks/useBadges";
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
  const { byId } = useBadges();
  if (!badges || badges.length === 0) return null;

  // Skip ranks staff have hidden in the badge admin panel.
  const rank = STAFF_RANKS.find((r) => badges.includes(r) && byId.get(r) && !byId.get(r)!.hidden);
  if (!rank) return null;

  const def = byId.get(rank)!;

  return (
    <span
      aria-label={badgeLabel(def, gt).name || gt("Badge")}
      className={cn("self-center shrink-0 rounded-md", className)}
    >
      <Badge id={rank} size="xs" showTooltip />
    </span>
  );
}

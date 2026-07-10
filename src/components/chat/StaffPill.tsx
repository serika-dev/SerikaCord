"use client";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge, badgeLabel, getBadgeMeta, type BadgeId } from "@/components/ui/badges";
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
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={meta?.name || gt("Badge")}
          className={cn("self-center shrink-0 rounded-md cursor-pointer", className)}
        >
          {/* Hover tooltip on desktop; the popover handles tap on touch. */}
          <Badge id={rank} size="xs" showTooltip />
        </button>
      </PopoverTrigger>
      {meta && (
        <PopoverContent
          side="top"
          align="start"
          className="w-auto max-w-[220px] p-2.5 bg-[#0a0a0a] border-[#222222]"
        >
          <div className="text-sm font-semibold text-white" style={{ color: meta.color }}>{badgeLabel(rank, gt).name}</div>
          <div className="text-xs text-[#888888] mt-0.5">{badgeLabel(rank, gt).description}</div>
        </PopoverContent>
      )}
    </Popover>
  );
}

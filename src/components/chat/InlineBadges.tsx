"use client";

import { getBadgesByPriority, type BadgeId } from "@/lib/constants/badges";
import { cn } from "@/lib/utils";

interface InlineBadgesProps {
  badges?: string[];
  size?: "xs" | "sm";
  className?: string;
}

/**
 * Compact inline badge row for message headers.
 * Shows all badges as small icons without tooltips.
 * The full badge details are visible in the user's profile popup.
 */
export function InlineBadges({ badges, size = "xs", className }: InlineBadgesProps) {
  if (!badges || badges.length === 0) return null;

  const sorted = getBadgesByPriority(badges as BadgeId[]);
  if (sorted.length === 0) return null;

  const iconSize = size === "xs" ? "w-3.5 h-3.5" : "w-4 h-4";
  const containerSize = size === "xs" ? "w-4 h-4" : "w-5 h-5";

  return (
    <span className={cn("inline-flex items-center gap-0.5 align-middle", className)}>
      {sorted.map((badge) => {
        const Icon = badge.icon;
        return (
          <span
            key={badge.id}
            className={cn("inline-flex items-center justify-center rounded shrink-0", containerSize)}
            style={{ backgroundColor: `${badge.color}1f` }}
          >
            <Icon className={iconSize} style={{ color: badge.color }} />
          </span>
        );
      })}
    </span>
  );
}

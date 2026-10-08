"use client";

import { useBadges } from "@/hooks/useBadges";
import { BadgeIcon } from "@/components/ui/BadgeIcon";
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
  const { resolve } = useBadges();
  if (!badges || badges.length === 0) return null;

  const sorted = resolve(badges);
  if (sorted.length === 0) return null;

  const iconSize = size === "xs" ? "w-3.5 h-3.5" : "w-4 h-4";
  const containerSize = size === "xs" ? "w-4 h-4" : "w-5 h-5";

  return (
    <span className={cn("inline-flex items-center gap-0.5 align-middle", className)}>
      {sorted.map((badge) => (
        <span
          key={badge.id}
          className={cn("inline-flex items-center justify-center rounded shrink-0", containerSize)}
          style={{ backgroundColor: `${badge.color}1f` }}
        >
          <BadgeIcon badge={badge} className={iconSize} />
        </span>
      ))}
    </span>
  );
}

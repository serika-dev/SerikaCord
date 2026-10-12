"use client";

import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { PULL_THRESHOLD } from "@/hooks/usePullToRefresh";

/**
 * Pull-to-refresh spinner that sits at the top of a scroll list and pushes the
 * content down while pulling (like a native list), then stays while refreshing.
 */
export function PullIndicator({ distance, refreshing }: { distance: number; refreshing: boolean }) {
  const height = refreshing ? 44 : distance;
  const ready = distance >= PULL_THRESHOLD;
  return (
    <div
      aria-hidden={!refreshing}
      className={cn(
        "flex items-end justify-center overflow-hidden",
        distance === 0 && "transition-[height] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
      )}
      style={{ height }}
    >
      <div
        className={cn(
          "mb-2 flex h-8 w-8 items-center justify-center rounded-full bg-[var(--bg-card)] shadow-md transition-[transform,background-color] duration-200 motion-reduce:transition-none",
          ready || refreshing ? "scale-100" : "scale-90",
        )}
        style={{ opacity: refreshing ? 1 : Math.min(1, distance / PULL_THRESHOLD) }}
      >
        <RefreshCw
          className={cn("h-4 w-4 text-[var(--app-accent)]", refreshing && "animate-spin motion-reduce:animate-none")}
          style={refreshing ? undefined : { transform: `rotate(${distance * 3}deg)` }}
        />
      </div>
    </div>
  );
}

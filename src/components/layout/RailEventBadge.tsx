"use client";

/**
 * Discord-style event badge on a server rail icon (desktop ServerSidebar and
 * the mobile MobileServerList), fed by `activeEvent` on /@me/servers. See
 * lib/chat/serverEventBadge.ts for which event a server advertises.
 */

import { useEffect, useMemo, useState } from "react";
import { CalendarDays, Radio } from "lucide-react";
import { cn } from "@/lib/utils";
import { onScheduledEventChange } from "@/lib/chat/scheduledEventsBus";
import type { EventBadgeState, ServerActiveEvent } from "@/lib/chat/serverEventBadge";

/**
 * Green with a broadcast glyph while an event is live, a quieter calendar while
 * one starts within the hour; punched out of the rail by a `ringColor` border.
 * Sits bottom-right, or bottom-left when the mention badge holds that corner.
 * Decorative: the icon's tooltip / label says it.
 */
export function RailEventBadge({
  state,
  left = false,
  ringColor = "var(--app-bg)",
}: {
  state: NonNullable<EventBadgeState>;
  left?: boolean;
  ringColor?: string;
}) {
  const live = state.kind === "live";
  return (
    <span
      aria-hidden
      data-event-badge={state.kind}
      className={cn(
        "pointer-events-none absolute -bottom-1 z-[1] flex h-5 w-5 items-center justify-center rounded-full border-[3px]",
        left ? "-left-1" : "-right-1",
        live ? "bg-[var(--event-live)] text-[var(--status-glyph)]" : "bg-[var(--app-surface-alt)] text-[var(--event-live)]",
      )}
      style={{ borderColor: ringColor }}
    >
      {live ? <Radio className="h-2.5 w-2.5" strokeWidth={3} /> : <CalendarDays className="h-2.5 w-2.5" strokeWidth={3} />}
    </span>
  );
}

/**
 * The clock the rail's event badges are evaluated against, plus live refresh:
 * ticks every 30s only while some server has an upcoming event ("Starts in
 * N min"), and refetches the server list when an event changes in one of your
 * servers (jittered + coalesced so a busy server's members don't refetch in
 * lockstep; the 25s poll covers events entering the one-hour window).
 */
export function useRailEventClock(
  servers: readonly { activeEvent?: ServerActiveEvent | null }[],
  refetch: () => Promise<void> | void,
): number {
  const hasUpcoming = useMemo(() => servers.some((s) => s.activeEvent?.status === "scheduled"), [servers]);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!hasUpcoming) return;
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 30_000);
    return () => { clearTimeout(first); clearInterval(id); };
  }, [hasUpcoming]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const off = onScheduledEventChange(() => {
      if (timer) return;
      timer = setTimeout(() => { timer = null; void refetch(); }, 1000 + Math.random() * 4000);
    });
    return () => { off(); if (timer) clearTimeout(timer); };
  }, [refetch]);
  return now;
}

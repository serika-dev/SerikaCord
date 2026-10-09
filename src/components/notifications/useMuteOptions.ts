"use client";

import { useMemo } from "react";
import { useGT } from "gt-next";
import { MUTE_DURATIONS, MUTE_FOREVER } from "@/lib/notifications/levels";

export interface MuteOption {
  key: string;
  minutes: number | null;
  label: string;
}

/** Translated mute durations for menus ("For 15 minutes" … "Until I turn it back on"). */
export function useMuteOptions(): MuteOption[] {
  const gt = useGT();
  return useMemo(() => {
    const labels: Record<string, string> = {
      "15m": gt("For 15 minutes"),
      "1h": gt("For 1 hour"),
      "8h": gt("For 8 hours"),
      "24h": gt("For 24 hours"),
      forever: gt("Until I turn it back on"),
    };
    return MUTE_DURATIONS.map((d) => ({ key: d.key, minutes: d.minutes, label: labels[d.key] ?? d.key }));
  }, [gt]);
}

/** "Muted until 4:30 PM" / "Muted" label for an active mute. */
export function useMutedUntilLabel(): (muteUntil: number | undefined) => string {
  const gt = useGT();
  return useMemo(
    () => (muteUntil: number | undefined) => {
      if (!muteUntil || muteUntil === MUTE_FOREVER) return gt("Muted");
      const d = new Date(muteUntil);
      const sameDay = d.toDateString() === new Date().toDateString();
      const time = sameDay
        ? d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
        : d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
      return gt("Muted until {time}", { time });
    },
    [gt],
  );
}

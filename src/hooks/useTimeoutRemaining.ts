"use client";

import { useEffect, useState } from "react";
import { getTimeoutRemaining } from "@/lib/utils";

/**
 * Realtime version of `getTimeoutRemaining`: recomputes every second while the
 * member is timed out so the countdown label ticks down live and flips to
 * inactive the moment the timeout expires — without waiting for an unrelated
 * re-render (e.g. a members-list update). The interval only runs while active,
 * so idle members cost nothing.
 */
export function useTimeoutRemaining(until?: string | Date | null): { active: boolean; label: string } {
  const [, setTick] = useState(0);
  const result = getTimeoutRemaining(until);

  useEffect(() => {
    if (!result.active) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [result.active, until]);

  return result;
}

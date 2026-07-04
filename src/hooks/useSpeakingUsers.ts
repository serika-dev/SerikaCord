"use client";

import { useEffect, useState } from "react";
import { voiceService } from "@/lib/services/voiceService";

/**
 * Tracks the set of currently-speaking user IDs from the voice service's
 * `speaking` events. Shared by the voice bar and video grid so speaking
 * indicators stay in sync everywhere.
 */
export function useSpeakingUsers(): Set<string> {
  const [speaking, setSpeaking] = useState<Set<string>>(() => {
    const snapshot = voiceService.speakingSnapshot;
    return new Set([...snapshot.entries()].filter(([, v]) => v).map(([k]) => k));
  });

  useEffect(() => {
    return voiceService.subscribe((event) => {
      if (event.type === "speaking") {
        setSpeaking((prev) => {
          const has = prev.has(event.userId);
          if (event.speaking === has) return prev;
          const next = new Set(prev);
          if (event.speaking) next.add(event.userId);
          else next.delete(event.userId);
          return next;
        });
      } else if (event.type === "disconnected") {
        setSpeaking(new Set());
      }
    });
  }, []);

  return speaking;
}

"use client";

import { useCallback } from "react";
import { MUTE_FOREVER, isMuteActive, muteUntilFor } from "@/lib/notifications/levels";
import { updateNotificationOverride, useNotificationPrefs } from "@/lib/notifications/prefsStore";

/**
 * Per-server mute state, from the user's server-side notification settings
 * (synced across devices; the old device-local `server-mutes` list is migrated
 * once by the prefs store). A muted server dims on the rail and drops its
 * unread pill; mention badges still show.
 */
export function useServerMutes() {
  const prefs = useNotificationPrefs();

  const isMuted = useCallback((serverId: string) => isMuteActive(prefs.doc.servers[serverId]), [prefs]);

  const muteUntilOf = useCallback((serverId: string) => prefs.doc.servers[serverId]?.muteUntil, [prefs]);

  /** Mute for `minutes` (null = until turned back on). */
  const muteServer = useCallback((serverId: string, minutes: number | null) => {
    void updateNotificationOverride("server", serverId, { muteUntil: muteUntilFor(minutes) });
  }, []);

  const unmuteServer = useCallback((serverId: string) => {
    void updateNotificationOverride("server", serverId, { muteUntil: null });
  }, []);

  const toggleMute = useCallback(
    (serverId: string) => {
      void updateNotificationOverride("server", serverId, {
        muteUntil: isMuteActive(prefs.doc.servers[serverId]) ? null : MUTE_FOREVER,
      });
    },
    [prefs],
  );

  return { isMuted, muteUntilOf, muteServer, unmuteServer, toggleMute };
}

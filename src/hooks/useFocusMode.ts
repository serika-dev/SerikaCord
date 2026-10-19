"use client";

import { useCallback } from "react";
import { useGT } from "gt-next";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { setUserNotificationSettings } from "@/lib/services/notificationUX";

/**
 * Focus Mode (only direct mentions and DMs notify): the same
 * `settings.notifications.focusMode` the Notifications settings page edits,
 * toggled from the status menu and the mobile status sheet (CORD-13).
 */
export function useFocusMode(): { focusMode: boolean; setFocusMode: (enabled: boolean) => Promise<void> } {
  const gt = useGT();
  const { user, updateUser } = useAuth();
  const settings = user?.settings;
  const focusMode = Boolean(settings?.notifications?.focusMode);

  const setFocusMode = useCallback(async (enabled: boolean) => {
    const prev = (settings || {}) as NonNullable<typeof settings>;
    const optimistic = { ...prev, notifications: { ...(prev.notifications || {}), focusMode: enabled } };
    updateUser({ settings: optimistic });
    setUserNotificationSettings(optimistic.notifications);
    try {
      const res = await fetch("/api/users/me/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: { notifications: { focusMode: enabled } } }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.settings) throw new Error("save failed");
      updateUser({ settings: data.settings });
      setUserNotificationSettings(data.settings.notifications);
      toast.success(enabled ? gt("Focus Mode on: only direct mentions and DMs notify you") : gt("Focus Mode off"));
    } catch {
      updateUser({ settings: prev });
      setUserNotificationSettings(prev.notifications);
      toast.error(gt("Failed to save settings"));
    }
  }, [settings, updateUser, gt]);

  return { focusMode, setFocusMode };
}

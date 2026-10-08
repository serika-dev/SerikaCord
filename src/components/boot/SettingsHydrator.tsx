"use client";

import { useEffect, useRef } from "react";
import { useLocale as useGtLocale, useSetLocale } from "gt-next";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { sharedGet } from "@/lib/bootFetch";
import { setUserNotificationSettings } from "@/lib/services/notificationUX";
import { voiceService } from "@/lib/services/voiceService";
import { resolveSupportedLocale } from "@/hooks/useLocale";

/**
 * Applies the signed-in account's server-side settings (theme, notification
 * and DND preferences, soundboard volume, saved language) whenever the
 * signed-in user changes: cold load, in-app login, QR login or account switch.
 * On logout the cached notification preferences are dropped so the next
 * account doesn't inherit them. The local theme stays (per-device).
 */
export function SettingsHydrator() {
  const { user } = useAuth();
  const { applyUserSettingsPatch } = useTheme();
  const setGtLocale = useSetLocale();
  const gtLocale = useGtLocale();
  const userId = user?.id ?? null;
  const hadUserRef = useRef(false);
  const gtLocaleRef = useRef(gtLocale);

  useEffect(() => {
    gtLocaleRef.current = gtLocale;
  }, [gtLocale]);

  useEffect(() => {
    if (!userId) {
      if (hadUserRef.current) setUserNotificationSettings(undefined);
      hadUserRef.current = false;
      return;
    }
    hadUserRef.current = true;
    let active = true;

    sharedGet("/api/users/me/settings")
      .then(async (res) => (res.ok ? res.json() : null))
      .then((data) => {
        const settings = data?.settings;
        if (!active || !settings) return;
        applyUserSettingsPatch(settings);
        setUserNotificationSettings(settings.notifications);
        if (typeof settings.voiceVideo?.soundboardVolume === "number") {
          voiceService.setSoundboardVolume(settings.voiceVideo.soundboardVolume);
        }

        // New device: restore the account's language unless this device
        // already has an explicit choice. 'en-US' is the injected default.
        const dbLocale = settings.language?.locale;
        let stored: string | null = null;
        try { stored = localStorage.getItem("serika-locale"); } catch { /* storage blocked */ }
        if (!stored && typeof dbLocale === "string" && dbLocale && dbLocale !== "en-US") {
          const resolved = resolveSupportedLocale(dbLocale);
          try { localStorage.setItem("serika-locale", resolved); } catch { /* storage blocked */ }
          if (resolved !== gtLocaleRef.current) setGtLocale(resolved);
        }
      })
      .catch(() => {
        // optional hydration
      });

    return () => {
      active = false;
    };
  }, [userId, applyUserSettingsPatch, setGtLocale]);

  return null;
}

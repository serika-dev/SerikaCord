"use client";

import { useEffect } from "react";
import { useSetLocale, useLocale } from "gt-next";

/**
 * Bridges the user's stored locale preference (localStorage `serika-locale`) to
 * gt-next. The server now resolves the locale from the `generaltranslation.locale`
 * cookie (see getLocale.ts), and gt-next's setLocale sets that cookie and reloads.
 *
 * We only call setLocale when the stored preference DIFFERS from the locale the
 * server already rendered (`useLocale()`). Without this guard we'd call setLocale
 * on every mount → cookie + full reload → remount → call again → infinite loop.
 * With it, at most one reload happens to bring the server in sync, then it's stable.
 */
export function LocaleSync() {
  const setGtLocale = useSetLocale();
  const currentLocale = useLocale();

  useEffect(() => {
    const stored = localStorage.getItem("serika-locale");
    if (stored && stored !== currentLocale) {
      setGtLocale(stored);
    }
  }, [setGtLocale, currentLocale]);

  return null;
}

"use client";

import { useEffect } from "react";
import { useSetLocale } from "gt-next";

export function LocaleSync() {
  const setGtLocale = useSetLocale();

  useEffect(() => {
    const stored = localStorage.getItem("serika-locale");
    if (stored && stored !== "en") {
      setGtLocale(stored);
    }
  }, [setGtLocale]);

  return null;
}

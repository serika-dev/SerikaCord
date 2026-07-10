"use client";

import { useCallback, useEffect, useState } from "react";

const RTL_LOCALES = ["ar", "he", "fa", "ur", "ps", "sd", "ug", "yi", "dv"];

const SUPPORTED_LOCALES = [
  "af", "am", "ar", "ar-AE", "ar-EG", "ar-LB", "ar-MA", "ar-OM", "ar-SA",
  "bg", "bn", "ca", "cs", "da",
  "de", "de-AT", "de-CH", "de-DE",
  "el", "el-CY",
  "en",
  "es", "es-419", "es-AR", "es-CL", "es-CO", "es-ES", "es-MX", "es-PE", "es-US", "es-VE",
  "et", "fa", "fi", "fil",
  "fr", "fr-BE", "fr-CA", "fr-CH", "fr-CM", "fr-FR", "fr-SN",
  "gu", "he", "hi", "hr", "hu", "hy",
  "id", "is",
  "it", "it-CH", "it-IT",
  "ja", "ka", "kk", "kn", "ko", "lt", "lv",
  "mk", "ml", "mn", "mr", "ms", "my",
  "nb", "nb-NO",
  "nl", "nl-BE", "nl-NL",
  "no", "no-NO",
  "pa", "pl",
  "pt", "pt-BR", "pt-PT",
  "ro", "ru", "sk", "sl", "sq", "sr", "sv",
  "sw", "sw-KE", "sw-TZ",
  "ta", "te", "th", "tl", "tr",
  "uk", "ur", "uz",
  "vi",
  "zh", "zh-CN", "zh-HK", "zh-Hans", "zh-Hant", "zh-SG", "zh-TW",
];

export function isRTLLocale(locale: string): boolean {
  return RTL_LOCALES.some((l) => locale.startsWith(l));
}

function resolveSupportedLocale(locale: string): string {
  if (!locale) return "en";
  const lower = locale.toLowerCase();
  const exact = SUPPORTED_LOCALES.find((l) => lower === l || lower.startsWith(l + "-"));
  if (exact) return exact;
  const base = lower.split("-")[0];
  return SUPPORTED_LOCALES.find((l) => l === base) || "en";
}

export function useLocale() {
  const [locale, setLocaleState] = useState<string>("en");
  const [isRTL, setIsRTL] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem("serika-locale");
    if (stored) {
      const resolved = resolveSupportedLocale(stored);
      setLocaleState(resolved);
      setIsRTL(isRTLLocale(resolved));
      return;
    }

    // No stored locale — try fetching from DB account settings
    fetch("/api/users/me/settings")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        const dbLocale = data?.language?.locale;
        if (dbLocale) {
          const resolved = resolveSupportedLocale(dbLocale);
          localStorage.setItem("serika-locale", resolved);
          setLocaleState(resolved);
          setIsRTL(isRTLLocale(resolved));
          return;
        }
        // Fall back to browser language
        const browserLang = navigator?.languages?.[0] || navigator?.language || "en";
        const resolved = resolveSupportedLocale(browserLang);
        localStorage.setItem("serika-locale", resolved);
        setLocaleState(resolved);
        setIsRTL(isRTLLocale(resolved));
      })
      .catch(() => {
        const browserLang = navigator?.languages?.[0] || navigator?.language || "en";
        const resolved = resolveSupportedLocale(browserLang);
        setLocaleState(resolved);
        setIsRTL(isRTLLocale(resolved));
      });
  }, []);

  const setLocale = useCallback((newLocale: string) => {
    const resolved = resolveSupportedLocale(newLocale);
    localStorage.setItem("serika-locale", resolved);
    setLocaleState(resolved);
    const rtl = isRTLLocale(resolved);
    setIsRTL(rtl);
    const root = document.documentElement;
    root.setAttribute("lang", resolved);
    root.setAttribute("dir", rtl ? "rtl" : "ltr");
    if (rtl) {
      root.classList.add("rtl");
    } else {
      root.classList.remove("rtl");
    }
  }, []);

  return { locale, isRTL, setLocale };
}

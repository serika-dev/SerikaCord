"use client";

import { useLocaleSelector, useSetLocale } from "gt-next";
import { useLocale } from "@/hooks/useLocale";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

const LOCALE_FLAGS: Record<string, string> = {
  af: "🇿🇦", am: "🇪🇹", ar: "🇪🇬",
  "ar-AE": "🇦🇪", "ar-EG": "🇪🇬", "ar-LB": "🇱🇧", "ar-MA": "🇲🇦", "ar-OM": "🇴🇲", "ar-SA": "🇸🇦",
  bg: "🇧🇬", bn: "🇧🇩", bs: "🇧🇦", ca: "🌍", cs: "🇨🇿", cy: "🏴", da: "🇩🇰",
  de: "🇩🇪", "de-AT": "🇦🇹", "de-CH": "🇨🇭", "de-DE": "🇩🇪",
  el: "🇬🇷", "el-CY": "🇨🇾",
  en: "🇺🇸",
  eo: "🌍",
  es: "🇪🇸", "es-419": "🌎", "es-AR": "�🇷", "es-CL": "🇨🇱", "es-CO": "🇨🇴", "es-ES": "🇪🇸", "es-MX": "🇲🇽", "es-PE": "🇵🇪", "es-US": "🇺🇸", "es-VE": "�🇪",
  et: "🇪🇪", fa: "🇮�", fi: "🇫🇮", fil: "🇵🇭",
  fr: "🇫🇷", "fr-BE": "🇧🇪", "fr-CA": "�🇦", "fr-CH": "🇨🇭", "fr-CM": "🇨🇲", "fr-FR": "🇫�🇷", "fr-SN": "🇸🇳",
  gu: "🇮🇳", ha: "🇳🇬", he: "🇮🇱", hi: "🇮🇳", hr: "🇭🇷", hu: "🇭🇺", hy: "🇦🇲",
  id: "🇮🇩", ig: "🇳🇬", is: "🇮🇸",
  it: "🇮�", "it-CH": "�🇨🇭", "it-IT": "�🇹",
  ja: "🇯🇵", ka: "🇬🇪", kk: "🇰🇿", kn: "🇮🇳", ko: "🇰🇷", la: "🇻🇦", lt: "🇱🇹", lv: "🇱🇻",
  mk: "🇲🇰", ml: "🇮🇳", mn: "🇲🇳", mr: "��", ms: "🇲🇾", my: "🇲🇲",
  nb: "🇳🇴", "nb-NO": "��",
  nl: "🇳🇱", "nl-BE": "🇧🇪", "nl-NL": "🇳🇱",
  nn: "🇳🇴", "nn-NO": "🇳🇴", no: "🇳🇴", "no-NO": "🇳🇴",
  pa: "🇮🇳", pl: "🇵🇱",
  pt: "🇧🇷", "pt-BR": "�🇷", "pt-PT": "🇵�🇹",
  ro: "🇷🇴", ru: "🇷🇺", sk: "🇸🇰", sl: "🇸🇮", so: "🇸🇴", sq: "🇦🇱", sr: "🇷🇸", sv: "🇸🇪",
  sw: "🇹🇿", "sw-KE": "🇰🇪", "sw-TZ": "🇹🇿",
  ta: "🇮🇳", te: "🇮🇳", th: "🇹🇭", tl: "🇵🇭", tr: "🇹🇷",
  uk: "�🇦", ur: "🇵🇰", uz: "🇺🇿",
  vi: "🇻🇳", yo: "🇳🇬",
  zh: "🇨🇳", "zh-CN": "🇨🇳", "zh-HK": "🇭🇰", "zh-Hans": "�🇳", "zh-Hant": "🇹🇼", "zh-SG": "🇸🇬", "zh-TW": "🇹🇼",
};

export function LocaleSelector({ className }: { className?: string }) {
  const { locale, locales, getLocaleProperties } = useLocaleSelector();
  const setGtLocale = useSetLocale();
  const { setLocale: setLocalLocale } = useLocale();

  const handleLocaleChange = (newLocale: string) => {
    setGtLocale(newLocale);
    setLocalLocale(newLocale);
    try {
      fetch("/api/users/me/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language: { locale: newLocale, spellcheck: true } }),
      }).catch(() => {});
    } catch {}
  };

  return (
    <Select value={locale || "en"} onValueChange={handleLocaleChange}>
      <SelectTrigger
        className={cn("w-full h-10", className)}
        aria-label="Language selector"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="popper" className="max-h-[320px] min-w-[16rem]">
        {locales.map((loc) => {
          const flag = LOCALE_FLAGS[loc.split("-")[0]] || "🌐";
          const name = getLocaleProperties(loc)?.nativeNameWithRegionCode || loc;
          const isActive = loc === locale;
          return (
            <SelectItem key={loc} value={loc}>
              <span className="flex items-center gap-2.5">
                <span className="text-base leading-none">{flag}</span>
                <span>{name}</span>
                {isActive && <Check className="ml-auto size-4 text-[var(--text-muted)]" />}
              </span>
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}

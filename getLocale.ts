// Custom server-side locale resolver for gt-next (auto-detected by withGTConfig,
// same convention as loadTranslations).
//
// gt-next's default getLocale returns the defaultLocale unless a middleware injects
// the locale via the x-generaltranslation-locale header. This app switches locale
// purely client-side (LocaleSync + useSetLocale) and has no gt-next middleware, so
// without this the server ALWAYS rendered 'en' — meaning non-English translations
// never actually displayed (the client can't load dictionaries on its own).
//
// gt-react's useSetLocale writes the selected locale to the `generaltranslation.locale`
// cookie and reloads; we read that cookie here so the server renders the chosen
// locale. gt-next validates the returned value against the configured locale list
// (resolveLocaleOrDefault), so an unknown value safely falls back to the default.
import { cookies } from "next/headers";

const LOCALE_COOKIE = "generaltranslation.locale";

export async function getLocale(): Promise<string> {
  try {
    const value = (await cookies()).get(LOCALE_COOKIE)?.value;
    if (value) return value;
  } catch {
    // cookies() throws outside a request scope (e.g. during static prerender) —
    // fall through to the default locale.
  }
  return "en";
}

export default getLocale;

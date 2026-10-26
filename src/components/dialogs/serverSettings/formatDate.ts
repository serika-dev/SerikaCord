/** "Mar 4, 2025" in the viewer's locale, or null for a missing/invalid date. */
export function formatShortDate(value: string | null | undefined, locale: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString(locale, { year: "numeric", month: "short", day: "numeric" }) : null;
}

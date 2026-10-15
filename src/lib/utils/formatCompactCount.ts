/**
 * Short, locale-aware counts for public stats: 1,000 → "1K", 1,500 → "1.5K",
 * 1,000,000 → "1M" (en); "1,5K" (nl), "1.5万" (ja). Rounds down so a stat is
 * never shown higher than it is (1,999 → "1.9K", not "2K").
 */
export function formatCompactCount(n: number, locale?: string): string {
  const options: Intl.NumberFormatOptions = {
    notation: "compact",
    maximumFractionDigits: 1,
    roundingMode: "trunc",
  };
  try {
    return new Intl.NumberFormat(locale, options).format(n);
  } catch {
    // Unknown or malformed locale tag.
    return new Intl.NumberFormat("en", options).format(n);
  }
}

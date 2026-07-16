/** Structured search filters parsed from a raw search bar string. */
export interface ParsedSearchQuery {
  /** Free-text portion (everything that isn't a filter token). */
  text: string;
  /** from:<user> — username/display or id fragment. */
  from?: string;
  /** has:<link|file|image|video|embed> */
  has?: string;
  /** before:<YYYY-MM-DD> */
  before?: string;
  /** after:<YYYY-MM-DD> */
  after?: string;
  /** in:<#channel> — channel name (client resolves to an id). */
  inChannel?: string;
}

const HAS_VALUES = new Set(["link", "file", "image", "video", "embed"]);

/**
 * Parse Discord-style search filters out of a raw query. Recognizes
 * `from:`, `has:`, `before:`, `after:`, and `in:`; everything else is text.
 */
export function parseSearchQuery(raw: string): ParsedSearchQuery {
  const result: ParsedSearchQuery = { text: "" };
  const textParts: string[] = [];

  for (const token of raw.split(/\s+/)) {
    if (!token) continue;
    const m = token.match(/^(from|has|before|after|in):(.*)$/i);
    if (m && m[2]) {
      const key = m[1].toLowerCase();
      const value = m[2].replace(/^[@#]/, ""); // strip leading @ / #
      switch (key) {
        case "from": result.from = value; break;
        case "has": if (HAS_VALUES.has(value.toLowerCase())) result.has = value.toLowerCase(); break;
        case "before": result.before = value; break;
        case "after": result.after = value; break;
        case "in": result.inChannel = value; break;
      }
      continue;
    }
    textParts.push(token);
  }

  result.text = textParts.join(" ");
  return result;
}

/** Whether the parsed query carries at least one active filter. */
export function hasActiveFilters(p: ParsedSearchQuery): boolean {
  return Boolean(p.from || p.has || p.before || p.after || p.inChannel);
}

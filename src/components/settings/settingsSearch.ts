/**
 * Search over a settings sidebar: an item matches when every word of the
 * query appears in its label, its keywords (translated synonyms such as
 * "dark mode" for Appearance) or its section title. Pure, so the user and
 * server settings share it and it is unit tested.
 */

export interface SearchableSettingsItem {
  label: string;
  /** Extra comma/space separated words people may search for. */
  keywords?: string;
}

export interface SearchableSettingsSection<I extends SearchableSettingsItem> {
  title: string;
  items: I[];
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "");
}

export function settingsQueryTerms(query: string): string[] {
  return normalize(query).split(/[\s,]+/).filter(Boolean);
}

export function settingsItemMatches(item: SearchableSettingsItem, sectionTitle: string, query: string): boolean {
  const terms = settingsQueryTerms(query);
  if (terms.length === 0) return true;
  const haystack = normalize(`${item.label} ${item.keywords ?? ""} ${sectionTitle}`);
  return terms.every((term) => haystack.includes(term));
}

/** Sections with only their matching items; empty sections are dropped. */
export function filterSettingsSections<I extends SearchableSettingsItem, S extends SearchableSettingsSection<I>>(
  sections: S[],
  query: string,
): S[] {
  if (settingsQueryTerms(query).length === 0) return sections;
  return sections
    .map((section) => ({ ...section, items: section.items.filter((item) => settingsItemMatches(item, section.title, query)) }))
    .filter((section) => section.items.length > 0);
}

/**
 * Index of the first label containing the whole query (used to scroll to and
 * flash the matching row after a search jumps to a page), or -1.
 */
export function findSettingsRowMatch(labels: string[], query: string): number {
  const needle = normalize(query.trim());
  if (!needle) return -1;
  const exact = labels.findIndex((label) => normalize(label).includes(needle));
  if (exact >= 0) return exact;
  const terms = settingsQueryTerms(query);
  return labels.findIndex((label) => {
    const hay = normalize(label);
    return terms.every((term) => hay.includes(term));
  });
}

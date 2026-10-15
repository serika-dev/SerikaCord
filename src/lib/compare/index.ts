/**
 * Shared, pure helpers for the public comparison pages (/compare/*).
 *
 * Facts about other products were checked on COMPARE_LAST_CHECKED_ISO
 * against the sources listed on each page. When you re-check them, update
 * the date here (it feeds the pages, their JSON-LD and the sitemap).
 */

import type { CompareFaqItem, CompareSource } from "./types";

export * from "./types";

export const COMPARE_LAST_CHECKED_ISO = "2026-10-15";

const SITE = "https://serika.chat";

/** Formats the last-checked date for display in the visitor's locale. */
export function formatCompareDate(locale: string | undefined): string {
  const date = new Date(`${COMPARE_LAST_CHECKED_ISO}T12:00:00Z`);
  try {
    return date.toLocaleDateString(locale || "en", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
  } catch {
    return COMPARE_LAST_CHECKED_ISO;
  }
}

/** schema.org FAQPage for the FAQ actually shown on the page. */
export function faqJsonLd(items: CompareFaqItem[]): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: { "@type": "Answer", text: item.answer },
    })),
  };
}

/** schema.org Article + BreadcrumbList for a comparison page. */
export function compareArticleJsonLd(opts: {
  path: string;
  headline: string;
  description: string;
  breadcrumbName: string;
  inLanguage?: string;
  /** Things the article is about (e.g. the two apps), as schema.org SoftwareApplication names. */
  about?: string[];
}): Record<string, unknown> {
  const url = `${SITE}${opts.path}`;
  const publisher = {
    "@type": "Organization",
    "@id": `${SITE}/#organization`,
    name: "Serika Company",
    url: `${SITE}/`,
    logo: { "@type": "ImageObject", url: `${SITE}/icons/icon-512x512.png` },
  };
  const article: Record<string, unknown> = {
    "@type": "Article",
    "@id": `${url}#article`,
    headline: opts.headline,
    description: opts.description,
    url,
    mainEntityOfPage: url,
    image: `${SITE}/opengraph-image`,
    datePublished: COMPARE_LAST_CHECKED_ISO,
    dateModified: COMPARE_LAST_CHECKED_ISO,
    inLanguage: opts.inLanguage || "en",
    author: publisher,
    publisher,
  };
  if (opts.about && opts.about.length > 0) {
    article.about = opts.about.map((name) => ({ "@type": "SoftwareApplication", name, applicationCategory: "CommunicationApplication" }));
  }
  return {
    "@context": "https://schema.org",
    "@graph": [
      article,
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "SerikaCord", item: `${SITE}/` },
          { "@type": "ListItem", position: 2, name: "Compare", item: `${SITE}/compare` },
          ...(opts.path === "/compare" ? [] : [{ "@type": "ListItem", position: 3, name: opts.breadcrumbName, item: url }]),
        ],
      },
    ],
  };
}

/** schema.org ItemList of the comparison pages, for the /compare index. */
export function compareItemListJsonLd(items: { name: string; path: string }[]): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.name,
      url: `${SITE}${item.path}`,
    })),
  };
}

/**
 * Numbers the sources shown on a page: the competitor's first, then
 * SerikaCord's. Returns the combined list and a lookup from "<scope>:<id>"
 * (scope "app" or "serika") to its 1-based number.
 */
export function numberSources(
  appSources: CompareSource[],
  serikaSources: CompareSource[],
): { list: (CompareSource & { n: number; scope: "app" | "serika" })[]; lookup: Map<string, number> } {
  const list: (CompareSource & { n: number; scope: "app" | "serika" })[] = [];
  const lookup = new Map<string, number>();
  for (const s of appSources) {
    const n = list.length + 1;
    list.push({ ...s, n, scope: "app" });
    lookup.set(`app:${s.id}`, n);
  }
  for (const s of serikaSources) {
    const n = list.length + 1;
    list.push({ ...s, n, scope: "serika" });
    lookup.set(`serika:${s.id}`, n);
  }
  return { list, lookup };
}

/** Resolves a cell's source ids to their numbers on the page, dropping unknown ids. */
export function sourceNumbers(lookup: Map<string, number>, scope: "app" | "serika", ids: string[] | undefined): number[] {
  if (!ids) return [];
  const out: number[] = [];
  for (const id of ids) {
    const n = lookup.get(`${scope}:${id}`);
    if (n !== undefined && !out.includes(n)) out.push(n);
  }
  return out.sort((a, b) => a - b);
}

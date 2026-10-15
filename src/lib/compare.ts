/**
 * Shared data for the public comparison pages (/compare/*).
 *
 * Facts about other products were checked on COMPARE_LAST_CHECKED_ISO
 * against the sources listed on each page. When you re-check them, update
 * the date here (it feeds the pages, their JSON-LD and the sitemap).
 */

export const COMPARE_LAST_CHECKED_ISO = "2026-10-15";

export type CompareStatus = "yes" | "no" | "partial" | "notyet" | "unknown";

export interface CompareSource {
  /** Shown as the link text; usually the page title (not translated). */
  title: string;
  url: string;
  /** Publisher shown after the title, e.g. "Discord" or "The Verge". */
  publisher: string;
}

export interface CompareFaqItem {
  question: string;
  answer: string;
}

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
}): Record<string, unknown> {
  const url = `https://serika.chat${opts.path}`;
  const publisher = {
    "@type": "Organization",
    "@id": "https://serika.chat/#organization",
    name: "Serika Company",
    url: "https://serika.chat/",
    logo: { "@type": "ImageObject", url: "https://serika.chat/icons/icon-512x512.png" },
  };
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Article",
        "@id": `${url}#article`,
        headline: opts.headline,
        description: opts.description,
        url,
        mainEntityOfPage: url,
        image: "https://serika.chat/opengraph-image",
        datePublished: COMPARE_LAST_CHECKED_ISO,
        dateModified: COMPARE_LAST_CHECKED_ISO,
        inLanguage: opts.inLanguage || "en",
        author: publisher,
        publisher,
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "SerikaCord", item: "https://serika.chat/" },
          { "@type": "ListItem", position: 2, name: "Compare", item: "https://serika.chat/compare" },
          ...(opts.path === "/compare"
            ? []
            : [{ "@type": "ListItem", position: 3, name: opts.breadcrumbName, item: url }]),
        ],
      },
    ],
  };
}

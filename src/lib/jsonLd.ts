/**
 * schema.org structured data helpers (pure; rendered by
 * src/components/seo/JsonLd.tsx).
 */

/** JSON for a <script type="application/ld+json">; `<` is escaped so no value can close the tag. */
export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

export const SITE_URL = "https://serika.chat";
export const ORGANIZATION_ID = `${SITE_URL}/#organization`;
export const WEBSITE_ID = `${SITE_URL}/#website`;

/** Organization + WebSite graph for the homepage. */
export const homepageJsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": ORGANIZATION_ID,
      name: "Serika Company",
      url: `${SITE_URL}/`,
      logo: `${SITE_URL}/icons/icon-512x512.png`,
      email: "support@serika.dev",
      sameAs: ["https://github.com/serika-dev"],
    },
    {
      "@type": "WebSite",
      "@id": WEBSITE_ID,
      url: `${SITE_URL}/`,
      name: "SerikaCord",
      description:
        "Free community chat platform with servers, voice and video, end-to-end encrypted DMs and a Discord-compatible bot API.",
      inLanguage: "en",
      publisher: { "@id": ORGANIZATION_ID },
    },
  ],
};

/** The app itself, for the homepage (the download page adds its version). */
export const serikaCordAppJsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "SerikaCord",
  url: `${SITE_URL}/`,
  downloadUrl: `${SITE_URL}/download`,
  applicationCategory: "CommunicationApplication",
  operatingSystem: "Windows, macOS, Linux, Android, Web",
  description:
    "Free chat app for communities and friends: servers, voice and video calls, screen sharing, end-to-end encrypted DMs and a Discord-compatible bot API. Run by Serika Company in the Netherlands.",
  offers: { "@type": "Offer", price: "0", priceCurrency: "EUR" },
  publisher: { "@id": ORGANIZATION_ID },
};

export interface FaqEntry {
  question: string;
  answer: string;
}

/** FAQPage for questions that are visible on the page, in the page's language. */
export function faqPageJsonLd(items: FaqEntry[]) {
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

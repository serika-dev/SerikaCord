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
        "Free community chat platform with servers, text, voice and video, direct messages and a Discord-compatible bot API.",
      inLanguage: "en",
      publisher: { "@id": ORGANIZATION_ID },
    },
  ],
};

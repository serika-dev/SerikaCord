import { serializeJsonLd } from "@/lib/jsonLd";

export { homepageJsonLd, ORGANIZATION_ID, SITE_URL, WEBSITE_ID } from "@/lib/jsonLd";

/** Renders schema.org structured data. Server component. */
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }}
    />
  );
}


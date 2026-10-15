import DownloadClient from "./DownloadClient";
import { getLatestRelease } from "@/lib/downloads";
import { JsonLd, ORGANIZATION_ID, SITE_URL } from "@/components/seo/JsonLd";

// Re-read the latest GitHub release every 10 minutes so new builds show up
// without a deploy.
export const revalidate = 600;

export default async function DownloadPage() {
  const release = await getLatestRelease();
  return (
    <>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "SoftwareApplication",
          name: "SerikaCord",
          url: `${SITE_URL}/`,
          downloadUrl: `${SITE_URL}/download`,
          applicationCategory: "CommunicationApplication",
          operatingSystem: "Windows, macOS, Linux, Android, Web",
          ...(release.version ? { softwareVersion: release.version } : {}),
          description:
            "SerikaCord is a free community chat app with servers, text, voice and video calls, direct messages and a Discord-compatible bot API. Desktop apps for Windows, macOS and Linux, an Android app, and the web app.",
          offers: {
            "@type": "Offer",
            price: "0",
            priceCurrency: "EUR",
          },
          publisher: { "@type": "Organization", "@id": ORGANIZATION_ID, name: "Serika Company", url: `${SITE_URL}/` },
        }}
      />
      <DownloadClient release={release} />
    </>
  );
}

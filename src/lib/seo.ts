import type { Metadata } from "next";

const SITE_NAME = "SerikaCord";
const SITE_URL = "https://serika.cc";
const DEFAULT_DESCRIPTION = "A modern Discord-like chat application";
const DEFAULT_OG_IMAGE = "/opengraph-image.png";

export interface SEOPageOptions {
  title: string;
  description?: string;
  path?: string;
  image?: string;
  noIndex?: boolean;
  keywords?: string[];
  type?: "website" | "article";
}

export function buildMetadata(options: SEOPageOptions): Metadata {
  const description = options.description || DEFAULT_DESCRIPTION;
  const url = options.path ? `${SITE_URL}${options.path}` : SITE_URL;
  const image = options.image || DEFAULT_OG_IMAGE;
  const fullImageUrl = image.startsWith("http") ? image : `${SITE_URL}${image}`;

  const title = options.title.includes(SITE_NAME)
    ? options.title
    : `${options.title} — ${SITE_NAME}`;

  return {
    title,
    description,
    applicationName: SITE_NAME,
    manifest: "/manifest.json",
    icons: {
      icon: "/logo-icon.svg",
      shortcut: "/logo-icon.svg",
      apple: "/icons/icon-192x192.png",
    },
    appleWebApp: {
      capable: true,
      statusBarStyle: "black-translucent",
      title: SITE_NAME,
    },
    keywords: options.keywords || [
      "SerikaCord",
      "Serika",
      "chat",
      "discord alternative",
      "community",
      "messaging",
      "voice chat",
      "servers",
    ],
    authors: [{ name: "Serika Company" }],
    creator: "Serika Company",
    publisher: "Serika Company",
    metadataBase: new URL(SITE_URL),
    alternates: {
      canonical: url,
    },
    openGraph: {
      type: options.type || "website",
      siteName: SITE_NAME,
      title,
      description,
      url,
      images: [
        {
          url: fullImageUrl,
          width: 1200,
          height: 630,
          alt: `${SITE_NAME} — ${options.title}`,
        },
      ],
      locale: "en_US",
    },
    twitter: {
      card: "summary_large_image",
      site: "@SerikaCord",
      creator: "@SerikaCord",
      title,
      description,
      images: [fullImageUrl],
    },
    robots: options.noIndex
      ? { index: false, follow: false }
      : { index: true, follow: true },
  };
}

export function buildRootMetadata(): Metadata {
  return buildMetadata({
    title: SITE_NAME,
    description: DEFAULT_DESCRIPTION,
    path: "/",
    keywords: [
      "SerikaCord",
      "Serika",
      "chat app",
      "Discord alternative",
      "community chat",
      "messaging platform",
      "voice chat",
      "group chat",
      "online communities",
    ],
  });
}

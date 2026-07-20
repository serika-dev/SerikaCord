import type { Metadata } from "next";

const SITE_NAME = "SerikaCord";
const SITE_URL = "https://serika.chat";
const DEFAULT_DESCRIPTION = "SerikaCord is a free, modern community chat platform with voice, video, text, and server discovery. Create or join communities, chat with friends, and build your space online.";
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
      "free chat platform",
      "online communities",
      "group chat",
    ],
    authors: [{ name: "Serika Company", url: SITE_URL }],
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
      : {
          index: true,
          follow: true,
          "max-image-preview": "large",
          "max-snippet": -1,
          "max-video-preview": -1,
        },
    other: {
      "application-name": SITE_NAME,
      "theme-color": "#8B5CF6",
      "msapplication-TileColor": "#8B5CF6",
      "og:site_name": SITE_NAME,
      "og:locale": "en_US",
      "format-detection": "telephone=no",
    },
  };
}

export function buildRootMetadata(): Metadata {
  return buildMetadata({
    title: "SerikaCord — Free Community Chat & Voice Platform",
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
      "free chat platform",
      "server discovery",
      "chat with friends",
      "create server",
      "join community",
    ],
  });
}

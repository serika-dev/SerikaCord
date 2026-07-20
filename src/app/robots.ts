import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: [
          "/",
          "/channels/explore",
        ],
        disallow: [
          "/api/",
          "/channels/me",
          "/channels/me/",
          "/channels/notifications",
          "/channels/notifications/",
          "/channels/profile",
          "/channels/profile/",
          "/channels/settings",
          "/channels/settings/",
          "/dm/",
          "/_next/",
          "/widget/",
        ],
      },
      {
        userAgent: "*",
        allow: "/channels/",
        disallow: [
          "/api/",
          "/dm/",
          "/_next/",
          "/widget/",
        ],
      },
    ],
    sitemap: "https://serika.chat/sitemap.xml",
  };
}

import type { MetadataRoute } from "next";

/**
 * Public, logged-out pages are crawlable; the signed-in app, the API and
 * one-off flows are not. Discover (/channels/explore) and Discovery-listed
 * server pages (/channels/<id>, which set their own robots meta) stay
 * allowed. /_next/ must stay crawlable: search engines need the JS and CSS
 * to render pages. Invite links are not blocked here so link-preview bots
 * can read their Open Graph tags; regular invites send `noindex` instead.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/channels/explore"],
        disallow: [
          "/api/",
          "/channels/me",
          "/channels/messages",
          "/channels/notifications",
          "/channels/profile",
          "/channels/settings",
          "/dm/",
          "/oauth2/",
          "/qr/",
          "/forgetme",
          "/widget/",
          "/widget-editor/",
          "/developers/applications",
          "/developers/teams",
          "/developers/home",
        ],
      },
    ],
    sitemap: "https://serika.chat/sitemap.xml",
    host: "https://serika.chat",
  };
}

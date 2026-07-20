import type { MetadataRoute } from "next";

const BASE_URL = "https://serika.chat";

interface SitemapRoute {
  path: string;
  priority: number;
  changeFrequency?: "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never";
  lastModified?: Date;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();

  const routes: SitemapRoute[] = [
    // Core pages
    { path: "/", priority: 1.0, changeFrequency: "daily", lastModified: now },
    { path: "/download", priority: 0.9, changeFrequency: "weekly", lastModified: now },
    { path: "/channels/explore", priority: 0.9, changeFrequency: "daily", lastModified: now },

    // Auth pages
    { path: "/login", priority: 0.7, changeFrequency: "monthly", lastModified: now },
    { path: "/register", priority: 0.7, changeFrequency: "monthly", lastModified: now },

    // Legal pages
    { path: "/terms", priority: 0.5, changeFrequency: "monthly", lastModified: now },
    { path: "/privacy", priority: 0.5, changeFrequency: "monthly", lastModified: now },
    { path: "/guidelines", priority: 0.5, changeFrequency: "monthly", lastModified: now },

    // Developer portal
    { path: "/developers", priority: 0.8, changeFrequency: "weekly", lastModified: now },
    { path: "/developers/applications", priority: 0.7, changeFrequency: "weekly", lastModified: now },

    // Developer docs — intro & getting started
    { path: "/developers/docs", priority: 0.8, changeFrequency: "weekly", lastModified: now },
    { path: "/developers/docs/intro", priority: 0.7, changeFrequency: "weekly", lastModified: now },
    { path: "/developers/docs/getting-started", priority: 0.7, changeFrequency: "weekly", lastModified: now },
    { path: "/developers/docs/quick-start", priority: 0.7, changeFrequency: "weekly", lastModified: now },
    { path: "/developers/docs/reference", priority: 0.6, changeFrequency: "weekly", lastModified: now },

    // Developer docs — bots
    { path: "/developers/docs/bots/overview", priority: 0.7, changeFrequency: "weekly", lastModified: now },
    { path: "/developers/docs/bots/interactions", priority: 0.6, changeFrequency: "weekly", lastModified: now },
    { path: "/developers/docs/bots/slash-commands", priority: 0.6, changeFrequency: "weekly", lastModified: now },

    // Developer docs — topics
    { path: "/developers/docs/topics/oauth2", priority: 0.6, changeFrequency: "weekly", lastModified: now },
    { path: "/developers/docs/topics/permissions", priority: 0.6, changeFrequency: "weekly", lastModified: now },
    { path: "/developers/docs/topics/gateway", priority: 0.6, changeFrequency: "weekly", lastModified: now },
    { path: "/developers/docs/topics/webhooks", priority: 0.6, changeFrequency: "weekly", lastModified: now },
    { path: "/developers/docs/topics/rate-limits", priority: 0.5, changeFrequency: "monthly", lastModified: now },
    { path: "/developers/docs/topics/threads", priority: 0.5, changeFrequency: "monthly", lastModified: now },
    { path: "/developers/docs/topics/stickers", priority: 0.5, changeFrequency: "monthly", lastModified: now },
    { path: "/developers/docs/topics/reactions", priority: 0.5, changeFrequency: "monthly", lastModified: now },
    { path: "/developers/docs/topics/tts", priority: 0.4, changeFrequency: "monthly", lastModified: now },
    { path: "/developers/docs/topics/message-formatting", priority: 0.5, changeFrequency: "monthly", lastModified: now },
    { path: "/developers/docs/topics/opcodes-and-status-codes", priority: 0.5, changeFrequency: "monthly", lastModified: now },
    { path: "/developers/docs/topics/bot-verification", priority: 0.5, changeFrequency: "monthly", lastModified: now },
    { path: "/developers/docs/topics/teams", priority: 0.4, changeFrequency: "monthly", lastModified: now },
    { path: "/developers/docs/topics/slash-commands", priority: 0.5, changeFrequency: "monthly", lastModified: now },

    // Developer docs — resources
    { path: "/developers/docs/resources/application", priority: 0.5, changeFrequency: "weekly", lastModified: now },
    { path: "/developers/docs/resources/application-role-connection-metadata", priority: 0.4, changeFrequency: "monthly", lastModified: now },
    { path: "/developers/docs/resources/audit-log", priority: 0.4, changeFrequency: "monthly", lastModified: now },
    { path: "/developers/docs/resources/channel", priority: 0.5, changeFrequency: "weekly", lastModified: now },
    { path: "/developers/docs/resources/emoji", priority: 0.4, changeFrequency: "monthly", lastModified: now },
    { path: "/developers/docs/resources/guild", priority: 0.5, changeFrequency: "weekly", lastModified: now },
    { path: "/developers/docs/resources/guild-scheduled-event", priority: 0.4, changeFrequency: "monthly", lastModified: now },
    { path: "/developers/docs/resources/invite", priority: 0.4, changeFrequency: "monthly", lastModified: now },
    { path: "/developers/docs/resources/message", priority: 0.5, changeFrequency: "weekly", lastModified: now },
    { path: "/developers/docs/resources/reaction", priority: 0.4, changeFrequency: "monthly", lastModified: now },
    { path: "/developers/docs/resources/sticker", priority: 0.4, changeFrequency: "monthly", lastModified: now },
    { path: "/developers/docs/resources/user", priority: 0.5, changeFrequency: "weekly", lastModified: now },
    { path: "/developers/docs/resources/voice", priority: 0.4, changeFrequency: "monthly", lastModified: now },
    { path: "/developers/docs/resources/webhook", priority: 0.5, changeFrequency: "weekly", lastModified: now },

    // Developer docs — social SDK
    { path: "/developers/docs/social-sdk/overview", priority: 0.5, changeFrequency: "weekly", lastModified: now },
    { path: "/developers/docs/social-sdk/api-reference", priority: 0.5, changeFrequency: "weekly", lastModified: now },
    { path: "/developers/docs/social-sdk/external-auth", priority: 0.4, changeFrequency: "monthly", lastModified: now },
    { path: "/developers/docs/social-sdk/relationships", priority: 0.4, changeFrequency: "monthly", lastModified: now },
    { path: "/developers/docs/social-sdk/widgets", priority: 0.4, changeFrequency: "monthly", lastModified: now },
  ];

  const staticEntries: MetadataRoute.Sitemap = routes.map((route) => ({
    url: `${BASE_URL}${route.path}`,
    lastModified: route.lastModified || now,
    changeFrequency: route.changeFrequency || "weekly",
    priority: route.priority,
  }));

  // Dynamically add discoverable server pages
  const serverEntries: MetadataRoute.Sitemap = [];
  try {
    const { db, schema } = await import("@/lib/db/postgres");
    const { eq } = await import("drizzle-orm");
    const servers = await db
      .select({
        id: schema.servers.id,
        name: schema.servers.name,
        discoverableAt: schema.servers.discoverableAt,
        updatedAt: schema.servers.updatedAt,
      })
      .from(schema.servers)
      .where(eq(schema.servers.isDiscoverable, true))
      .limit(500);

    for (const s of servers) {
      serverEntries.push({
        url: `${BASE_URL}/channels/${s.id}`,
        lastModified: s.updatedAt ? new Date(s.updatedAt) : (s.discoverableAt ? new Date(s.discoverableAt) : now),
        changeFrequency: "daily",
        priority: 0.7,
      });
    }
  } catch {
    // If DB fails, just return static entries
  }

  return [...staticEntries, ...serverEntries];
}

/** Canonical bot API endpoints, referenced across the docs. */
export const API = {
  /** REST base, versioned like Discord. */
  rest: "https://api.serika.chat/api/v10",
  /** Bare REST host (no version). */
  host: "https://api.serika.chat/api",
  /** Gateway WebSocket URL. */
  gateway: "wss://api.serika.chat/api/v10/gateway",
  /** OAuth2 authorize endpoint. */
  authorize: "https://api.serika.chat/api/oauth2/authorize",
} as const;

export interface DocNavItem {
  label: string;
  slug: string;
  badge?: string;
}

export interface DocNavSection {
  title: string;
  items: DocNavItem[];
}

export const docNav: DocNavSection[] = [
  {
    title: "Getting Started",
    items: [
      { label: "Introduction", slug: "intro" },
      { label: "Getting Started", slug: "getting-started" },
      { label: "Quick Start", slug: "quick-start" },
      { label: "Reference", slug: "reference" },
    ],
  },
  {
    title: "Bots",
    items: [
      { label: "Overview", slug: "bots/overview" },
      { label: "Slash Commands", slug: "bots/slash-commands" },
      { label: "Interactions", slug: "bots/interactions" },
    ],
  },
  {
    title: "Social SDK",
    items: [
      { label: "Overview", slug: "social-sdk/overview" },
      { label: "External Auth", slug: "social-sdk/external-auth" },
      { label: "Relationships & Presence", slug: "social-sdk/relationships" },
      { label: "Widgets", slug: "social-sdk/widgets" },
      { label: "API Reference", slug: "social-sdk/api-reference" },
    ],
  },
  {
    title: "Topics",
    items: [
      { label: "OAuth2", slug: "topics/oauth2" },
      { label: "Opcodes & Status Codes", slug: "topics/opcodes-and-status-codes" },
      { label: "Permissions", slug: "topics/permissions" },
      { label: "Rate Limits", slug: "topics/rate-limits" },
      { label: "Threads", slug: "topics/threads" },
      { label: "Gateway", slug: "topics/gateway" },
      { label: "Webhooks", slug: "topics/webhooks" },
      { label: "Message Formatting", slug: "topics/message-formatting" },
      { label: "Slash Commands", slug: "topics/slash-commands" },
      { label: "Text-to-Speech (TTS)", slug: "topics/tts" },
      { label: "Reactions", slug: "topics/reactions" },
      { label: "Stickers", slug: "topics/stickers" },
      { label: "Teams", slug: "topics/teams" },
      { label: "Bot Verification", slug: "topics/bot-verification" },
    ],
  },
  {
    title: "Resources",
    items: [
      { label: "Application Role Connection Metadata", slug: "resources/application-role-connection-metadata" },
      { label: "Application", slug: "resources/application" },
      { label: "Audit Log", slug: "resources/audit-log" },
      { label: "Channel", slug: "resources/channel" },
      { label: "Emoji", slug: "resources/emoji" },
      { label: "Guild", slug: "resources/guild" },
      { label: "Guild Scheduled Event", slug: "resources/guild-scheduled-event" },
      { label: "Invite", slug: "resources/invite" },
      { label: "Message", slug: "resources/message" },
      { label: "Reaction", slug: "resources/reaction" },
      { label: "Sticker", slug: "resources/sticker" },
      { label: "User", slug: "resources/user" },
      { label: "Voice", slug: "resources/voice" },
      { label: "Webhook", slug: "resources/webhook" },
    ],
  },
];

export function findDocBySlug(slug: string): DocNavItem | null {
  for (const section of docNav) {
    for (const item of section.items) {
      if (item.slug === slug) return item;
    }
  }
  return null;
}

export function getAllDocSlugs(): string[] {
  return docNav.flatMap((section) => section.items.map((item) => item.slug));
}

export function getPrevNext(slug: string): { prev: DocNavItem | null; next: DocNavItem | null } {
  const all = docNav.flatMap((s) => s.items);
  const idx = all.findIndex((item) => item.slug === slug);
  return {
    prev: idx > 0 ? all[idx - 1] : null,
    next: idx < all.length - 1 ? all[idx + 1] : null,
  };
}

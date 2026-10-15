/**
 * Registry of the apps compared on /compare. Pure (no gt-next): used by the
 * pages, the sitemap and the tests. Names are proper nouns and stay
 * untranslated; SEO titles and descriptions are English, like the rest of
 * the site's metadata.
 */

import { APP_IDS, type AppId, type AppKind, type AppMeta } from "./types";

const META: Record<AppId, Omit<AppMeta, "id">> = {
  discord: {
    name: "Discord",
    short: "Discord",
    kind: "community",
    website: "https://discord.com",
    status: "active",
    seoTitle: "SerikaCord vs Discord: an honest comparison",
    seoDescription:
      "SerikaCord and Discord compared on encryption, privacy, age checks, ads, voice, bots, apps and scale. Where Discord is better, where SerikaCord is better, with dated sources.",
    keywords: ["SerikaCord vs Discord", "Discord alternative", "Discord alternative EU", "Discord alternative without ads", "Discord age verification alternative", "Discord compatible bots"],
    hue: 235,
  },
  stoat: {
    name: "Stoat",
    short: "Stoat",
    kind: "community",
    website: "https://stoat.chat",
    status: "active",
    seoTitle: "SerikaCord vs Stoat (formerly Revolt): an honest comparison",
    seoDescription:
      "SerikaCord and Stoat, formerly Revolt, compared: open source and self-hosting, encryption, Discord bots, apps, voice and video, with dated sources.",
    keywords: ["SerikaCord vs Stoat", "SerikaCord vs Revolt", "Stoat chat", "Revolt chat alternative", "open source Discord alternative"],
    hue: 18,
  },
  fluxer: {
    name: "Fluxer",
    short: "Fluxer",
    kind: "community",
    website: "https://fluxer.app",
    status: "active",
    seoTitle: "SerikaCord vs Fluxer: an honest comparison",
    seoDescription:
      "SerikaCord and Fluxer compared: open source and self-hosting, encryption plans, where your data is hosted, bots, apps and voice, with dated sources.",
    keywords: ["SerikaCord vs Fluxer", "Fluxer chat", "Fluxer alternative", "open source Discord alternative", "self-hosted Discord alternative"],
    hue: 265,
  },
  root: {
    name: "Root",
    short: "Root",
    kind: "community",
    website: "https://www.rootapp.com",
    status: "beta",
    seoTitle: "SerikaCord vs Root (rootapp.com): an honest comparison",
    seoDescription:
      "SerikaCord and Root compared: in-chat apps, privacy policy history, encryption, Discord import, bots and platforms, with dated sources.",
    keywords: ["SerikaCord vs Root", "Root app", "rootapp", "Root chat Discord alternative"],
    hue: 150,
  },
  nerimity: {
    name: "Nerimity",
    short: "Nerimity",
    kind: "community",
    website: "https://nerimity.com",
    status: "active",
    seoTitle: "SerikaCord vs Nerimity: an honest comparison",
    seoDescription:
      "SerikaCord and Nerimity compared: open source, encryption, voice, bots, mobile apps and who runs each service, with dated sources.",
    keywords: ["SerikaCord vs Nerimity", "Nerimity chat", "Nerimity alternative", "open source Discord alternative"],
    hue: 330,
  },
  osmium: {
    name: "Osmium",
    short: "Osmium",
    kind: "community",
    website: "https://osmium.chat",
    status: "beta",
    seoTitle: "SerikaCord vs Osmium: an honest comparison",
    seoDescription:
      "SerikaCord and Osmium compared: encryption claims, moderation, bots and API, apps, jurisdiction and maturity, with dated sources.",
    keywords: ["SerikaCord vs Osmium", "Osmium chat", "osmium.chat", "Discord alternative"],
    hue: 200,
  },
  valour: {
    name: "Valour",
    short: "Valour",
    kind: "community",
    website: "https://valour.gg",
    status: "beta",
    seoTitle: "SerikaCord vs Valour: an honest comparison",
    seoDescription:
      "SerikaCord and Valour compared: encrypted community channels, open source and self-hosting, bots, Discord migration and apps, with dated sources.",
    keywords: ["SerikaCord vs Valour", "Valour chat", "valour.gg", "encrypted Discord alternative"],
    hue: 45,
  },
  spacebar: {
    name: "Spacebar",
    short: "Spacebar",
    kind: "community",
    website: "https://spacebar.chat",
    status: "beta",
    seoTitle: "SerikaCord vs Spacebar (formerly Fosscord): an honest comparison",
    seoDescription:
      "SerikaCord and Spacebar compared: Discord API compatibility, self-hosting, voice, apps and maturity, with dated sources.",
    keywords: ["SerikaCord vs Spacebar", "Spacebar chat", "Fosscord", "self-hosted Discord API", "Discord compatible server"],
    hue: 280,
  },
  kloak: {
    name: "Kloak",
    short: "Kloak",
    kind: "community",
    website: "https://kloak.app",
    status: "shutdown",
    seoTitle: "SerikaCord vs Kloak (shut down): what happened and where to go",
    seoDescription:
      "Kloak, a Discord alternative launched in 2026, shut down in October 2026. What it offered, what it didn't, and how SerikaCord compares, with dated sources.",
    keywords: ["Kloak shut down", "Kloak alternative", "kloak.app", "SerikaCord vs Kloak"],
    hue: 0,
  },
  signal: {
    name: "Signal",
    short: "Signal",
    kind: "messenger",
    website: "https://signal.org",
    status: "active",
    seoTitle: "SerikaCord vs Signal: an honest comparison",
    seoDescription:
      "SerikaCord and Signal compared: encryption maturity, metadata, phone numbers, communities, voice, bots and apps. Where Signal is clearly better, with dated sources.",
    keywords: ["SerikaCord vs Signal", "Signal alternative for communities", "Signal vs Discord", "private messenger comparison"],
    hue: 215,
  },
  telegram: {
    name: "Telegram",
    short: "Telegram",
    kind: "messenger",
    website: "https://telegram.org",
    status: "active",
    seoTitle: "SerikaCord vs Telegram: an honest comparison",
    seoDescription:
      "SerikaCord and Telegram compared: default encryption, data handed to authorities, phone numbers, communities, bots, scale and apps, with dated sources.",
    keywords: ["SerikaCord vs Telegram", "Telegram alternative", "is Telegram end-to-end encrypted", "Telegram vs Discord"],
    hue: 198,
  },
  simplex: {
    name: "SimpleX Chat",
    short: "SimpleX",
    kind: "messenger",
    website: "https://simplex.chat",
    status: "active",
    seoTitle: "SerikaCord vs SimpleX Chat: an honest comparison",
    seoDescription:
      "SerikaCord and SimpleX Chat compared: metadata privacy, encryption, audits, groups, calls and communities. Where SimpleX is clearly better, with dated sources.",
    keywords: ["SerikaCord vs SimpleX", "SimpleX Chat", "SimpleX alternative", "private messenger without phone number"],
    hue: 190,
  },
  session: {
    name: "Session",
    short: "Session",
    kind: "messenger",
    website: "https://getsession.org",
    status: "active",
    seoTitle: "SerikaCord vs Session: an honest comparison",
    seoDescription:
      "SerikaCord and Session compared: anonymity, onion routing, forward secrecy, communities, calls and the project's funding, with dated sources.",
    keywords: ["SerikaCord vs Session", "Session messenger", "Session alternative", "anonymous messenger"],
    hue: 160,
  },
  jami: {
    name: "Jami",
    short: "Jami",
    kind: "messenger",
    website: "https://jami.net",
    status: "active",
    seoTitle: "SerikaCord vs Jami: an honest comparison",
    seoDescription:
      "SerikaCord and Jami compared: peer-to-peer encryption, reliability, group calls, communities and apps, with dated sources.",
    keywords: ["SerikaCord vs Jami", "Jami messenger", "GNU Jami", "peer-to-peer messenger"],
    hue: 120,
  },
  teamspeak: {
    name: "TeamSpeak",
    short: "TeamSpeak",
    kind: "voice",
    website: "https://teamspeak.com",
    status: "active",
    seoTitle: "SerikaCord vs TeamSpeak: an honest comparison",
    seoDescription:
      "SerikaCord and TeamSpeak compared: voice quality, self-hosting, text channels, pricing per slot, apps and encryption, with dated sources.",
    keywords: ["SerikaCord vs TeamSpeak", "TeamSpeak alternative", "TeamSpeak 6", "TeamSpeak vs Discord"],
    hue: 210,
  },
  mumble: {
    name: "Mumble",
    short: "Mumble",
    kind: "voice",
    website: "https://www.mumble.info",
    status: "active",
    seoTitle: "SerikaCord vs Mumble: an honest comparison",
    seoDescription:
      "SerikaCord and Mumble compared: low-latency voice, self-hosting, text and video, mobile apps and encryption, with dated sources.",
    keywords: ["SerikaCord vs Mumble", "Mumble alternative", "Mumble voice chat", "self-hosted voice chat"],
    hue: 30,
  },
  gamevox: {
    name: "GameVox",
    short: "GameVox",
    kind: "voice",
    website: "https://gamevox.com",
    status: "beta",
    seoTitle: "SerikaCord vs GameVox: an honest comparison",
    seoDescription:
      "SerikaCord and GameVox compared: voice, pricing per server, Discord import and bots, encryption claims and privacy, with dated sources.",
    keywords: ["SerikaCord vs GameVox", "GameVox", "GameVox alternative", "Ventrilo successor"],
    hue: 95,
  },
  discourse: {
    name: "Discourse",
    short: "Discourse",
    kind: "team",
    website: "https://www.discourse.org",
    status: "active",
    seoTitle: "SerikaCord vs Discourse: an honest comparison",
    seoDescription:
      "SerikaCord and Discourse compared: real-time chat versus long-form forums, moderation, self-hosting, voice and pricing, with dated sources.",
    keywords: ["SerikaCord vs Discourse", "Discourse forum", "Discourse vs Discord", "community forum software"],
    hue: 55,
  },
  rocketchat: {
    name: "Rocket.Chat",
    short: "Rocket.Chat",
    kind: "team",
    website: "https://www.rocket.chat",
    status: "active",
    seoTitle: "SerikaCord vs Rocket.Chat: an honest comparison",
    seoDescription:
      "SerikaCord and Rocket.Chat compared: self-hosted team chat versus community chat, encryption, federation, licensing and security record, with dated sources.",
    keywords: ["SerikaCord vs Rocket.Chat", "Rocket.Chat alternative", "self-hosted team chat", "Rocket.Chat vs Discord"],
    hue: 350,
  },
  matrix: {
    name: "Matrix + Element",
    short: "Matrix",
    kind: "protocol",
    website: "https://matrix.org",
    status: "active",
    seoTitle: "SerikaCord vs Matrix and Element: an honest comparison",
    seoDescription:
      "SerikaCord compared with Matrix and Element: federation, self-hosting, encryption, voice channels, roles and apps. Where Matrix is clearly better, with dated sources.",
    keywords: ["SerikaCord vs Matrix", "SerikaCord vs Element", "Matrix Discord alternative", "Element vs Discord", "federated chat"],
    hue: 170,
  },
  "xmpp-movim": {
    name: "XMPP + Movim",
    short: "XMPP",
    kind: "protocol",
    website: "https://movim.eu",
    status: "active",
    seoTitle: "SerikaCord vs XMPP and Movim: an honest comparison",
    seoDescription:
      "SerikaCord compared with XMPP and the Movim client: open standards, federation, self-hosting, encryption, Spaces and apps, with dated sources.",
    keywords: ["SerikaCord vs XMPP", "Movim", "XMPP Discord alternative", "Jabber chat", "federated chat"],
    hue: 140,
  },
  sable: {
    name: "Sable",
    short: "Sable",
    kind: "protocol",
    website: "https://app.sable.moe",
    status: "beta",
    seoTitle: "SerikaCord vs Sable (Matrix client): an honest comparison",
    seoDescription:
      "SerikaCord compared with Sable, a Discord-style Matrix client: federation, encryption, apps, moderation and maturity, with dated sources.",
    keywords: ["SerikaCord vs Sable", "Sable Matrix client", "sable.moe", "Discord-like Matrix client"],
    hue: 300,
  },
  commet: {
    name: "Commet",
    short: "Commet",
    kind: "protocol",
    website: "https://commet.chat",
    status: "beta",
    seoTitle: "SerikaCord vs Commet (Matrix client): an honest comparison",
    seoDescription:
      "SerikaCord compared with Commet, a Discord-style Matrix client: voice rooms, encryption, apps, moderation and maturity, with dated sources.",
    keywords: ["SerikaCord vs Commet", "Commet Matrix client", "commet.chat", "Discord-like Matrix client"],
    hue: 250,
  },
};

export const APPS: AppMeta[] = APP_IDS.map((id) => ({ id, ...META[id] }));

export function isAppId(value: string): value is AppId {
  return (APP_IDS as readonly string[]).includes(value);
}

export function getAppMeta(id: AppId): AppMeta {
  return { id, ...META[id] };
}

export function appsByKind(kind: AppKind): AppMeta[] {
  return APPS.filter((a) => a.kind === kind);
}

export function comparePath(id: AppId): string {
  return `/compare/${id}`;
}

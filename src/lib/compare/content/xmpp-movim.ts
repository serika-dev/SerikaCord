import { getGT } from "gt-next/server";
import type { AppContent, CompareSource } from "../types";

/**
 * SerikaCord vs XMPP with the Movim client. Facts checked on
 * COMPARE_LAST_CHECKED_ISO against the sources below (titles and publishers
 * are proper names, not translated). Many XMPP facts depend on the server
 * and client; cells say so.
 */

export const sources: CompareSource[] = [
  { id: "movim-home", title: "Movim homepage", url: "https://movim.eu/", publisher: "Movim", kind: "primary" },
  { id: "movim-github", title: "Movim source code (AGPL-3.0)", url: "https://github.com/movim/movim", publisher: "GitHub", kind: "primary" },
  { id: "movim-changelog", title: "Movim changelog (0.31 to 0.35.2)", url: "https://github.com/movim/movim/blob/master/CHANGELOG.md", publisher: "GitHub", kind: "primary" },
  {
    id: "movim-033",
    title: "Movim 0.33 Halley release (Spaces)",
    url: "https://mov.im/community/pubsub.movim.eu/Movim/a1f5a954-e80c-45bd-911b-62e1bf98f8da",
    publisher: "Movim",
    kind: "primary",
    date: "2026-04-24",
  },
  {
    id: "movim-035",
    title: "Movim 0.35 Thiele release (group calls server)",
    url: "https://mov.im/community/pubsub.movim.eu/Movim/456123c0-78eb-4353-9560-79aba7eb4681",
    publisher: "Movim",
    kind: "primary",
    date: "2026-09-09",
  },
  {
    id: "movim-032",
    title: "Here comes Movim 0.32, codename Wilk",
    url: "https://mov.im/community/pubsub.movim.eu/Movim/here-comes-movim-0-32-codename-wilk-CBbSYh",
    publisher: "Movim",
    kind: "primary",
    date: "2025-11-16",
  },
  { id: "join", title: "Public Movim instances", url: "https://join.movim.eu/", publisher: "Movim", kind: "primary" },
  { id: "legal", title: "Movim services terms and privacy", url: "https://join.movim.eu/legals", publisher: "Movim", kind: "primary", date: "2021-12-30" },
  { id: "xmpp-home", title: "xmpp.org homepage", url: "https://xmpp.org/", publisher: "XMPP Standards Foundation", kind: "primary" },
  { id: "xsf", title: "About the XMPP Standards Foundation", url: "https://xmpp.org/about/xmpp-standards-foundation/", publisher: "XMPP Standards Foundation", kind: "primary" },
  { id: "slidge", title: "Slidge XMPP gateways (including Slidcord for Discord)", url: "https://slidge.im/", publisher: "Slidge", kind: "primary" },
  { id: "conversations", title: "Conversations, an XMPP client for Android", url: "https://conversations.im/", publisher: "Conversations", kind: "primary" },
  { id: "jabberru", title: "Encrypted traffic interception targeting jabber.ru", url: "https://notes.valdikss.org.ru/jabber.ru-mitm/", publisher: "ValdikSS", kind: "secondary", date: "2023" },
  { id: "wiki-xmpp", title: "XMPP", url: "https://en.wikipedia.org/wiki/XMPP", publisher: "Wikipedia", kind: "secondary" },
  { id: "wiki-movim", title: "Movim", url: "https://en.wikipedia.org/wiki/Movim", publisher: "Wikipedia", kind: "secondary" },
];

export async function content(): Promise<AppContent> {
  const gt = await getGT();
  return {
    take: gt("XMPP is an open chat standard in use since 1999, and Movim is a free, self-hostable web app for it that added Discord-style Spaces in 2026. Encryption is optional, and Movim's user base is tiny."),
    intro: [
      gt("XMPP (also called Jabber) is an open, federated chat standard: like email, anyone can run a server, and people on different servers can talk to each other. Movim is one app for it, a web app that runs in the browser and combines chats, chatrooms, blogs, video calls and, since April 2026, Discord-style Spaces. SerikaCord is a single service run by one team instead."),
      gt("XMPP and Movim win on openness: an open standard, federation, AGPL code you can host anywhere and no company in control. SerikaCord wins on the community experience: roles, onboarding, moderation tools, voice channels, native desktop and Android apps, Discord-compatible bots, and encryption that is on by default for private chats."),
    ],
    verdict: gt("If you value an open, federated standard and want to host your own server, XMPP with Movim is a principled choice. If you want a Discord-style community app that works out of the box, SerikaCord is the easier pick."),
    facts: {
      operator: {
        value: gt("No single operator"),
        note: gt("XMPP is maintained by the XMPP Standards Foundation, a nonprofit, and run on thousands of independent servers. Movim is a community project led by Timothée Jaussoin, who also runs the mov.im server."),
        src: ["xsf", "wiki-movim", "legal"],
      },
      jurisdiction: {
        value: gt("France (Movim)"),
        note: gt("The Movim project is French. The mov.im server is hosted in Germany with backups in France, so the GDPR applies. Other XMPP servers are wherever their owners run them."),
        src: ["legal"],
      },
      businessModel: {
        value: gt("Donations and grants"),
        note: gt("Movim lives on donations, sponsors and grants from NLnet; its 2026 funding drive had raised about 2,300 EUR. The XMPP Standards Foundation is funded by corporate sponsors."),
        src: ["movim-home", "movim-035", "xsf"],
      },
      ads: {
        status: "no",
        value: gt("No ads"),
        note: gt("We found no ads or trackers on Movim or mov.im."),
        src: ["movim-home", "legal"],
      },
      pricing: {
        value: gt("Free"),
        note: gt("Movim and mov.im are free, and any XMPP account works with them. Some other XMPP providers and apps charge."),
        src: ["movim-home", "conversations"],
      },
      maturity: {
        status: "partial",
        value: gt("XMPP: 1999; Movim: pre-1.0"),
        note: gt("XMPP has been in use since 1999 and an IETF standard since 2004. Movim started in 2010 and is still at version 0.35, released in September 2026."),
        src: ["wiki-xmpp", "wiki-movim", "movim-changelog"],
      },
      e2eeDms: {
        status: "partial",
        value: gt("Optional (OMEMO)"),
        note: gt("Movim supports OMEMO end-to-end encryption for chats, but it is not on by default, and support differs between XMPP apps."),
        src: ["movim-home"],
      },
      e2eeGroups: {
        status: "partial",
        value: gt("Private rooms, optional"),
        note: gt("OMEMO works in private chatrooms. Public chatrooms are not end-to-end encrypted."),
        src: ["movim-home"],
      },
      e2eeCalls: {
        status: "partial",
        value: gt("One-to-one only"),
        note: gt("One-to-one calls are encrypted directly between the two devices. Group calls through Movim's Galène server are not end-to-end encrypted; Movim lists that as possible future work."),
        src: ["movim-035"],
      },
      e2eeCommunity: {
        status: "no",
        note: gt("Spaces, public chatrooms and Communities can be read by the server."),
        src: ["movim-home"],
      },
      e2eeDefault: {
        status: "no",
        value: gt("Off by default"),
        note: gt("You turn on OMEMO yourself, chat by chat."),
        src: ["movim-home"],
      },
      audit: {
        status: "unknown",
        note: gt("We found no security audit of Movim. OMEMO was reportedly audited in 2016, which we couldn't re-check."),
      },
      metadata: {
        value: gt("Your server sees a lot"),
        note: gt("mov.im stores your profile, contacts, posts, files and any messages not encrypted with OMEMO, and keeps server logs with IP addresses for 14 days. Every XMPP server sees similar data for its users."),
        src: ["legal"],
      },
      dataUse: {
        status: "yes",
        value: gt("No selling, no trackers found"),
        note: gt("mov.im's terms describe no advertising or data selling. They say data may be handed to authorities if legally required."),
        src: ["legal"],
      },
      phone: {
        status: "no",
        value: gt("Not required"),
        src: ["legal"],
      },
      email: {
        status: "unknown",
        note: gt("XMPP accounts generally don't need an email address. mov.im's terms list email among stored data, but we couldn't confirm whether sign-up requires it."),
        src: ["legal"],
      },
      ageChecks: {
        status: "no",
        value: gt("None"),
        note: gt("No age checks found, and mov.im's terms don't state a minimum age."),
        src: ["legal"],
      },
      servers: {
        status: "partial",
        value: gt("Spaces, since 2026"),
        note: gt("Movim 0.33 (April 2026) added Spaces that group chatrooms Discord-style. They need a server that supports them; at launch only ejabberd did."),
        src: ["movim-033"],
      },
      roles: {
        status: "partial",
        value: gt("Chatroom ranks"),
        note: gt("Standard XMPP ranks (owner, admin, moderator, member, visitor) plus display badges since April 2026. No Discord-style permission system."),
        src: ["movim-033"],
      },
      threadsForums: {
        status: "partial",
        note: gt("No chat threads yet. Communities and blogs with articles and comments work somewhat like forums."),
        src: ["movim-home", "movim-032"],
      },
      onboarding: {
        status: "no",
        note: gt("No onboarding questions or rules screening; new users pick a server from the public instance list."),
        src: ["join"],
      },
      modTools: {
        status: "partial",
        note: gt("Standard chatroom moderation: kick, ban, muting, ranks, message retraction and blocking. We found no AutoMod-style filters."),
        src: ["movim-changelog"],
      },
      platformSafety: {
        status: "partial",
        value: gt("Up to each server"),
        note: gt("Each server's admin handles abuse. mov.im is run by one person and publishes no transparency report."),
        src: ["legal"],
      },
      voiceChannels: {
        status: "partial",
        note: gt("Spaces can include audio rooms, and persistent video rooms were a stated goal for 2026."),
        src: ["movim-home", "movim-032"],
      },
      videoScreen: {
        status: "yes",
        note: gt("One-to-one and group video calls with screen sharing. Since Movim 0.35 (September 2026) larger group calls run through a Galène server."),
        src: ["movim-035", "movim-changelog"],
      },
      streamingStage: {
        status: "no",
        src: ["movim-home"],
      },
      botApi: {
        status: "partial",
        note: gt("General XMPP bot libraries work, but Movim has no bot platform of its own."),
        src: ["xmpp-home"],
      },
      discordBots: {
        status: "no",
        value: gt("Different protocol"),
        note: gt("Discord bots would have to be rewritten for XMPP."),
      },
      discordMigration: {
        status: "partial",
        value: gt("Third-party gateway"),
        note: gt("Slidcord, part of the Slidge project, connects your own Discord account to XMPP. We couldn't verify how stable it is, and there is no server importer."),
        src: ["slidge"],
      },
      desktop: {
        status: "partial",
        value: gt("Installable web app"),
        note: gt("Movim runs in the browser and can be installed as an app (a PWA). Native XMPP apps such as Gajim and Dino work with the same account, with different features."),
        src: ["movim-home", "wiki-xmpp"],
      },
      mobile: {
        status: "partial",
        value: gt("Installable web app"),
        note: gt("Movim has no native mobile app. Native XMPP apps such as Conversations on Android work with the same account, but without Movim's Spaces and blogs."),
        src: ["movim-home", "conversations"],
      },
      web: {
        status: "yes",
        note: gt("Movim is built for the browser first."),
        src: ["movim-home"],
      },
      license: {
        status: "yes",
        value: gt("AGPL-3.0"),
        note: gt("Movim is AGPL-3.0. XMPP is an open IETF standard with many open-source servers and apps."),
        src: ["movim-github", "wiki-xmpp"],
      },
      selfHost: {
        status: "yes",
        note: gt("Movim is a PHP web app you can run in front of any XMPP server. Spaces need ejabberd for now, and group video needs a Galène server."),
        src: ["movim-github", "movim-033", "movim-035"],
      },
      federation: {
        status: "yes",
        note: gt("Any XMPP server can talk to any other, and addresses look like email (name@server). Movim users can chat with people on Conversations, Gajim, Dino or Monal."),
        src: ["xmpp-home", "movim-home"],
      },
      uploads: {
        status: "unknown",
        value: gt("Set per server"),
        note: gt("Each XMPP server sets its own upload limit; we couldn't verify mov.im's."),
      },
      groupSize: {
        status: "unknown",
        note: gt("We couldn't verify chatroom size limits; they depend on the server."),
      },
      scale: {
        value: gt("Movim: tiny"),
        note: gt("xmpp.org says millions use XMPP software daily but gives no number. In October 2026 Movim's instance list showed mov.im at 68 of 500 and about ten other public servers at 0 to 18 each; it's unclear whether those are sessions or accounts."),
        src: ["xmpp-home", "join"],
      },
      incidents: {
        value: gt("jabber.ru interception (2023)"),
        note: gt("In 2023 researchers found that traffic to jabber.ru, a large Russian XMPP service, had been intercepted for at least 90 days with certificates obtained behind the owner's back, likely lawful interception; it showed server-to-user encryption alone isn't enough. Movim 0.34.1 (June 2026) fixed cross-site scripting and server-side request forgery bugs."),
        src: ["jabberru", "movim-changelog"],
      },
    },
    whyUs: [
      {
        title: gt("Encryption on by default for private chats"),
        text: gt("On SerikaCord, DMs, group DMs and their calls are end-to-end encrypted by default for new conversations. In Movim, OMEMO encryption is optional, support differs between XMPP apps, and group calls aren't end-to-end encrypted. Our encryption is new (October 2026) and not audited, and it doesn't cover server channels either."),
        src: ["movim-home", "movim-035"],
      },
      {
        title: gt("A full Discord-style community toolkit"),
        text: gt("SerikaCord has named roles with per-channel permissions, onboarding questions, rules screening, AutoMod, an audit log, threads and forum channels. Movim's Spaces arrived in April 2026, need an ejabberd server, and use basic chatroom ranks."),
        src: ["movim-033"],
      },
      {
        title: gt("Native desktop and Android apps"),
        text: gt("SerikaCord has apps for Windows, macOS, Linux and Android plus the web app. Movim is a web app only, which you can install from the browser. On iPhone, SerikaCord is also web-only for now."),
        src: ["movim-home"],
      },
      {
        title: gt("Discord bots and a Discord bridge"),
        text: gt("Many Discord bots work on SerikaCord after changing the API address, and our consent-based bridge mirrors a Discord server. On XMPP, bots have to be rewritten, and the Slidcord gateway connects only your own Discord account."),
        src: ["slidge"],
      },
      {
        title: gt("More than one person behind it"),
        text: gt("Movim is maintained mostly by one person alongside a day job, with about 2,300 EUR raised in 2026. SerikaCord is a small team too, so this edge is modest."),
        src: ["movim-home"],
      },
    ],
    whyThem: [
      {
        title: gt("An open standard since 1999"),
        text: gt("XMPP is an IETF standard with thousands of independent servers. No company can shut it down or change the rules for everyone. SerikaCord is one central service run by one company."),
        src: ["wiki-xmpp", "xsf"],
      },
      {
        title: gt("Federation and your choice of app"),
        text: gt("Federation means you can sign up on any server, or your own, and still talk to everyone else. The same account works in Movim, Conversations, Gajim, Dino and other apps. Self-hosted SerikaCord instances don't connect to serika.chat."),
        src: ["xmpp-home", "movim-home"],
      },
      {
        title: gt("Real open source you can host for anyone"),
        text: gt("Movim is AGPL-3.0, so you can run it for any group, including at work, as long as you share your changes. SerikaCord is source-available, not open source, and self-hosting is allowed only for personal, non-commercial use."),
        src: ["movim-github"],
      },
      {
        title: gt("Bridges to other networks"),
        text: gt("Slidge gateways connect XMPP to Discord, Telegram, WhatsApp, Signal and Matrix accounts. SerikaCord only bridges to Discord."),
        src: ["slidge"],
      },
      {
        title: gt("Blogs, communities and search"),
        text: gt("Movim mixes chat with public blogs and Communities that can be read without signing in, and has full-text message search since November 2025. SerikaCord is focused on chat and has nothing like the blogs."),
        src: ["movim-home", "movim-032"],
      },
      {
        title: gt("No company and no data business"),
        text: gt("Movim is a donation-funded project, and mov.im is hosted in the EU. If you want chat run by a community rather than a company, it fits, though SerikaCord also has no ads and doesn't sell data."),
        src: ["movim-home", "legal"],
      },
    ],
    pickThem: [
      gt("you want an open, federated standard with no company in control"),
      gt("you want to host your own server and let your members use any XMPP app"),
      gt("you want chat mixed with public blogs and communities"),
      gt("you need to bridge several networks into one account"),
    ],
    pickUs: [
      gt("you want encryption on by default for private chats"),
      gt("you want Discord-style roles, onboarding and moderation tools"),
      gt("you want native desktop and Android apps instead of a web app"),
      gt("you want your Discord bots to work with small changes"),
    ],
    faq: [
      {
        question: gt("What is the difference between XMPP and Movim?"),
        answer: gt("XMPP (also called Jabber) is the open chat standard, kept by the XMPP Standards Foundation. Movim is one app for it, a web app with Spaces, blogs and video calls. Your XMPP account also works in other apps such as Conversations or Gajim."),
      },
      {
        question: gt("Is XMPP end-to-end encrypted?"),
        answer: gt("Optionally. Movim and many XMPP apps support OMEMO encryption for chats and private rooms, but it is not on by default, public rooms aren't covered, and Movim's group calls aren't end-to-end encrypted."),
      },
      {
        question: gt("Is Movim open source, and can I self-host it?"),
        answer: gt("Yes. Movim is AGPL-3.0 and runs in front of any XMPP server. Spaces currently need ejabberd, and group video calls need a Galène server."),
      },
      {
        question: gt("Is Movim a Discord replacement?"),
        answer: gt("Partly. Spaces (April 2026) group chatrooms like a Discord server, and Movim has group video and screen sharing. It lacks Discord-style roles, a bot platform, threads and native apps."),
      },
      {
        question: gt("Can I move my Discord server to XMPP?"),
        answer: gt("There is no importer. The third-party Slidcord gateway connects your own Discord account to XMPP; we couldn't verify how stable it is."),
      },
      {
        question: gt("Is XMPP safe?"),
        answer: gt("It depends on your server and on whether you use OMEMO. In 2023 traffic to jabber.ru was intercepted for months; messages not protected by end-to-end encryption were exposed to whoever intercepted them."),
      },
      {
        question: gt("Who runs Movim?"),
        answer: gt("Movim is a French community project led by Timothée Jaussoin, who also runs the mov.im server, hosted in Germany. It is funded by donations and grants."),
      },
    ],
    couldNotVerify: [
      gt("How many people use XMPP or Movim; xmpp.org only says millions, and Movim's instance numbers are unclear."),
      gt("Whether mov.im requires an email address, its minimum age and its upload limit."),
      gt("Any security audit of Movim, and details of the reported 2016 OMEMO audit."),
      gt("Whether Prosody, the other popular XMPP server, supports Movim's Spaces yet."),
      gt("How stable the Slidcord Discord gateway is and how it fits Discord's terms."),
    ],
    notes: {
      title: gt("XMPP is a standard; Movim is one app for it"),
      intro: gt("What you get on XMPP depends on the server and the app you use."),
      points: [
        gt("XMPP is an open standard, not a service. Thousands of servers run it, and none of them is in charge."),
        gt("Movim is a web app for XMPP. Its newer features, such as Spaces, only work on servers that support them, which at launch meant ejabberd."),
        gt("Encryption also depends on the app. Movim supports OMEMO, but if the person you write to uses an app without it, your chat isn't end-to-end encrypted."),
        gt("The jabber.ru interception in 2023 showed why that matters: the server connection was encrypted, but someone with access to the hosting network could still read chats that lacked end-to-end encryption."),
      ],
      src: ["xmpp-home", "movim-033", "movim-home", "jabberru"],
    },
  };
}

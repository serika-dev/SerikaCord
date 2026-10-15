import { getGT } from "gt-next/server";
import type { AppContent, CompareSource } from "../types";

/**
 * SerikaCord vs Discourse. Facts checked on COMPARE_LAST_CHECKED_ISO against
 * the sources below (titles and publishers are proper names, not translated).
 */

export const sources: CompareSource[] = [
  { id: "home", title: "Discourse homepage", url: "https://www.discourse.org/", publisher: "Discourse", kind: "primary" },
  { id: "pricing", title: "Discourse pricing", url: "https://www.discourse.org/pricing", publisher: "Discourse", kind: "primary" },
  { id: "about", title: "About Discourse", url: "https://www.discourse.org/about", publisher: "Discourse", kind: "primary" },
  { id: "privacy", title: "Discourse Privacy Policy (updated 23 September 2026)", url: "https://www.discourse.org/privacy", publisher: "Discourse", kind: "primary", date: "2026-09-23" },
  {
    id: "free-plan",
    title: "Introducing the Discourse Free Plan",
    url: "https://blog.discourse.org/2026/07/introducing-the-discourse-free-plan/",
    publisher: "Discourse",
    kind: "primary",
    date: "2026-07-14",
  },
  {
    id: "in-2027",
    title: "Discourse in 2027: Building Together",
    url: "https://blog.discourse.org/2026/10/discourse-in-2027-building-together/",
    publisher: "Discourse",
    kind: "primary",
    date: "2026-10-14",
  },
  {
    id: "agent-ready",
    title: "Discourse is Agent Ready",
    url: "https://blog.discourse.org/2026/05/discourse-is-agent-ready-heres-how/",
    publisher: "Discourse",
    kind: "primary",
    date: "2026-05-22",
  },
  {
    id: "voice",
    title: "Voice: Discord-style voice and video rooms, now bundled",
    url: "https://meta.discourse.org/t/-/411337",
    publisher: "Discourse Meta",
    kind: "primary",
    date: "2026-09-01",
  },
  { id: "chat-docs", title: "Discourse Chat documentation", url: "https://meta.discourse.org/t/discourse-chat/230881", publisher: "Discourse Meta", kind: "primary" },
  { id: "github", title: "Discourse source code (GPL-2.0)", url: "https://github.com/discourse/discourse", publisher: "GitHub", kind: "primary" },
  {
    id: "voice-plugin",
    title: "Voice core plugin (experimental, off by default)",
    url: "https://github.com/discourse/discourse/tree/main/plugins/voice",
    publisher: "GitHub",
    kind: "primary",
    date: "2026-09-01",
  },
  {
    id: "chat-integration",
    title: "Discourse chat integration plugin (Discord, Slack, Matrix and more)",
    url: "https://github.com/discourse/discourse/tree/main/plugins/discourse-chat-integration",
    publisher: "GitHub",
    kind: "primary",
  },
  { id: "importers", title: "Discourse import scripts", url: "https://github.com/discourse/discourse/tree/main/script/import_scripts", publisher: "GitHub", kind: "primary" },
  {
    id: "upload-settings",
    title: "Discourse default site settings (upload sizes)",
    url: "https://github.com/discourse/discourse/blob/main/config/site_settings.yml",
    publisher: "GitHub",
    kind: "primary",
  },
  { id: "advisories", title: "Discourse security advisories", url: "https://github.com/discourse/discourse/security/advisories", publisher: "GitHub", kind: "primary" },
  { id: "encrypt", title: "discourse-encrypt (archived)", url: "https://github.com/discourse/discourse-encrypt", publisher: "GitHub", kind: "primary", date: "2025-02-06" },
  { id: "hub-ios", title: "DiscourseHub on the App Store", url: "https://apps.apple.com/us/app/discoursehub/id1173672076", publisher: "Apple App Store", kind: "primary" },
  { id: "wikipedia", title: "Discourse (software)", url: "https://en.wikipedia.org/wiki/Discourse_(software)", publisher: "Wikipedia", kind: "secondary" },
];

export async function content(): Promise<AppContent> {
  const gt = await getGT();
  return {
    take: gt("The best open-source forum: searchable long-form topics, strong moderation and free self-hosting, now with chat. But it is a forum first, voice rooms are experimental and nothing is end-to-end encrypted."),
    intro: [
      gt("Discourse is open-source forum software, made since 2013 by Civilized Discourse Construction Kit, a US company. Communities use it for long-form topics that stay searchable for years, such as support hubs, developer forums and product communities, and it now includes real-time chat and experimental voice rooms."),
      gt("SerikaCord is the opposite shape: a real-time chat app with servers, drop-in voice channels and encrypted DMs, where forum channels are one feature among many. For durable knowledge and support communities, Discourse is the better tool; for hanging out, talking in voice and chatting live, SerikaCord fits better, and many communities use both."),
    ],
    verdict: gt("If your community needs answers that people can search and find years later, pick Discourse. If it mostly talks live, in text and voice, pick SerikaCord, or run both side by side."),
    facts: {
      operator: {
        value: gt("Civilized Discourse Construction Kit"),
        note: gt("A venture-backed private company founded in 2013 by Jeff Atwood, Robin Ward and Sam Saffron. Sam Saffron and Sarah Hawk have been co-CEOs since February 2023."),
        src: ["wikipedia", "about"],
      },
      jurisdiction: {
        value: gt("United States"),
        note: gt("A US company with a GDPR contact address in Amsterdam. Hosted forums are mostly stored in the US, some in Canada and the EU; self-hosted forums live wherever you run them."),
        src: ["privacy", "about"],
      },
      businessModel: {
        value: gt("Hosting and enterprise plans"),
        note: gt("The whole product is open source; the company earns money from managed hosting, enterprise contracts, add-ons and AI credits."),
        src: ["pricing", "in-2027"],
      },
      ads: {
        status: "no",
        value: gt("None from Discourse"),
        note: gt("Discourse doesn't put ads in forums, but forum owners can run their own ads with a bundled ad plugin."),
        src: ["github"],
      },
      pricing: {
        value: gt("Free self-hosting; hosting from $0"),
        note: gt("Hosted Free plan since July 2026 with limits (2 staff seats, 500,000 page views a month, 5 GB storage). Pro is $100 a month, Business $500 a month, Enterprise custom."),
        src: ["pricing", "free-plan"],
      },
      maturity: {
        status: "yes",
        value: gt("Since 2014"),
        note: gt("Version 1.0 came out in August 2014. Monthly releases; chat has been bundled since version 3.0."),
        src: ["wikipedia", "github"],
      },
      e2eeDms: {
        status: "no",
        note: gt("Personal messages and chat DMs can be read by whoever runs the forum. The plugin that encrypted personal messages was archived in February 2025."),
        src: ["encrypt"],
      },
      e2eeGroups: {
        status: "no",
        note: gt("Group personal messages and group chats are not end-to-end encrypted."),
        src: ["encrypt"],
      },
      e2eeCalls: {
        status: "no",
        note: gt("The experimental voice rooms make no end-to-end encryption claim. They connect peer-to-peer, or through a LiveKit media server for larger rooms."),
        src: ["voice-plugin", "voice"],
      },
      e2eeCommunity: {
        status: "no",
        note: gt("Topics and chat channels are protected in transit (HTTPS) but stored readable on the server."),
        src: ["privacy"],
      },
      e2eeDefault: {
        status: "no",
        note: gt("There is no end-to-end encryption to turn on."),
        src: ["encrypt"],
      },
      audit: {
        status: "no",
        note: gt("We found no public third-party security audit. Discourse publishes security advisories on GitHub, more than 100 so far."),
        src: ["advisories"],
      },
      metadata: {
        value: gt("Operator sees everything"),
        note: gt("Whoever runs the forum, you or the company if it hosts it, can see all posts, personal messages, chat and IP addresses."),
        src: ["privacy"],
      },
      dataUse: {
        status: "partial",
        value: gt("Doesn't sell for money"),
        note: gt("The policy says it doesn't sell personal information for money, but it may share visitor and prospect data with B2B marketing databases and data brokers. That covers marketing data, not forum content."),
        src: ["privacy"],
      },
      phone: {
        status: "no",
        value: gt("Not by default"),
        note: gt("Each forum's operator decides what sign-up asks for."),
        src: ["github"],
      },
      email: {
        status: "yes",
        value: gt("By default"),
        note: gt("Email is your identity on a forum unless its operator uses single sign-on. This depends on each forum."),
        src: ["github"],
      },
      ageChecks: {
        status: "no",
        value: gt("None built in"),
        note: gt("Any age rules are up to each forum's operator. We couldn't find a minimum age in the company's terms; the DiscourseHub iPhone app is rated 16+."),
        src: ["hub-ios"],
      },
      servers: {
        status: "partial",
        value: gt("One forum per site"),
        note: gt("Each Discourse site is one community with categories and chat channels, usually with its own sign-up. The DiscourseHub app can follow several forums."),
        src: ["hub-ios", "chat-docs"],
      },
      roles: {
        status: "yes",
        note: gt("Groups, trust levels that grant privileges as people participate, moderators, admins and per-category permissions."),
        src: ["github"],
      },
      threadsForums: {
        status: "yes",
        value: gt("Best in class"),
        note: gt("Topics are the core of Discourse: categories, tags, solved answers, voting and wiki posts. Chat channels can have threads."),
        src: ["github", "chat-docs"],
      },
      onboarding: {
        status: "yes",
        note: gt("A tutorial bot for new users, policies people must accept, custom sign-up fields, invites and single sign-on."),
        src: ["github"],
      },
      modTools: {
        status: "yes",
        note: gt("Flags, a review queue, trust levels, silencing and suspensions, user notes, spam filtering with Akismet, AI spam triage and slow mode."),
        src: ["github"],
      },
      platformSafety: {
        status: "partial",
        value: gt("Up to each forum"),
        note: gt("Each forum's own staff moderate it. We found no general transparency report from the company."),
        src: ["privacy"],
      },
      voiceChannels: {
        status: "partial",
        value: gt("Experimental"),
        note: gt("Discord-style voice and video rooms arrived on 1 September 2026, off by default. Beyond about 50 voice or 10 video participants they need a LiveKit server, which hosted plans only include from Business."),
        src: ["voice", "voice-plugin", "pricing"],
      },
      videoScreen: {
        status: "partial",
        value: gt("Experimental"),
        note: gt("Video, screen sharing and live subtitles come with the experimental voice rooms."),
        src: ["voice"],
      },
      streamingStage: {
        status: "no",
        note: gt("No Go Live-style streaming or Stage-style events."),
        src: ["voice"],
      },
      botApi: {
        status: "partial",
        value: gt("API, webhooks, AI bots"),
        note: gt("A full REST API, webhooks, automation, AI agents and an MCP server for AI tools. Chat has incoming webhooks but no interactive bots or slash commands."),
        src: ["github", "chat-docs", "agent-ready"],
      },
      discordBots: {
        status: "no",
        note: gt("Discourse's API is not compatible with Discord's, so Discord bots don't run on it."),
        src: ["github"],
      },
      discordMigration: {
        status: "no",
        value: gt("One-way notifications"),
        note: gt("A bundled plugin can post forum activity into Discord. Of more than 60 importers, none is for Discord."),
        src: ["chat-integration", "importers"],
      },
      desktop: {
        status: "no",
        value: gt("Browser only"),
        note: gt("No native desktop app; it works in any browser and can be installed as a web app."),
        src: ["home"],
      },
      mobile: {
        status: "partial",
        value: gt("Web app and DiscourseHub"),
        note: gt("Forums work well in mobile browsers. DiscourseHub for Android and iPhone is a thin wrapper that collects forums; on the US App Store it had 10 ratings averaging 3.9."),
        src: ["hub-ios"],
      },
      web: {
        status: "yes",
        note: gt("The browser is the main way to use Discourse, and you can also reply by email."),
        src: ["home"],
      },
      license: {
        status: "yes",
        value: gt("GPL-2.0 open source"),
        note: gt("The full product is open source, with the same code for self-hosted and hosted forums."),
        src: ["github"],
      },
      selfHost: {
        status: "yes",
        note: gt("An official Docker install, fully featured and free. It needs a server with Ruby on Rails, PostgreSQL and Redis, which is heavy for a small group."),
        src: ["github"],
      },
      federation: {
        status: "no",
        value: gt("Not built in"),
        note: gt("An ActivityPub plugin exists, but we didn't verify its current state."),
      },
      uploads: {
        value: gt("10 MB by default"),
        note: gt("Forum operators can change it; self-hosters can allow attachments up to about 1 GB. The hosted Free plan has 5 GB of storage in total."),
        src: ["upload-settings", "free-plan"],
      },
      groupSize: {
        value: gt("Unlimited members"),
        note: gt("Even the hosted Free plan allows unlimited members, but it caps page views and staff seats. Voice rooms need LiveKit beyond about 50 voice or 10 video participants."),
        src: ["free-plan", "voice"],
      },
      scale: {
        status: "yes",
        value: gt("22,000+ communities"),
        note: gt("Self-reported: more than 22,000 communities, over 3 million posts and over 1 billion page views a month. It doesn't publish a user count."),
        src: ["home", "about"],
      },
      incidents: {
        value: gt("Security advisories, no breach found"),
        note: gt("Two high-severity advisories in September 2026 (HTML injection through embeds, and uploads staying public after category permissions were tightened), plus several medium data-leak advisories in May and June 2026. Self-hosters need to update to get the fixes."),
        src: ["advisories"],
      },
    },
    whyUs: [
      {
        title: gt("Live chat and voice are the core, not add-ons"),
        text: gt("SerikaCord is built around real-time chat and drop-in voice channels with screen sharing. Discourse added voice rooms on 1 September 2026 as an experimental feature that is off by default, and larger rooms need a LiveKit server, included on hosted plans only from Business at $500 a month."),
        src: ["voice", "voice-plugin", "pricing"],
      },
      {
        title: gt("Encrypted private messages"),
        text: gt("SerikaCord encrypts DMs and group DMs, including their calls, end to end by default for new conversations. Discourse has no end-to-end encryption since its encryption plugin was archived in February 2025. Our encryption is new and hasn't been audited yet."),
        src: ["encrypt"],
      },
      {
        title: gt("One account, many communities, native apps"),
        text: gt("On SerikaCord one account joins any number of servers, with apps for Windows, macOS, Linux and Android. Each Discourse forum is its own site, with no native desktop app and a thin DiscourseHub wrapper on mobile. We don't have an iPhone app yet either."),
        src: ["hub-ios"],
      },
      {
        title: gt("Your Discord bots and community can come along"),
        text: gt("SerikaCord's bot API follows Discord's API v10, and a consent-based two-way bridge connects a Discord server while people move. Discourse can only post forum activity into Discord, and none of its 60-plus importers handles Discord."),
        src: ["chat-integration", "importers"],
      },
      {
        title: gt("Nothing to host, no staff seat limits"),
        text: gt("Creating a SerikaCord server is free, with 500 MB uploads and no limits on moderators. Discourse's hosted Free plan has 2 staff seats and 500,000 page views a month, then costs $100 a month. If you self-host Discourse this edge mostly disappears."),
        src: ["free-plan", "pricing"],
      },
    ],
    whyThem: [
      {
        title: gt("Knowledge that lasts and can be found"),
        text: gt("Discourse topics are long-form, organized by category and tag, marked solved, and indexed by search engines, so the same question doesn't get asked every week. Chat, ours included, scrolls away. For support and knowledge communities, Discourse is simply the better tool."),
        src: ["home", "github"],
      },
      {
        title: gt("Truly open source, self-host for free"),
        text: gt("Discourse is GPL-2.0 open source, and the self-hosted version is the same code the company hosts, with no feature limits. SerikaCord is source-available, not open source, and allows self-hosting only for personal, non-commercial use."),
        src: ["github"],
      },
      {
        title: gt("Moderation built for strangers at scale"),
        text: gt("Trust levels give new members limited powers until they earn more, and a review queue, Akismet spam filtering and AI triage catch abuse. These tools have been refined since 2014."),
        src: ["github", "wikipedia"],
      },
      {
        title: gt("A long, proven track record"),
        text: gt("Discourse has been developed since 2013 and says it runs more than 22,000 communities. SerikaCord launched in January 2026 and has a small community."),
        src: ["about", "wikipedia"],
      },
      {
        title: gt("Easy to bring in from other forums"),
        text: gt("More than 60 importers move communities in from Slack, phpBB, vBulletin, XenForo and others. SerikaCord has no importers, only the Discord bridge."),
        src: ["importers"],
      },
      {
        title: gt("Works with the chat you already use"),
        text: gt("Discourse can post new topics into Discord, Slack, Matrix, Telegram and other chat apps, so many communities run a Discourse forum next to their chat server."),
        src: ["chat-integration"],
      },
    ],
    pickThem: [
      gt("you run a support hub, developer forum or product community"),
      gt("you want answers that search engines can find years later"),
      gt("you want fully open-source software you can self-host for free"),
      gt("your members prefer reading and writing longer posts to live chat"),
    ],
    pickUs: [
      gt("your community mostly talks live, in text and voice"),
      gt("you want drop-in voice channels that are a core feature, not an experiment"),
      gt("you want end-to-end encrypted DMs"),
      gt("you're moving from Discord and want your bots and a bridge"),
    ],
    faq: [
      {
        question: gt("Is Discourse end-to-end encrypted?"),
        answer: gt("No. Posts, personal messages and chat can be read by whoever runs the forum. The plugin that encrypted personal messages was archived in February 2025."),
      },
      {
        question: gt("Is Discourse open source, and can I self-host it?"),
        answer: gt("Yes. Discourse is open source under the GPL-2.0 license, and the official Docker install runs the same code as hosted forums, for free. You need a server that can run Ruby on Rails, PostgreSQL and Redis."),
      },
      {
        question: gt("Is Discourse free?"),
        answer: gt("Self-hosting is free. Since July 2026 there is also a hosted Free plan with limits on staff seats, page views and storage. Paid hosting is $100 a month for Pro and $500 a month for Business."),
      },
      {
        question: gt("Does Discourse have voice chat like Discord?"),
        answer: gt("Since 1 September 2026 it includes Discord-style voice and video rooms with screen sharing, but they are experimental and off by default. Rooms larger than about 50 voice or 10 video participants need a LiveKit server."),
      },
      {
        question: gt("Can I move my Discord server to Discourse?"),
        answer: gt("There is no official Discord importer. A bundled plugin can post forum activity into a Discord channel, so many communities run both side by side."),
      },
      {
        question: gt("Who runs Discourse?"),
        answer: gt("Civilized Discourse Construction Kit, a US company founded in 2013 by Jeff Atwood, Robin Ward and Sam Saffron. Anyone can also run their own Discourse forum."),
      },
      {
        question: gt("Should I use Discourse or SerikaCord?"),
        answer: gt("They do different jobs. Discourse is better for long-form, searchable discussion; SerikaCord is better for live chat and voice. Many communities use a forum and a chat app together."),
      },
      {
        question: gt("Can I host SerikaCord myself?"),
        answer: gt("Yes, but only for personal, non-commercial use for yourself and people you invite, free for them and not open to public sign-up. Commercial use needs a license from partners@serika.dev. Self-hosted instances don't connect to serika.chat, there is no official setup guide or support, and SerikaCord is not open source."),
      },
    ],
    couldNotVerify: [
      gt("The minimum age in the company's terms of service: the terms page didn't load."),
      gt("Whether voice rooms are switched on by default on any hosted plan."),
      gt("The exact plugin and branding limits of the hosted Free plan."),
      gt("The current state of the ActivityPub federation plugin."),
      gt("Funding or revenue after the 2021 Series A."),
    ],
    notes: {
      title: gt("Forum or chat? Many communities use both"),
      intro: gt("Discourse and SerikaCord aren't really the same kind of product, so this comparison is less about which is better and more about which job you need done."),
      points: [
        gt("A forum is for posts that should last: questions with accepted answers, guides, announcements and decisions that people will search for later."),
        gt("A chat app is for talking now: quick back-and-forth, voice channels, hanging out and coordinating in real time."),
        gt("Discourse now has chat and experimental voice rooms, and SerikaCord has forum channels, but each is strongest at its original job."),
        gt("Discourse can post new topics into chat apps like Discord, Slack and Matrix, which is how many communities connect a forum to their chat."),
      ],
      src: ["chat-docs", "voice", "chat-integration"],
    },
  };
}

import { getGT } from "gt-next/server";
import type { AppContent, CompareSource } from "../types";

/**
 * SerikaCord vs Valour (valour.gg). Facts checked on COMPARE_LAST_CHECKED_ISO
 * against the sources below (titles and publishers are proper names, not
 * translated).
 */

export const sources: CompareSource[] = [
  { id: "home", title: "Valour homepage", url: "https://valour.gg", publisher: "Valour", kind: "primary" },
  { id: "faq", title: "Valour FAQ", url: "https://valour.gg/faq/", publisher: "Valour", kind: "primary" },
  { id: "privacy", title: "Valour Privacy Policy (last updated 26 September 2026)", url: "https://valour.gg/privacy/", publisher: "Valour", kind: "primary", date: "2026-09-26" },
  { id: "terms", title: "Valour Terms (last updated 15 February 2026)", url: "https://valour.gg/terms/", publisher: "Valour", kind: "primary", date: "2026-02-15" },
  { id: "texas", title: "Why Valour Paused Texas Registrations", url: "https://valour.gg/texas/", publisher: "Valour", kind: "primary" },
  {
    id: "discord-alt",
    title: "Discord Alternative With Encryption and No ID Checks",
    url: "https://valour.gg/discord-alternative/",
    publisher: "Valour",
    kind: "primary",
  },
  { id: "github", title: "Valour source code, releases and README", url: "https://github.com/Valour-Software/Valour", publisher: "GitHub", kind: "primary" },
  {
    id: "e2ee",
    title: "Valour end-to-end encryption design",
    url: "https://github.com/Valour-Software/Valour/blob/main/Docs/EndToEndEncryption.md",
    publisher: "GitHub",
    kind: "primary",
    date: "2026-09-26",
  },
  { id: "payments", title: "Valour payments documentation", url: "https://github.com/Valour-Software/Valour/blob/main/Docs/Payments.md", publisher: "GitHub", kind: "primary" },
  { id: "play", title: "Valour on Google Play", url: "https://play.google.com/store/apps/details?id=gg.valour.app", publisher: "Google Play", kind: "primary" },
];

export async function content(): Promise<AppContent> {
  const gt = await getGT();
  return {
    take: gt("An open-source, self-hostable Discord alternative that end-to-end encrypts text even in community channels. But that encryption is weeks old and unaudited, calls and files aren't covered, and very few people use it yet."),
    intro: [
      gt("Valour is an open-source (AGPL) Discord-style app from Valour Software, a small US company, in development since 2020. In September 2026 it switched on its own end-to-end encryption for all chat text, including community channels, which it calls planets, and it can be self-hosted with Docker."),
      gt("This is one area where Valour goes further than SerikaCord: our server channels are not end-to-end encrypted. SerikaCord wins on encrypted calls and files in DMs, Discord bot compatibility, larger uploads and an EU home; Valour wins on encrypted community text, open source and real self-hosting. Both encryption designs are new and unaudited."),
    ],
    verdict: gt("If you want encrypted community channels and an open-source app you can run yourself, Valour is the more ambitious choice, if you accept how new it is. If you want encrypted calls in your DMs, Discord bots and big file uploads, SerikaCord fits better."),
    facts: {
      operator: {
        value: gt("Valour Software LLC"),
        note: gt("A small company with volunteer contributors. The project has been on GitHub since October 2020."),
        src: ["terms", "github"],
      },
      jurisdiction: {
        value: gt("United States"),
        note: gt("A Wyoming company. Data is hosted in the US on Microsoft Azure and Cloudflare."),
        src: ["terms", "privacy"],
      },
      businessModel: {
        value: gt("Subscriptions and virtual currency"),
        note: gt("Stargazer subscriptions and one-time Valour Credits packs, sold through Stripe and Google Play."),
        src: ["payments"],
      },
      ads: {
        status: "no",
        value: gt("No ads"),
        note: gt("No ads and no third-party analytics or advertising software, per its homepage and privacy policy."),
        src: ["home", "privacy"],
      },
      pricing: {
        value: gt("Free; Stargazer optional"),
        note: gt("Stargazer costs $4.99, $9.99 or $14.99 a month and adds larger uploads, profile extras and credits."),
        src: ["payments"],
      },
      maturity: {
        status: "partial",
        value: gt("Pre-1.0 (v0.9)"),
        note: gt("Version 0.9.19 came out on 8 October 2026, with new releases every few days."),
        src: ["github"],
      },
      e2eeDms: {
        status: "yes",
        value: gt("Yes, since September 2026"),
        note: gt("Message text is end-to-end encrypted. Files, images and GIFs are not."),
        src: ["e2ee", "privacy"],
      },
      e2eeGroups: {
        status: "yes",
        note: gt("Group chats, with the same limits as DMs."),
        src: ["e2ee"],
      },
      e2eeCalls: {
        status: "no",
        note: gt("The privacy policy says calls run through Cloudflare's real-time service or the planet's own server and are not end-to-end encrypted."),
        src: ["privacy"],
      },
      e2eeCommunity: {
        status: "yes",
        value: gt("Text in every channel"),
        note: gt("Message text and embeds in every planet channel. Threads, wiki pages, calendars and attachments are not end-to-end encrypted."),
        src: ["e2ee"],
      },
      e2eeDefault: {
        status: "yes",
        value: gt("Always on"),
        note: gt("The server refuses unencrypted messages from clients. History from before the switch stays readable until it is sealed."),
        src: ["e2ee"],
      },
      audit: {
        status: "no",
        value: gt("Not audited"),
        note: gt("A custom design launched on 26 September 2026. We found no independent review."),
        src: ["e2ee"],
      },
      metadata: {
        value: gt("Valour sees metadata"),
        note: gt("Its design document says the server sees sender, channel, time, replies, mentions, reactions and attachment records, and can read webhook, AutoMod and system messages and reported messages."),
        src: ["e2ee"],
      },
      dataUse: {
        status: "yes",
        value: gt("No selling, no ad trackers"),
        note: gt("The privacy policy rules out selling data and advertising profiles, and names its processors, including Azure, Cloudflare, Stripe and Sentry."),
        src: ["privacy"],
      },
      phone: {
        status: "no",
        value: gt("Not required"),
        src: ["privacy"],
      },
      email: {
        status: "yes",
        value: gt("Email or Google/Discord sign-in"),
        src: ["privacy", "discord-alt"],
      },
      ageChecks: {
        status: "no",
        value: gt("Self-declared"),
        note: gt("A birth date only, with no ID or face scans. Minimum age 13, with safer defaults under 18. New sign-ups from Texas are paused rather than adding ID checks."),
        src: ["terms", "privacy", "texas"],
      },
      servers: {
        status: "yes",
        note: gt("Communities are called planets, with nested categories and a multi-window workspace with tabs and splits."),
        src: ["home", "github"],
      },
      roles: {
        status: "yes",
        note: gt("Detailed permissions per planet and per channel."),
        src: ["github"],
      },
      threadsForums: {
        status: "partial",
        note: gt("Reddit-style public post feeds sorted by hot, new or top, plus wikis and calendars, instead of Discord-style threads."),
        src: ["home", "e2ee"],
      },
      onboarding: {
        status: "unknown",
        note: gt("We couldn't verify whether Valour has onboarding or rules screening."),
      },
      modTools: {
        status: "yes",
        note: gt("Roles, AutoMod with trigger words that works with encryption, bans, reports and an audit log."),
        src: ["github", "e2ee"],
      },
      platformSafety: {
        status: "partial",
        note: gt("The privacy policy covers reports, lawful government requests and preserving evidence of child sexual abuse material. We found no transparency report."),
        src: ["privacy"],
      },
      voiceChannels: { status: "yes", src: ["home"] },
      videoScreen: {
        status: "yes",
        note: gt("Video calls of up to 25 people and screen sharing."),
        src: ["faq"],
      },
      streamingStage: {
        status: "partial",
        note: gt("Screen sharing in calls. We found no Go Live-style streaming or Stage channels."),
        src: ["faq"],
      },
      botApi: {
        status: "yes",
        note: gt("Bots use Valour's .NET SDK, which handles the encryption. Interactive embeds with buttons and forms, and incoming webhooks."),
        src: ["github"],
      },
      discordBots: {
        status: "no",
        note: gt("Valour's API is its own, so Discord bots have to be rewritten."),
        src: ["github"],
      },
      discordMigration: {
        status: "partial",
        value: gt("Structure only"),
        note: gt("Paste a Discord server template link to recreate channels, categories, roles and permissions; messages and members don't come along, and there is no bridge. You can sign in with Discord."),
        src: ["discord-alt", "faq"],
      },
      desktop: {
        status: "yes",
        note: gt("Windows, macOS 14 or newer (Apple silicon and Intel) and Linux (a Flatpak file, not on Flathub and without auto-update)."),
        src: ["home", "github"],
      },
      mobile: {
        status: "partial",
        value: gt("Android only"),
        note: gt("Android on Google Play or as an APK. There is no iPhone app; iPhone users use the web app."),
        src: ["play", "faq"],
      },
      web: { status: "yes", src: ["home"] },
      license: {
        status: "yes",
        value: gt("AGPL-3.0"),
        note: gt("Both the client and the server are open source."),
        src: ["github"],
      },
      selfHost: {
        status: "yes",
        note: gt("A Docker Compose bundle with PostgreSQL, Redis and automatic HTTPS. Planets on the official service can also bring their own file storage and voice server."),
        src: ["github"],
      },
      federation: {
        status: "partial",
        value: gt("Hub and nodes"),
        note: gt("Accounts stay on the official hub, but a planet can run on an independently operated community node. Separate self-hosted instances don't connect to each other."),
        src: ["github"],
      },
      uploads: {
        value: gt("10 MB per file"),
        note: gt("The default in the source code. Stargazer raises it; a 50 MB tier appears in the code."),
        src: ["github", "payments"],
      },
      groupSize: {
        value: gt("Calls: 25 people"),
        note: gt("We found no published limit on planet size."),
        src: ["faq"],
      },
      scale: {
        status: "unknown",
        value: gt("Very small"),
        note: gt("Valour publishes no user count. Google Play shows 10+ installs, and its GitHub releases have about 10,800 downloads in total."),
        src: ["play", "github"],
      },
      incidents: {
        value: gt("Texas sign-ups paused"),
        note: gt("Some time after July 2026 Valour paused new registrations from Texas rather than add ID or face age checks. We found no data breach."),
        src: ["texas"],
      },
    },
    whyUs: [
      {
        title: gt("Encrypted calls and files in your DMs"),
        text: gt("SerikaCord encrypts text, files and voice and video calls in DMs and group DMs. Valour encrypts message text but not calls, files, images or GIFs. Neither design has been independently audited, and both launched in the last few weeks."),
        src: ["privacy", "e2ee"],
      },
      {
        title: gt("Your Discord bots and a bridge"),
        text: gt("SerikaCord's bot API follows Discord's API v10, so many discord.js and discord.py bots run after changing the API address, and a consent-based bridge mirrors a Discord server. Valour bots must be written with its .NET SDK, and its Discord import copies structure only."),
        src: ["github", "discord-alt"],
      },
      {
        title: gt("50 times the free upload size"),
        text: gt("Free SerikaCord accounts can upload files up to 500 MB. Valour's default is 10 MB per file."),
        src: ["github"],
      },
      {
        title: gt("Discord-style threads, forums and onboarding"),
        text: gt("SerikaCord has threads, forum and ticket channels, onboarding questions and rules screening that work like Discord's. Valour uses public post feeds and wikis instead, and we couldn't confirm it has onboarding."),
        src: ["home"],
      },
      {
        title: gt("Based in the EU, open in Texas"),
        text: gt("SerikaCord is run from the Netherlands under the GDPR and accepts sign-ups from anyone 16 or older. Valour is a US company hosted on Azure and Cloudflare, and has paused new sign-ups from Texas."),
        src: ["privacy", "texas"],
      },
    ],
    whyThem: [
      {
        title: gt("Encrypted community channels"),
        text: gt("Valour end-to-end encrypts message text in every planet channel by default, not just in DMs. On SerikaCord, server channels are encrypted at rest but readable by us. If encrypted community chat matters most to you, Valour goes further, though its design is weeks old and unaudited."),
        src: ["e2ee"],
      },
      {
        title: gt("Real open source"),
        text: gt("Valour's client and server are AGPL-3.0, so anyone can study, change and reuse the code. SerikaCord's code is public but under our own license, which is not open source."),
        src: ["github"],
      },
      {
        title: gt("Self-hosting with few strings attached"),
        text: gt("Valour ships a Docker Compose bundle, and planets can run on independent community nodes or bring their own storage and voice server. SerikaCord allows self-hosting only for personal, non-commercial use, with no official setup guide."),
        src: ["github"],
      },
      {
        title: gt("Calls don't expose your IP to others"),
        text: gt("Valour's calls run through Cloudflare's real-time service or the planet's own server. SerikaCord's calls connect peer-to-peer where possible, so others in a call can see your IP address."),
        src: ["privacy"],
      },
      {
        title: gt("Copy a Discord server's structure"),
        text: gt("Valour can recreate a Discord server's channels, categories, roles and permissions from a template link, and you can sign in with Discord. SerikaCord has a bridge but no importer."),
        src: ["discord-alt"],
      },
      {
        title: gt("Younger teens can join"),
        text: gt("Valour's minimum age is 13, with safer defaults for under-18s. SerikaCord is 16 and over everywhere."),
        src: ["terms"],
      },
    ],
    pickThem: [
      gt("you want community channel text end-to-end encrypted, not just DMs"),
      gt("you want AGPL open source and to run your own server"),
      gt("you want public post feeds and wikis that search engines can find"),
      gt("some of your members are 13 to 15"),
    ],
    pickUs: [
      gt("you want calls and files in your DMs end-to-end encrypted"),
      gt("you want to keep your Discord bots or bridge a Discord server"),
      gt("you share large files"),
      gt("you want a service run from the EU, or you live in Texas"),
    ],
    faq: [
      {
        question: gt("Is Valour end-to-end encrypted?"),
        answer: gt("Mostly for text. Since 26 September 2026 Valour encrypts message text in DMs, group chats and every planet channel by default. Calls, files and images are not end-to-end encrypted, and the custom design hasn't been independently audited."),
      },
      {
        question: gt("Is Valour more private than SerikaCord?"),
        answer: gt("For community channels, yes: Valour encrypts their text and SerikaCord doesn't. For DMs, SerikaCord also encrypts files and calls, which Valour doesn't. Both see metadata, and neither design has been audited."),
      },
      {
        question: gt("Is Valour open source, and can I self-host it?"),
        answer: gt("Yes. The client and server are AGPL-3.0, and Valour offers a Docker Compose bundle for running your own instance."),
      },
      {
        question: gt("Can I host SerikaCord myself?"),
        answer: gt("Yes, but only for personal, non-commercial use for yourself and people you invite, free for them and not open to public sign-up. Commercial use needs a license from partners@serika.dev. Self-hosted instances don't connect to serika.chat, there is no official setup guide or support, and SerikaCord is not open source."),
      },
      {
        question: gt("Can I move my Discord server to Valour?"),
        answer: gt("Partly. Valour can recreate channels, categories, roles and permissions from a Discord server template link. Messages and members don't come along, and Discord bots have to be rewritten for Valour's SDK."),
      },
      {
        question: gt("Why can't I sign up for Valour in Texas?"),
        answer: gt("Valour paused new registrations from Texas rather than add ID or face age checks, pointing to the Texas App Store Accountability Act and the state's age-verification push."),
      },
      {
        question: gt("Does Valour have an iPhone app?"),
        answer: gt("No. iPhone users use the web app. SerikaCord is in the same position: our iOS app is in development, and the web app works on iPhone meanwhile."),
      },
    ],
    couldNotVerify: [
      gt("How many people use Valour; it publishes no user count."),
      gt("Any independent security review of Valour's encryption."),
      gt("Upload limits for each Stargazer tier."),
      gt("Whether Valour has onboarding or rules screening for new members."),
      gt("When Valour Software LLC was formed and who owns it."),
      gt("The exact date Texas sign-ups were paused."),
    ],
    notes: {
      title: gt("What Valour's encryption covers"),
      intro: gt("Valour publishes an unusually detailed design document. In short, from that document and its privacy policy:"),
      points: [
        gt("Encrypted end to end: message text and embeds in DMs, group chats and every planet channel, on by default, using a custom design built on standard building blocks (X25519, Ed25519, ChaCha20-Poly1305)."),
        gt("Not encrypted end to end: calls, files, images and GIFs, threads, wiki pages and calendars, and webhook, AutoMod and system messages, which the server seals itself."),
        gt("Visible to the server: who sent a message, in which channel and when, replies, mentions, reactions and attachment records. Reported messages are revealed to moderators."),
        gt("Older messages from before September 2026 stay readable on the server until an operator seals them."),
      ],
      src: ["e2ee", "privacy"],
    },
  };
}

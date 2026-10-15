import { getGT } from "gt-next/server";
import type { AppContent, CompareSource } from "../types";

/**
 * SerikaCord vs Sable, a Discord-style Matrix client. Facts checked on
 * COMPARE_LAST_CHECKED_ISO against the sources below (titles and publishers
 * are proper names, not translated). Sable is only a client: account rules,
 * uploads and moderation depend on the Matrix homeserver you pick.
 */

export const sources: CompareSource[] = [
  { id: "github", title: "Sable v1 source code, README and changelog", url: "https://github.com/SableClient/Sable", publisher: "GitHub", kind: "primary" },
  { id: "sable-next", title: "Sable v2 (sable-next) source code and releases", url: "https://git.sable.moe/SableClient/sable-next", publisher: "Sable", kind: "primary" },
  { id: "original", title: "Original Sable repository and early releases", url: "https://github.com/7w1/sable", publisher: "GitHub", kind: "primary", date: "2026-02" },
  { id: "docs", title: "Sable documentation", url: "https://docs.sable.moe/", publisher: "Sable", kind: "primary" },
  { id: "install", title: "Install Sable", url: "https://docs.sable.moe/installation/", publisher: "Sable", kind: "primary" },
  { id: "privacy", title: "Sable privacy and crash reporting", url: "https://docs.sable.moe/features/privacy/", publisher: "Sable", kind: "primary" },
  { id: "config", title: "Sable hosted client configuration (homeservers, push, GIF proxy)", url: "https://app.sable.moe/config.json", publisher: "Sable", kind: "primary" },
  { id: "well-known", title: "sable.moe homeserver configuration (LiveKit)", url: "https://sable.moe/.well-known/matrix/client", publisher: "Sable", kind: "primary" },
  { id: "play", title: "Sable on Google Play", url: "https://play.google.com/store/apps/details?id=moe.sable.client", publisher: "Google Play", kind: "primary" },
  { id: "flathub", title: "Sable on Flathub", url: "https://flathub.org/apps/moe.sable.client", publisher: "Flathub", kind: "primary" },
  {
    id: "soatok",
    title: "Cryptographic issues in Matrix's Rust library vodozemac",
    url: "https://soatok.blog/2026/02/17/cryptographic-issues-in-matrixs-rust-library-vodozemac/",
    publisher: "Soatok",
    kind: "secondary",
    date: "2026-02-17",
  },
  {
    id: "vodozemac-analysis",
    title: "Analysis of reported issues in vodozemac",
    url: "https://matrix.org/blog/2026/02/analysis-of-reported-issues-in-vodozemac/",
    publisher: "Matrix.org Foundation",
    kind: "primary",
    date: "2026-02-18",
  },
  {
    id: "least-authority",
    title: "Matrix vodozemac final audit report",
    url: "https://leastauthority.com/static/publications/LeastAuthority-Matrix_vodozemac_Final_Audit_Report.pdf",
    publisher: "Least Authority",
    kind: "primary",
    date: "2022-03-30",
  },
  { id: "mx-terms", title: "matrix.org homeserver terms update", url: "https://matrix.org/blog/2025/07/terms-update/", publisher: "Matrix.org Foundation", kind: "primary", date: "2025-07-31" },
  { id: "mx-pricing", title: "Matrix.org Homeserver Pricing", url: "https://matrix.org/homeserver/pricing/", publisher: "Matrix.org Foundation", kind: "primary" },
  {
    id: "mx-welcome",
    title: "Welcoming Discord users amidst the challenge of Age Verification",
    url: "https://matrix.org/blog/2026/02/welcome-discord/",
    publisher: "Matrix.org Foundation",
    kind: "primary",
    date: "2026-02-12",
  },
  {
    id: "mx-e2ee",
    title: "Cross-signing and end-to-end encryption by default is here",
    url: "https://matrix.org/blog/2020/05/06/cross-signing-and-end-to-end-encryption-by-default-is-here/",
    publisher: "Matrix.org Foundation",
    kind: "primary",
    date: "2020-05-06",
  },
  { id: "mx-bridges", title: "Matrix ecosystem: Discord bridges", url: "https://matrix.org/ecosystem/bridges/discord/", publisher: "Matrix.org Foundation", kind: "primary" },
];

export async function content(): Promise<AppContent> {
  const gt = await getGT();
  return {
    take: gt("A young, open-source Matrix app made to feel like Discord, so you can talk to anyone on the Matrix network. It was rewritten from scratch in October 2026, and on iPhone it needs sideloading."),
    intro: [
      gt("Sable is a free, open-source app (a client) for Matrix, the open, federated chat network. It doesn't run the network itself: you pick a Matrix homeserver such as matrix.org or sable.moe, and Sable gives you a Discord-like look with spaces, voice rooms, polls and themes on top. It started in February 2026 as a fork of the Cinny client and was rewritten from scratch as version 2.0 on 10 October 2026."),
      gt("Sable inherits Matrix's strengths: federation, open source and encryption that has been on by default for private chats since 2020. SerikaCord is a single app and service, so it offers what Matrix lacks: named roles, onboarding, moderation tools, Discord-compatible bots and no homeserver to choose. Both are young, small projects."),
    ],
    verdict: gt("If you want Matrix's open network with a Discord-like app and you're comfortable picking a homeserver, try Sable. If you want Discord-style roles, moderation and bots in one service without that choice, SerikaCord is simpler."),
    facts: {
      operator: {
        value: gt("Volunteer open-source project"),
        note: gt("Led by a developer known as 7w1 on GitHub. We found no company, legal entity or country for the project."),
        src: ["github", "original"],
      },
      jurisdiction: {
        status: "unknown",
        value: gt("Unknown"),
        note: gt("We found no imprint or legal page. Your data's legal home depends on the homeserver you pick."),
        src: ["docs"],
      },
      businessModel: {
        value: gt("Volunteer-run, free"),
        note: gt("No paid plans found. The hosted setup mentions a supporter awards service whose purpose we couldn't confirm."),
        src: ["config"],
      },
      ads: {
        status: "no",
        value: gt("No ads"),
        note: gt("None observed. The Google Play listing declares no data collected or shared."),
        src: ["play"],
      },
      pricing: {
        value: gt("Free"),
        note: gt("The app is free. Accounts on matrix.org and sable.moe are free too; other homeservers set their own prices."),
        src: ["config"],
      },
      maturity: {
        status: "partial",
        value: gt("Young; just rewritten"),
        note: gt("First release in February 2026. Version 2.0, a from-scratch rewrite in Rust and Svelte, came out on 10 October 2026, so expect regressions. The project calls itself an almost stable Matrix client."),
        src: ["original", "sable-next", "github"],
      },
      e2eeDms: {
        status: "yes",
        value: gt("Matrix encryption"),
        note: gt("Uses Matrix's standard Olm and Megolm end-to-end encryption. We couldn't confirm whether Sable turns it on by default for new DMs."),
        src: ["github"],
      },
      e2eeGroups: {
        status: "yes",
        value: gt("Encrypted rooms"),
        note: gt("Encryption is a per-room setting in Matrix. Public rooms are usually unencrypted."),
        src: ["github"],
      },
      e2eeCalls: {
        status: "partial",
        note: gt("Calls use MatrixRTC and LiveKit, the system behind Element Call, which is encrypted by design. We couldn't verify Sable's own call encryption settings."),
        src: ["well-known"],
      },
      e2eeCommunity: {
        status: "partial",
        value: gt("Opt-in per room"),
        note: gt("Public rooms and spaces are typically unencrypted so they can be searched and moderated."),
      },
      e2eeDefault: {
        status: "unknown",
        note: gt("We couldn't confirm Sable's defaults. Matrix's usual convention is encrypted DMs and private rooms, unencrypted public rooms."),
        src: ["mx-e2ee"],
      },
      audit: {
        status: "partial",
        value: gt("Library only"),
        note: gt("We found no audit of Sable itself. Its Matrix encryption library, vodozemac, was audited by Least Authority in 2022; issues a researcher reported in February 2026 were disputed by the Matrix team as having no practical impact."),
        src: ["least-authority", "soatok", "vodozemac-analysis"],
      },
      metadata: {
        value: gt("Homeserver sees metadata"),
        note: gt("Your homeserver sees who talks to whom and when, and every server in a federated room gets that metadata. Push notifications go through Sable's own push gateway or UnifiedPush."),
        src: ["config"],
      },
      dataUse: {
        status: "yes",
        value: gt("Opt-in crash reports"),
        note: gt("Crash reporting is off by default and scrubbed of message content, IDs and tokens. GIF searches go through Sable's own proxy."),
        src: ["privacy", "config"],
      },
      phone: {
        status: "no",
        value: gt("Depends on homeserver"),
        note: gt("None of the default homeservers is known to require one."),
        src: ["config"],
      },
      email: {
        status: "partial",
        value: gt("Depends on homeserver"),
        note: gt("matrix.org requires a verified email address; other homeservers set their own rules."),
        src: ["mx-terms"],
      },
      ageChecks: {
        status: "no",
        value: gt("None by Sable"),
        note: gt("Sable does no age checks. Your homeserver sets the minimum age; matrix.org's is 18."),
        src: ["mx-terms"],
      },
      servers: {
        status: "partial",
        value: gt("Matrix Spaces"),
        note: gt("Spaces group rooms like a Discord server, but a room can belong to several spaces."),
        src: ["github"],
      },
      roles: {
        status: "partial",
        value: gt("Power levels"),
        note: gt("Matrix's numeric power levels, not named Discord-style roles with per-channel overrides."),
        src: ["mx-welcome"],
      },
      threadsForums: {
        status: "partial",
        note: gt("Version 1 had threads and, from August 2026, forum rooms. We couldn't confirm both carried over to the version 2 rewrite."),
        src: ["github"],
      },
      onboarding: {
        status: "no",
        note: gt("We found no onboarding questions or rules screening."),
      },
      modTools: {
        status: "partial",
        note: gt("Matrix basics: power levels, kicks, bans and message removal. No AutoMod-style filters."),
        src: ["github"],
      },
      platformSafety: {
        status: "partial",
        value: gt("Up to the homeserver"),
        note: gt("Sable is only an app; abuse is handled by your homeserver's operator. Sable publishes no safety or transparency reports."),
      },
      voiceChannels: {
        status: "yes",
        note: gt("Drop-in voice rooms through MatrixRTC and LiveKit; sable.moe runs its own LiveKit server. We couldn't confirm every call feature in version 2."),
        src: ["well-known", "sable-next"],
      },
      videoScreen: {
        status: "partial",
        note: gt("Video calls through MatrixRTC. We couldn't independently confirm screen sharing in version 2."),
        src: ["well-known"],
      },
      streamingStage: {
        status: "no",
        note: gt("No Stage-style channels; we couldn't verify streaming."),
      },
      botApi: {
        status: "yes",
        value: gt("Matrix bots"),
        note: gt("Any Matrix bot works, and Sable supports widgets."),
        src: ["github"],
      },
      discordBots: {
        status: "no",
        value: gt("Different API"),
        note: gt("Discord bots have to be rewritten for Matrix."),
      },
      discordMigration: {
        status: "partial",
        value: gt("Matrix bridges only"),
        note: gt("Only through Matrix bridges such as mautrix-discord, which homeservers run, not Sable. No server importer."),
        src: ["mx-bridges"],
      },
      desktop: {
        status: "yes",
        note: gt("Windows, macOS (through Homebrew) and Linux (Flathub, AUR, .deb, .rpm and AppImage)."),
        src: ["install", "flathub"],
      },
      mobile: {
        status: "partial",
        value: gt("Android; iPhone by sideloading"),
        note: gt("Android from Google Play or as an APK. On iPhone you have to sideload an unsigned app with AltStore or SideStore and refresh it every 7 days."),
        src: ["install", "play"],
      },
      web: {
        status: "yes",
        note: gt("app.sable.moe, installable as a web app."),
        src: ["install"],
      },
      license: {
        status: "yes",
        value: gt("AGPL-3.0"),
        src: ["github", "sable-next"],
      },
      selfHost: {
        status: "yes",
        value: gt("Client and homeserver"),
        note: gt("You can host the web app yourself with Docker and pair it with your own Matrix homeserver."),
        src: ["install"],
      },
      federation: {
        status: "yes",
        note: gt("Works with any Matrix homeserver and talks to people using Element, Commet and every other Matrix app."),
        src: ["config"],
      },
      uploads: {
        value: gt("Set by homeserver"),
        note: gt("On matrix.org the free limit is 10 MB per file."),
        src: ["mx-pricing"],
      },
      groupSize: {
        status: "unknown",
        note: gt("Set by Matrix and the homeserver; we found no Sable-specific limit."),
      },
      scale: {
        value: gt("Unknown; small"),
        note: gt("Sable publishes no user numbers, and Matrix-wide figures are not Sable users. Rough signs in October 2026: 100+ Google Play installs, 3,254 Flathub installs and 514 GitHub stars."),
        src: ["play", "flathub", "github"],
      },
      incidents: {
        value: gt("Security fix, July 2026"),
        note: gt("Version 1.20.0 (July 2026) fixed a bug that let the GIF integration send or show arbitrary links; the project said account data wasn't exposed. With the October 2026 rewrite, development moved from GitHub to its own Forgejo server."),
        src: ["github", "sable-next"],
      },
    },
    whyUs: [
      {
        title: gt("Discord-style roles, onboarding and moderation"),
        text: gt("SerikaCord has named roles with per-channel permissions, onboarding questions, rules screening, AutoMod, an audit log and timeouts. Sable is limited to what Matrix offers: numeric power levels, kicks, bans and message removal."),
        src: ["mx-welcome", "github"],
      },
      {
        title: gt("No homeserver to choose"),
        text: gt("Sable asks you to pick a Matrix homeserver, and its rules become yours: matrix.org, for example, is 18+, needs a verified email and allows 10 MB uploads for free. On SerikaCord you sign up and go; it is 16+ and allows 500 MB per file."),
        src: ["config", "mx-terms", "mx-pricing"],
      },
      {
        title: gt("A known operator in the EU"),
        text: gt("SerikaCord is run by Serika Company from the Netherlands under the GDPR. We found no legal entity or country behind Sable, and your data's legal home depends on whichever homeserver you use."),
        src: ["docs"],
      },
      {
        title: gt("Discord bots and a consent-based bridge"),
        text: gt("Many Discord bots run on SerikaCord after changing the API address, and our bridge mirrors a Discord server with each member's consent. Sable can't run Discord bots, and Discord bridging depends on what your homeserver runs."),
        src: ["mx-bridges"],
      },
      {
        title: gt("Not in the middle of a rewrite"),
        text: gt("Sable replaced its whole codebase on 10 October 2026, so its earlier track record no longer applies. SerikaCord is also young (January 2026), so this is a small edge, not a big one."),
        src: ["sable-next"],
      },
    ],
    whyThem: [
      {
        title: gt("The whole Matrix network"),
        text: gt("With Sable you can talk to anyone on any Matrix homeserver, whatever app they use, and no single company controls your account. SerikaCord is one central service, and self-hosted copies don't connect to it."),
        src: ["config"],
      },
      {
        title: gt("Open source under the AGPL"),
        text: gt("Sable is AGPL-3.0 and you can host the web app and a homeserver yourself, for any purpose. SerikaCord is source-available, not open source, and allows self-hosting only for personal, non-commercial use."),
        src: ["github", "install"],
      },
      {
        title: gt("Matrix's older encryption, including private community rooms"),
        text: gt("Matrix encryption has been on by default for private chats since 2020 and its core library was audited in 2022, though Sable itself hasn't been audited. It can also cover private community rooms. SerikaCord's encryption launched in October 2026, is unaudited and doesn't cover server channels."),
        src: ["mx-e2ee", "least-authority"],
      },
      {
        title: gt("In the app stores"),
        text: gt("Sable's Android app is on Google Play and its Linux app on Flathub, and macOS users can install it with Homebrew. SerikaCord's Android app is downloaded from our website."),
        src: ["play", "flathub", "install"],
      },
      {
        title: gt("Lots of personal touches"),
        text: gt("Sable offers pronouns, polls, themes, personas, PluralKit import and a choice of GIF provider, with crash reporting off by default and push without Google through UnifiedPush."),
        src: ["github", "privacy"],
      },
    ],
    pickThem: [
      gt("you already use Matrix and want an app that feels more like Discord"),
      gt("you want an open-source app on an open, federated network"),
      gt("you want Google Play or Flathub installs"),
      gt("you're comfortable choosing a homeserver and handling Matrix key backups"),
    ],
    pickUs: [
      gt("you want Discord-style roles, onboarding and moderation for a community"),
      gt("you don't want to choose a homeserver"),
      gt("you want to bring Discord bots along"),
      gt("you want a service with a known operator and legal home in the EU"),
    ],
    faq: [
      {
        question: gt("Is Sable a separate network from Matrix?"),
        answer: gt("No. Sable is an app for Matrix, so your account lives on a Matrix homeserver and you can talk to people using Element, Commet or any other Matrix app."),
      },
      {
        question: gt("Is Sable end-to-end encrypted?"),
        answer: gt("It uses Matrix's standard encryption for DMs and encrypted rooms. Public rooms are usually unencrypted, and we couldn't confirm whether Sable encrypts new DMs by default."),
      },
      {
        question: gt("Is Sable open source?"),
        answer: gt("Yes, it is AGPL-3.0. Version 2 is developed on the project's own Forgejo server rather than GitHub."),
      },
      {
        question: gt("Is there a Sable app for iPhone?"),
        answer: gt("Not in the App Store. You can sideload it with AltStore or SideStore, refreshing it every 7 days, or use the web app. SerikaCord also has no iPhone app yet, but its web app works in Safari."),
      },
      {
        question: gt("How many people use Sable?"),
        answer: gt("Nobody knows for sure; the project publishes no numbers, and Matrix-wide figures are not Sable users. In October 2026 it had 100+ Google Play installs, 3,254 Flathub installs and 514 GitHub stars."),
      },
      {
        question: gt("Can I move my Discord server to Sable?"),
        answer: gt("Not directly. Some Matrix homeservers run Discord bridges such as mautrix-discord, but Sable has no importer and can't run Discord bots."),
      },
      {
        question: gt("Can I host SerikaCord myself?"),
        answer: gt("Yes, but only for personal, non-commercial use for you and people you invite, free for them and not open to public sign-up; commercial use needs a license from partners@serika.dev. Self-hosted instances don't connect to serika.chat, there is no official setup guide or support, and SerikaCord is not open source."),
      },
    ],
    couldNotVerify: [
      gt("Who is legally behind Sable and in which country."),
      gt("Whether version 2 has all of version 1's features, including screen sharing, search and forum rooms."),
      gt("Whether Sable encrypts new DMs and private rooms by default."),
      gt("How many people actually use Sable."),
      gt("Whether a privacy policy exists for the sable.moe hosted services."),
    ],
    notes: {
      title: gt("Sable is a Matrix app, not its own network"),
      points: [
        gt("Sable is a client: the app you see. Your account, messages and moderation live on the Matrix homeserver you choose, and that server's rules apply."),
        gt("That means many facts in the table, such as age limits, email and upload size, depend on the homeserver rather than on Sable."),
        gt("Sable inherits Matrix's strengths (federation, open standards, mature encryption) and its gaps, such as numeric power levels instead of named roles."),
        gt("Version 2.0, released on 10 October 2026, is a complete rewrite, so reviews of earlier versions may not apply."),
      ],
      src: ["config", "sable-next", "mx-welcome"],
    },
  };
}

import { getGT } from "gt-next/server";
import type { AppContent, CompareSource } from "../types";

/**
 * SerikaCord vs Commet, a Discord-style Matrix client. Facts checked on
 * COMPARE_LAST_CHECKED_ISO against the sources below (titles and publishers
 * are proper names, not translated). Commet is only a client: account rules,
 * uploads and moderation depend on the Matrix homeserver you pick.
 */

export const sources: CompareSource[] = [
  { id: "home", title: "Commet homepage", url: "https://commet.chat", publisher: "Commet", kind: "primary" },
  { id: "install-android", title: "Install Commet on Android", url: "https://commet.chat/install/android", publisher: "Commet", kind: "primary" },
  { id: "install-linux", title: "Install Commet on Linux", url: "https://commet.chat/install/linux", publisher: "Commet", kind: "primary" },
  { id: "install-windows", title: "Install Commet on Windows", url: "https://commet.chat/install/windows", publisher: "Commet", kind: "primary" },
  { id: "donations", title: "Private donations", url: "https://commet.chat/info/private-donations", publisher: "Commet", kind: "primary" },
  { id: "storage", title: "Where is data stored?", url: "https://commet.chat/info/storage-locations", publisher: "Commet", kind: "primary" },
  { id: "github", title: "Commet source code, README and contributing guide", url: "https://github.com/commetchat/commet", publisher: "GitHub", kind: "primary" },
  { id: "v050", title: "Commet v0.5.0 release notes", url: "https://github.com/commetchat/commet/releases/tag/v0.5.0", publisher: "GitHub", kind: "primary", date: "2026-09-24" },
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
  {
    id: "mx-e2ee",
    title: "Cross-signing and end-to-end encryption by default is here",
    url: "https://matrix.org/blog/2020/05/06/cross-signing-and-end-to-end-encryption-by-default-is-here/",
    publisher: "Matrix.org Foundation",
    kind: "primary",
    date: "2020-05-06",
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
  { id: "mx-bridges", title: "Matrix ecosystem: Discord bridges", url: "https://matrix.org/ecosystem/bridges/discord/", publisher: "Matrix.org Foundation", kind: "primary" },
];

export async function content(): Promise<AppContent> {
  const gt = await getGT();
  return {
    take: gt("A cozy, open-source Matrix app with Discord-style voice rooms, shared calendars and photo albums. It is essentially one developer's project, still pre-1.0, with no macOS or iPhone app."),
    intro: [
      gt("Commet is a free, open-source app (a client) for Matrix, the open, federated chat network. You sign in with an account on any Matrix homeserver, and Commet shows your spaces and rooms in a Discord-like layout with voice rooms, calendar and photo album rooms, and several accounts logged in at once. It has been developed since 2023, mostly by one person, and is at version 0.5.0 (September 2026)."),
      gt("Commet inherits Matrix's strengths: federation, open source and encryption that has been on by default for private chats since 2020. SerikaCord is a single app and service with Discord-style roles, onboarding, moderation, Discord-compatible bots and apps for macOS, so it fits communities better; Commet fits small friend groups that already like Matrix."),
    ],
    verdict: gt("Small friend groups on Windows, Linux or Android who want Matrix with a cozy, Discord-like feel may enjoy Commet. Communities that need roles, moderation, bots or Apple devices will find SerikaCord easier."),
    facts: {
      operator: {
        value: gt("One-person open-source project"),
        note: gt("Led by a developer known as Airyzz, with about 786 commits against 10 for the next contributor. We found no company, legal entity or country."),
        src: ["github"],
      },
      jurisdiction: {
        status: "unknown",
        value: gt("Unknown"),
        note: gt("We found no legal page. Your data's legal home depends on the homeserver you pick."),
        src: ["storage"],
      },
      businessModel: {
        value: gt("Donations"),
        note: gt("Donors get a profile badge through a scheme designed so a donation can't be linked to a Matrix account."),
        src: ["donations"],
      },
      ads: {
        status: "no",
        value: gt("No ads"),
        note: gt("None observed."),
        src: ["home"],
      },
      pricing: {
        value: gt("Free"),
        note: gt("Donations are optional; we couldn't verify amounts. Account costs depend on the homeserver."),
        src: ["donations"],
      },
      maturity: {
        status: "partial",
        value: gt("Pre-1.0, since 2023"),
        note: gt("First release in September 2023; the latest is 0.5.0 from 24 September 2026. Releases come months apart."),
        src: ["github", "v050"],
      },
      e2eeDms: {
        status: "yes",
        value: gt("Matrix encryption"),
        note: gt("Matrix's Olm and Megolm encryption with cross-signing and emoji verification. We couldn't confirm whether new DMs are encrypted by default."),
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
        value: gt("Group calls experimental"),
        note: gt("One-to-one calls are encrypted between the two devices. Support for encrypted Element Call group calls is labeled experimental in 0.5.0."),
        src: ["v050"],
      },
      e2eeCommunity: {
        status: "partial",
        value: gt("Opt-in per room"),
        note: gt("Public rooms and spaces are typically unencrypted."),
      },
      e2eeDefault: {
        status: "unknown",
        note: gt("We couldn't confirm Commet's defaults. Matrix's usual convention is encrypted DMs and private rooms, unencrypted public rooms."),
        src: ["mx-e2ee"],
      },
      audit: {
        status: "partial",
        value: gt("Library only"),
        note: gt("We found no audit of Commet. Its Matrix encryption library, vodozemac, was audited by Least Authority in 2022; issues a researcher reported in February 2026 were disputed by the Matrix team."),
        src: ["least-authority", "soatok", "vodozemac-analysis"],
      },
      metadata: {
        value: gt("Homeserver sees metadata"),
        note: gt("Your homeserver sees who talks to whom and when, and every server in a federated room gets that metadata."),
      },
      dataUse: {
        status: "yes",
        value: gt("No tracking found"),
        note: gt("Commet documents only local storage. GIF searches are proxied, and the chosen GIF is re-uploaded to your homeserver to reduce tracking."),
        src: ["storage", "github"],
      },
      phone: {
        status: "no",
        value: gt("Depends on homeserver"),
        note: gt("matrix.org doesn't ask for one; other homeservers set their own rules."),
        src: ["mx-terms"],
      },
      email: {
        status: "partial",
        value: gt("Depends on homeserver"),
        note: gt("matrix.org requires a verified email address; other homeservers set their own rules."),
        src: ["mx-terms"],
      },
      ageChecks: {
        status: "no",
        value: gt("None by Commet"),
        note: gt("Commet does no age checks. Your homeserver sets the minimum age; matrix.org's is 18."),
        src: ["mx-terms"],
      },
      servers: {
        status: "partial",
        value: gt("Matrix Spaces"),
        note: gt("Spaces group rooms like a Discord server; folders and reordering arrived in 0.5.0."),
        src: ["v050"],
      },
      roles: {
        status: "partial",
        value: gt("Power levels"),
        note: gt("Matrix's numeric power levels, not named Discord-style roles with per-channel overrides."),
        src: ["mx-welcome"],
      },
      threadsForums: {
        status: "partial",
        note: gt("Threads, plus calendar and photo album rooms. We found no forum channels."),
        src: ["home", "github"],
      },
      onboarding: {
        status: "no",
        note: gt("We found no onboarding questions or rules screening."),
      },
      modTools: {
        status: "partial",
        note: gt("Basic Matrix moderation: power levels, kicks and bans. No AutoMod-style filters."),
        src: ["github"],
      },
      platformSafety: {
        status: "partial",
        value: gt("Up to the homeserver"),
        note: gt("Commet is only an app; abuse is handled by your homeserver's operator. Commet publishes no safety reports."),
      },
      voiceChannels: {
        status: "yes",
        note: gt("Drop-in voice rooms through MatrixRTC and LiveKit."),
        src: ["home"],
      },
      videoScreen: {
        status: "yes",
        note: gt("Video calls and screen sharing. We couldn't verify screen-share quality or whether it carries audio."),
        src: ["github"],
      },
      streamingStage: {
        status: "no",
        note: gt("We found no streaming or Stage-style channels."),
      },
      botApi: {
        status: "yes",
        value: gt("Matrix bots"),
        note: gt("Any Matrix bot works, and 0.5.0 added Matrix widgets for tools and games inside rooms."),
        src: ["v050"],
      },
      discordBots: {
        status: "no",
        value: gt("Different API"),
        note: gt("Discord bots have to be rewritten for Matrix."),
      },
      discordMigration: {
        status: "partial",
        value: gt("Matrix bridges only"),
        note: gt("Only through Matrix bridges such as mautrix-discord, which homeservers run, not Commet. No server importer."),
        src: ["mx-bridges"],
      },
      desktop: {
        status: "partial",
        value: gt("Windows and Linux"),
        note: gt("A Windows installer with auto-updates, and Linux as a Flatpak file or .deb (not on Flathub). No macOS app yet."),
        src: ["install-windows", "install-linux"],
      },
      mobile: {
        status: "partial",
        value: gt("Android APK only"),
        note: gt("Android only, as a manual APK with or without Google push; it isn't in any app store. No iPhone app yet."),
        src: ["install-android"],
      },
      web: {
        status: "partial",
        note: gt("A web build runs at app.commet.chat; we couldn't confirm it is a full client."),
        src: ["home"],
      },
      license: {
        status: "yes",
        value: gt("AGPL-3.0"),
        src: ["github"],
      },
      selfHost: {
        status: "yes",
        value: gt("Client and homeserver"),
        note: gt("Commet is open source, and you can pair it with your own Matrix homeserver."),
        src: ["github"],
      },
      federation: {
        status: "yes",
        note: gt("Works with any Matrix homeserver and talks to people using Element, Sable and every other Matrix app. Several accounts can be signed in at once."),
        src: ["github"],
      },
      uploads: {
        value: gt("Set by homeserver"),
        note: gt("On matrix.org the free limit is 10 MB per file."),
        src: ["mx-pricing"],
      },
      groupSize: {
        status: "unknown",
        note: gt("Set by Matrix and the homeserver; we found no Commet-specific limit."),
      },
      scale: {
        value: gt("Unknown; small"),
        note: gt("Commet publishes no user numbers. Rough signs in October 2026: about 60,400 downloads of release files on GitHub since 2023 and 1,121 GitHub stars."),
        src: ["github"],
      },
      incidents: {
        value: gt("None found"),
        note: gt("We found no Commet-specific incidents. In February 2026 a researcher reported issues in vodozemac, the Matrix encryption library it uses; the Matrix team disputed their practical impact."),
        src: ["soatok", "vodozemac-analysis"],
      },
    },
    whyUs: [
      {
        title: gt("Apps for Mac, and a web app for iPhone"),
        text: gt("SerikaCord has a macOS app and a web app that works in Safari on iPhone. Commet has no macOS or iPhone app, and we couldn't confirm its web build is a full client. Our native iPhone app is still in development."),
        src: ["home"],
      },
      {
        title: gt("Discord-style roles, onboarding and moderation"),
        text: gt("SerikaCord has named roles with per-channel permissions, onboarding questions, rules screening, AutoMod, an audit log and timeouts. Commet is limited to Matrix's numeric power levels, kicks and bans."),
        src: ["mx-welcome", "github"],
      },
      {
        title: gt("No homeserver to choose"),
        text: gt("Commet needs an account on a Matrix homeserver, and its rules become yours: matrix.org, for example, is 18+ and allows 10 MB uploads for free. On SerikaCord you sign up and go; it is 16+ and allows 500 MB per file."),
        src: ["mx-terms", "mx-pricing"],
      },
      {
        title: gt("Discord bots and a consent-based bridge"),
        text: gt("Many Discord bots run on SerikaCord after changing the API address, and our bridge mirrors a Discord server with each member's consent. Commet can't run Discord bots, and Discord bridging depends on your homeserver."),
        src: ["mx-bridges"],
      },
      {
        title: gt("Less reliance on one person"),
        text: gt("Commet's lead developer has made nearly all of its commits, and releases come months apart. SerikaCord is a small team that ships updates often, so the edge is real but modest."),
        src: ["github", "v050"],
      },
    ],
    whyThem: [
      {
        title: gt("The whole Matrix network"),
        text: gt("Commet talks to anyone on any Matrix homeserver, whatever app they use, and no single company controls your account. SerikaCord is one central service, and self-hosted copies don't connect to it."),
        src: ["github"],
      },
      {
        title: gt("Open source under the AGPL"),
        text: gt("Commet is AGPL-3.0 and works with a homeserver you run yourself, for any purpose. SerikaCord is source-available, not open source, and allows self-hosting only for personal, non-commercial use."),
        src: ["github"],
      },
      {
        title: gt("Unusual features"),
        text: gt("Calendar and photo album rooms, several accounts signed in at the same time, sticker packs you can import from Signal, and widgets for tools and games inside rooms."),
        src: ["home", "github", "v050"],
      },
      {
        title: gt("Careful privacy details"),
        text: gt("GIF searches are proxied and re-uploaded to your homeserver so the GIF service can't follow you, and donation badges are designed so a donation can't be tied to your account."),
        src: ["github", "donations"],
      },
      {
        title: gt("Matrix's older encryption"),
        text: gt("Matrix encryption has been on by default for private chats since 2020 and its core library was audited in 2022, though Commet itself hasn't been audited and its encrypted group calls are experimental. SerikaCord's encryption launched in October 2026 and is unaudited."),
        src: ["mx-e2ee", "least-authority", "v050"],
      },
      {
        title: gt("No AI-written code"),
        text: gt("Commet's contribution rules ban generative AI. SerikaCord uses AI coding assistants, which matters to some people."),
        src: ["github"],
      },
    ],
    pickThem: [
      gt("you're a small friend group already on Matrix and use Windows, Linux or Android"),
      gt("you want calendar and photo album rooms or several accounts at once"),
      gt("you want an open-source app on an open, federated network"),
      gt("you prefer software built without generative AI"),
    ],
    pickUs: [
      gt("you use a Mac or an iPhone"),
      gt("you run a community that needs roles, onboarding and moderation"),
      gt("you want to bring Discord bots along"),
      gt("you don't want to choose a homeserver"),
    ],
    faq: [
      {
        question: gt("Is Commet its own network?"),
        answer: gt("No. Commet is an app for Matrix, so your account lives on a Matrix homeserver and you can talk to people using Element, Sable or any other Matrix app."),
      },
      {
        question: gt("Is Commet end-to-end encrypted?"),
        answer: gt("It uses Matrix's standard encryption for DMs and encrypted rooms, with emoji verification. Encrypted group calls are still experimental, and we couldn't confirm whether new DMs are encrypted by default."),
      },
      {
        question: gt("Is Commet available on iPhone or Mac?"),
        answer: gt("Not yet; both are planned. Commet runs on Windows, Linux and Android (as an APK). SerikaCord has a macOS app and works in Safari on iPhone."),
      },
      {
        question: gt("Is Commet open source?"),
        answer: gt("Yes, it is AGPL-3.0 on GitHub. It is developed mostly by one person."),
      },
      {
        question: gt("How many people use Commet?"),
        answer: gt("Nobody knows for sure; the project publishes no numbers. In October 2026 its GitHub release files had been downloaded about 60,400 times since 2023, and it had 1,121 GitHub stars."),
      },
      {
        question: gt("Can I move my Discord server to Commet?"),
        answer: gt("Not directly. Some Matrix homeservers run Discord bridges such as mautrix-discord, but Commet has no importer and can't run Discord bots."),
      },
      {
        question: gt("Can I host SerikaCord myself?"),
        answer: gt("Yes, but only for personal, non-commercial use for you and people you invite, free for them and not open to public sign-up; commercial use needs a license from partners@serika.dev. Self-hosted instances don't connect to serika.chat, there is no official setup guide or support, and SerikaCord is not open source."),
      },
    ],
    couldNotVerify: [
      gt("Who is legally behind Commet and in which country."),
      gt("Whether Commet encrypts new DMs and rooms by default."),
      gt("Whether the web build at app.commet.chat is a full client."),
      gt("Screen-sharing quality and whether it carries audio."),
      gt("How many people actually use Commet."),
    ],
    notes: {
      title: gt("Commet is a Matrix app, not its own network"),
      points: [
        gt("Commet is a client: the app you see. Your account, messages and moderation live on the Matrix homeserver you choose, and that server's rules apply."),
        gt("That means many facts in the table, such as age limits, email and upload size, depend on the homeserver rather than on Commet."),
        gt("Commet inherits Matrix's strengths (federation, open standards, mature encryption) and its gaps, such as numeric power levels instead of named roles."),
      ],
      src: ["github", "mx-welcome"],
    },
  };
}

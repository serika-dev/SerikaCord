import { getGT } from "gt-next/server";
import type { AppContent, CompareSource } from "../types";

/**
 * SerikaCord vs Matrix + Element. Facts checked on COMPARE_LAST_CHECKED_ISO
 * against the sources below (titles and publishers are proper names, not
 * translated). Many Matrix facts depend on the homeserver; cells say so.
 */

export const sources: CompareSource[] = [
  { id: "element-home", title: "Element homepage", url: "https://element.io/", publisher: "Element", kind: "primary" },
  { id: "matrix-home", title: "Matrix.org homepage", url: "https://matrix.org/", publisher: "Matrix.org Foundation", kind: "primary" },
  { id: "element-pricing", title: "Element pricing", url: "https://element.io/pricing", publisher: "Element", kind: "primary" },
  { id: "element-download", title: "Element downloads", url: "https://element.io/download", publisher: "Element", kind: "primary" },
  { id: "element-privacy", title: "Element privacy notice", url: "https://element.io/legal/privacy", publisher: "Element", kind: "primary", date: "2025-02-24" },
  {
    id: "agpl",
    title: "A new home and license (AGPL) for Synapse and friends",
    url: "https://element.io/blog/element-to-adopt-agplv3/",
    publisher: "Element",
    kind: "primary",
    date: "2023-11-06",
  },
  {
    id: "elementx-update",
    title: "Element X and Pro updates; a glimpse into the future",
    url: "https://element.io/blog/element-x-and-pro-updates-a-glimpse-into-the-future/",
    publisher: "Element",
    kind: "primary",
    date: "2025-11-12",
  },
  {
    id: "ess",
    title: "Welcome to the all-new Element Server Suite family of Helm charts",
    url: "https://element.io/blog/welcome-to-the-all-new-element-server-suite-family-of-helm-charts/",
    publisher: "Element",
    kind: "primary",
  },
  { id: "crossroads", title: "The Matrix.org Foundation at a crossroads", url: "https://matrix.org/blog/2025/02/crossroads/", publisher: "Matrix.org Foundation", kind: "primary", date: "2025-02-20" },
  { id: "outage", title: "Post-mortem of the September 2 outage", url: "https://matrix.org/blog/2025/10/post-mortem/", publisher: "Matrix.org Foundation", kind: "primary", date: "2025-10-29" },
  { id: "terms-update", title: "matrix.org homeserver terms update", url: "https://matrix.org/blog/2025/07/terms-update/", publisher: "Matrix.org Foundation", kind: "primary", date: "2025-07-31" },
  { id: "terms", title: "matrix.org homeserver Terms and Conditions", url: "https://matrix.org/legal/terms-and-conditions/", publisher: "Matrix.org Foundation", kind: "primary" },
  { id: "privacy-notice", title: "matrix.org Privacy Notice (v3.3.1)", url: "https://matrix.org/legal/privacy-notice/", publisher: "Matrix.org Foundation", kind: "primary", date: "2025-08-25" },
  { id: "law-enforcement", title: "matrix.org Law Enforcement Guidelines", url: "https://matrix.org/legal/law-enforcement-guidelines", publisher: "Matrix.org Foundation", kind: "primary" },
  { id: "hs-pricing", title: "Matrix.org Homeserver Pricing", url: "https://matrix.org/homeserver/pricing/", publisher: "Matrix.org Foundation", kind: "primary" },
  {
    id: "welcome-discord",
    title: "Welcoming Discord users amidst the challenge of Age Verification",
    url: "https://matrix.org/blog/2026/02/welcome-discord/",
    publisher: "Matrix.org Foundation",
    kind: "primary",
    date: "2026-02-12",
  },
  { id: "safer-matrix", title: "Building a Safer Matrix", url: "https://matrix.org/blog/2025/02/building-a-safer-matrix/", publisher: "Matrix.org Foundation", kind: "primary", date: "2025-02-14" },
  { id: "annual-report", title: "Matrix.org Foundation 2025 annual report", url: "https://matrix.org/blog/2026/03/annual-report/", publisher: "Matrix.org Foundation", kind: "primary", date: "2026-03-27" },
  { id: "v119", title: "Matrix v1.19 release", url: "https://matrix.org/blog/2026/07/08/matrix-v1.19-release/", publisher: "Matrix.org Foundation", kind: "primary", date: "2026-07-08" },
  { id: "spec", title: "Matrix Specification (v1.19)", url: "https://spec.matrix.org/latest/", publisher: "Matrix.org Foundation", kind: "primary" },
  { id: "matrix2", title: "Matrix 2.0 (with network statistics)", url: "https://matrix.org/blog/2023/09/matrix-2-0/", publisher: "Matrix.org Foundation", kind: "primary", date: "2023-09-21" },
  {
    id: "e2ee-default",
    title: "Cross-signing and end-to-end encryption by default is here",
    url: "https://matrix.org/blog/2020/05/06/cross-signing-and-end-to-end-encryption-by-default-is-here/",
    publisher: "Matrix.org Foundation",
    kind: "primary",
    date: "2020-05-06",
  },
  {
    id: "sdk-vulns",
    title: "Upgrade now to address E2EE vulnerabilities in Matrix SDKs and clients",
    url: "https://matrix.org/blog/2022/09/28/upgrade-now-to-address-encryption-vulns-in-matrix-sdks-and-clients",
    publisher: "Matrix.org Foundation",
    kind: "primary",
    date: "2022-09-28",
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
    id: "breach-2019",
    title: "Post-mortem and remediations for the April 11 security incident",
    url: "https://matrix.org/blog/2019/05/08/post-mortem-and-remediations-for-apr-11-security-incident/",
    publisher: "Matrix.org Foundation",
    kind: "primary",
    date: "2019-05-08",
  },
  { id: "foundation-about", title: "About the Matrix.org Foundation", url: "https://matrix.org/foundation/about/", publisher: "Matrix.org Foundation", kind: "primary" },
  {
    id: "companies-house",
    title: "The Matrix.org Foundation C.I.C. (company 11648710)",
    url: "https://find-and-update.company-information.service.gov.uk/company/11648710",
    publisher: "Companies House",
    kind: "primary",
  },
  { id: "discord-bridges", title: "Matrix ecosystem: Discord bridges", url: "https://matrix.org/ecosystem/bridges/discord/", publisher: "Matrix.org Foundation", kind: "primary" },
  { id: "mautrix-discord", title: "mautrix-discord authentication", url: "https://docs.mau.fi/bridges/go/discord/authentication.html", publisher: "mautrix", kind: "primary" },
  { id: "element-web", title: "Element Web source code", url: "https://github.com/element-hq/element-web", publisher: "GitHub", kind: "primary" },
  { id: "element-call", title: "Element Call source code", url: "https://github.com/element-hq/element-call", publisher: "GitHub", kind: "primary" },
  { id: "synapse", title: "Synapse source code", url: "https://github.com/element-hq/synapse", publisher: "GitHub", kind: "primary" },
  {
    id: "synapse-config",
    title: "Synapse configuration documentation",
    url: "https://element-hq.github.io/synapse/latest/usage/configuration/config_documentation.html",
    publisher: "Element",
    kind: "primary",
  },
  { id: "elementx-appstore", title: "Element X on the App Store", url: "https://apps.apple.com/us/app/element-x-secure-chat-call/id1631335820", publisher: "Apple App Store", kind: "primary" },
  { id: "consumer-plans", title: "Element ending consumer Matrix plans", url: "https://tiny.write.as/darnell/element-ending-consumer-matrix-plans", publisher: "write.as (Darnell)", kind: "secondary" },
  {
    id: "slack-bridge",
    title: "Matrix.org to retire Slack bridge by January, citing maintenance burden",
    url: "https://cyberinsider.com/matrix-org-to-retire-slack-bridge-by-january-citing-maintenance-burden/",
    publisher: "CyberInsider",
    kind: "secondary",
    date: "2025-11-29",
  },
];

export async function content(): Promise<AppContent> {
  const gt = await getGT();
  return {
    take: gt("An open, federated chat network you can self-host, with mature default encryption for private chats. By its own maintainers' account it isn't a Discord replacement yet: no real voice channels, streaming or Discord-style roles."),
    intro: [
      gt("Matrix is an open standard for chat, a bit like email: anyone can run a server (a homeserver), and people on different servers can talk to each other. Most people use it through Element, the main app, on the free matrix.org homeserver. SerikaCord is the opposite model: one service run by one team, built to work like Discord."),
      gt("Matrix wins on openness. It is federated, open source and fully self-hostable, and its encryption is older, on by default for private chats and partly audited. SerikaCord wins on the Discord-style community experience: voice channels, named roles, onboarding, moderation tools and Discord-compatible bots in one consistent app, which Matrix's own maintainers say it doesn't fully offer yet."),
    ],
    verdict: gt("If you want an open network you can run yourself, with encrypted private rooms and no single company in control, choose Matrix. If you want a Discord-style community with voice channels, roles and bots in one app, SerikaCord fits better today."),
    facts: {
      operator: {
        value: gt("Matrix.org Foundation and Element"),
        note: gt("The protocol and the matrix.org homeserver are run by the Matrix.org Foundation, a UK nonprofit community interest company set up in 2018. Element, a London company, makes the Element apps and the Synapse server."),
        src: ["foundation-about", "companies-house", "element-home"],
      },
      jurisdiction: {
        value: gt("United Kingdom"),
        note: gt("matrix.org is hosted by Mythic Beasts and UpCloud, with media on AWS and Cloudflare in front. Other homeservers are wherever their owners run them."),
        src: ["privacy-notice", "companies-house"],
      },
      businessModel: {
        value: gt("Enterprise sales and donations"),
        note: gt("Element sells self-hosted deployments to companies and governments. The Foundation lives on memberships, donations and, since late 2025, paid Premium accounts on matrix.org; it ran a $356K deficit in 2024."),
        src: ["element-pricing", "crossroads", "hs-pricing"],
      },
      ads: {
        status: "no",
        value: gt("No ads"),
        note: gt("We found no ads in the Element apps or on the matrix.org homeserver."),
        src: ["element-privacy", "privacy-notice"],
      },
      pricing: {
        value: gt("Free; Premium optional"),
        note: gt("The Element apps and the free matrix.org tier cost nothing. matrix.org Premium accounts raise upload limits, but we found no published price. Element ended consumer hosting plans in January 2024."),
        src: ["hs-pricing", "consumer-plans"],
      },
      maturity: {
        status: "yes",
        value: gt("Since 2014"),
        note: gt("Matrix launched in 2014 and its spec reached v1.19 in July 2026. Element X, the newer mobile app, still lagged behind Element Classic on spaces and threads in November 2025."),
        src: ["foundation-about", "v119", "elementx-update"],
      },
      e2eeDms: {
        status: "yes",
        value: gt("On by default"),
        note: gt("Direct messages have been end-to-end encrypted by default since May 2020, using the Olm and Megolm protocols."),
        src: ["e2ee-default"],
      },
      e2eeGroups: {
        status: "yes",
        value: gt("Private rooms"),
        note: gt("Private and invite-only rooms are encrypted by default. Public rooms are not."),
        src: ["e2ee-default"],
      },
      e2eeCalls: {
        status: "yes",
        note: gt("Element Call encrypts one-to-one and group calls end to end."),
        src: ["element-call"],
      },
      e2eeCommunity: {
        status: "partial",
        value: gt("Opt-in per room"),
        note: gt("Public community rooms are usually left unencrypted so newcomers can read history and they can be searched and moderated. Sharing encrypted history with new members only entered the spec in July 2026."),
        src: ["e2ee-default", "v119"],
      },
      e2eeDefault: {
        status: "partial",
        value: gt("DMs and private rooms"),
        note: gt("On by default for DMs and private rooms, off by default for public rooms."),
        src: ["e2ee-default"],
      },
      audit: {
        status: "partial",
        value: gt("Crypto library audited"),
        note: gt("Least Authority audited the vodozemac encryption library in 2022. Researchers found exploitable flaws in older client libraries in September 2022, which were fixed; issues reported in February 2026 were disputed by the Matrix security team as not practically exploitable."),
        src: ["least-authority", "sdk-vulns", "vodozemac-analysis"],
      },
      metadata: {
        value: gt("Homeservers see metadata"),
        note: gt("Your homeserver sees who talks to whom, room membership, timestamps and IP addresses, plus everything in unencrypted rooms. In federated rooms every participating server gets a copy of that metadata."),
        src: ["privacy-notice"],
      },
      dataUse: {
        status: "yes",
        value: gt("No selling, no profiling"),
        note: gt("Element says it doesn't sell personal information and matrix.org says it doesn't profile users. Element's apps use opt-in Matomo analytics and Sentry crash reports."),
        src: ["element-privacy", "privacy-notice"],
      },
      phone: {
        status: "no",
        value: gt("Not required"),
        note: gt("matrix.org doesn't ask for a phone number; other homeservers set their own rules."),
        src: ["terms"],
      },
      email: {
        status: "partial",
        value: gt("Depends on homeserver"),
        note: gt("matrix.org requires a verified email address. Other homeservers set their own rules."),
        src: ["terms", "terms-update"],
      },
      ageChecks: {
        status: "partial",
        value: gt("Self-declared; more planned"),
        note: gt("matrix.org is 18+ since July 2025 and has said stricter checks are coming for the UK, Australia, New Zealand and the EU, with paying for Premium by card as one route. We found no mandatory ID scan. Other homeservers set their own age rules."),
        src: ["terms-update", "welcome-discord"],
      },
      servers: {
        status: "partial",
        value: gt("Spaces"),
        note: gt("Spaces group rooms like a Discord server, and a room can belong to several spaces. In November 2025 Element X could only show spaces read-only."),
        src: ["elementx-update"],
      },
      roles: {
        status: "partial",
        value: gt("Power levels"),
        note: gt("Rooms use numeric power levels from 0 to 100, not named, colored roles with per-channel overrides. The Foundation lists richer role hierarchies as missing."),
        src: ["welcome-discord", "spec"],
      },
      threadsForums: {
        status: "partial",
        note: gt("Threads in Element Web and Element Classic, but only behind an experimental Labs flag in Element X. No forum channels."),
        src: ["elementx-update", "welcome-discord"],
      },
      onboarding: {
        status: "partial",
        note: gt("Ask-to-join rooms and a curated room directory on matrix.org, but no onboarding questions or rules screening in Element."),
        src: ["crossroads"],
      },
      modTools: {
        status: "partial",
        note: gt("Power levels, bans, message removal, server ACLs, ban-list bots such as Draupnir and experimental policy servers. Tools per room are weaker than Discord's, and federation makes spam cleanup slow."),
        src: ["safer-matrix", "welcome-discord"],
      },
      platformSafety: {
        status: "partial",
        note: gt("The Foundation handles reports for matrix.org, publishes law-enforcement guidelines and scans unencrypted public media for child abuse material through Cloudflare. We found no numeric transparency report. Each homeserver moderates its own users."),
        src: ["safer-matrix", "law-enforcement", "terms-update"],
      },
      voiceChannels: {
        status: "partial",
        value: gt("Experimental only"),
        note: gt("Video rooms exist only as experimental Labs flags in Element Web. In February 2026 the Foundation listed voice channels as missing compared with Discord."),
        src: ["element-web", "welcome-discord"],
      },
      videoScreen: {
        status: "yes",
        note: gt("Element Call does group video calls and screen sharing, with resolution and frame-rate settings."),
        src: ["element-call"],
      },
      streamingStage: {
        status: "no",
        note: gt("No game streaming or Stage-style channels, per the Foundation's own February 2026 list of gaps."),
        src: ["welcome-discord"],
      },
      botApi: {
        status: "yes",
        note: gt("Bots use the open client-server API and bridges use the Application Service API, with SDKs in many languages. Incoming webhooks come from bots such as matrix-hookshot."),
        src: ["spec"],
      },
      discordBots: {
        status: "no",
        value: gt("Different API"),
        note: gt("Matrix bots use Matrix's own API, so Discord bots have to be rewritten."),
        src: ["spec"],
      },
      discordMigration: {
        status: "partial",
        value: gt("Bridges only"),
        note: gt("Community bridges such as mautrix-discord link Discord and Matrix rooms. There is no server importer, and mautrix warns that Discord may ban accounts it finds suspicious."),
        src: ["discord-bridges", "mautrix-discord"],
      },
      desktop: {
        status: "yes",
        note: gt("Element Desktop for Windows, macOS and Linux, plus many third-party clients."),
        src: ["element-download"],
      },
      mobile: {
        status: "yes",
        note: gt("Element X and Element Classic on Android (Google Play and F-Droid) and iOS. Element X needs iOS 18.5 or newer."),
        src: ["element-download", "elementx-appstore"],
      },
      web: {
        status: "yes",
        src: ["element-download"],
      },
      license: {
        status: "yes",
        value: gt("AGPL-3.0, mostly"),
        note: gt("Synapse, the Element apps and Element Call are AGPL-3.0, with a contributor agreement that lets Element also sell commercial licenses. Synapse moved from Apache-2.0 in November 2023. The spec is open."),
        src: ["agpl", "synapse", "spec"],
      },
      selfHost: {
        status: "yes",
        note: gt("You can run Synapse or another homeserver yourself, and Element's free ESS Community package gives a supported install path. Big servers need real resources: matrix.org's database is about 51 TB."),
        src: ["ess", "synapse", "outage"],
      },
      federation: {
        status: "yes",
        note: gt("Federation means any homeserver can talk to any other. Rooms are copied across every participating server, so no single company owns a room."),
        src: ["spec"],
      },
      uploads: {
        value: gt("10 MB on matrix.org"),
        note: gt("Free matrix.org accounts get 10 MB per file and 100 MB a day; Premium raises that to 100 MB per file. Self-hosted Synapse defaults to 50 MB, and admins can change it."),
        src: ["hs-pricing", "synapse-config"],
      },
      groupSize: {
        status: "unknown",
        note: gt("We couldn't verify a documented room size limit. Very large rooms are slow to join because room state is copied to each server."),
      },
      scale: {
        value: gt("111M+ accounts (2023)"),
        note: gt("In September 2023 the Foundation counted about 111.9 million Matrix IDs on 64,256 reporting servers. These are registered accounts, not active users, and we found no newer figure; Element's claim of 200M+ users is unverified marketing."),
        src: ["matrix2", "element-home"],
      },
      incidents: {
        value: gt("24-hour outage in 2025"),
        note: gt("matrix.org was down for about 24 hours in September 2025 after a disk failure and a delete command run on the wrong server; it was restored from backups without data loss. The Foundation warned of funding trouble in February 2025 and retired its Slack bridge in January 2026. An older breach in April 2019 exposed unencrypted messages on matrix.org."),
        src: ["outage", "crossroads", "slack-bridge", "breach-2019"],
      },
    },
    whyUs: [
      {
        title: gt("Voice channels and screen sharing built in"),
        text: gt("In February 2026 the Matrix.org Foundation said Matrix has no production-ready Discord alternative yet, listing voice channels and streaming as missing. SerikaCord has drop-in voice channels and screen sharing up to 60 FPS. Our calls connect peer-to-peer where possible, so others in a call can see your IP address, and server voice channels aren't end-to-end encrypted."),
        src: ["welcome-discord"],
      },
      {
        title: gt("Discord-style roles, onboarding and moderation"),
        text: gt("SerikaCord has named roles with per-channel permission overrides, onboarding questions, rules screening, AutoMod, an audit log and timeouts. Matrix rooms use numeric power levels, and the Foundation itself lists richer role hierarchies as missing."),
        src: ["welcome-discord", "spec"],
      },
      {
        title: gt("One consistent app"),
        text: gt("On Matrix, what you get depends on your client and your homeserver: Element Classic, Element X and dozens of other apps differ, and in November 2025 Element X still showed spaces read-only and hid threads behind an experimental flag. SerikaCord is one app that works the same on web, desktop and Android."),
        src: ["elementx-update"],
      },
      {
        title: gt("No homeserver to choose"),
        text: gt("With Matrix you first pick a homeserver, and its rules become yours: matrix.org is 18+, requires a verified email and allows 10 MB uploads on the free tier. On SerikaCord you sign up and go; it is 16+ and allows 500 MB per file."),
        src: ["terms-update", "hs-pricing"],
      },
      {
        title: gt("Your Discord bots can come along"),
        text: gt("SerikaCord's bot API follows Discord's API v10, so many discord.js and discord.py bots run after changing the API address, and our Discord bridge asks each member for consent. Matrix bots use a different API, and the main Discord bridge can log in as your own Discord account, which its docs warn Discord may ban."),
        src: ["mautrix-discord"],
      },
    ],
    whyThem: [
      {
        title: gt("An open network nobody owns"),
        text: gt("Matrix is an open standard with federation: any server can talk to any other, and no company can lock you in or delete your community. SerikaCord is one central service, and self-hosted copies don't connect to it."),
        src: ["spec", "matrix-home"],
      },
      {
        title: gt("Real open source and full self-hosting"),
        text: gt("Synapse, Element and Element Call are AGPL-3.0, so you can run them for anyone, including at work, as long as you share your changes. SerikaCord is source-available, not open source, and allows self-hosting only for personal, non-commercial use."),
        src: ["agpl", "ess"],
      },
      {
        title: gt("Older, partly audited encryption that reaches further"),
        text: gt("Matrix has encrypted DMs and private rooms by default since 2020, including private community rooms and group calls, and Least Authority audited its vodozemac library in 2022. SerikaCord's encryption launched in October 2026, hasn't been audited and doesn't cover server channels."),
        src: ["e2ee-default", "least-authority", "element-call"],
      },
      {
        title: gt("Bridges to other networks"),
        text: gt("Matrix has the widest set of bridges, linking it to IRC, XMPP, Discord and more, so one account can reach people on other networks. SerikaCord only bridges to Discord."),
        src: ["discord-bridges", "crossroads"],
      },
      {
        title: gt("A long, open track record"),
        text: gt("Matrix has run since 2014, is used by governments and large organizations, and publishes detailed post-mortems and its finances. SerikaCord has existed since January 2026 and has no comparable record."),
        src: ["element-home", "outage", "annual-report"],
      },
      {
        title: gt("A native iPhone app"),
        text: gt("Element X and Element Classic are in the App Store. SerikaCord's iPhone app is still in development, so iPhone users use the web app for now."),
        src: ["elementx-appstore"],
      },
    ],
    pickThem: [
      gt("you want an open, federated network that no single company controls"),
      gt("you need to self-host for an organization or use the software commercially"),
      gt("you want encrypted private community rooms, not just encrypted DMs"),
      gt("you need to bridge several chat networks into one place"),
    ],
    pickUs: [
      gt("you want a Discord-style community with drop-in voice channels, named roles and onboarding"),
      gt("you want one consistent app instead of choosing a homeserver and a client"),
      gt("you run Discord bots and want them to work with small changes"),
      gt("you are 16 or 17 and the homeserver you'd use is 18+"),
    ],
    faq: [
      {
        question: gt("What is the difference between Matrix and Element?"),
        answer: gt("Matrix is the open protocol and network, kept by the Matrix.org Foundation. Element is the most popular app for it, made by the company Element. You can use other apps, such as Cinny, FluffyChat, Sable or Commet, with the same Matrix account."),
      },
      {
        question: gt("Is Matrix end-to-end encrypted?"),
        answer: gt("Yes, for direct messages and private rooms by default since 2020, and Element Call encrypts calls. Public rooms are usually not encrypted, and your homeserver can still see metadata such as who talks to whom and when."),
      },
      {
        question: gt("Is Matrix a good Discord replacement?"),
        answer: gt("Not fully, by its own maintainers' account. In February 2026 the Matrix.org Foundation wrote that Matrix lacks real voice channels, game streaming and Discord-style roles, and that Element X still has gaps."),
      },
      {
        question: gt("Is Matrix open source, and can I self-host it?"),
        answer: gt("Yes. The main server, Synapse, and the Element apps are AGPL-3.0, and you can run your own homeserver that federates with everyone else. Large servers need a lot of resources and real admin work."),
      },
      {
        question: gt("Can I move my Discord server to Matrix?"),
        answer: gt("There is no importer, but community bridges such as mautrix-discord can link Discord channels to Matrix rooms. Its docs warn that Discord may ban accounts it finds suspicious, and Discord bots have to be rewritten for Matrix."),
      },
      {
        question: gt("Do I have to be 18 to use Matrix?"),
        answer: gt("On the matrix.org homeserver, yes, since July 2025. Other homeservers set their own minimum age. SerikaCord is 16 and over."),
      },
      {
        question: gt("Has matrix.org been hacked?"),
        answer: gt("Yes, in April 2019 attackers got into matrix.org through an outdated server and exposed unencrypted messages, password hashes and login tokens; end-to-end encrypted messages stayed safe and everyone was logged out. matrix.org also had a 24-hour outage in September 2025, restored without data loss."),
      },
      {
        question: gt("Can I host SerikaCord myself?"),
        answer: gt("Yes, but only for personal, non-commercial use for you and people you invite, free for them and not open to public sign-up; commercial use needs a license from partners@serika.dev. Self-hosted instances don't connect to serika.chat, there is no official setup guide or support, and SerikaCord is not open source."),
      },
    ],
    couldNotVerify: [
      gt("The price of matrix.org Premium accounts and of Element's business plans."),
      gt("Any Matrix-wide user numbers newer than September 2023, or active-user figures at all."),
      gt("Whether matrix.org has started mandatory ID or face checks for UK users; primary sources only describe self-declaration and planned measures."),
      gt("How far Element X has caught up with Element Classic on spaces and threads since November 2025."),
      gt("Whether any Discord bridge can copy a server's full message history."),
    ],
    notes: {
      title: gt("Matrix is a network, not one app"),
      intro: gt("Much of what people say about Matrix is really about one server or one app. These are the three layers:"),
      points: [
        gt("The protocol: Matrix itself is an open standard kept by the Matrix.org Foundation, a UK nonprofit. Anyone can build servers and apps for it."),
        gt("The homeserver: your account lives on a server you choose. matrix.org is the largest public one, and its rules (18+, verified email, 10 MB free uploads) don't apply on other servers or on your own."),
        gt("The app: Element is the main client, made by the company Element, which now focuses on governments and businesses. Element X is its newer mobile app and Element Classic the older one. Other clients, including the Discord-style Sable and Commet, work with the same account."),
        gt("Unless a cell says otherwise, this page describes Matrix as most people meet it: Element on the matrix.org homeserver."),
      ],
      src: ["foundation-about", "terms-update", "elementx-update", "element-home"],
    },
  };
}

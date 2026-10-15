import { getGT } from "gt-next/server";
import type { AppContent, CompareSource } from "../types";

/**
 * SerikaCord vs Rocket.Chat. Facts checked on COMPARE_LAST_CHECKED_ISO
 * against the sources below (titles and publishers are proper names, not
 * translated).
 */

export const sources: CompareSource[] = [
  { id: "home", title: "Rocket.Chat homepage (Secure CommsOS)", url: "https://www.rocket.chat", publisher: "Rocket.Chat", kind: "primary" },
  { id: "pricing", title: "Rocket.Chat pricing (Commercial, Government, Defense)", url: "https://www.rocket.chat/pricing", publisher: "Rocket.Chat", kind: "primary" },
  { id: "get-started", title: "Get started with Rocket.Chat (Starter plan)", url: "https://www.rocket.chat/get-started", publisher: "Rocket.Chat", kind: "primary" },
  { id: "plans", title: "Rocket.Chat docs: Our plans", url: "https://docs.rocket.chat/docs/our-plans", publisher: "Rocket.Chat", kind: "primary" },
  { id: "fair-use", title: "Rocket.Chat Fair Use page (older plan limits)", url: "https://www.rocket.chat/contact-sales-fair-use", publisher: "Rocket.Chat", kind: "primary" },
  {
    id: "forum-starter",
    title: "Introducing the Starter plan: free access to premium features for limited-scale use",
    url: "https://forums.rocket.chat/t/introducing-the-starter-plan-free-access-to-premium-features-for-limited-scale-use/18736",
    publisher: "Rocket.Chat Forums",
    kind: "primary",
    date: "2023-12-01",
  },
  { id: "rc70", title: "Rocket.Chat 7.0 brings AI, integrated VoIP and an extended Starter plan", url: "https://de.rocket.chat/blog/introducing-rocket-chat-7-0", publisher: "Rocket.Chat", kind: "primary", date: "2024-11" },
  { id: "rc711", title: "Product Roundup: What's new in Rocket.Chat 7.11", url: "https://de.rocket.chat/blog/product-roundup-whats-new-in-rocket-chat-7-11", publisher: "Rocket.Chat", kind: "primary", date: "2025-10" },
  {
    id: "matrix-blog",
    title: "Delivering Matrix federation as a built-in standard",
    url: "https://www.rocket.chat/blog/delivering-matrix-federation-as-a-built-in-standard",
    publisher: "Rocket.Chat",
    kind: "primary",
    date: "2026-07-14",
  },
  { id: "federation-docs", title: "Federation architecture and capabilities", url: "https://docs.rocket.chat/docs/federation-architecture-and-capabilities", publisher: "Rocket.Chat", kind: "primary" },
  { id: "github", title: "RocketChat/Rocket.Chat source code and README", url: "https://github.com/RocketChat/Rocket.Chat", publisher: "GitHub", kind: "primary" },
  { id: "license", title: "Rocket.Chat LICENSE", url: "https://github.com/RocketChat/Rocket.Chat/blob/develop/LICENSE", publisher: "GitHub", kind: "primary" },
  { id: "ee-license", title: "Rocket.Chat Enterprise Edition (EE) License", url: "https://github.com/RocketChat/Rocket.Chat/blob/develop/apps/meteor/ee/LICENSE", publisher: "GitHub", kind: "primary" },
  { id: "releases", title: "Rocket.Chat releases (8.9.0 LTS, 8.8.0, 8.0.0, 7.0.0)", url: "https://github.com/RocketChat/Rocket.Chat/releases", publisher: "GitHub", kind: "primary" },
  { id: "rc88", title: "Rocket.Chat 8.8.0 release notes", url: "https://github.com/RocketChat/Rocket.Chat/releases/tag/8.8.0", publisher: "GitHub", kind: "primary", date: "2026-09-01" },
  {
    id: "upload-settings",
    title: "Rocket.Chat file upload settings (default maximum file size)",
    url: "https://github.com/RocketChat/Rocket.Chat/blob/develop/apps/meteor/server/settings/file-upload.ts",
    publisher: "GitHub",
    kind: "primary",
  },
  { id: "e2ee-spec", title: "End-to-End Encryption Specifications", url: "https://docs.rocket.chat/docs/end-to-end-encryption-specifications", publisher: "Rocket.Chat", kind: "primary" },
  { id: "e2ee-guide", title: "End-to-End Encryption User Guide", url: "https://docs.rocket.chat/docs/end-to-end-encryption-user-guide", publisher: "Rocket.Chat", kind: "primary" },
  { id: "e2ee-admin", title: "E2E Encryption admin settings", url: "https://docs.rocket.chat/docs/e2e-encryption", publisher: "Rocket.Chat", kind: "primary" },
  { id: "conference", title: "Conference call (video apps)", url: "https://docs.rocket.chat/docs/conference-call", publisher: "Rocket.Chat", kind: "primary" },
  { id: "push-faq", title: "Push Notifications FAQ", url: "https://docs.rocket.chat/docs/push-notifications-faq", publisher: "Rocket.Chat", kind: "primary" },
  { id: "apps-faq", title: "Rocket.Chat Apps FAQ (app limits)", url: "https://docs.rocket.chat/docs/rocketchat-apps-faq", publisher: "Rocket.Chat", kind: "primary" },
  { id: "apps-engine", title: "Rocket.Chat Apps-Engine developer docs", url: "https://developer.rocket.chat/docs/rocketchat-apps-engine", publisher: "Rocket.Chat", kind: "primary" },
  {
    id: "deprecation",
    title: "Deprecation notice: cloud services, mobile and desktop apps for legacy unsupported versions",
    url: "https://www.rocket.chat/blog/deprecation-notice-cloud-services-mobile-and-desktop-apps-for-legacy-unsupported-versions",
    publisher: "Rocket.Chat",
    kind: "primary",
    date: "2023-10-31",
  },
  { id: "privacy", title: "Rocket.Chat Privacy Policy", url: "https://docs.rocket.chat/legal/privacy", publisher: "Rocket.Chat", kind: "primary" },
  { id: "about", title: "About Rocket.Chat", url: "https://www.rocket.chat/about", publisher: "Rocket.Chat", kind: "primary" },
  { id: "ios", title: "Rocket.Chat on the App Store", url: "https://apps.apple.com/us/app/rocket-chat/id1148741252", publisher: "Apple", kind: "primary" },
  { id: "macos", title: "Rocket.Chat desktop app on the Mac App Store", url: "https://apps.apple.com/app/rocket-chat/id1086818840", publisher: "Apple", kind: "primary" },
  {
    id: "aws",
    title: "Rocket.Chat Secure CommsOS listed in AWS Marketplace for the U.S. Intelligence Community",
    url: "https://de.rocket.chat/press-releases/rocket-chat-secure-commsos-listed-in-aws-icmp",
    publisher: "Rocket.Chat",
    kind: "primary",
    date: "2026-03-03",
  },
  { id: "endoflife", title: "Rocket.Chat release and support dates", url: "https://endoflife.date/rocket-chat", publisher: "endoflife.date", kind: "secondary" },
  { id: "wikipedia", title: "Rocket.Chat", url: "https://en.wikipedia.org/wiki/Rocket.Chat", publisher: "Wikipedia", kind: "secondary" },
  {
    id: "gravity-paper",
    title: "Gravity of the Situation: Security Analysis on Rocket.Chat E2EE (ACSAC 2025)",
    url: "https://eprint.iacr.org/2025/2300",
    publisher: "IACR ePrint",
    kind: "secondary",
    date: "2025",
  },
  { id: "gravity-site", title: "Gravity of the Situation: disclosure timeline and fix status", url: "https://gravity-of-the-situation-rc.github.io/", publisher: "Gravity of the Situation", kind: "secondary" },
  {
    id: "eth",
    title: "Breaking Cryptography in the Wild: Rocket.Chat (ETH Zurich thesis)",
    url: "https://discuss.privacyguides.net/t/breaking-cryptography-in-the-wild-rocket-chat/28537",
    publisher: "Privacy Guides",
    kind: "secondary",
    date: "2025-06-22",
  },
  { id: "sonar", title: "NoSQL injections in Rocket.Chat (CVE-2021-22911)", url: "https://blog.sonarsource.com/nosql-injections-in-rocket-chat", publisher: "SonarSource", kind: "secondary", date: "2021" },
  { id: "cve-2023-23911", title: "CVE-2023-23911", url: "https://www.opencve.io/cve/CVE-2023-23911", publisher: "OpenCVE", kind: "secondary", date: "2023" },
  { id: "cve-28514", title: "CVE-2026-28514", url: "https://vulnerability.circl.lu/vuln/CVE-2026-28514", publisher: "CIRCL", kind: "secondary", date: "2026-03-06" },
  {
    id: "cve-29198",
    title: "CVE-2026-29198: Rocket.Chat NoSQL injection leading to account takeover",
    url: "https://cve.halosecurity.com/cve-advisory/cve-2026-29198-rocket-chat-nosql-injection-leading-to-account-takeover",
    publisher: "Halo Security",
    kind: "secondary",
    date: "2026",
  },
  {
    id: "cve-32995",
    title: "CVE-2026-32995: Rocket.Chat auto-translate IDOR",
    url: "https://researcher.branch.zeropath.com/blog/cve-2026-32995-rocketchat-autotranslate-idor",
    publisher: "ZeroPath",
    kind: "secondary",
    date: "2026-05-27",
  },
  { id: "cve-55666", title: "CVE-2026-55666", url: "https://app.opencve.io/cve/CVE-2026-55666", publisher: "OpenCVE", kind: "secondary", date: "2026-06-24" },
  { id: "pricingsaas", title: "Rocket.Chat pricing page changes, week 42 2026", url: "https://pricingsaas.com/companies/rocketchat/diffs/2026W42", publisher: "PricingSaaS", kind: "secondary", date: "2026-10" },
  { id: "seedtable", title: "Rocket.Chat funding round (February 2021)", url: "https://seedtable.com/companies/rocketchat/funding-rounds/series-a-2021-02", publisher: "Seedtable", kind: "secondary", date: "2021-02" },
  { id: "signalbase", title: "Rocket.Chat raises $10M", url: "https://www.trysignalbase.com/news/funding/rocketchat-raises-100m", publisher: "Signalbase", kind: "secondary", date: "2023-09-21" },
];

export async function content(): Promise<AppContent> {
  const gt = await getGT();
  return {
    take: gt("Mature, self-hostable team chat for organizations, with SSO, compliance tools and Matrix federation. But key features are paid with no public prices, its opt-in encryption has had serious flaws, and it isn't for public communities."),
    intro: [
      gt("Rocket.Chat is team chat software, made since 2015 by a US company and now sold mainly to governments, defense and regulated businesses as ‘Secure CommsOS’. Organizations run it on their own servers, even fully offline, with single sign-on, compliance features, customer-service inboxes and federation with Matrix."),
      gt("SerikaCord is built for public communities: servers people join, drop-in voice channels, Discord-compatible bots and a hosted app you don't have to run. Rocket.Chat wins for organizations that need to host and control their own chat; SerikaCord fits better for gaming, hobby and creator communities, though both have encryption caveats."),
    ],
    verdict: gt("If you are an organization that must run chat on its own servers, with SSO and compliance, Rocket.Chat is built for that. If you want a public community with voice channels and Discord-style bots without running a server, pick SerikaCord."),
    facts: {
      operator: {
        value: gt("Rocket.Chat Technologies Corp."),
        note: gt("A venture-backed private company that started in 2015, led by co-founder and CEO Gabriel Engel. Disclosed funding is about $29 million, from a $19 million round in 2021 and $10 million in 2023."),
        src: ["about", "wikipedia", "seedtable", "signalbase"],
      },
      jurisdiction: {
        value: gt("United States"),
        note: gt("A Delaware corporation with engineering roots in Porto Alegre, Brazil, working fully remote. Self-hosted workspaces keep data wherever they are run."),
        src: ["about", "privacy"],
      },
      businessModel: {
        value: gt("Open core, enterprise sales"),
        note: gt("The core is MIT-licensed and the premium code is proprietary. Money comes from custom-quoted Commercial, Government and Defense plans and paid add-ons."),
        src: ["license", "ee-license", "pricing"],
      },
      ads: {
        status: "no",
        value: gt("No ads"),
        src: ["privacy"],
      },
      pricing: {
        value: gt("Free up to 50 users; no public prices"),
        note: gt("The free Starter plan, introduced in December 2023, covers up to 50 users on your own server. Paid plans are quote-only, and the self-serve Pro plan was retired on 29 April 2026."),
        src: ["get-started", "forum-starter", "pricing", "plans", "pricingsaas"],
      },
      maturity: {
        status: "yes",
        value: gt("Since 2015"),
        note: gt("Monthly releases, with 6 months of support for standard versions and 12 for long-term ones. Version 8.9.0 LTS came out on 5 October 2026."),
        src: ["releases", "endoflife"],
      },
      e2eeDms: {
        status: "partial",
        value: gt("Opt-in, set by the admin"),
        note: gt("The workspace admin must enable it, and encrypting DMs by default is off by default. It uses a custom design (RSA and AES) in which researchers found serious flaws; see below."),
        src: ["e2ee-admin", "e2ee-spec", "gravity-paper"],
      },
      e2eeGroups: {
        status: "partial",
        value: gt("Private rooms only"),
        note: gt("Private channels, teams and discussions can be encrypted; public channels can't. Since 8.8.0 admins can force encryption on new private rooms."),
        src: ["e2ee-guide", "rc88"],
      },
      e2eeCalls: {
        status: "no",
        value: gt("Not claimed"),
        note: gt("We found no end-to-end encryption claim for Rocket.Chat's own calls. Video meetings usually run through apps like Jitsi, with their own encryption."),
        src: ["conference"],
      },
      e2eeCommunity: {
        status: "no",
        note: gt("Public channels can't be encrypted, and federated rooms don't support encryption."),
        src: ["e2ee-guide", "federation-docs"],
      },
      e2eeDefault: {
        status: "no",
        note: gt("Off unless the workspace admin turns it on."),
        src: ["e2ee-admin"],
      },
      audit: {
        status: "no",
        value: gt("Academic breaks, no vendor audit"),
        note: gt("We found no public audit commissioned by Rocket.Chat. An ETH Zurich thesis (2025) and a paper at ACSAC 2025 found serious flaws; most are fixed, but the researchers list one as still unfixed."),
        src: ["eth", "gravity-paper", "gravity-site"],
      },
      metadata: {
        value: gt("The operator sees everything"),
        note: gt("Whoever runs the workspace can read everything that isn't encrypted. Push notifications through Rocket.Chat's gateway include message content by default; hiding it needs a premium plan."),
        src: ["push-faq", "privacy"],
      },
      dataUse: {
        status: "partial",
        value: gt("Doesn't sell data"),
        note: gt("Rocket.Chat says it doesn't access self-hosted content unless you use its cloud services, and doesn't sell personal data. Its website and cloud use Google Analytics and Firebase, and registered workspaces send usage statistics."),
        src: ["privacy"],
      },
      phone: {
        status: "no",
        value: gt("Not by default"),
        note: gt("Each workspace's operator decides what sign-up asks for."),
        src: ["github"],
      },
      email: {
        status: "partial",
        value: gt("Up to the workspace"),
        note: gt("Usually an email and username, or a company single sign-on account. This depends on each workspace."),
        src: ["github"],
      },
      ageChecks: {
        status: "no",
        value: gt("None built in"),
        note: gt("It is business software, so any age rules are up to each workspace's operator. We couldn't find a minimum age in Rocket.Chat's terms."),
      },
      servers: {
        status: "partial",
        value: gt("One workspace per install"),
        note: gt("Each installation is one organization's workspace with channels and teams; there are no servers to discover and join. The apps can connect to several workspaces."),
        src: ["github"],
      },
      roles: {
        status: "yes",
        note: gt("Role-based permissions with fine-grained settings; attribute-based access and classification banners on premium plans."),
        src: ["github", "pricing"],
      },
      threadsForums: {
        status: "partial",
        value: gt("Threads, no forums"),
        note: gt("Threads and ‘discussions’, which are sub-rooms started from a message. No forum channel type."),
        src: ["github"],
      },
      onboarding: {
        status: "no",
        note: gt("A setup wizard and default channels, but no community onboarding or rules screening."),
      },
      modTools: {
        status: "partial",
        note: gt("Permissions, read-only rooms and message retention rules. Audit logs, data loss prevention and read receipts are premium. We found no AutoMod-style tools."),
        src: ["plans"],
      },
      platformSafety: {
        status: "partial",
        value: gt("Up to each workspace"),
        note: gt("Each organization moderates its own workspace. We found no transparency report from the company."),
        src: ["privacy"],
      },
      voiceChannels: {
        status: "no",
        note: gt("No drop-in voice channels; only calls you start."),
        src: ["rc711"],
      },
      videoScreen: {
        status: "partial",
        note: gt("Built-in peer-to-peer voice calls since October 2025, with screen sharing since 8.8.0 (September 2026). Video meetings mostly run through Jitsi, Pexip, BigBlueButton or Google Meet, and phone (SIP) calling is a paid add-on."),
        src: ["rc711", "rc88", "conference", "rc70"],
      },
      streamingStage: {
        status: "no",
        note: gt("No live streaming or Stage-style events."),
      },
      botApi: {
        status: "yes",
        note: gt("Bot users, a REST API, webhooks and the Apps-Engine for apps with slash commands. The free Community build allows 5 marketplace apps and no private apps."),
        src: ["apps-engine", "apps-faq"],
      },
      discordBots: { status: "no", note: gt("Rocket.Chat's bot APIs are its own.") },
      discordMigration: {
        status: "no",
        note: gt("Built-in importers cover Slack and CSV files. There is no Discord importer or bridge."),
        src: ["github"],
      },
      desktop: {
        status: "yes",
        note: gt("Windows, macOS 12 or newer and Linux."),
        src: ["macos", "github"],
      },
      mobile: {
        status: "yes",
        note: gt("Android and iPhone from the app stores; the iPhone app is rated 4.4 from about 3,700 ratings. The official apps only work with server versions still in support."),
        src: ["ios", "deprecation"],
      },
      web: {
        status: "yes",
        note: gt("Every workspace has a web app."),
        src: ["github"],
      },
      license: {
        status: "partial",
        value: gt("MIT core plus proprietary code"),
        note: gt("Most of the code is MIT-licensed, but the ‘ee’ folders are under a proprietary license that requires a paid subscription for production use."),
        src: ["license", "ee-license"],
      },
      selfHost: {
        status: "yes",
        value: gt("Yes, with strings attached"),
        note: gt("Runs on Docker or Kubernetes. Offline installs need a paid license, push notifications for the official apps need registration with Rocket.Chat's cloud, and LDAP, SAML and custom OAuth sign-in will need a license from version 9.0."),
        src: ["rc70", "push-faq", "rc88"],
      },
      federation: {
        status: "partial",
        value: gt("Matrix, licensed"),
        note: gt("Matrix federation built into the server arrived as an alpha in October 2025; the company called it production-grade in July 2026, while its docs still describe final tuning. It is a paid feature, and encryption and calls don't work in federated rooms."),
        src: ["rc711", "matrix-blog", "federation-docs"],
      },
      uploads: {
        value: gt("100 MB by default"),
        note: gt("The workspace admin can raise or remove the limit."),
        src: ["upload-settings"],
      },
      groupSize: {
        value: gt("Set by plan and server"),
        note: gt("Starter allows 50 users. The unlicensed Community build is limited to 100 concurrent users per current docs; older pages said 200."),
        src: ["plans", "fair-use"],
      },
      scale: {
        status: "partial",
        value: gt("‘12M+ users’ (self-reported)"),
        note: gt("Rocket.Chat claims over 12 million users in more than 150 countries; its README says tens of millions. Neither is independently verified. About 46,000 GitHub stars."),
        src: ["about", "github"],
      },
      incidents: {
        value: gt("Several critical 2026 flaws"),
        note: gt("Critical 2026 flaws included a login bypass (CVE-2026-28514, fixed in 8.0.0 and backports), an admin takeover via OAuth (CVE-2026-29198, fixed in 8.3.0), private message leaks via auto-translate (CVE-2026-32995, fixed in 8.5.0) and an Apple sign-in takeover (CVE-2026-55666, fixed in 8.5.1)."),
        src: ["cve-28514", "cve-29198", "cve-32995", "cve-55666"],
      },
    },
    whyUs: [
      {
        title: gt("Made for public communities"),
        text: gt("On SerikaCord anyone can create a server and invite people from one account, with onboarding, rules screening and AutoMod. Rocket.Chat is one organization's workspace, with no public servers to discover and no community onboarding."),
        src: ["github"],
      },
      {
        title: gt("Drop-in voice channels and screen sharing"),
        text: gt("SerikaCord has voice channels people can hang out in, with screen sharing up to 60 FPS. Rocket.Chat has calls you start and leans on Jitsi or other apps for video meetings. Our server voice channels are not end-to-end encrypted, and calls are peer-to-peer where possible, so others can see your IP address."),
        src: ["conference", "rc711"],
      },
      {
        title: gt("Discord bots and a Discord bridge"),
        text: gt("SerikaCord's bot API follows Discord's API v10, so many discord.js and discord.py bots run after changing one address, and a consent-based bridge mirrors a Discord server. Rocket.Chat's APIs are its own and it has no Discord importer."),
        src: ["apps-engine"],
      },
      {
        title: gt("Nothing to install or keep patched"),
        text: gt("SerikaCord is a hosted service with a free tier for everyone. Running Rocket.Chat yourself means following monthly releases and patching several critical flaws found in 2026, and versions that fall out of support lose the official apps and push notifications."),
        src: ["deprecation", "cve-28514", "cve-55666"],
      },
      {
        title: gt("Encrypted DMs on by default"),
        text: gt("SerikaCord encrypts new DMs and group DMs by default, with safety numbers to check who you're talking to. Rocket.Chat's encryption is opt-in and researchers found serious flaws in it. Ours is new and hasn't been audited either, so treat neither as proven."),
        src: ["e2ee-admin", "gravity-site"],
      },
    ],
    whyThem: [
      {
        title: gt("You can run it entirely yourself"),
        text: gt("Rocket.Chat runs on your own servers with Docker or Kubernetes, and with a license even fully offline. SerikaCord can only be self-hosted for personal, non-commercial use, without official setup guides or support."),
        src: ["github", "rc70"],
      },
      {
        title: gt("Built for organizations"),
        text: gt("Single sign-on, detailed permissions, retention rules, audit logs, customer-service inboxes for WhatsApp and other channels, and government and defense certifications on premium plans. SerikaCord isn't built for company compliance needs."),
        src: ["pricing", "aws", "plans"],
      },
      {
        title: gt("Federation with Matrix"),
        text: gt("Rocket.Chat can talk to Matrix servers directly, as a licensed feature, and has an XMPP bridge. SerikaCord is one central service with no federation."),
        src: ["matrix-blog", "federation-docs", "home"],
      },
      {
        title: gt("A mature product with a long track record"),
        text: gt("Rocket.Chat has been developed since 2015, has around 46,000 GitHub stars and publishes clear support windows for each version. SerikaCord launched in January 2026."),
        src: ["github", "endoflife"],
      },
      {
        title: gt("Mostly open source, with native apps everywhere"),
        text: gt("Rocket.Chat's core is MIT-licensed, and it has apps for web, Windows, macOS, Linux, Android and iPhone. SerikaCord is source-available, not open source, and has no iPhone app yet."),
        src: ["license", "ios"],
      },
    ],
    pickThem: [
      gt("you're an organization that must keep chat on its own servers"),
      gt("you need single sign-on, compliance tools or offline deployment"),
      gt("you want to federate with Matrix"),
      gt("you need an iPhone app today"),
    ],
    pickUs: [
      gt("you're building a public community, not a company workspace"),
      gt("you want drop-in voice channels"),
      gt("you rely on Discord bots or are moving a Discord server"),
      gt("you don't want to run and patch a server yourself"),
    ],
    faq: [
      {
        question: gt("Is Rocket.Chat end-to-end encrypted?"),
        answer: gt("Only if the workspace admin turns it on, and then only for DMs and private rooms; public channels and calls aren't covered. Researchers found serious flaws in its design in 2024 and 2025; most were fixed by version 7.13.0, but one weakness in checking other people's keys is listed as unfixed."),
      },
      {
        question: gt("Is Rocket.Chat open source?"),
        answer: gt("Partly. The core is MIT-licensed, but premium features live in folders under a proprietary license that needs a paid subscription for production use."),
      },
      {
        question: gt("Is Rocket.Chat free?"),
        answer: gt("The Starter plan is free for up to 50 users on your own server, and the unlicensed Community build is free with limits. Paid plans have no public prices; you have to contact sales."),
      },
      {
        question: gt("Can I self-host Rocket.Chat?"),
        answer: gt("Yes, that is its main use. Push notifications for the official apps need registration with Rocket.Chat's cloud, offline installs need a license, and you have to keep up with security updates."),
      },
      {
        question: gt("Is Rocket.Chat safe?"),
        answer: gt("It is widely used by organizations, but it had several critical security flaws in 2026, including login bypasses and account takeovers, all fixed in recent versions. If you run it, update promptly."),
      },
      {
        question: gt("Can I move my Discord server to Rocket.Chat?"),
        answer: gt("There is no Discord importer or bridge; Rocket.Chat imports from Slack and CSV files. SerikaCord has a consent-based Discord bridge and a Discord-compatible bot API."),
      },
      {
        question: gt("Who makes Rocket.Chat?"),
        answer: gt("Rocket.Chat Technologies Corp., a venture-backed US company founded in 2015, which now focuses on government, defense and regulated industries."),
      },
    ],
    couldNotVerify: [
      gt("Any current price per user: there are no public prices."),
      gt("The Community build's concurrent user limit: current docs say 100, older pages say 200."),
      gt("Whether a self-serve hosted Rocket.Chat is still offered to small customers."),
      gt("Whether encryption covers thread replies and push notification content in every app."),
      gt("A minimum user age in Rocket.Chat's terms, or a law enforcement transparency report."),
    ],
    notes: {
      title: gt("Encryption research and 2026 security fixes"),
      intro: gt("Rocket.Chat is used where security matters, so its record here deserves detail."),
      points: [
        gt("An ETH Zurich master's thesis, discussed publicly in June 2025, found that Rocket.Chat's encryption gives no protection against a malicious server and that privileged users could read rooms they weren't in."),
        gt("The ‘Gravity of the Situation’ paper (ACSAC 2025, reported to Rocket.Chat in May 2024) found 6 vulnerabilities, including private key recovery (CVE-2024-42027) and message forgery. Fixes shipped in mobile 4.51.0, server 7.0 and server 7.13.0, but the researchers list the lack of public key verification as unfixed."),
        gt("CVE-2026-28514 (March 2026, severity 9.3) let anyone log in as any user who had a password, using any password, through one of the server's services; fixed in 8.0.0 and 7.x backports."),
        gt("CVE-2026-29198 (severity 9.8) allowed unauthenticated takeover of the first admin account through the OAuth flow; fixed in 8.3.0."),
        gt("CVE-2026-32995 (May 2026, severity 7.5) let any logged-in user read messages from private channels, DMs and even encrypted rooms through auto-translate; fixed in 8.5.0 and backports."),
        gt("CVE-2026-55666 (June 2026, severity 9.3) allowed account takeover through Apple sign-in; fixed in 8.5.1 and backports to 7.10.13."),
        gt("Older flaws include CVE-2021-22911, an unauthenticated injection that could lead to admin takeover (fixed in 2021), and CVE-2023-23911, which let an attacker break a room's encryption by changing its group key (fixed in version 6)."),
      ],
      src: ["eth", "gravity-paper", "gravity-site", "cve-28514", "cve-29198", "cve-32995", "cve-55666", "sonar", "cve-2023-23911"],
    },
  };
}

import { getGT } from "gt-next/server";
import type { AppContent, CompareSource } from "../types";

/**
 * SerikaCord vs Osmium (osmium.chat). Facts checked on
 * COMPARE_LAST_CHECKED_ISO against the sources below (titles and publishers
 * are proper names, not translated).
 */

export const sources: CompareSource[] = [
  { id: "home", title: "Osmium homepage", url: "https://osmium.chat", publisher: "Osmium", kind: "primary" },
  { id: "features", title: "Osmium features (availability list)", url: "https://osmium.chat/features/", publisher: "Osmium", kind: "primary" },
  { id: "download", title: "Download Osmium", url: "https://osmium.chat/download/", publisher: "Osmium", kind: "primary" },
  { id: "privacy", title: "Osmium Privacy Policy (last updated 10 February 2026)", url: "https://osmium.chat/privacy/", publisher: "Osmium", kind: "primary", date: "2026-02-10" },
  { id: "terms", title: "Osmium Terms of Service (last updated 10 February 2026)", url: "https://osmium.chat/terms/", publisher: "Osmium", kind: "primary", date: "2026-02-10" },
  { id: "blog-scale", title: "How we built Osmium for scale", url: "https://osmium.chat/blog/how-we-built-osmium-for-scale", publisher: "Osmium", kind: "primary", date: "2026-05-23" },
  {
    id: "discovery",
    title: "Community discovery, powered by top.gg",
    url: "https://osmium.chat/blog/community-discovery-powered-by-topgg",
    publisher: "Osmium",
    kind: "primary",
    date: "2026-05-29",
  },
  { id: "stop-killing", title: "Stop Killing the Internet!", url: "https://osmium.chat/blog/stop-killing-the-internet", publisher: "Osmium", kind: "primary", date: "2026-09-16" },
  { id: "api", title: "Osmium API documentation", url: "https://osmium.chat/docs/api", publisher: "Osmium", kind: "primary" },
  { id: "voice-docs", title: "Osmium docs: Voice & Video", url: "https://osmium.chat/docs/api/voice-video", publisher: "Osmium", kind: "primary" },
  { id: "files-docs", title: "Osmium docs: Downloading and Uploading Files", url: "https://osmium.chat/docs/api/files", publisher: "Osmium", kind: "primary" },
  { id: "github", title: "Osmium on GitHub (protocol, SDK, bot examples)", url: "https://github.com/osmiumchat", publisher: "GitHub", kind: "primary" },
  { id: "proto", title: "osmiumchat/proto (protocol definitions)", url: "https://github.com/osmiumchat/proto", publisher: "GitHub", kind: "primary" },
  { id: "nucleus", title: "Nucleus actor framework (MIT)", url: "https://github.com/osmiumchat/nucleus", publisher: "GitHub", kind: "primary" },
  { id: "x-launch", title: "Osmium early access launch post", url: "https://x.com/osmiumchat/status/2021291786489000236", publisher: "Osmium on X", kind: "primary", date: "2026-02-10" },
  { id: "appstore", title: "Osmium Chat on the App Store", url: "https://apps.apple.com/us/app/osmium-chat/id6770574724", publisher: "Apple", kind: "primary" },
  { id: "play", title: "Osmium on Google Play (developer Uncollapse LLC)", url: "https://play.google.com/store/apps/details?id=chat.osmium", publisher: "Google Play", kind: "primary" },
  { id: "uncollapse", title: "Uncollapse", url: "https://uncollapse.com", publisher: "Uncollapse", kind: "primary" },
  {
    id: "ripe",
    title: "AS214696 UNCOLLAPSE-AS, Uncollapse LLC (Albuquerque, New Mexico)",
    url: "https://stat.ripe.net/data/as-overview/data.json?resource=AS214696",
    publisher: "RIPE NCC",
    kind: "secondary",
  },
  { id: "alternativeto", title: "Osmium on AlternativeTo", url: "https://alternativeto.net/software/osmium-chat/about", publisher: "AlternativeTo", kind: "secondary", date: "2026-02-19" },
];

export async function content(): Promise<AppContent> {
  const gt = await getGT();
  return {
    take: gt("A fast, carefully engineered Discord-like app with an open protocol and apps on every platform. But it's in early access, moderation is thin, and despite one store listing, it has no end-to-end encryption yet."),
    intro: [
      gt("Osmium is a young Discord-style chat app that opened early access in February 2026. It is run by Uncollapse, a small self-funded company that hosts it on its own servers, and it stands out for solid engineering, a public protocol that lets anyone build bots or even their own client, and apps for every major platform."),
      gt("SerikaCord and Osmium are both young, ad-free and against ID checks. Osmium wins on iPhone and store apps, an open protocol and calls that don't expose your IP address to others; SerikaCord wins on end-to-end encrypted DMs that actually exist today, moderation tools, forums and onboarding, and Discord bot compatibility."),
    ],
    verdict: gt("For a small group that wants a fast, polished app on every device and likes to tinker, Osmium is a good fit. For a growing community that needs moderation tools, Discord bots or encrypted DMs, SerikaCord is further along."),
    facts: {
      operator: {
        value: gt("Uncollapse LLC"),
        note: gt("A small, self-funded company that says it doesn't want venture capital. It runs its own network and rents its own servers."),
        src: ["play", "uncollapse", "blog-scale"],
      },
      jurisdiction: {
        value: gt("US company, Dutch branding"),
        note: gt("Google Play and the RIPE network registry list Uncollapse LLC at an address in Albuquerque, New Mexico, USA. The terms use Dutch law and the site says it is made in the Netherlands. Server countries aren't disclosed."),
        src: ["play", "ripe", "terms", "home"],
      },
      businessModel: {
        value: gt("Optional Premium subscription"),
        note: gt("The core app is free. Premium is billed through a payment processor, and the protocol supports monthly, yearly and lifetime plans."),
        src: ["proto", "privacy"],
      },
      ads: {
        status: "no",
        value: gt("No ads"),
        src: ["home"],
      },
      pricing: {
        value: gt("Free; Premium optional"),
        note: gt("Premium is reported at about $6 or €6 a month, but the official site shows no price or list of perks."),
        src: ["alternativeto"],
      },
      maturity: {
        status: "partial",
        value: gt("Early access (v0.1)"),
        note: gt("Open to everyone since 10 February 2026 after more than two years of work. Desktop apps are v0.1.x, mobile apps are labeled beta, and mobile calls are described as an early alpha."),
        src: ["x-launch", "download", "appstore"],
      },
      e2eeDms: {
        status: "notyet",
        value: gt("Planned"),
        note: gt("The privacy policy says Osmium doesn't currently offer end-to-end encryption for messages, and the features page lists it as planned. The Google Play listing claims it anyway; see below."),
        src: ["privacy", "features", "play"],
      },
      e2eeGroups: {
        status: "no",
        note: gt("Not available."),
        src: ["privacy", "features"],
      },
      e2eeCalls: {
        status: "no",
        note: gt("Calls use standard encrypted WebRTC connections through Osmium's own voice servers, not end-to-end encryption. The policy says calls aren't recorded."),
        src: ["privacy", "voice-docs"],
      },
      e2eeCommunity: { status: "no", src: ["privacy"] },
      e2eeDefault: {
        status: "no",
        value: gt("No E2EE yet"),
        src: ["privacy"],
      },
      audit: {
        status: "no",
        note: gt("We found no published independent security audit."),
      },
      metadata: {
        value: gt("Osmium can read messages"),
        note: gt("The privacy policy says the company has technical access to message content. It also stores IP addresses, device details, country and call metadata."),
        src: ["privacy"],
      },
      dataUse: {
        status: "yes",
        value: gt("No selling, no tracking"),
        note: gt("Osmium says it doesn't sell personal data, uses only necessary cookies, doesn't fingerprint and doesn't scan messages with AI. Optional analytics need your consent."),
        src: ["privacy", "home"],
      },
      phone: {
        status: "no",
        value: gt("Not required"),
        src: ["privacy"],
      },
      email: {
        status: "yes",
        value: gt("Required"),
        src: ["privacy"],
      },
      ageChecks: {
        status: "no",
        value: gt("Self-declared"),
        note: gt("No ID or face scans. Minimum age 16 in the EU, elsewhere the local age of digital consent; the App Store rates it 13+. Osmium publicly opposes mandatory age verification."),
        src: ["terms", "appstore", "stop-killing"],
      },
      servers: {
        status: "yes",
        note: gt("Communities with text, voice and announcement channels and categories."),
        src: ["features", "proto"],
      },
      roles: {
        status: "yes",
        note: gt("Hierarchical roles, private roles and per-channel permission overrides."),
        src: ["features"],
      },
      threadsForums: {
        status: "notyet",
        value: gt("Forums planned"),
        note: gt("There are no threads in the protocol or on the roadmap. Forum channels are planned."),
        src: ["features", "proto"],
      },
      onboarding: {
        status: "no",
        note: gt("We found no rules screening or onboarding flow. Community discovery, run with top.gg, launched in beta in May 2026."),
        src: ["features", "discovery"],
      },
      modTools: {
        status: "partial",
        note: gt("Channel permissions, temporary bans and slowmode. Audit logs, raid protection, timeouts and moderator reports are listed as coming soon."),
        src: ["features"],
      },
      platformSafety: {
        status: "partial",
        note: gt("Uploads are checked against known child sexual abuse material. Ban appeals are planned, and there is no transparency report."),
        src: ["features", "privacy"],
      },
      voiceChannels: {
        status: "yes",
        note: gt("Runs on Osmium's own voice servers, built on WebRTC and Opus."),
        src: ["voice-docs", "blog-scale"],
      },
      videoScreen: {
        status: "yes",
        note: gt("Video calls and screen sharing with audio on all platforms. Video on mobile is an early alpha."),
        src: ["features", "appstore"],
      },
      streamingStage: {
        status: "partial",
        note: gt("Screen sharing only. We found no Go Live-style broadcasts or Stage channels."),
        src: ["features"],
      },
      botApi: {
        status: "yes",
        note: gt("A free public API with no approval needed, a JavaScript SDK and message buttons. Slash commands are planned and webhooks are coming soon."),
        src: ["api", "features", "github"],
      },
      discordBots: {
        status: "no",
        note: gt("Osmium uses its own Protobuf-based protocol, so Discord bots have to be rewritten."),
        src: ["api", "proto"],
      },
      discordMigration: {
        status: "no",
        note: gt("We found no Discord import or bridge."),
      },
      desktop: {
        status: "yes",
        note: gt("Windows 10 or newer, macOS 11 or newer (Apple silicon and Intel) and Linux (x64 and arm64, including Flatpak and AUR)."),
        src: ["download"],
      },
      mobile: {
        status: "yes",
        value: gt("Beta"),
        note: gt("Android on Google Play and iPhone on the App Store (iOS 18.2 or newer), both labeled beta."),
        src: ["download", "play", "appstore"],
      },
      web: { status: "yes", src: ["download"] },
      license: {
        status: "partial",
        value: gt("Closed, with an open protocol"),
        note: gt("The server and official apps are closed source. The protocol definitions, JavaScript SDK and the Nucleus framework (MIT) are public, and third-party clients are allowed."),
        src: ["github", "proto", "nucleus", "api"],
      },
      selfHost: {
        status: "no",
        src: ["terms"],
      },
      federation: { status: "no" },
      uploads: {
        status: "unknown",
        note: gt("Osmium doesn't publish a free upload limit."),
        src: ["files-docs"],
      },
      groupSize: {
        status: "unknown",
        note: gt("We found no published community or group size limits."),
      },
      scale: {
        status: "partial",
        value: gt("About 55,000 registered accounts"),
        note: gt("The homepage counter showed 54,846 registered users on 15 October 2026; that counts sign-ups, not active users. Google Play shows 5,000+ installs."),
        src: ["home", "play"],
      },
      incidents: {
        value: gt("No breach found"),
        note: gt("We found no security breach. Early reviewers criticized paywalls and having to contact support to delete an account; the current terms say accounts can be deleted in settings."),
        src: ["alternativeto", "terms"],
      },
    },
    whyUs: [
      {
        title: gt("End-to-end encrypted DMs, today"),
        text: gt("SerikaCord's DMs and group DMs, including their calls, are end-to-end encrypted by default for new conversations. Osmium's privacy policy says it doesn't offer end-to-end encryption yet and that the company can access message content. Our encryption is new and not yet audited."),
        src: ["privacy", "features"],
      },
      {
        title: gt("Moderation tools for growing communities"),
        text: gt("SerikaCord has AutoMod, an audit log, timeouts, raid protection, onboarding questions and rules screening. On Osmium, audit logs, raid protection, timeouts and moderator reports are still listed as coming soon."),
        src: ["features"],
      },
      {
        title: gt("Threads, forums and ticket channels"),
        text: gt("SerikaCord has threads, forum channels and ticket channels. Osmium has no threads, and forum channels are planned."),
        src: ["features", "proto"],
      },
      {
        title: gt("Your Discord bots and a bridge"),
        text: gt("Many discord.js and discord.py bots run on SerikaCord after changing the API address, and a consent-based bridge mirrors a Discord server. Osmium's API is its own, so bots must be rewritten, and we found no Discord import or bridge."),
        src: ["api"],
      },
      {
        title: gt("A clear EU home"),
        text: gt("SerikaCord is run from the Netherlands under the GDPR. Osmium presents itself as Dutch, but the company listed on Google Play and in network records is a New Mexico LLC. Both say they don't sell data, so this edge is about clarity rather than practice."),
        src: ["play", "ripe"],
      },
    ],
    whyThem: [
      {
        title: gt("Apps for every platform, including iPhone"),
        text: gt("Osmium has Android and iPhone apps in the stores and Linux packages for Flatpak, AUR and APT on x64 and arm64. SerikaCord has no iPhone app yet, and its Android app is installed from our website."),
        src: ["download", "play", "appstore"],
      },
      {
        title: gt("An open protocol you can build on"),
        text: gt("Osmium publishes its protocol, offers a free API without approval and explicitly allows third-party clients. SerikaCord's code is public, but its license doesn't allow reuse in other projects."),
        src: ["api", "proto", "github"],
      },
      {
        title: gt("Calls don't expose your IP to others"),
        text: gt("Osmium's calls run through its own voice servers. SerikaCord's calls connect peer-to-peer where possible, so others in a call can see your IP address."),
        src: ["voice-docs", "blog-scale"],
      },
      {
        title: gt("More visible traction"),
        text: gt("Osmium's homepage counted about 55,000 registered accounts in October 2026, and its discovery page is run with top.gg. SerikaCord's community is small, and we don't publish user numbers."),
        src: ["home", "discovery"],
      },
      {
        title: gt("Younger teens outside the EU"),
        text: gt("Osmium's minimum age is 16 in the EU, but elsewhere it follows the local age of digital consent, and the App Store rates it 13+. SerikaCord is 16 and over everywhere."),
        src: ["terms", "appstore"],
      },
    ],
    pickThem: [
      gt("you need iPhone and Android apps from the stores today"),
      gt("you want to build your own bot or client on an open protocol"),
      gt("you don't want others in a call to see your IP address"),
      gt("some of your members are under 16 and live outside the EU"),
    ],
    pickUs: [
      gt("you want end-to-end encrypted DMs that exist today"),
      gt("you run a growing community and need AutoMod, audit logs, timeouts and onboarding"),
      gt("you need threads, forum or ticket channels"),
      gt("you want to bring your Discord bots or bridge a Discord server"),
    ],
    faq: [
      {
        question: gt("Is Osmium end-to-end encrypted?"),
        answer: gt("Not yet. Osmium's privacy policy says it doesn't currently provide end-to-end encryption, and its features page lists it as planned, even though its Google Play listing claims encryption for direct chats. Calls use standard encrypted connections through Osmium's servers."),
      },
      {
        question: gt("Who runs Osmium?"),
        answer: gt("Uncollapse LLC, a small self-funded company. The brand and terms present it as Dutch, while Google Play and network records list an address in Albuquerque, New Mexico, USA."),
      },
      {
        question: gt("Is Osmium open source, and can I self-host it?"),
        answer: gt("No. The server and official apps are closed source and there is no self-hosted version. Its protocol, SDK and some libraries are public, and third-party clients are allowed."),
      },
      {
        question: gt("Can I move my Discord server or bots to Osmium?"),
        answer: gt("We found no Discord import or bridge, and Osmium's bot API isn't Discord-compatible, so bots need to be rewritten. SerikaCord runs many Discord bots after changing the API address and has a consent-based Discord bridge."),
      },
      {
        question: gt("Is Osmium free?"),
        answer: gt("Yes, the core app is free with no ads. An optional Premium subscription exists; it is reported at about $6 a month, but Osmium's site doesn't list the price or perks."),
      },
      {
        question: gt("Is Osmium private?"),
        answer: gt("Osmium says it doesn't sell data, track you or scan messages with AI, and it doesn't ask for ID. But it isn't end-to-end encrypted, so the company can technically read your messages, as its privacy policy says."),
      },
    ],
    couldNotVerify: [
      gt("Osmium's Premium price and perks; the $6 a month figure comes from third-party listings, not Osmium."),
      gt("The free upload size limit."),
      gt("Which countries Osmium's servers are in, and whether per-region data storage is fully live."),
      gt("Who founded Osmium and how big the team is."),
      gt("Why a Dutch-branded service is run by a New Mexico LLC; the address may be a registered-agent address."),
    ],
    notes: {
      title: gt("Where Osmium's own documents disagree"),
      intro: gt("We found these conflicts on 15 October 2026. We list what each document says, without guessing why."),
      points: [
        gt("Encryption: the Google Play listing, published by Uncollapse LLC, lists ‘End-to-end encryption for direct chats’ as a feature."),
        gt("The privacy policy (updated 10 February 2026) says Osmium does not currently provide end-to-end encryption for messages and that the company has technical access to message content. The features page on osmium.chat lists end-to-end encrypted chats as planned."),
        gt("Location: the website and terms present Osmium as Dutch, with Dutch law and a ‘made in the Netherlands’ footer, while Google Play and the RIPE network registry list Uncollapse LLC with an address in Albuquerque, New Mexico, USA."),
      ],
      src: ["play", "privacy", "features", "terms", "ripe", "home"],
    },
  };
}

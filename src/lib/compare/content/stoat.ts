import { getGT } from "gt-next/server";
import type { AppContent, CompareSource } from "../types";

/**
 * SerikaCord vs Stoat (formerly Revolt). Facts checked on
 * COMPARE_LAST_CHECKED_ISO against the sources below (titles and publishers
 * are proper names, not translated).
 */

export const sources: CompareSource[] = [
  { id: "home", title: "Stoat homepage", url: "https://stoat.chat/", publisher: "Stoat", kind: "primary" },
  { id: "updates", title: "Stoat blog and changelogs", url: "https://stoat.chat/updates", publisher: "Stoat", kind: "primary" },
  {
    id: "video",
    title: "Our Most Requested Feature Yet (video, screen share, Gifbox, push, slow mode)",
    url: "https://stoat.chat/release-notes/93eb1f4ec77444ca9fb13617e0e6c0b1",
    publisher: "Stoat",
    kind: "primary",
    date: "2026-07-17",
  },
  { id: "million", title: "One million users. Also, meet Toast.", url: "https://stoat.chat/updates/celebrating-one-million", publisher: "Stoat", kind: "primary", date: "2026-03-29" },
  { id: "voice-v2", title: "Stoat for Web 0.0.13 (voice chats v2)", url: "https://stoat.chat/updates/web-0013", publisher: "Stoat", kind: "primary", date: "2025-10-23" },
  { id: "download", title: "Download Stoat", url: "https://stoat.chat/download", publisher: "Stoat", kind: "primary" },
  { id: "ios", title: "Download Stoat for iOS", url: "https://stoat.chat/download/ios", publisher: "Stoat", kind: "primary" },
  { id: "privacy", title: "Stoat Privacy Policy (30 June 2026)", url: "https://stoat.chat/legal/privacy", publisher: "Stoat", kind: "primary", date: "2026-06-30" },
  { id: "terms", title: "Stoat Terms of Service (30 June 2026)", url: "https://stoat.chat/legal/terms", publisher: "Stoat", kind: "primary", date: "2026-06-30" },
  { id: "guidelines", title: "Stoat Community Guidelines", url: "https://stoat.chat/legal/community-guidelines", publisher: "Stoat", kind: "primary" },
  { id: "imprint", title: "Stoat imprint (Revolt Platforms Ltd)", url: "https://stoat.chat/legal/imprint", publisher: "Stoat", kind: "primary" },
  { id: "min-age", title: "Minimum age requirements", url: "https://support.stoat.chat/kb/safety/minimum-age-guidelines", publisher: "Stoat", kind: "primary" },
  { id: "dev-faq", title: "Stoat developer FAQ (federation, funding, self-hosting)", url: "https://developers.stoat.chat/faq", publisher: "Stoat", kind: "primary" },
  { id: "api", title: "Stoat live API configuration", url: "https://api.stoat.chat/", publisher: "Stoat", kind: "primary" },
  { id: "backend", title: "stoatchat/stoatchat backend repository (AGPL-3.0)", url: "https://github.com/stoatchat/stoatchat", publisher: "GitHub", kind: "primary" },
  { id: "advisories", title: "Stoat backend security advisories", url: "https://github.com/stoatchat/stoatchat/security/advisories", publisher: "GitHub", kind: "primary" },
  { id: "v0155", title: "Stoat backend v0.15.5 security release", url: "https://github.com/stoatchat/stoatchat/releases/tag/v0.15.5", publisher: "GitHub", kind: "primary", date: "2026-09-11" },
  { id: "e2ee-issue", title: "End-to-end encryption, issue #1009", url: "https://github.com/stoatchat/stoatchat/issues/1009", publisher: "GitHub", kind: "primary", date: "2026-09-20" },
  { id: "e2ee-discussion", title: "End-to-end encryption discussion #1002", url: "https://github.com/orgs/stoatchat/discussions/1002", publisher: "GitHub", kind: "primary", date: "2021-10-30" },
  { id: "federation", title: "Federation between instances, discussion #1073", url: "https://github.com/orgs/stoatchat/discussions/1073", publisher: "GitHub", kind: "primary", date: "2026-02-15" },
  { id: "scaling", title: "How can Stoat scale with millions of users?", url: "https://github.com/orgs/stoatchat/discussions/1252", publisher: "GitHub", kind: "primary", date: "2026" },
  { id: "self-hosted", title: "Official Stoat self-hosted Docker setup", url: "https://github.com/stoatchat/self-hosted", publisher: "GitHub", kind: "primary" },
  { id: "web-releases", title: "Stoat for Web releases", url: "https://github.com/stoatchat/for-web/releases", publisher: "GitHub", kind: "primary" },
  { id: "desktop", title: "Stoat desktop app (Electron, AGPL-3.0)", url: "https://github.com/stoatchat/for-desktop", publisher: "GitHub", kind: "primary" },
  { id: "android", title: "Stoat Android app (AGPL-3.0)", url: "https://github.com/stoatchat/for-android", publisher: "GitHub", kind: "primary" },
  { id: "ios-repo", title: "Stoat iOS app (TestFlight, early stage)", url: "https://github.com/stoatchat/for-ios", publisher: "GitHub", kind: "primary" },
  { id: "sdk", title: "stoat.js JavaScript SDK (MIT)", url: "https://github.com/stoatchat/javascript-client-sdk", publisher: "GitHub", kind: "primary" },
  {
    id: "companies-house",
    title: "REVOLT PLATFORMS LTD (16260658)",
    url: "https://find-and-update.company-information.service.gov.uk/search/companies?q=REVOLT+PLATFORMS",
    publisher: "Companies House",
    kind: "primary",
    date: "2025-02-18",
  },
  { id: "history", title: "Stoat history", url: "https://vale.rocks/posts/stoat-history", publisher: "Declan Chidlow (vale.rocks)", kind: "secondary", date: "2026-08-28" },
  { id: "wikipedia", title: "Stoat (software)", url: "https://en.wikipedia.org/wiki/Stoat_(software)", publisher: "Wikipedia", kind: "secondary" },
  {
    id: "destructoid",
    title: "So many people are fleeing Discord's surveillance plans that they're crashing this upstart alternative platform",
    url: "https://www.destructoid.com/so-many-people-are-fleeing-discords-surveillance-plans-that-theyre-crashing-this-upstart-alternative-platform-theres-simply-too-many-people-but-were-trying-our-best/",
    publisher: "Destructoid",
    kind: "secondary",
    date: "2026-02-15",
  },
  {
    id: "alternativeto",
    title: "Group chat app Stoat adds video chat, screen sharing, GIF search and push notifications",
    url: "https://alternativeto.net/news/2026/7/group-chat-app-stoat-adds-video-chat-screen-sharing-gif-search-and-push-notifications/",
    publisher: "AlternativeTo",
    kind: "secondary",
    date: "2026-07-20",
  },
  { id: "privacyguides", title: "Revolt is now Stoat", url: "https://discuss.privacyguides.net/t/revolt-is-now-stoat/32176", publisher: "Privacy Guides forum", kind: "secondary", date: "2025-10-18" },
];

export async function content(): Promise<AppContent> {
  const gt = await getGT();
  return {
    take: gt("The best-known open-source Discord alternative, formerly Revolt: free, ad-free, AGPL-licensed and self-hostable with over a million accounts, but nothing is end-to-end encrypted and there is no App Store iPhone app yet."),
    intro: [
      gt("Stoat is the chat app that was called Revolt until 1 October 2025, when it was renamed after a cease-and-desist over the Revolt name. Like SerikaCord it copies Discord's layout of servers, channels, roles and voice, and like us it has no ads. It is run by a small UK company from EU servers and funded by donations."),
      gt("The biggest differences are openness and encryption. Stoat is open source under the AGPL and you can self-host it for any purpose, which SerikaCord's license doesn't allow, and it has a much bigger community; SerikaCord has end-to-end encrypted DMs, Discord-compatible bots, threads, forums and stronger moderation tools, none of which Stoat offers today."),
    ],
    verdict: gt("If open source, self-hosting or a large existing community matters most, Stoat is the stronger pick. If you want encrypted private messages, Discord bots, threads and forums, or higher-quality screen sharing, SerikaCord fits better."),
    facts: {
      operator: {
        value: gt("Revolt Platforms Ltd"),
        note: gt("A UK private company incorporated in February 2025 and controlled by founder Paul Makles; most contributors are volunteers. Development began in 2019 and Revolt launched publicly in 2021."),
        src: ["companies-house", "imprint", "wikipedia", "history"],
      },
      jurisdiction: {
        value: gt("United Kingdom; EU servers"),
        note: gt("Registered in England and Wales, so UK law, including the Online Safety Act, applies. Servers are with EU providers (Hetzner, Ionos, Scaleway) and the voice server is in Helsinki."),
        src: ["imprint", "privacy", "api"],
      },
      businessModel: {
        value: gt("Donations"),
        note: gt("Funded entirely by donations through Ko-fi and GitHub Sponsors. In 2026 the maintainer said paid options to cover storage and bandwidth are planned, without paywalling existing features."),
        src: ["dev-faq", "scaling"],
      },
      ads: {
        status: "no",
        value: gt("No ads"),
        note: gt("The homepage promises no ads, no data mining and no shady partnerships."),
        src: ["home"],
      },
      pricing: {
        value: gt("Free; no paid tier"),
        note: gt("Everything is free as of October 2026, including voice, video, screen share and custom emoji. A future paid tier has been mentioned but not dated."),
        src: ["home", "scaling"],
      },
      maturity: {
        status: "partial",
        value: gt("Since 2021, still pre-1.0"),
        note: gt("Public since 2021 and renamed from Revolt on 1 October 2025. Releases are frequent (backend v0.16.1 in October 2026), and video and screen share only arrived in July 2026."),
        src: ["wikipedia", "history", "video"],
      },
      e2eeDms: {
        status: "no",
        note: gt("Messages are stored readable on Stoat's servers. Users have asked for encryption since 2021; an MLS-based plan was opened as an issue in September 2026 and sits in the backlog with no date."),
        src: ["e2ee-issue", "e2ee-discussion"],
      },
      e2eeGroups: {
        status: "no",
        note: gt("Group DMs are not end-to-end encrypted."),
        src: ["e2ee-issue"],
      },
      e2eeCalls: {
        status: "no",
        note: gt("Voice and video calls are not end-to-end encrypted."),
        src: ["e2ee-issue"],
      },
      e2eeCommunity: {
        status: "no",
        note: gt("Server channels are not end-to-end encrypted; Stoat's design notes cite server-side search as one obstacle."),
        src: ["e2ee-issue"],
      },
      e2eeDefault: {
        status: "no",
        value: gt("Not available"),
        src: ["e2ee-issue"],
      },
      audit: {
        status: "no",
        value: gt("Nothing to audit yet"),
        note: gt("There is no end-to-end encryption to audit. Security fixes are published as GitHub advisories."),
        src: ["advisories"],
      },
      metadata: {
        value: gt("Stoat sees all content"),
        note: gt("Messages and attachments are stored on Stoat's servers without end-to-end encryption, along with the IP address and device description of each session."),
        src: ["privacy"],
      },
      dataUse: {
        status: "yes",
        value: gt("No selling, no ad trackers"),
        note: gt("The privacy policy says Stoat will never sell your data. The third parties it names are Cloudflare, hCaptcha on sign-up and login, and Scaleway for email."),
        src: ["privacy"],
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
        value: gt("No ID or face scans"),
        note: gt("A self-declared date of birth, and adult content must be in age-gated channels. Minimum age 13 in most countries and 14 to 16 in some, for example 16 in Germany and the Netherlands."),
        src: ["min-age", "terms"],
      },
      servers: {
        status: "yes",
        note: gt("Servers with text and voice channels, categories and, since September 2026, server folders."),
        src: ["web-releases"],
      },
      roles: {
        status: "yes",
        note: gt("Role permissions with per-channel overrides; bot roles were added in October 2026."),
        src: ["backend"],
      },
      threadsForums: {
        status: "no",
        note: gt("We found no threads or forum channels in Stoat's changelogs or on its homepage."),
        src: ["updates", "home"],
      },
      onboarding: {
        status: "no",
        note: gt("We found no Discord-style onboarding or rules screening. A server and bot Discover directory arrived in September 2026."),
        src: ["web-releases"],
      },
      modTools: {
        status: "partial",
        note: gt("Kick, ban, slow mode (July 2026), invite expiry and usage limits (October 2026) and channel permissions. We found no AutoMod-style keyword filters."),
        src: ["video", "backend"],
      },
      platformSafety: {
        status: "partial",
        note: gt("In-app reporting to Stoat's Trust & Safety team and a platform strike system with appeals. No transparency report has been published."),
        src: ["guidelines", "privacy"],
      },
      voiceChannels: {
        status: "yes",
        note: gt("Rebuilt on LiveKit in October 2025. Calls run through Stoat's own media server rather than peer-to-peer."),
        src: ["voice-v2", "api"],
      },
      videoScreen: {
        status: "yes",
        note: gt("Video and screen sharing since July 2026, in voice channels, DMs and groups. Screen sharing is capped at 720p and 30 FPS for now."),
        src: ["video", "alternativeto"],
      },
      streamingStage: {
        status: "no",
        note: gt("Screen sharing only, at up to 720p and 30 FPS; no high-quality streaming or Stage-style channels."),
        src: ["video"],
      },
      botApi: {
        status: "yes",
        note: gt("Its own REST and WebSocket API, bot accounts, webhooks and libraries such as stoat.js."),
        src: ["backend", "sdk"],
      },
      discordBots: {
        status: "no",
        value: gt("Not compatible"),
        note: gt("Stoat's API is its own design, so Discord bots and libraries need rewriting."),
        src: ["backend"],
      },
      discordMigration: {
        status: "no",
        note: gt("We found no official Discord bridge or server importer."),
        src: ["updates"],
      },
      desktop: {
        status: "yes",
        note: gt("Windows (also in the Microsoft Store), macOS (Apple silicon and Intel) and Linux (AppImage, DEB, RPM and Flatpak)."),
        src: ["download", "desktop"],
      },
      mobile: {
        status: "partial",
        value: gt("Android early access"),
        note: gt("The Android app is on Google Play but still labelled Early Access. There is no iPhone app in the App Store; Stoat recommends the web app, and its TestFlight beta is at an early stage."),
        src: ["android", "ios", "ios-repo"],
      },
      web: {
        status: "yes",
        src: ["web-releases"],
      },
      license: {
        status: "yes",
        value: gt("AGPL-3.0 (open source)"),
        note: gt("The server, web, desktop and mobile apps are AGPL-3.0; the JavaScript SDK is MIT."),
        src: ["backend", "sdk"],
      },
      selfHost: {
        status: "yes",
        value: gt("Yes, official Docker setup"),
        note: gt("An official Docker Compose setup includes LiveKit voice and video. Most official native apps can't connect to your own instance yet, so the web app works best, and Stoat doesn't support third-party instances."),
        src: ["self-hosted", "dev-faq"],
      },
      federation: {
        status: "no",
        note: gt("Not on the roadmap; the maintainer said in February 2026 it is unlikely to happen soon. Self-hosted instances don't connect to each other."),
        src: ["federation", "dev-faq"],
      },
      uploads: {
        value: gt("20 MB per file"),
        note: gt("The same for everyone, since there is no paid tier."),
        src: ["home"],
      },
      groupSize: {
        value: gt("Group DMs: 50 people"),
        note: gt("We didn't find a published limit on server members."),
        src: ["home"],
      },
      scale: {
        status: "yes",
        value: gt("1M+ registered accounts"),
        note: gt("Stoat announced one million registered accounts in March 2026, and a contributor's post put it at about 1.5 million by late August 2026. No active-user numbers have been published."),
        src: ["million", "history"],
      },
      incidents: {
        value: gt("Rename, outages, security fixes"),
        note: gt("Renamed from Revolt after a trademark cease-and-desist (October 2025). Days of slowdowns and outages during the February 2026 sign-up surge. Security fixes in August and September 2026, including a critical two-factor bypass; no breach was disclosed."),
        src: ["history", "privacyguides", "destructoid", "advisories", "v0155"],
      },
    },
    whyUs: [
      {
        title: gt("Your private messages are end-to-end encrypted"),
        text: gt("SerikaCord encrypts DMs, group DMs of up to 10 people and their calls by default for new conversations. Stoat has no end-to-end encryption; its MLS plan was opened as an issue in September 2026 and has no date. Our encryption is new and hasn't been audited."),
        src: ["e2ee-issue"],
      },
      {
        title: gt("Your Discord bots can come along"),
        text: gt("SerikaCord's bot API follows Discord's API v10, so many discord.js and discord.py bots work after changing the API address, and a consent-based bridge mirrors a Discord server while you move. Stoat has its own bot API, so Discord bots need rewriting, and it has no official bridge."),
        src: ["backend"],
      },
      {
        title: gt("Threads, forums and fuller moderation"),
        text: gt("SerikaCord has threads, forum and ticket channels, onboarding questions, rules screening, AutoMod and an audit log. We found none of these in Stoat's changelogs, although it added slow mode and invite limits in 2026."),
        src: ["updates", "video"],
      },
      {
        title: gt("Sharper screen sharing"),
        text: gt("SerikaCord shares screens up to source resolution at 60 FPS. Stoat added video and screen sharing in July 2026, with screen sharing capped at 720p and 30 FPS for now."),
        src: ["video"],
      },
      {
        title: gt("25 times the free upload size"),
        text: gt("Free SerikaCord accounts can upload files up to 500 MB. Stoat's limit is 20 MB for everyone."),
        src: ["home"],
      },
      {
        title: gt("An EU company, not just EU servers"),
        text: gt("SerikaCord is run from the Netherlands under the GDPR. Stoat's servers are in the EU too, but the company is registered in the UK, so the UK Online Safety Act applies to it. Neither asks for ID or face scans, so this edge is small."),
        src: ["imprint", "privacy"],
      },
    ],
    whyThem: [
      {
        title: gt("Real open source you can self-host"),
        text: gt("Stoat is AGPL-3.0 open source with an official Docker setup anyone can run, for any purpose, as long as they don't use the Stoat brand. SerikaCord is source-available, not open source: you may self-host it only for personal, non-commercial use, without an official setup guide."),
        src: ["backend", "self-hosted"],
      },
      {
        title: gt("A much bigger community"),
        text: gt("Stoat passed one million registered accounts in March 2026, helped by people leaving Discord. SerikaCord's community is small and we don't publish user numbers."),
        src: ["million"],
      },
      {
        title: gt("Calls don't reveal your IP address to others"),
        text: gt("Stoat's voice and video run through its own LiveKit media server. SerikaCord connects calls peer-to-peer where possible, which exposes your IP address to others in the call and gets heavy in large video calls."),
        src: ["voice-v2", "api"],
      },
      {
        title: gt("Everything is free, with no paid tier"),
        text: gt("Stoat has no paid tier at all; voice, video, custom emoji and uploads are free for everyone, although it plans paid options for storage and bandwidth. SerikaCord is also free, but sells Serika+ for bigger uploads and cosmetics."),
        src: ["home", "scaling"],
      },
      {
        title: gt("A Google Play app and a longer history"),
        text: gt("Stoat's Android app is on Google Play, though still labelled Early Access, and the project has been public since 2021. SerikaCord's Android app is installed from our website and we launched in January 2026. Neither has an iPhone app in the App Store yet."),
        src: ["android", "wikipedia", "ios"],
      },
      {
        title: gt("Younger teens can join"),
        text: gt("Stoat's minimum age is 13 in most countries. SerikaCord is 16 and over everywhere."),
        src: ["min-age"],
      },
    ],
    pickThem: [
      gt("you want open-source software you can run on your own server for any purpose"),
      gt("you want to join a bigger existing community"),
      gt("you don't want other people in a call to see your IP address"),
      gt("some of your members are 13 to 15 years old"),
      gt("you want to install the Android app from Google Play"),
    ],
    pickUs: [
      gt("you want your DMs and group calls end-to-end encrypted today"),
      gt("you run Discord bots and want them to keep working"),
      gt("you need threads, forums, onboarding or AutoMod"),
      gt("you share large files or stream your screen above 720p"),
    ],
    faq: [
      {
        question: gt("Is Stoat the same as Revolt?"),
        answer: gt("Yes. Revolt renamed itself Stoat on 1 October 2025 after receiving a cease-and-desist over the Revolt name, and revolt.chat now redirects to stoat.chat. The sender of the letter was never disclosed."),
      },
      {
        question: gt("Is Stoat end-to-end encrypted?"),
        answer: gt("No. Messages, files and calls on Stoat are not end-to-end encrypted. An MLS-based plan was opened as an issue in September 2026 but is in the backlog with no date."),
      },
      {
        question: gt("Is Stoat open source, and can I self-host it?"),
        answer: gt("Yes. Stoat's server and apps are AGPL-3.0 and there is an official Docker setup that includes voice and video. Most official native apps can't connect to your own instance yet, so the web app works best, and self-hosted instances don't connect to stoat.chat."),
      },
      {
        question: gt("Can I host SerikaCord myself?"),
        answer: gt("Yes, but only for personal, non-commercial use for yourself and people you invite, free for them and not open to public sign-up; commercial use needs a license from partners@serika.dev. Self-hosted instances don't connect to serika.chat, there is no official setup guide or support, and SerikaCord is not open source."),
      },
      {
        question: gt("Who runs Stoat?"),
        answer: gt("Revolt Platforms Ltd, a UK company incorporated in February 2025 and controlled by founder Paul Makles, with help from volunteer contributors. It is funded by donations and hosts its servers in the EU."),
      },
      {
        question: gt("Will my Discord bot work on Stoat?"),
        answer: gt("Not without rewriting it, because Stoat has its own bot API. SerikaCord's bot API follows Discord's API v10, so many discord.js and discord.py bots work after changing the API address, though not every Discord feature is covered."),
      },
      {
        question: gt("Is there a Stoat app for iPhone?"),
        answer: gt("Not in the App Store as of October 2026. Stoat recommends adding its web app to your Home Screen, and a native app is in an early TestFlight beta. SerikaCord has no iPhone app yet either."),
      },
      {
        question: gt("Does Stoat ask for ID or a face scan?"),
        answer: gt("No. Stoat asks for your date of birth and keeps adult content in age-gated channels. Its minimum age is 13 in most countries, higher in some; SerikaCord's is 16 everywhere."),
      },
    ],
    couldNotVerify: [
      gt("Who sent the cease-and-desist that led to the rename from Revolt."),
      gt("Active-user numbers: Stoat has only published registered accounts, and the 1.5 million figure comes from a contributor's blog."),
      gt("That threads, forums, onboarding and AutoMod are truly absent: we inferred this from changelogs and the homepage, not an official statement."),
      gt("Whether Stoat has taken steps for the UK Online Safety Act beyond self-declared dates of birth and age-gated channels."),
      gt("Whether a transparency report reportedly promised in 2024 will be published."),
    ],
  };
}

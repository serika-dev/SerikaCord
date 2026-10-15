import { getGT } from "gt-next/server";
import type { AppContent, CompareSource } from "../types";

/**
 * SerikaCord vs Nerimity. Facts checked on COMPARE_LAST_CHECKED_ISO against
 * the sources below (titles and publishers are proper names, not translated).
 */

export const sources: CompareSource[] = [
  { id: "home", title: "Nerimity homepage", url: "https://nerimity.com", publisher: "Nerimity", kind: "primary" },
  { id: "privacy", title: "Nerimity Privacy Policy (updated 20 February 2026)", url: "https://nerimity.com/privacy", publisher: "Nerimity", kind: "primary", date: "2026-02-20" },
  { id: "terms", title: "Nerimity Terms and Conditions (updated 11 December 2025)", url: "https://nerimity.com/terms-and-conditions", publisher: "Nerimity", kind: "primary", date: "2025-12-11" },
  { id: "org", title: "Nerimity GitHub organization", url: "https://github.com/Nerimity", publisher: "GitHub", kind: "primary" },
  { id: "org-readme", title: "Nerimity organization profile (maintainers, Ko-fi)", url: "https://github.com/Nerimity/.github/blob/main/profile/README.md", publisher: "GitHub", kind: "primary" },
  { id: "web-repo", title: "nerimity-web repository (GPL-3.0)", url: "https://github.com/Nerimity/nerimity-web", publisher: "GitHub", kind: "primary" },
  { id: "server-repo", title: "nerimity-server repository (GPL-3.0)", url: "https://github.com/Nerimity/nerimity-server", publisher: "GitHub", kind: "primary" },
  {
    id: "supporter",
    title: "Supporter-only attachments message (nerimity-server)",
    url: "https://github.com/Nerimity/nerimity-server/blob/main/src/common/nerimitySupporterCdnMessage.ts",
    publisher: "GitHub",
    kind: "primary",
  },
  { id: "desktop", title: "Nerimity desktop releases", url: "https://github.com/Nerimity/nerimity-desktop/releases", publisher: "GitHub", kind: "primary", date: "2026-08-27" },
  { id: "android", title: "Nerimity Android APK releases", url: "https://github.com/Nerimity/NerimityReactNative/releases", publisher: "GitHub", kind: "primary", date: "2026-04-08" },
  { id: "cdn", title: "Nerimity file server (cdn-nerimity-go)", url: "https://github.com/Nerimity/cdn-nerimity-go", publisher: "GitHub", kind: "primary" },
  { id: "docs", title: "Nerimity API documentation", url: "https://github.com/Nerimity/nerimity-docs", publisher: "GitHub", kind: "primary" },
  { id: "threads-issue", title: "Creating Threads, issue #134", url: "https://github.com/Nerimity/nerimity-web/issues/134", publisher: "GitHub", kind: "primary", date: "2024-12-12" },
  { id: "twofa-issue", title: "2FA, issue #352", url: "https://github.com/Nerimity/nerimity-web/issues/352", publisher: "GitHub", kind: "primary", date: "2025-12-28" },
  { id: "founder", title: "SupertigerDev GitHub profile", url: "https://github.com/SupertigerDev", publisher: "GitHub", kind: "primary" },
];

export async function content(): Promise<AppContent> {
  const gt = await getGT();
  return {
    take: gt("A friendly, open-source Discord look-alike with lots of free cosmetics, run as a one-person hobby project, with no encryption, no iPhone app and file uploads in private groups reserved for donors."),
    intro: [
      gt("Nerimity is a Discord-style chat app built since 2022 by a single developer in the UK, with help from volunteers. Its web app and server are open source under the GPL, it has no ads, and it gives away cosmetics such as animated avatars and emoji that Discord charges for."),
      gt("SerikaCord is also small and young, but it is run by a company and offers more: end-to-end encrypted DMs, Discord-compatible bots, threads and forums, a fuller permission system and free uploads everywhere. Nerimity wins on open source, on allowing 14-year-olds and on a longer track record."),
    ],
    verdict: gt("For a small friend group that wants a free, open-source, cosmetics-rich hangout on desktop and web, Nerimity works. For private conversations, larger communities or Discord bots, SerikaCord is the better fit."),
    facts: {
      operator: {
        value: gt("One developer (Supertiger)"),
        note: gt("A hobby project run by one developer with volunteer moderators and contributors; its own Terms call it a hobby project. We found no company behind it."),
        src: ["terms", "org-readme", "founder"],
      },
      jurisdiction: {
        value: gt("United Kingdom"),
        note: gt("The Terms are governed by the laws of Great Britain. The hosting provider and data location aren't disclosed; the site sits behind Cloudflare."),
        src: ["terms", "privacy"],
      },
      businessModel: {
        value: gt("Donations"),
        note: gt("Donations through Ko-fi. Donors get a Supporter badge that also unlocks file uploads in private channels."),
        src: ["org-readme", "supporter"],
      },
      ads: {
        status: "no",
        value: gt("No ads"),
        note: gt("The privacy policy says data isn't shared for advertising."),
        src: ["privacy"],
      },
      pricing: {
        value: gt("Free; donations optional"),
        note: gt("No subscription. Since November 2023, uploading files to Nerimity in private channels or unpublished servers needs a Supporter badge; since March 2026, linked Google Drive files are allowed there."),
        src: ["supporter", "server-repo"],
      },
      maturity: {
        status: "partial",
        value: gt("Since 2022, hobby project"),
        note: gt("Developed since 2022 with near-daily releases in October 2026, but run as a one-person hobby project."),
        src: ["web-repo", "terms"],
      },
      e2eeDms: {
        status: "no",
        note: gt("Messages are stored readable on the server, and staff review message logs when a report comes in."),
        src: ["privacy"],
      },
      e2eeGroups: {
        status: "no",
        src: ["privacy"],
      },
      e2eeCalls: {
        status: "no",
        value: gt("Not as a feature"),
        note: gt("Calls are peer-to-peer, so audio and video are encrypted in transit between participants (relayed through Cloudflare when needed), but there is no end-to-end encryption feature with key verification."),
        src: ["server-repo"],
      },
      e2eeCommunity: {
        status: "no",
        src: ["privacy"],
      },
      e2eeDefault: {
        status: "no",
        value: gt("Not available"),
      },
      audit: {
        status: "no",
        value: gt("No audit found"),
        note: gt("We found no independent security audit."),
      },
      metadata: {
        value: gt("Nerimity sees all content"),
        note: gt("Messages, images and IP addresses (kept for abuse prevention and IP bans) are stored on its servers."),
        src: ["privacy"],
      },
      dataUse: {
        status: "yes",
        value: gt("No selling, no ad trackers"),
        note: gt("The privacy policy says data isn't sold or shared for marketing. It uses Cloudflare, including Turnstile cookies, and Firebase for mobile notifications."),
        src: ["privacy"],
      },
      phone: {
        status: "no",
        value: gt("Not required"),
        src: ["server-repo"],
      },
      email: {
        status: "yes",
        value: gt("Required"),
        note: gt("You must confirm your email before you can send messages."),
        src: ["server-repo"],
      },
      ageChecks: {
        status: "no",
        value: gt("No ID or face scans"),
        note: gt("Minimum age 14, higher where local law requires. Accounts believed to be under age can be suspended until proof of age is provided."),
        src: ["terms"],
      },
      servers: {
        status: "yes",
        note: gt("Servers with text channels, categories and ticket channels. There is no separate voice channel type."),
        src: ["server-repo"],
      },
      roles: {
        status: "partial",
        note: gt("Roles with about 10 permissions and a few per-channel overrides, much simpler than Discord's."),
        src: ["server-repo"],
      },
      threadsForums: {
        status: "no",
        note: gt("No threads or forum channels; threads were requested in December 2024 and the request is still open."),
        src: ["threads-issue"],
      },
      onboarding: {
        status: "partial",
        note: gt("Servers can ask new members up to 10 welcome questions."),
        src: ["web-repo"],
      },
      modTools: {
        status: "partial",
        note: gt("Kick, ban, mute and nickname controls for servers. We found no AutoMod or server audit log; staff have platform-wide tools such as suspensions and IP bans."),
        src: ["server-repo"],
      },
      platformSafety: {
        status: "partial",
        note: gt("Staff and volunteer moderators handle reports under strict content rules, including a ban on NSFW servers. No transparency report has been published."),
        src: ["terms", "privacy"],
      },
      voiceChannels: {
        status: "partial",
        value: gt("Calls in any channel"),
        note: gt("Calls start inside text channels and DMs rather than in dedicated voice channels. They connect peer-to-peer with no media server, so others in a call can see your IP address."),
        src: ["server-repo", "web-repo"],
      },
      videoScreen: {
        status: "yes",
        note: gt("Video and screen sharing over peer-to-peer connections."),
        src: ["web-repo"],
      },
      streamingStage: {
        status: "no",
        note: gt("Screen sharing only; no streaming or Stage-style channels."),
        src: ["web-repo"],
      },
      botApi: {
        status: "yes",
        note: gt("Bot applications with commands, webhooks (including GitHub-format webhooks), OAuth2 and the nerimity.js library. The API documentation is thin."),
        src: ["docs"],
      },
      discordBots: {
        status: "no",
        value: gt("Not compatible"),
        note: gt("Nerimity has its own API, so Discord bots need rewriting."),
        src: ["docs"],
      },
      discordMigration: {
        status: "no",
        note: gt("No Discord bridge or importer."),
      },
      desktop: {
        status: "yes",
        note: gt("Electron apps for Windows, macOS (Intel and Apple silicon) and Linux, from GitHub releases."),
        src: ["desktop"],
      },
      mobile: {
        status: "partial",
        value: gt("Android APK only"),
        note: gt("An Android APK from GitHub; we found no Google Play listing. There is no iPhone app."),
        src: ["android", "home"],
      },
      web: {
        status: "yes",
        src: ["home"],
      },
      license: {
        status: "partial",
        value: gt("GPL-3.0 (web and server)"),
        note: gt("The web app and server are GPL-3.0 open source. The desktop, mobile and file-server code has no license, so it isn't open source."),
        src: ["web-repo", "server-repo", "org"],
      },
      selfHost: {
        status: "partial",
        value: gt("Possible, unsupported"),
        note: gt("The code can be run, but there is no self-hosting guide or Docker setup, and it depends on Cloudflare services."),
        src: ["server-repo"],
      },
      federation: {
        status: "no",
      },
      uploads: {
        value: gt("50 MB per file"),
        note: gt("Larger files go through your linked Google Drive. Uploads to Nerimity in private channels need a Supporter badge."),
        src: ["cdn", "supporter"],
      },
      groupSize: {
        status: "unknown",
        note: gt("We found no published limit on server members or call size."),
      },
      scale: {
        status: "unknown",
        value: gt("Not published"),
        note: gt("No official user numbers. Its web app repository has about 300 GitHub stars, which suggests a small community."),
        src: ["web-repo"],
      },
      incidents: {
        value: gt("None major found"),
        note: gt("We found no breaches or major outages, though our search of press and forums was limited."),
      },
    },
    whyUs: [
      {
        title: gt("Private messages that are actually private"),
        text: gt("SerikaCord encrypts DMs, group DMs and their calls end to end by default for new conversations. Nerimity has no end-to-end encryption, and its staff review message logs when a report comes in. Our encryption is new and hasn't been audited."),
        src: ["privacy"],
      },
      {
        title: gt("Share files in private groups without donating"),
        text: gt("Free SerikaCord accounts can upload files up to 500 MB anywhere. On Nerimity, uploading files in private channels or unpublished servers needs a donor's Supporter badge, unless you link Google Drive."),
        src: ["supporter"],
      },
      {
        title: gt("Roles, threads and moderation for bigger communities"),
        text: gt("SerikaCord has Discord-style roles with detailed per-channel permissions, threads, forum channels, AutoMod and an audit log. Nerimity has about 10 role permissions, no threads or forums, and basic server moderation."),
        src: ["server-repo", "threads-issue"],
      },
      {
        title: gt("Your Discord bots can come along"),
        text: gt("SerikaCord's bot API follows Discord's API v10 and a consent-based bridge mirrors a Discord server while you move. Nerimity has its own bot API and no bridge."),
        src: ["docs"],
      },
      {
        title: gt("Passkeys and a company behind it"),
        text: gt("SerikaCord supports passkeys, while Nerimity has no two-factor authentication yet (requested in December 2025). SerikaCord is run by a company rather than one person's hobby project, though we are also small and young, so this edge is modest."),
        src: ["twofa-issue", "terms"],
      },
    ],
    whyThem: [
      {
        title: gt("Open source"),
        text: gt("Nerimity's web app and server are GPL-3.0 open source. SerikaCord's code is public but source-available, not open source, and may only be self-hosted for personal, non-commercial use."),
        src: ["web-repo", "server-repo"],
      },
      {
        title: gt("Free cosmetics"),
        text: gt("Nerimity gives everyone animated avatars and emoji, free tag changes and profile themes at no cost. SerikaCord keeps some cosmetics for Serika+ subscribers."),
        src: ["home"],
      },
      {
        title: gt("A longer track record"),
        text: gt("Nerimity has been developed since 2022, and its developer built an earlier chat app, Nertivia, before that. SerikaCord launched in January 2026."),
        src: ["web-repo", "founder"],
      },
      {
        title: gt("Younger teens can join"),
        text: gt("Nerimity's minimum age is 14, higher where local law requires. SerikaCord is 16 and over everywhere."),
        src: ["terms"],
      },
    ],
    pickThem: [
      gt("you want open-source code under the GPL"),
      gt("you want animated avatars and emoji without paying"),
      gt("some of your members are 14 or 15 years old"),
      gt("you are a small friend group that mostly uses desktop and web"),
    ],
    pickUs: [
      gt("you want an encrypted place for private conversations"),
      gt("you want to share files in a private group without donating"),
      gt("you need detailed roles, threads, forums or AutoMod"),
      gt("you want your Discord bots to come along"),
    ],
    faq: [
      {
        question: gt("Is Nerimity end-to-end encrypted?"),
        answer: gt("No. Messages are stored readable on Nerimity's servers, and staff review message logs when a report comes in. Calls are peer-to-peer and encrypted in transit, but there is no end-to-end encryption feature."),
      },
      {
        question: gt("Who runs Nerimity?"),
        answer: gt("A single developer in the UK known as Supertiger, with volunteer moderators and contributors. Its Terms describe it as a hobby project, and we found no company behind it."),
      },
      {
        question: gt("Is Nerimity open source, and can I self-host it?"),
        answer: gt("Partly. The web app and server are GPL-3.0, but the desktop, mobile and file-server code has no license. Self-hosting is technically possible but undocumented, and it relies on Cloudflare services."),
      },
      {
        question: gt("Can I host SerikaCord myself?"),
        answer: gt("Yes, but only for personal, non-commercial use for yourself and people you invite, free for them and not open to public sign-up; commercial use needs a license from partners@serika.dev. Self-hosted instances don't connect to serika.chat, there is no official setup guide or support, and SerikaCord is not open source."),
      },
      {
        question: gt("Do I have to pay to send files on Nerimity?"),
        answer: gt("In public servers, no. In private channels and unpublished servers, uploading files to Nerimity needs a Supporter badge, which you get by donating; linked Google Drive files are allowed instead."),
      },
      {
        question: gt("Is there a Nerimity app for iPhone?"),
        answer: gt("No. Nerimity offers an Android APK from GitHub and desktop apps, but no iPhone app. SerikaCord's iPhone app is also still in development; until then you can use SerikaCord in Safari."),
      },
      {
        question: gt("Will my Discord bot work on Nerimity?"),
        answer: gt("No, Nerimity has its own bot API, so bots need rewriting. On SerikaCord many Discord bots work after changing the API address."),
      },
    ],
    couldNotVerify: [
      gt("How many people use Nerimity: no official figure exists."),
      gt("Which company hosts Nerimity's servers, and in which country."),
      gt("The minimum donation needed for a Supporter badge."),
      gt("Whether Nerimity has had any data breach or major outage; we found none, but our search was limited."),
      gt("Whether a Google Play listing exists under another name."),
    ],
  };
}

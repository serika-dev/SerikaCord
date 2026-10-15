import { getGT } from "gt-next/server";
import type { AppContent, CompareSource } from "../types";

/**
 * SerikaCord vs Fluxer. Facts checked on COMPARE_LAST_CHECKED_ISO against the
 * sources below (titles and publishers are proper names, not translated).
 */

export const sources: CompareSource[] = [
  { id: "home", title: "Fluxer homepage", url: "https://fluxer.app", publisher: "Fluxer", kind: "primary" },
  {
    id: "how-built",
    title: "How I built Fluxer, a Discord-like chat app",
    url: "https://fluxer.app/blog/how-i-built-fluxer-a-discord-like-chat-app",
    publisher: "Fluxer",
    kind: "primary",
    date: "2026-01-24",
  },
  { id: "v2", title: "Mobile clients and Fluxer v2", url: "https://fluxer.app/blog/mobile-clients-and-fluxer-v2", publisher: "Fluxer", kind: "primary", date: "2026-06-15" },
  { id: "roadmap", title: "Roadmap 2026", url: "https://fluxer.app/blog/roadmap-2026", publisher: "Fluxer", kind: "primary", date: "2026-10-14" },
  { id: "plutonium", title: "Fluxer Plutonium", url: "https://fluxer.app/plutonium", publisher: "Fluxer", kind: "primary" },
  { id: "pass", title: "Fluxer Operator Pass", url: "https://fluxer.app/pass", publisher: "Fluxer", kind: "primary" },
  { id: "selfhost", title: "Self-hosting Fluxer", url: "https://fluxer.app/selfhost", publisher: "Fluxer", kind: "primary" },
  { id: "download", title: "Download Fluxer", url: "https://fluxer.app/download", publisher: "Fluxer", kind: "primary" },
  { id: "company", title: "Company information (Fluxer Platform AB)", url: "https://fluxer.app/company-information", publisher: "Fluxer", kind: "primary" },
  { id: "privacy", title: "Fluxer Privacy Policy (updated 5 October 2026)", url: "https://fluxer.app/privacy", publisher: "Fluxer", kind: "primary", date: "2026-10-05" },
  { id: "terms", title: "Fluxer Terms of Service (updated 5 October 2026)", url: "https://fluxer.app/terms", publisher: "Fluxer", kind: "primary", date: "2026-10-05" },
  { id: "guidelines", title: "Fluxer Community Guidelines (updated 5 October 2026)", url: "https://fluxer.app/guidelines", publisher: "Fluxer", kind: "primary", date: "2026-10-05" },
  { id: "regional", title: "Regional restrictions", url: "https://fluxer.app/help/regional-restrictions", publisher: "Fluxer", kind: "primary", date: "2026-10-12" },
  { id: "min-age", title: "Minimum age requirements", url: "https://fluxer.app/help/minimum-age", publisher: "Fluxer", kind: "primary" },
  { id: "github", title: "fluxerapp/fluxer repository", url: "https://github.com/fluxerapp/fluxer", publisher: "GitHub", kind: "primary" },
  {
    id: "threads-docs",
    title: "Fluxer API docs: Threads",
    url: "https://github.com/fluxerapp/fluxer/blob/main/fluxer_docs/src/content/docs/http-api/threads.mdx",
    publisher: "GitHub",
    kind: "primary",
  },
  {
    id: "forums-docs",
    title: "Fluxer API docs: Forums",
    url: "https://github.com/fluxerapp/fluxer/blob/main/fluxer_docs/src/content/docs/http-api/forums.mdx",
    publisher: "GitHub",
    kind: "primary",
  },
  { id: "docs", title: "Fluxer API and self-hosting documentation", url: "https://docs.fluxer.app", publisher: "Fluxer", kind: "primary" },
  { id: "status", title: "Fluxer status page", url: "https://fluxerstatus.com", publisher: "Fluxer", kind: "primary" },
  { id: "wikipedia", title: "Fluxer", url: "https://en.wikipedia.org/wiki/Fluxer", publisher: "Wikipedia", kind: "secondary" },
  { id: "fluxerjs", title: "fluxer.js: From discord.js", url: "https://fluxer.js.org/guides/from-discordjs/", publisher: "fluxer.js", kind: "secondary" },
  { id: "disco-reaper", title: "DiscoReaper: Discord to Fluxer migration tool", url: "https://deepwiki.com/rambros3d/disco-reaper", publisher: "DeepWiki", kind: "secondary" },
];

export async function content(): Promise<AppContent> {
  const gt = await getGT();
  return {
    take: gt("A fast-growing, open-source Discord look-alike from Sweden that you can self-host for free with every feature, but its hosted service runs on US servers and encryption is only planned for 2026 to 2027."),
    intro: [
      gt("Fluxer is a Discord-style chat app made by Fluxer Platform AB, a tiny Swedish company, and opened to the public in January 2026. It is open source under the AGPL, has no ads and no ID checks, and lets you self-host the full version for free. Its hosted service, Fluxer.app, runs on US servers in New Jersey."),
      gt("Fluxer wins on openness, community size and desktop coverage, and its iPhone and Android apps are in public beta. SerikaCord wins on what exists today: end-to-end encrypted DMs and calls, Discord-compatible bots, threads and forums, and an operator based in the EU."),
    ],
    verdict: gt("Pick Fluxer if you want open-source software you can self-host freely, or an iPhone beta right now. Pick SerikaCord if you want encrypted private messages today, your Discord bots to work, and a service run from the EU."),
    facts: {
      operator: {
        value: gt("Fluxer Platform AB"),
        note: gt("A Swedish company registered in 2025 and run by founder Hampus Kraft with one mobile developer. No venture capital or outside investors."),
        src: ["company", "how-built"],
      },
      jurisdiction: {
        value: gt("Sweden; servers in the US"),
        note: gt("The company is in Stockholm, but Fluxer.app is hosted by Vultr in New Jersey, and the privacy policy acknowledges that US lawful-access rules can apply."),
        src: ["company", "privacy"],
      },
      businessModel: {
        value: gt("Subscriptions and donations"),
        note: gt("The optional Plutonium subscription, donations, a sold-out lifetime plan and a paid Operator Pass for self-hosters. No ads and no data sales."),
        src: ["plutonium", "pass", "how-built"],
      },
      ads: {
        status: "no",
        value: gt("No ads"),
        note: gt("The privacy policy says there are no advertising trackers and data is never shared for advertising."),
        src: ["privacy"],
      },
      pricing: {
        value: gt("Free; Plutonium optional"),
        note: gt("Plutonium costs €4.99 a month or €49.99 a year. Self-hosted instances get every Plutonium perk for free."),
        src: ["plutonium", "selfhost"],
      },
      maturity: {
        status: "partial",
        value: gt("Public since January 2026"),
        note: gt("The desktop and web apps are stable; the iPhone and Android apps are still public betas. Fluxer v2 was announced in June 2026."),
        src: ["wikipedia", "download", "v2"],
      },
      e2eeDms: {
        status: "notyet",
        value: gt("Planned"),
        note: gt("Not available today. The roadmap plans mandatory encryption using MLS, with an experimental draft in 2026 and a stable version in 2027."),
        src: ["roadmap"],
      },
      e2eeGroups: {
        status: "notyet",
        value: gt("Planned"),
        note: gt("Group DMs are planned on the same MLS timeline."),
        src: ["roadmap"],
      },
      e2eeCalls: {
        status: "notyet",
        value: gt("Planned"),
        note: gt("Planned using Discord's DAVE protocol, on the 2026 roadmap. Not available today."),
        src: ["roadmap"],
      },
      e2eeCommunity: {
        status: "no",
        note: gt("No plan has been announced for community channels."),
        src: ["roadmap"],
      },
      e2eeDefault: {
        status: "notyet",
        note: gt("Fluxer plans to make encryption mandatory for DMs and calls once it ships."),
        src: ["roadmap"],
      },
      audit: {
        status: "no",
        value: gt("No audit found"),
        note: gt("We found no independent security audit of Fluxer."),
      },
      metadata: {
        value: gt("Fluxer sees all content"),
        note: gt("Messages, files, IP addresses, device details and call metadata are stored on Fluxer's servers without end-to-end encryption."),
        src: ["privacy"],
      },
      dataUse: {
        status: "yes",
        value: gt("No selling, no trackers"),
        note: gt("The privacy policy rules out selling data, advertising trackers, analytics SDKs and training AI on your content."),
        src: ["privacy"],
      },
      phone: {
        status: "partial",
        value: gt("Sometimes"),
        note: gt("The terms don't require a phone number, but optional or conditional SMS verification exists. We couldn't confirm when it is triggered."),
        src: ["terms", "privacy"],
      },
      email: {
        status: "unknown",
        note: gt("The privacy policy says email is collected, but we couldn't confirm that it is strictly required at sign-up."),
        src: ["privacy"],
      },
      ageChecks: {
        status: "no",
        value: gt("No ID or face scans"),
        note: gt("A self-declared date of birth. In the UK, unlocking 18+ content needs a zero-value card check through Stripe. Minimum age 13 in most countries and up to 16 in some, such as Germany and the Netherlands."),
        src: ["min-age", "regional"],
      },
      servers: {
        status: "yes",
        note: gt("Discord-style communities with text and voice channels."),
        src: ["home"],
      },
      roles: {
        status: "yes",
        note: gt("Role-based permissions."),
        src: ["docs"],
      },
      threadsForums: {
        status: "partial",
        value: gt("In the API, not clearly shipped"),
        note: gt("Thread and forum APIs are documented but hidden behind a client capability flag, and both are still on the 2026 roadmap."),
        src: ["threads-docs", "forums-docs", "roadmap"],
      },
      onboarding: {
        status: "unknown",
        note: gt("We couldn't verify onboarding or rules screening features."),
      },
      modTools: {
        status: "yes",
        note: gt("Permissions, moderation tools and audit logs. We didn't find details on automatic filters like AutoMod."),
        src: ["docs", "guidelines"],
      },
      platformSafety: {
        status: "partial",
        note: gt("People make the final enforcement decisions, and Fluxer says it deals with spam waves, DDoS attacks and illegal content. We found no transparency report."),
        src: ["guidelines", "v2"],
      },
      voiceChannels: {
        status: "yes",
        note: gt("Voice runs through Fluxer's servers, with 13 voice regions listed on its status page."),
        src: ["status"],
      },
      videoScreen: {
        status: "yes",
        note: gt("Free accounts stream video and screens at 720p and 30 FPS; Plutonium unlocks 4K at 60 FPS."),
        src: ["plutonium"],
      },
      streamingStage: {
        status: "partial",
        note: gt("Screen streaming up to 4K at 60 FPS with Plutonium. We couldn't verify Stage-style channels."),
        src: ["plutonium"],
      },
      botApi: {
        status: "partial",
        note: gt("Bot accounts, an HTTP API, a gateway and webhooks. Bots use prefix commands only; slash commands and interactions are on the 2026 roadmap."),
        src: ["docs", "roadmap"],
      },
      discordBots: {
        status: "partial",
        value: gt("Discord-shaped, not compatible"),
        note: gt("The API copies Discord's shapes but has its own paths, no intents and no slash commands, so Discord bots need porting. Community libraries such as fluxer.js ease the move from discord.js."),
        src: ["docs", "fluxerjs"],
      },
      discordMigration: {
        status: "partial",
        value: gt("Third-party tools only"),
        note: gt("No official bridge or importer. Community bridges and third-party tools that claim to clone Discord servers exist; we haven't tested them."),
        src: ["disco-reaper"],
      },
      desktop: {
        status: "yes",
        note: gt("Windows and Linux on x64 and ARM64, and macOS 13 or newer on Apple silicon and Intel. Linux packages include Flathub and apt, dnf and pacman repositories."),
        src: ["download", "github"],
      },
      mobile: {
        status: "partial",
        value: gt("Public beta"),
        note: gt("Android 7 or newer through a Google Play beta or APK; iPhone and iPad through TestFlight. Not in the App Store as of October 2026."),
        src: ["download", "v2"],
      },
      web: {
        status: "yes",
        src: ["download"],
      },
      license: {
        status: "yes",
        value: gt("AGPL-3.0 (open source)"),
        note: gt("The server, web, desktop and mobile apps are AGPL-3.0. Public pull requests reopened in June 2026; feedback now goes to a separate site instead of GitHub issues."),
        src: ["github", "v2"],
      },
      selfHost: {
        status: "yes",
        value: gt("Free, full version"),
        note: gt("The same code as Fluxer.app, with no license key and every Plutonium perk unlocked. An optional €199 Operator Pass buys support and perks, not features."),
        src: ["selfhost", "pass"],
      },
      federation: {
        status: "notyet",
        note: gt("Planned: experimental in 2026 and stable in 2027, based on polyproto rather than Matrix."),
        src: ["roadmap", "home"],
      },
      uploads: {
        value: gt("25 MB per file"),
        note: gt("500 MB with Plutonium."),
        src: ["plutonium"],
      },
      groupSize: {
        status: "unknown",
        note: gt("We didn't find group DM or community member limits. Free accounts can join up to 100 communities, 200 with Plutonium."),
        src: ["plutonium"],
      },
      scale: {
        status: "yes",
        value: gt("About 500,000 accounts"),
        note: gt("Fluxer reported nearly 500,000 registered users in September 2026; these are sign-ups, not active users. Its GitHub repository has about 10,600 stars."),
        src: ["how-built", "github"],
      },
      incidents: {
        value: gt("Launch-surge outages"),
        note: gt("Major outages during the February 2026 sign-up surge after Discord's age-verification announcement, and a DNS problem in September 2026. Early criticism over a squashed code history and closed pull requests eased when public development reopened in June 2026."),
        src: ["wikipedia", "status", "v2"],
      },
    },
    whyUs: [
      {
        title: gt("Encryption you can use today"),
        text: gt("SerikaCord's DMs, group DMs and their calls are end-to-end encrypted by default for new conversations. Fluxer has no end-to-end encryption yet; its roadmap plans it for DMs and calls, experimental in 2026 and stable in 2027. Ours is new and not yet audited."),
        src: ["roadmap"],
      },
      {
        title: gt("Run from the EU, not hosted in the US"),
        text: gt("SerikaCord is run from the Netherlands under the GDPR. Fluxer is a Swedish company, but Fluxer.app is hosted on US servers in New Jersey, and its privacy policy acknowledges US lawful-access rules."),
        src: ["privacy", "company"],
      },
      {
        title: gt("Discord bots that work, with slash commands"),
        text: gt("SerikaCord's bot API follows Discord's API v10, including slash commands and interactions, so many discord.js and discord.py bots work after changing the API address. Fluxer's API looks like Discord's but isn't compatible, and its bots only support prefix commands for now."),
        src: ["docs", "roadmap"],
      },
      {
        title: gt("Threads, forums and onboarding are live"),
        text: gt("SerikaCord has threads, forum and ticket channels, onboarding questions and rules screening. Fluxer's thread and forum APIs sit behind a capability flag and are still on its 2026 roadmap, and we couldn't verify onboarding."),
        src: ["threads-docs", "roadmap"],
      },
      {
        title: gt("A built-in Discord bridge"),
        text: gt("SerikaCord's consent-based bridge mirrors messages between a Discord server and a SerikaCord server, so a community can move gradually. Fluxer has no official bridge or importer, only third-party tools."),
        src: ["disco-reaper"],
      },
      {
        title: gt("More for free"),
        text: gt("Free SerikaCord accounts get 500 MB uploads and screen sharing up to source resolution at 60 FPS. Fluxer's free tier allows 25 MB uploads and 720p at 30 FPS; matching our limits needs Plutonium."),
        src: ["plutonium"],
      },
    ],
    whyThem: [
      {
        title: gt("Open source, and self-hosting is free and complete"),
        text: gt("Fluxer is AGPL-3.0 and its self-hosted version is the same code as Fluxer.app, with no license key and every paid perk unlocked, for any use. SerikaCord is source-available: self-hosting is allowed only for personal, non-commercial use, with no official guide."),
        src: ["selfhost", "github"],
      },
      {
        title: gt("An iPhone app you can try now"),
        text: gt("Fluxer has public beta apps for iPhone and iPad through TestFlight and for Android through Google Play. SerikaCord's iPhone app is still in development and our Android app is installed from our website."),
        src: ["download"],
      },
      {
        title: gt("A bigger, faster-growing community"),
        text: gt("Fluxer reported nearly 500,000 registered users by September 2026 and has about 10,600 GitHub stars. SerikaCord is smaller and doesn't publish user numbers."),
        src: ["how-built", "github"],
      },
      {
        title: gt("Calls through servers, not peer-to-peer"),
        text: gt("Fluxer routes voice through its own servers in many regions. SerikaCord connects calls peer-to-peer where possible, which exposes your IP address to others in the call and gets heavy in large video calls."),
        src: ["status"],
      },
      {
        title: gt("Wider desktop support"),
        text: gt("Fluxer has ARM64 builds for Windows and Linux, macOS builds for Intel Macs, and Linux packages in Flathub and its own repositories. SerikaCord's macOS app needs Apple silicon."),
        src: ["download"],
      },
      {
        title: gt("Younger teens can join"),
        text: gt("Fluxer's minimum age is 13 in most countries. SerikaCord is 16 and over everywhere."),
        src: ["min-age"],
      },
    ],
    pickThem: [
      gt("you want open-source software you can self-host for free with every feature"),
      gt("you need an iPhone app, even a beta, today"),
      gt("you use an Intel Mac or an ARM64 Windows or Linux machine"),
      gt("some of your members are 13 to 15 years old"),
    ],
    pickUs: [
      gt("you want end-to-end encrypted DMs and calls now, not in 2027"),
      gt("you want your data handled by an operator in the EU rather than on US servers"),
      gt("you run Discord bots with slash commands"),
      gt("you need threads, forums or onboarding today"),
    ],
    faq: [
      {
        question: gt("Is Fluxer end-to-end encrypted?"),
        answer: gt("Not yet. Fluxer plans mandatory encryption for DMs using MLS and for calls using Discord's DAVE protocol, with experimental versions in 2026 and stable ones in 2027. Today messages are protected only in transit."),
      },
      {
        question: gt("Where is Fluxer's data stored?"),
        answer: gt("In the United States. Fluxer Platform AB is a Swedish company, but Fluxer.app runs on Vultr servers in New Jersey, and calls may route through other regions."),
      },
      {
        question: gt("Is Fluxer open source, and can I self-host it?"),
        answer: gt("Yes. Fluxer is AGPL-3.0, and the self-hosted version is the same code as Fluxer.app, free and with every Plutonium perk unlocked. An optional Operator Pass sells support, not features."),
      },
      {
        question: gt("Can I host SerikaCord myself?"),
        answer: gt("Yes, but only for personal, non-commercial use for yourself and people you invite, free for them and not open to public sign-up; commercial use needs a license from partners@serika.dev. Self-hosted instances don't connect to serika.chat, there is no official setup guide or support, and SerikaCord is not open source."),
      },
      {
        question: gt("Will my Discord bot work on Fluxer?"),
        answer: gt("Not unchanged. Fluxer's API is shaped like Discord's but uses its own paths and has no slash commands yet, so bots need porting; community libraries such as fluxer.js help. On SerikaCord many Discord bots work after changing the API address."),
      },
      {
        question: gt("Who runs Fluxer?"),
        answer: gt("Fluxer Platform AB, a Swedish company founded by Hampus Kraft, who runs it with one mobile developer. It has no outside investors and is funded by subscriptions and donations."),
      },
      {
        question: gt("Is there a Fluxer app for iPhone?"),
        answer: gt("Only a public beta through TestFlight, for iOS 16 or newer; it is not in the App Store as of October 2026. SerikaCord's iPhone app is still in development."),
      },
    ],
    couldNotVerify: [
      gt("Whether an email address is strictly required to sign up, and when SMS phone verification is triggered."),
      gt("Whether threads and forums are visible to normal users in the current apps."),
      gt("Stage-style channels and server onboarding or rules screening."),
      gt("Any independent security audit or transparency report."),
      gt("Active-user numbers: only self-reported registered users are published."),
      gt("The exact number of voice regions: the homepage says 16, the status page lists 13."),
    ],
    notes: {
      title: gt("Regional restrictions"),
      intro: gt("Fluxer publishes where its service is limited by local law."),
      points: [
        gt("Fluxer is not available in Mississippi because of the state's age-verification law, HB 1126."),
        gt("In Brazil, 18+ content is blocked and there is no way to verify your age to unlock it."),
        gt("In the UK, 18+ content can be unlocked with a zero-value card authorization through Stripe."),
      ],
      src: ["regional"],
    },
  };
}

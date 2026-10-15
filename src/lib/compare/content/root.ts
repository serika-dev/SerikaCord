import { getGT } from "gt-next/server";
import type { AppContent, CompareSource } from "../types";

/**
 * SerikaCord vs Root (rootapp.com). Facts checked on COMPARE_LAST_CHECKED_ISO
 * against the sources below (titles and publishers are proper names, not
 * translated).
 */

export const sources: CompareSource[] = [
  { id: "home", title: "Root: Not Just Chat, Built for Action", url: "https://www.rootapp.com", publisher: "Root", kind: "primary" },
  { id: "download", title: "Download Root", url: "https://www.rootapp.com/download", publisher: "Root", kind: "primary" },
  { id: "privacy", title: "Root Communications, Inc. Privacy Policy (effective 19 February 2026)", url: "https://www.rootapp.com/privacy-policy", publisher: "Root", kind: "primary", date: "2026-02-19" },
  { id: "terms", title: "Root Communications, Inc. Terms of Use (effective 19 February 2026)", url: "https://www.rootapp.com/terms-of-use", publisher: "Root", kind: "primary", date: "2026-02-19" },
  { id: "guidelines", title: "Root Community Guidelines", url: "https://www.rootapp.com/community-guidelines", publisher: "Root", kind: "primary" },
  {
    id: "old-privacy",
    title: "Root Privacy Policy dated 7 August 2025 (archived 8 February 2026)",
    url: "https://web.archive.org/web/20260208035916/https://www.rootapp.com/privacy-policy",
    publisher: "Internet Archive",
    kind: "primary",
    date: "2025-08-07",
  },
  {
    id: "old-terms",
    title: "Root Terms of Use dated 7 August 2025 (archived 9 February 2026)",
    url: "https://web.archive.org/web/20260209065221/https://www.rootapp.com/terms-of-use",
    publisher: "Internet Archive",
    kind: "primary",
    date: "2025-08-07",
  },
  {
    id: "cl-dec",
    title: "Root changelog: Discord template import, invites, video uploads",
    url: "https://www.rootapp.com/changelogs/december-10-2025",
    publisher: "Root",
    kind: "primary",
    date: "2025-12-10",
  },
  { id: "cl-feb", title: "Root changelog: Apps foundation", url: "https://www.rootapp.com/changelogs/feb-04-2026", publisher: "Root", kind: "primary", date: "2026-02-04" },
  {
    id: "cl-mar",
    title: "Root changelog: Apps beta and performance for 20k+ member communities",
    url: "https://www.rootapp.com/changelogs/march-3-2026",
    publisher: "Root",
    kind: "primary",
    date: "2026-03-03",
  },
  {
    id: "beta",
    title: "The Future of Root: Closed Beta Begins",
    url: "https://www.rootapp.com/blogs/the-future-of-root-closed-beta-begins",
    publisher: "Root",
    kind: "primary",
    date: "2025-08-27",
  },
  {
    id: "x-beta",
    title: "Closed-beta badge for users who joined before 19 December 2025",
    url: "https://x.com/rootappofficial/status/2037235637422539233",
    publisher: "Root on X",
    kind: "primary",
    date: "2026-03",
  },
  { id: "ask-root", title: "Ask Root, Episode 1 (CEO Q&A)", url: "https://www.rootapp.com/blogs/ask-root-episode-1", publisher: "Root", kind: "primary", date: "2026-06-05" },
  { id: "sudo", title: "Introducing Root Sudo", url: "https://www.rootapp.com/blogs/introducing-root-sudo", publisher: "Root", kind: "primary", date: "2026-06-18" },
  {
    id: "devprogram",
    title: "Announcing Root's Developer Program",
    url: "https://www.rootapp.com/blogs/announcing-roots-developer-program",
    publisher: "Root",
    kind: "primary",
    date: "2026-06-25",
  },
  { id: "devdocs", title: "Root Developer Documentation", url: "https://docs.rootapp.com/llms.txt", publisher: "Root", kind: "primary" },
  { id: "help", title: "Root Help Center", url: "https://support.rootapp.com/llms-full.txt", publisher: "Root", kind: "primary" },
  { id: "sudo-faq", title: "Sudo FAQs", url: "https://support.rootapp.com/docs/sudo/get-started/sudo-faqs", publisher: "Root", kind: "primary" },
  { id: "levels", title: "Community levels", url: "https://support.rootapp.com/llms/leader/cores-and-levels/community-levels.md", publisher: "Root", kind: "primary" },
  {
    id: "import",
    title: "Import a Discord server template",
    url: "https://support.rootapp.com/llms/leader/community/import-discord-template.md",
    publisher: "Root",
    kind: "primary",
  },
  { id: "github", title: "RootPlatform on GitHub (SDK samples and DevKit)", url: "https://github.com/RootPlatform", publisher: "GitHub", kind: "primary" },
  { id: "appstore", title: "Root on the App Store", url: "https://apps.apple.com/us/app/root-build-real-communities/id6742028281", publisher: "Apple", kind: "primary" },
  { id: "play", title: "Root: Built for Community on Google Play", url: "https://play.google.com/store/apps/details?id=com.rootapp.mobile", publisher: "Google Play", kind: "primary" },
  {
    id: "funding",
    title: "Root Raises $9M in Funding to Build a Next-Gen Discord",
    url: "https://www.gamedeveloper.com/press-release/root-raises-9m-in-funding-to-build-a-next-gen-discord",
    publisher: "Game Developer",
    kind: "primary",
    date: "2025-06-17",
  },
  { id: "funding-pr", title: "Root seed round press release", url: "https://pressreleases.triplepointpr.com/?p=27214", publisher: "Triple Point PR", kind: "primary", date: "2025-06-17" },
  {
    id: "piunika",
    title: "Root in damage control mode after privacy policy backlash",
    url: "https://piunikaweb.com/2026/02/18/root-in-damage-control-mode-after-privacy-policy-backlash/",
    publisher: "PiunikaWeb",
    kind: "secondary",
    date: "2026-02-18",
  },
];

export async function content(): Promise<AppContent> {
  const gt = await getGT();
  return {
    take: gt("A funded, Discord-like app whose standout is real GUI apps inside channels, like task boards and raid planners. But it is closed source, has no end-to-end encryption and no browser version."),
    intro: [
      gt("Root is a Discord-style community app from Root Communications, a US startup that raised a $9 million seed round in 2025. Its big idea is ‘apps’: full mini-programs such as task trackers, raid planners and polls that run inside a channel, built with Root's own TypeScript SDK and hosted in Root's cloud."),
      gt("SerikaCord takes a different route: end-to-end encrypted DMs, a Discord-compatible bot API, a browser app and an EU home. Root wins on in-channel apps, funding and native iPhone and Android apps from the stores; SerikaCord wins on private messages, Discord bot compatibility, forums and onboarding, and running in a browser."),
    ],
    verdict: gt("If your community lives on planning tools, raid schedules or custom mini-apps, Root does something nobody else does. If you want encrypted DMs, your existing Discord bots and a browser app, SerikaCord fits better."),
    facts: {
      operator: {
        value: gt("Root Communications, Inc."),
        note: gt("A venture-backed US startup founded in 2023, led by founder and CEO Jesse Dietrichson. It raised a $9 million seed round in June 2025, led by Headline and Konvoy Ventures."),
        src: ["funding", "funding-pr"],
      },
      jurisdiction: {
        value: gt("United States"),
        note: gt("Based in Los Angeles, with California law governing its terms. Data is stored in the United States."),
        src: ["terms", "privacy"],
      },
      businessModel: {
        value: gt("Subscription and paid upgrades"),
        note: gt("The Root Sudo subscription and ‘cores’ that raise a community's level, which unlocks slots for third-party apps and bots, a vanity invite and a Discovery listing. A developer app store is planned."),
        src: ["sudo", "levels", "devprogram"],
      },
      ads: {
        status: "no",
        value: gt("No in-app ads"),
        note: gt("We found no ads in the app. The marketing website uses Google Analytics, and the policy in force until February 2026 described cookies used for ads on other websites."),
        src: ["privacy", "old-privacy"],
      },
      pricing: {
        value: gt("Free; Sudo optional"),
        note: gt("Sudo adds HD screen share up to 1440p at 60 FPS, a badge and one core a month, and can only be bought on desktop. We couldn't find published prices for Sudo or cores."),
        src: ["sudo", "sudo-faq"],
      },
      maturity: {
        status: "partial",
        value: gt("Open beta (v0.9)"),
        note: gt("Closed beta from August 2025, open to everyone since about December 2025. Still pre-1.0 in October 2026."),
        src: ["beta", "x-beta", "appstore"],
      },
      e2eeDms: {
        status: "no",
        note: gt("The privacy policy only describes encryption in transit (TLS). Messages, pictures and files are stored on Root's servers."),
        src: ["privacy"],
      },
      e2eeGroups: { status: "no", src: ["privacy"] },
      e2eeCalls: {
        status: "no",
        note: gt("Root doesn't claim end-to-end encryption for calls."),
        src: ["privacy"],
      },
      e2eeCommunity: { status: "no", src: ["privacy"] },
      e2eeDefault: {
        status: "no",
        value: gt("No E2EE"),
        src: ["privacy"],
      },
      audit: {
        status: "no",
        note: gt("We found no published independent security audit."),
      },
      metadata: {
        value: gt("Root can see all content"),
        note: gt("Messages, files, device type, IP address, approximate location and feature-usage analytics are collected and stored in the US."),
        src: ["privacy"],
      },
      dataUse: {
        status: "partial",
        value: gt("No selling or AI training"),
        note: gt("Since 19 February 2026 the policy says Root doesn't sell user data or train AI on it. The website uses Google Analytics, and data can transfer if the company is sold."),
        src: ["privacy", "play"],
      },
      phone: {
        status: "no",
        value: gt("Not required"),
        note: gt("We found no phone number requirement."),
        src: ["help"],
      },
      email: {
        status: "yes",
        value: gt("Required"),
        note: gt("Sign-up uses a username, email and password. Passkeys are supported."),
        src: ["help"],
      },
      ageChecks: {
        status: "no",
        value: gt("Self-declared"),
        note: gt("No ID or face scans. Minimum age 16, and 16 and 17 year olds need a parent's consent. 18+ communities use an ‘I am 18 or older’ click-through. The App Store rates Root 16+, while Google Play lists it for Everyone."),
        src: ["terms", "help", "guidelines", "appstore", "play"],
      },
      servers: {
        status: "yes",
        note: gt("Communities with text, voice and app channels, channel groups and tabs for switching between communities."),
        src: ["help"],
      },
      roles: {
        status: "yes",
        note: gt("Roles with colors and per-channel visibility and permissions. Role management on mobile arrived in February 2026."),
        src: ["help", "cl-feb"],
      },
      threadsForums: {
        status: "no",
        note: gt("We found no message threads or forum channels in the help center. A Suggestions app offers board-style voting."),
        src: ["help"],
      },
      onboarding: {
        status: "partial",
        note: gt("No Discord-style onboarding or rules screening found. Communities can require a verified email to join."),
        src: ["help"],
      },
      modTools: {
        status: "partial",
        note: gt("Kick, ban (including by user ID), an action log, join throttling, an email gate and a Moderation app with word and spam filters. We didn't find timeouts documented."),
        src: ["help"],
      },
      platformSafety: {
        status: "partial",
        note: gt("Message and user reporting, and uploads are scanned for child sexual abuse material. We found no transparency report."),
        src: ["help", "privacy"],
      },
      voiceChannels: {
        status: "yes",
        note: gt("Each voice channel has its own text chat. Push-to-talk and an in-game overlay on desktop."),
        src: ["help"],
      },
      videoScreen: {
        status: "yes",
        note: gt("Video and screen share, with per-app audio capture on Windows. HD screen share up to 1440p at 60 FPS needs Sudo."),
        src: ["help", "sudo"],
      },
      streamingStage: {
        status: "partial",
        note: gt("Screen-share streaming in voice channels and a streamer mode. We found no Stage-style channels."),
        src: ["help"],
      },
      botApi: {
        status: "yes",
        value: gt("Own SDK, hosted by Root"),
        note: gt("Bots and full in-channel apps are written in TypeScript with Root's SDK and run in Root's cloud. A community without cores has no slots for third-party apps or bots."),
        src: ["devdocs", "levels", "devprogram"],
      },
      discordBots: {
        status: "no",
        note: gt("Root's bot API is its own, so Discord bots have to be rewritten."),
        src: ["devdocs"],
      },
      discordMigration: {
        status: "partial",
        value: gt("Structure only"),
        note: gt("Since December 2025 you can paste a Discord server template link to recreate roles, channels and permissions. Members, messages, emoji and bots aren't imported, and there is no bridge."),
        src: ["import", "cl-dec"],
      },
      desktop: {
        status: "yes",
        note: gt("Windows and Linux (x64 and Arm64) and macOS (Apple silicon and Intel). Linux is offered as an AppImage only."),
        src: ["download"],
      },
      mobile: {
        status: "yes",
        note: gt("Android and iPhone, from Google Play and the App Store."),
        src: ["appstore", "play"],
      },
      web: {
        status: "no",
        note: gt("We found no browser version; you need the desktop or mobile app."),
        src: ["download"],
      },
      license: {
        status: "no",
        value: gt("Proprietary"),
        note: gt("The apps, servers and app runtime are closed source. Only SDK samples and a developer kit are public on GitHub."),
        src: ["github"],
      },
      selfHost: {
        status: "no",
        note: gt("Root's CEO said in June 2026 that self-hosting is wanted ‘down the road’, without a date. Third-party apps and bots run in Root's cloud."),
        src: ["ask-root", "devdocs"],
      },
      federation: { status: "no" },
      uploads: {
        status: "unknown",
        note: gt("We couldn't find Root's free attachment size limit. Messages can carry up to 10 attachments."),
        src: ["help"],
      },
      groupSize: {
        status: "unknown",
        note: gt("We found no published limits. A March 2026 update improved performance for communities with more than 20,000 members."),
        src: ["cl-mar"],
      },
      scale: {
        status: "unknown",
        value: gt("100K+ Android installs"),
        note: gt("Root publishes no user count. In October 2026 Google Play showed 100,000+ installs and the App Store 130 ratings."),
        src: ["play", "appstore"],
      },
      incidents: {
        value: gt("Policy backlash, February 2026"),
        note: gt("Users criticized Root's old privacy policy and terms in February 2026. Root said they didn't reflect its practice and replaced them on 19 February 2026. We found no data breach."),
        src: ["piunika", "old-privacy", "privacy"],
      },
    },
    whyUs: [
      {
        title: gt("Your private messages are end-to-end encrypted"),
        text: gt("SerikaCord encrypts DMs and group DMs, including their calls, end to end by default for new conversations. Root has no end-to-end encryption anywhere; its privacy policy only describes encryption in transit. Our encryption is new and not yet audited."),
        src: ["privacy"],
      },
      {
        title: gt("Works in a browser"),
        text: gt("Everything in SerikaCord works on the web, so a friend can join from any computer without installing anything. Root needs its desktop or mobile app."),
        src: ["download"],
      },
      {
        title: gt("Your Discord bots and a live bridge"),
        text: gt("SerikaCord's bot API follows Discord's API v10, so many discord.js and discord.py bots run after changing the API address, and a consent-based bridge mirrors a Discord server while you move. Root bots must be rewritten for its own SDK. Root can copy a Discord server's roles and channels from a template, which we can't."),
        src: ["devdocs", "import"],
      },
      {
        title: gt("Threads, forums and onboarding"),
        text: gt("SerikaCord has threads, forum and ticket channels, onboarding questions, rules screening and AutoMod. We found no threads, forum channels or onboarding flow in Root's help center."),
        src: ["help"],
      },
      {
        title: gt("EU-based, and code you can read"),
        text: gt("SerikaCord is run from the Netherlands under the GDPR, and its source code is public, though not open source. Root is a US company with closed-source apps. Root's current policy also rules out selling data and AI training, so the gap is mostly jurisdiction and transparency."),
        src: ["privacy", "github"],
      },
    ],
    whyThem: [
      {
        title: gt("Real apps inside your channels"),
        text: gt("Root's apps are full interfaces inside a channel: Task Tracker, Raid Planner, polls, Suggestions, community analytics and Minecraft server control, with a TypeScript SDK for building your own. SerikaCord has bots and polls but nothing like this."),
        src: ["home", "devdocs", "devprogram", "cl-mar"],
      },
      {
        title: gt("iPhone and Android apps from the stores"),
        text: gt("Root has native apps on the App Store and Google Play. SerikaCord has no iPhone app yet, and its Android app is installed from our website."),
        src: ["appstore", "play"],
      },
      {
        title: gt("Copy a Discord server's structure in one step"),
        text: gt("Paste a Discord server template link and Root recreates its roles, channels and permission overwrites. SerikaCord has a bridge but no importer, so you set up your server by hand."),
        src: ["import"],
      },
      {
        title: gt("Funding and a bigger reach"),
        text: gt("Root has $9 million in seed funding and more than 100,000 Android installs. SerikaCord is run by a small team with a small community and publishes no user numbers."),
        src: ["funding", "play"],
      },
      {
        title: gt("Desktop extras for gamers"),
        text: gt("Root's desktop apps include an in-game overlay, per-app audio capture when screen sharing on Windows, and Arm64 builds for Windows and Linux."),
        src: ["help", "download"],
      },
    ],
    pickThem: [
      gt("you want task boards, raid planners or other apps inside your channels"),
      gt("many of your members use iPhones and want an App Store app"),
      gt("you want to copy a Discord server's roles and channels in one step"),
      gt("you want to build GUI mini-apps for your community without running your own server"),
    ],
    pickUs: [
      gt("you want your DMs end-to-end encrypted"),
      gt("you want to chat in a browser without installing anything"),
      gt("you want to keep running your Discord bots or bridge a Discord server"),
      gt("you need threads, forum channels or onboarding screening"),
      gt("you prefer a service run from the EU"),
    ],
    faq: [
      {
        question: gt("Is Root end-to-end encrypted?"),
        answer: gt("No. Root's privacy policy only describes encryption between your device and its servers, and messages, pictures and files are stored on those servers. SerikaCord encrypts DMs and group DMs end to end."),
      },
      {
        question: gt("Does Root sell my data or train AI on it?"),
        answer: gt("Root's current privacy policy, effective 19 February 2026, says it doesn't sell user data or train AI on it. The older documents from August 2025 had a broad license to share user content and mentioned ad cookies, but the archived versions we read did not say Root sells data or trains AI."),
      },
      {
        question: gt("Who runs Root?"),
        answer: gt("Root Communications, Inc., a startup in Los Angeles led by CEO Jesse Dietrichson. It raised a $9 million seed round in June 2025."),
      },
      {
        question: gt("Is Root open source, and can I self-host it?"),
        answer: gt("No. Root's apps and servers are closed source, and only SDK samples are public. Its CEO has said self-hosting is wanted eventually, but gave no date."),
      },
      {
        question: gt("Can I move my Discord server to Root?"),
        answer: gt("Partly. Root can recreate roles, channels and permissions from a Discord server template link. Messages, members, emoji and bots don't come along, and Discord bots must be rewritten for Root's SDK."),
      },
      {
        question: gt("Can I use Root in a browser?"),
        answer: gt("We found no browser version. Root runs as a desktop app on Windows, macOS and Linux and as a mobile app on iPhone and Android. SerikaCord works fully in the browser."),
      },
      {
        question: gt("Do Root bots cost money?"),
        answer: gt("Root's own apps are free, but a community needs ‘cores’, from a Sudo subscription or bought separately, to get slots for third-party apps and bots. We couldn't find published prices."),
      },
    ],
    couldNotVerify: [
      gt("Prices for Root Sudo and for individually bought cores; neither is published on Root's website or help center."),
      gt("Any official user count from Root."),
      gt("Root's free attachment size limit."),
      gt("The exact date the open beta began; we only know closed-beta badges went to people who joined before 19 December 2025."),
      gt("Versions of Root's policies from before August 2025, which we didn't check."),
      gt("Whether Root publishes a transparency report on law enforcement requests; we found none."),
    ],
    notes: {
      title: gt("Root's old and new privacy documents"),
      intro: gt("Root rewrote its terms and privacy policy in February 2026 after a public backlash. We read the archived and current versions on 15 October 2026; this is what they say."),
      points: [
        gt("The privacy policy in force until 19 February 2026, dated 7 August 2025, said Root may collect voice, video or screen-sharing calls, and described Google Analytics and cookies used to show ads on other websites."),
        gt("The terms dated 7 August 2025 gave Root a broad, transferable license to user content, including to disclose it to third parties for any purpose."),
        gt("The rewritten terms and privacy policy, effective 19 February 2026, say Root doesn't sell user data or train AI on user data or content, drop the wording about collecting calls and narrow the content license."),
        gt("Some posts and comparison sites say the old documents explicitly allowed selling data or training AI. The archived August 2025 versions we read don't say that; they contain the broad disclosure license and ad cookies described above."),
        gt("Root said on X that the old legal text didn't reflect its actual practice, and its CEO later described the old documents as placeholders from before the open beta."),
      ],
      src: ["old-privacy", "old-terms", "privacy", "terms", "piunika"],
    },
  };
}

import { getGT } from "gt-next/server";
import type { AppContent, CompareSource } from "../types";

/**
 * SerikaCord vs GameVox. Facts checked on COMPARE_LAST_CHECKED_ISO against
 * the sources below (titles and publishers are proper names, not translated).
 */

export const sources: CompareSource[] = [
  { id: "home", title: "GameVox homepage", url: "https://gamevox.com", publisher: "GameVox", kind: "primary" },
  { id: "pricing", title: "GameVox pricing", url: "https://gamevox.com/pricing", publisher: "GameVox", kind: "primary" },
  { id: "about", title: "About GameVox", url: "https://gamevox.com/about", publisher: "GameVox", kind: "primary" },
  { id: "company", title: "Company information (LightSpeed Gaming LLC)", url: "https://gamevox.com/company-info", publisher: "GameVox", kind: "primary" },
  { id: "press", title: "GameVox press kit", url: "https://gamevox.com/press", publisher: "GameVox", kind: "primary" },
  { id: "self-hosted", title: "Self-Hosted Server", url: "https://gamevox.com/self-hosted", publisher: "GameVox", kind: "primary" },
  { id: "relay", title: "Discord Relay", url: "https://gamevox.com/integrations/discord-relay", publisher: "GameVox", kind: "primary" },
  { id: "compare", title: "GameVox vs Discord", url: "https://gamevox.com/compare-discord/", publisher: "GameVox", kind: "primary" },
  { id: "privacy", title: "GameVox Privacy Policy (updated 6 August 2026)", url: "https://gamevox.com/privacy", publisher: "GameVox", kind: "primary", date: "2026-08-06" },
  { id: "terms", title: "GameVox Terms (updated 7 June 2026)", url: "https://gamevox.com/terms", publisher: "GameVox", kind: "primary", date: "2026-06-07" },
  { id: "blog", title: "GameVox blog (open beta announcement and changelogs)", url: "https://gamevox.com/blog/", publisher: "GameVox", kind: "primary" },
  {
    id: "blog-privacy",
    title: "Voice Chat Privacy: What Data Do Apps Actually Collect?",
    url: "https://gamevox.com/blog/voice-chat-privacy/",
    publisher: "GameVox",
    kind: "primary",
    date: "2026-02-25",
  },
  { id: "devportal", title: "GameVox Developer Portal", url: "https://developers.gamevox.com", publisher: "GameVox", kind: "primary" },
  { id: "github", title: "gamevoxvoice on GitHub", url: "https://github.com/gamevoxvoice", publisher: "GitHub", kind: "primary" },
  { id: "play", title: "GameVox on Google Play", url: "https://play.google.com/store/apps/details?id=com.gamevox.android", publisher: "Google Play", kind: "primary" },
  { id: "appstore", title: "GameVox on the App Store", url: "https://apps.apple.com/us/app/gamevox/id6757317637", publisher: "Apple App Store", kind: "primary", date: "2026-03-04" },
  {
    id: "pcgamer",
    title: "I've tested three free Discord alternatives in a desperate attempt not to offer up my personal data",
    url: "https://www.pcgamer.com/hardware/ive-tested-three-free-discord-alternatives-in-a-desperate-attempt-not-to-offer-up-my-personal-data-just-to-talk-to-my-favorite-weirdos/",
    publisher: "PC Gamer",
    kind: "secondary",
    date: "2026-02-12",
  },
];

export async function content(): Promise<AppContent> {
  const gt = await getGT();
  return {
    take: gt("A gaming voice app with generous free limits, apps on every platform and the best Discord import we've seen. But it's an open beta, closed source, and its own documents disagree on encryption and tracking."),
    intro: [
      gt("GameVox is a Discord-style app for gamers from LightSpeed Gaming, an Ohio company that has hosted voice servers since 2004 and says it bought Ventrilo in 2023. It launched in 2026 and is in open beta, with servers, voice and video, an in-game overlay, per-server paid tiers and a paid self-hosted server option."),
      gt("GameVox beats SerikaCord on moving from Discord (it can import a whole server's structure), on having an iPhone app, and on gaming extras like positional voice for roleplay servers. SerikaCord is ahead on documented encryption for DMs, on privacy (no analytics or ad pixels) and on free servers without member caps."),
    ],
    verdict: gt("If you want to copy your Discord server over in one step and need an iPhone app, GameVox is worth a look. If you care about encrypted DMs, no trackers and an EU-based operator, pick SerikaCord."),
    facts: {
      operator: {
        value: gt("LightSpeed Gaming LLC"),
        note: gt("A small, self-funded company formed in 2004 that trades as GameVox and says it bought Ventrilo in 2023. GameVox itself launched in 2026."),
        src: ["company", "about"],
      },
      jurisdiction: {
        value: gt("United States (Ohio)"),
        note: gt("Hosted on AWS in several regions. The privacy policy says an EU representative is still to be appointed."),
        src: ["company", "privacy"],
      },
      businessModel: {
        value: gt("Per-server subscriptions"),
        note: gt("A server owner pays for a tier that unlocks features for every member; self-hosted server licenses are sold too. No investors, according to its About page."),
        src: ["pricing", "about"],
      },
      ads: {
        status: "no",
        value: gt("No in-app ads"),
        note: gt("No ads in the app. The website and web app load a Reddit advertising pixel (see data use)."),
        src: ["privacy"],
      },
      pricing: {
        value: gt("Free; paid tiers per server"),
        note: gt("Free servers hold up to 100 members. Silver costs $4.99, Gold $9.99 and Diamond $19.99 a month per server; a self-hosted license costs $2 a month, $15 a year or $70 once."),
        src: ["pricing"],
      },
      maturity: {
        status: "partial",
        value: gt("Open beta since March 2026"),
        note: gt("Introduced in January 2026. The bot platform is labelled experimental."),
        src: ["blog", "devportal"],
      },
      e2eeDms: {
        status: "no",
        note: gt("Text is encrypted only in transit to GameVox's servers."),
        src: ["privacy"],
      },
      e2eeGroups: {
        status: "no",
        note: gt("Same as DMs: encrypted in transit only."),
        src: ["privacy"],
      },
      e2eeCalls: {
        status: "unknown",
        value: gt("Claimed, unverified"),
        note: gt("The press kit and Google Play listing say voice chat is end-to-end encrypted, but the privacy policy only describes standard call encryption through a media server. See the notes below."),
        src: ["press", "play", "privacy"],
      },
      e2eeCommunity: {
        status: "no",
        note: gt("Server text channels are encrypted in transit only. See calls for the voice claim."),
        src: ["privacy"],
      },
      e2eeDefault: {
        status: "unknown",
        note: gt("We couldn't verify whether any end-to-end encryption is on, by default or at all."),
      },
      audit: {
        status: "no",
        value: gt("None published"),
        note: gt("We found no audit, and the code is closed, so the encryption claims can't be checked from outside."),
        src: ["github"],
      },
      metadata: {
        value: gt("GameVox sees text"),
        note: gt("Messages and files are stored on GameVox's servers, along with IP addresses, device details and usage data. The policy says calls are not recorded."),
        src: ["privacy"],
      },
      dataUse: {
        status: "partial",
        value: gt("Analytics and ad pixel"),
        note: gt("GameVox says it doesn't sell data, but it uses Google Analytics on the website and in the app, and a Reddit ad conversion pixel on the website and web app."),
        src: ["privacy"],
      },
      phone: {
        status: "no",
        value: gt("Not required"),
        src: ["home"],
      },
      email: {
        status: "no",
        value: gt("Not required"),
        note: gt("You sign up with a username and password. An email address is needed to create bots."),
        src: ["home", "devportal"],
      },
      ageChecks: {
        status: "no",
        value: gt("No ID or face scans"),
        note: gt("Minimum age 13; no date of birth or ID asked for at sign-up."),
        src: ["home", "terms"],
      },
      servers: {
        status: "yes",
        note: gt("Servers with text, voice and file-sharing channels. Free servers get up to 5 voice and 8 text channels."),
        src: ["pricing", "play"],
      },
      roles: {
        status: "yes",
        note: gt("Roles with colors and per-channel overrides."),
        src: ["compare"],
      },
      threadsForums: {
        status: "partial",
        value: gt("Forums; threads unclear"),
        note: gt("Forum channels are listed in the Play Store description and press kit. We couldn't confirm threads."),
        src: ["play", "press"],
      },
      onboarding: {
        status: "partial",
        note: gt("Server applications on Gold and higher. We found no Discord-style onboarding questions."),
        src: ["pricing"],
      },
      modTools: {
        status: "partial",
        note: gt("AutoMod with keyword, link and toxicity filters, with advanced rules on Gold. In February 2026 PC Gamer found a default filter censoring swear words."),
        src: ["pricing", "pcgamer"],
      },
      platformSafety: {
        status: "partial",
        note: gt("GameVox says it cooperates with law enforcement and reports child abuse material to NCMEC. We found no transparency report."),
        src: ["privacy"],
      },
      voiceChannels: {
        status: "yes",
        note: gt("Opus voice with noise suppression, push-to-talk and per-user volume: 64 kbps free, up to 256 kbps on Diamond. In PC Gamer's February 2026 test one participant couldn't be heard."),
        src: ["pricing", "pcgamer"],
      },
      videoScreen: {
        status: "yes",
        note: gt("Video and screen sharing with audio: 1080p at 30 FPS free, up to 4K at 60 FPS on Diamond. PC Gamer saw video feeds fail to load in February 2026."),
        src: ["pricing", "pcgamer"],
      },
      streamingStage: {
        status: "partial",
        note: gt("A ‘Music & Video DJ’ feature broadcasts to the whole server. We couldn't confirm Stage-style events."),
        src: ["home"],
      },
      botApi: {
        status: "partial",
        value: gt("Experimental"),
        note: gt("A developer portal with bots and webhooks, labelled experimental."),
        src: ["devportal"],
      },
      discordBots: {
        status: "partial",
        value: gt("Claimed compatible"),
        note: gt("GameVox says discord.js, discord.py, JDA and Eris bots run after pointing them at its API and gateway. We couldn't check how much works beyond the test bot it publishes."),
        src: ["devportal", "github"],
      },
      discordMigration: {
        status: "yes",
        value: gt("Server import and two-way relay"),
        note: gt("Copies a Discord server's channels, categories, roles, permissions, emoji, soundboard, events and rules (not messages), and relays chat both ways through your own Discord bot, with a 500-message backfill."),
        src: ["relay", "compare"],
      },
      desktop: {
        status: "yes",
        note: gt("Windows, macOS and Linux, with an in-game overlay."),
        src: ["home"],
      },
      mobile: {
        status: "yes",
        note: gt("Android on Google Play and iPhone on the App Store since March 2026."),
        src: ["play", "appstore"],
      },
      web: {
        status: "yes",
        src: ["home"],
      },
      license: {
        status: "no",
        value: gt("Proprietary"),
        note: gt("Closed source. The only public code is a fork of a third-party Discord bot."),
        src: ["github"],
      },
      selfHost: {
        status: "partial",
        value: gt("Paid, needs GameVox's cloud"),
        note: gt("A paid server keeps messages, files, voice and video on your hardware, but accounts, sign-in and billing stay on GameVox's cloud, and the server updates itself and needs GameVox online."),
        src: ["self-hosted"],
      },
      federation: {
        status: "no",
        note: gt("One central service; self-hosted servers still sign in through GameVox."),
        src: ["self-hosted"],
      },
      uploads: {
        value: gt("500 MB per file"),
        note: gt("2 GB total storage per free server; up to 10 GB per file on Diamond."),
        src: ["pricing"],
      },
      groupSize: {
        value: gt("100 members free"),
        note: gt("200 on Silver, 500 on Gold and unlimited on Diamond."),
        src: ["pricing"],
      },
      scale: {
        status: "unknown",
        value: gt("Small; no numbers"),
        note: gt("GameVox publishes no user numbers. On 15 October 2026 Google Play showed 5,000+ installs and the iPhone app had 8 ratings."),
        src: ["play", "appstore"],
      },
      incidents: {
        value: gt("Rough beta"),
        note: gt("PC Gamer's February 2026 test hit video feeds that wouldn't load, a participant who couldn't be heard and repeated password resets. See the notes for conflicts in GameVox's own documents."),
        src: ["pcgamer"],
      },
    },
    whyUs: [
      {
        title: gt("DMs encrypted by default, with a public design"),
        text: gt("SerikaCord's DMs and group DMs are end-to-end encrypted by default, and our design and its limits are published. GameVox doesn't encrypt text end to end, and its claim of encrypted voice conflicts with its own privacy policy. Our encryption hasn't been audited either."),
        src: ["privacy", "press"],
      },
      {
        title: gt("No analytics or ad pixels"),
        text: gt("SerikaCord uses no advertising trackers. GameVox's privacy policy lists Google Analytics in the app and a Reddit ad pixel on the web, while its Google Play label says no data is collected."),
        src: ["privacy", "play"],
      },
      {
        title: gt("Free servers without member caps"),
        text: gt("SerikaCord servers are free, with no small member cap. GameVox's free servers are capped at 100 members, 5 voice and 8 text channels, and custom emoji need a paid tier."),
        src: ["pricing"],
      },
      {
        title: gt("Code you can read"),
        text: gt("SerikaCord's code is public on GitHub (source-available, not open source), so anyone can check how encryption and data handling work. GameVox is closed source."),
        src: ["github"],
      },
      {
        title: gt("Based in the EU"),
        text: gt("SerikaCord is run from the Netherlands under the GDPR. GameVox is a US company and says it hasn't yet appointed an EU representative."),
        src: ["privacy"],
      },
    ],
    whyThem: [
      {
        title: gt("A stronger Discord import"),
        text: gt("GameVox can copy a Discord server's channels, roles, permissions, emoji, soundboard and events in one go, then relay chat both ways. SerikaCord has a bridge but no importer, so you set up your server again by hand."),
        src: ["relay", "compare"],
      },
      {
        title: gt("Apps in both app stores"),
        text: gt("GameVox has an iPhone app on the App Store and an Android app on Google Play. SerikaCord has no iPhone app yet, and its Android app is downloaded from our website."),
        src: ["appstore", "play"],
      },
      {
        title: gt("Calls routed through servers"),
        text: gt("GameVox calls go through media servers in several regions, so other people in a call don't see your IP address. SerikaCord connects calls peer-to-peer where possible, which exposes your IP address and gets heavy in large calls."),
        src: ["privacy"],
      },
      {
        title: gt("Gaming extras"),
        text: gt("GameVox has positional voice for FiveM, RedM, RAGE:MP and alt:V roleplay servers, an in-game overlay, voice effects, a soundboard and a music and video DJ. SerikaCord has none of these gaming-specific tools."),
        src: ["home", "pricing"],
      },
      {
        title: gt("Younger users and no email"),
        text: gt("GameVox accepts users from 13 and needs only a username and password. SerikaCord is 16 and over everywhere and needs an email address."),
        src: ["terms", "home"],
      },
      {
        title: gt("Self-hosting you can buy"),
        text: gt("For $70 once, GameVox's self-hosted server keeps messages, files and calls on your own hardware, though sign-in still goes through GameVox. SerikaCord's self-hosting is for personal, non-commercial use only, with no setup guide or support."),
        src: ["self-hosted", "pricing"],
      },
    ],
    pickThem: [
      gt("you want to copy your Discord server's channels, roles and emoji in one step"),
      gt("many of your members use iPhones"),
      gt("you run a FiveM or similar roleplay community and want positional voice"),
      gt("you'd rather calls went through servers than peer-to-peer"),
    ],
    pickUs: [
      gt("you want end-to-end encrypted DMs with a published design"),
      gt("you don't want analytics or ad pixels in your chat app"),
      gt("you want a free server without a 100-member cap"),
      gt("you prefer a service run from the EU under the GDPR"),
    ],
    faq: [
      {
        question: gt("Is GameVox end-to-end encrypted?"),
        answer: gt("Text isn't. GameVox's press kit and Google Play listing say voice chat is end-to-end encrypted, but its privacy policy only describes standard call encryption through a media server, and the code is closed, so we couldn't verify the claim."),
      },
      {
        question: gt("Who makes GameVox? Is it Ventrilo?"),
        answer: gt("GameVox is made by LightSpeed Gaming LLC, an Ohio company formed in 2004 that says it bought Ventrilo in 2023. GameVox is a separate, new app that launched in 2026."),
      },
      {
        question: gt("Is GameVox free?"),
        answer: gt("Yes, with limits: free servers hold up to 100 members, with 5 voice and 8 text channels and 500 MB uploads. Paid tiers cost $4.99 to $19.99 a month per server and unlock features for every member."),
      },
      {
        question: gt("Can I move my Discord server to GameVox?"),
        answer: gt("Yes. GameVox can import a Discord server's channels, roles, permissions and emoji (not messages) and relay chat both ways. SerikaCord offers a consent-based bridge but no importer."),
      },
      {
        question: gt("Will my Discord bot work on GameVox?"),
        answer: gt("GameVox says discord.js, discord.py, JDA and Eris bots work after changing the API address, but its bot platform is labelled experimental. SerikaCord's bot API also follows Discord's; test your bot on either first."),
      },
      {
        question: gt("Is GameVox open source? Can I self-host it?"),
        answer: gt("It is closed source. You can buy a self-hosted server that keeps your messages and calls on your hardware, but accounts and sign-in still run through GameVox's cloud."),
      },
      {
        question: gt("Does GameVox collect my data?"),
        answer: gt("Its privacy policy says it stores messages, files, IP addresses and usage data, uses Google Analytics on the website and in the app, and loads a Reddit ad pixel on the web. It says it doesn't sell data."),
      },
    ],
    couldNotVerify: [
      gt("Whether GameVox voice is really end-to-end encrypted; we found no technical documentation."),
      gt("GameVox's 2023 purchase of Ventrilo, which only the company itself states."),
      gt("How many people use GameVox."),
      gt("Whether GameVox has threads or Stage-style events."),
      gt("Whether the swear filter PC Gamer saw in February 2026 is still on by default."),
      gt("How much of GameVox's Discord-compatible bot API works beyond its own test bot."),
    ],
    notes: {
      title: gt("Where GameVox's own documents disagree"),
      intro: gt("We found these conflicts on 15 October 2026. We list what each document says, without guessing why."),
      points: [
        gt("Voice encryption: the press kit and Google Play listing say voice chat is end-to-end encrypted (X25519 and NaCl secretbox), and the homepage lists voice E2EE. The privacy policy (updated 6 August 2026) only describes standard WebRTC call encryption (SRTP over DTLS) through a media server, and doesn't mention end-to-end encryption."),
        gt("Data collection: the Google Play data safety label says no data is collected or shared. The privacy policy says Google Analytics runs in the app and on the website, and a Reddit advertising pixel loads on the website and web app."),
        gt("Public pages: a blog post dated 25 February 2026, about what data voice apps collect, contains only lorem ipsum placeholder text, and the homepage still offers free self-hosting if you start before July 2026."),
      ],
      src: ["press", "play", "home", "privacy", "blog-privacy"],
    },
  };
}

import { getGT } from "gt-next/server";
import type { AppContent, CompareSource } from "../types";

/**
 * SerikaCord vs Discord. Facts checked on COMPARE_LAST_CHECKED_ISO against
 * the sources below (titles and publishers are proper names, not translated).
 */

export const sources: CompareSource[] = [
  { id: "company", title: "Discord company page (users, leadership)", url: "https://discord.com/company", publisher: "Discord", kind: "primary" },
  { id: "dave", title: "Meet DAVE: end-to-end encryption for audio & video", url: "https://discord.com/blog/meet-dave-e2ee-for-audio-video", publisher: "Discord", kind: "primary", date: "2024-09-17" },
  {
    id: "every-call",
    title: "Every voice and video call on Discord is now end-to-end encrypted",
    url: "https://discord.com/blog/every-voice-and-video-call-on-discord-is-now-end-to-end-encrypted",
    publisher: "Discord",
    kind: "primary",
    date: "2026-05-18",
  },
  { id: "tob", title: "Discord DAVE security reviews", url: "https://trailofbits.com/library/discord-dave/", publisher: "Trail of Bits", kind: "primary", date: "2024" },
  { id: "uk-osa", title: "Adapting Discord for the UK Online Safety Act", url: "https://discord.com/safety/adapting-discord-for-the-uk-online-safety-act", publisher: "Discord", kind: "primary", date: "2025-07-21" },
  {
    id: "age-wrong",
    title: "Getting global age assurance right: what we got wrong and what's changing",
    url: "https://discord.com/blog/getting-global-age-assurance-right-what-we-got-wrong-and-whats-changing",
    publisher: "Discord",
    kind: "primary",
    date: "2026-02-24",
  },
  { id: "age-groups", title: "Safer for teens, same Discord for adults", url: "https://discord.com/blog/safer-for-teens-same-discord-for-adults", publisher: "Discord", kind: "primary", date: "2026-09-22" },
  {
    id: "tc-age",
    title: "Discord's age-verification era is upon us, despite community backlash",
    url: "https://techcrunch.com/2026/09/22/discords-age-verification-era-is-upon-us-despite-community-backlash/",
    publisher: "TechCrunch",
    kind: "secondary",
    date: "2026-09-22",
  },
  {
    id: "id-breach",
    title: "Discord confirms 70,000 government IDs exposed in third-party breach",
    url: "https://cyberinsider.com/discord-confirms-70000-government-ids-exposed-in-third-party-breach/",
    publisher: "CyberInsider",
    kind: "secondary",
    date: "2025-10",
  },
  {
    id: "nbc-breach",
    title: "70,000 government ID photos exposed in Discord user hack",
    url: "https://www.nbcnews.com/tech/tech-news/70000-government-id-photos-exposed-discord-user-hack-rcna236714",
    publisher: "NBC News",
    kind: "secondary",
    date: "2025-10",
  },
  { id: "orbs", title: "Discord launches Orbs globally", url: "https://discord.com/press-releases/discord-launches-orbs-globally", publisher: "Discord", kind: "primary", date: "2025-07-14" },
  {
    id: "ads-manager",
    title: "Discord opens auction-priced ad buying to studios of any size by early 2027",
    url: "https://ppc.land/discord-opens-auction-priced-ad-buying-to-studios-of-any-size-by-early-2027/",
    publisher: "PPC Land",
    kind: "secondary",
    date: "2026-09-29",
  },
  { id: "nitro", title: "Discord Nitro plans and perks", url: "https://discord.com/nitro", publisher: "Discord", kind: "primary" },
  {
    id: "upload",
    title: "Discord raises free upload limit to 20MB after lowering it two years ago",
    url: "https://www.dexerto.com/entertainment/discord-raises-free-upload-limit-to-20mb-after-lowering-it-two-years-ago-3398251/",
    publisher: "Dexerto",
    kind: "secondary",
    date: "2026-08-13",
  },
  { id: "download", title: "Download Discord", url: "https://discord.com/download", publisher: "Discord", kind: "primary" },
  { id: "privacy", title: "Discord Privacy Policy (effective 29 September 2025)", url: "https://discord.com/privacy", publisher: "Discord", kind: "primary", date: "2025-09-29" },
  { id: "terms", title: "Discord Terms of Service (effective 29 September 2025)", url: "https://discord.com/terms", publisher: "Discord", kind: "primary", date: "2025-09-29" },
  { id: "transparency", title: "Discord transparency reports", url: "https://discord.com/safety-transparency-reports", publisher: "Discord", kind: "primary" },
  { id: "devlog", title: "Discord developer changelog", url: "https://docs.discord.com/developers/change-log.md", publisher: "Discord", kind: "primary" },
  { id: "social-sdk", title: "Announcing Discord's Social SDK", url: "https://discord.com/blog/announcing-discord-social-sdk-to-power-game-comms", publisher: "Discord", kind: "primary", date: "2025-03-17" },
  { id: "ipo", title: "Chat platform Discord is said to file confidentially for IPO", url: "https://news.bloomberglaw.com/securities-law/chat-platform-discord-is-said-to-file-confidentially-for-ipo", publisher: "Bloomberg Law", kind: "secondary", date: "2026-01" },
  { id: "ceo", title: "Discord's CEO and co-founder is stepping down", url: "https://engadget.com/apps/discords-ceo-and-co-founder-is-stepping-down-181851778.html", publisher: "Engadget", kind: "secondary", date: "2025" },
  { id: "blocks", title: "Russia and Turkey ban Discord", url: "https://therecord.media/discord-messaging-app-banned-russia-turkey", publisher: "The Record", kind: "secondary", date: "2024-10" },
  {
    id: "spypet",
    title: "Discord takes down Spy.pet website that harvested data from hundreds of millions of users",
    url: "https://www.bitdefender.com/en-us/blog/hotforsecurity/discord-takes-down-spy-pet-website-that-harvested-data-from-hundreds-of-millions-of-users",
    publisher: "Bitdefender",
    kind: "secondary",
    date: "2024-04",
  },
  { id: "double-counter", title: "Discord blocks new installs of Double Counter after breach", url: "https://egamers.io/?p=122193", publisher: "eGamers", kind: "secondary", date: "2026-10" },
  {
    id: "outage-may",
    title: "Discord down on May 8, issues being looked into",
    url: "https://mp1st.com/news/discord-down-on-may-8-issues-being-looked-into",
    publisher: "MP1st",
    kind: "secondary",
    date: "2026-05-08",
  },
  { id: "wikipedia", title: "Discord", url: "https://en.wikipedia.org/wiki/Discord", publisher: "Wikipedia", kind: "secondary" },
];

export async function content(): Promise<AppContent> {
  const gt = await getGT();
  return {
    take: gt("The default home for online communities, with the most polish, the biggest bot ecosystem and audited encrypted calls. But text is never end-to-end encrypted, age checks now apply worldwide, and ads are growing."),
    intro: [
      gt("Discord is where most online communities already live, and for most people it works well. SerikaCord looks and feels similar on purpose, so switching is easy, but it is run very differently: by a small team in the Netherlands, without ads, with end-to-end encrypted direct messages and without ID or face scans."),
      gt("Discord is better on almost every measure of size and maturity: more people, more polish, more bots, an iPhone app and end-to-end encryption for every call, audited by an outside firm. SerikaCord is better if you care about private text messages, ads or age checks, and don't mind being early."),
    ],
    verdict: gt("Big, bot-heavy or iPhone-heavy communities: Discord is still the safer choice today. If you want encrypted DMs, no ads and no ID checks in something that feels like Discord, try SerikaCord."),
    facts: {
      operator: {
        value: gt("Discord Inc."),
        note: gt("Private company founded in 2015. A confidential IPO filing was reported in January 2026; it was not listed on a stock exchange when we checked."),
        src: ["company", "ipo", "ceo"],
      },
      jurisdiction: {
        value: gt("United States"),
        note: gt("Headquartered in San Francisco. US and Canadian users agree to mandatory arbitration and a class-action waiver."),
        src: ["company", "terms"],
      },
      businessModel: {
        value: gt("Subscriptions and advertising"),
        note: gt("Nitro, Server Boosts and Shop cosmetics, plus sponsored Quests and a self-serve Ads Manager announced in September 2026."),
        src: ["nitro", "orbs", "ads-manager"],
      },
      ads: {
        status: "yes",
        value: gt("Sponsored Quests"),
        note: gt("Opt-in sponsored Quests, including rewarded video ads, labelled Promoted. No banner ads in chats were found."),
        src: ["orbs", "ads-manager"],
      },
      pricing: {
        value: gt("Free; Nitro optional"),
        note: gt("In the US: Nitro Basic $2.99 a month, Nitro $9.99 a month."),
        src: ["nitro"],
      },
      maturity: {
        status: "yes",
        value: gt("Since 2015"),
        note: gt("A mature, polished product built by a large team."),
        src: ["wikipedia"],
      },
      e2eeDms: {
        status: "no",
        note: gt("Text messages are not end-to-end encrypted, and Discord says it has no current plans to change that. Calls in DMs are encrypted."),
        src: ["every-call"],
      },
      e2eeGroups: {
        status: "partial",
        value: gt("Calls only"),
        note: gt("Group DM calls are end-to-end encrypted; group DM text is not."),
        src: ["every-call"],
      },
      e2eeCalls: {
        status: "yes",
        value: gt("Every call except Stage"),
        note: gt("DMs, group DMs, voice channels and Go Live streams use the DAVE protocol. Since early March 2026 clients without it can't join calls."),
        src: ["dave", "every-call"],
      },
      e2eeCommunity: {
        status: "partial",
        value: gt("Voice only"),
        note: gt("Voice channels are encrypted end to end; text channels are not."),
        src: ["every-call"],
      },
      e2eeDefault: {
        status: "partial",
        value: gt("Calls: always"),
        note: gt("Encryption is mandatory for calls and never available for text."),
        src: ["every-call"],
      },
      audit: {
        status: "yes",
        value: gt("Calls: yes"),
        note: gt("Trail of Bits reviewed the DAVE design and implementation in 2024 and published its reports."),
        src: ["tob"],
      },
      metadata: {
        value: gt("Discord sees all text"),
        note: gt("All messages are stored readable on Discord's servers and scanned for rule violations."),
        src: ["privacy"],
      },
      dataUse: {
        status: "partial",
        value: gt("Doesn't sell data"),
        note: gt("Discord says it doesn't sell personal information. It uses first-party analytics and measures Quest ads."),
        src: ["privacy"],
      },
      phone: {
        status: "partial",
        value: gt("Sometimes"),
        note: gt("Not needed to sign up, but servers or risk checks can require a verified phone number."),
        src: ["terms"],
      },
      email: {
        status: "yes",
        value: gt("Email or phone"),
        src: ["terms"],
      },
      ageChecks: {
        status: "yes",
        value: gt("Yes, worldwide"),
        note: gt("Since September 2026 a model sorts accounts into adults and teens. People it misjudges can be asked for a face scan, an ID scan with a selfie or a credit card. Minimum age 13."),
        src: ["age-groups", "tc-age", "uk-osa", "age-wrong"],
      },
      servers: { status: "yes", src: ["wikipedia"] },
      roles: { status: "yes", note: gt("The model most other apps copy."), src: ["wikipedia"] },
      threadsForums: { status: "yes", note: gt("Threads, forum channels and polls."), src: ["wikipedia"] },
      onboarding: { status: "yes", note: gt("Community Onboarding and membership screening."), src: ["wikipedia"] },
      modTools: {
        status: "yes",
        note: gt("AutoMod, timeouts, audit log, verification levels, raid protection and Safety Alerts."),
        src: ["wikipedia"],
      },
      platformSafety: {
        status: "yes",
        note: gt("A large safety team and regular transparency reports, including EU Digital Services Act reports."),
        src: ["transparency"],
      },
      voiceChannels: { status: "yes", note: gt("Server-based voice that scales to large channels."), src: ["wikipedia"] },
      videoScreen: { status: "yes", note: gt("Go Live screen sharing; HD and 4K at 60 FPS need Nitro."), src: ["nitro"] },
      streamingStage: { status: "yes", note: gt("Go Live streams, Stage channels and Activities (games and apps inside calls)."), src: ["wikipedia"] },
      botApi: {
        status: "yes",
        note: gt("The largest bot and app ecosystem: slash commands, components, Activities and a Social SDK for games."),
        src: ["devlog", "social-sdk"],
      },
      discordBots: { value: gt("It is the original"), note: gt("Discord's API is the one SerikaCord's bot API follows."), src: ["devlog"] },
      discordMigration: { value: gt("Not applicable"), note: gt("Discord is the app people migrate from.") },
      desktop: { status: "yes", note: gt("Windows (including ARM), macOS and Linux."), src: ["download"] },
      mobile: { status: "yes", note: gt("Android and iOS, from the app stores."), src: ["download"] },
      web: { status: "yes", src: ["download"] },
      license: {
        status: "no",
        value: gt("Proprietary"),
        note: gt("Closed source. The DAVE encryption library is open source."),
        src: ["dave"],
      },
      selfHost: { status: "no", src: ["terms"] },
      federation: { status: "no" },
      uploads: {
        value: gt("20 MB per file"),
        note: gt("Raised from 10 MB in August 2026. 50 MB with Nitro Basic, 1 GB with Nitro."),
        src: ["upload", "nitro"],
      },
      groupSize: {
        status: "unknown",
        note: gt("We didn't verify Discord's current group DM and server size limits for this page."),
      },
      scale: {
        status: "yes",
        value: gt("200M+ monthly users"),
        note: gt("Discord reports more than 200 million monthly and about 90 million daily active users."),
        src: ["company", "orbs"],
      },
      incidents: {
        value: gt("ID photo breach in 2025"),
        note: gt("A support vendor breach exposed about 70,000 government ID photos from age appeals (October 2025). Third-party tools also scraped or leaked users' data: Spy.pet in 2024 and the Double Counter bot in October 2026. Outages in March and May 2026; blocked in Russia and Turkey since 2024."),
        src: ["id-breach", "nbc-breach", "spypet", "double-counter", "outage-may", "blocks"],
      },
    },
    whyUs: [
      {
        title: gt("Your private messages are end-to-end encrypted"),
        text: gt("On SerikaCord, DMs and group DMs, including text, files and calls, are end-to-end encrypted by default for new conversations, with safety numbers to check who you're talking to. Discord encrypts calls but has said it has no current plans to encrypt text. Our encryption is new and not yet audited; see its limits below."),
        src: ["every-call"],
      },
      {
        title: gt("No ID, selfie or face scans"),
        text: gt("SerikaCord asks for a date of birth and requires you to be 16 or older. It never asks for ID or a face scan. Discord now estimates every account's age group and can ask people it misjudges for a face scan or ID, and in October 2025 a breach at one of its support vendors exposed about 70,000 ID photos from age appeals."),
        src: ["age-groups", "id-breach"],
      },
      {
        title: gt("No ads, now or planned"),
        text: gt("SerikaCord shows no ads and uses no advertising trackers. Discord runs sponsored Quests, including rewarded video ads, and announced a self-serve Ads Manager in September 2026."),
        src: ["ads-manager", "orbs"],
      },
      {
        title: gt("Based in the EU"),
        text: gt("SerikaCord is run from the Netherlands under the GDPR and Dutch law. Discord is a US company; its terms put US and Canadian users under mandatory arbitration."),
        src: ["terms"],
      },
      {
        title: gt("25 times the free upload size"),
        text: gt("Free SerikaCord accounts can upload files up to 500 MB. Discord's free limit is 20 MB, raised from 10 MB in August 2026."),
        src: ["upload"],
      },
      {
        title: gt("Feels like home, and your bots can come along"),
        text: gt("SerikaCord works like Discord on purpose: servers, roles, threads, forums, onboarding and AutoMod are where you expect them. Its bot API follows Discord's API v10, and a consent-based bridge mirrors a Discord server while your community moves at its own pace."),
      },
    ],
    whyThem: [
      {
        title: gt("Everyone is already there"),
        text: gt("Discord reports more than 200 million monthly users. On SerikaCord you will probably have to bring your friends yourself, and there are far fewer public communities to discover. For most groups this matters more than any feature."),
        src: ["company"],
      },
      {
        title: gt("Every call is encrypted, and audited"),
        text: gt("Discord encrypts voice and video end to end in voice channels and Go Live streams too, not just in DMs, and Trail of Bits reviewed the protocol. SerikaCord only encrypts DM and group DM calls, and nobody outside our team has audited our encryption yet."),
        src: ["every-call", "tob"],
      },
      {
        title: gt("Polish, features and every platform"),
        text: gt("Discord has been built by a large team since 2015. It has native iPhone and Android apps in the stores, console and VR integrations, Stage channels and Activities. SerikaCord is young: no iPhone app yet, no Stage channels, and more rough edges."),
        src: ["download"],
      },
      {
        title: gt("The biggest bot ecosystem"),
        text: gt("Thousands of bots and apps are built for Discord. Many can run on SerikaCord, but only if their owners point them at us, and our API doesn't cover everything."),
        src: ["devlog"],
      },
      {
        title: gt("Scale and reliability"),
        text: gt("Discord runs huge servers and voice channels on its own infrastructure. SerikaCord's calls connect peer-to-peer where possible, which exposes your IP address to others in the call and gets heavy in large video calls."),
      },
      {
        title: gt("Younger teens can join"),
        text: gt("Discord's minimum age is 13 in most countries. SerikaCord is 16 and over everywhere."),
        src: ["terms"],
      },
    ],
    pickThem: [
      gt("your community is large, or your members won't install another app"),
      gt("many of your members use iPhones"),
      gt("you depend on bots or integrations that only exist on Discord"),
      gt("you need Stage channels, Activities, console apps or very large voice channels"),
    ],
    pickUs: [
      gt("you want your private messages, not just your calls, end-to-end encrypted"),
      gt("you don't want to risk being asked for ID or a face scan"),
      gt("you want a chat app without ads, run from the EU"),
      gt("you want something that feels like Discord and can run your Discord bots, and you don't mind being early"),
    ],
    faq: [
      {
        question: gt("Is SerikaCord affiliated with Discord?"),
        answer: gt("No. SerikaCord is an independent app made by Serika Company in the Netherlands. It works like Discord on purpose and its bot API follows Discord's, but it is not affiliated with or endorsed by Discord."),
      },
      {
        question: gt("Is Discord end-to-end encrypted?"),
        answer: gt("Partly. Since 2026 every Discord voice and video call is end-to-end encrypted with the DAVE protocol, except Stage channels. Text messages, including DMs, are not, and Discord says it has no current plans to change that."),
      },
      {
        question: gt("Will Discord ask me for ID or a face scan?"),
        answer: gt("Possibly. Since September 2026 Discord uses a model to sort accounts into adults and teens and says most adults will never be asked. If it gets you wrong, or you want age-restricted content, it can ask for a face scan, an ID scan with a selfie or a credit card. SerikaCord never asks for these."),
      },
      {
        question: gt("Can I move my Discord server to SerikaCord?"),
        answer: gt("You can run the Discord bridge, which mirrors messages between a Discord server and a SerikaCord server so your community can move at its own pace. Each Discord member is asked for consent before their messages are relayed."),
      },
      {
        question: gt("Will my Discord bot work on SerikaCord?"),
        answer: gt("Often, yes. SerikaCord's bot API and gateway follow Discord's API v10, and our developer docs show how to point discord.js or discord.py at SerikaCord. Not every Discord feature is supported, so test your bot first."),
      },
      {
        question: gt("Is there a SerikaCord app for iPhone?"),
        answer: gt("Not yet. An iOS app is in development. Until then you can use SerikaCord in Safari and add it to your Home Screen."),
      },
      {
        question: gt("Does Discord sell my data?"),
        answer: gt("Discord's privacy policy says it doesn't sell personal information. It does make money from sponsored Quests and is building an ad business. SerikaCord doesn't show ads or use advertising trackers."),
      },
    ],
    couldNotVerify: [
      gt("Whether Discord has gone public: only a confidential IPO filing was reported; we found no listing."),
      gt("The name of the support vendor in the October 2025 breach, and the attackers' larger claims, which Discord disputes."),
      gt("Headline numbers in Discord's 2026 transparency report."),
      gt("Discord's revenue: only secondary estimates exist."),
      gt("The full list of third-party trackers in Discord's apps."),
    ],
  };
}

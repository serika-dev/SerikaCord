import { getGT } from "gt-next/server";
import type { AppContent, CompareSource } from "../types";

/**
 * SerikaCord vs SimpleX Chat. Facts checked on COMPARE_LAST_CHECKED_ISO
 * against the sources below (titles and publishers are proper names, not
 * translated).
 */

export const sources: CompareSource[] = [
  { id: "home", title: "SimpleX Chat homepage", url: "https://simplex.chat", publisher: "SimpleX Chat", kind: "primary" },
  { id: "github", title: "simplex-chat source code and README", url: "https://github.com/simplex-chat/simplex-chat", publisher: "GitHub", kind: "primary" },
  {
    id: "releases",
    title: "SimpleX Chat releases (v7.0.0, v7.0.3, v7.1.0 beta)",
    url: "https://api.github.com/repos/simplex-chat/simplex-chat/releases",
    publisher: "GitHub",
    kind: "primary",
    date: "2026-10-03",
  },
  {
    id: "channels",
    title: "SimpleX Channels, Network Consortium and Community Crowdfunding (v6.5)",
    url: "https://simplex.chat/blog/20260430-simplex-channels-v6-5-consortium-crowdfunding-freedom-of-speech.html",
    publisher: "SimpleX Chat",
    kind: "primary",
    date: "2026-04-30",
  },
  { id: "badges", title: "SimpleX Supporter Badges", url: "https://simplex.chat/blog/20260919-simplex-supporter-badges.html", publisher: "SimpleX Chat", kind: "primary", date: "2026-09-19" },
  { id: "crowdfunding", title: "Equity Crowdfunding Launched", url: "https://simplex.chat/blog/20260819-simplex-chat-crowdfunding.html", publisher: "SimpleX Chat", kind: "primary", date: "2026-08-19" },
  { id: "names", title: "SimpleX Public Names", url: "https://simplex.chat/blog/20260722-simplex-public-names.html", publisher: "SimpleX Chat", kind: "primary", date: "2026-07-22" },
  {
    id: "v63",
    title: "SimpleX Chat v6.3: new user experience and safety in public groups",
    url: "https://simplex.chat/blog/20250308-simplex-chat-v6-3-new-user-experience-safety-in-public-groups.html",
    publisher: "SimpleX Chat",
    kind: "primary",
    date: "2025-03-08",
  },
  {
    id: "large-groups",
    title: "Large groups and privacy-preserving content moderation",
    url: "https://simplex.chat/blog/20250114-simplex-network-large-groups-privacy-preserving-content-moderation.html",
    publisher: "SimpleX Chat",
    kind: "primary",
    date: "2025-01-14",
  },
  { id: "wired-reply", title: "Wired's Attack on Privacy", url: "https://simplex.chat/blog/20241016-wired-attack-on-privacy.html", publisher: "SimpleX Chat", kind: "primary", date: "2024-10-16" },
  {
    id: "flux",
    title: "SimpleX network v6.2: servers by Flux and business chats",
    url: "https://simplex.chat/blog/20241210-simplex-network-v6-2-servers-by-flux-business-chats.html",
    publisher: "SimpleX Chat",
    kind: "primary",
    date: "2024-12-10",
  },
  { id: "privacy", title: "SimpleX Chat Privacy Policy (updated 18 April 2026)", url: "https://simplex.chat/privacy/", publisher: "SimpleX Chat", kind: "primary", date: "2026-04-18" },
  { id: "transparency", title: "SimpleX Chat transparency report (updated 9 February 2026)", url: "https://simplex.chat/transparency/", publisher: "SimpleX Chat", kind: "primary", date: "2026-02-09" },
  { id: "faq", title: "SimpleX Chat FAQ", url: "https://simplex.chat/faq/", publisher: "SimpleX Chat", kind: "primary" },
  { id: "appstore", title: "SimpleX Chat on the App Store", url: "https://apps.apple.com/us/app/simplex-chat-secure-messenger/id1605771084", publisher: "Apple", kind: "primary" },
  { id: "fdroid", title: "SimpleX Chat on F-Droid", url: "https://f-droid.org/en/packages/chat.simplex.app/", publisher: "F-Droid", kind: "primary" },
  { id: "wikipedia", title: "SimpleX Chat", url: "https://en.wikipedia.org/wiki/SimpleX_Chat", publisher: "Wikipedia", kind: "secondary" },
  { id: "rapsi", title: "Moscow court fines SimpleX owner", url: "https://rapsinews.ru/moscourts_news/20250924/311185990.html", publisher: "RAPSI", kind: "secondary", date: "2025-09-24" },
  {
    id: "lemmy",
    title: "Community discussion of SimpleX limits (multi-device, groups, calls)",
    url: "https://lemmy.kde.social/comment/4598691",
    publisher: "Lemmy",
    kind: "secondary",
  },
];

export async function content(): Promise<AppContent> {
  const gt = await getGT();
  return {
    take: gt("The most private messenger we compare: no phone, email or even a user ID, encryption everywhere, two outside audits and open source. But it has no servers, voice channels, group calls or web app."),
    intro: [
      gt("SimpleX Chat is a private messenger made by SimpleX Chat Ltd, a small UK company, with apps since 2022. It is built so that nobody, not even the servers that pass messages along, knows who you are: there is no phone number, email, username or account ID, and chats, groups and calls are end-to-end encrypted by default."),
      gt("SerikaCord is a different kind of app: a Discord-style home for communities with servers, channels, roles, voice channels, moderation and bots. On privacy SimpleX is far ahead of SerikaCord, whose encryption launched in October 2026, covers only DMs and group DMs and hasn't been audited; SerikaCord wins only if you want to run a community."),
    ],
    verdict: gt("For private conversations where even who talks to whom must stay hidden, use SimpleX. If you want to run a community with channels, roles, voice rooms and bots, SerikaCord does that and SimpleX doesn't try to."),
    facts: {
      operator: {
        value: gt("SimpleX Chat Ltd"),
        note: gt("A small venture-backed UK company; its first public release was in January 2022. Since December 2024 some preset servers are run by Flux, and in April 2026 it announced a SimpleX Network foundation and consortium."),
        src: ["wikipedia", "flux", "channels"],
      },
      jurisdiction: {
        value: gt("United Kingdom"),
        note: gt("Based in London. Messages pass through relay servers you can choose; the preset ones are run by SimpleX Chat Ltd and Flux."),
        src: ["privacy", "flux"],
      },
      businessModel: {
        value: gt("Investors, donations and badges"),
        note: gt("Venture funding (a $1.3 million round in 2024 was led by Jack Dorsey), user donations, equity crowdfunding on Wefunder since August 2026 and paid supporter badges in beta since September 2026. Paid public names are announced for December 2026."),
        src: ["wikipedia", "crowdfunding", "badges", "names"],
      },
      ads: {
        status: "no",
        value: gt("No ads"),
        note: gt("No ads, and the App Store privacy label says ‘Data Not Collected’."),
        src: ["appstore"],
      },
      pricing: {
        value: gt("Free; badges optional"),
        note: gt("Everything is free. Optional supporter badges, bought without an account by card, Bitcoin or Monero, raise the file limit to 2 GB or 5 GB and keep files longer. We couldn't find their exact prices."),
        src: ["badges"],
      },
      maturity: {
        status: "yes",
        value: gt("Since 2022"),
        note: gt("Version 7.0 came out in July 2026 and updates ship often, though the project's own README still warns of possible bugs and missing features."),
        src: ["releases", "github"],
      },
      e2eeDms: {
        status: "yes",
        value: gt("Always"),
        note: gt("A double ratchet like Signal's plus an extra encryption layer, with post-quantum protection added to the key exchange in 2024."),
        src: ["github", "faq"],
      },
      e2eeGroups: {
        status: "yes",
        value: gt("Always"),
        note: gt("Every group is end-to-end encrypted. Each member connects to every other member separately, so very large, busy groups are heavy; relays for large groups are being rolled out."),
        src: ["large-groups", "faq"],
      },
      e2eeCalls: {
        status: "yes",
        value: gt("1:1 calls only"),
        note: gt("One-to-one voice and video calls are end-to-end encrypted. There are no group calls."),
        src: ["faq", "lemmy"],
      },
      e2eeCommunity: {
        status: "partial",
        value: gt("Groups yes; public channels no"),
        note: gt("Groups are encrypted. Public broadcast channels, added in April 2026, are deliberately readable by their relay servers when anyone can join; they hide who owns and follows them instead."),
        src: ["channels"],
      },
      e2eeDefault: {
        status: "yes",
        value: gt("Always on"),
        note: gt("There is no unencrypted mode for chats, groups or calls."),
        src: ["faq"],
      },
      audit: {
        status: "yes",
        value: gt("Trail of Bits, 2022 and 2024"),
        note: gt("Trail of Bits assessed the implementation in October 2022 and reviewed the cryptographic design in July 2024, published in October 2024."),
        src: ["github", "home"],
      },
      metadata: {
        value: gt("Almost nothing"),
        note: gt("There are no user accounts or profiles on the servers. Preset servers delete messages once delivered (or after 21 days) and files after 48 hours, and say they don't log IP addresses."),
        src: ["privacy", "faq"],
      },
      dataUse: {
        status: "yes",
        value: gt("No trackers, nothing to sell"),
        note: gt("The privacy policy says there is no user data to sell, and the app claims no trackers."),
        src: ["privacy", "appstore"],
      },
      phone: {
        status: "no",
        value: gt("Not required"),
        note: gt("You connect by sharing a one-time link or QR code."),
        src: ["faq"],
      },
      email: {
        status: "no",
        value: gt("Not required"),
        src: ["privacy"],
      },
      ageChecks: {
        status: "no",
        value: gt("No ID or face scans"),
        note: gt("Minimum age 13, or higher where local law requires, with no verification."),
        src: ["privacy", "appstore"],
      },
      servers: {
        status: "no",
        note: gt("No Discord-style servers with channel lists. There are groups and, since April 2026, public broadcast channels; a community-run directory bot listed about 400 public groups in January 2025."),
        src: ["channels", "large-groups"],
      },
      roles: {
        status: "partial",
        value: gt("Basic group roles"),
        note: gt("Owner, admin, moderator, member and read-only observer. No custom roles or per-channel permissions."),
        src: ["v63"],
      },
      threadsForums: {
        status: "no",
        note: gt("Replies and quotes only; no threads or forums."),
        src: ["lemmy"],
      },
      onboarding: {
        status: "partial",
        note: gt("Groups can show a welcome message and review new members before they join (since July 2025). There are no onboarding questions."),
        src: ["releases"],
      },
      modTools: {
        status: "partial",
        value: gt("Basic group tools"),
        note: gt("Members can report messages to group moderators (since March 2025); moderators can block members for everyone, remove them or make them read-only. Directory-listed groups can add a captcha and a name filter."),
        src: ["v63", "large-groups"],
      },
      platformSafety: {
        status: "partial",
        note: gt("SimpleX can block reported illegal files and groups on its own preset servers. Its transparency report lists 12 law enforcement requests in 2025 and no information provided."),
        src: ["large-groups", "transparency"],
      },
      voiceChannels: {
        status: "no",
        note: gt("No voice channels or group calls."),
        src: ["lemmy"],
      },
      videoScreen: {
        status: "partial",
        value: gt("1:1 video calls"),
        note: gt("One-to-one video calls only. We couldn't verify screen sharing."),
        src: ["faq"],
      },
      streamingStage: {
        status: "no",
        note: gt("No live streaming or Stage-style events."),
      },
      botApi: {
        status: "yes",
        note: gt("Bots run through the terminal app's WebSocket API with a TypeScript client, and a directory bot and others exist. It is aimed at developers rather than a large bot marketplace."),
        src: ["github"],
      },
      discordBots: { status: "no", note: gt("The bot API has nothing in common with Discord's.") },
      discordMigration: {
        status: "no",
        note: gt("No official Discord bridge or importer, and we couldn't find a community one."),
      },
      desktop: {
        status: "yes",
        note: gt("Windows, macOS and Linux, plus a terminal app. The desktop app can be linked to your phone's profile, but full multi-device sync isn't supported."),
        src: ["github", "lemmy"],
      },
      mobile: {
        status: "yes",
        note: gt("Android 8 or newer (Google Play, F-Droid or direct download) and iPhone with iOS 15 or newer."),
        src: ["fdroid", "appstore"],
      },
      web: {
        status: "no",
        note: gt("There is no browser version."),
        src: ["github"],
      },
      license: {
        status: "yes",
        value: gt("AGPL-3.0"),
        note: gt("The apps and the servers are open source."),
        src: ["github"],
      },
      selfHost: {
        status: "yes",
        note: gt("You can run your own message relays, file servers and chat relays and choose them in the app; SimpleX said in August 2026 that more than 1,000 community servers exist."),
        src: ["github", "faq", "crowdfunding"],
      },
      federation: {
        status: "partial",
        value: gt("Decentralized, not federated"),
        note: gt("There are no accounts on any server. Any app can use any relay, and each side of a conversation can pick its own servers, so independent servers work together without federation in the Matrix sense."),
        src: ["faq"],
      },
      uploads: {
        value: gt("1 GB per file"),
        note: gt("Files are kept for 48 hours on preset servers by default. 2 GB or 5 GB with a paid supporter badge."),
        src: ["badges", "faq"],
      },
      groupSize: {
        value: gt("About 100 recommended"),
        note: gt("SimpleX says groups were designed for about 100 members, with relays being added for bigger ones. We couldn't find a hard maximum."),
        src: ["large-groups"],
      },
      scale: {
        status: "partial",
        value: gt("About 0.5M monthly (self-reported)"),
        note: gt("The homepage claims 600,000 monthly users and more than 3 million downloads (October 2026); an August 2026 SimpleX post said about 480,000. Neither figure is independently checked."),
        src: ["home", "crowdfunding"],
      },
      incidents: {
        value: gt("Blocked and fined in Russia"),
        note: gt("Blocked by Russia's regulator in September 2024 and fined 800,000 rubles by a Moscow court in September 2025. In October 2024 Wired reported extremist groups moving to SimpleX; SimpleX disputed the article and added reporting tools in early 2025."),
        src: ["wikipedia", "rapsi", "wired-reply", "v63"],
      },
    },
    whyUs: [
      {
        title: gt("Built for communities, not just chats"),
        text: gt("SerikaCord has servers with text, voice, forum and ticket channels, Discord-style roles with per-channel permissions, threads and onboarding. SimpleX has single-room groups with five fixed roles and broadcast channels, and says its groups were designed for about 100 members."),
        src: ["large-groups", "v63"],
      },
      {
        title: gt("Voice channels, group calls and screen sharing"),
        text: gt("On SerikaCord you can drop into a voice channel with friends and share your screen at up to 60 FPS. SimpleX only has one-to-one calls. Our server voice channels are not end-to-end encrypted, and calls are peer-to-peer where possible, so others can see your IP address."),
        src: ["faq"],
      },
      {
        title: gt("Moderation that scales past a group chat"),
        text: gt("SerikaCord gives moderators AutoMod, an audit log, timeouts, rules screening and verification levels. SimpleX added reports, member review and blocking in 2025, which is enough for small groups but not for a large public community."),
        src: ["v63"],
      },
      {
        title: gt("Bots and a path from Discord"),
        text: gt("SerikaCord's bot API follows Discord's API v10, so many discord.js and discord.py bots run after changing one address, and a consent-based bridge mirrors a Discord server. SimpleX has a developer bot API of its own and no Discord bridge."),
        src: ["github"],
      },
      {
        title: gt("A browser app and easy multi-device"),
        text: gt("SerikaCord works fully in the browser and on several devices at once, and new devices are linked by QR code or unlocked with a PIN or passphrase. SimpleX has no web version or full multi-device sync, and if you lose your phone without moving your profile first, your chats are gone. The trade-off is that we need your email address and see far more metadata than SimpleX."),
        src: ["github", "lemmy"],
      },
    ],
    whyThem: [
      {
        title: gt("No identifiers at all"),
        text: gt("SimpleX has no phone numbers, emails, usernames or even random account IDs, so its servers don't know who is talking to whom. SerikaCord needs an email address and can see who talks to whom and when."),
        src: ["faq", "privacy"],
      },
      {
        title: gt("Encryption that covers more, and has been audited twice"),
        text: gt("SimpleX encrypts every chat, group and call by default, with post-quantum protection since 2024, and Trail of Bits reviewed it in 2022 and 2024. Our encryption launched in October 2026, covers only DMs, group DMs of up to 10 people and their calls, and hasn't been audited."),
        src: ["github", "faq"],
      },
      {
        title: gt("It has shown it keeps almost nothing"),
        text: gt("SimpleX's transparency report lists 12 law enforcement requests in 2025 and no information handed over, and its preset servers delete messages once delivered. SerikaCord stores server channel messages in a form we can read and hasn't published a transparency report."),
        src: ["transparency", "privacy"],
      },
      {
        title: gt("Fully open source, and you can run your own servers"),
        text: gt("SimpleX's apps and servers are AGPL-3.0, and you can point the app at relays you run yourself while still talking to everyone else. SerikaCord is source-available, not open source, and self-hosted instances don't connect to serika.chat."),
        src: ["github"],
      },
      {
        title: gt("An iPhone app, F-Droid and younger users"),
        text: gt("SimpleX has native apps for iPhone and Android, including on F-Droid, and its minimum age is 13. SerikaCord has no iPhone app yet, ships its Android app from its own website and is 16 and over."),
        src: ["appstore", "fdroid", "privacy"],
      },
    ],
    pickThem: [
      gt("you want the strongest metadata privacy available, with no identifiers at all"),
      gt("you're a journalist, activist or anyone whose contacts must stay hidden"),
      gt("you want open source software and relay servers you can run yourself"),
      gt("you need an iPhone app today"),
    ],
    pickUs: [
      gt("you want to run a community with channels, roles and moderation"),
      gt("you want voice channels and group calls with screen sharing"),
      gt("you rely on bots or are moving a Discord server"),
      gt("you want to use chat in a browser and on several devices at once"),
    ],
    faq: [
      {
        question: gt("Is SimpleX more private than SerikaCord?"),
        answer: gt("Yes, by a wide margin. SimpleX has no user identifiers, encrypts every chat, group and call by default and has been audited twice. SerikaCord needs an email, encrypts only DMs and group DMs, sees metadata and hasn't been audited."),
      },
      {
        question: gt("Is SimpleX end-to-end encrypted?"),
        answer: gt("Yes. Chats, groups and one-to-one calls are always end-to-end encrypted, with post-quantum protection since 2024. Public broadcast channels are the deliberate exception: they are readable by their relay servers."),
      },
      {
        question: gt("Does SimpleX need a phone number or email?"),
        answer: gt("No. SimpleX has no accounts at all; you connect to people by sharing a link or QR code. SerikaCord needs an email address but no phone number."),
      },
      {
        question: gt("Is SimpleX open source, and can I host it myself?"),
        answer: gt("Yes. The apps and servers are open source under the AGPL-3.0, and you can run your own message and file relays and use them from the normal app."),
      },
      {
        question: gt("Can I run a Discord-style community on SimpleX?"),
        answer: gt("Not really. SimpleX has groups, read-only broadcast channels and basic moderation, but no servers with channel lists, custom roles, voice channels or group calls. It is built for private messaging."),
      },
      {
        question: gt("Can I use SimpleX in a browser or on several devices?"),
        answer: gt("There is no browser version. The desktop app can be linked to your phone's profile, but full multi-device sync isn't supported, so keep a backup or move your profile before you change phones."),
      },
      {
        question: gt("Who runs SimpleX?"),
        answer: gt("SimpleX Chat Ltd, a small UK company funded by investors, donations and, since August 2026, equity crowdfunding. Some preset servers are run by the company Flux."),
      },
    ],
    couldNotVerify: [
      gt("The prices of SimpleX's supporter badges."),
      gt("Which user number is current: the homepage says 600,000 monthly users, an August 2026 post said about 480,000."),
      gt("Whether calls support screen sharing."),
      gt("A hard maximum group size."),
      gt("Any community-built Discord bridge for SimpleX."),
    ],
    notes: {
      title: gt("Public channels and user numbers"),
      points: [
        gt("SimpleX's April 2026 broadcast channels are not end-to-end encrypted when anyone can join; SimpleX says this is deliberate and that channels hide who owns and follows them instead. Groups and private chats stay encrypted."),
        gt("SimpleX's own figures differ: its homepage says 600,000 monthly users in October 2026, while its August 2026 crowdfunding post said about 480,000. Both are self-reported."),
      ],
      src: ["channels", "home", "crowdfunding"],
    },
  };
}

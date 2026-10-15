import { getGT } from "gt-next/server";
import type { AppContent, CompareSource } from "../types";

/**
 * SerikaCord vs Telegram. Facts checked on COMPARE_LAST_CHECKED_ISO against
 * the sources below (titles and publishers are proper names, not translated).
 */

export const sources: CompareSource[] = [
  { id: "faq", title: "Telegram FAQ", url: "https://telegram.org/faq", publisher: "Telegram", kind: "primary" },
  { id: "privacy", title: "Telegram Privacy Policy (updated 21 August 2026; section 8.3 updated 23 September 2024)", url: "https://telegram.org/privacy", publisher: "Telegram", kind: "primary", date: "2026-08-21" },
  { id: "tos", title: "Telegram Terms of Service", url: "https://telegram.org/tos", publisher: "Telegram", kind: "primary" },
  { id: "apps", title: "Telegram applications and source-code licenses", url: "https://telegram.org/apps", publisher: "Telegram", kind: "primary" },
  { id: "premium", title: "Telegram Premium FAQ", url: "https://telegram.org/faq_premium", publisher: "Telegram", kind: "primary" },
  { id: "moderation", title: "Telegram moderation statistics", url: "https://telegram.org/moderation", publisher: "Telegram", kind: "primary" },
  { id: "group-calls", title: "Extra-Secure Group Calls, Automated Accounts, and More", url: "https://telegram.org/blog/group-calls-made-easy", publisher: "Telegram", kind: "primary", date: "2025-04-30" },
  {
    id: "communities",
    title: "Rich Text Editor, Communities, Ephemeral Messages in Groups",
    url: "https://telegram.org/blog/communities-editor-invisible-messages",
    publisher: "Telegram",
    kind: "primary",
    date: "2026-07-14",
  },
  {
    id: "member-tags",
    title: "Member Tags, Login with Telegram, Disable Sharing",
    url: "https://telegram.org/blog/member-tags-disable-sharing-and-more",
    publisher: "Telegram",
    kind: "primary",
    date: "2026-03-01",
  },
  {
    id: "watch",
    title: "Smartwatch Apps, Rich Text for Bots, AI Guardians for Groups",
    url: "https://telegram.org/blog/watch-apps-and-more",
    publisher: "Telegram",
    kind: "primary",
    date: "2026-06-11",
  },
  {
    id: "welcome",
    title: "Welcome Messages, Buttons in Messages and Signed Gifts",
    url: "https://telegram.org/blog/welcome-messages-buttons-TG-13",
    publisher: "Telegram",
    kind: "primary",
    date: "2026-08-25",
  },
  { id: "passkeys", title: "Passkeys, Gift Purchase Offers and More", url: "https://telegram.org/blog/passkeys-and-gift-offers", publisher: "Telegram", kind: "primary", date: "2025-12-12" },
  { id: "premium-launch", title: "700 Million Users and Telegram Premium", url: "https://telegram.org/blog/700-million-and-premium", publisher: "Telegram", kind: "primary", date: "2022-06-19" },
  { id: "monetization", title: "Sharing Revenue with Channel Owners", url: "https://telegram.org/blog/monetization-for-channels", publisher: "Telegram", kind: "primary", date: "2024-03-31" },
  {
    id: "topics",
    title: "Topics in Groups, Collectible Usernames",
    url: "https://telegram.org/blog/topics-in-groups-collectible-usernames",
    publisher: "Telegram",
    kind: "primary",
    date: "2022-11-05",
  },
  { id: "stars", title: "Telegram Stars", url: "https://telegram.org/blog/telegram-stars", publisher: "Telegram", kind: "primary", date: "2024-06-06" },
  { id: "e2ee-calls", title: "End-to-end encrypted group calls: protocol documentation", url: "https://core.telegram.org/api/end-to-end/group-calls", publisher: "Telegram", kind: "primary" },
  { id: "mtproto", title: "MTProto Mobile Protocol", url: "https://core.telegram.org/mtproto", publisher: "Telegram", kind: "primary" },
  { id: "techfaq", title: "MTProto technical FAQ", url: "https://core.telegram.org/techfaq", publisher: "Telegram", kind: "primary" },
  { id: "bot-api", title: "Telegram Bot API (version 10.3)", url: "https://core.telegram.org/bots/api", publisher: "Telegram", kind: "primary" },
  { id: "fragment", title: "Anonymous +888 numbers", url: "https://fragment.com/numbers", publisher: "Fragment", kind: "primary" },
  { id: "tdesktop", title: "Telegram Desktop source code (GPL-3.0 with OpenSSL exception)", url: "https://github.com/telegramdesktop/tdesktop", publisher: "GitHub", kind: "primary" },
  { id: "android-src", title: "Telegram for Android source code (GPL-2.0)", url: "https://github.com/DrKLO/Telegram", publisher: "GitHub", kind: "primary" },
  { id: "tdlib", title: "TDLib (Telegram Database Library)", url: "https://github.com/tdlib/td", publisher: "GitHub", kind: "primary" },
  {
    id: "secret-desktop",
    title: "Suggestion: Secret chats on Telegram Desktop (open since 5 January 2021)",
    url: "https://bugs.telegram.org/c/904",
    publisher: "Telegram Bugs and Suggestions",
    kind: "primary",
    date: "2021-01-05",
  },
  { id: "four-attacks", title: "Four Attacks and a Proof for Telegram (Albrecht, Mareková, Paterson, Stepanovs)", url: "https://eprint.iacr.org/2023/469", publisher: "IACR ePrint", kind: "secondary" },
  { id: "wikipedia", title: "Telegram (software)", url: "https://en.wikipedia.org/wiki/Telegram_(software)", publisher: "Wikipedia", kind: "secondary" },
  { id: "durov-wiki", title: "Arrest and indictment of Pavel Durov", url: "https://en.wikipedia.org/wiki/Arrest_and_indictment_of_Pavel_Durov", publisher: "Wikipedia", kind: "secondary" },
  {
    id: "tc-durov",
    title: "France formally charges Telegram founder Pavel Durov over organized crime on app",
    url: "https://techcrunch.com/2024/08/29/france-formally-charges-telegram-founder-pavel-durov-over-organized-crime-on-app",
    publisher: "TechCrunch",
    kind: "secondary",
    date: "2024-08-29",
  },
  {
    id: "404-data",
    title: "Telegram hands U.S. authorities data on thousands of users",
    url: "https://www.404media.co/telegram-hands-u-s-authorities-data-on-thousands-of-users/",
    publisher: "404 Media",
    kind: "secondary",
    date: "2025-01-06",
  },
  { id: "transparency-data", title: "Compiled Telegram transparency-bot data, 2024-2025", url: "https://github.com/Te-k/telegram-transparency", publisher: "GitHub", kind: "secondary" },
  { id: "tass", title: "Telegram's 2024 profit reaches $540 million, revenue $1.4 billion (citing the Financial Times)", url: "https://tass.com/economy/1961787/amp", publisher: "TASS", kind: "secondary" },
  { id: "h1-2025", title: "Telegram revenue surges 65% to $870M", url: "https://finance.yahoo.com/news/telegram-revenue-surges-65-870m-160000131.html", publisher: "Yahoo Finance", kind: "secondary" },
  { id: "vietnam", title: "Vietnam orders ban on popular messaging app Telegram", url: "https://www.aljazeera.com/news/2025/5/24/vietnam-orders-ban-on-popular-messaging-app", publisher: "Al Jazeera", kind: "secondary", date: "2025-05-24" },
  { id: "russia-calls", title: "Russia blocks WhatsApp and Telegram calls", url: "https://en.zona.media/article/2025/08/13/callban", publisher: "Mediazona", kind: "secondary", date: "2025-08-13" },
  {
    id: "russia-2026",
    title: "Telegram is one of the last messaging apps in Russia that the state doesn't control. Did the Kremlin just block it for good?",
    url: "https://meduza.io/en/feature/2026/02/10/telegram-is-one-of-the-last-messaging-apps-in-russia-that-the-state-doesn-t-control-did-the-kremlin-just-block-it-for-good",
    publisher: "Meduza",
    kind: "secondary",
    date: "2026-02-10",
  },
  {
    id: "occrp",
    title: "Russia charges Telegram founder Durov with aiding terrorism",
    url: "https://www.occrp.org/en/news/russia-charges-telegram-founder-durov-with-aiding-terrorism",
    publisher: "OCCRP",
    kind: "secondary",
    date: "2026-07-29",
  },
  {
    id: "ofcom",
    title: "Telegram targeted by an investigation after child abuse material was found (Ofcom)",
    url: "https://www.journaldugeek.com/2026/04/23/telegram-est-vise-par-une-enquete-alarmante-apres-la-decouverte-de-contenus-pedopornographiques/",
    publisher: "Journal du Geek",
    kind: "secondary",
    date: "2026-04-23",
  },
  {
    id: "uk-age",
    title: "Pornhub and YouPorn comply with UK laws, and Telegram introduces a bot to address the issue",
    url: "https://www.redhotcyber.com/en/post/pornhub-youporn-are-complying-with-uk-laws-and-telegram-is-introducing-a-bot-to-address-the-issue",
    publisher: "Red Hot Cyber",
    kind: "secondary",
  },
];

export async function content(): Promise<AppContent> {
  const gt = await getGT();
  return {
    take: gt("A huge, fast and polished messenger with giant groups, 2 GB uploads and the best bot platform around. But normal chats and all groups aren't end-to-end encrypted, and every account needs a phone number."),
    intro: [
      gt("Telegram is one of the world's biggest messengers, with more than a billion monthly users, groups of up to 200,000 people, broadcast channels and a very mature bot platform. It is built around big chats and channels rather than Discord-style servers, and it keeps most messages readable on its own servers so they sync instantly across devices."),
      gt("Telegram wins clearly on reach, group size, file size, bots and app polish. SerikaCord wins if you want private messages end-to-end encrypted by default on every app, no phone number, and Discord-style servers with roles and voice channels."),
    ],
    verdict: gt("For big broadcast audiences, huge groups or bots that reach millions, Telegram is the stronger tool. For a private, Discord-style community with encrypted DMs and no phone number, pick SerikaCord."),
    facts: {
      operator: {
        value: gt("Telegram Messenger Inc."),
        note: gt("A private company controlled by founder Pavel Durov, launched in 2013. It is financed by bonds, not public shares."),
        src: ["privacy", "wikipedia"],
      },
      jurisdiction: {
        value: gt("British Virgin Islands / Dubai"),
        note: gt("The group is registered in the British Virgin Islands and its team is based in Dubai. Data of UK and EEA users is stored in data centers in the Netherlands."),
        src: ["privacy", "faq", "wikipedia"],
      },
      businessModel: {
        value: gt("Premium, ads and crypto"),
        note: gt("Telegram Premium, Sponsored Messages in large channels, the Stars in-app currency and collectibles sold for TON cryptocurrency. The Financial Times reported 2024 revenue of about $1.4 billion."),
        src: ["premium-launch", "monetization", "stars", "tass"],
      },
      ads: {
        status: "yes",
        value: gt("In large public channels"),
        note: gt("Sponsored Messages appear in public channels with 1,000 or more subscribers in some countries, never in private chats. Channel owners get half the revenue, and Premium hides them."),
        src: ["privacy", "monetization"],
      },
      pricing: {
        value: gt("Free; Premium optional"),
        note: gt("Premium's price varies by country and isn't published on telegram.org. It adds 4 GB uploads, faster downloads and no sponsored messages."),
        src: ["premium"],
      },
      maturity: {
        status: "yes",
        value: gt("Since 2013"),
        note: gt("A mature product that still ships new features almost every month."),
        src: ["wikipedia", "welcome"],
      },
      e2eeDms: {
        status: "partial",
        value: gt("Opt-in Secret Chats"),
        note: gt("Normal chats use client-to-server encryption, so Telegram can read them. Secret Chats are end-to-end encrypted, but you must start one yourself, they work on one device only, and Telegram Desktop and Telegram Web don't support them."),
        src: ["faq", "secret-desktop"],
      },
      e2eeGroups: {
        status: "no",
        note: gt("Groups, including those of up to 200,000 members, are never end-to-end encrypted."),
        src: ["faq"],
      },
      e2eeCalls: {
        status: "yes",
        value: gt("1:1 and group calls"),
        note: gt("One-to-one calls are end-to-end encrypted, and since April 2025 so are new group calls of up to 200 people. Older group voice chats and channel live streams are not documented as encrypted."),
        src: ["group-calls", "e2ee-calls"],
      },
      e2eeCommunity: {
        status: "no",
        note: gt("Groups and channels are stored on Telegram's servers in a form Telegram can read."),
        src: ["faq"],
      },
      e2eeDefault: {
        status: "partial",
        value: gt("Calls only"),
        note: gt("Calls are end-to-end encrypted automatically. For text you have to start a Secret Chat on a supported app."),
        src: ["faq", "group-calls"],
      },
      audit: {
        status: "no",
        value: gt("No published audit"),
        note: gt("Telegram uses its own protocol, MTProto, and has published no independent audit of it. Academics found four attacks in 2022, which Telegram patched, and proved a slightly changed version secure; iOS and Android builds are reproducible."),
        src: ["four-attacks", "mtproto", "techfaq"],
      },
      metadata: {
        value: gt("Telegram sees normal chats"),
        note: gt("Telegram can read all normal chats, groups and channels, and keeps IP addresses and device data for up to 12 months. Secret Chats aren't stored on its servers."),
        src: ["privacy"],
      },
      dataUse: {
        status: "partial",
        value: gt("Doesn't sell data"),
        note: gt("Telegram says it doesn't sell data. It serves its own ads, targeted by channel topic, language and rough location, and discloses no third-party ad trackers."),
        src: ["privacy"],
      },
      phone: {
        status: "yes",
        value: gt("Required"),
        note: gt("Every account is tied to a phone number. The only alternative is an anonymous +888 number bought with TON cryptocurrency on Fragment, which sold out in 2022 and resells for thousands of dollars. Passkey login arrived in December 2025, but a phone number is still needed."),
        src: ["fragment", "passkeys"],
      },
      email: {
        status: "no",
        value: gt("Not required"),
        src: ["privacy"],
      },
      ageChecks: {
        status: "partial",
        value: gt("UK only"),
        note: gt("In the UK, one report says a bot with an on-device face scan gates adult content. There are no ID checks at sign-up. Users in the EU must be 18 or older; we couldn't verify a minimum age elsewhere."),
        src: ["uk-age", "tos"],
      },
      servers: {
        status: "partial",
        value: gt("Groups and channels"),
        note: gt("No Discord-style servers. Since July 2026, Communities can group several chats, channels and bots under one entry."),
        src: ["communities"],
      },
      roles: {
        status: "partial",
        note: gt("Detailed rights per admin, custom admin titles and Member Tags, but no role hierarchy with per-channel permissions."),
        src: ["member-tags"],
      },
      threadsForums: {
        status: "yes",
        note: gt("Topics split a group into forum-style threads, and channel posts can have comment threads."),
        src: ["topics"],
      },
      onboarding: {
        status: "partial",
        note: gt("Join requests, welcome messages only new members see, and AI guardian bots that screen join requests. No Discord-style onboarding questions."),
        src: ["welcome", "watch"],
      },
      modTools: {
        status: "partial",
        note: gt("Admin rights, slow mode, member restrictions, AI anti-spam and join approvals. Many groups also rely on third-party moderation bots."),
        src: ["watch", "wikipedia"],
      },
      platformSafety: {
        status: "partial",
        note: gt("Telegram publishes moderation statistics and reports law enforcement disclosures through its @transparency bot. It has long been criticized over scams and abuse, and the UK regulator Ofcom opened an investigation into its handling of child abuse material in April 2026."),
        src: ["moderation", "privacy", "ofcom"],
      },
      voiceChannels: {
        status: "partial",
        note: gt("Each group can have one ongoing voice chat that members drop into, but not several named voice channels."),
        src: ["wikipedia"],
      },
      videoScreen: {
        status: "yes",
        note: gt("Video calls, group video calls and screen sharing. End-to-end encrypted group calls hold up to 200 people."),
        src: ["group-calls"],
      },
      streamingStage: {
        status: "yes",
        note: gt("Channels can live stream to unlimited viewers, including from OBS. Group voice chats have speaker and listener controls, but there is no separate Stage feature."),
        src: ["wikipedia"],
      },
      botApi: {
        status: "yes",
        note: gt("The most mature bot platform of any messenger: Bot API 10.3, inline bots, payments in Stars and Mini Apps that run inside Telegram."),
        src: ["bot-api", "stars"],
      },
      discordBots: {
        status: "no",
        note: gt("Telegram's Bot API is unrelated to Discord's, so Discord bots have to be rewritten."),
        src: ["bot-api"],
      },
      discordMigration: {
        status: "no",
        note: gt("No official Discord bridge or importer; only third-party bots and bridges."),
      },
      desktop: {
        status: "yes",
        note: gt("Windows, macOS and Linux. Secret Chats work only in the native macOS app, not in Telegram Desktop."),
        src: ["apps", "secret-desktop"],
      },
      mobile: {
        status: "yes",
        note: gt("Android and iPhone from the app stores, plus Apple Watch and Wear OS apps since June 2026."),
        src: ["apps", "watch"],
      },
      web: {
        status: "yes",
        note: gt("Two web apps; Secret Chats aren't available in them."),
        src: ["apps"],
      },
      license: {
        status: "partial",
        value: gt("Open apps, closed server"),
        note: gt("The apps are open source under the GPL, with reproducible builds for iOS and Android. The server code has never been published."),
        src: ["apps", "tdesktop", "android-src"],
      },
      selfHost: {
        status: "no",
        note: gt("Anyone can build an app with the open TDLib library, but all traffic still goes through Telegram's servers."),
        src: ["tdlib"],
      },
      federation: {
        status: "no",
        note: gt("One central service."),
      },
      uploads: {
        value: gt("2 GB per file"),
        note: gt("4 GB with Premium, and cloud storage is unlimited."),
        src: ["faq", "premium"],
      },
      groupSize: {
        value: gt("Groups: 200,000"),
        note: gt("Channels can have unlimited subscribers. Encrypted group calls hold up to 200 people."),
        src: ["faq", "group-calls"],
      },
      scale: {
        status: "yes",
        value: gt("1B+ monthly users"),
        note: gt("Telegram says it passed 1 billion monthly active users in March 2025, and reported more than 15 million Premium subscribers in the first half of 2025."),
        src: ["faq", "wikipedia", "h1-2025"],
      },
      incidents: {
        value: gt("Founder under investigation"),
        note: gt("Pavel Durov has been under formal investigation in France since August 2024, with no trial or conviction as of October 2026, and Russia charged him in July 2026. Telegram was ordered blocked in Vietnam in May 2025, has been restricted in Russia since 2025, and was briefly removed from Apple's App Store on 3 August 2026."),
        src: ["tc-durov", "durov-wiki", "occrp", "vietnam", "russia-calls", "russia-2026", "wikipedia"],
      },
    },
    whyUs: [
      {
        title: gt("Private messages encrypted by default, on every app"),
        text: gt("On SerikaCord, new DMs and group DMs of up to 10 people are end-to-end encrypted by default, including on the web and desktop apps. On Telegram, normal chats and all groups can be read by Telegram, and Secret Chats are opt-in, one-to-one only and missing from Telegram Desktop and Telegram Web. Our encryption is new and hasn't been audited."),
        src: ["faq", "secret-desktop"],
      },
      {
        title: gt("No phone number"),
        text: gt("SerikaCord needs an email address, not a phone number. Telegram ties every account to a phone number unless you buy an expensive anonymous number with cryptocurrency, and since September 2024 it may give a suspect's IP address and phone number to authorities on a valid court order."),
        src: ["fragment", "privacy"],
      },
      {
        title: gt("Built for communities with many channels"),
        text: gt("SerikaCord has Discord-style servers: text, voice, forum and ticket channels, roles with per-channel permissions, onboarding and AutoMod. Telegram builds communities out of separate groups and channels, with one voice chat per group and no per-channel permissions."),
        src: ["communities", "member-tags"],
      },
      {
        title: gt("Your Discord bots and server can come along"),
        text: gt("SerikaCord's bot API follows Discord's API v10, and a consent-based bridge mirrors a Discord server while people move over. Telegram's bot platform is excellent but unrelated to Discord's, so bots must be rewritten."),
        src: ["bot-api"],
      },
      {
        title: gt("No ads, run from the EU"),
        text: gt("SerikaCord shows no ads and is run from the Netherlands under the GDPR. Telegram shows Sponsored Messages in large public channels, and its group is registered in the British Virgin Islands with its team in Dubai."),
        src: ["monetization", "privacy"],
      },
    ],
    whyThem: [
      {
        title: gt("Everyone already has it"),
        text: gt("Telegram has more than a billion monthly users, so the people you want to reach probably already have the app. SerikaCord is small and young, and you will likely have to bring people over yourself."),
        src: ["faq"],
      },
      {
        title: gt("Huge groups and big files"),
        text: gt("Telegram groups hold up to 200,000 people, channels have no subscriber limit, and free accounts can send 2 GB files with unlimited cloud storage. SerikaCord's free limit is 500 MB per file, and we haven't been tested at that kind of scale."),
        src: ["faq"],
      },
      {
        title: gt("The best bot and mini app platform"),
        text: gt("Telegram's Bot API is on version 10.3, with inline bots, payments in Stars and full web apps inside chats. SerikaCord's bot API follows Discord's and is much younger."),
        src: ["bot-api", "stars"],
      },
      {
        title: gt("Polished apps everywhere, including iPhone"),
        text: gt("Telegram has had native apps for iPhone, Android, Windows, macOS and Linux for years, plus two web apps and smartwatch apps. SerikaCord has no iPhone app yet, and its Android app comes from our website rather than Google Play."),
        src: ["apps", "watch"],
      },
      {
        title: gt("Encrypted group calls for up to 200 people"),
        text: gt("Since April 2025 Telegram's new group calls are end-to-end encrypted for up to 200 people, with emoji codes to verify them. SerikaCord encrypts calls only in DMs and group DMs of up to 10 people, and our server voice channels are not end-to-end encrypted."),
        src: ["group-calls", "e2ee-calls"],
      },
      {
        title: gt("Open-source apps"),
        text: gt("Telegram's apps are open source under the GPL, and its iOS and Android builds can be checked against the code. SerikaCord's code is public but source-available, not open source."),
        src: ["apps", "android-src"],
      },
    ],
    pickThem: [
      gt("the people you want to reach already use Telegram"),
      gt("you run a broadcast channel or a group of tens of thousands of people"),
      gt("you need to send very large files for free"),
      gt("you are building a bot or mini app for a big audience"),
      gt("you need an iPhone app today"),
    ],
    pickUs: [
      gt("you want your private messages end-to-end encrypted by default on every device, including desktop and web"),
      gt("you don't want to tie your account to a phone number"),
      gt("you want Discord-style servers with roles, many text channels and voice channels"),
      gt("you want to run Discord bots or bridge a Discord server"),
      gt("you prefer an ad-free service run from the EU"),
    ],
    faq: [
      {
        question: gt("Is Telegram end-to-end encrypted?"),
        answer: gt("Not by default. Normal chats, groups and channels are encrypted only between your app and Telegram's servers, so Telegram can read them. Secret Chats are end-to-end encrypted but are opt-in, one-to-one and not available in Telegram Desktop or Telegram Web; calls, including group calls since April 2025, are end-to-end encrypted."),
      },
      {
        question: gt("Does Telegram give user data to the police?"),
        answer: gt("Since September 2024 its privacy policy says it may disclose a suspect's IP address and phone number on a valid order from judicial authorities. It reports these disclosures through its @transparency bot; for 2024 it reported 900 requests from the United States covering 2,253 users."),
      },
      {
        question: gt("Who runs Telegram?"),
        answer: gt("Telegram was founded in 2013 by Pavel and Nikolai Durov and is controlled by Pavel Durov. Its group is registered in the British Virgin Islands and its team is based in Dubai. Durov has been under formal investigation in France since August 2024, with no trial or conviction as of October 2026, and Russia charged him in July 2026."),
      },
      {
        question: gt("Do I need a phone number for Telegram?"),
        answer: gt("Yes. Every Telegram account is tied to a phone number, unless you buy an anonymous +888 number with TON cryptocurrency. SerikaCord doesn't ask for a phone number; it needs an email address."),
      },
      {
        question: gt("Is Telegram open source? Can I host my own Telegram server?"),
        answer: gt("Telegram's apps are open source, but its server is closed and there is no way to run your own. Everything goes through Telegram's servers."),
      },
      {
        question: gt("Can I move my Discord server to Telegram?"),
        answer: gt("There is no official way, and Telegram has no Discord-style servers, so you would rebuild your community as groups and channels. SerikaCord works like Discord, has a bot API that follows Discord's, and offers a consent-based bridge to a Discord server."),
      },
      {
        question: gt("Is Telegram or SerikaCord better for a very large community?"),
        answer: gt("For sheer size Telegram is ahead: groups of 200,000, unlimited channels and more than a billion users. SerikaCord is better for structured servers with channels, roles and voice, but it hasn't been tested at Telegram's scale."),
      },
    ],
    couldNotVerify: [
      gt("The price of Telegram Premium, which varies by country and isn't published on telegram.org."),
      gt("Telegram's minimum age outside the EU."),
      gt("Any independent audit of the end-to-end encrypted group call protocol launched in April 2025."),
      gt("Full worldwide totals of Telegram's 2025 disclosures to authorities; the compilation we found covers only 15 countries."),
      gt("Details of the UK age-check bot and whether it is mandatory, which come from a single report."),
    ],
    notes: {
      title: gt("What Telegram's FAQ says vs its privacy policy"),
      intro: gt("Telegram's documents describe its cooperation with authorities differently."),
      points: [
        gt("The FAQ still says Telegram has disclosed 0 bytes of user messages and that court orders from several jurisdictions would be needed to reach data."),
        gt("Since 23 September 2024, section 8.3 of the privacy policy says Telegram may disclose a suspect's IP address and phone number on a valid order from judicial authorities, where before it said this only for terror suspects."),
        gt("Telegram's own @transparency bot shows these disclosures happening: for 2024, 900 requests from the United States covering 2,253 users and 14,641 requests from India covering 23,535 users."),
      ],
      src: ["faq", "privacy", "404-data", "transparency-data"],
    },
  };
}

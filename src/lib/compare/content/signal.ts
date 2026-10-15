import { getGT } from "gt-next/server";
import type { AppContent, CompareSource } from "../types";

/**
 * SerikaCord vs Signal. Facts checked on COMPARE_LAST_CHECKED_ISO against
 * the sources below (titles and publishers are proper names, not translated).
 */

export const sources: CompareSource[] = [
  { id: "home", title: "Signal homepage", url: "https://signal.org/", publisher: "Signal", kind: "primary" },
  { id: "bigbrother", title: "Signal Government Communication (legal requests and responses)", url: "https://signal.org/bigbrother/", publisher: "Signal", kind: "primary" },
  {
    id: "dc-subpoena",
    title: "Grand jury subpoena for Signal user data, District of Columbia",
    url: "https://signal.org/bigbrother/district-of-columbia/",
    publisher: "Signal",
    kind: "primary",
    date: "2026-03-06",
  },
  { id: "legal", title: "Signal Terms of Service & Privacy Policy", url: "https://signal.org/legal/", publisher: "Signal", kind: "primary" },
  { id: "download", title: "Download Signal", url: "https://signal.org/download/", publisher: "Signal", kind: "primary" },
  { id: "expensive", title: "Privacy is Priceless, but Signal is Expensive", url: "https://signal.org/blog/signal-is-expensive/", publisher: "Signal", kind: "primary", date: "2023-11-16" },
  { id: "spqr", title: "Signal Protocol and Post-Quantum Ratchets", url: "https://signal.org/blog/spqr/", publisher: "Signal", kind: "primary", date: "2025-10-02" },
  { id: "backups", title: "Introducing Signal Secure Backups", url: "https://signal.org/blog/introducing-secure-backups/", publisher: "Signal", kind: "primary", date: "2025-09-08" },
  { id: "call-links", title: "Improving Private Signal Calls: Call Links & More", url: "https://signal.org/blog/call-links/", publisher: "Signal", kind: "primary", date: "2024-11-11" },
  {
    id: "usernames",
    title: "Keep your phone number private with Signal usernames",
    url: "https://signal.org/blog/phone-number-privacy-usernames/",
    publisher: "Signal",
    kind: "primary",
    date: "2024-02-20",
  },
  { id: "labels", title: "Label yourself (group member labels)", url: "https://signal.org/blog/group-member-labels/", publisher: "Signal", kind: "primary", date: "2026-03-19" },
  {
    id: "linked-devices",
    title: "More linked devices are on the table (and the Android tablet)",
    url: "https://signal.org/blog/linked-devices-and-android-tablets/",
    publisher: "Signal",
    kind: "primary",
    date: "2026-08-04",
  },
  { id: "support-groups", title: "Signal Support: Group chats", url: "https://support.signal.org/hc/articles/360007319331-Group-chats", publisher: "Signal", kind: "primary" },
  {
    id: "support-video",
    title: "Signal Support: Group Video Calling",
    url: "https://support.signal.org/hc/en-us/articles/360052977792-Group-Video-Calling",
    publisher: "Signal",
    kind: "primary",
  },
  {
    id: "support-screen",
    title: "Signal Support: Screen Sharing with Signal Desktop Calls",
    url: "https://support.signal.org/hc/en-us/articles/5369688043418-Screen-Sharing-with-Signal-Desktop-Calls",
    publisher: "Signal",
    kind: "primary",
  },
  { id: "github", title: "signalapp source code (AGPL-3.0)", url: "https://github.com/signalapp", publisher: "GitHub", kind: "primary" },
  { id: "wikipedia", title: "Signal (software)", url: "https://en.wikipedia.org/wiki/Signal_(software)", publisher: "Wikipedia", kind: "secondary" },
  {
    id: "signalgate",
    title: "United States government group chat leaks",
    url: "https://en.wikipedia.org/wiki/United_States_government_group_chat_leaks",
    publisher: "Wikipedia",
    kind: "secondary",
  },
  {
    id: "tc-backups",
    title: "Signal introduces free and paid backup plans for your chats",
    url: "https://techcrunch.com/2025/09/08/signal-introduces-free-and-paid-backup-plans-for-your-chats",
    publisher: "TechCrunch",
    kind: "secondary",
    date: "2025-09-08",
  },
  {
    id: "telemessage",
    title: "Signal clone used by Waltz was an insecure mess",
    url: "https://www.theregister.com/2025/05/05/telemessage_investigating/",
    publisher: "The Register",
    kind: "secondary",
    date: "2025-05-05",
  },
  {
    id: "micah",
    title: "The Signal clone the Trump admin uses was hacked",
    url: "https://micahflee.com/the-signal-clone-the-trump-admin-uses-was-hacked/",
    publisher: "Micah Lee",
    kind: "secondary",
    date: "2025-05",
  },
  {
    id: "uk-scan",
    title: "Signal says UK plan to scan devices for nude images 'endangers us all'",
    url: "https://www.theregister.com/a/5252761",
    publisher: "The Register",
    kind: "secondary",
    date: "2026-06-09",
  },
  {
    id: "eu-exit",
    title: "Signal boss threatens to withdraw from Europe",
    url: "https://www.bluewin.ch/en/news/signal-app-boss-threatens-to-withdraw-from-europe-2897197.html",
    publisher: "blue News",
    kind: "secondary",
    date: "2025-10",
  },
  {
    id: "sweden",
    title: "Signal may exit Sweden over encryption backdoor",
    url: "https://www.infosecurity-magazine.com/news/signal-exit-sweden-government/",
    publisher: "Infosecurity Magazine",
    kind: "secondary",
    date: "2025-02",
  },
  {
    id: "mobiflip",
    title: "Signal sorgt für mehr Ordnung in Gruppen und mehr Teilnehmer bei Anrufen",
    url: "https://www.mobiflip.de/signal-sorgt-fuer-mehr-ordnung-in-gruppen-und-mehr-teilnehmer-bei-anrufen/amp/",
    publisher: "mobiflip",
    kind: "secondary",
    date: "2026-04-13",
  },
  {
    id: "fpf",
    title: "Signal accounts, now with multiple phones",
    url: "https://freedom.press/digisec/blog/signal-accounts-now-with-multiple-phones/",
    publisher: "Freedom of the Press Foundation",
    kind: "secondary",
    date: "2026-08-12",
  },
  { id: "stats", title: "Signal statistics", url: "https://sqmagazine.co.uk/signal-statistics/", publisher: "SQ Magazine", kind: "secondary" },
];

export async function content(): Promise<AppContent> {
  const gt = await getGT();
  return {
    take: gt("The gold standard for private messaging: everything end-to-end encrypted by default, almost no metadata, nonprofit and open source. But it needs a phone number and has no servers, channels, bots or web app."),
    intro: [
      gt("Signal is a private messenger run by a US nonprofit since 2014. Every message, group and call is end-to-end encrypted by default, and Signal keeps so little data that its published answers to subpoenas contain only when an account was created and when it last connected."),
      gt("SerikaCord is a different kind of app: a Discord-style home for communities, with servers, channels, roles, voice channels, moderation and bots. Our end-to-end encryption launched in October 2026, covers only DMs and group DMs, and hasn't been audited."),
      gt("On privacy and security Signal is far ahead of SerikaCord, and we say so plainly. SerikaCord wins only if you want to run a community, use bots or chat from a browser without giving a phone number."),
    ],
    verdict: gt("For private conversations with friends, family or sources, use Signal. If you want to run a community with channels, roles, voice rooms and bots, SerikaCord does that and Signal doesn't try to."),
    facts: {
      operator: {
        value: gt("Signal Technology Foundation"),
        note: gt("A US nonprofit (501(c)(3)) announced in 2018. The service itself is run by Signal Messenger LLC."),
        src: ["wikipedia", "legal"],
      },
      jurisdiction: {
        value: gt("United States"),
        note: gt("Based in Mountain View, California. Signal doesn't publish where its servers are."),
        src: ["legal", "wikipedia"],
      },
      businessModel: {
        value: gt("Donations (nonprofit)"),
        note: gt("Started with a loan of about $50 million from Brian Acton in 2018. Signal said in 2023 it costs about $33 million a year to run; the first paid feature, media backups, arrived in September 2025."),
        src: ["expensive", "backups", "wikipedia"],
      },
      ads: {
        status: "no",
        value: gt("No ads"),
        note: gt("No ads and no trackers, as Signal's homepage says."),
        src: ["home"],
      },
      pricing: {
        value: gt("Free; backups optional"),
        note: gt("Everything is free. An optional $1.99 a month plan backs up your full media history, up to 100 GB; free backups cover all text and the last 45 days of media."),
        src: ["backups", "tc-backups"],
      },
      maturity: {
        status: "yes",
        value: gt("Since 2014"),
        note: gt("A mature, actively developed app. Recent additions include polls, pinned messages and more linked devices in 2025 and 2026."),
        src: ["wikipedia", "linked-devices"],
      },
      e2eeDms: {
        status: "yes",
        value: gt("Always"),
        note: gt("The Signal Protocol, with post-quantum protection added in 2023 and a post-quantum ratchet added in October 2025. Sealed sender hides who sent a message from Signal's servers."),
        src: ["spqr", "wikipedia"],
      },
      e2eeGroups: {
        status: "yes",
        value: gt("Groups up to 1,000"),
        note: gt("Every group is end-to-end encrypted, and Signal's servers can't see group names or member lists."),
        src: ["support-groups", "wikipedia"],
      },
      e2eeCalls: {
        status: "yes",
        value: gt("All calls"),
        note: gt("1:1 and group voice and video calls of up to 75 people, including call links."),
        src: ["support-video", "call-links"],
      },
      e2eeCommunity: {
        value: gt("Not applicable"),
        note: gt("Signal has no servers or public channels. Everything is a chat or a group, and all of it is encrypted."),
        src: ["wikipedia"],
      },
      e2eeDefault: {
        status: "yes",
        value: gt("Always on"),
        note: gt("There is no unencrypted mode."),
        src: ["home"],
      },
      audit: {
        status: "partial",
        value: gt("Studied in depth"),
        note: gt("The Signal Protocol is the most studied messaging protocol in academic research, and Signal says its 2025 post-quantum ratchet was formally verified. We found no recent public third-party audit of the full apps and servers."),
        src: ["spqr", "wikipedia"],
      },
      metadata: {
        value: gt("Almost nothing"),
        note: gt("In its published subpoena responses, the only account data Signal could hand over was when an account was created and when it last connected."),
        src: ["bigbrother", "dc-subpoena"],
      },
      dataUse: {
        status: "yes",
        value: gt("No trackers, no selling"),
        note: gt("Signal says it has no ads or trackers and keeps profile names and photos end-to-end encrypted."),
        src: ["home", "legal"],
      },
      phone: {
        status: "yes",
        value: gt("Required"),
        note: gt("Needed to register, even since usernames arrived in February 2024. Your number is hidden by default, but people who already have it can find you unless you change a setting."),
        src: ["usernames"],
      },
      email: {
        status: "no",
        value: gt("Not required"),
        src: ["legal"],
      },
      ageChecks: {
        status: "no",
        value: gt("No ID or face scans"),
        note: gt("Minimum age 13 (higher in some countries), with no verification. Signal publicly opposes mandatory age verification."),
        src: ["legal", "uk-scan"],
      },
      servers: {
        status: "no",
        note: gt("No servers or channels. The largest unit is a group of up to 1,000 people."),
        src: ["support-groups"],
      },
      roles: {
        status: "partial",
        value: gt("Admins and members only"),
        note: gt("Groups have admins and members. Member labels added in March 2026 are self-chosen tags that grant no permissions."),
        src: ["labels"],
      },
      threadsForums: {
        status: "no",
        note: gt("No threads or forums. Polls and pinned messages exist in chats."),
        src: ["wikipedia"],
      },
      onboarding: {
        status: "partial",
        note: gt("Group invite links and QR codes can require admin approval. There is no rules screening or onboarding flow."),
        src: ["support-groups"],
      },
      modTools: {
        status: "partial",
        value: gt("Basic group admin tools"),
        note: gt("Admins can approve joins, remove members and limit who can send messages or edit group info. No AutoMod, audit log or timeouts."),
        src: ["support-groups"],
      },
      platformSafety: {
        status: "partial",
        note: gt("Message requests from unknown people and spam reporting. Signal can't read messages, so it doesn't moderate content, and it publishes every legal request it answers."),
        src: ["bigbrother"],
      },
      voiceChannels: {
        status: "no",
        note: gt("No drop-in voice channels. Group calls and shareable call links, with optional admin approval, cover meetups."),
        src: ["call-links"],
      },
      videoScreen: {
        status: "yes",
        note: gt("Group video calls of up to 75 people. Screen sharing works from the desktop app; we couldn't confirm it on phones."),
        src: ["support-video", "support-screen", "mobiflip"],
      },
      streamingStage: {
        status: "no",
        note: gt("No live streaming or Stage-style events."),
        src: ["wikipedia"],
      },
      botApi: {
        status: "no",
        note: gt("No official bot API, webhooks or integrations."),
        src: ["wikipedia"],
      },
      discordBots: { status: "no" },
      discordMigration: {
        status: "no",
        note: gt("No Discord bridge or importer."),
      },
      desktop: {
        status: "yes",
        note: gt("Windows, macOS 13 or newer, and 64-bit Debian or Ubuntu-based Linux. The desktop app is a linked device, so you need Signal on a phone first."),
        src: ["download", "wikipedia"],
      },
      mobile: {
        status: "yes",
        note: gt("Android and iPhone from the app stores. Since August 2026 a second phone or an Android tablet can be a linked device."),
        src: ["download", "linked-devices", "fpf"],
      },
      web: {
        status: "no",
        note: gt("There is no browser version."),
        src: ["download"],
      },
      license: {
        status: "yes",
        value: gt("AGPL-3.0"),
        note: gt("The apps, the server and the encryption library are all open source."),
        src: ["github"],
      },
      selfHost: {
        status: "no",
        value: gt("Not in practice"),
        note: gt("The server code is public, but the official apps only connect to Signal's servers, and Signal says it can't vouch for the security of unofficial versions."),
        src: ["github", "telemessage"],
      },
      federation: {
        status: "no",
        note: gt("One central service; Signal has chosen not to federate."),
        src: ["wikipedia"],
      },
      uploads: {
        status: "unknown",
        note: gt("Often quoted as 100 MB, but we couldn't find Signal's own statement of the limit."),
      },
      groupSize: {
        value: gt("Groups: 1,000; calls: 75"),
        note: gt("The call limit was raised from 40 to 75 people around April 2026."),
        src: ["support-groups", "support-video", "mobiflip"],
      },
      scale: {
        status: "yes",
        value: gt("About 70-100M monthly users"),
        note: gt("Signal doesn't publish user numbers. This range comes from Signal's Meredith Whittaker, quoted by the press in 2025; downloads exceed 220 million."),
        src: ["stats", "wikipedia"],
      },
      incidents: {
        value: gt("Mostly others' mistakes"),
        note: gt("In March 2025 US officials accidentally added a journalist to a Signal group about military strikes; that was user error, not a flaw in Signal. A 2022 breach at SMS vendor Twilio exposed numbers of about 1,900 users. Blocked in Russia and Venezuela since 2024."),
        src: ["signalgate", "wikipedia"],
      },
    },
    whyUs: [
      {
        title: gt("Built for communities, not just chats"),
        text: gt("SerikaCord has servers with text, voice, forum and ticket channels, Discord-style roles with per-channel permissions, threads and onboarding. Signal has groups of up to 1,000 people where everyone is either an admin or a member."),
        src: ["support-groups", "labels"],
      },
      {
        title: gt("Moderation that scales past a group chat"),
        text: gt("SerikaCord gives moderators AutoMod, an audit log, timeouts, rules screening and verification levels. Signal admins can approve joins and remove members, which works for a family group but not for a large public community."),
        src: ["support-groups"],
      },
      {
        title: gt("Voice channels you can drop into"),
        text: gt("On SerikaCord you can hang out in a voice channel and leave whenever you like, with screen sharing up to 60 FPS. Signal has excellent encrypted group calls of up to 75 people but no always-open voice rooms. Our server voice channels are not end-to-end encrypted, and calls are peer-to-peer where possible, so others can see your IP address."),
        src: ["support-video", "call-links"],
      },
      {
        title: gt("Bots and a path from Discord"),
        text: gt("SerikaCord's bot API follows Discord's API v10, so many discord.js and discord.py bots run after changing one address, and a consent-based bridge mirrors a Discord server. Signal has no official bot API at all."),
        src: ["wikipedia"],
      },
      {
        title: gt("No phone number, and it works in a browser"),
        text: gt("SerikaCord needs an email address, not a phone number, and everything works on the web. Signal requires a phone number and has no web version. That said, Signal hides your number by default and sees far less about you than we do."),
        src: ["usernames", "download"],
      },
    ],
    whyThem: [
      {
        title: gt("Far stronger, proven encryption"),
        text: gt("Signal's encryption is the most studied in messaging, on by default for every chat, group and call, and protected against future quantum computers since 2023 and 2025. Ours launched in October 2026, covers only DMs and group DMs, and hasn't been audited."),
        src: ["spqr", "wikipedia"],
      },
      {
        title: gt("It knows almost nothing about you, and has shown it"),
        text: gt("Signal publishes its answers to subpoenas, and they contain only when an account was created and when it last connected. SerikaCord can see who talks to whom and when, and can read everything in server channels."),
        src: ["bigbrother", "dc-subpoena"],
      },
      {
        title: gt("Encrypted groups and calls at a bigger size"),
        text: gt("Signal encrypts groups of up to 1,000 people and group calls of up to 75. SerikaCord's encrypted group DMs stop at 10 people, and our server channels and voice channels are not end-to-end encrypted."),
        src: ["support-groups", "support-video"],
      },
      {
        title: gt("Nonprofit and fully open source"),
        text: gt("Signal is a donation-funded nonprofit with no investors, and its apps, server and encryption library are open source under the AGPL-3.0. SerikaCord is run by a small company and its code is source-available, not open source."),
        src: ["github", "expensive"],
      },
      {
        title: gt("Mature, widely used and on iPhone"),
        text: gt("Signal has been around since 2014 and has an estimated 70 to 100 million monthly users, with native apps for Android and iPhone. SerikaCord launched in January 2026 and has no iPhone app yet."),
        src: ["stats", "download"],
      },
      {
        title: gt("Stands up to surveillance laws, and younger teens can use it"),
        text: gt("Signal has said it would leave Sweden or the EU rather than weaken its encryption, and opposes mandatory age verification. Its minimum age is 13; SerikaCord's is 16."),
        src: ["sweden", "eu-exit", "uk-scan", "legal"],
      },
    ],
    pickThem: [
      gt("you want the strongest privacy for your conversations, full stop"),
      gt("you're a journalist, activist or anyone whose messages could put people at risk"),
      gt("you want encrypted group chats with more than 10 people, or encrypted group calls"),
      gt("you need an iPhone app today"),
    ],
    pickUs: [
      gt("you want to run a community with channels, roles and moderation"),
      gt("you want voice channels people can drop into"),
      gt("you rely on bots or are moving a Discord server"),
      gt("you want to chat from a browser without giving a phone number"),
    ],
    faq: [
      {
        question: gt("Is Signal more private than SerikaCord?"),
        answer: gt("Yes. Signal encrypts every chat, group and call end to end by default and keeps almost no metadata. SerikaCord encrypts only DMs and group DMs, can see who talks to whom, and its encryption hasn't been audited."),
      },
      {
        question: gt("Is Signal end-to-end encrypted?"),
        answer: gt("Yes, always. Every message, group and call uses the Signal Protocol, which added post-quantum protection in 2023 and 2025. There is no unencrypted mode."),
      },
      {
        question: gt("Does Signal need a phone number?"),
        answer: gt("Yes, to register. Since February 2024 you can chat by username and keep your number hidden, but you still need one to sign up. SerikaCord uses an email address instead."),
      },
      {
        question: gt("Can I use Signal in a browser?"),
        answer: gt("No. Signal has apps for Android, iPhone, Windows, macOS and Linux, and the desktop apps need Signal on a phone first. SerikaCord works fully in the browser."),
      },
      {
        question: gt("Can I run a Discord-style community on Signal?"),
        answer: gt("Not really. Signal has groups of up to 1,000 people with admins and members, but no servers, channels, custom roles, bots or voice channels. It is built for private conversations, not communities."),
      },
      {
        question: gt("Is Signal open source, and can I host it myself?"),
        answer: gt("Signal's apps and server are open source under the AGPL-3.0. In practice you can't self-host it, because the official apps only connect to Signal's servers."),
      },
      {
        question: gt("Who runs Signal?"),
        answer: gt("The Signal Technology Foundation, a US nonprofit, through Signal Messenger LLC. It is funded by donations and has no ads or investors."),
      },
      {
        question: gt("Was Signal hacked in the 2025 ‘Signalgate’ story?"),
        answer: gt("No. US officials added a journalist to a group chat by mistake, which was user error. A separate modified Signal clone made by TeleMessage was hacked, but that was not Signal's own app."),
      },
    ],
    couldNotVerify: [
      gt("Signal's free file size limit: often quoted as 100 MB, but we found no statement from Signal."),
      gt("An official user count: Signal doesn't publish one, so the 70 to 100 million figure comes from press interviews."),
      gt("A recent public third-party audit of Signal's full apps and servers."),
      gt("Whether screen sharing works in the phone apps; only the desktop app is confirmed."),
      gt("Signal's 2024 income and costs, which we only saw quoted on Wikipedia."),
    ],
    notes: {
      title: gt("Signalgate and the TeleMessage clone"),
      intro: gt("Two 2025 news stories put Signal in the headlines without being about flaws in Signal itself."),
      points: [
        gt("In March 2025 The Atlantic's editor was added by mistake to a Signal group where senior US officials discussed military strikes in Yemen. This was a user mistake; Signal's encryption worked as designed."),
        gt("In May 2025 an official was photographed using TM SGNL, a modified Signal clone made by the archiving company TeleMessage. TeleMessage was then hacked and suspended its service. Signal said it can't guarantee the security of unofficial versions of its app."),
      ],
      src: ["signalgate", "telemessage", "micah"],
    },
  };
}

import { getGT } from "gt-next/server";
import type { AppContent, CompareSource } from "../types";

/**
 * SerikaCord vs Session. Facts checked on COMPARE_LAST_CHECKED_ISO against
 * the sources below (titles and publishers are proper names, not translated).
 */

export const sources: CompareSource[] = [
  { id: "home", title: "Session homepage", url: "https://getsession.org/", publisher: "Session", kind: "primary" },
  { id: "v2-update", title: "Session Protocol V2 update", url: "https://getsession.org/blog/session-protocol-v2-update", publisher: "Session", kind: "primary", date: "2026-10-13" },
  { id: "v2", title: "Session Protocol V2", url: "https://getsession.org/blog/session-protocol-v2", publisher: "Session", kind: "primary", date: "2025-12-01" },
  {
    id: "pro-paused",
    title: "Development update: stability fixes and network improvements",
    url: "https://getsession.org/blog/development-update-stability-fixes-and-network-improvements",
    publisher: "Session",
    kind: "primary",
    date: "2026-10-06",
  },
  { id: "tokenomics", title: "Session Pro tokenomics proposal", url: "https://getsession.org/blog/session-pro-tokenomics-proposal", publisher: "Session", kind: "primary", date: "2026-08-24" },
  { id: "future", title: "The Future of Session", url: "https://getsession.org/blog/the-future-of-session", publisher: "Session", kind: "primary", date: "2026-06-15" },
  {
    id: "appeal",
    title: "A personal appeal from cofounder of Session, Chris McCabe",
    url: "https://getsession.org/blog/a-personal-appeal-from-cofounder-of-session-chris-mccabe",
    publisher: "Session",
    kind: "primary",
    date: "2026-03-18",
  },
  { id: "pro-beta", title: "Introducing Session Pro Beta", url: "https://getsession.org/blog/session-pro-beta", publisher: "Session", kind: "primary", date: "2025-07-08" },
  { id: "faq", title: "Session FAQ", url: "https://getsession.org/faq", publisher: "Session", kind: "primary" },
  { id: "privacy", title: "Session Privacy Policy", url: "https://getsession.org/privacy-policy", publisher: "Session", kind: "primary" },
  { id: "foundation", title: "Session Technology Foundation", url: "https://session.foundation/", publisher: "Session Technology Foundation", kind: "primary" },
  {
    id: "transparency",
    title: "Session Technology Foundation transparency reports",
    url: "https://session.foundation/transparency-reports",
    publisher: "Session Technology Foundation",
    kind: "primary",
  },
  {
    id: "transparency-2025",
    title: "Session Technology Foundation Transparency Report 2025",
    url: "https://cdn.sanity.io/files/btop3zhg/production/f18dca6074797525514604a421c041a6d3a4a42a.pdf",
    publisher: "Session Technology Foundation",
    kind: "primary",
    date: "2025",
  },
  { id: "appstore", title: "Session Private Messenger on the App Store", url: "https://apps.apple.com/us/app/session-private-messenger/id1470168868", publisher: "Apple", kind: "primary" },
  { id: "github-desktop", title: "session-desktop source code and releases", url: "https://github.com/session-foundation/session-desktop", publisher: "GitHub", kind: "primary" },
  { id: "github-android", title: "session-android source code and releases", url: "https://github.com/session-foundation/session-android", publisher: "GitHub", kind: "primary" },
  { id: "soatok", title: "Don't Use Session (Signal Fork)", url: "https://soatok.blog/2025/01/14/dont-use-session-signal-fork/", publisher: "Soatok", kind: "secondary", date: "2025-01-14" },
  { id: "wikipedia", title: "Session (software)", url: "https://en.wikipedia.org/wiki/Session_(software)", publisher: "Wikipedia", kind: "secondary" },
];

export async function content(): Promise<AppContent> {
  const gt = await getGT();
  return {
    take: gt("A private messenger with no phone number or email, and onion routing that hides your IP address. But its encryption lacks forward secrecy, its team shrank sharply in 2026, and it has no community features."),
    intro: [
      gt("Session is a private messenger that started in 2018 as a fork of Signal and is now run by a Swiss foundation. You sign up with a random Account ID instead of a phone number or email, and messages travel through a network of about 1,500 community-run nodes using onion routing, which hides your IP address from the servers that store them."),
      gt("SerikaCord is a Discord-style community app with servers, channels, roles, voice channels, moderation and bots, and its end-to-end encryption, launched in October 2026, covers only DMs and group DMs and hasn't been audited. Session is better for anonymous private messaging; SerikaCord is better for running a community, though both have real caveats."),
    ],
    verdict: gt("If you want to message people without giving any personal details and hide your IP address, Session does that, with the encryption and funding caveats below. If you want a community with channels, voice rooms and bots, pick SerikaCord."),
    facts: {
      operator: {
        value: gt("Session Technology Foundation"),
        note: gt("A Swiss nonprofit foundation that took over from Australia's Oxen Privacy Tech Foundation on 11 October 2024. The App Store still lists an Australian company, Rangeproof, as the seller."),
        src: ["foundation", "wikipedia", "appstore"],
      },
      jurisdiction: {
        value: gt("Switzerland"),
        note: gt("Moved from Australia in 2024, citing its surveillance laws. Messages are stored on community-run nodes around the world, not in one data center."),
        src: ["faq", "wikipedia"],
      },
      businessModel: {
        value: gt("Donations and grants"),
        note: gt("Donations after an emergency appeal in March 2026, grants and a planned Session Pro subscription. The network's nodes are run by people who stake the SESH crypto token and are paid in it."),
        src: ["appeal", "future", "tokenomics"],
      },
      ads: {
        status: "no",
        value: gt("No ads"),
        src: ["home"],
      },
      pricing: {
        value: gt("Free; paid plan paused"),
        note: gt("Everything is free today. A Session Pro subscription with longer messages, more pinned chats and larger groups was in beta, but its launch was paused on 6 October 2026 and no price was ever published."),
        src: ["pro-beta", "pro-paused"],
      },
      maturity: {
        status: "partial",
        value: gt("Since 2018; small team"),
        note: gt("The apps were still updated in October 2026, but development paused in early 2026 for lack of money and resumed in June with 2 to 3 developers, down from more than 12."),
        src: ["future", "appeal", "github-desktop"],
      },
      e2eeDms: {
        status: "yes",
        value: gt("Yes, without forward secrecy"),
        note: gt("Always encrypted, but the current protocol uses one long-term key, so if that key is ever stolen, past messages could be decrypted. Protocol v2 with forward secrecy was not live on 13 October 2026."),
        src: ["v2", "v2-update", "soatok"],
      },
      e2eeGroups: {
        status: "yes",
        value: gt("Groups up to 100"),
        note: gt("Closed groups of up to 100 members are end-to-end encrypted."),
        src: ["faq"],
      },
      e2eeCalls: {
        status: "partial",
        value: gt("1:1 beta calls"),
        note: gt("One-to-one voice and video calls are encrypted but still in beta and off by default. They are peer-to-peer, which shows your IP address to the other person and to the foundation's relay servers. No group calls."),
        src: ["faq"],
      },
      e2eeCommunity: {
        status: "no",
        note: gt("Communities are encrypted only in transit and can be read by whoever runs the community server."),
        src: ["faq"],
      },
      e2eeDefault: {
        status: "yes",
        value: gt("On for chats and groups"),
        note: gt("Chats and groups are always encrypted; calls must be switched on first."),
        src: ["faq"],
      },
      audit: {
        status: "partial",
        value: gt("One audit, in 2021"),
        note: gt("Quarkslab audited the apps in 2021; we found no newer audit. In January 2025 the cryptographer Soatok published a critique of its key design and missing forward secrecy, and Session posted a rebuttal."),
        src: ["faq", "soatok"],
      },
      metadata: {
        value: gt("Very little"),
        note: gt("No account data. Onion routing hides your IP address from storage nodes; entry nodes see it but say they don't record it. The faster push notification mode shares your Account ID and a push token with the foundation and with Apple or Google."),
        src: ["privacy", "faq"],
      },
      dataUse: {
        status: "yes",
        value: gt("No trackers, no selling"),
        note: gt("The App Store privacy label says ‘Data Not Collected’."),
        src: ["privacy", "appstore"],
      },
      phone: {
        status: "no",
        value: gt("Not required"),
        note: gt("You get a random Account ID and a recovery phrase."),
        src: ["home"],
      },
      email: {
        status: "no",
        value: gt("Not required"),
        src: ["home"],
      },
      ageChecks: {
        status: "no",
        value: gt("No ID or face scans"),
        note: gt("We couldn't find a minimum age in Session's privacy policy; the App Store rates the app 18+."),
        src: ["privacy", "appstore"],
      },
      servers: {
        status: "no",
        note: gt("No Discord-style servers. Communities are single public rooms on community servers that anyone can host."),
        src: ["faq"],
      },
      roles: {
        status: "partial",
        value: gt("Admins and moderators only"),
        note: gt("Groups have admins; communities have moderators and admins. No custom roles or permissions."),
        src: ["faq"],
      },
      threadsForums: { status: "no" },
      onboarding: {
        status: "no",
        note: gt("No rules screening or onboarding for groups or communities."),
      },
      modTools: {
        status: "partial",
        value: gt("Basic"),
        note: gt("Group admins can remove members; community moderators can delete messages and ban people."),
        src: ["faq"],
      },
      platformSafety: {
        status: "partial",
        note: gt("The foundation publishes transparency reports: 17 legal requests in 2025, with no data provided because it held none."),
        src: ["transparency", "transparency-2025"],
      },
      voiceChannels: { status: "no" },
      videoScreen: {
        status: "partial",
        value: gt("1:1 video, beta"),
        note: gt("One-to-one video calls in beta. We couldn't verify screen sharing."),
        src: ["faq"],
      },
      streamingStage: { status: "no" },
      botApi: {
        status: "partial",
        value: gt("Limited"),
        note: gt("Bots can be built against the community server API; we found no general bot platform."),
      },
      discordBots: { status: "no" },
      discordMigration: { status: "no", note: gt("No Discord bridge or importer.") },
      desktop: {
        status: "yes",
        note: gt("Windows, macOS and Linux."),
        src: ["github-desktop"],
      },
      mobile: {
        status: "yes",
        note: gt("Android (Google Play, F-Droid or direct download) and iPhone. The App Store rating is 4.4 from about 5,200 ratings."),
        src: ["github-android", "appstore"],
      },
      web: {
        status: "no",
        note: gt("There is no browser version."),
      },
      license: {
        status: "yes",
        value: gt("GPL-3.0"),
        note: gt("The apps are open source; some libraries use BSD or MIT licenses."),
        src: ["github-desktop", "wikipedia"],
      },
      selfHost: {
        status: "partial",
        note: gt("You can host your own community server. Running a network node requires staking SESH tokens, and private chats and groups always go through the Session network."),
        src: ["faq", "tokenomics"],
      },
      federation: {
        status: "no",
        note: gt("One decentralized network of about 1,500 staked nodes that keeps messages for up to 14 days. Community servers are separate and don't federate."),
        src: ["faq", "tokenomics"],
      },
      uploads: {
        value: gt("10 MB per file"),
        src: ["faq"],
      },
      groupSize: {
        value: gt("Groups: 100 members"),
        note: gt("Larger groups were planned as part of Session Pro, which is paused."),
        src: ["faq", "pro-beta"],
      },
      scale: {
        status: "unknown",
        value: gt("‘Millions’ (self-reported)"),
        note: gt("Session says it has millions of users but gives no figure."),
        src: ["future"],
      },
      incidents: {
        value: gt("Near shutdown in 2026"),
        note: gt("In March 2026 a cofounder said the foundation couldn't fund Session any further; money was found in June, but the team shrank to 2 to 3 developers, and Session Pro was paused in October 2026."),
        src: ["appeal", "future", "pro-paused"],
      },
    },
    whyUs: [
      {
        title: gt("Built for communities, not just chats"),
        text: gt("SerikaCord has servers with text, voice, forum and ticket channels, Discord-style roles with per-channel permissions, threads and onboarding. Session has groups of up to 100 people and single-room communities with admins and moderators."),
        src: ["faq"],
      },
      {
        title: gt("Voice channels and group calls"),
        text: gt("On SerikaCord you can drop into a voice channel and share your screen at up to 60 FPS. Session has only one-to-one calls, still in beta. Both apps' calls are peer-to-peer where possible, so others can see your IP address, and our server voice channels are not end-to-end encrypted."),
        src: ["faq"],
      },
      {
        title: gt("Moderation that scales past a group chat"),
        text: gt("SerikaCord gives moderators AutoMod, an audit log, timeouts, rules screening and verification levels. Session's group admins can remove members and community moderators can delete messages and ban, which is enough for small groups but not for a large public community."),
        src: ["faq"],
      },
      {
        title: gt("Bots, a web app and a path from Discord"),
        text: gt("SerikaCord's bot API follows Discord's API v10, it works fully in a browser, and a consent-based bridge mirrors a Discord server. Session has no general bot platform, no web version and no Discord bridge."),
      },
      {
        title: gt("No crypto token involved"),
        text: gt("SerikaCord is funded by an optional subscription. Session's network is run by people who stake the SESH crypto token, and its finances were in trouble in 2026; we are small too, but our service doesn't depend on a token economy."),
        src: ["tokenomics", "appeal"],
      },
    ],
    whyThem: [
      {
        title: gt("No phone number or email"),
        text: gt("Session gives you a random Account ID and a recovery phrase, nothing more. SerikaCord needs an email address."),
        src: ["home"],
      },
      {
        title: gt("Onion routing hides your IP address"),
        text: gt("Session sends messages through several network nodes so the ones storing your messages don't see your IP address. SerikaCord has no onion routing and can see metadata such as who talks to whom and when."),
        src: ["privacy", "faq"],
      },
      {
        title: gt("Encryption by default everywhere except communities"),
        text: gt("Every Session chat and group of up to 100 people is end-to-end encrypted, and it was audited by Quarkslab in 2021. SerikaCord's encrypted group DMs stop at 10 people, and our encryption hasn't been audited."),
        src: ["faq"],
      },
      {
        title: gt("Open source and decentralized"),
        text: gt("Session's apps are GPL-3.0 and its network runs on about 1,500 community-run nodes rather than one company's servers. SerikaCord is source-available, not open source, and runs as one central service."),
        src: ["github-desktop", "tokenomics"],
      },
      {
        title: gt("Native apps everywhere, including iPhone"),
        text: gt("Session has apps for Android, iPhone, Windows, macOS and Linux, and a 4.4 rating from about 5,200 App Store reviews. SerikaCord has no iPhone app yet."),
        src: ["appstore"],
      },
      {
        title: gt("It has shown it holds no data"),
        text: gt("The foundation's 2025 transparency report lists 17 legal requests and no data provided. SerikaCord hasn't published a transparency report yet."),
        src: ["transparency-2025"],
      },
    ],
    pickThem: [
      gt("you want to message people without giving a phone number or email"),
      gt("hiding your IP address from the service matters to you"),
      gt("you only need one-to-one chats and small groups"),
      gt("you need an iPhone app today"),
    ],
    pickUs: [
      gt("you want to run a community with channels, roles and moderation"),
      gt("you want voice channels and group calls"),
      gt("you rely on bots or are moving a Discord server"),
      gt("you want to chat from a browser"),
    ],
    faq: [
      {
        question: gt("Is Session end-to-end encrypted?"),
        answer: gt("Yes, chats and groups are always end-to-end encrypted. The current protocol has no forward secrecy, so a stolen long-term key could expose past messages; a new protocol that adds it was still not live in October 2026. Communities are not end-to-end encrypted."),
      },
      {
        question: gt("Does Session need a phone number?"),
        answer: gt("No. Session gives you a random Account ID and a recovery phrase, with no phone number or email. SerikaCord needs an email address."),
      },
      {
        question: gt("Is Session still being developed?"),
        answer: gt("Yes, but with far fewer people. Development paused in early 2026 for lack of money and resumed in June 2026 with 2 to 3 developers, and the Session Pro subscription was paused in October 2026. The apps were still being updated in mid-October 2026."),
      },
      {
        question: gt("Is Session safe?"),
        answer: gt("It protects your identity and IP address well, and the foundation reports handing over no data. Its encryption lacks forward secrecy and has been publicly criticized by the cryptographer Soatok, and its only published audit is from 2021."),
      },
      {
        question: gt("What does Session have to do with cryptocurrency?"),
        answer: gt("Session's network nodes are run by people who stake the SESH token and are paid in it, and the planned Session Pro would fund node rewards through the token. You don't need to own any crypto to use the app."),
      },
      {
        question: gt("Can I run a Discord-style community on Session?"),
        answer: gt("Not really. Session has groups of up to 100 people and single-room public communities, but no channels, custom roles, voice channels or bots."),
      },
      {
        question: gt("Who runs Session?"),
        answer: gt("The Session Technology Foundation, a Swiss nonprofit, which took over from an Australian foundation in October 2024."),
      },
    ],
    couldNotVerify: [
      gt("How many people use Session: it says ‘millions’ but gives no figure."),
      gt("The price of Session Pro, which was never published."),
      gt("How much the 2026 donation campaign raised."),
      gt("Which countries block Session."),
      gt("Whether calls support screen sharing."),
    ],
    notes: {
      title: gt("Forward secrecy, protocol v2 and the SESH token"),
      intro: gt("Two things about Session are easy to miss and matter for how much you trust it."),
      points: [
        gt("Forward secrecy means that if your key is stolen later, old messages stay safe. Session removed it when it forked Signal; its protocol v2, announced in December 2025 with forward secrecy and post-quantum protection, was partly built but not live in the main apps on 13 October 2026."),
        gt("In January 2025 the cryptographer Soatok published ‘Don't Use Session’, criticizing its key generation, the missing forward secrecy and how it checks signatures; Session posted a rebuttal."),
        gt("Session's network depends on the SESH crypto token: node operators stake it and are paid in it, and an August 2026 proposal would turn part of Session Pro revenue into SESH node rewards."),
      ],
      src: ["v2", "v2-update", "soatok", "tokenomics"],
    },
  };
}

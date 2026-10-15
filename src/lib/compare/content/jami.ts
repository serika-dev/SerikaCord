import { getGT } from "gt-next/server";
import type { AppContent, CompareSource } from "../types";

/**
 * SerikaCord vs Jami. Facts checked on COMPARE_LAST_CHECKED_ISO against the
 * sources below (titles and publishers are proper names, not translated).
 */

export const sources: CompareSource[] = [
  { id: "home", title: "Jami homepage", url: "https://jami.net/", publisher: "Jami", kind: "primary" },
  { id: "web-preview", title: "Jami Web: First Preview", url: "https://jami.net/jami-web-preview-1/", publisher: "Jami", kind: "primary", date: "2026-09-01" },
  { id: "openclaw", title: "Feature Drop: OpenClaw Plugin", url: "https://jami.net/jami-openclaw/", publisher: "Jami", kind: "primary", date: "2026-07-22" },
  { id: "euclid", title: "Meet the Latest Version of Jami: Euclid", url: "https://jami.net/euclid/", publisher: "Jami", kind: "primary", date: "2026-04-01" },
  { id: "dev15", title: "Jami dev update #15", url: "https://jami.net/dev-update-15/", publisher: "Jami", kind: "primary", date: "2025-12-15" },
  { id: "manifesto", title: "Jami Manifesto 2025", url: "https://jami.net/manifesto-2025/", publisher: "Jami", kind: "primary", date: "2025-10-07" },
  {
    id: "atlas",
    title: "Atlas: Jami's biggest step toward reliable communication",
    url: "https://jami.net/atlas-jamis-biggest-step-toward-reliable-communication/",
    publisher: "Jami",
    kind: "primary",
    date: "2025-09-24",
  },
  { id: "proxy", title: "How does Jami work on mobile without a server?", url: "https://jami.net/jami-and-proxys/", publisher: "Jami", kind: "primary" },
  { id: "privacy", title: "Jami Privacy Policy", url: "https://jami.net/privacy-policy/", publisher: "Jami", kind: "primary" },
  { id: "faq", title: "Jami FAQ", url: "https://docs.jami.net/en_US/user/faq.html", publisher: "Jami", kind: "primary" },
  { id: "intro", title: "Jami user documentation: introduction", url: "https://docs.jami.net/en_US/user/introduction.html", publisher: "Jami", kind: "primary" },
  { id: "swarm", title: "Jami swarm design", url: "https://docs.jami.net/en_US/developer/jami-concepts/swarm.html", publisher: "Jami", kind: "primary" },
  { id: "appstore", title: "Jami on the App Store", url: "https://apps.apple.com/us/app/jami/id1306951055", publisher: "Apple", kind: "primary" },
  { id: "client-qt", title: "Jami desktop client source code (stable/20261014.0)", url: "https://github.com/savoirfairelinux/jami-client-qt", publisher: "GitHub", kind: "primary", date: "2026-10-14" },
  { id: "daemon", title: "Jami daemon source code (GPL-3.0)", url: "https://github.com/savoirfairelinux/jami-daemon", publisher: "GitHub", kind: "primary" },
  { id: "android", title: "Jami Android client source code", url: "https://github.com/savoirfairelinux/jami-client-android", publisher: "GitHub", kind: "primary" },
  { id: "sfl", title: "Savoir-faire Linux on GitHub", url: "https://api.github.com/orgs/savoirfairelinux", publisher: "GitHub", kind: "primary" },
  { id: "wikipedia", title: "Jami (software)", url: "https://en.wikipedia.org/wiki/Jami_(software)", publisher: "Wikipedia", kind: "secondary" },
];

export async function content(): Promise<AppContent> {
  const gt = await getGT();
  return {
    take: gt("A free, peer-to-peer GNU messenger with encrypted chats, group video calls and screen sharing, and no phone, email or central server. But reliability has long been a problem, and it has no community features."),
    intro: [
      gt("Jami is a free-software messenger and calling app, part of the GNU Project and developed by the Canadian company Savoir-faire Linux. Your devices talk to each other directly (peer-to-peer) instead of through a company server, chats and calls are end-to-end encrypted by default, and an account is just a key pair on your device, with no phone number or email."),
      gt("SerikaCord is a Discord-style community app with servers, channels, roles, voice channels, moderation and bots, and its end-to-end encryption, launched in October 2026, covers only DMs and group DMs and hasn't been audited. Jami is better if you want private, serverless calls and chats; SerikaCord is better for running a community and for using it from a browser or after losing a phone."),
    ],
    verdict: gt("If you want free software that keeps your chats and calls on your own devices, with no company server in the middle, try Jami. If you want a community with channels, voice rooms, moderation and bots, pick SerikaCord."),
    facts: {
      operator: {
        value: gt("Savoir-faire Linux (GNU project)"),
        note: gt("Savoir-faire Linux develops Jami as a GNU package and runs its default network helpers. It started in 2004 as SFLphone and was renamed Ring in 2015 and Jami in 2018."),
        src: ["wikipedia", "manifesto", "proxy"],
      },
      jurisdiction: {
        value: gt("Canada"),
        note: gt("Savoir-faire Linux is a Canadian company. There is no central message server: messages live on your own devices."),
        src: ["sfl", "privacy"],
      },
      businessModel: {
        value: gt("Donations and sponsorship"),
        note: gt("Funded by donations and Savoir-faire Linux, with no ads or shareholders. Its first donation campaign raised CAD $403,162 by March 2024; a second aims for $1,000,000. About 5 developers work on it."),
        src: ["manifesto"],
      },
      ads: {
        status: "no",
        value: gt("No ads"),
        src: ["manifesto"],
      },
      pricing: {
        value: gt("Free"),
        note: gt("Everything is free, with no paid plan."),
        src: ["home"],
      },
      maturity: {
        status: "partial",
        value: gt("Since 2004; reliability issues"),
        note: gt("A long history, but Jami's own September 2025 ‘Atlas’ release listed long-running problems with message delivery, history order and frozen group calls that took 18 months to fix."),
        src: ["atlas", "wikipedia"],
      },
      e2eeDms: {
        status: "yes",
        value: gt("Always"),
        note: gt("Devices connect over TLS with forward secrecy, and conversations sync between devices as encrypted ‘swarms’."),
        src: ["swarm", "faq"],
      },
      e2eeGroups: {
        status: "yes",
        value: gt("Always"),
        note: gt("Group chats are swarms shared directly between members' devices."),
        src: ["swarm"],
      },
      e2eeCalls: {
        status: "yes",
        value: gt("All calls"),
        note: gt("One-to-one and group calls are encrypted. Group calls are hosted on one participant's device rather than a server."),
        src: ["faq", "intro"],
      },
      e2eeCommunity: {
        value: gt("Not applicable"),
        note: gt("Jami has no public community channels."),
        src: ["intro"],
      },
      e2eeDefault: {
        status: "yes",
        value: gt("Always on"),
        src: ["faq"],
      },
      audit: {
        status: "unknown",
        note: gt("We couldn't find a public independent security audit of Jami."),
      },
      metadata: {
        value: gt("Little, but not nothing"),
        note: gt("No account data is stored on servers. On phones, Savoir-faire's network proxy can see when your device is online and how it connects, and push notifications go through Google or Apple unless you use UnifiedPush. An optional username is stored permanently on a public registry."),
        src: ["proxy", "privacy"],
      },
      dataUse: {
        status: "yes",
        value: gt("No trackers, no selling"),
        note: gt("The app claims no trackers; the website uses Matomo for aggregate statistics."),
        src: ["privacy"],
      },
      phone: {
        status: "no",
        value: gt("Not required"),
        note: gt("An account is a key pair created on your device."),
        src: ["intro"],
      },
      email: {
        status: "no",
        value: gt("Not required"),
        src: ["intro"],
      },
      ageChecks: {
        status: "no",
        value: gt("No ID or face scans"),
        note: gt("We couldn't find a minimum age in Jami's privacy policy; the App Store rates it 4+."),
        src: ["privacy", "appstore"],
      },
      servers: {
        status: "no",
        note: gt("No servers or channels; only one-to-one and group conversations."),
        src: ["intro"],
      },
      roles: {
        status: "partial",
        value: gt("Admins and members"),
        note: gt("Group admins can invite, block and ban; a ban needs more than half of the admins to agree. No custom roles."),
        src: ["swarm", "euclid"],
      },
      threadsForums: { status: "no" },
      onboarding: {
        status: "no",
        note: gt("No rules screening or onboarding; groups can be set so only admins invite."),
        src: ["swarm"],
      },
      modTools: {
        status: "partial",
        value: gt("Very basic"),
        note: gt("Admin-only invites and block or ban by admin vote. Nothing else."),
        src: ["swarm"],
      },
      platformSafety: {
        status: "no",
        note: gt("There is no central service to moderate content, and we found no transparency report."),
        src: ["privacy"],
      },
      voiceChannels: {
        status: "partial",
        note: gt("No voice channels, but group chats have a ‘Join call’ button, and a ‘rendezvous point’ account can host an always-open conference on someone's device."),
        src: ["intro", "faq"],
      },
      videoScreen: {
        status: "yes",
        note: gt("Group video conferences and screen sharing. Quality depends on the bandwidth of the device hosting the call."),
        src: ["home", "faq"],
      },
      streamingStage: {
        status: "partial",
        note: gt("You can stream a media file into a call; there are no Stage-style events."),
        src: ["home"],
      },
      botApi: {
        status: "yes",
        note: gt("Bot accounts with API tokens and a local API server, plus plugins, such as an OpenClaw AI agent plugin added in July 2026."),
        src: ["openclaw", "dev15"],
      },
      discordBots: { status: "no" },
      discordMigration: { status: "no", note: gt("No Discord bridge or importer.") },
      desktop: {
        status: "yes",
        note: gt("Windows, macOS and Linux, Jami's main platform."),
        src: ["client-qt"],
      },
      mobile: {
        status: "yes",
        note: gt("Android (Google Play and F-Droid, including Android TV) and iPhone. The iPhone app is rated 3.7 from 91 US ratings."),
        src: ["android", "appstore"],
      },
      web: {
        status: "partial",
        value: gt("Early preview"),
        note: gt("Jami Web had its first preview in September 2026. You have to host it yourself on a Node.js server."),
        src: ["web-preview"],
      },
      license: {
        status: "yes",
        value: gt("GPL-3.0"),
        note: gt("Free software and an official GNU package."),
        src: ["daemon", "manifesto"],
      },
      selfHost: {
        status: "yes",
        value: gt("No server needed"),
        note: gt("It works without servers, even on a local network with no internet. You can run your own network helpers and an account management server for organizations."),
        src: ["intro", "proxy"],
      },
      federation: {
        status: "partial",
        value: gt("Peer-to-peer instead"),
        note: gt("There are no servers to federate: devices find each other through a distributed network. Jami can also call regular SIP phone providers."),
        src: ["intro"],
      },
      uploads: {
        value: gt("No stated limit"),
        note: gt("Files go directly between devices, so both need to be online."),
        src: ["home"],
      },
      groupSize: {
        status: "unknown",
        note: gt("We couldn't find hard limits for group chats or group calls."),
      },
      scale: {
        status: "partial",
        value: gt("250,000+ users (self-reported)"),
        note: gt("Jami said in October 2025 that it has more than 250,000 users in 176 countries and about 3,000 new users a day."),
        src: ["manifesto"],
      },
      incidents: {
        value: gt("Reliability problems"),
        note: gt("Jami's September 2025 Atlas release acknowledged long-running message delivery, sync and call bugs. We found no reported breaches, but we didn't search for specific security flaws."),
        src: ["atlas"],
      },
    },
    whyUs: [
      {
        title: gt("Built for communities, not just chats"),
        text: gt("SerikaCord has servers with text, voice, forum and ticket channels, Discord-style roles with per-channel permissions, threads and onboarding. Jami has group chats where people are either admins or members."),
        src: ["swarm"],
      },
      {
        title: gt("Moderation and a safety team"),
        text: gt("SerikaCord gives moderators AutoMod, an audit log, timeouts and rules screening, and has a staff Trust & Safety team. Jami admins can only limit invites and ban by vote, and there is no central team to report abuse to."),
        src: ["swarm"],
      },
      {
        title: gt("Your account survives a lost phone, and it works in a browser"),
        text: gt("SerikaCord accounts live on our servers, so you can sign in anywhere, including the browser, and restore encrypted DMs with a PIN or passphrase. If you lose every Jami device and its backup archive, the account is gone, and Jami Web is an early preview you must host yourself."),
        src: ["faq", "web-preview"],
      },
      {
        title: gt("Calls that don't depend on one person's connection"),
        text: gt("Jami group calls run on one participant's device, so quality depends on that person's bandwidth. SerikaCord calls also connect peer-to-peer where possible, which shows your IP address to others and gets heavy in large calls, so our edge here is modest."),
        src: ["faq"],
      },
      {
        title: gt("Bots and a path from Discord"),
        text: gt("SerikaCord's bot API follows Discord's API v10, so many discord.js and discord.py bots run after changing one address, and a consent-based bridge mirrors a Discord server. Jami has its own bot accounts and plugins but nothing Discord-compatible."),
        src: ["openclaw"],
      },
    ],
    whyThem: [
      {
        title: gt("No central server at all"),
        text: gt("Jami devices talk to each other directly, and it even works on a local network without internet. SerikaCord is one central service that stores your messages and can see who talks to whom."),
        src: ["intro"],
      },
      {
        title: gt("Everything encrypted by default"),
        text: gt("Every Jami chat, group and call, including group video calls, is end-to-end encrypted. SerikaCord encrypts only DMs, group DMs of up to 10 people and their calls; server channels and voice channels are not end-to-end encrypted."),
        src: ["faq", "swarm"],
      },
      {
        title: gt("No phone number or email"),
        text: gt("A Jami account is a key pair created on your device. SerikaCord needs an email address."),
        src: ["intro"],
      },
      {
        title: gt("Free software, free of charge"),
        text: gt("Jami is a GPL-3.0 GNU package, funded by donations, with no paid tier. SerikaCord is source-available, not open source, and has an optional paid subscription."),
        src: ["daemon", "manifesto"],
      },
      {
        title: gt("Native apps everywhere, including iPhone"),
        text: gt("Jami has native apps for iPhone and Android, including F-Droid and Android TV, and the App Store rates it 4+. SerikaCord has no iPhone app yet and is 16 and over."),
        src: ["appstore", "android"],
      },
    ],
    pickThem: [
      gt("you want calls and chats that go directly between devices, with no company server"),
      gt("you want free software from the GNU Project"),
      gt("you need to talk on a local network without internet"),
      gt("you need an iPhone app today"),
    ],
    pickUs: [
      gt("you want to run a community with channels, roles and moderation"),
      gt("you want to send files without both people being online"),
      gt("you want to sign in from a browser or recover your account easily"),
      gt("you rely on bots or are moving a Discord server"),
    ],
    faq: [
      {
        question: gt("Is Jami end-to-end encrypted?"),
        answer: gt("Yes. Chats, group chats and calls are end-to-end encrypted by default, and messages go directly between devices. We couldn't find an independent security audit."),
      },
      {
        question: gt("Does Jami need a server?"),
        answer: gt("No central server stores your messages. By default, phones use a network proxy run by Savoir-faire Linux plus Google's or Apple's push service, and you can run your own proxy instead."),
      },
      {
        question: gt("Is Jami reliable?"),
        answer: gt("Reliability has been the main complaint for years. Jami's September 2025 Atlas release fixed long-running problems with message delivery, sync and group calls; how well it works now depends on your devices and network."),
      },
      {
        question: gt("Is Jami open source?"),
        answer: gt("Yes. Jami is free software under the GPL-3.0 and an official GNU package. It is free to use with no paid tier."),
      },
      {
        question: gt("What happens if I lose my phone on Jami?"),
        answer: gt("If you have another linked device or a backup of your account archive, you can recover. If not, the account can't be recovered, because no server holds it."),
      },
      {
        question: gt("Can I run a Discord-style community on Jami?"),
        answer: gt("No. Jami has group chats with admins and members and group calls, but no servers, channels, custom roles or moderation tools."),
      },
      {
        question: gt("Who makes Jami?"),
        answer: gt("Savoir-faire Linux, a Canadian company, develops it as part of the GNU Project, funded by donations and the company itself."),
      },
    ],
    couldNotVerify: [
      gt("Any independent security audit of Jami."),
      gt("Hard limits on group chat and group call size."),
      gt("Specific security flaws or breaches; we didn't sample press coverage."),
      gt("Google Play install numbers and its data safety label."),
      gt("How much Jami's second donation campaign has raised."),
    ],
    notes: {
      title: gt("How a peer-to-peer messenger behaves differently"),
      intro: gt("Jami's design removes the central server, which changes some things people take for granted."),
      points: [
        gt("There is no password reset: if you lose every device and your account backup, the account is gone."),
        gt("A username is optional, but once registered on Jami's public name registry it can't be removed or changed."),
        gt("Group calls are hosted on one participant's device, so their bandwidth limits the call."),
        gt("On phones, Jami uses a network proxy run by Savoir-faire Linux by default, which can see when your device is online."),
      ],
      src: ["faq", "privacy", "proxy"],
    },
  };
}

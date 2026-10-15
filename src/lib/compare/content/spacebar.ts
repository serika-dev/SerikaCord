import { getGT } from "gt-next/server";
import type { AppContent, CompareSource } from "../types";

/**
 * SerikaCord vs Spacebar (formerly Fosscord). Facts checked on
 * COMPARE_LAST_CHECKED_ISO against the sources below (titles and publishers
 * are proper names, not translated).
 */

export const sources: CompareSource[] = [
  { id: "home", title: "Spacebar homepage", url: "https://spacebar.chat", publisher: "Spacebar", kind: "primary" },
  { id: "docs", title: "Spacebar documentation", url: "https://docs.spacebar.chat/", publisher: "Spacebar", kind: "primary" },
  { id: "faq", title: "Spacebar FAQ", url: "https://docs.spacebar.chat/faq/", publisher: "Spacebar", kind: "primary" },
  { id: "clients", title: "Spacebar clients", url: "https://docs.spacebar.chat/setup/clients/", publisher: "Spacebar", kind: "primary" },
  { id: "server", title: "spacebarchat/server repository", url: "https://github.com/spacebarchat/server", publisher: "GitHub", kind: "primary" },
  { id: "advisories", title: "Spacebar server security advisories", url: "https://github.com/spacebarchat/server/security/advisories", publisher: "GitHub", kind: "primary", date: "2026-08-04" },
  { id: "meta", title: "Spacebar project overview", url: "https://github.com/spacebarchat/spacebarchat", publisher: "GitHub", kind: "primary" },
  { id: "client", title: "Spacebar official client repository", url: "https://github.com/spacebarchat/client", publisher: "GitHub", kind: "primary" },
  { id: "opencollective", title: "Spacebar on Open Collective", url: "https://opencollective.com/spacebar", publisher: "Open Collective", kind: "primary" },
  { id: "fermi", title: "Fermi: A Harmony Client", url: "https://fermi.chat", publisher: "Fermi", kind: "secondary" },
  { id: "fermo", title: "Fermo: A Spacebar Client", url: "https://fermo.sovr.top", publisher: "Fermo", kind: "secondary" },
  { id: "harmony", title: "Harmony chat server", url: "https://codeberg.org/MelodyChat/Harmony", publisher: "Codeberg", kind: "secondary", date: "2026-04-11" },
];

export async function content(): Promise<AppContent> {
  const gt = await getGT();
  return {
    take: gt("Free, open-source server software that recreates Discord's own API so you can run a Discord-like service yourself; great for developers, but still in development, with experimental voice and no official mobile apps."),
    intro: [
      gt("Spacebar, formerly Fosscord, is not a chat service you sign up for but open-source software that reimplements Discord's API, gateway and file server so anyone can host their own Discord-like instance. It is built by volunteers, funded by small donations and has been in development since 2020."),
      gt("That makes it a different kind of project from SerikaCord. Spacebar is the closer match to Discord's bot API and the freer choice for self-hosting; SerikaCord is a finished, hosted app with working voice and video, encrypted DMs, apps for desktop and Android, and a safety team."),
    ],
    verdict: gt("Developers who want a Discord-compatible backend to host, test bots on or tinker with should look at Spacebar. Communities that want a ready-to-use app with reliable voice and video should pick SerikaCord."),
    facts: {
      operator: {
        value: gt("Volunteer community"),
        note: gt("An open-source project run by volunteers in the spacebarchat GitHub organization and funded through Open Collective. No company is behind it."),
        src: ["server", "opencollective"],
      },
      jurisdiction: {
        value: gt("None; depends on the instance"),
        note: gt("There is no central operator. Each instance is governed by whoever hosts it and wherever it is hosted."),
        src: ["faq"],
      },
      businessModel: {
        value: gt("Donations"),
        note: gt("About €277 a year in income from 46 backers on Open Collective, as of October 2026."),
        src: ["opencollective"],
      },
      ads: {
        status: "no",
        value: gt("No ads"),
        src: ["home"],
      },
      pricing: {
        value: gt("Free software"),
        note: gt("No paid tiers; instance admins can give everyone premium features. Costs on a hosted instance depend on its operator."),
        src: ["faq"],
      },
      maturity: {
        status: "partial",
        value: gt("In development"),
        note: gt("Server work since November 2020, with no tagged releases. The FAQ calls Discord API compatibility reasonable but not perfect, and the official client is described as not ready for production use."),
        src: ["faq", "server", "client"],
      },
      e2eeDms: {
        status: "no",
        note: gt("Messages are readable by whoever runs the instance, as on Discord."),
        src: ["faq"],
      },
      e2eeGroups: {
        status: "no",
        src: ["faq"],
      },
      e2eeCalls: {
        status: "no",
        note: gt("Not end-to-end encrypted, and voice itself is still experimental."),
        src: ["faq"],
      },
      e2eeCommunity: {
        status: "no",
        src: ["faq"],
      },
      e2eeDefault: {
        status: "no",
        value: gt("Not available"),
      },
      audit: {
        status: "no",
        value: gt("No audit found"),
        note: gt("The project's GitHub overview calls it publicly audited, but we found no audit report."),
        src: ["meta"],
      },
      metadata: {
        value: gt("The instance operator sees all"),
        note: gt("Whoever runs your instance can read your messages and metadata. The project itself collects nothing centrally."),
        src: ["faq"],
      },
      dataUse: {
        status: "yes",
        value: gt("No central collection"),
        note: gt("The project has no central operator, ads or trackers; what happens to your data depends on the instance you use."),
        src: ["faq", "home"],
      },
      phone: {
        value: gt("Set by each instance"),
        note: gt("The software doesn't need a phone number; instance admins choose sign-up requirements."),
        src: ["docs"],
      },
      email: {
        value: gt("Set by each instance"),
        src: ["docs"],
      },
      ageChecks: {
        status: "no",
        value: gt("None built in"),
        note: gt("Any minimum age or age check is set by each instance."),
        src: ["docs"],
      },
      servers: {
        status: "yes",
        note: gt("Discord-style servers (guilds) and channels."),
        src: ["faq"],
      },
      roles: {
        status: "yes",
        note: gt("Discord-style roles and permissions."),
        src: ["faq"],
      },
      threadsForums: {
        status: "no",
        note: gt("The FAQ lists threads as not yet implemented; we couldn't verify forum channels."),
        src: ["faq"],
      },
      onboarding: {
        status: "unknown",
        note: gt("We couldn't verify onboarding or rules screening."),
      },
      modTools: {
        status: "partial",
        note: gt("Discord-style permissions and bans plus an admin API. AutoMod isn't implemented."),
        src: ["faq"],
      },
      platformSafety: {
        status: "no",
        value: gt("Up to each instance"),
        note: gt("There is no central safety team or reporting; moderation is up to whoever runs the instance."),
        src: ["faq"],
      },
      voiceChannels: {
        status: "partial",
        value: gt("Experimental"),
        note: gt("Voice uses WebRTC only, without the UDP connection many Discord clients expect."),
        src: ["faq"],
      },
      videoScreen: {
        status: "partial",
        value: gt("Experimental"),
        note: gt("Video is experimental, and we couldn't verify the state of screen sharing."),
        src: ["faq"],
      },
      streamingStage: {
        status: "no",
        note: gt("We found no streaming or Stage-style channels."),
        src: ["faq"],
      },
      botApi: {
        status: "yes",
        note: gt("Bots use the same API as on Discord. OAuth2 scopes aren't enforced yet."),
        src: ["faq"],
      },
      discordBots: {
        status: "yes",
        value: gt("Reimplements Discord's API"),
        note: gt("Spacebar's goal is to reimplement Discord's HTTP API and gateway, so many bots and libraries work when pointed at an instance. The FAQ calls compatibility reasonable but not perfect."),
        src: ["faq", "server"],
      },
      discordMigration: {
        status: "no",
        note: gt("Spacebar can't talk to discord.com users, and there is no importer."),
        src: ["faq"],
      },
      desktop: {
        status: "partial",
        note: gt("No maintained official app: the official client's last release was in February 2024. People use community clients instead."),
        src: ["client", "clients"],
      },
      mobile: {
        status: "no",
        note: gt("No official Android or iPhone apps."),
        src: ["clients"],
      },
      web: {
        status: "partial",
        note: gt("Through community web clients; the docs recommend Fermo."),
        src: ["clients", "fermo"],
      },
      license: {
        status: "yes",
        value: gt("AGPL-3.0 (open source)"),
        src: ["server"],
      },
      selfHost: {
        status: "yes",
        value: gt("Its main purpose"),
        note: gt("You run the server, file server and voice server yourself. Setup is documented with Node.js and a Nix flake; the separate Docker repository is archived."),
        src: ["docs", "server"],
      },
      federation: {
        status: "no",
        note: gt("Instances don't federate with each other, though some clients can connect to several instances at once."),
        src: ["faq"],
      },
      uploads: {
        value: gt("Set by each instance"),
        src: ["docs"],
      },
      groupSize: {
        status: "unknown",
        note: gt("Limits depend on each instance; we didn't verify the defaults."),
      },
      scale: {
        status: "unknown",
        value: gt("Not published"),
        note: gt("No user or instance counts are published. The server repository has about 2,200 GitHub stars and around 1,600 commits in the past year."),
        src: ["server"],
      },
      incidents: {
        value: gt("Security advisories in 2026"),
        note: gt("In August 2026 three server advisories were published, two rated high: any logged-in user could join and read any group DM by its ID, and messages could be deleted across channels. In April 2026 a near-identical fork called Harmony appeared, and the Fermi client moved to it."),
        src: ["advisories", "harmony", "fermi"],
      },
    },
    whyUs: [
      {
        title: gt("Ready to use today"),
        text: gt("SerikaCord is a hosted app you can sign up for now, with web, desktop and Android apps. Spacebar is server software still in development: you need an instance and a community client, and the official client hasn't had a release since February 2024."),
        src: ["client", "faq"],
      },
      {
        title: gt("Voice, video and screen sharing that work"),
        text: gt("SerikaCord has voice channels, video and screen sharing up to source resolution at 60 FPS. Spacebar's voice and video are experimental, and many Discord clients can't connect to its voice at all."),
        src: ["faq"],
      },
      {
        title: gt("Encrypted private messages"),
        text: gt("SerikaCord's DMs, group DMs and their calls are end-to-end encrypted by default for new conversations. Spacebar has no end-to-end encryption, so the instance operator can read everything. Our encryption is new and not yet audited."),
        src: ["faq"],
      },
      {
        title: gt("Moderation and a safety team"),
        text: gt("SerikaCord has AutoMod, onboarding, rules screening, threads and forums, plus a staff Trust & Safety team. On Spacebar, AutoMod and threads aren't implemented, and safety depends entirely on whoever runs your instance."),
        src: ["faq"],
      },
      {
        title: gt("A bridge to your Discord server"),
        text: gt("SerikaCord's consent-based bridge mirrors messages between a Discord server and a SerikaCord server, so you can move gradually. Spacebar can't talk to discord.com users at all."),
        src: ["faq"],
      },
    ],
    whyThem: [
      {
        title: gt("Closer to Discord's API"),
        text: gt("Spacebar reimplements Discord's own API, gateway and file server, and aims to work with Discord-compatible clients as well as bots. For running Discord bots unchanged it is arguably closer than SerikaCord, whose API follows v10 but doesn't cover everything."),
        src: ["faq", "server"],
      },
      {
        title: gt("Open source and self-hosting for any purpose"),
        text: gt("Spacebar is AGPL-3.0 and self-hosting is its whole point. SerikaCord is source-available: self-hosting is allowed only for personal, non-commercial use, with no official setup guide."),
        src: ["server", "docs"],
      },
      {
        title: gt("No company in the middle"),
        text: gt("If you run your own Spacebar instance, your data stays on your own server and nobody else's terms apply. SerikaCord is a central service run by one company, and we can see metadata and server channels."),
        src: ["faq"],
      },
      {
        title: gt("Every feature is free"),
        text: gt("Spacebar has no paid tier, and instance admins can give every user premium features. SerikaCord is free too, but bigger uploads and some cosmetics need Serika+."),
        src: ["faq"],
      },
      {
        title: gt("Useful for testing Discord bots"),
        text: gt("Because it speaks Discord's API, developers can use a private Spacebar instance to test bots or preserve communities without touching discord.com."),
        src: ["faq"],
      },
    ],
    pickThem: [
      gt("you are a developer who wants a Discord-compatible backend to host yourself"),
      gt("you want to test Discord bots on a private server"),
      gt("you want open-source software with no company or central service involved"),
    ],
    pickUs: [
      gt("you want an app your friends can sign up for and use today"),
      gt("you need reliable voice, video and screen sharing"),
      gt("you want encrypted DMs and a safety team behind the service"),
      gt("you need mobile apps, threads, forums or AutoMod"),
    ],
    faq: [
      {
        question: gt("What is Spacebar, and is it the same as Fosscord?"),
        answer: gt("Yes, Spacebar is the project formerly called Fosscord. It is open-source software that reimplements Discord's API so people can run their own Discord-like servers, built by volunteers since 2020."),
      },
      {
        question: gt("Can Spacebar users talk to people on Discord?"),
        answer: gt("No. Spacebar instances are separate from discord.com and can't exchange messages with Discord users. SerikaCord has a consent-based bridge that mirrors messages with a Discord server."),
      },
      {
        question: gt("Will my Discord bot work on Spacebar?"),
        answer: gt("Often, yes, since Spacebar reimplements Discord's API; the project describes compatibility as reasonable but not perfect. Many Discord bots also work on SerikaCord after changing the API address."),
      },
      {
        question: gt("Is Spacebar end-to-end encrypted?"),
        answer: gt("No. Messages are protected in transit, but whoever runs the instance can read them, as on Discord. Voice and video are still experimental."),
      },
      {
        question: gt("Is there a Spacebar app for my phone?"),
        answer: gt("There are no official Android or iPhone apps, and the official desktop client hasn't been released since February 2024. People use community clients such as Fermo."),
      },
      {
        question: gt("Is Spacebar safe to use?"),
        answer: gt("It depends heavily on who runs the instance, since that person can read everything and sets the rules. The software is still in development; in August 2026 it published fixes for serious bugs, including one that let any logged-in user read any group DM by its ID."),
      },
      {
        question: gt("Can I host SerikaCord myself?"),
        answer: gt("Yes, but only for personal, non-commercial use for yourself and people you invite, free for them and not open to public sign-up; commercial use needs a license from partners@serika.dev. Self-hosted instances don't connect to serika.chat, there is no official setup guide or support, and SerikaCord is not open source."),
      },
    ],
    couldNotVerify: [
      gt("When Fosscord was renamed Spacebar."),
      gt("How many Spacebar instances or users exist."),
      gt("Whether the official spacebar.chat instance has a privacy policy or terms of service."),
      gt("Any security audit backing the project's ‘publicly audited’ description."),
      gt("How well voice and screen sharing work on the latest code, beyond what the FAQ says."),
      gt("Why the Harmony fork split off, and whether it was amicable."),
    ],
    notes: {
      title: gt("A split client ecosystem"),
      intro: gt("Spacebar relies on community-made clients, and in 2026 that ecosystem split."),
      points: [
        gt("In April 2026 a server called Harmony appeared on Codeberg with a description nearly identical to Spacebar's."),
        gt("The Fermi client, which Spacebar's homepage still links as its app, now describes itself as a Harmony client."),
        gt("Spacebar's documentation now recommends Fermo, a fork of Fermi, as its client."),
      ],
      src: ["harmony", "fermi", "fermo", "clients", "home"],
    },
  };
}

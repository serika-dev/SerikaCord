import { getGT } from "gt-next/server";
import type { CompareSource, Facts } from "../types";

/**
 * SerikaCord's own column on every comparison page, and the caveats we show
 * everywhere. Facts come from our policies, docs, code and changelog; keep
 * them in step with docs/architecture/e2ee.md ("Known limitations"), the
 * Privacy Policy and the download page.
 */

export const serikaSources: CompareSource[] = [
  { id: "privacy", title: "SerikaCord Privacy Policy", url: "https://serika.chat/privacy", publisher: "SerikaCord", kind: "primary" },
  { id: "terms", title: "SerikaCord Terms of Service (Dutch law, 16+)", url: "https://serika.chat/terms", publisher: "SerikaCord", kind: "primary" },
  { id: "guidelines", title: "SerikaCord Community Guidelines", url: "https://serika.chat/guidelines", publisher: "SerikaCord", kind: "primary" },
  {
    id: "e2ee",
    title: "SerikaCord end-to-end encryption design and known limitations",
    url: "https://github.com/serika-dev/SerikaCord/blob/main/docs/architecture/e2ee.md",
    publisher: "GitHub",
    kind: "primary",
  },
  { id: "license", title: "SerikaCord Source Available License, version 2.0 (October 2026)", url: "https://github.com/serika-dev/SerikaCord/blob/main/LICENSE", publisher: "GitHub", kind: "primary" },
  { id: "github", title: "SerikaCord source code", url: "https://github.com/serika-dev/SerikaCord", publisher: "GitHub", kind: "primary" },
  { id: "changelog", title: "SerikaCord changelog (v2.1, October 2026)", url: "https://serika.chat/changelog", publisher: "SerikaCord", kind: "primary" },
  { id: "download", title: "Download SerikaCord", url: "https://serika.chat/download", publisher: "SerikaCord", kind: "primary" },
  { id: "devdocs", title: "SerikaCord developer documentation (bots and gateway)", url: "https://serika.chat/developers/docs/intro", publisher: "SerikaCord", kind: "primary" },
];

/** SerikaCord's cell for every row of the fact table. */
export async function serikaFacts(): Promise<Facts> {
  const gt = await getGT();
  return {
    operator: {
      value: gt("Serika Company"),
      note: gt("A small team. First release in January 2026."),
      src: ["terms", "changelog"],
    },
    jurisdiction: {
      value: gt("Netherlands (EU)"),
      note: gt("GDPR and Dutch law; you can complain to the Dutch data protection authority."),
      src: ["privacy", "terms"],
    },
    businessModel: {
      value: gt("Optional Serika+ subscription"),
      note: gt("No ads and no selling of data."),
      src: ["privacy", "terms"],
    },
    ads: {
      status: "no",
      value: gt("No ads"),
      note: gt("No ads, no sponsored content and no advertising trackers, per our Privacy Policy."),
      src: ["privacy"],
    },
    pricing: {
      value: gt("Free; Serika+ optional"),
      note: gt("Serika+ raises limits (for example 2 GB uploads) and adds cosmetics."),
      src: ["terms"],
    },
    maturity: {
      status: "partial",
      value: gt("Young (since January 2026)"),
      note: gt("Actively developed, but a short track record and a small community."),
      src: ["changelog"],
    },
    e2eeDms: {
      status: "yes",
      value: gt("Yes, since October 2026"),
      note: gt("Text, files and edits in DMs, with safety numbers and device linking by QR code."),
      src: ["e2ee", "changelog"],
    },
    e2eeGroups: {
      status: "yes",
      value: gt("Group DMs"),
      note: gt("Group DMs of up to 10 people. People added later can't read earlier encrypted messages."),
      src: ["e2ee"],
    },
    e2eeCalls: {
      status: "partial",
      value: gt("DM and group DM calls"),
      note: gt("Voice and video calls in DMs and group DMs. Server voice channels are not end-to-end encrypted."),
      src: ["e2ee", "changelog"],
    },
    e2eeCommunity: {
      status: "no",
      note: gt("Server channels are encrypted at rest on our servers, but we can read them, which is what lets bots, search and moderation work."),
      src: ["e2ee", "privacy"],
    },
    e2eeDefault: {
      status: "yes",
      value: gt("On for new DMs"),
      note: gt("Any member can turn it off for a conversation; everyone sees a signed notice."),
      src: ["changelog"],
    },
    audit: {
      status: "no",
      value: gt("Not audited yet"),
      note: gt("The design and its known limitations are public, but no independent firm has reviewed it."),
      src: ["e2ee"],
    },
    metadata: {
      value: gt("We see metadata"),
      note: gt("Who talks to whom and when, reactions, replies and file sizes are visible to us, as is everything in server channels."),
      src: ["e2ee"],
    },
    dataUse: {
      status: "yes",
      value: gt("No selling, no ad trackers"),
      note: gt("We don't sell data or use private messages to train AI models."),
      src: ["privacy"],
    },
    phone: {
      status: "no",
      value: gt("Not required"),
      src: ["privacy"],
    },
    email: {
      status: "yes",
      value: gt("Required"),
      note: gt("Sign-in is handled by Serika Accounts. Passkeys are supported."),
      src: ["privacy", "changelog"],
    },
    ageChecks: {
      status: "no",
      value: gt("No ID or face scans"),
      note: gt("16 and over in every country, based on the date of birth you enter."),
      src: ["terms", "privacy"],
    },
    servers: {
      status: "yes",
      note: gt("Servers with text, voice, forum and ticket channels, categories and custom emoji."),
      src: ["changelog"],
    },
    roles: {
      status: "yes",
      note: gt("Discord-style roles with per-channel permission overrides."),
      src: ["devdocs"],
    },
    threadsForums: {
      status: "yes",
      note: gt("Threads, forum and ticket channels, and polls."),
      src: ["changelog"],
    },
    onboarding: {
      status: "yes",
      note: gt("Onboarding questions that give roles, a Server Guide, rules screening with optional manual approval, and verification levels."),
      src: ["changelog"],
    },
    modTools: {
      status: "yes",
      note: gt("AutoMod, audit log, timeouts, raid and spam protection, and a moderator view per member."),
      src: ["changelog"],
    },
    platformSafety: {
      status: "partial",
      note: gt("A staff Trust & Safety team with strikes, appeals, a message report queue and matching against known scam images. No transparency report published yet."),
      src: ["changelog", "terms"],
    },
    voiceChannels: {
      status: "yes",
      note: gt("Drop-in voice channels. Calls connect peer-to-peer where possible, so others in a call can see your IP address, and large calls get heavy."),
      src: ["github"],
    },
    videoScreen: {
      status: "yes",
      note: gt("Video and screen sharing up to source resolution at 60 FPS, picture-in-picture and pop-out calls."),
      src: ["changelog"],
    },
    streamingStage: {
      status: "partial",
      note: gt("You can stream a screen to a voice channel, but there are no Stage-style speaker and audience channels."),
      src: ["changelog"],
    },
    botApi: {
      status: "yes",
      note: gt("REST API, WebSocket gateway, slash commands, interactions and webhooks."),
      src: ["devdocs"],
    },
    discordBots: {
      status: "partial",
      value: gt("Discord API v10 compatible"),
      note: gt("Many discord.js and discord.py bots work after changing the API address. Not everything Discord offers is covered."),
      src: ["devdocs"],
    },
    discordMigration: {
      status: "yes",
      value: gt("Two-way bridge"),
      note: gt("A consent-based bridge mirrors messages between a Discord server and a SerikaCord server."),
      src: ["privacy"],
    },
    desktop: {
      status: "yes",
      note: gt("Windows, macOS (Apple silicon, macOS 12 or newer) and Linux."),
      src: ["download"],
    },
    mobile: {
      status: "partial",
      value: gt("Android; iPhone in development"),
      note: gt("The Android app is downloaded from our website, not Google Play. iPhone users use the web app from the Home Screen for now."),
      src: ["download"],
    },
    web: {
      status: "yes",
      note: gt("Everything works in the browser."),
      src: ["download"],
    },
    license: {
      status: "partial",
      value: gt("Source-available"),
      note: gt("The code is public on GitHub under our own license, which is not open source: you may read it, share changes as a public fork and run it for personal use, but not use it commercially or reuse it in other projects."),
      src: ["license", "github"],
    },
    selfHost: {
      status: "partial",
      value: gt("Personal use only"),
      note: gt("Since October 2026 you may run your own instance for yourself and people you invite, free of charge and not open to public sign-up. Commercial use needs a license (partners@serika.dev). There is no official setup guide or support."),
      src: ["license", "github"],
    },
    federation: {
      status: "no",
      note: gt("serika.chat is one central service, and self-hosted instances are separate islands that don't connect to it."),
      src: ["license"],
    },
    uploads: {
      value: gt("500 MB per file"),
      note: gt("2 GB with Serika+."),
      src: ["github"],
    },
    groupSize: {
      value: gt("Group DMs: 10 people"),
      note: gt("Servers have no small member cap, but we haven't been tested at very large scale."),
      src: ["github"],
    },
    scale: {
      status: "partial",
      value: gt("Small"),
      note: gt("A young service with a small community. We don't publish user numbers."),
    },
    incidents: {
      value: gt("Short track record"),
      note: gt("Running since January 2026, so there is little history to judge. Security fixes are listed in our changelog."),
      src: ["changelog"],
    },
  };
}

/** The limits of SerikaCord's end-to-end encryption, shown on every page. */
export async function serikaE2eeLimits(): Promise<string[]> {
  const gt = await getGT();
  return [
    gt("It covers DMs, group DMs and their calls. Server channels and server voice channels are not end-to-end encrypted."),
    gt("It is new (October 2026) and hasn't been independently audited."),
    gt("We can still see metadata: who talks to whom and when, reactions, replies and file sizes."),
    gt("The 6-digit PIN that unlocks your messages on a new device allows 10 wrong tries before the PIN backup is wiped. But whoever runs our servers and holds the server secret could in principle try all one million PINs. The strongest setup is a long recovery passphrase with the PIN removed."),
    gt("A group's member list comes from our servers. We can't add someone to a group invisibly, but you should watch the member list and safety numbers."),
    gt("People added to a group later can't read its earlier encrypted messages."),
    gt("Voice messages, search, link previews, polls, forwarding and bots don't work in encrypted conversations yet."),
    gt("The web app is loaded from our servers, like every web-based encrypted messenger, so you are trusting the code we serve. It is public on GitHub for anyone to check."),
    gt("If you report an encrypted message, your app reveals that message to our safety team with a cryptographic proof that it is genuine."),
  ];
}

/** Other honest caveats about SerikaCord, shown on every page. */
export async function serikaCaveats(): Promise<string[]> {
  const gt = await getGT();
  return [
    gt("SerikaCord is young (first release January 2026) and made by a small team, so expect rough edges and far fewer public communities than on the big apps."),
    gt("Calls connect peer-to-peer when possible, so other people in a call can see your IP address, and large group video calls get heavy."),
    gt("The code is source-available, not open source. You may self-host it only for personal, non-commercial use with people you invite, and self-hosted instances don't connect to serika.chat."),
    gt("There is no native iPhone app yet, and the Android app is installed from our website rather than Google Play."),
    gt("We use AI coding assistants to help build SerikaCord."),
  ];
}

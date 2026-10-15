import { getGT } from "gt-next/server";
import type { AppKind, CompareStatus, FactGroupId, RowId, Tier, TierSectionId } from "./types";

/** Translated labels for the comparison pages. Every string is a gt() literal. */

export async function factLabels(): Promise<{ groups: Record<FactGroupId, string>; rows: Record<RowId, string> }> {
  const gt = await getGT();
  return {
    groups: {
      basics: gt("Basics"),
      privacy: gt("Privacy and encryption"),
      account: gt("Account requirements"),
      community: gt("Community features"),
      moderation: gt("Moderation and safety"),
      voice: gt("Voice and video"),
      bots: gt("Bots, API and Discord"),
      platforms: gt("Apps and platforms"),
      openness: gt("Openness"),
      limits: gt("Limits"),
      record: gt("Scale and track record"),
    },
    rows: {
      operator: gt("Who runs it"),
      jurisdiction: gt("Where it's based"),
      businessModel: gt("How it makes money"),
      ads: gt("Ads or sponsored content"),
      pricing: gt("Price"),
      maturity: gt("Age and status"),
      e2eeDms: gt("End-to-end encrypted DMs"),
      e2eeGroups: gt("End-to-end encrypted group chats"),
      e2eeCalls: gt("End-to-end encrypted calls"),
      e2eeCommunity: gt("End-to-end encrypted server or community channels"),
      e2eeDefault: gt("Encryption on by default"),
      audit: gt("Independent security audit"),
      metadata: gt("What the operator can see"),
      dataUse: gt("Trackers, data selling and AI training"),
      phone: gt("Phone number required"),
      email: gt("Email address required"),
      ageChecks: gt("ID or face age checks"),
      servers: gt("Servers with channels"),
      roles: gt("Roles and per-channel permissions"),
      threadsForums: gt("Threads and forums"),
      onboarding: gt("Onboarding and rules screening"),
      modTools: gt("Moderation tools"),
      platformSafety: gt("Safety team, reporting and transparency"),
      voiceChannels: gt("Drop-in voice channels"),
      videoScreen: gt("Video and screen sharing"),
      streamingStage: gt("Streaming and Stage-style events"),
      botApi: gt("Bot API"),
      discordBots: gt("Runs Discord bots"),
      discordMigration: gt("Discord bridge or import"),
      desktop: gt("Desktop apps"),
      mobile: gt("Phone apps"),
      web: gt("Web app (no install)"),
      license: gt("Source code license"),
      selfHost: gt("Self-hosting"),
      federation: gt("Federation with other servers"),
      uploads: gt("Free upload limit"),
      groupSize: gt("Group and community size"),
      scale: gt("How many people use it"),
      incidents: gt("Notable incidents"),
    },
  };
}

export async function statusLabels(): Promise<Record<CompareStatus, string>> {
  const gt = await getGT();
  return {
    yes: gt("Yes"),
    partial: gt("Partly"),
    notyet: gt("Not yet"),
    no: gt("No"),
    unknown: gt("Couldn't verify"),
  };
}

export async function kindLabels(): Promise<Record<AppKind, { title: string; intro: string }>> {
  const gt = await getGT();
  return {
    community: {
      title: gt("Discord-style community apps"),
      intro: gt("Servers, channels, roles and voice: the apps people usually mean by a Discord alternative."),
    },
    messenger: {
      title: gt("Messengers and privacy apps"),
      intro: gt("Built for private conversations rather than public communities. Several are far ahead of us on encryption."),
    },
    voice: {
      title: gt("Voice-first apps"),
      intro: gt("Made for talking while you play, with text as a side feature."),
    },
    team: {
      title: gt("Forums and team chat"),
      intro: gt("Long-form discussion and workplace chat, often self-hosted."),
    },
    protocol: {
      title: gt("Open protocols and Matrix clients"),
      intro: gt("Federated networks where you pick a server and an app, and no single company is in charge."),
    },
  };
}

export async function tierSectionLabels(): Promise<Record<TierSectionId, { title: string; criteria: string }>> {
  const gt = await getGT();
  return {
    privacy: {
      title: gt("Privacy and encryption"),
      criteria: gt("What is end-to-end encrypted and by default, how much the operator can see, phone numbers, trackers and data use."),
    },
    security: {
      title: gt("Security track record and audits"),
      criteria: gt("Independent audits, published research, breaches and serious vulnerabilities, and how long the code has held up."),
    },
    community: {
      title: gt("Community and server features"),
      criteria: gt("Servers and channels, roles and permissions, threads, forums, onboarding and the everyday tools communities use."),
    },
    moderation: {
      title: gt("Moderation and safety tools"),
      criteria: gt("AutoMod, audit logs, screening and timeouts for moderators, plus the operator's own safety team, reporting and transparency."),
    },
    voice: {
      title: gt("Voice and video"),
      criteria: gt("Voice quality and latency, drop-in voice channels, video, screen sharing, streaming and how well calls scale."),
    },
    bots: {
      title: gt("Bots, integrations and API"),
      criteria: gt("Bot APIs, webhooks, bridges and the size of the ecosystem around them."),
    },
    apps: {
      title: gt("Apps and platform coverage"),
      criteria: gt("Web, Windows, macOS, Linux, Android and iPhone apps, how they are distributed and how finished they are."),
    },
    ease: {
      title: gt("Ease of use and onboarding"),
      criteria: gt("How quickly a normal person can sign up, find their friends and feel at home."),
    },
    openness: {
      title: gt("Openness"),
      criteria: gt("Open-source license, freedom to self-host, and federation with other servers."),
    },
    scale: {
      title: gt("Scale and network effect"),
      criteria: gt("How many people already use it, so your friends are likely to be there."),
    },
    business: {
      title: gt("Business model, sustainability and no ads"),
      criteria: gt("How it pays its bills, whether that involves ads or your data, and how likely it is to still be around."),
    },
    migration: {
      title: gt("Moving from Discord"),
      criteria: gt("Server import, bridges, Discord bot compatibility and how familiar it feels to Discord users."),
    },
  };
}

export async function tierNames(): Promise<Record<Tier, string>> {
  const gt = await getGT();
  return {
    S: gt("S tier: best in class"),
    A: gt("A tier: excellent"),
    B: gt("B tier: good"),
    C: gt("C tier: mixed"),
    D: gt("D tier: weak"),
    F: gt("F tier: missing or not usable"),
  };
}

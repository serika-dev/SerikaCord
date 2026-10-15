import { getGT } from "gt-next/server";
import type { AppContent, CompareSource } from "../types";

/**
 * SerikaCord vs TeamSpeak. Facts checked on COMPARE_LAST_CHECKED_ISO against
 * the sources below (titles and publishers are proper names, not translated).
 */

export const sources: CompareSource[] = [
  { id: "company", title: "TeamSpeak company page (history, headquarters)", url: "https://teamspeak.com/en/more/company/", publisher: "TeamSpeak", kind: "primary" },
  { id: "downloads", title: "TeamSpeak downloads (TeamSpeak 3 client 3.6.2, TeamSpeak 6 6.0.0-beta5, server 3.13.8)", url: "https://teamspeak.com/en/downloads/", publisher: "TeamSpeak", kind: "primary" },
  { id: "privacy", title: "TeamSpeak privacy policy", url: "https://teamspeak.com/en/privacy-policy/", publisher: "TeamSpeak", kind: "primary" },
  { id: "terms", title: "TeamSpeak general terms and conditions (effective 22 June 2026)", url: "https://teamspeak.com/en/terms-and-conditions/", publisher: "TeamSpeak", kind: "primary", date: "2026-06-22" },
  { id: "communities", title: "What are TeamSpeak Communities?", url: "https://teamspeak.com/en/solutions/communities/", publisher: "TeamSpeak", kind: "primary" },
  { id: "ts6-server", title: "teamspeak6-server README", url: "https://github.com/teamspeak/teamspeak6-server", publisher: "GitHub", kind: "primary" },
  { id: "ts6-releases", title: "teamspeak6-server releases (beta10 to beta13.1)", url: "https://github.com/teamspeak/teamspeak6-server/releases", publisher: "GitHub", kind: "primary" },
  {
    id: "ts6-licensing",
    title: "TS6 Server beta6: license extension, licensing and pricing",
    url: "https://community.teamspeak.com/t/ts6-server-beta-v6-0-0-beta6-license-extension-supporting-veterans-licensing-issues-licensing-and-pricing/61809",
    publisher: "TeamSpeak Community",
    kind: "primary",
    date: "2025-08-20",
  },
  {
    id: "beta4",
    title: "TeamSpeak 6.0.0-beta4 Foundation II Update",
    url: "https://community.teamspeak.com/t/teamspeak-6-0-0-beta4-foundation-ii-update/64497",
    publisher: "TeamSpeak Community",
    kind: "primary",
    date: "2026-04-28",
  },
  {
    id: "policy-update",
    title: "Updated privacy policy, terms and conditions, plus the new community guidelines",
    url: "https://community.teamspeak.com/t/updated-privacy-policy-terms-and-conditions-plus-the-new-community-guidelines/64826",
    publisher: "TeamSpeak Community",
    kind: "primary",
    date: "2026-06-24",
  },
  {
    id: "encrypt-chat",
    title: "What does the ‘encrypt chat’ do? (staff answer)",
    url: "https://community.teamspeak.com/t/what-does-the-encrypt-chat-do/63362",
    publisher: "TeamSpeak Community",
    kind: "primary",
    date: "2026-02",
  },
  {
    id: "voice-encryption",
    title: "How secure is encrypted voice chat? (staff answer)",
    url: "https://community.teamspeak.com/t/how-secure-is-encrypted-voice-chat/1166",
    publisher: "TeamSpeak Community",
    kind: "primary",
    date: "2020-01-31",
  },
  {
    id: "mobile",
    title: "When is the TeamSpeak 6 app coming?",
    url: "https://community.teamspeak.com/t/when-is-the-teamspeak-6-app-coming/52668",
    publisher: "TeamSpeak Community",
    kind: "primary",
  },
  {
    id: "discord-alt",
    title: "Making TS6 the ultimate Discord alternative: feedback and suggestions",
    url: "https://community.teamspeak.com/t/subject-making-ts6-the-ultimate-discord-alternative-feedback-suggestions/63483",
    publisher: "TeamSpeak Community",
    kind: "primary",
    date: "2026-02",
  },
  {
    id: "switch-questions",
    title: "Questions before committing to switch to TeamSpeak",
    url: "https://community.teamspeak.com/t/questions-before-committing-to-switch-to-teamspeak/63543",
    publisher: "TeamSpeak Community",
    kind: "secondary",
    date: "2026-02",
  },
  {
    id: "file-limit",
    title: "Drag and drop file transfer limit is only 5MB",
    url: "https://community.teamspeak.com/t/drag-and-drop-file-transfer-limit-is-only-5mb/34576",
    publisher: "TeamSpeak Community",
    kind: "primary",
  },
  {
    id: "ts3-expiry",
    title: "TeamSpeak 3 server access issues when using versions 3.1 to 3.5",
    url: "https://community.teamspeak.com/t/teamspeak-3-server-access-issues-when-using-versions-3-1-3-5/58529",
    publisher: "TeamSpeak Community",
    kind: "primary",
    date: "2025-03",
  },
  {
    id: "licenses",
    title: "What licenses are available?",
    url: "https://support.teamspeak.com/hc/en-us/articles/26033788383261-What-licenses-are-available",
    publisher: "TeamSpeak Support",
    kind: "primary",
  },
  { id: "hosting", title: "Community server plans", url: "https://support.teamspeak.com/hc/en-us/articles/26033099878045", publisher: "TeamSpeak Support", kind: "primary" },
  { id: "matrix", title: "TeamSpeak on X: Homebase and Matrix-protocol end-to-end encryption", url: "https://x.com/teamspeak/status/1589621116032585728", publisher: "TeamSpeak", kind: "primary", date: "2022-11" },
  { id: "wikipedia", title: "TeamSpeak", url: "https://en.wikipedia.org/wiki/TeamSpeak", publisher: "Wikipedia", kind: "secondary" },
  { id: "80lv", title: "TeamSpeak reports incredible surge of new users", url: "https://80.lv/articles/teamspeak-reports-incredible-surge-of-new-users/", publisher: "80.lv", kind: "secondary", date: "2026-02-19" },
  { id: "club386", title: "TeamSpeak enjoys massive influx as people flee Discord ID verification", url: "https://www.club386.com/?p=134767", publisher: "Club386", kind: "secondary", date: "2026-02-18" },
  {
    id: "alternativeto",
    title: "TeamSpeak 6 will finally introduce direct calls, 4K screen sharing and picture-in-picture",
    url: "https://alternativeto.net/news/2026/8/teamspeak-6-will-finally-introduce-direct-calls-4k-screen-sharing-and-picture-in-picture/",
    publisher: "AlternativeTo",
    kind: "secondary",
    date: "2026-08-27",
  },
  { id: "cve", title: "CVE-2026-4390: TeamSpeak 3 Server use-after-free", url: "https://www.tenable.com/cve/CVE-2026-4390", publisher: "Tenable", kind: "secondary", date: "2026-05-27" },
];

export async function content(): Promise<AppContent> {
  const gt = await getGT();
  return {
    take: gt("The classic low-latency voice app for gaming groups, with self-hostable servers and no ads or ID checks. But there are no persistent text channels, TeamSpeak 6 is still in beta, and there's no web app."),
    intro: [
      gt("TeamSpeak has been the voice app of choice for gaming clans, esports teams and simulation groups since 2001. It is voice first: a server is a tree of voice channels, and you can run that server on your own machine. Its successor, TeamSpeak 6, adds screen sharing and a global chat, but has been in beta since January 2025."),
      gt("TeamSpeak wins on voice latency, years of reliability and real self-hosting. SerikaCord wins on everything around the voice: text channels with history, threads and forums, bots, a web app, a current Android app and free servers without slot limits."),
    ],
    verdict: gt("If your group mostly talks and wants the lowest-latency voice on a server it controls, TeamSpeak is still excellent. If you want a full community with text, threads, bots and phone access, SerikaCord fits better."),
    facts: {
      operator: {
        value: gt("TeamSpeak Systems, Inc."),
        note: gt("A private company; TeamSpeak's first public release was in 2001. A German affiliate, TeamSpeak Systems GmbH in Heilbronn, handles some services."),
        src: ["terms", "company", "wikipedia"],
      },
      jurisdiction: {
        value: gt("United States (California)"),
        note: gt("The US company is the main contracting party and California law governs the terms. Data may be transferred to the US."),
        src: ["terms", "privacy"],
      },
      businessModel: {
        value: gt("Server licenses and hosting"),
        note: gt("The apps are free. TeamSpeak sells self-hosted server licenses by slot count, official hosted servers, and voice SDK licenses for games and businesses."),
        src: ["licenses", "hosting", "wikipedia"],
      },
      ads: {
        status: "no",
        value: gt("No ads"),
        note: gt("No ads in the apps. The June 2026 privacy policy says advertising trackers were removed from the website."),
        src: ["privacy"],
      },
      pricing: {
        value: gt("Free up to 32 slots"),
        note: gt("A self-hosted TeamSpeak 3 server is free for 32 people at once, then from $55 a year for 64. Official hosted servers start at $4.99 a month for 11 slots. TeamSpeak 6 server pricing hasn't been announced."),
        src: ["licenses", "hosting", "ts6-licensing"],
      },
      maturity: {
        status: "partial",
        value: gt("Since 2001; TS6 in beta"),
        note: gt("TeamSpeak 3 is stable but due to reach end of life on 31 December 2027. TeamSpeak 6 has been in beta since January 2025, with no final release date."),
        src: ["downloads", "policy-update", "beta4"],
      },
      e2eeDms: {
        status: "partial",
        value: gt("Opt-in"),
        note: gt("In TeamSpeak 6 you can switch on ‘Encrypt chat’ for a direct conversation. It is off by default and can't be switched off again."),
        src: ["encrypt-chat"],
      },
      e2eeGroups: {
        status: "partial",
        value: gt("Opt-in, global chat only"),
        note: gt("Group chats in TeamSpeak's global chat can be encrypted the same way. Server channel chat can't."),
        src: ["encrypt-chat"],
      },
      e2eeCalls: {
        status: "no",
        note: gt("Voice is encrypted between your app and the server (AES-256), not end to end, and each server's admin decides whether to encrypt it at all."),
        src: ["voice-encryption"],
      },
      e2eeCommunity: {
        status: "no",
        note: gt("Server channel text isn't end-to-end encrypted. It also isn't stored: it only reaches people who are online at the time."),
        src: ["discord-alt"],
      },
      e2eeDefault: {
        status: "no",
        note: gt("Chat encryption is opt-in, and voice encryption depends on each server's settings."),
        src: ["encrypt-chat", "voice-encryption"],
      },
      audit: {
        status: "no",
        value: gt("None published"),
        note: gt("We found no public independent audit, and the apps and server are closed source."),
      },
      metadata: {
        value: gt("Server owner and TeamSpeak"),
        note: gt("Whoever runs a server sees who connects and their IP addresses. TeamSpeak stores account details, IP addresses and global DMs and group chats on its own servers."),
        src: ["privacy"],
      },
      dataUse: {
        status: "partial",
        value: gt("Doesn't sell data"),
        note: gt("The policy says TeamSpeak doesn't sell personal data. Its website uses Microsoft Clarity session recordings, which need your consent since June 2026."),
        src: ["privacy"],
      },
      phone: {
        status: "no",
        value: gt("Not required"),
        src: ["privacy"],
      },
      email: {
        status: "partial",
        value: gt("Only for some features"),
        note: gt("TeamSpeak 3 needs no account: you join a server by its address. A myTeamSpeak account is used for TeamSpeak 6 global chat, communities and hosting; users say TS6 requires one, but we couldn't confirm that in official documents."),
        src: ["switch-questions"],
      },
      ageChecks: {
        status: "no",
        value: gt("No ID or face scans"),
        note: gt("No age verification found. The terms set no fixed minimum age and defer to local law, with parental consent for minors."),
        src: ["terms"],
      },
      servers: {
        status: "yes",
        note: gt("Servers with a nested tree of voice channels. TeamSpeak 6 adds a directory to find and join public communities."),
        src: ["communities"],
      },
      roles: {
        status: "yes",
        note: gt("Very detailed server and channel groups and permissions, often described as hard for new admins."),
        src: ["wikipedia", "discord-alt"],
      },
      threadsForums: {
        status: "no",
        note: gt("No threads, no forums and no persistent server text channels, which users list as the feature they want most."),
        src: ["discord-alt"],
      },
      onboarding: {
        status: "no",
        note: gt("We found no Discord-style onboarding or rules screening."),
      },
      modTools: {
        status: "partial",
        note: gt("Strong kick, ban and permission tools in TeamSpeak 3. Users describe TeamSpeak 6 server moderation as still in development."),
        src: ["discord-alt"],
      },
      platformSafety: {
        status: "partial",
        note: gt("Community guidelines were added in June 2026. We found no transparency report, and self-hosted servers are moderated by their owners."),
        src: ["policy-update", "privacy"],
      },
      voiceChannels: {
        status: "yes",
        value: gt("Best in class"),
        note: gt("Low-latency voice that gaming clans, esports teams and simulation groups have relied on for over 20 years."),
        src: ["wikipedia"],
      },
      videoScreen: {
        status: "partial",
        value: gt("TeamSpeak 6 beta only"),
        note: gt("Camera feeds and screen sharing up to 4K in the TeamSpeak 6 beta, with direct calls and picture-in-picture announced in August 2026."),
        src: ["alternativeto"],
      },
      streamingStage: {
        status: "partial",
        note: gt("The TeamSpeak 6 beta can stream a screen to a channel. There are no Stage-style events."),
        src: ["alternativeto"],
      },
      botApi: {
        status: "partial",
        value: gt("Server automation only"),
        note: gt("Admins automate servers through ServerQuery and plugins, and third-party bots like SinusBot exist, but there is no official bot platform and no webhooks."),
        src: ["wikipedia"],
      },
      discordBots: {
        status: "no",
        note: gt("Nothing compatible with Discord's bot API."),
      },
      discordMigration: {
        status: "no",
        note: gt("No Discord bridge or importer. TeamSpeak 3 licenses and data don't carry over to TeamSpeak 6 either."),
        src: ["policy-update"],
      },
      desktop: {
        status: "yes",
        note: gt("Windows, macOS and Linux."),
        src: ["downloads"],
      },
      mobile: {
        status: "partial",
        value: gt("Old TeamSpeak 3 apps only"),
        note: gt("The TeamSpeak 6 mobile app hasn't been released, so phone users rely on the older TeamSpeak 3 apps."),
        src: ["mobile", "downloads"],
      },
      web: {
        status: "no",
        note: gt("There is no browser app."),
        src: ["downloads"],
      },
      license: {
        status: "no",
        value: gt("Proprietary"),
        note: gt("Free but closed-source apps. The TeamSpeak 6 server GitHub repository holds binaries and documentation, not source code."),
        src: ["ts6-server"],
      },
      selfHost: {
        status: "yes",
        value: gt("Yes, free up to 32 slots"),
        note: gt("Run your own server on Linux, Windows or Docker. Server builds carry a license with an end date, so old ones stop starting, and the TeamSpeak 6 beta license must be renewed about every two months. Global chat still runs on TeamSpeak's servers."),
        src: ["ts6-server", "ts6-releases", "ts3-expiry"],
      },
      federation: {
        status: "no",
        note: gt("Each server is separate. Global chat uses the Matrix protocol on TeamSpeak's own server, with no federation announced."),
        src: ["matrix"],
      },
      uploads: {
        value: gt("About 5 MB in chat"),
        note: gt("Drag-and-drop chat attachments are limited to about 5 MB. File limits on a server are set by its admin."),
        src: ["file-limit"],
      },
      groupSize: {
        value: gt("Set by slots"),
        note: gt("A server holds as many people at once as its license or plan allows: 32 free, up to 1,024 with self-hosted TeamSpeak 3 licenses."),
        src: ["licenses"],
      },
      scale: {
        status: "unknown",
        value: gt("Unknown"),
        note: gt("TeamSpeak says it serves ‘millions’ but publishes no user numbers. It reported a large surge of new users in February 2026."),
        src: ["company", "80lv", "club386"],
      },
      incidents: {
        value: gt("Expiring server builds"),
        note: gt("In March 2025 old TeamSpeak 3 servers stopped starting when their built-in licenses expired. Official hosting filled up in some regions in February 2026, and three medium-severity denial-of-service flaws in TeamSpeak 3 Server were fixed in May 2026."),
        src: ["ts3-expiry", "80lv", "cve"],
      },
    },
    whyUs: [
      {
        title: gt("Text that stays, with threads and forums"),
        text: gt("SerikaCord has text channels with full history, threads, forum and ticket channels and polls. TeamSpeak has no persistent server text channels: channel chat only reaches people who are online, and users name this as the feature they want most."),
        src: ["discord-alt"],
      },
      {
        title: gt("A web app and a current Android app"),
        text: gt("SerikaCord works fully in the browser and has an Android app. TeamSpeak has no web app, and its TeamSpeak 6 mobile app isn't out, so phone users are on older TeamSpeak 3 apps. We don't have an iPhone app yet either."),
        src: ["downloads", "mobile"],
      },
      {
        title: gt("No paying per slot"),
        text: gt("A SerikaCord server is free however many people join. A self-hosted TeamSpeak server is free only up to 32 people at once, and official hosting starts at $4.99 a month for 11 slots."),
        src: ["licenses", "hosting"],
      },
      {
        title: gt("Encrypted DMs by default"),
        text: gt("On SerikaCord, DMs, group DMs and their calls are end-to-end encrypted by default. TeamSpeak's chat encryption is opt-in, and its voice is encrypted only between you and the server. Our encryption is new and unaudited, and our server voice channels aren't end-to-end encrypted either."),
        src: ["encrypt-chat", "voice-encryption"],
      },
      {
        title: gt("Bots, webhooks and a Discord bridge"),
        text: gt("SerikaCord has a bot API that follows Discord's, webhooks and a consent-based Discord bridge. TeamSpeak has server automation through ServerQuery but no bot platform and no webhooks."),
        src: ["wikipedia"],
      },
      {
        title: gt("Video and screen sharing in a stable release"),
        text: gt("SerikaCord has video calls and screen sharing at up to 60 FPS today. On TeamSpeak they exist only in the TeamSpeak 6 beta."),
        src: ["alternativeto"],
      },
    ],
    whyThem: [
      {
        title: gt("Voice that gamers have trusted for 20 years"),
        text: gt("TeamSpeak's low-latency voice has been the standard for competitive gaming, esports and simulation groups since the early 2000s, and runs through a server built for it. SerikaCord's calls connect peer-to-peer where possible, which shows your IP address to others in the call and gets heavy in large calls."),
        src: ["wikipedia"],
      },
      {
        title: gt("Real self-hosting"),
        text: gt("Running your own TeamSpeak server on Linux, Windows or Docker is the normal way to use it, with official images and documentation. SerikaCord allows self-hosting only for personal, non-commercial use, with no setup guide or support."),
        src: ["ts6-server"],
      },
      {
        title: gt("Join without an account"),
        text: gt("With TeamSpeak 3 you can join a server by its address without signing up or giving an email address. SerikaCord needs an account with an email address."),
        src: ["switch-questions"],
      },
      {
        title: gt("Fine-grained control for admins"),
        text: gt("TeamSpeak's server and channel permission system is among the most detailed anywhere, and ServerQuery lets admins script almost everything. It is complex, but power users love it."),
        src: ["wikipedia"],
      },
      {
        title: gt("A long track record"),
        text: gt("TeamSpeak has been around since 2001 and is run by an established company. SerikaCord launched in January 2026 and has a short history to judge."),
        src: ["company", "wikipedia"],
      },
      {
        title: gt("No fixed minimum age"),
        text: gt("TeamSpeak's terms follow local law with parental consent for minors. SerikaCord is 16 and over in every country."),
        src: ["terms"],
      },
    ],
    pickThem: [
      gt("voice is what your group does most and every millisecond counts"),
      gt("you want to run your own voice server on your own hardware"),
      gt("your gaming or simulation group already uses TeamSpeak"),
      gt("you want people to join without creating an account"),
    ],
    pickUs: [
      gt("your community talks in text as much as in voice"),
      gt("you need a web app or a current phone app"),
      gt("you want bots, webhooks or a bridge to Discord"),
      gt("you don't want to pay per slot as your group grows"),
      gt("you want video and screen sharing in a stable release"),
    ],
    faq: [
      {
        question: gt("Is TeamSpeak end-to-end encrypted?"),
        answer: gt("Only partly, and only if you choose it. In TeamSpeak 6 you can turn on encryption for a DM or a global group chat. Voice is encrypted between your app and the server, not end to end, and server admins decide whether to encrypt it."),
      },
      {
        question: gt("Is TeamSpeak free?"),
        answer: gt("The apps are free, and a self-hosted TeamSpeak 3 server is free for up to 32 people at once. Bigger servers need a paid license, from $55 a year for 64 slots, or official hosting from $4.99 a month. TeamSpeak 6 server pricing hasn't been announced."),
      },
      {
        question: gt("Is TeamSpeak 6 out?"),
        answer: gt("Not as a final release. TeamSpeak 6 has been in beta since January 2025 and its mobile app hasn't been released. TeamSpeak 3 remains the stable version and is due to reach end of life on 31 December 2027."),
      },
      {
        question: gt("Does TeamSpeak have text channels like Discord?"),
        answer: gt("No. Channel chat isn't stored, so you only see messages sent while you're online, and there are no threads or forums. TeamSpeak 6 adds a global chat for DMs and group chats."),
      },
      {
        question: gt("Who runs TeamSpeak?"),
        answer: gt("TeamSpeak Systems, Inc., a US company, with a German affiliate, TeamSpeak Systems GmbH. TeamSpeak has been around since 2001."),
      },
      {
        question: gt("Can I move my Discord server to TeamSpeak?"),
        answer: gt("There is no importer or bridge, so you would set up channels and permissions again by hand. SerikaCord has a consent-based bridge that mirrors a Discord server, and a bot API that follows Discord's."),
      },
      {
        question: gt("Can I host SerikaCord myself?"),
        answer: gt("Yes, but only for personal, non-commercial use for yourself and people you invite, free for them and not open to public sign-up; commercial use needs a license from partners@serika.dev. Self-hosted instances don't connect to serika.chat, there is no official setup guide or support, and SerikaCord is not open source."),
      },
    ],
    couldNotVerify: [
      gt("How many people use TeamSpeak: the company only says ‘millions’."),
      gt("Whether TeamSpeak 6 requires a myTeamSpeak account to join servers."),
      gt("Final TeamSpeak 6 server pricing, and whether the free 32-slot tier will survive."),
      gt("Whether TeamSpeak 6 voice and video are end-to-end encrypted; the official explanation we found describes encryption between app and server."),
      gt("Whether TeamSpeak 6 screen sharing is still peer-to-peer only."),
      gt("License and hosting prices: TeamSpeak's support pages blocked us, so prices come from search previews of those pages."),
    ],
  };
}

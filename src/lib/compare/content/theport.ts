import { getGT } from "gt-next/server";
import type { AppContent, CompareSource } from "../types";

/**
 * SerikaCord vs The Port (theport.app). The Port is what kloak.app turned
 * into: Kloak shut down in October 2026, and by November its domain served
 * The Port and redirected to theport.app. Neither site says the two are the
 * same team, so the page says what links them and what doesn't. Facts checked
 * on 2026-11-19 against the sources below (titles and publishers are proper
 * names, not translated).
 */

export const sources: CompareSource[] = [
  { id: "home", title: "The Port homepage", url: "https://theport.app/", publisher: "The Port", kind: "primary", date: "2026-11" },
  { id: "privacy", title: "The Port Privacy Policy (last updated 18 November 2026)", url: "https://theport.app/privacy", publisher: "The Port", kind: "primary", date: "2026-11-18" },
  { id: "terms", title: "The Port Terms of Service", url: "https://theport.app/terms", publisher: "The Port", kind: "primary", date: "2026-11-18" },
  { id: "downloads", title: "The Port downloads (Windows 0.2.5; other platforms coming)", url: "https://theport.app/downloads", publisher: "The Port", kind: "primary", date: "2026-11" },
  { id: "client", title: "The Port web client code (channels, voice, action bots, shop, encrypted DMs)", url: "https://theport.app/assets/index-CWosrMKE.js", publisher: "The Port", kind: "primary", date: "2026-11-19" },
  { id: "kloak-now", title: "kloak.app now serves The Port", url: "https://kloak.app/", publisher: "kloak.app", kind: "primary", date: "2026-11" },
  { id: "redirect", title: "kloak.app redirect script (sends visitors to theport.app)", url: "https://kloak.app/redirect.js", publisher: "kloak.app", kind: "primary", date: "2026-11" },
  {
    id: "kloak-live",
    title: "Kloak homepage, last live capture before shutdown",
    url: "https://web.archive.org/web/20261010114718/https://kloak.app/",
    publisher: "Internet Archive",
    kind: "primary",
    date: "2026-10-10",
  },
  {
    id: "kloak-oct11",
    title: "Kloak still running on 11 October 2026",
    url: "https://web.archive.org/web/20261011213154/https://kloak.app/privacy",
    publisher: "Internet Archive",
    kind: "primary",
    date: "2026-10-11",
  },
  {
    id: "kloak-play",
    title: "Kloak – Communities & Chat on Google Play (archived)",
    url: "https://web.archive.org/web/20260919225322/https://play.google.com/store/apps/details?id=app.kloak.mobile",
    publisher: "Internet Archive",
    kind: "primary",
    date: "2026-09-19",
  },
  {
    id: "kloak-founder",
    title: "Kloak founder quoted: messages accessible at the database level",
    url: "https://news.ycombinator.com/item?id=46958000",
    publisher: "Hacker News",
    kind: "secondary",
    date: "2026-02-10",
  },
];

export async function content(): Promise<AppContent> {
  const gt = await getGT();
  return {
    take: gt("The Port is a young Discord-style app from the old Kloak address, with end-to-end encrypted DMs and a sign-up that needs only a username and password."),
    intro: [
      gt("The Port is a Discord-style community app with servers, voice channels, forums and a shop for avatar decorations. It is in early access: there is a web app and a Windows app (version 0.2.5), and apps for Mac, Linux, Android and iPhone are listed as coming."),
      gt("It is where Kloak went. Kloak, a similar app, shut down in October 2026, and by November its address kloak.app showed The Port and sent visitors on to theport.app. The Port has many of Kloak's features, but neither site mentions Kloak or says who runs The Port."),
      gt("Unlike Kloak, The Port has shipped end-to-end encryption for direct messages. This page compares it with SerikaCord as it is today."),
    ],
    verdict: gt("The Port gets encrypted DMs and anonymous sign-up right, but it's very new, only on the web and Windows, and doesn't say who runs it. SerikaCord has more apps, bots and calls, and a named company behind it."),
    facts: {
      operator: {
        value: gt("Not named"),
        note: gt("Neither the terms nor the privacy policy names a company or a person; the only contact is through the app. Kloak, which used the same address, said it was a volunteer team with no registered legal entity."),
        src: ["terms", "privacy", "kloak-live"],
      },
      jurisdiction: {
        value: gt("Unknown"),
        note: gt("The policies name no country, governing law or hosting region."),
        src: ["terms", "privacy"],
      },
      businessModel: {
        value: gt("Not stated"),
        note: gt("No subscription or payment in the client. There is a shop where people sell avatar decorations and sticker packs for Shells, a currency you collect with a daily bonus; we found no way to buy Shells with money."),
        src: ["client"],
      },
      ads: {
        status: "no",
        value: gt("No ads"),
        note: gt("The privacy policy says no ads and no tracking across other sites or apps."),
        src: ["privacy"],
      },
      pricing: {
        value: gt("Free"),
        src: ["downloads", "client"],
      },
      maturity: {
        status: "partial",
        value: gt("Early access (November 2026)"),
        note: gt("The Windows app is at version 0.2.5 and the policies were last updated on 18 November 2026."),
        src: ["downloads", "privacy"],
      },
      e2eeDms: {
        status: "yes",
        note: gt("Text, images and file names in DMs are encrypted on your device (ECDH P-256 and AES-256-GCM). If the other person hasn't set up encryption yet, messages send as plain text the server can read, and the app says so."),
        src: ["privacy", "client"],
      },
      e2eeGroups: {
        status: "unknown",
        note: gt("We found no group DMs in the client."),
        src: ["client"],
      },
      e2eeCalls: {
        status: "no",
        note: gt("Calls are encrypted on the way to The Port's voice servers, which relay them; the policy says calls are never recorded."),
        src: ["privacy"],
      },
      e2eeCommunity: {
        status: "no",
        note: gt("Server channels are not end-to-end encrypted, so they can be moderated."),
        src: ["privacy"],
      },
      e2eeDefault: {
        status: "partial",
        value: gt("On once both people set it up"),
        note: gt("Your key stays on your device. A 12-word recovery code is the only backup, and the server keeps an encrypted copy it can't open."),
        src: ["privacy", "client"],
      },
      audit: { status: "no", note: gt("No security audit or published code to review.") },
      metadata: {
        value: gt("Sees who talks to whom, and server channels"),
        note: gt("The server stores server-channel messages it can read, encrypted DMs only as ciphertext, plus device type, app version and connection data."),
        src: ["privacy"],
      },
      dataUse: {
        status: "yes",
        value: gt("No selling, no ads, no tracking"),
        note: gt("Data is shared only with hosting, the voice relay, Cloudflare Turnstile at sign-up and Klipy for GIF search, the policy says."),
        src: ["privacy"],
      },
      phone: {
        status: "no",
        value: gt("Not required"),
        src: ["privacy"],
      },
      email: {
        status: "no",
        value: gt("Not required"),
        note: gt("Sign-up is a username, a password and a captcha. With no email there is no way to reset a forgotten password."),
        src: ["privacy", "client"],
      },
      ageChecks: {
        status: "no",
        value: gt("None"),
        note: gt("The terms say you must be old enough to use online services where you live, or have a parent's permission. No age verification."),
        src: ["terms", "privacy"],
      },
      servers: { status: "yes", src: ["client", "home"] },
      roles: { status: "yes", note: gt("Roles and permissions, as on Discord."), src: ["client"] },
      threadsForums: {
        status: "yes",
        note: gt("Forum channels with tags, plus media, tasks and events channels, and ‘ghost’ channels where everyone posts under an alias."),
        src: ["client", "home"],
      },
      onboarding: { status: "unknown", note: gt("We found no onboarding or rules screening.") },
      modTools: {
        status: "partial",
        note: gt("Kicks, bans, an audit log and an automod. Managers can see who posted in a ghost channel when audit is switched on."),
        src: ["client", "home"],
      },
      platformSafety: {
        status: "partial",
        note: gt("Reports to the platform and terms with banned content. No published safety standards or transparency report."),
        src: ["client", "terms"],
      },
      voiceChannels: { status: "yes", note: gt("Voice channels on LiveKit."), src: ["client"] },
      videoScreen: {
        status: "partial",
        note: gt("Screen sharing with a quality setting. We couldn't confirm camera video."),
        src: ["client"],
      },
      streamingStage: { status: "no", note: gt("Screen sharing only; no Stage channels."), src: ["client"] },
      botApi: {
        status: "partial",
        value: gt("No-code only"),
        note: gt("‘Action bots’: pick an event, then what should happen. No developer bot API."),
        src: ["home", "client"],
      },
      discordBots: { status: "no", src: ["client"] },
      discordMigration: {
        status: "no",
        note: gt("We found no import from Discord. Kloak used to import Discord server templates."),
        src: ["client"],
      },
      desktop: {
        status: "partial",
        value: gt("Windows only"),
        note: gt("A Windows app that updates itself; Mac and Linux are listed as coming."),
        src: ["downloads"],
      },
      mobile: {
        status: "notyet",
        value: gt("Coming"),
        note: gt("Android and iPhone apps are listed as on the way."),
        src: ["downloads"],
      },
      web: { status: "yes", src: ["home", "downloads"] },
      license: {
        status: "no",
        value: gt("Proprietary"),
        note: gt("No published source code."),
      },
      selfHost: { status: "no" },
      federation: { status: "no" },
      uploads: {
        value: gt("Images only, 5 MB"),
        note: gt("The client only accepts images as attachments for now, up to 5 MB each."),
        src: ["client"],
      },
      groupSize: { status: "unknown", note: gt("We found no published limits.") },
      scale: {
        status: "unknown",
        value: gt("Not published"),
        note: gt("The Port publishes no user numbers. Kloak had 500+ Android downloads by September 2026."),
        src: ["kloak-play"],
      },
      incidents: {
        value: gt("Follows Kloak's shutdown"),
        note: gt("Kloak shut down between 11 and 15 October 2026, saying it had been under constant attack; its address now leads to The Port."),
        src: ["kloak-oct11", "kloak-now", "redirect"],
      },
    },
    whyUs: [
      {
        title: gt("You know who runs it"),
        text: gt("SerikaCord is run by Serika Company under Dutch law and the GDPR, with published terms and a Trust & Safety team. The Port's policies name no company, person or country."),
        src: ["terms", "privacy"],
      },
      {
        title: gt("Apps everywhere today"),
        text: gt("SerikaCord has apps for Windows, macOS, Linux, Android and iPhone, plus the web. The Port has the web and Windows, with the rest listed as coming."),
        src: ["downloads"],
      },
      {
        title: gt("Encrypted calls and group DMs"),
        text: gt("SerikaCord encrypts DMs, group DMs and their calls end to end. The Port encrypts one-to-one DMs, but its calls go through its servers without end-to-end encryption."),
        src: ["privacy"],
      },
      {
        title: gt("Real bots and a Discord bridge"),
        text: gt("SerikaCord has a bot API compatible with Discord's API v10, video calls and a consent-based Discord bridge. The Port has no-code action bots and no developer API."),
        src: ["home", "client"],
      },
      {
        title: gt("Files, not just images"),
        text: gt("Free SerikaCord accounts can upload any file up to 500 MB. The Port takes images up to 5 MB."),
        src: ["client"],
      },
    ],
    whyThem: [
      {
        title: gt("No email at all"),
        text: gt("The Port only asks for a username and a password. SerikaCord requires an email address."),
        src: ["privacy"],
      },
      {
        title: gt("Ghost channels"),
        text: gt("Any channel can switch to ghost mode, where everyone posts under an alias and managers can still check who posted. SerikaCord has nothing like it."),
        src: ["home"],
      },
      {
        title: gt("Tasks and events channels"),
        text: gt("The Port has task-list and events channel types next to forums and media channels. SerikaCord has forums and ticket channels but no task channels."),
        src: ["client"],
      },
      {
        title: gt("A creator shop"),
        text: gt("People can make and sell avatar decorations and sticker packs in The Port's shop, for an in-app currency rather than money."),
        src: ["client"],
      },
    ],
    pickThem: [
      gt("you want to sign up without giving any email address"),
      gt("you want anonymous ghost channels or task channels in your server"),
      gt("you only use the web or Windows and don't need bots"),
    ],
    pickUs: [
      gt("you want to know which company runs your chat app and under which law"),
      gt("you need apps on Mac, Linux or your phone today"),
      gt("you want encrypted calls and group DMs, not only one-to-one DMs"),
      gt("you want Discord-compatible bots or a bridge to Discord"),
    ],
    faq: [
      {
        question: gt("Is The Port the same as Kloak?"),
        answer: gt("We can't say for certain. Kloak shut down in October 2026, and by November kloak.app showed The Port and redirected to theport.app. The Port has many of Kloak's features, like action bots and media, tasks and events channels, but neither site mentions Kloak or names who runs The Port."),
      },
      {
        question: gt("Is The Port end-to-end encrypted?"),
        answer: gt("Direct messages are, once both people have set up encryption; until then they send as plain text, and the app warns you. Server channels and calls are not end-to-end encrypted. Kloak, by contrast, never shipped end-to-end encryption."),
      },
      {
        question: gt("Can I use my Kloak account on The Port?"),
        answer: gt("We found nothing that says so. The Port's sign-up asks for a new username and password, while Kloak used a generated secret key."),
      },
      {
        question: gt("Who runs The Port?"),
        answer: gt("Its terms and privacy policy don't say. There is no company name, address or country, and the only contact is through the app."),
      },
      {
        question: gt("What happens if I forget my password?"),
        answer: gt("Because The Port doesn't ask for an email, there is no reset link. Keep your password and your 12-word recovery code safe: the code is the only way to read your encrypted DMs on a new device."),
      },
      {
        question: gt("Can I move my server from The Port to SerikaCord?"),
        answer: gt("There is no importer, so you would recreate your channels and roles by hand and invite your members again."),
      },
    ],
    couldNotVerify: [
      gt("Who runs The Port, and whether it's the team behind Kloak."),
      gt("Which country The Port operates from and where its servers are."),
      gt("Whether camera video works in calls, or only voice and screen sharing."),
      gt("How many people use The Port."),
      gt("How The Port pays for itself."),
    ],
    notes: {
      title: gt("From Kloak to The Port"),
      intro: gt("What links The Port to Kloak, and what changed."),
      points: [
        gt("Kloak was a Discord-style app that opened in January 2026 and shut down between 11 and 15 October 2026, saying it had been under constant attack."),
        gt("By November 2026, kloak.app showed The Port and a script on it sent visitors to theport.app."),
        gt("The Port shares Kloak's channel types (media, tasks, events and forums) and its no-code action bots, and also uses LiveKit for voice."),
        gt("What changed: sign-up is now a username and password instead of a secret key, and DMs are end-to-end encrypted. Kloak never shipped encryption, and a founder said in February 2026 that its messages could be read at the database level."),
        gt("Neither The Port's homepage nor its policies mention Kloak."),
      ],
      src: ["kloak-oct11", "kloak-now", "redirect", "client", "privacy", "kloak-founder"],
    },
  };
}

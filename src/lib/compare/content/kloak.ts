import { getGT } from "gt-next/server";
import type { AppContent, CompareSource } from "../types";

/**
 * SerikaCord vs Kloak (kloak.app), which shut down in October 2026. The fact
 * table describes what Kloak offered while it ran. Facts checked on
 * COMPARE_LAST_CHECKED_ISO against the sources below (titles and publishers
 * are proper names, not translated).
 */

export const sources: CompareSource[] = [
  { id: "farewell", title: "Kloak homepage, now a shutdown notice", url: "https://kloak.app/", publisher: "Kloak", kind: "primary", date: "2026-10" },
  { id: "privacy", title: "Kloak Privacy Policy", url: "https://kloak.app/privacy", publisher: "Kloak", kind: "primary" },
  { id: "terms", title: "Kloak Terms of Service", url: "https://kloak.app/terms", publisher: "Kloak", kind: "primary" },
  { id: "faq", title: "Kloak FAQ", url: "https://kloak.app/faq", publisher: "Kloak", kind: "primary" },
  { id: "about", title: "About Kloak", url: "https://kloak.app/about", publisher: "Kloak", kind: "primary" },
  { id: "join", title: "Join the Kloak team (volunteer roles and planned technology)", url: "https://kloak.app/join", publisher: "Kloak", kind: "primary" },
  { id: "child-safety", title: "Kloak Child Safety Standards", url: "https://kloak.app/child-safety", publisher: "Kloak", kind: "primary", date: "2026-07" },
  { id: "client", title: "Kloak web client code (Kloak Prime, upload limits, voice and screen share)", url: "https://kloak.app/assets/AppLayout-B6i9JcmR.js", publisher: "Kloak", kind: "primary" },
  { id: "import", title: "Kloak Discord template import", url: "https://kloak.app/assets/ImportDiscordTemplateModal-DIIr1OCd.js", publisher: "Kloak", kind: "primary" },
  {
    id: "wb-live",
    title: "Kloak homepage, last live capture before shutdown",
    url: "https://web.archive.org/web/20261010114718/https://kloak.app/",
    publisher: "Internet Archive",
    kind: "primary",
    date: "2026-10-10",
  },
  {
    id: "wb-oct11",
    title: "Kloak still running its live app on 11 October 2026",
    url: "https://web.archive.org/web/20261011213154/https://kloak.app/privacy",
    publisher: "Internet Archive",
    kind: "primary",
    date: "2026-10-11",
  },
  {
    id: "play-archive",
    title: "Kloak – Communities & Chat on Google Play (archived)",
    url: "https://web.archive.org/web/20260919225322/https://play.google.com/store/apps/details?id=app.kloak.mobile",
    publisher: "Internet Archive",
    kind: "primary",
    date: "2026-09-19",
  },
  { id: "play", title: "Kloak on Google Play (now removed)", url: "https://play.google.com/store/apps/details?id=app.kloak.mobile", publisher: "Google Play", kind: "primary" },
  {
    id: "show-hn",
    title: "Show HN: Kloak, a privacy-first Discord alternative with no email or passwords",
    url: "https://news.ycombinator.com/item?id=46745164",
    publisher: "Hacker News",
    kind: "primary",
    date: "2026-01-24",
  },
  {
    id: "hn-founder",
    title: "Founder quoted: messages accessible at the database level",
    url: "https://news.ycombinator.com/item?id=46958000",
    publisher: "Hacker News",
    kind: "secondary",
    date: "2026-02-10",
  },
  {
    id: "privacyguides",
    title: "Kloak app (Discord alternative)",
    url: "https://discuss.privacyguides.net/t/kloak-app-discord-alternative/36305",
    publisher: "Privacy Guides forum",
    kind: "secondary",
    date: "2026-03",
  },
  { id: "lemmy", title: "Any one used Kloak yet?", url: "https://pie.gravitywell.xyz/post/92188", publisher: "PieFed", kind: "secondary", date: "2026" },
  { id: "alternativeto", title: "Kloak on AlternativeTo", url: "https://alternativeto.net/software/kloak/about/", publisher: "AlternativeTo", kind: "secondary", date: "2026-02-16" },
  { id: "invisic", title: "Invisic: unofficial desktop client for Kloak", url: "https://github.com/adaster98/invisic-client", publisher: "GitHub", kind: "secondary" },
];

export async function content(): Promise<AppContent> {
  const gt = await getGT();
  return {
    take: gt("Kloak was a Discord-style app that let you sign up with just a secret key, no email. It never shipped end-to-end encryption, and it shut down in October 2026."),
    intro: [
      gt("Kloak was a Discord-style community app run by a small volunteer team. It opened as an early alpha in January 2026, attracted attention during Discord's age-verification backlash with a sign-up that needed no email, phone or password, and shut down between 11 and 15 October 2026."),
      gt("This page explains what Kloak offered while it ran and how SerikaCord compares, for people looking for somewhere new. SerikaCord is still running, has end-to-end encrypted DMs and desktop apps, and is run by a company under Dutch law; Kloak's one clear advantage was signing up without an email address."),
    ],
    verdict: gt("Kloak is no longer available. If you were using it, SerikaCord is a close match in look and features, with encrypted DMs, but it needs an email address to sign up."),
    facts: {
      operator: {
        value: gt("Volunteer team, no company"),
        note: gt("The terms said there was no registered legal entity and described a volunteer team of about 5 people. The Google Play developer was listed as Hedge Studio Labs."),
        src: ["terms", "play-archive"],
      },
      jurisdiction: {
        value: gt("Unclear"),
        note: gt("The Google Play developer address was in Sri Lanka and the team called itself distributed. Data was stored with Supabase on AWS in the EU (West)."),
        src: ["play-archive", "terms", "faq"],
      },
      businessModel: {
        value: gt("Donations"),
        note: gt("Donations and self-funding. The about page said there were no subscriptions, yet the web client contained a Kloak Prime subscription at $6.99 a month."),
        src: ["about", "client"],
      },
      ads: {
        status: "no",
        value: gt("No ads"),
        src: ["about", "client"],
      },
      pricing: {
        value: gt("Was free"),
        note: gt("Kloak Prime ($6.99 a month) in the client code offered 100 MB uploads and better screen share. We couldn't verify how widely it was sold."),
        src: ["client"],
      },
      maturity: {
        status: "no",
        value: gt("Shut down (October 2026)"),
        note: gt("Opened as an early alpha in January 2026 and closed between 11 and 15 October 2026."),
        src: ["farewell", "wb-oct11", "about"],
      },
      e2eeDms: {
        status: "no",
        note: gt("Kloak's FAQ said it was working toward end-to-end encryption, and a founder said messages were technically accessible at the database level."),
        src: ["faq", "hn-founder"],
      },
      e2eeGroups: { status: "no", src: ["faq"] },
      e2eeCalls: {
        status: "no",
        note: gt("Voice ran over standard LiveKit connections; we found no end-to-end encryption set up in the client."),
        src: ["client"],
      },
      e2eeCommunity: { status: "no", src: ["faq"] },
      e2eeDefault: {
        status: "no",
        value: gt("Never shipped"),
        note: gt("Signal Protocol for DMs and Sender Keys for groups were listed as plans on its volunteer page."),
        src: ["join"],
      },
      audit: { status: "no" },
      metadata: {
        value: gt("Kloak could read everything"),
        note: gt("Messages were stored in plain text on the server, per its privacy policy."),
        src: ["privacy"],
      },
      dataUse: {
        status: "partial",
        value: gt("Claimed no selling or analytics"),
        note: gt("Kloak said it never sold data, and we found no analytics in the client. Its Google Play data label said no data was collected, which contradicted its own privacy policy."),
        src: ["privacy", "client", "play-archive"],
      },
      phone: {
        status: "no",
        value: gt("Not required"),
        src: ["privacy"],
      },
      email: {
        status: "no",
        value: gt("Not required"),
        note: gt("Sign-up used a generated 64-character secret key plus a captcha. Losing the key meant losing the account until key rotation was added."),
        src: ["faq", "show-hn"],
      },
      ageChecks: {
        status: "no",
        value: gt("None"),
        note: gt("No age verification of any kind. Minimum age 13, with a parent's permission under 18."),
        src: ["terms", "faq"],
      },
      servers: { status: "yes", src: ["client", "show-hn"] },
      roles: {
        status: "yes",
        note: gt("Discord-like roles and permissions."),
        src: ["client"],
      },
      threadsForums: {
        status: "yes",
        note: gt("Forum channels with threads, plus announcement, media, tasks and calendar channels."),
        src: ["client"],
      },
      onboarding: {
        status: "unknown",
        note: gt("We found no onboarding or rules screening."),
      },
      modTools: {
        status: "partial",
        note: gt("Role permissions, bans, message deletion and an audit log. Kloak said it didn't scan messages with AI."),
        src: ["client", "privacy"],
      },
      platformSafety: {
        status: "partial",
        note: gt("Platform reports, a safety contact and published child safety standards. No transparency report."),
        src: ["privacy", "child-safety"],
      },
      voiceChannels: {
        status: "yes",
        note: gt("Voice channels built on LiveKit."),
        src: ["client"],
      },
      videoScreen: {
        status: "partial",
        note: gt("Screen sharing at 720p or 1080p. Camera code was present, but we couldn't confirm video calls."),
        src: ["client"],
      },
      streamingStage: {
        status: "no",
        note: gt("Screen sharing only; no streaming or Stage channels."),
        src: ["client"],
      },
      botApi: {
        status: "partial",
        value: gt("No-code only"),
        note: gt("No developer bot API; only no-code ‘action bots’ set up in server settings."),
        src: ["client"],
      },
      discordBots: { status: "no", src: ["client"] },
      discordMigration: {
        status: "partial",
        value: gt("Structure only"),
        note: gt("It could import categories, channels and roles from a Discord server template link, but not messages or members."),
        src: ["import"],
      },
      desktop: {
        status: "no",
        note: gt("An official desktop app was ‘coming soon’ and never shipped. An unofficial client, Invisic, existed for Windows and Linux."),
        src: ["about", "invisic"],
      },
      mobile: {
        status: "partial",
        value: gt("Android only (removed)"),
        note: gt("An Android app on Google Play, with 500+ downloads by September 2026; the listing has been removed. No iPhone app."),
        src: ["play-archive", "play"],
      },
      web: {
        status: "partial",
        value: gt("Was the main app"),
        note: gt("The web app was the main way to use Kloak. It now shows only a farewell page."),
        src: ["farewell", "wb-live"],
      },
      license: {
        status: "no",
        value: gt("Proprietary"),
        note: gt("Closed source, with no official code repository."),
        src: ["alternativeto"],
      },
      selfHost: { status: "no" },
      federation: { status: "no" },
      uploads: {
        value: gt("25 MB per file"),
        note: gt("100 MB with Kloak Prime, per the client code."),
        src: ["client"],
      },
      groupSize: {
        status: "unknown",
        note: gt("We found no published limits."),
      },
      scale: {
        status: "unknown",
        value: gt("500+ Android installs"),
        note: gt("Kloak never published user numbers. Google Play showed 500+ downloads in September 2026."),
        src: ["play-archive"],
      },
      incidents: {
        value: gt("Shut down in October 2026"),
        note: gt("Kloak closed between 11 and 15 October 2026, saying it had been under constant attack. A service halt followed by reopened sign-ups was reported around April 2026."),
        src: ["farewell", "wb-oct11", "lemmy"],
      },
    },
    whyUs: [
      {
        title: gt("It's still running"),
        text: gt("SerikaCord is online and actively developed. Kloak shut down in October 2026. We are young and small too, first released in January 2026, so judge us by our track record as it grows."),
        src: ["farewell"],
      },
      {
        title: gt("Encryption that actually shipped"),
        text: gt("SerikaCord's DMs and group DMs, including their calls, are end-to-end encrypted by default for new conversations. Kloak never shipped end-to-end encryption, though some third-party listings said it had. Our encryption is new and not yet audited."),
        src: ["faq", "hn-founder", "alternativeto"],
      },
      {
        title: gt("Someone accountable runs it"),
        text: gt("SerikaCord is run by Serika Company under Dutch law and the GDPR, with published terms and a Trust & Safety team. Kloak's terms said it had no registered legal entity."),
        src: ["terms"],
      },
      {
        title: gt("Desktop apps, bots and a Discord bridge"),
        text: gt("SerikaCord has apps for Windows, macOS and Linux, a bot API compatible with Discord's API v10 and a consent-based Discord bridge. Kloak never shipped an official desktop app and only had no-code ‘action bots’."),
        src: ["about", "client"],
      },
      {
        title: gt("Bigger uploads"),
        text: gt("Free SerikaCord accounts can upload files up to 500 MB. Kloak's free limit was 25 MB."),
        src: ["client"],
      },
    ],
    whyThem: [
      {
        title: gt("No email, phone or password, while it ran"),
        text: gt("Kloak's sign-up was a generated secret key and a captcha, nothing else. SerikaCord requires an email address. This is no longer available, since Kloak has shut down."),
        src: ["faq", "show-hn"],
      },
      {
        title: gt("Teens from 13"),
        text: gt("Kloak allowed users from age 13 with a parent's permission. SerikaCord is 16 and over everywhere."),
        src: ["terms"],
      },
      {
        title: gt("Tasks and calendar channels"),
        text: gt("Kloak had built-in tasks and calendar channel types alongside forums. SerikaCord has forums and ticket channels but no task or calendar channels."),
        src: ["client"],
      },
      {
        title: gt("Plain-language policies"),
        text: gt("Kloak's legal pages were short and written as questions and answers, and its FAQ openly said encryption wasn't there yet."),
        src: ["faq", "privacy"],
      },
    ],
    pickThem: [
      gt("it were still running, which it isn't: Kloak shut down in October 2026"),
      gt("you needed a sign-up with no email at all, which it offered while it ran"),
      gt("you wanted tasks and calendar channels inside a Discord-style app, which it had while it ran"),
    ],
    pickUs: [
      gt("you need a replacement that is still running and actively developed"),
      gt("you want your DMs end-to-end encrypted"),
      gt("you want desktop apps and Discord-compatible bots"),
      gt("you don't mind giving an email address to sign up"),
    ],
    faq: [
      {
        question: gt("Is Kloak still working?"),
        answer: gt("No. Since mid-October 2026 kloak.app shows only a farewell page, and the Android app has been removed from Google Play. The app was still running on 11 October 2026."),
      },
      {
        question: gt("Why did Kloak shut down?"),
        answer: gt("The farewell page says Kloak was attacked relentlessly from day one and that the team spent most of its time defending the service. It doesn't say what the attacks were."),
      },
      {
        question: gt("Can I get my Kloak messages and servers back?"),
        answer: gt("We found no export tool or instructions. The farewell page tells users to save what they want soon, but doesn't say how long data will stay available or what happens to it."),
      },
      {
        question: gt("Was Kloak end-to-end encrypted?"),
        answer: gt("No. Some third-party listings described it as encrypted, but Kloak's own FAQ said it was still working toward end-to-end encryption, and a founder said in February 2026 that messages were technically accessible at the database level."),
      },
      {
        question: gt("What can I use instead of Kloak?"),
        answer: gt("SerikaCord is a close match in look and features, with end-to-end encrypted DMs, but it needs an email address. Other options include Stoat, Fluxer or Matrix, depending on whether open source, self-hosting or federation matters most to you; we compare each on its own page."),
      },
      {
        question: gt("Who ran Kloak?"),
        answer: gt("A small volunteer team of about 5 people, according to its terms, which also said there was no registered legal entity. The Android app was published under the developer name Hedge Studio Labs."),
      },
      {
        question: gt("Can I move my Kloak server to SerikaCord?"),
        answer: gt("There is no Kloak importer, so you would recreate your channels and roles by hand and invite your members again."),
      },
    ],
    couldNotVerify: [
      gt("The exact date and time Kloak shut down; we only know it was between 11 and 15 October 2026."),
      gt("What the attacks Kloak mentioned actually were."),
      gt("Whether user data was exported, kept or deleted after the shutdown."),
      gt("Whether Kloak Prime was ever sold to users, or only existed in the code."),
      gt("How many people used Kloak; only Google Play's 500+ downloads are known."),
    ],
    notes: {
      title: gt("Kloak has shut down"),
      intro: gt("As of 15 October 2026, kloak.app shows only a farewell page. This is what we know and what we don't."),
      points: [
        gt("Archived copies show the app still running on 11 October 2026, and the farewell page was up by 15 October 2026. We found no announcement post with an exact date."),
        gt("The farewell page says Kloak was attacked relentlessly from day one and that the team spent most of its time defending the service. It gives no details about the attacks."),
        gt("It thanks donors and tells users to ‘save it soon’. We found no export tool, shutdown deadline or statement about what happens to stored messages and accounts."),
        gt("The Google Play listing now returns a not-found page."),
        gt("Encryption: AlternativeTo and other listings described Kloak as end-to-end encrypted. Kloak's own FAQ said it was still working toward it, and a founder said in February 2026 that messages were technically accessible at the database level. Privacy Guides forum users pointed out the mismatch in March 2026."),
        gt("Money: Kloak's about page said there were no subscriptions and its terms said it generated no revenue, but its web client contained a Kloak Prime subscription at $6.99 a month with a working checkout."),
      ],
      src: ["farewell", "wb-oct11", "play", "alternativeto", "faq", "hn-founder", "privacyguides", "about", "terms", "client"],
    },
  };
}

import { getGT } from "gt-next/server";
import type { AppContent, CompareSource } from "../types";

/**
 * SerikaCord vs Mumble. Facts checked on COMPARE_LAST_CHECKED_ISO against
 * the sources below (titles and publishers are proper names, not translated).
 */

export const sources: CompareSource[] = [
  { id: "home", title: "Mumble homepage", url: "https://www.mumble.info/", publisher: "Mumble", kind: "primary" },
  { id: "about", title: "About Mumble (team and license)", url: "https://www.mumble.info/about/", publisher: "Mumble", kind: "primary" },
  { id: "downloads", title: "Mumble downloads (macOS note, mobile clients)", url: "https://www.mumble.info/downloads/", publisher: "Mumble", kind: "primary" },
  { id: "sponsors", title: "Mumble sponsors", url: "https://www.mumble.info/sponsors/", publisher: "Mumble", kind: "primary" },
  { id: "privacy", title: "Mumble privacy policy", url: "https://www.mumble.info/privacy/", publisher: "Mumble", kind: "primary" },
  { id: "rc", title: "Mumble 1.6.870 release candidate", url: "https://www.mumble.info/blog/mumble-1.6.870-rc/", publisher: "Mumble", kind: "primary", date: "2026-03-01" },
  { id: "macos", title: "Mumble 1.5.915 (macOS binaries dropped)", url: "https://www.mumble.info/blog/mumble-1.5.915/", publisher: "Mumble", kind: "primary", date: "2026-07-18" },
  { id: "release", title: "Mumble v1.5.939 release", url: "https://github.com/mumble-voip/mumble/releases/tag/v1.5.939", publisher: "GitHub", kind: "primary", date: "2026-10-11" },
  {
    id: "protocol",
    title: "Mumble network protocol overview",
    url: "https://github.com/mumble-voip/mumble/blob/master/docs/dev/network-protocol/overview.md",
    publisher: "GitHub",
    kind: "primary",
  },
  {
    id: "voice-data",
    title: "Mumble network protocol: voice data",
    url: "https://github.com/mumble-voip/mumble/blob/master/docs/dev/network-protocol/voice_data.md",
    publisher: "GitHub",
    kind: "primary",
  },
  {
    id: "server-ini",
    title: "Default Mumble server configuration (mumble-server.ini)",
    url: "https://github.com/mumble-voip/mumble/blob/master/auxiliary_files/mumble-server.ini",
    publisher: "GitHub",
    kind: "primary",
  },
  { id: "ios-app", title: "Mumble on the App Store (version 1.3.1)", url: "https://apps.apple.com/us/app/mumble/id443472808", publisher: "Apple App Store", kind: "primary", date: "2017-09-13" },
  { id: "mumla", title: "Mumla on F-Droid", url: "https://f-droid.org/bo/packages/se.lublin.mumla", publisher: "F-Droid", kind: "secondary" },
  { id: "mumble-web", title: "mumble-web (third-party web client)", url: "https://github.com/Johni0702/mumble-web", publisher: "GitHub", kind: "secondary" },
  { id: "wikipedia", title: "Mumble (software)", url: "https://en.wikipedia.org/wiki/Mumble_(software)", publisher: "Wikipedia", kind: "secondary" },
  { id: "cves", title: "Mumble CVE list", url: "https://www.cvelogic.com/vendor/mumble", publisher: "CVElogic", kind: "secondary" },
  { id: "alternativeto", title: "Mumble: about (non-persistent text chat)", url: "https://alternativeto.net/software/mumble/about/", publisher: "AlternativeTo", kind: "secondary" },
];

export async function content(): Promise<AppContent> {
  const gt = await getGT();
  return {
    take: gt("Free, open-source voice chat with excellent low latency, positional audio and servers you run yourself. But text isn't saved, there's no video or screen sharing, and mobile apps are weak."),
    intro: [
      gt("Mumble is a free, open-source voice chat app made by volunteers since 2005. You run your own server (or join someone else's), and it delivers very low-latency, high-quality voice with fine-grained permissions and positional audio for games. It does voice and little else: text chat isn't saved, and there is no video."),
      gt("Mumble wins on voice latency, openness and control: it is truly open source, free, needs no account and runs anywhere. SerikaCord wins on everything around the voice: saved text, threads and forums, files, video and screen sharing, encrypted DMs, bots, and apps for the browser and Android."),
    ],
    verdict: gt("For a group that mainly talks and wants fast voice on its own open-source server, Mumble is hard to beat. For a complete community app with text, video and phones, pick SerikaCord."),
    facts: {
      operator: {
        value: gt("Volunteer project"),
        note: gt("Built by the Mumble VoIP team, a group of volunteers with no company behind it. First released in 2005."),
        src: ["about", "wikipedia"],
      },
      jurisdiction: {
        value: gt("None (international)"),
        note: gt("No legal entity is named and contributors live in several countries. Your data sits wherever your server's operator hosts it."),
        src: ["about", "privacy"],
      },
      businessModel: {
        value: gt("None (volunteers)"),
        note: gt("No paid plans. Sponsors donate infrastructure such as content delivery and build machines; separate companies sell Mumble hosting."),
        src: ["sponsors"],
      },
      ads: {
        status: "no",
        value: gt("No ads"),
        src: ["about"],
      },
      pricing: {
        value: gt("Free"),
        note: gt("The app and server are free. You only pay for your own hosting, or a hosting company if you use one."),
        src: ["about", "sponsors"],
      },
      maturity: {
        status: "yes",
        value: gt("Since 2005"),
        note: gt("The stable 1.5 series still gets regular releases (1.5.939 in October 2026). Version 1.6 has been a release candidate since March 2026."),
        src: ["wikipedia", "release", "rc"],
      },
      e2eeDms: {
        status: "no",
        note: gt("Text and voice are encrypted between your app and the server, which decrypts and relays them."),
        src: ["protocol"],
      },
      e2eeGroups: {
        status: "no",
        note: gt("Same as above: encrypted to the server, not end to end."),
        src: ["protocol"],
      },
      e2eeCalls: {
        status: "no",
        note: gt("Voice is always encrypted in transit (OCB-AES128 or TLS), but the server can access it."),
        src: ["voice-data", "protocol"],
      },
      e2eeCommunity: {
        status: "no",
        note: gt("Channels are encrypted in transit only, so the server operator can in principle access audio and text."),
        src: ["protocol"],
      },
      e2eeDefault: {
        status: "no",
        value: gt("Transport only"),
        note: gt("Encryption to the server is mandatory and can't be switched off, but end-to-end encryption isn't available."),
        src: ["protocol"],
      },
      audit: {
        status: "no",
        value: gt("None published"),
        note: gt("We found no public independent audit. The code is open for anyone to review."),
        src: ["about"],
      },
      metadata: {
        value: gt("The server operator"),
        note: gt("Whoever runs the server sees who is connected and their IP addresses, and could in principle access audio and text. The Mumble project itself runs no chat service."),
        src: ["privacy", "protocol"],
      },
      dataUse: {
        status: "yes",
        value: gt("No tracking"),
        note: gt("The app only sends opt-in anonymous usage statistics and update checks, which you can switch off in its settings."),
        src: ["privacy"],
      },
      phone: {
        status: "no",
        value: gt("Not required"),
      },
      email: {
        status: "no",
        value: gt("Not required"),
        note: gt("There are no accounts: you connect to a server address, and a certificate on your device identifies you."),
        src: ["wikipedia"],
      },
      ageChecks: {
        status: "no",
        value: gt("No age checks"),
        note: gt("The project sets no minimum age (the iPhone app is rated 4+); each server decides its own rules."),
        src: ["ios-app"],
      },
      servers: {
        status: "yes",
        value: gt("Self-hosted servers"),
        note: gt("Each server has its own tree of channels, including linked and temporary channels."),
        src: ["wikipedia"],
      },
      roles: {
        status: "yes",
        note: gt("Groups and very fine-grained access rules per channel, with inheritance."),
        src: ["wikipedia"],
      },
      threadsForums: {
        status: "no",
        note: gt("No threads or forums. Text isn't saved, so you only see what's said while you're connected."),
        src: ["alternativeto"],
      },
      onboarding: {
        status: "no",
        note: gt("Only a welcome message and a certificate setup wizard."),
      },
      modTools: {
        status: "partial",
        note: gt("Kick, ban, mute, server passwords, registered-users-only servers and a priority speaker."),
        src: ["wikipedia"],
      },
      platformSafety: {
        status: "no",
        value: gt("Up to each server"),
        note: gt("The project runs no service, so there is no central safety team or reporting; each server's operator is responsible."),
        src: ["privacy"],
      },
      voiceChannels: {
        status: "yes",
        value: gt("Excellent"),
        note: gt("Low-latency Opus voice with push-to-talk, whispering to other channels, positional audio for many games and an in-game overlay."),
        src: ["wikipedia", "home"],
      },
      videoScreen: {
        status: "no",
        note: gt("No video calls or screen sharing."),
        src: ["alternativeto"],
      },
      streamingStage: {
        status: "no",
        note: gt("No streaming. A priority speaker and channel permissions can approximate a stage."),
      },
      botApi: {
        status: "partial",
        value: gt("Server API, no bot platform"),
        note: gt("Third-party bots exist, such as music bots, and servers offer an admin API (ZeroC Ice) for automation."),
        src: ["server-ini", "wikipedia"],
      },
      discordBots: {
        status: "no",
        note: gt("Nothing compatible with Discord's bot API."),
      },
      discordMigration: {
        status: "no",
        note: gt("No official bridge or importer."),
      },
      desktop: {
        status: "partial",
        value: gt("Mac stuck on 1.5.901"),
        note: gt("Windows and Linux are current. Since July 2026 the project can't build newer 1.5 releases for macOS, so Mac users stay on 1.5.901 until 1.6 ships."),
        src: ["macos", "downloads"],
      },
      mobile: {
        status: "partial",
        value: gt("Old iOS app; Android third-party"),
        note: gt("The official iPhone app is version 1.3.1 from 2017. On Android you use third-party apps such as Mumla."),
        src: ["ios-app", "mumla", "downloads"],
      },
      web: {
        status: "no",
        note: gt("No official web app; a third-party one hasn't been updated since May 2023."),
        src: ["mumble-web"],
      },
      license: {
        status: "yes",
        value: gt("BSD-3-Clause (open source)"),
        note: gt("Free to use, change and redistribute, including commercially."),
        src: ["about"],
      },
      selfHost: {
        status: "yes",
        value: gt("The only way to use it"),
        note: gt("A lightweight server runs on Windows, macOS, Linux and Docker, and you can list it in the public server directory."),
        src: ["downloads"],
      },
      federation: {
        status: "no",
        note: gt("Each server is independent; a public directory lists registered servers."),
        src: ["wikipedia"],
      },
      uploads: {
        value: gt("No file sharing"),
        note: gt("Images can be pasted into messages up to a size the server sets (1 MiB in the default configuration)."),
        src: ["server-ini"],
      },
      groupSize: {
        value: gt("Set by the server"),
        note: gt("The default configuration allows 100 users per server, and operators can raise it."),
        src: ["server-ini"],
      },
      scale: {
        status: "unknown",
        value: gt("Unknown"),
        note: gt("The project publishes no user numbers."),
      },
      incidents: {
        value: gt("Bug fixes, macOS gap"),
        note: gt("A client crash bug (CVE-2025-71264) was fixed in 1.6.870 in March 2026. In July 2026 the project stopped shipping macOS builds for the 1.5 series."),
        src: ["cves", "macos"],
      },
    },
    whyUs: [
      {
        title: gt("Text that's saved"),
        text: gt("SerikaCord keeps text channels with history, search, threads, forums and files of up to 500 MB. Mumble's text isn't saved, so you miss anything said while you were away, and it has no file sharing."),
        src: ["alternativeto"],
      },
      {
        title: gt("Video and screen sharing"),
        text: gt("SerikaCord has video calls and screen sharing at up to 60 FPS. Mumble has neither."),
        src: ["alternativeto"],
      },
      {
        title: gt("No server to run"),
        text: gt("On SerikaCord you sign up and create a server in a minute. With Mumble someone has to run or rent a server, and newcomers deal with server addresses and certificates."),
        src: ["wikipedia"],
      },
      {
        title: gt("Encrypted DMs"),
        text: gt("SerikaCord's DMs, group DMs and their calls are end-to-end encrypted by default. On Mumble, whoever runs the server can in principle access everything. Our encryption is new and unaudited, and if you run your own Mumble server, the operator is you."),
        src: ["protocol"],
      },
      {
        title: gt("Browser and Android apps"),
        text: gt("SerikaCord works fully in the browser and has an Android app. Mumble has no official web app, its iPhone app dates from 2017, and Android users rely on third-party apps. We don't have an iPhone app yet either."),
        src: ["ios-app", "mumla", "mumble-web"],
      },
      {
        title: gt("Bots and a Discord bridge"),
        text: gt("SerikaCord has a bot API that follows Discord's and a consent-based bridge to a Discord server. Mumble has an admin API and a few third-party bots."),
        src: ["server-ini"],
      },
    ],
    whyThem: [
      {
        title: gt("Excellent low-latency voice"),
        text: gt("Mumble's Opus voice is fast, clear and light on your computer, and it has been refined for 20 years. Large gaming groups rely on it for coordinated play. SerikaCord's calls connect peer-to-peer where possible, which shows your IP address to others in the call and gets heavy in large calls."),
        src: ["wikipedia", "home"],
      },
      {
        title: gt("Positional audio and whispering"),
        text: gt("Mumble can place voices in 3D to match where players are in many games, and lets you whisper to people or other channels. SerikaCord has nothing like that."),
        src: ["wikipedia"],
      },
      {
        title: gt("Truly open source, and yours"),
        text: gt("Mumble is under the BSD license: anyone can run, change and redistribute it, including commercially, and the server runs anywhere. SerikaCord's code is source-available, not open source, and self-hosting is allowed only for personal, non-commercial use."),
        src: ["about"],
      },
      {
        title: gt("No account, email or phone"),
        text: gt("Mumble identifies you with a certificate on your device, with no sign-up at all. SerikaCord needs an account with an email address."),
        src: ["wikipedia"],
      },
      {
        title: gt("No company, no business model"),
        text: gt("Mumble is made by volunteers and has nothing to sell; your data is only on the server you choose. SerikaCord is run by a company and you trust our servers."),
        src: ["about", "privacy"],
      },
    ],
    pickThem: [
      gt("you want the lowest-latency voice and positional audio for games"),
      gt("you want open-source software you fully control on your own server"),
      gt("your group mostly talks and doesn't need saved text or video"),
      gt("you don't want to create an account anywhere"),
    ],
    pickUs: [
      gt("you want saved text, files, threads and forums alongside voice"),
      gt("you need video calls or screen sharing"),
      gt("you don't want to run or rent a server"),
      gt("you want end-to-end encrypted DMs, a web app and an Android app"),
    ],
    faq: [
      {
        question: gt("Is Mumble end-to-end encrypted?"),
        answer: gt("No. Mumble always encrypts voice and text between your app and the server, and you can't turn that off, but the server decrypts and relays everything. If you run the server yourself, that operator is you."),
      },
      {
        question: gt("Is Mumble free and open source?"),
        answer: gt("Yes. Mumble is free and open source under a BSD license, made by volunteers. You run your own server or join someone else's."),
      },
      {
        question: gt("Does Mumble keep chat history?"),
        answer: gt("No. Text in Mumble isn't saved, so you only see messages sent while you're connected, and there is no file sharing."),
      },
      {
        question: gt("Does Mumble work on iPhone, Android and Mac?"),
        answer: gt("Partly. The official iPhone app is from 2017, Android users rely on third-party apps such as Mumla, and Mac users are on version 1.5.901 until 1.6 is released."),
      },
      {
        question: gt("Who makes Mumble?"),
        answer: gt("A team of volunteers, with no company behind it. It was first released in 2005, and sponsors donate hosting and build machines."),
      },
      {
        question: gt("Can I move my Discord server to Mumble?"),
        answer: gt("Not directly: there is no official bridge or importer, and Mumble has no text channels with history. SerikaCord has a consent-based bridge to a Discord server and a bot API that follows Discord's."),
      },
      {
        question: gt("Can I host SerikaCord myself?"),
        answer: gt("Yes, but only for personal, non-commercial use for yourself and people you invite, free for them and not open to public sign-up; commercial use needs a license from partners@serika.dev. Self-hosted instances don't connect to serika.chat, there is no official setup guide or support, and SerikaCord is not open source."),
      },
    ],
    couldNotVerify: [
      gt("How many people use Mumble: the project publishes no numbers."),
      gt("Any independent security audit of Mumble."),
      gt("When Mumble 1.6 will be released in final form."),
      gt("Whether a new iPhone app is coming; the iOS code saw changes in September 2026, but no new App Store release."),
      gt("Which third-party Discord bridges for Mumble exist and still work."),
    ],
  };
}

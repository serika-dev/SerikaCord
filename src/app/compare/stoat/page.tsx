import { getGT, getLocale } from "gt-next/server";
import { buildMetadata } from "@/lib/seo";
import { JsonLd } from "@/components/seo/JsonLd";
import {
  Breadcrumbs,
  CompareCta,
  CompareShell,
  ComparisonTable,
  FaqList,
  PageHeader,
  PickCards,
  PointList,
  Section,
  SourceList,
  StatusLegend,
  type CompareRow,
} from "@/components/compare/CompareParts";
import { compareArticleJsonLd, faqJsonLd, formatCompareDate, type CompareFaqItem, type CompareSource } from "@/lib/compare";

const DESCRIPTION =
  "An honest comparison of SerikaCord and Stoat (formerly Revolt): open source and self-hosting, encryption, apps, voice and video, bots and privacy. Where each one is better, with sources.";

export const metadata = buildMetadata({
  title: "SerikaCord vs Stoat (formerly Revolt): an honest comparison",
  description: DESCRIPTION,
  path: "/compare/stoat",
  type: "article",
  keywords: [
    "SerikaCord vs Stoat",
    "SerikaCord vs Revolt",
    "Stoat chat",
    "Revolt chat",
    "Stoat vs Discord",
    "open source Discord alternative",
    "self-hosted Discord alternative",
  ],
});

/**
 * Checked on COMPARE_LAST_CHECKED_ISO (src/lib/compare.ts). Titles and
 * publishers are proper names and are not translated.
 */
const SOURCES: CompareSource[] = [
  { title: "stoatchat organisation (formerly Revolt)", url: "https://github.com/stoatchat", publisher: "GitHub" },
  { title: "Stoat migration guide", url: "https://developers.stoat.chat/developers/stoat-migration-guide", publisher: "Stoat" },
  { title: "Stoat (software)", url: "https://en.wikipedia.org/wiki/Stoat_(software)", publisher: "Wikipedia" },
  { title: "Revolt is Stoat now", url: "https://automod.vale.rocks/blog/revolt-is-stoat-now", publisher: "AutoMod" },
  { title: "stoatchat backend repository and license", url: "https://github.com/stoatchat/stoatchat", publisher: "GitHub" },
  { title: "Stoat self-hosted (Docker Compose)", url: "https://github.com/stoatchat/self-hosted", publisher: "GitHub" },
  { title: "Stoat developer FAQ", url: "https://developers.stoat.chat/faq", publisher: "Stoat" },
  { title: "End-to-end encryption discussion, issue #1009 (Sep 2026)", url: "https://github.com/stoatchat/stoatchat/issues/1009", publisher: "GitHub" },
  { title: "Download Stoat", url: "https://stoat.chat/download", publisher: "Stoat" },
  { title: "Stoat on iOS", url: "https://stoat.chat/download/ios", publisher: "Stoat" },
  { title: "Android early access", url: "https://stoat.chat/updates/android-early-access", publisher: "Stoat" },
  { title: "Web 0.0.13: Voice Chats v2 (23 Oct 2025)", url: "https://stoat.chat/updates/web-0013", publisher: "Stoat" },
  { title: "Stoat web client releases", url: "https://github.com/stoatchat/for-web/releases", publisher: "GitHub" },
  { title: "Celebrating one million (29 Mar 2026)", url: "https://stoat.chat/updates/celebrating-one-million", publisher: "Stoat" },
  { title: "Stoat Privacy Policy (30 Jun 2026)", url: "https://stoat.chat/legal/privacy", publisher: "Stoat" },
  { title: "Minimum age guidelines", url: "https://support.stoat.chat/kb/safety/minimum-age-guidelines", publisher: "Stoat" },
  { title: "Stoat API authentication", url: "https://developers.stoat.chat/developers/api/authentication", publisher: "Stoat" },
  { title: "SerikaCord Privacy Policy", url: "https://serika.chat/privacy", publisher: "SerikaCord" },
  { title: "SerikaCord end-to-end encryption design and known limitations", url: "https://github.com/serika-dev/SerikaCord/blob/main/docs/architecture/e2ee.md", publisher: "GitHub" },
  { title: "SerikaCord Source Available License", url: "https://github.com/serika-dev/SerikaCord/blob/main/LICENSE", publisher: "GitHub" },
  { title: "SerikaCord developer documentation", url: "https://serika.chat/developers/docs/intro", publisher: "SerikaCord" },
];

export default async function CompareStoatPage() {
  const gt = await getGT();
  const locale = await getLocale();
  const checked = formatCompareDate(locale);

  const rows: CompareRow[] = [
    {
      feature: gt("Free to use"),
      values: [
        { status: "yes", note: gt("Optional Serika+ subscription for extras.") },
        { status: "yes", note: gt("Funded by donations. We found no paid plan.") },
      ],
    },
    {
      feature: gt("Open source"),
      values: [
        { status: "partial", note: gt("Source-available: the code is public on GitHub, but the license is not an open-source license.") },
        { status: "yes", note: gt("AGPL-3.0 for the server and apps.") },
      ],
    },
    {
      feature: gt("Host it yourself"),
      values: [
        { status: "no", note: gt("Our license doesn't allow running your own copy without permission.") },
        { status: "yes", note: gt("Official Docker setup. Most official apps don't connect to self-hosted servers yet, so those use the web app.") },
      ],
    },
    {
      feature: gt("End-to-end encrypted DMs and group DMs"),
      values: [
        { status: "yes", note: gt("Launched October 2026, on by default for new conversations. Not independently audited yet.") },
        { status: "notyet", note: gt("Not available. The team has said it plans to build it on the MLS standard.") },
      ],
    },
    {
      feature: gt("End-to-end encrypted calls"),
      values: [
        { status: "partial", note: gt("DM and group DM calls only, not server voice channels.") },
        { status: "unknown", note: gt("We couldn't find a statement either way.") },
      ],
    },
    {
      feature: gt("Voice channels"),
      values: [{ status: "yes" }, { status: "yes", note: gt("Rebuilt in October 2025.") }],
    },
    {
      feature: gt("Video calls and screen sharing"),
      values: [{ status: "yes" }, { status: "yes", note: gt("Added to the web app during 2026.") }],
    },
    {
      feature: gt("Threads, forum channels and polls"),
      values: [{ status: "yes" }, { status: "unknown", note: gt("We couldn't verify this from Stoat's own documentation.") }],
    },
    {
      feature: gt("Web app and Windows, macOS, Linux apps"),
      values: [
        { status: "yes", note: gt("The macOS app needs a Mac with Apple silicon.") },
        { status: "yes" },
      ],
    },
    {
      feature: gt("Android app"),
      values: [
        { status: "yes" },
        { status: "partial", note: gt("Early access on Google Play.") },
      ],
    },
    {
      feature: gt("iPhone and iPad app"),
      values: [
        { status: "notyet", note: gt("In development. Use the web app from your Home Screen meanwhile.") },
        { status: "notyet", note: gt("A native app is in the works. Use the web app from your Home Screen meanwhile.") },
      ],
    },
    {
      feature: gt("Discord-compatible bot API"),
      values: [
        { status: "yes", note: gt("Modelled on Discord's API v10. Not everything Discord offers is covered.") },
        { status: "no", note: gt("Stoat has its own bot API, so Discord bots need rewriting.") },
      ],
    },
    {
      feature: gt("Bridge to a Discord server"),
      values: [
        { status: "yes", note: gt("Built in and consent-based.") },
        { status: "unknown", note: gt("We couldn't find an official bridge.") },
      ],
    },
    {
      feature: gt("No ads"),
      values: [
        { status: "yes", note: gt("No ads and no advertising trackers, according to our Privacy Policy.") },
        { status: "unknown", note: gt("Stoat is donation-funded, but its privacy policy doesn't mention ads or trackers, so we couldn't confirm it.") },
      ],
    },
  ];

  const stoatBetter = [
    {
      title: gt("Truly open source"),
      text: gt("Stoat's server and apps are licensed under the AGPL-3.0, an open-source license. SerikaCord's code is public, but under a source-available license that doesn't let you reuse it, run it or build on it without our permission."),
    },
    {
      title: gt("You can host it yourself"),
      text: gt("Stoat publishes an official Docker setup, so a community can run its own server. SerikaCord can't be self-hosted. Note that Stoat instances don't federate with each other, and most official Stoat apps don't connect to self-hosted servers yet."),
    },
    {
      title: gt("A longer track record and a bigger community"),
      text: gt("Stoat started as Revolt in 2021 and passed one million registered users in March 2026. SerikaCord's first release was in January 2026, and our community is much smaller."),
    },
    {
      title: gt("Younger users can join"),
      text: gt("Stoat's minimum age is 13 in most countries. SerikaCord requires everyone to be 16 or older, so it isn't an option for younger teens."),
    },
  ];

  const serikaBetter = [
    {
      title: gt("End-to-end encrypted direct messages today"),
      text: gt("SerikaCord's DMs and group DMs, including files and calls, are end-to-end encrypted by default for new conversations. Stoat doesn't offer end-to-end encryption yet. Ours is new (October 2026) and hasn't been independently audited."),
    },
    {
      title: gt("Your Discord bots and server can come along"),
      text: gt("SerikaCord's bot API follows Discord's, so many existing Discord bots can connect with a configuration change. A consent-based bridge mirrors messages between Discord and SerikaCord while your community moves. On Stoat, bots have to be rewritten for its own API."),
    },
    {
      title: gt("Closer to Discord, feature for feature"),
      text: gt("Threads, forum channels, polls, server onboarding and screening questions, verification levels, a full audit log and Discord-style permissions are all built in, so people coming from Discord find what they expect."),
    },
    {
      title: gt("An Android app out of early access"),
      text: gt("SerikaCord's Android app is a regular release, downloaded from our website, with push notifications and full-screen incoming calls. Stoat's Android app is in early access on Google Play. Neither has an iOS app yet."),
    },
    {
      title: gt("EU-based"),
      text: gt("SerikaCord is run from the Netherlands under the GDPR. Stoat is run by Revolt Platforms Ltd in London, England, and says it stores data on cloud servers in the EU and possibly the UK."),
    },
  ];

  const pick = [
    {
      title: gt("Stoat is the better pick if…"),
      points: [
        gt("open-source software matters to you, or you want to host your own server"),
        gt("you want a project with a longer track record and a larger user base"),
        gt("some of your members are 13 to 15 years old"),
      ],
    },
    {
      title: gt("SerikaCord is the better pick if…"),
      points: [
        gt("you want end-to-end encrypted DMs right now"),
        gt("you're moving from Discord and want to keep your bots, or bridge your server during the move"),
        gt("you want an app that works as much like Discord as possible"),
      ],
    },
  ];

  const faq: CompareFaqItem[] = [
    {
      question: gt("Are Stoat and Revolt the same thing?"),
      answer: gt("Yes. Revolt renamed itself Stoat in October 2025 and moved from revolt.chat to stoat.chat. Press reports say the name had to change after a dispute over the old name; we couldn't verify the official announcement, which no longer loads."),
    },
    {
      question: gt("Is SerikaCord open source?"),
      answer: gt("Not in the strict sense. Anyone can read SerikaCord's code on GitHub and contribute to it, but it uses a source-available license that doesn't allow running your own copy or reusing the code without permission. Stoat is open source under the AGPL-3.0."),
    },
    {
      question: gt("Does Stoat have end-to-end encryption?"),
      answer: gt("Not as of our last check. It's an open topic on Stoat's issue tracker, where the team said in September 2026 that it plans to implement it with OpenMLS."),
    },
    {
      question: gt("Can I host SerikaCord myself?"),
      answer: gt("No. SerikaCord only runs as the hosted service at serika.chat. If self-hosting is a must, Stoat is the better choice."),
    },
    {
      question: gt("Who runs each service?"),
      answer: gt("SerikaCord is run by Serika Company in the Netherlands. Stoat is run by Revolt Platforms Ltd, a company registered in England and Wales, which says it is funded by donations and has no outside investors."),
    },
    {
      question: gt("Can I use Discord bots on Stoat or SerikaCord?"),
      answer: gt("On SerikaCord, often yes: its API follows Discord's API v10, and discord.js or discord.py bots can be pointed at it. Stoat has its own bot API, so Discord bots need to be rewritten."),
    },
  ];

  return (
    <CompareShell>
      <JsonLd
        data={compareArticleJsonLd({
          path: "/compare/stoat",
          headline: "SerikaCord vs Stoat (formerly Revolt): an honest comparison",
          description: DESCRIPTION,
          breadcrumbName: "SerikaCord vs Stoat",
          inLanguage: locale,
        })}
      />
      <JsonLd data={faqJsonLd(faq)} />
      <Breadcrumbs items={[{ href: "/", label: gt("Home") }, { href: "/compare", label: gt("Compare") }, { label: "Stoat" }]} />

      <PageHeader
        eyebrow={gt("Comparison")}
        title={gt("SerikaCord vs Stoat (formerly Revolt)")}
        intro={
          <>
            <p>{gt("Stoat, called Revolt until October 2025, is one of the best-known alternatives to Discord: open source, self-hostable and funded by donations. SerikaCord is a younger alternative that sticks closer to Discord, works with Discord bots and already has end-to-end encrypted DMs, but it is not open source.")}</p>
            <p>{gt("In short: if open source or running your own server matters most, pick Stoat. If you're moving a community from Discord and want encrypted DMs today, SerikaCord is a good fit.")}</p>
          </>
        }
        meta={
          <>
            <span>{gt("Last checked: {date}", { date: checked })}</span>
            <span>{gt("Written by the SerikaCord team")}</span>
          </>
        }
      />

      <Section
        id="features"
        title={gt("Feature by feature")}
        intro={<p>{gt("What each app offers today. Where we couldn't confirm something about Stoat from a reliable source, the table says so.")}</p>}
      >
        <ComparisonTable columns={["SerikaCord", "Stoat"]} rows={rows} caption={gt("SerikaCord and Stoat features compared")} />
        <StatusLegend />
      </Section>

      <Section id="stoat-better" title={gt("Where Stoat is better")}>
        <PointList points={stoatBetter} />
      </Section>

      <Section id="serikacord-better" title={gt("Where SerikaCord is better")}>
        <PointList points={serikaBetter} />
      </Section>

      <Section
        id="caveats"
        title={gt("Things to know about SerikaCord")}
        intro={<p>{gt("A few honest caveats before you move a community:")}</p>}
      >
        <ul className="max-w-3xl list-disc space-y-2 pl-5 text-sm leading-relaxed text-[var(--app-muted)]">
          <li>{gt("SerikaCord is young and made by a small team, so expect rough edges and fewer public communities.")}</li>
          <li>{gt("End-to-end encryption covers DMs, group DMs and their calls, not server channels. It is new and hasn't been independently audited.")}</li>
          <li>{gt("Calls connect peer-to-peer when possible, so other people in a call can see your IP address.")}</li>
          <li>{gt("We use AI coding assistants to help build SerikaCord. AI moderation tools for servers are in development and will be optional.")}</li>
        </ul>
      </Section>

      <Section id="who" title={gt("Who should pick which")}>
        <PickCards cards={pick} />
      </Section>

      <Section id="faq" title={gt("Frequently asked questions")}>
        <FaqList items={faq} />
      </Section>

      <Section id="sources" title={gt("Sources")}>
        <SourceList
          sources={SOURCES}
          note={
            <p>
              {gt("We checked every source below on {date}. Facts about SerikaCord come from our own policies, documentation and code. Stoat and Revolt are names of their respective owners.", { date: checked })}
            </p>
          }
        />
      </Section>

      <CompareCta />
    </CompareShell>
  );
}

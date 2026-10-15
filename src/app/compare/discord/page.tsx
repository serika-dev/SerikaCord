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
  "An honest comparison of SerikaCord and Discord: features, apps, encryption, privacy, ads and bots. Where Discord is better, where SerikaCord is better, and who should pick which, with sources.";

export const metadata = buildMetadata({
  title: "SerikaCord vs Discord: an honest comparison",
  description: DESCRIPTION,
  path: "/compare/discord",
  type: "article",
  keywords: [
    "SerikaCord vs Discord",
    "Discord alternative",
    "Discord alternative EU",
    "Discord alternative without ads",
    "end-to-end encrypted Discord alternative",
    "Discord compatible bots",
    "move Discord server",
  ],
});

/**
 * Checked on COMPARE_LAST_CHECKED_ISO (src/lib/compare.ts). Titles and
 * publishers are proper names and are not translated.
 */
const SOURCES: CompareSource[] = [
  { title: "Every voice and video call on Discord is now end-to-end encrypted (18 May 2026)", url: "https://discord.com/blog/every-voice-and-video-call-on-discord-is-now-end-to-end-encrypted", publisher: "Discord" },
  { title: "Meet DAVE: Discord's new end-to-end encryption for audio & video (17 Sep 2024)", url: "https://discord.com/blog/meet-dave-e2ee-for-audio-video", publisher: "Discord" },
  { title: "Safer for teens, same Discord for adults (22 Sep 2026)", url: "https://discord.com/blog/safer-for-teens-same-discord-for-adults", publisher: "Discord" },
  { title: "Discord launches teen-by-default settings globally (9 Feb 2026)", url: "https://discord.com/press-releases/discord-launches-teen-by-default-settings-globally", publisher: "Discord" },
  { title: "Update on a security incident involving a third-party customer service provider (Oct 2025)", url: "https://discord.com/press-releases/update-on-security-incident-involving-third-party-customer-service", publisher: "Discord" },
  { title: "Announcing Quests advertising on mobile (20 Mar 2025)", url: "https://discord.com/press-releases/announcing-quests-advertising-on-mobile", publisher: "Discord" },
  { title: "Discord opens advertising to brands of all sizes with Ads Manager and Video Quests (29 Sep 2026)", url: "https://discord.com/press-releases/discord-opens-advertising-to-brands-of-all-sizes-with-ads-manager-and-video-quests", publisher: "Discord" },
  { title: "Beginner's guide to Nitro", url: "https://discord.com/blog/beginners-guide-to-nitro", publisher: "Discord" },
  { title: "Download Discord", url: "https://discord.com/download", publisher: "Discord" },
  { title: "Discord Terms of Service", url: "https://discord.com/terms", publisher: "Discord" },
  { title: "Discord Privacy Policy", url: "https://discord.com/privacy", publisher: "Discord" },
  { title: "About Discord (company facts)", url: "https://discord.com/company", publisher: "Discord" },
  { title: "Activities overview (developer docs)", url: "https://discord.com/developers/docs/activities/overview", publisher: "Discord" },
  { title: "Discord raises free upload limit to 20MB (13 Aug 2026)", url: "https://www.dexerto.com/entertainment/discord-raises-free-upload-limit-to-20mb-after-lowering-it-two-years-ago-3398251/", publisher: "Dexerto" },
  { title: "SerikaCord Privacy Policy", url: "https://serika.chat/privacy", publisher: "SerikaCord" },
  { title: "SerikaCord Terms of Service", url: "https://serika.chat/terms", publisher: "SerikaCord" },
  { title: "SerikaCord end-to-end encryption design and known limitations", url: "https://github.com/serika-dev/SerikaCord/blob/main/docs/architecture/e2ee.md", publisher: "GitHub" },
  { title: "SerikaCord Source Available License", url: "https://github.com/serika-dev/SerikaCord/blob/main/LICENSE", publisher: "GitHub" },
  { title: "SerikaCord developer documentation", url: "https://serika.chat/developers/docs/intro", publisher: "SerikaCord" },
];

export default async function CompareDiscordPage() {
  const gt = await getGT();
  const locale = await getLocale();
  const checked = formatCompareDate(locale);

  const rows: CompareRow[] = [
    {
      feature: gt("Free to use"),
      values: [
        { status: "yes", note: gt("Optional Serika+ subscription for extras.") },
        { status: "yes", note: gt("Optional Nitro subscription (in the US: Nitro Basic $2.99 a month, Nitro $9.99 a month).") },
      ],
    },
    {
      feature: gt("Servers, roles and channel permissions"),
      values: [{ status: "yes" }, { status: "yes" }],
    },
    {
      feature: gt("Threads, forum channels and polls"),
      values: [{ status: "yes" }, { status: "yes" }],
    },
    {
      feature: gt("Voice and video calls, screen sharing"),
      values: [
        { status: "yes", note: gt("Calls connect directly between participants when possible (peer-to-peer), which suits smaller groups best.") },
        { status: "yes" },
      ],
    },
    {
      feature: gt("Stage channels (speakers and audience)"),
      values: [{ status: "notyet" }, { status: "yes" }],
    },
    {
      feature: gt("Activities (games and apps inside calls)"),
      values: [{ status: "no" }, { status: "yes" }],
    },
    {
      feature: gt("End-to-end encrypted text in DMs and group DMs"),
      values: [
        { status: "yes", note: gt("Launched October 2026, on by default for new conversations. Not independently audited yet.") },
        { status: "no", note: gt("Discord says it has no current plans to bring end-to-end encryption to text messages.") },
      ],
    },
    {
      feature: gt("End-to-end encrypted calls"),
      values: [
        { status: "partial", note: gt("DM and group DM calls only. Server voice channels are not end-to-end encrypted.") },
        { status: "yes", note: gt("DMs, group DMs, voice channels and Go Live streams, by default since March 2026. Stage channels are the exception.") },
      ],
    },
    {
      feature: gt("End-to-end encrypted server channels"),
      values: [
        { status: "no", note: gt("Message content is encrypted when stored on our servers, but we can technically read it, so bots, search and moderation work.") },
        { status: "no" },
      ],
    },
    {
      feature: gt("No ads or sponsored content"),
      values: [
        { status: "yes", note: gt("No ads and no advertising trackers, according to our Privacy Policy.") },
        { status: "no", note: gt("Sponsored Quests, including video Quests, and an Ads Manager for brands.") },
      ],
    },
    {
      feature: gt("Bot API and gateway"),
      values: [
        { status: "yes", note: gt("Modelled on Discord's API v10: many discord.js and discord.py bots can connect by changing the API address. Not everything Discord offers is covered.") },
        { status: "yes", note: gt("The largest bot and app ecosystem by far.") },
      ],
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
      values: [{ status: "yes" }, { status: "yes" }],
    },
    {
      feature: gt("iPhone and iPad app"),
      values: [
        { status: "notyet", note: gt("In development. Until then, use the web app and add it to your Home Screen.") },
        { status: "yes" },
      ],
    },
    {
      feature: gt("Game consoles"),
      values: [{ status: "no" }, { status: "yes" }],
    },
    {
      feature: gt("Free file uploads"),
      values: [
        { status: "yes", note: gt("Up to 500 MB per file (2 GB with Serika+).") },
        { status: "partial", note: gt("Up to 20 MB per file (more with Nitro).") },
      ],
    },
    {
      feature: gt("Source code you can read"),
      values: [
        { status: "partial", note: gt("Source-available: anyone can read it on GitHub, but the license is not open source and doesn't allow running your own copy without permission.") },
        { status: "no" },
      ],
    },
  ];

  const discordBetter = [
    {
      title: gt("Your friends are already there"),
      text: gt("Discord says it has more than 200 million monthly active users. On SerikaCord you will probably have to invite people over, and there are far fewer public communities to discover. For most communities this matters more than any feature."),
    },
    {
      title: gt("More polish, more features"),
      text: gt("Discord has been building its app since 2015 with a large team. SerikaCord is young and made by a small team: you will run into rough edges and bugs, and some things Discord has, like Stage channels, Activities and console apps, don't exist here yet."),
    },
    {
      title: gt("An iPhone and iPad app"),
      text: gt("Discord has native apps on every major platform, including iOS. SerikaCord's iOS app is still in development, so iPhone users have to use the web app for now."),
    },
    {
      title: gt("A huge bot ecosystem"),
      text: gt("Thousands of established bots and apps are built for Discord. SerikaCord can run many Discord bots, but only if their owners point them at SerikaCord, and our API doesn't cover everything yet."),
    },
    {
      title: gt("Encrypted calls everywhere, not just in DMs"),
      text: gt("Discord encrypts voice and video end to end in server voice channels and Go Live streams too. SerikaCord only does this for DM and group DM calls."),
    },
    {
      title: gt("Scale and reliability"),
      text: gt("Discord runs very large servers and voice channels on its own global infrastructure. SerikaCord runs on a much smaller setup and hasn't been tested at that scale. Our calls connect peer-to-peer when possible, which means other people in a call can see your IP address, and large group video calls get heavy."),
    },
  ];

  const serikaBetter = [
    {
      title: gt("No ads, no advertising trackers"),
      text: gt("SerikaCord doesn't show ads, doesn't use advertising trackers and doesn't sell your data. Discord shows sponsored Quests and is expanding its advertising business."),
    },
    {
      title: gt("End-to-end encrypted direct messages"),
      text: gt("DMs and group DMs, including their text, files and calls, are end-to-end encrypted by default for new conversations, with safety numbers to check who you're talking to and a recovery passphrase for new devices. Discord encrypts calls but not text. Our encryption is new (October 2026) and hasn't been independently audited yet."),
    },
    {
      title: gt("Based in the EU"),
      text: gt("SerikaCord is run by Serika Company in the Netherlands, under the GDPR and Dutch law, and you can complain to the Dutch data protection authority. Discord is a US company headquartered in San Francisco, with an EU entity in the Netherlands."),
    },
    {
      title: gt("No ID or face scans"),
      text: gt("SerikaCord asks for your date of birth and requires you to be 16 or older. It doesn't ask for ID documents or selfies. Discord now sorts accounts into adults and teens and may ask some people to prove their age, for example with a selfie or ID. In October 2025 Discord reported that a customer-service provider was breached, possibly exposing about 70,000 users' ID photos from age appeals."),
    },
    {
      title: gt("Familiar, and it works with your Discord bots"),
      text: gt("SerikaCord deliberately works like Discord, so there's little to learn. Its bot API follows Discord's, and a consent-based bridge can mirror messages between a Discord server and a SerikaCord server while your community moves at its own pace."),
    },
    {
      title: gt("Bigger free uploads and readable code"),
      text: gt("Free accounts can upload files up to 500 MB. The source code is public on GitHub, so you can see how your data is handled, although it is source-available rather than open source."),
    },
  ];

  const pick = [
    {
      title: gt("Discord is the better pick if…"),
      points: [
        gt("your community is large, or your members won't install or sign up for another app"),
        gt("many of your members use iPhones or iPads"),
        gt("you depend on specific bots or integrations that only exist on Discord"),
        gt("you need Stage channels, Activities, console apps or very large voice channels"),
      ],
    },
    {
      title: gt("SerikaCord is the better pick if…"),
      points: [
        gt("you want a chat app without ads that is run from the EU"),
        gt("you want your private messages, not just your calls, end-to-end encrypted"),
        gt("you don't want to be asked for ID or a selfie to use your account"),
        gt("you want something that feels like Discord and can run your Discord bots, and you don't mind being early"),
      ],
    },
  ];

  const faq: CompareFaqItem[] = [
    {
      question: gt("Is SerikaCord affiliated with Discord?"),
      answer: gt("No. SerikaCord is an independent app made by Serika Company. It deliberately works like Discord so it feels familiar and Discord bots can connect to it, but it is not affiliated with or endorsed by Discord."),
    },
    {
      question: gt("Can I move my Discord server to SerikaCord?"),
      answer: gt("You can set up the Discord bridge, which mirrors messages between a Discord server and a SerikaCord server so your community can move at its own pace. Each Discord member is asked for consent before their messages are relayed."),
    },
    {
      question: gt("Will my Discord bot work on SerikaCord?"),
      answer: gt("Often, yes. SerikaCord's bot API and gateway follow Discord's API v10, and our developer docs show how to point discord.js or discord.py at SerikaCord. Not every Discord feature is supported, so test your bot first."),
    },
    {
      question: gt("Are SerikaCord messages end-to-end encrypted?"),
      answer: gt("Direct messages and group DMs, including their voice and video calls, are end-to-end encrypted. This launched in October 2026, is on by default for new conversations, and hasn't been independently audited yet. Messages in server channels are encrypted when stored on our servers but are not end-to-end encrypted, so bots, search and moderation keep working there."),
    },
    {
      question: gt("Is Discord end-to-end encrypted?"),
      answer: gt("Discord's voice and video calls are end-to-end encrypted by default, including voice channels and Go Live streams, except Stage channels. Text messages are not end-to-end encrypted, and Discord says it has no current plans to change that."),
    },
    {
      question: gt("Is there a SerikaCord app for iPhone?"),
      answer: gt("Not yet. An iOS app is in development. Until then you can use SerikaCord in Safari and add it to your Home Screen."),
    },
    {
      question: gt("How old do I need to be?"),
      answer: gt("SerikaCord requires you to be 16 or older in every country. Discord's minimum age is 13, or older where local law requires it."),
    },
    {
      question: gt("Is SerikaCord built with AI?"),
      answer: gt("We use AI coding assistants to help build SerikaCord. AI moderation tools for servers are in development and will be optional for server owners. We don't use your private messages to train AI models."),
    },
  ];

  return (
    <CompareShell>
      <JsonLd
        data={compareArticleJsonLd({
          path: "/compare/discord",
          headline: "SerikaCord vs Discord: an honest comparison",
          description: DESCRIPTION,
          breadcrumbName: "SerikaCord vs Discord",
          inLanguage: locale,
        })}
      />
      <JsonLd data={faqJsonLd(faq)} />
      <Breadcrumbs items={[{ href: "/", label: gt("Home") }, { href: "/compare", label: gt("Compare") }, { label: "Discord" }]} />

      <PageHeader
        eyebrow={gt("Comparison")}
        title={gt("SerikaCord vs Discord")}
        intro={
          <>
            <p>{gt("Discord is the default home for online communities, and for most people it works well. SerikaCord looks and feels similar on purpose, so switching is easy, but it is run very differently: by a small team in the Netherlands, without ads, and with end-to-end encrypted direct messages.")}</p>
            <p>{gt("In short: if your community is large, depends on lots of bots or lives on iPhones, Discord is still the safer choice today. If you want an ad-free, EU-based alternative that feels familiar and can run your Discord bots, SerikaCord is worth a try.")}</p>
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
        intro={<p>{gt("What each app offers today. Discord changes often, so check the sources at the bottom if something matters to you.")}</p>}
      >
        <ComparisonTable columns={["SerikaCord", "Discord"]} rows={rows} caption={gt("SerikaCord and Discord features compared")} />
        <StatusLegend />
      </Section>

      <Section id="discord-better" title={gt("Where Discord is better")}>
        <PointList points={discordBetter} />
      </Section>

      <Section id="serikacord-better" title={gt("Where SerikaCord is better")}>
        <PointList points={serikaBetter} />
      </Section>

      <Section
        id="e2ee-limits"
        title={gt("What SerikaCord's encryption doesn't do (yet)")}
        intro={<p>{gt("End-to-end encryption on SerikaCord is new, so here are its limits in plain words:")}</p>}
      >
        <ul className="max-w-3xl list-disc space-y-2 pl-5 text-sm leading-relaxed text-[var(--app-muted)]">
          <li>{gt("It covers DMs, group DMs and their calls. Server channels and server voice channels are not end-to-end encrypted.")}</li>
          <li>{gt("It hasn't been independently audited yet.")}</li>
          <li>{gt("We can still see metadata: who talks to whom and when, reactions, replies and file sizes.")}</li>
          <li>{gt("A group's member list comes from our servers. Encryption can't stop someone being added to a group, but you would see them in the member list.")}</li>
          <li>{gt("People added to a group later can't read its earlier encrypted messages.")}</li>
          <li>{gt("In encrypted conversations, search, link previews, polls, forwarding, bots and voice messages aren't available yet.")}</li>
          <li>{gt("The web app is loaded from our servers, like every web-based encrypted messenger, so you are trusting the code we serve. It is public on GitHub for anyone to check.")}</li>
          <li>{gt("If you report an encrypted message, your app reveals that message to our safety team with a cryptographic proof that it is genuine.")}</li>
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
              {gt("We checked every source below on {date}. Facts about SerikaCord come from our own policies, documentation and code. Discord, Nitro and Go Live are trademarks of Discord Inc.", { date: checked })}
            </p>
          }
        />
      </Section>

      <CompareCta />
    </CompareShell>
  );
}

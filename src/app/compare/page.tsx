import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { getGT, getLocale } from "gt-next/server";
import { buildMetadata } from "@/lib/seo";
import { JsonLd } from "@/components/seo/JsonLd";
import { Breadcrumbs, CompareCta, CompareShell, PageHeader, PointList, Section } from "@/components/compare/CompareParts";
import { compareArticleJsonLd, formatCompareDate } from "@/lib/compare";

const DESCRIPTION =
  "Honest comparisons of SerikaCord with Discord and Stoat (formerly Revolt): features, privacy, encryption, apps and where each one is the better choice, with sources.";

export const metadata = buildMetadata({
  title: "Compare SerikaCord with Discord and Stoat",
  description: DESCRIPTION,
  path: "/compare",
  type: "article",
  keywords: [
    "SerikaCord vs Discord",
    "SerikaCord vs Stoat",
    "SerikaCord vs Revolt",
    "Discord alternative",
    "Discord alternatives comparison",
    "Stoat chat",
    "Revolt chat",
  ],
});

export default async function CompareIndexPage() {
  const gt = await getGT();
  const locale = await getLocale();
  const checked = formatCompareDate(locale);

  const comparisons = [
    {
      href: "/compare/discord",
      title: gt("SerikaCord vs Discord"),
      text: gt("Discord is the biggest community chat app, with the most polish, an iPhone app and a huge bot ecosystem. SerikaCord is a much smaller, EU-based alternative with no ads, end-to-end encrypted DMs and a Discord-compatible bot API."),
    },
    {
      href: "/compare/stoat",
      title: gt("SerikaCord vs Stoat"),
      text: gt("Stoat, formerly called Revolt, is a longer-running open-source alternative you can host yourself. SerikaCord is source-available rather than open source, and focuses on Discord-style features and moving communities over from Discord."),
    },
  ];

  return (
    <CompareShell>
      <JsonLd data={compareArticleJsonLd({ path: "/compare", headline: "Compare SerikaCord with Discord and Stoat", description: DESCRIPTION, breadcrumbName: "Compare", inLanguage: locale })} />
      <Breadcrumbs items={[{ href: "/", label: gt("Home") }, { label: gt("Compare") }]} />
      <PageHeader
        eyebrow={gt("Compare")}
        title={gt("How SerikaCord compares")}
        intro={
          <>
            <p>{gt("Choosing where your community lives is a big decision. These pages compare SerikaCord with the alternatives as honestly as we can: where they are better, where we are better, and what we haven't built yet.")}</p>
            <p>{gt("They are written by the SerikaCord team, so read them with that in mind and check the sources we link.")}</p>
          </>
        }
        meta={<span>{gt("Last checked: {date}", { date: checked })}</span>}
      />

      <div className="mb-14 grid gap-4 md:grid-cols-2">
        {comparisons.map((c) => (
          <Link
            key={c.href}
            href={c.href}
            className="group rounded-2xl border border-[var(--app-border)] bg-[var(--app-surface)] p-6 transition-colors hover:border-[var(--app-accent)]"
          >
            <h2 className="mb-2 flex items-center justify-between gap-3 text-xl font-bold">
              {c.title}
              <ArrowRight className="h-5 w-5 shrink-0 text-[var(--app-accent)] transition-transform group-hover:translate-x-1" aria-hidden />
            </h2>
            <p className="text-sm leading-relaxed text-[var(--app-muted)]">{c.text}</p>
          </Link>
        ))}
      </div>

      <Section id="how" title={gt("How we write these pages")}>
        <PointList
          points={[
            { title: gt("We cite our sources"), text: gt("Facts about other apps come from their own websites, help centres, blogs and source code, or from reputable press. Every page lists its sources and the date we checked them.") },
            { title: gt("We say what we couldn't verify"), text: gt("If we couldn't confirm something from a reliable source, we say so instead of guessing.") },
            { title: gt("We include our own weak spots"), text: gt("SerikaCord is young and run by a small team. Where another app is the better choice, we say it plainly.") },
            { title: gt("Found a mistake?"), text: gt("Apps change quickly. If something here is wrong or out of date, email support@serika.dev and we'll fix it.") },
          ]}
        />
      </Section>

      <CompareCta />
    </CompareShell>
  );
}

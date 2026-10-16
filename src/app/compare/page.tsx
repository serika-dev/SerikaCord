import Link from "next/link";
import { ArrowRight, Trophy } from "lucide-react";
import { T } from "gt-next";
import { getGT, getLocale } from "gt-next/server";
import { buildMetadata } from "@/lib/seo";
import { JsonLd } from "@/components/seo/JsonLd";
import { Breadcrumbs, CompareShell, PageHeader, PointList, Section } from "@/components/compare/CompareParts";
import { AppMark } from "@/components/compare/CompareBlocks";
import { TierLetter } from "@/components/compare/TierBoard";
import { APP_KINDS, TIERS, compareArticleJsonLd, compareItemListJsonLd, formatCompareDate, type AppId } from "@/lib/compare";
import { APPS, appsByKind } from "@/lib/compare/apps";
import { CONTENT_MODULES } from "@/lib/compare/content";
import { kindLabels } from "@/lib/compare/labels";
import { OVERALL_RANKING, tierOf } from "@/lib/compare/tiers";

const TITLE = "Compare SerikaCord with Discord, Signal, Matrix, Telegram and 19 more";
const DESCRIPTION =
  "Honest, sourced comparisons of SerikaCord with 23 chat apps: Discord, Stoat, Fluxer, Signal, Telegram, Matrix, TeamSpeak, Mumble and more. Where each is better, where we are, and a tier list.";

export const metadata = buildMetadata({
  title: TITLE,
  description: DESCRIPTION,
  path: "/compare",
  type: "article",
  keywords: [
    "Discord alternatives",
    "Discord alternatives comparison",
    "SerikaCord vs Discord",
    "SerikaCord vs Stoat",
    "SerikaCord vs Matrix",
    "SerikaCord vs Signal",
    "best Discord alternative",
    "chat app comparison",
  ],
});

export default async function CompareIndexPage() {
  const gt = await getGT();
  const locale = await getLocale();
  const checked = formatCompareDate(locale);

  const [kinds, ...contents] = await Promise.all([kindLabels(), ...APPS.map((a) => CONTENT_MODULES[a.id].content())]);
  const takes = Object.fromEntries(APPS.map((a, i) => [a.id, contents[i].take])) as Record<AppId, string>;
  const serikaOverall = tierOf(OVERALL_RANKING, "serikacord");

  return (
    <CompareShell
      current="/compare"
      hero={
        <>
          <Breadcrumbs items={[{ href: "/", label: gt("Home") }, { label: gt("Compare") }]} />
          <div className="grid items-end gap-6 sm:gap-10 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
            <PageHeader
              eyebrow={gt("Compare")}
              title={gt("How SerikaCord compares")}
              intro={
                <T>
                  <p>
                    Choosing where your community lives is a big decision. These pages compare SerikaCord with 23 other chat apps as honestly as we can:
                    where they are better, where we are better, and what we haven&apos;t built yet. Several of them beat us clearly at something, and we
                    say so.
                  </p>
                  <p>They are written by the SerikaCord team, so read them with that in mind and check the sources we link.</p>
                </T>
              }
              meta={<span>{gt("Last checked: {date}", { date: checked })}</span>}
            />

            {/* Featured: the tier list. */}
            <Link
              href="/compare/tier-list"
              className="hm-card group flex flex-col gap-4 p-5 shadow-[0_30px_80px_-40px_rgba(139,92,246,0.55)] sm:p-7"
            >
              <span className="flex items-center justify-between gap-4">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] bg-[color-mix(in_srgb,var(--brand-violet)_18%,transparent)] text-[var(--hm-accent-text)]">
                  <Trophy className="h-5 w-5" aria-hidden />
                </span>
                <span className="flex gap-1" aria-hidden>
                  {TIERS.map((t) => (
                    <TierLetter key={t} tier={t} size="sm" />
                  ))}
                </span>
              </span>
              <span>
                <span className="hm-h3 block">{gt("The chat app tier list")}</span>
                <span className="mt-1.5 block text-sm leading-relaxed">
                  {gt("All 24 apps, SerikaCord included, ranked S to F in twelve sections from privacy to moving from Discord, with a reason for every placement.")}
                </span>
              </span>
              <span className="flex items-center justify-between gap-3 border-t border-[var(--hm-line)] pt-4">
                {serikaOverall ? (
                  <span className="flex items-center gap-2 text-sm text-[var(--hm-ink)]">
                    {gt("SerikaCord overall:")}
                    <TierLetter tier={serikaOverall} size="sm" />
                  </span>
                ) : (
                  <span />
                )}
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--brand-violet)] text-white transition-transform group-hover:translate-x-0.5" aria-hidden>
                  <ArrowRight className="h-4 w-4 rtl:rotate-180" />
                </span>
              </span>
            </Link>
          </div>

          <nav aria-label={gt("On this page")} className="-mx-4 mt-8 overflow-x-auto px-4 sm:mx-0 sm:mt-12 sm:px-0">
            <ul className="flex gap-2 sm:flex-wrap">
              {APP_KINDS.map((kind) => (
                <li key={kind} className="shrink-0">
                  <a href={`#${kind}`} className="hm-chip whitespace-nowrap transition-colors hover:border-[var(--brand-violet)]">
                    {kinds[kind].title}
                    <span className="text-xs text-[var(--hm-faint)]">{appsByKind(kind).length}</span>
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </>
      }
    >
      <JsonLd
        data={compareArticleJsonLd({ path: "/compare", headline: TITLE, description: DESCRIPTION, breadcrumbName: "Compare", inLanguage: locale })}
      />
      <JsonLd data={compareItemListJsonLd(APPS.map((a) => ({ name: `SerikaCord vs ${a.name}`, path: `/compare/${a.id}` })))} />

      {APP_KINDS.map((kind) => (
        <Section key={kind} id={kind} title={kinds[kind].title} intro={<p>{kinds[kind].intro}</p>}>
          <ul className="grid gap-2 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
            {appsByKind(kind).map((a) => {
              const overall = tierOf(OVERALL_RANKING, a.id);
              return (
                <li key={a.id}>
                  <Link href={`/compare/${a.id}`} className="hm-card group flex h-full flex-col !rounded-[16px] p-3.5 sm:!rounded-[20px] sm:p-5">
                    <span className="flex items-center gap-3">
                      <AppMark name={a.name} hue={a.hue} />
                      <span className="min-w-0 flex-1">
                        <span className="hm-h3 block !text-[1.05rem] leading-tight">{a.name}</span>
                        {a.status === "shutdown" ? (
                          <span className="text-xs font-semibold text-rose-600 dark:text-rose-400">{gt("Shut down")}</span>
                        ) : a.status === "beta" ? (
                          <span className="text-xs text-[var(--hm-faint)]">{gt("Beta or early access")}</span>
                        ) : null}
                      </span>
                      {overall && (
                        <span title={gt("Overall tier")}>
                          <span className="sr-only">{gt("Overall tier")}: </span>
                          <TierLetter tier={overall} size="sm" />
                        </span>
                      )}
                    </span>
                    <span className="mt-2 flex-1 text-[13px] leading-snug text-[var(--hm-body)] sm:mt-3 sm:text-sm sm:leading-relaxed">{takes[a.id]}</span>
                    <span className="mt-2.5 inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--hm-accent-text)] sm:mt-4">
                      {gt("SerikaCord vs {app}", { app: a.name })}
                      <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 rtl:rotate-180" aria-hidden />
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Section>
      ))}

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
    </CompareShell>
  );
}

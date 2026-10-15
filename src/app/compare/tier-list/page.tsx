import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronDown, Info } from "lucide-react";
import { T } from "gt-next";
import { getGT, getLocale } from "gt-next/server";
import { buildMetadata } from "@/lib/seo";
import { JsonLd } from "@/components/seo/JsonLd";
import { Breadcrumbs, CompareCta, CompareShell, PageHeader } from "@/components/compare/CompareParts";
import { TierLetter, TierReasons, TierRows, type TierApp } from "@/components/compare/TierBoard";
import { TIER_SECTIONS, compareArticleJsonLd, compareItemListJsonLd, formatCompareDate, type TierAppId } from "@/lib/compare";
import { APPS } from "@/lib/compare/apps";
import { tierNames as loadTierNames, tierSectionLabels } from "@/lib/compare/labels";
import { overallReasons, tierReasons } from "@/lib/compare/tierText";
import { OVERALL_RANKING, TIER_RANKINGS, tierOf } from "@/lib/compare/tiers";

const TITLE = "Chat app tier list 2026: Discord, Signal, Matrix, Telegram, SerikaCord and 19 more";
const DESCRIPTION =
  "24 chat apps ranked S to F in 12 sections: privacy, security, community features, moderation, voice, bots, apps, ease of use, openness, scale, business model and moving from Discord. With reasons and sources.";

export const metadata = buildMetadata({
  title: TITLE,
  description: DESCRIPTION,
  path: "/compare/tier-list",
  type: "article",
  keywords: [
    "chat app tier list",
    "Discord alternatives tier list",
    "best Discord alternative 2026",
    "Discord alternatives ranked",
    "private messenger comparison",
    "Signal vs Telegram vs Discord",
    "Matrix vs Discord",
  ],
});

function SectionDetails({ summary, children }: { summary: string; children: ReactNode }) {
  return (
    <details className="group mt-3 overflow-hidden rounded-2xl border border-[var(--app-border)] bg-[var(--app-surface)]">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-semibold hover:bg-[var(--app-surface-alt)]">
        {summary}
        <ChevronDown className="h-4 w-4 shrink-0 text-[var(--app-muted)] transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <div className="border-t border-[var(--app-border)]">{children}</div>
    </details>
  );
}

export default async function TierListPage() {
  const gt = await getGT();
  const locale = await getLocale();
  const checked = formatCompareDate(locale);
  const [sections, names, reasons, overall] = await Promise.all([tierSectionLabels(), loadTierNames(), tierReasons(), overallReasons()]);

  const apps = {
    serikacord: { name: "SerikaCord", short: "SerikaCord", hue: 262, href: "/" },
    ...Object.fromEntries(
      APPS.map((a) => [a.id, { name: a.name, short: a.short, hue: a.hue, href: `/compare/${a.id}`, shutdown: a.status === "shutdown" }]),
    ),
  } as Record<TierAppId, TierApp>;

  const empty = gt("Nobody earned this tier.");

  return (
    <CompareShell>
      <JsonLd
        data={compareArticleJsonLd({
          path: "/compare/tier-list",
          headline: TITLE,
          description: DESCRIPTION,
          breadcrumbName: "Tier list",
          inLanguage: locale,
        })}
      />
      <JsonLd data={compareItemListJsonLd(OVERALL_RANKING.map(([id]) => ({ name: apps[id].name, path: id === "serikacord" ? "/" : `/compare/${id}` })))} />
      <Breadcrumbs items={[{ href: "/", label: gt("Home") }, { href: "/compare", label: gt("Compare") }, { label: gt("Tier list") }]} />

      <PageHeader
        eyebrow={gt("Tier list")}
        title={gt("The chat app tier list")}
        intro={
          <T>
            <p>
              We ranked 24 chat apps, our own included, from S (best in class) to F (missing or unusable) in twelve sections, then gave each an
              overall tier. Every placement has a one-line reason, and every app has a full comparison page with dated sources.
            </p>
          </T>
        }
        meta={
          <>
            <span>{gt("Last checked: {date}", { date: checked })}</span>
            <span>{gt("24 apps · 12 sections")}</span>
          </>
        }
      />

      <aside className="mb-12 flex gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm leading-relaxed sm:p-5">
        <Info className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
        <div>
          <p className="font-semibold">{gt("We make SerikaCord, so we are biased.")}</p>
          <T>
            <p>
              We tried hard not to be: SerikaCord is never placed above an app that is clearly better in a section, and it lands in C or D where
              it is weak. Disagree? Check the sources on each comparison page, and tell us at support@serika.dev.
            </p>
          </T>
        </div>
      </aside>

      <section id="overall" aria-labelledby="overall-title" className="mb-14 scroll-mt-20">
        <h2 id="overall-title" className="mb-2 text-2xl font-bold tracking-tight sm:text-3xl">{gt("Overall")}</h2>
        <p className="mb-5 max-w-3xl leading-relaxed text-[var(--app-muted)]">
          {gt("Our overall judgment for someone choosing where their community or friends should talk. It weighs every section, not a simple average.")}
        </p>
        <TierRows ranking={OVERALL_RANKING} apps={apps} tierNames={names} emptyLabel={empty} />
        <SectionDetails summary={gt("Why each app is where it is")}>
          <TierReasons ranking={OVERALL_RANKING} apps={apps} reasons={overall} />
        </SectionDetails>
      </section>

      <nav aria-label={gt("Sections")} className="mb-12">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[var(--app-muted)]">{gt("Jump to a section")}</h2>
        <ol className="flex flex-wrap gap-2">
          {TIER_SECTIONS.map((s, i) => (
            <li key={s}>
              <a
                href={`#${s}`}
                className="inline-flex items-center gap-1.5 rounded-full border border-[var(--app-border)] px-3 py-1 text-sm text-[var(--app-muted)] transition-colors hover:border-[var(--app-accent)] hover:text-[var(--app-text)]"
              >
                <span className="font-mono text-xs">{i + 1}</span>
                {sections[s].title}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      {TIER_SECTIONS.map((s, i) => {
        const ours = tierOf(TIER_RANKINGS[s], "serikacord");
        return (
          <section key={s} id={s} aria-labelledby={`${s}-title`} className="mb-14 scroll-mt-20">
            <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
              <div className="max-w-3xl">
                <p className="mb-1 font-mono text-xs text-[var(--app-accent)]">{String(i + 1).padStart(2, "0")}</p>
                <h2 id={`${s}-title`} className="mb-2 text-2xl font-bold tracking-tight">{sections[s].title}</h2>
                <p className="text-sm leading-relaxed text-[var(--app-muted)]">{sections[s].criteria}</p>
              </div>
              {ours && (
                <p className="flex items-center gap-2 text-sm text-[var(--app-muted)]">
                  {gt("SerikaCord:")}
                  <TierLetter tier={ours} size="sm" />
                </p>
              )}
            </div>
            <TierRows ranking={TIER_RANKINGS[s]} apps={apps} tierNames={names} emptyLabel={empty} />
            <SectionDetails summary={gt("Why each app is where it is")}>
              <TierReasons ranking={TIER_RANKINGS[s]} apps={apps} reasons={reasons[s]} />
            </SectionDetails>
          </section>
        );
      })}

      <section id="matrix" aria-labelledby="matrix-title" className="mb-14 min-w-0 scroll-mt-20">
        <h2 id="matrix-title" className="mb-2 text-2xl font-bold tracking-tight sm:text-3xl">{gt("Every ranking at a glance")}</h2>
        <p className="mb-5 max-w-3xl leading-relaxed text-[var(--app-muted)]">
          {gt("Apps in overall order; the numbered columns are the twelve sections above. Scroll sideways on a phone.")}
        </p>
        <div className="relative w-full max-w-full overflow-x-auto rounded-2xl border border-[var(--app-border)]">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <caption className="sr-only">{gt("Tier of every app in every section")}</caption>
            <thead className="bg-[var(--app-surface-alt)]">
              <tr>
                <th scope="col" className="sticky left-0 z-10 bg-[var(--app-surface-alt)] px-3 py-2.5 text-left font-semibold">{gt("App")}</th>
                <th scope="col" className="px-2 py-2.5 font-semibold">{gt("Overall")}</th>
                {TIER_SECTIONS.map((s, i) => (
                  <th key={s} scope="col" className="px-1.5 py-2.5 font-mono text-xs font-semibold">
                    <abbr title={sections[s].title} className="no-underline">{i + 1}</abbr>
                    <span className="sr-only">{sections[s].title}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {OVERALL_RANKING.map(([id, tier]) => (
                <tr key={id} className={`border-t border-[var(--app-border)] ${id === "serikacord" ? "bg-[var(--app-accent)]/10" : "bg-[var(--app-surface)]"}`}>
                  <th scope="row" className={`sticky left-0 z-10 px-3 py-1.5 text-left font-medium ${id === "serikacord" ? "bg-[var(--app-surface-alt)]" : "bg-[var(--app-surface)]"}`}>
                    <Link href={apps[id].href} className="hover:text-[var(--app-accent)]">{apps[id].short}</Link>
                  </th>
                  <td className="px-2 py-1.5 text-center"><TierLetter tier={tier} size="sm" /></td>
                  {TIER_SECTIONS.map((s) => {
                    const t = tierOf(TIER_RANKINGS[s], id);
                    return (
                      <td key={s} className="px-1.5 py-1.5 text-center">
                        {t && <TierLetter tier={t} size="sm" />}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section id="method" aria-labelledby="method-title" className="mb-14 scroll-mt-20">
        <h2 id="method-title" className="mb-4 text-2xl font-bold tracking-tight sm:text-3xl">{gt("How we ranked them")}</h2>
        <div className="max-w-3xl space-y-4 text-sm leading-relaxed text-[var(--app-muted)] sm:text-base">
          <T>
            <p>
              Each section is judged on what a normal person or community gets today, not on roadmaps. S means best in class, A excellent, B
              good, C mixed, D weak, and F missing or unusable. A tier can be empty. Inside a tier, apps are listed from best to worst.
            </p>
            <p>
              Facts come from each app&apos;s own website, documentation, source code, app store listings and policies, plus reputable press and
              security research. Where we couldn&apos;t verify something, we didn&apos;t count it. Every comparison page lists its sources with dates.
            </p>
            <p>
              Matrix and XMPP are ranked as networks with their best-known apps (Element and Movim). Kloak shut down in October 2026, so it is F
              everywhere; its page records what it offered. Things change quickly, so treat this as a snapshot.
            </p>
          </T>
          <p>{gt("Last checked: {date}", { date: checked })}</p>
          <p>
            <Link href="/compare" className="font-semibold text-[var(--app-accent)] hover:underline">{gt("Read the detailed comparisons")}</Link>
          </p>
        </div>
      </section>

      <CompareCta />
    </CompareShell>
  );
}

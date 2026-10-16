import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowRight, Power, Scale } from "lucide-react";
import { getGT, getLocale } from "gt-next/server";
import { buildMetadata } from "@/lib/seo";
import { JsonLd } from "@/components/seo/JsonLd";
import { Breadcrumbs, CompareShell, FaqList, PageHeader, PickCards, Section } from "@/components/compare/CompareParts";
import { AppMark, BulletCard, FactTable, PointGrid, SourceList, SourceRefs, StatusLegend } from "@/components/compare/CompareBlocks";
import { TierLetter } from "@/components/compare/TierBoard";
import { APP_IDS, TIER_SECTIONS, compareArticleJsonLd, faqJsonLd, formatCompareDate, numberSources, sourceNumbers } from "@/lib/compare";
import { appsByKind, getAppMeta, isAppId } from "@/lib/compare/apps";
import { loadAppContent, appSources } from "@/lib/compare/content";
import { serikaCaveats, serikaE2eeLimits, serikaFacts, serikaSources } from "@/lib/compare/content/serika";
import { tierSectionLabels } from "@/lib/compare/labels";
import { OVERALL_RANKING, TIER_RANKINGS, tierOf } from "@/lib/compare/tiers";

export const dynamicParams = false;

export function generateStaticParams() {
  return APP_IDS.map((app) => ({ app }));
}

export async function generateMetadata({ params }: { params: Promise<{ app: string }> }): Promise<Metadata> {
  const { app } = await params;
  if (!isAppId(app)) return {};
  const meta = getAppMeta(app);
  return buildMetadata({
    title: meta.seoTitle,
    description: meta.seoDescription,
    path: `/compare/${meta.id}`,
    type: "article",
    keywords: meta.keywords,
  });
}

export default async function CompareAppPage({ params }: { params: Promise<{ app: string }> }) {
  const { app } = await params;
  if (!isAppId(app)) notFound();

  const meta = getAppMeta(app);
  const gt = await getGT();
  const locale = await getLocale();
  const checked = formatCompareDate(locale);

  const [content, serika, e2eeLimits, caveats, sectionLabels] = await Promise.all([
    loadAppContent(app),
    serikaFacts(),
    serikaE2eeLimits(),
    serikaCaveats(),
    tierSectionLabels(),
  ]);
  const { list, lookup } = numberSources(appSources(app), serikaSources);
  const name = meta.name;
  const others = appsByKind(meta.kind).filter((a) => a.id !== app);
  const overallApp = tierOf(OVERALL_RANKING, app);
  const overallSerika = tierOf(OVERALL_RANKING, "serikacord");

  const jump = [
    { href: "#facts", label: gt("Feature by feature") },
    { href: "#why-serikacord", label: gt("Why SerikaCord") },
    { href: `#why-${app}`, label: gt("Why {app}", { app: name }) },
    { href: "#who", label: gt("Who should pick which") },
    { href: "#faq", label: gt("FAQ") },
    { href: "#sources", label: gt("Sources") },
  ];

  return (
    <CompareShell
      hero={
        <>
          <Breadcrumbs items={[{ href: "/", label: gt("Home") }, { href: "/compare", label: gt("Compare") }, { label: name }]} />

          {meta.status === "shutdown" && (
            <div role="note" className="mb-6 flex gap-3 rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm leading-relaxed text-[var(--hm-ink)] sm:mb-8">
              <Power className="mt-0.5 h-5 w-5 shrink-0 text-rose-400" aria-hidden />
              <p>{gt("{app} has shut down. This page records what it offered and how it compared, for anyone looking for somewhere new to go.", { app: name })}</p>
            </div>
          )}

          <PageHeader
            eyebrow={meta.status === "beta" ? gt("Comparison · {app} is in beta or early access", { app: name }) : gt("Comparison")}
            title={gt("SerikaCord vs {app}", { app: name })}
            intro={
              <>
                {content.intro.map((p) => (
                  <p key={p}>{p}</p>
                ))}
              </>
            }
            meta={
              <>
                <span>{gt("Last checked: {date}", { date: checked })}</span>
                <span>{gt("Written by the SerikaCord team, so check the sources")}</span>
                <a href={meta.website} target="_blank" rel="noopener noreferrer" className="hm-link font-normal">
                  {gt("{app} website", { app: name })}
                </a>
              </>
            }
          />

          <div className="mt-7 grid gap-3 sm:mt-10 sm:gap-4 md:grid-cols-[1fr_auto]">
            <div className="hm-card !border-[color-mix(in_srgb,var(--brand-violet)_45%,transparent)] p-5 sm:p-7">
              <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-[var(--hm-accent-text)]">
                <Scale className="h-4 w-4" aria-hidden />
                {gt("Our verdict")}
              </p>
              <p className="text-base leading-relaxed text-[var(--hm-ink)] sm:text-lg">{content.verdict}</p>
            </div>
            {overallApp && overallSerika && (
              <Link
                href="/compare/tier-list"
                className="hm-card flex items-center justify-between gap-4 p-5 md:flex-col md:justify-center md:text-center"
              >
                <span className="text-xs font-semibold uppercase tracking-wide text-[var(--hm-body)]">{gt("Overall on our tier list")}</span>
                <span className="flex items-center gap-4">
                  <span className="flex flex-col items-center gap-1 text-xs text-[var(--hm-ink)]">
                    <TierLetter tier={overallSerika} />
                    SerikaCord
                  </span>
                  <span className="flex flex-col items-center gap-1 text-xs text-[var(--hm-ink)]">
                    <TierLetter tier={overallApp} />
                    {meta.short}
                  </span>
                </span>
              </Link>
            )}
          </div>
        </>
      }
    >
      <JsonLd
        data={compareArticleJsonLd({
          path: `/compare/${app}`,
          headline: meta.seoTitle,
          description: meta.seoDescription,
          breadcrumbName: `SerikaCord vs ${name}`,
          inLanguage: locale,
          about: ["SerikaCord", name],
        })}
      />
      <JsonLd data={faqJsonLd(content.faq)} />
      <nav aria-label={gt("On this page")} className="-mx-4 mb-10 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:mb-14 sm:flex-wrap sm:px-0">
        {jump.map((j) => (
          <a
            key={j.href}
            href={j.href}
            className="hm-chip shrink-0 whitespace-nowrap transition-colors hover:border-[var(--brand-violet)]"
          >
            {j.label}
          </a>
        ))}
      </nav>

      <Section
        id="facts"
        title={gt("Feature by feature")}
        intro={<p>{gt("What each app offers today, with a numbered source for every claim. Apps change quickly, so check the sources if something matters to you.")}</p>}
      >
        <FactTable appName={name} serika={serika} app={content.facts} lookup={lookup} />
        <StatusLegend />
      </Section>

      {content.notes && (
        <Section id="notes" title={content.notes.title}>
          <BulletCard
            intro={content.notes.intro ? <p>{content.notes.intro}</p> : undefined}
            points={content.notes.points}
            footer={
              content.notes.src && content.notes.src.length > 0 ? (
                <p className="mt-3 text-xs text-[var(--hm-body)]">
                  {gt("Sources:")}
                  <SourceRefs numbers={sourceNumbers(lookup, "app", content.notes.src)} />
                </p>
              ) : undefined
            }
          />
        </Section>
      )}

      <Section id="why-serikacord" title={gt("Why pick SerikaCord over {app}", { app: name })}>
        <PointGrid points={content.whyUs} lookup={lookup} scope="app" tone="us" />
      </Section>

      <Section id={`why-${app}`} title={gt("Why you might prefer {app} over SerikaCord", { app: name })}>
        <PointGrid points={content.whyThem} lookup={lookup} scope="app" tone="them" />
      </Section>

      <Section
        id="tiers"
        title={gt("Section by section on our tier list")}
        intro={
          <p>
            {gt("How we ranked both apps in each of the twelve sections of our tier list.")}{" "}
            <Link href="/compare/tier-list" className="hm-link">
              {gt("See the full tier list")}
            </Link>
          </p>
        }
      >
        <div className="overflow-hidden rounded-2xl border border-[var(--hm-line)]">
          <table className="w-full border-collapse text-left text-sm">
            <caption className="sr-only">{gt("Tier list placements for SerikaCord and {app}", { app: name })}</caption>
            <thead className="bg-[var(--hm-surface-2)]">
              <tr>
                <th scope="col" className="px-3 py-2.5 font-semibold sm:px-4">{gt("Section")}</th>
                <th scope="col" className="w-24 px-2 py-2.5 text-center font-semibold sm:w-32">SerikaCord</th>
                <th scope="col" className="w-24 px-2 py-2.5 text-center font-semibold sm:w-32">{meta.short}</th>
              </tr>
            </thead>
            <tbody>
              {TIER_SECTIONS.map((section) => {
                const ours = tierOf(TIER_RANKINGS[section], "serikacord");
                const theirs = tierOf(TIER_RANKINGS[section], app);
                return (
                  <tr key={section} className="border-t border-[var(--hm-line)] bg-[var(--hm-surface)]">
                    <th scope="row" className="px-3 py-2 font-medium sm:px-4">
                      <Link href={`/compare/tier-list#${section}`} className="hover:text-[var(--hm-accent-text)]">{sectionLabels[section].title}</Link>
                    </th>
                    <td className="px-2 py-2 text-center">{ours && <TierLetter tier={ours} size="sm" />}</td>
                    <td className="px-2 py-2 text-center">{theirs && <TierLetter tier={theirs} size="sm" />}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>

      <Section
        id="serikacord-caveats"
        title={gt("What you should know about SerikaCord")}
        intro={<p>{gt("The same caveats appear on every comparison page, because they matter whichever app you are comparing us with.")}</p>}
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <BulletCard title={gt("Our weak spots")} points={caveats} />
          <BulletCard title={gt("What our end-to-end encryption doesn't do (yet)")} points={e2eeLimits} />
        </div>
      </Section>

      <Section id="who" title={gt("Who should pick which")}>
        <PickCards
          cards={[
            { title: gt("{app} is the better pick if…", { app: name }), points: content.pickThem },
            { title: gt("SerikaCord is the better pick if…"), points: content.pickUs },
          ]}
        />
      </Section>

      <Section id="faq" title={gt("Frequently asked questions")}>
        <FaqList items={content.faq} />
      </Section>

      {content.couldNotVerify.length > 0 && (
        <Section
          id="unverified"
          title={gt("What we couldn't verify")}
          intro={<p>{gt("We looked for these and couldn't confirm them from a reliable source, so we left them out of the comparison above.")}</p>}
        >
          <BulletCard points={content.couldNotVerify} />
        </Section>
      )}

      <Section id="sources" title={gt("Sources")}>
        <SourceList
          list={list}
          note={
            <p>
              {gt("We checked every source below on {date}. Facts about SerikaCord come from our own policies, documentation, code and changelog. Product names belong to their owners; SerikaCord is not affiliated with any app compared here. Found a mistake? Email support@serika.dev and we'll fix it.", { date: checked })}
            </p>
          }
        />
      </Section>

      {others.length > 0 && (
        <Section id="more" title={gt("More comparisons")}>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {others.map((o) => (
              <li key={o.id}>
                <Link
                  href={`/compare/${o.id}`}
                  className="hm-card group flex items-center gap-3 !rounded-[16px] p-3"
                >
                  <AppMark name={o.name} hue={o.hue} />
                  <span className="min-w-0 flex-1 font-medium">{gt("SerikaCord vs {app}", { app: o.name })}</span>
                  <ArrowRight className="h-4 w-4 shrink-0 text-[var(--hm-accent-text)] transition-transform group-hover:translate-x-0.5 rtl:rotate-180" aria-hidden />
                </Link>
              </li>
            ))}
            <li>
              <Link
                href="/compare/tier-list"
                className="hm-card group flex items-center gap-3 !rounded-[16px] border-dashed p-3"
              >
                <span className="min-w-0 flex-1 font-medium">{gt("The full tier list")}</span>
                <ArrowRight className="h-4 w-4 shrink-0 text-[var(--hm-accent-text)] rtl:rotate-180" aria-hidden />
              </Link>
            </li>
          </ul>
        </Section>
      )}

    </CompareShell>
  );
}

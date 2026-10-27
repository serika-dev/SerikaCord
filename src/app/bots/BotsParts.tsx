import Link from "next/link";
import type { ReactNode } from "react";
import { getGT } from "gt-next/server";
import { HomeHeader } from "@/components/home/HomeHeader";
import { HomeFooter } from "@/components/home/HomeFooter";
import { homeDisplayFont } from "@/components/home/displayFont";
import { AppDirectoryCard, formatCount, type AppCardLabels } from "@/components/apps/AppDirectoryCard";
import { APP_CATEGORIES, appCategoryLabel } from "@/lib/appDirectory/listing";
import type { PublicDirectoryApp } from "@/lib/services/appDirectory";
import { cn } from "@/lib/utils";
import "@/components/home/home.css";

/**
 * Building blocks for the public bot library (/bots, /bots/:id). Server
 * components in the homepage's design language (src/components/home/home.css):
 * dark brand band for the nav and hero, theme-following body.
 */

type Gt = Awaited<ReturnType<typeof getGT>>;

export async function BotsShell({ hero, children }: { hero: ReactNode; children: ReactNode }) {
  return (
    <div className={`hm-root ${homeDisplayFont.variable}`}>
      <HomeHeader variant="site" current="/bots" />
      <main id="main" tabIndex={-1} className="outline-none">
        <div className="hm-dark hm-hero pb-8 pt-[calc(5.5rem+var(--safe-area-top))] sm:pb-14 sm:pt-28">
          <div className="mx-auto max-w-[1200px] px-4 sm:px-6 lg:px-10">{hero}</div>
        </div>
        <div className="mx-auto max-w-[1200px] px-4 pb-16 pt-8 text-[var(--hm-ink)] sm:px-6 sm:pt-12 lg:px-10">{children}</div>
      </main>
      <HomeFooter />
    </div>
  );
}

export function appCardLabels(app: PublicDirectoryApp, gt: Gt, locale: string): AppCardLabels {
  return {
    verified: gt("Verified app"),
    noDescription: gt("No description yet."),
    servers: app.serverCount === 1 ? gt("1 server") : gt("{count} servers", { count: formatCount(app.serverCount, locale) }),
    categories: app.categories.map((c) => appCategoryLabel(c, gt)),
  };
}

export function BotGrid({ apps, gt, locale }: { apps: PublicDirectoryApp[]; gt: Gt; locale: string }) {
  return (
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
      {apps.map((app) => (
        <li key={app.id}>
          <AppDirectoryCard app={app} href={`/bots/${app.id}`} labels={appCardLabels(app, gt, locale)} />
        </li>
      ))}
    </ul>
  );
}

export function BotSection({ id, title, intro, more, children }: { id: string; title: string; intro?: string; more?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="mb-12 scroll-mt-24 sm:mb-16">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2 sm:mb-6">
        <div>
          <h2 id={`${id}-title`} className="hm-display hm-h2-page">{title}</h2>
          {intro && <p className="mt-1.5 max-w-2xl text-sm text-[var(--hm-body)] sm:text-[0.95rem]">{intro}</p>}
        </div>
        {more}
      </div>
      {children}
    </section>
  );
}

/** Builds a /bots URL keeping only the filters that are set. */
export function botsHref(params: { q?: string | null; category?: string | null; sort?: string | null }): string {
  const sp = new URLSearchParams();
  if (params.q) sp.set("q", params.q);
  if (params.category) sp.set("category", params.category);
  if (params.sort) sp.set("sort", params.sort);
  const qs = sp.toString();
  return qs ? `/bots?${qs}` : "/bots";
}

/** Search box + category chips for the hero (plain GET form: works without JavaScript). */
export async function BotsSearch({ q, category }: { q: string; category: string | null }) {
  const gt = await getGT();
  return (
    <div className="mt-6 sm:mt-8">
      <form action="/bots" method="get" role="search" className="flex max-w-2xl gap-2">
        <label htmlFor="bots-q" className="sr-only">{gt("Search bots")}</label>
        <input
          id="bots-q"
          name="q"
          type="search"
          defaultValue={q}
          maxLength={100}
          placeholder={gt("Search bots by name, feature or tag")}
          className="h-12 min-w-0 flex-1 rounded-full border border-white/15 bg-white/[0.06] px-5 text-[0.97rem] text-[var(--hm-ink)] outline-none placeholder:text-[var(--hm-faint)] focus:border-[var(--brand-violet-light)]"
        />
        {category && <input type="hidden" name="category" value={category} />}
        <button type="submit" className="hm-btn hm-btn-primary hm-btn-compact shrink-0">{gt("Search")}</button>
      </form>
      <nav aria-label={gt("Categories")} className="-mx-4 mt-5 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0">
        <ul className="flex w-max gap-2 sm:w-auto sm:flex-wrap">
          <li>
            <Link href={botsHref({ q })} aria-current={!category ? "page" : undefined} className={chipClass(!category)}>
              {gt("All")}
            </Link>
          </li>
          {APP_CATEGORIES.map((c) => (
            <li key={c}>
              <Link href={botsHref({ q, category: c })} aria-current={category === c ? "page" : undefined} className={chipClass(category === c)}>
                {appCategoryLabel(c, gt)}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}

function chipClass(active: boolean): string {
  return cn(
    "inline-flex h-9 items-center whitespace-nowrap rounded-full border px-3.5 text-sm transition-colors",
    active
      ? "border-[var(--brand-violet)] bg-[var(--brand-violet)] text-white"
      : "border-white/15 bg-white/[0.04] text-[var(--hm-body)] hover:bg-white/[0.08] hover:text-[var(--hm-ink)]",
  );
}

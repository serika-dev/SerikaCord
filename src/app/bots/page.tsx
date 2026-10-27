import Link from "next/link";
import type { ReactNode } from "react";
import type { Metadata } from "next";
import { ArrowRight, Bot, SearchX } from "lucide-react";
import { getGT, getLocale } from "gt-next/server";
import { buildMetadata } from "@/lib/seo";
import { APP_CATEGORIES, appCategoryLabel, isAppCategory, type AppCategory } from "@/lib/appDirectory/listing";
import { isDirectorySort, pageDirectory, type DirectorySort } from "@/lib/appDirectory/paging";
import { getListedApps, type PublicDirectoryApp } from "@/lib/services/appDirectory";
import { cn } from "@/lib/utils";
import { BotGrid, BotSection, BotsSearch, BotsShell, botsHref } from "./BotsParts";
import { BotsLoadMore } from "./BotsLoadMore";

// Reads the database on every request (cached for a minute in-process); never prerendered at build time.
export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

function readParams(sp: Record<string, string | string[] | undefined>) {
  const q = first(sp.q).trim().slice(0, 100);
  const rawCategory = first(sp.category);
  const category: AppCategory | null = isAppCategory(rawCategory) ? rawCategory : null;
  const rawSort = first(sp.sort);
  const sort: DirectorySort = isDirectorySort(rawSort) ? rawSort : "popular";
  return { q, category, sort, explicitSort: isDirectorySort(rawSort) };
}

export async function generateMetadata({ searchParams }: { searchParams: SearchParams }): Promise<Metadata> {
  const { q, category } = readParams(await searchParams);
  const gt = await getGT();
  if (category) {
    const label = appCategoryLabel(category, gt);
    return buildMetadata({
      title: gt("{category} bots for your server", { category: label }),
      description: gt("Browse {category} bots and apps for SerikaCord servers. Free to add, Discord-compatible, and reviewed by the community.", { category: label }),
      path: `/bots?category=${category}`,
      noIndex: !!q,
    });
  }
  return buildMetadata({
    title: gt("Bot library: find bots and apps for your server"),
    description: gt("Discover bots for SerikaCord: moderation, music, games, utilities and more. Search the library and add a bot to your server in a few clicks."),
    path: "/bots",
    noIndex: !!q,
    keywords: ["SerikaCord bots", "Discord bots", "bot list", "moderation bot", "music bot", "add bot to server", "app directory"],
  });
}

export default async function BotsPage({ searchParams }: { searchParams: SearchParams }) {
  const { q, category, sort, explicitSort } = readParams(await searchParams);
  const gt = await getGT();
  const locale = await getLocale();

  let all: PublicDirectoryApp[] = [];
  let loadFailed = false;
  try {
    all = await getListedApps();
  } catch (err) {
    console.error("[bots] directory load failed:", (err as Error)?.message ?? err);
    loadFailed = true;
  }

  const filtered = !!q || !!category || explicitSort;
  const page = pageDirectory(all, { search: q, category, sort });

  const hero = (
    <header className="max-w-3xl">
      <p className="hm-label mb-2 sm:mb-3">{gt("Bot library")}</p>
      <h1 className="hm-display hm-h1 hm-h1-page">
        {category ? gt("{category} bots", { category: appCategoryLabel(category, gt) }) : gt("Find the right bot for your server")}
      </h1>
      <p className="hm-lede mt-3 sm:mt-5">
        {gt("Moderation, music, games, utilities and more, made by the SerikaCord developer community. Pick one and add it to a server you manage.")}
      </p>
      <BotsSearch q={q} category={category} />
    </header>
  );

  if (loadFailed) {
    return (
      <BotsShell hero={hero}>
        <EmptyState icon="error" title={gt("The bot library couldn't be loaded")} text={gt("Please try again in a moment.")} />
      </BotsShell>
    );
  }

  if (all.length === 0) {
    return (
      <BotsShell hero={hero}>
        <EmptyState
          icon="bot"
          title={gt("No bots listed yet")}
          text={gt("Developers can list their public bots from the Directory page of the developer portal.")}
          action={<Link href="/developers/applications" className="hm-btn hm-btn-primary hm-btn-sm">{gt("List your bot")}</Link>}
        />
      </BotsShell>
    );
  }

  if (filtered) {
    const sorts: { id: DirectorySort; label: string }[] = [
      { id: "popular", label: gt("Popular") },
      { id: "new", label: gt("New") },
      { id: "name", label: gt("A to Z") },
    ];
    return (
      <BotsShell hero={hero}>
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-[var(--hm-body)]" aria-live="polite">
            {page.total === 1 ? gt("1 bot") : gt("{count} bots", { count: page.total })}
            {q && <> · {gt("Results for “{query}”", { query: q })}</>}
          </p>
          <nav aria-label={gt("Sort")} className="flex gap-1 rounded-full border border-[var(--hm-line)] bg-[var(--hm-surface)] p-1">
            {sorts.map((s) => (
              <Link
                key={s.id}
                href={botsHref({ q, category, sort: s.id })}
                aria-current={sort === s.id ? "page" : undefined}
                className={cn(
                  "rounded-full px-3 py-1.5 text-sm transition-colors",
                  sort === s.id ? "bg-[var(--brand-violet)] text-white" : "text-[var(--hm-body)] hover:text-[var(--hm-ink)]",
                )}
              >
                {s.label}
              </Link>
            ))}
          </nav>
        </div>
        {page.items.length === 0 ? (
          <EmptyState
            icon="search"
            title={gt("No bots match your search")}
            text={gt("Try a different word, or browse all categories.")}
            action={<Link href="/bots" className="hm-btn hm-btn-ghost hm-btn-sm">{gt("Browse all bots")}</Link>}
          />
        ) : (
          <>
            <BotGrid apps={page.items} gt={gt} locale={locale} />
            <BotsLoadMore key={`${q}|${category ?? ""}|${sort}`} initialCursor={page.nextCursor} search={q} category={category} sort={sort} />
          </>
        )}
      </BotsShell>
    );
  }

  // Landing: staff picks, popular, new, categories, then everything.
  const featured = pageDirectory(all, { featuredOnly: true, limit: 6 }).items;
  const popular = pageDirectory(all, { sort: "popular", limit: 6 }).items;
  const fresh = pageDirectory(all, { sort: "new", limit: 6 }).items;
  const allByName = pageDirectory(all, { sort: "name" });
  const categoryCounts = APP_CATEGORIES.map((c) => ({ id: c, count: all.filter((a) => a.categories.includes(c)).length })).filter((c) => c.count > 0);
  const seeAll = (href: string) => (
    <Link href={href} className="hm-link inline-flex items-center gap-1 text-sm">
      {gt("See all")}
      <ArrowRight className="h-4 w-4 rtl:rotate-180" aria-hidden />
    </Link>
  );

  return (
    <BotsShell hero={hero}>
      {featured.length > 0 && (
        <BotSection id="featured" title={gt("Staff picks")} intro={gt("Bots the SerikaCord team recommends.")}>
          <BotGrid apps={featured} gt={gt} locale={locale} />
        </BotSection>
      )}
      <BotSection id="popular" title={gt("Popular")} intro={gt("In the most servers right now.")} more={seeAll("/bots?sort=popular")}>
        <BotGrid apps={popular} gt={gt} locale={locale} />
      </BotSection>
      {all.length > popular.length && (
        <BotSection id="new" title={gt("New")} intro={gt("Recently listed bots.")} more={seeAll("/bots?sort=new")}>
          <BotGrid apps={fresh} gt={gt} locale={locale} />
        </BotSection>
      )}
      {categoryCounts.length > 0 && (
        <BotSection id="categories" title={gt("Browse by category")}>
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 lg:grid-cols-4">
            {categoryCounts.map((c) => (
              <li key={c.id}>
                <Link
                  href={botsHref({ category: c.id })}
                  className="hm-card !rounded-2xl flex items-center justify-between gap-2 px-4 py-3 text-sm font-medium text-[var(--hm-ink)]"
                >
                  <span className="truncate">{appCategoryLabel(c.id, gt)}</span>
                  <span className="shrink-0 text-xs text-[var(--hm-faint)]">{c.count}</span>
                </Link>
              </li>
            ))}
          </ul>
        </BotSection>
      )}
      <BotSection id="all" title={gt("All bots")} intro={gt("Every listed bot, A to Z.")}>
        <BotGrid apps={allByName.items} gt={gt} locale={locale} />
        <BotsLoadMore key="all" initialCursor={allByName.nextCursor} search="" category={null} sort="name" />
      </BotSection>
    </BotsShell>
  );
}

function EmptyState({ icon, title, text, action }: { icon: "bot" | "search" | "error"; title: string; text: string; action?: ReactNode }) {
  const Icon = icon === "search" ? SearchX : Bot;
  return (
    <div className="hm-card mx-auto flex max-w-xl flex-col items-center gap-3 px-6 py-12 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[color-mix(in_srgb,var(--brand-violet)_16%,transparent)] text-[var(--hm-accent-text)]">
        <Icon className="h-6 w-6" aria-hidden />
      </span>
      <h2 className="hm-h3">{title}</h2>
      <p className="text-sm text-[var(--hm-body)]">{text}</p>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

"use client";

import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { Bot, Check, ExternalLink, Plus, SearchX } from "lucide-react";
import { useGT, useLocale } from "gt-next";
import { SettingsPageHeader } from "@/components/settings/SettingsSection";
import { settingsButtonClass } from "@/components/settings/blocks/SettingsButton";
import { SettingsEmptyState } from "@/components/settings/blocks/SettingsEmptyState";
import { SettingsSearchInput } from "@/components/settings/blocks/SettingsSearchInput";
import { SettingsToolbar } from "@/components/settings/blocks/SettingsToolbar";
import { Skeleton } from "@/components/ui/skeleton";
import { AppDirectoryCard, AppIcon, OfficialPill, VerifiedMark, formatCount, type AppCardData } from "@/components/apps/AppDirectoryCard";
import { APP_CATEGORIES, appCategoryLabel } from "@/lib/appDirectory/listing";
import { cn } from "@/lib/utils";

interface DirectoryApp extends AppCardData {
  installUrl: string | null;
}

interface InstalledApp {
  id: string;
  name: string;
  icon: string | null;
  shortDescription: string;
  verified: boolean;
  official?: boolean;
  listed: boolean;
}

interface Page {
  key: string;
  apps: DirectoryApp[];
  nextCursor: string | null;
  total: number;
}

// Last first page per query, so reopening the page shows it at once while it refreshes.
const pageCache = new Map<string, Page>();

function queryKey(search: string, category: string | null): string {
  return `${category ?? ""}|${search}`;
}

function directoryUrl(search: string, category: string | null, cursor?: string | null): string {
  const sp = new URLSearchParams({ limit: "24" });
  if (search) sp.set("search", search);
  if (category) sp.set("category", category);
  if (cursor) sp.set("cursor", cursor);
  return `/api/apps/directory?${sp.toString()}`;
}

/** Same-origin OAuth2 link with this server preselected on the consent page. */
function withServer(installUrl: string, serverId: string): string {
  if (!installUrl.startsWith("/oauth2/authorize?")) return installUrl;
  const url = new URL(installUrl, "https://serika.chat");
  url.searchParams.set("guild_id", serverId);
  return `${url.pathname}${url.search}`;
}

/**
 * Server Settings → App Discovery: the public App Directory (same API and
 * cards as /bots) with "Add to Server" preselecting this server, plus the
 * apps already installed here.
 */
export const AppDiscoveryPage = memo(function AppDiscoveryPage({ serverId }: { serverId: string }) {
  const gt = useGT();
  const locale = useLocale();
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const key = queryKey(query, category);
  const [page, setPage] = useState<Page | null>(() => pageCache.get(queryKey("", null)) ?? null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [installed, setInstalled] = useState<{ serverId: string; apps: InstalledApp[] } | null>(null);

  // Debounce typing before hitting the API.
  useEffect(() => {
    const handle = window.setTimeout(() => setQuery(search.trim().slice(0, 100)), 300);
    return () => window.clearTimeout(handle);
  }, [search]);

  useEffect(() => {
    const controller = new AbortController();
    fetch(directoryUrl(query, category), { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as { apps: DirectoryApp[]; nextCursor: string | null; total: number };
        const next: Page = { key, apps: data.apps, nextCursor: data.nextCursor, total: data.total };
        pageCache.set(key, next);
        setPage(next);
        setFailed(null);
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        const cached = pageCache.get(key);
        if (cached) setPage(cached);
        setFailed(key);
      });
    return () => controller.abort();
  }, [key, query, category]);

  const loadInstalled = useCallback(() => {
    fetch(`/api/apps/installed?serverId=${encodeURIComponent(serverId)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) setInstalled({ serverId, apps: (data.apps || []) as InstalledApp[] });
      })
      .catch(() => {});
  }, [serverId]);

  useEffect(() => {
    loadInstalled();
    // Coming back from the consent page in another tab: refresh what's installed.
    window.addEventListener("focus", loadInstalled);
    return () => window.removeEventListener("focus", loadInstalled);
  }, [loadInstalled]);

  const loadMore = async () => {
    if (!page?.nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await fetch(directoryUrl(query, category, page.nextCursor));
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { apps: DirectoryApp[]; nextCursor: string | null };
      setPage((prev) => {
        if (!prev || prev.key !== key) return prev;
        const seen = new Set(prev.apps.map((a) => a.id));
        return { ...prev, apps: [...prev.apps, ...data.apps.filter((a) => !seen.has(a.id))], nextCursor: data.nextCursor };
      });
    } catch {
      setFailed(key);
    } finally {
      setLoadingMore(false);
    }
  };

  const installedApps = useMemo(() => (installed?.serverId === serverId ? installed.apps : []), [installed, serverId]);
  const installedIds = useMemo(() => new Set(installedApps.map((a) => a.id)), [installedApps]);
  const firstLoad = page === null;
  const refreshing = !firstLoad && page.key !== key;
  const apps = page?.apps ?? [];

  return (
    <div className="space-y-5">
      <SettingsPageHeader
        title={gt("App Discovery")}
        description={gt("Find bots and apps for your server. Adding one opens the permission screen with this server selected.")}
        className="mb-2"
      />

      {installedApps.length > 0 && (
        <section aria-labelledby="installed-apps-title" className="space-y-2">
          <h3 id="installed-apps-title" className="text-xs font-bold uppercase tracking-[0.04em] text-[var(--text-secondary)]">
            {gt("Installed in this server")}
          </h3>
          <ul className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
            {installedApps.map((app) => (
              <li key={app.id} className="flex w-56 shrink-0 items-center gap-2.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-app)] p-2.5">
                <AppIcon icon={app.icon} name={app.name} size={32} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1">
                    <span className="truncate text-sm font-semibold text-[var(--text-primary)]">{app.name}</span>
                    {app.verified && <VerifiedMark label={gt("Verified app")} className="[&_svg]:h-3.5 [&_svg]:w-3.5" />}
                    {app.official && <OfficialPill label={gt("Official")} hint={gt("Made by SerikaCord")} />}
                  </div>
                  {app.listed ? (
                    <a href={`/bots/${app.id}`} target="_blank" rel="noopener noreferrer" className="text-xs text-[var(--app-accent)] hover:underline">
                      {gt("View page")}
                    </a>
                  ) : (
                    <span className="text-xs text-[var(--text-muted)]">{gt("Not in the directory")}</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <SettingsToolbar>
        <SettingsSearchInput
          value={search}
          onValueChange={setSearch}
          placeholder={gt("Search bots and apps...")}
          clearLabel={gt("Clear search")}
          className="w-full"
        />
      </SettingsToolbar>

      <div role="group" aria-label={gt("Categories")} className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 scrollbar-none">
        {[null, ...APP_CATEGORIES].map((c) => {
          const active = category === c;
          return (
            <button
              key={c ?? "all"}
              type="button"
              aria-pressed={active}
              onClick={() => setCategory(c)}
              className={cn(
                "h-7 shrink-0 rounded-full border px-3 text-xs font-medium transition-colors",
                active
                  ? "border-[var(--app-accent)] bg-[var(--app-accent)] text-[var(--text-on-accent)]"
                  : "border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]",
              )}
            >
              {c ? appCategoryLabel(c, gt) : gt("All")}
            </button>
          );
        })}
      </div>

      {failed === key && apps.length === 0 ? (
        <SettingsEmptyState icon={SearchX} title={gt("Couldn't load the App Directory")} description={gt("Check your connection and try again.")} />
      ) : firstLoad ? (
        <div aria-hidden className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-[176px] rounded-2xl" />
          ))}
        </div>
      ) : apps.length === 0 && !refreshing ? (
        <SettingsEmptyState
          icon={Bot}
          title={query || category ? gt("No bots found matching your search") : gt("No bots are listed in the directory yet")}
          description={!query && !category ? gt("Developers can list public bots from the developer portal.") : undefined}
        />
      ) : (
        <>
          <ul className={cn("grid grid-cols-1 gap-3 transition-opacity sm:grid-cols-2", refreshing && "opacity-60")}>
            {apps.map((app) => {
              const isInstalled = installedIds.has(app.id);
              return (
                <li key={app.id}>
                  <AppDirectoryCard
                    app={app}
                    labels={{
                      verified: gt("Verified app"),
                      official: gt("Official"),
                      officialHint: gt("Made by SerikaCord"),
                      noDescription: gt("No description yet."),
                      servers: app.serverCount === 1 ? gt("1 server") : gt("{count} servers", { count: formatCount(app.serverCount, locale) }),
                      categories: app.categories.map((c) => appCategoryLabel(c, gt)),
                    }}
                    action={
                      <>
                        {isInstalled ? (
                          <span className={settingsButtonClass("secondary", "sm", "pointer-events-none")}>
                            <Check aria-hidden />
                            {gt("Installed")}
                          </span>
                        ) : app.installUrl ? (
                          <a href={withServer(app.installUrl, serverId)} className={settingsButtonClass("primary", "sm")}>
                            <Plus aria-hidden />
                            {gt("Add to Server")}
                          </a>
                        ) : null}
                        <a href={`/bots/${app.id}`} target="_blank" rel="noopener noreferrer" className={settingsButtonClass("ghost", "sm")}>
                          {gt("Details")}
                          <ExternalLink aria-hidden />
                        </a>
                      </>
                    }
                  />
                </li>
              );
            })}
          </ul>
          {page?.nextCursor && page.key === key && (
            <div className="flex justify-center">
              <button type="button" onClick={() => void loadMore()} disabled={loadingMore} className={settingsButtonClass("secondary", "md")}>
                {loadingMore ? gt("Loading...") : gt("Load more")}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
});

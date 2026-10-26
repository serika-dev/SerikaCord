"use client";

import { memo, useEffect, useState } from "react";
import { Bot, Sparkles } from "lucide-react";
import { useGT } from "gt-next";
import { SettingsPageHeader } from "@/components/settings/SettingsSection";
import { settingsButtonClass } from "@/components/settings/blocks/SettingsButton";
import { SettingsEmptyState } from "@/components/settings/blocks/SettingsEmptyState";
import { SettingsSearchInput } from "@/components/settings/blocks/SettingsSearchInput";
import { SettingsToolbar } from "@/components/settings/blocks/SettingsToolbar";
import { Skeleton } from "@/components/ui/skeleton";
import { cdnImage, cn } from "@/lib/utils";

interface DiscoverableApp {
  id: string;
  name: string;
  description?: string | null;
  icon?: string | null;
  botId?: string | null;
  tags?: string[];
}

// Last results per query, so reopening the page shows them at once while it refreshes.
const resultCache = new Map<string, DiscoverableApp[]>();

/** Server Settings → App Discovery: search public bots and add them to the server. */
export const AppDiscoveryPage = memo(function AppDiscoveryPage({ serverId }: { serverId: string }) {
  const gt = useGT();
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<{ query: string; apps: DiscoverableApp[] } | null>(() => {
    const cached = resultCache.get("");
    return cached ? { query: "", apps: cached } : null;
  });

  // Debounce typing before hitting the API.
  useEffect(() => {
    const handle = window.setTimeout(() => setQuery(search.trim()), 300);
    return () => window.clearTimeout(handle);
  }, [search]);

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/developers/discoverable-apps${query ? `?search=${encodeURIComponent(query)}` : ""}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return;
        const apps = (data?.apps || []) as DiscoverableApp[];
        resultCache.set(query, apps);
        setResult({ query, apps });
      })
      .catch(() => {
        if (!cancelled) setResult({ query, apps: resultCache.get(query) ?? [] });
      });
    return () => {
      cancelled = true;
    };
  }, [query]);

  const apps = result?.apps ?? [];
  const firstLoad = result === null;
  const refreshing = !firstLoad && result.query !== query;

  return (
    <div className="space-y-4">
      <SettingsPageHeader title={gt("App Discovery")} description={gt("Browse and add public bots to your server")} className="mb-2" />

      <SettingsToolbar>
        <SettingsSearchInput
          value={search}
          onValueChange={setSearch}
          placeholder={gt("Search bots and apps...")}
          clearLabel={gt("Clear search")}
          className="w-full"
        />
      </SettingsToolbar>

      {firstLoad ? (
        <div aria-hidden className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-[92px] rounded-lg" />
          ))}
        </div>
      ) : apps.length === 0 ? (
        <SettingsEmptyState
          icon={Bot}
          title={query ? gt("No bots found matching your search") : gt("No public bots available yet")}
        />
      ) : (
        <div className={cn("grid grid-cols-1 gap-3 transition-opacity sm:grid-cols-2", refreshing && "opacity-60")}>
          {apps.map((app) => (
            <div
              key={app.id}
              className="flex items-start gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-app)] p-4 transition-colors duration-(--motion-fast) hover:border-[var(--border-strong)]"
            >
              <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-[color-mix(in_srgb,var(--app-accent)_18%,transparent)]">
                {app.icon ? (
                  <img src={cdnImage(app.icon)} alt={app.name} className="h-full w-full object-cover" />
                ) : (
                  <Bot className="h-6 w-6 text-[var(--app-accent)]" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-semibold text-[var(--text-primary)]">{app.name}</span>
                  {app.botId && <Sparkles className="h-3 w-3 shrink-0 text-[var(--app-accent)]" />}
                </div>
                <p className="mt-0.5 line-clamp-2 text-xs text-[var(--text-secondary)]">{app.description || gt("No description")}</p>
                {Array.isArray(app.tags) && app.tags.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {app.tags.slice(0, 3).map((tag) => (
                      <span key={tag} className="rounded bg-[var(--bg-hover)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--text-secondary)]">
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <a href={`/api/developers/applications/${app.id}/add?server_id=${serverId}`} className={settingsButtonClass("primary", "sm")}>
                {gt("Add")}
              </a>
            </div>
          ))}
        </div>
      )}
    </div>
  );
});

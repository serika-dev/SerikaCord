"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useGT, useLocale } from "gt-next";
import { AppDirectoryCard, formatCount, type AppCardData } from "@/components/apps/AppDirectoryCard";
import { appCategoryLabel } from "@/lib/appDirectory/listing";

interface Props {
  /** Cursor after the server-rendered first page (null = nothing more). */
  initialCursor: string | null;
  search: string;
  category: string | null;
  sort: string;
}

/**
 * Infinite scroll for /bots: appends the next pages of the public directory
 * API under the server-rendered first page. Loads automatically when the
 * sentinel scrolls into view; the button is the fallback (and keyboard path).
 */
export function BotsLoadMore({ initialCursor, search, category, sort }: Props) {
  const gt = useGT();
  const locale = useLocale();
  const [apps, setApps] = useState<AppCardData[]>([]);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const sentinel = useRef<HTMLDivElement>(null);
  const busy = useRef(false);

  const loadMore = useCallback(async () => {
    if (!cursor || busy.current) return;
    busy.current = true;
    setLoading(true);
    setFailed(false);
    try {
      const sp = new URLSearchParams({ cursor, sort });
      if (search) sp.set("search", search);
      if (category) sp.set("category", category);
      const res = await fetch(`/api/apps/directory?${sp.toString()}`);
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { apps: AppCardData[]; nextCursor: string | null };
      setApps((prev) => {
        const seen = new Set(prev.map((a) => a.id));
        return [...prev, ...data.apps.filter((a) => !seen.has(a.id))];
      });
      setCursor(data.nextCursor);
    } catch {
      setFailed(true);
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }, [cursor, search, category, sort]);

  useEffect(() => {
    const el = sentinel.current;
    if (!el || !cursor || failed || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) void loadMore();
    }, { rootMargin: "600px 0px" });
    observer.observe(el);
    return () => observer.disconnect();
  }, [cursor, failed, loadMore]);

  return (
    <>
      {apps.length > 0 && (
        <ul className="mt-3 grid grid-cols-1 gap-3 sm:mt-4 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
          {apps.map((app) => (
            <li key={app.id}>
              <AppDirectoryCard
                app={app}
                href={`/bots/${app.id}`}
                labels={{
                  verified: gt("Verified app"),
                  noDescription: gt("No description yet."),
                  servers: app.serverCount === 1 ? gt("1 server") : gt("{count} servers", { count: formatCount(app.serverCount, locale) }),
                  categories: app.categories.map((c) => appCategoryLabel(c, gt)),
                }}
              />
            </li>
          ))}
        </ul>
      )}
      {cursor && (
        <div ref={sentinel} className="mt-8 flex flex-col items-center gap-2">
          {failed && <p className="text-sm text-[var(--hm-body)]">{gt("Couldn't load more bots.")}</p>}
          <button type="button" onClick={() => void loadMore()} disabled={loading} className="hm-btn hm-btn-ghost hm-btn-sm disabled:opacity-60">
            {loading ? gt("Loading...") : failed ? gt("Try again") : gt("Load more")}
          </button>
        </div>
      )}
    </>
  );
}

"use client";

import { useEffect, useState } from "react";
import { useGT } from "gt-next";
import { BadgeCheck, BookOpen, Plus, ShieldCheck } from "lucide-react";
import { getJsonCached } from "@/lib/swrJson";

/** GET /api/apps/by-bot/:userId (src/lib/services/appDirectory.ts BotAppSummary). */
interface BotApp {
  /** Only set when the app has a /bots page. */
  id: string | null;
  name: string;
  verified: boolean;
  official: boolean;
  listed: boolean;
  installUrl: string | null;
}

/**
 * The app behind a bot user, on its profile card: "Official app" (made by
 * SerikaCord) or "Verified app", plus "Add to Server" for public bots and a
 * link to its /bots page when it is listed. Renders nothing for bots without
 * an app (or while loading). Only mounted when a bot's card is open.
 */
export function BotAppProfileSection({ botUserId }: { botUserId: string }) {
  const gt = useGT();
  const [loaded, setLoaded] = useState<{ id: string; app: BotApp | null } | null>(null);

  useEffect(() => {
    let active = true;
    void getJsonCached<{ app?: BotApp }>(`/api/apps/by-bot/${encodeURIComponent(botUserId)}`, 60_000).then((data) => {
      if (active) setLoaded({ id: botUserId, app: data?.app ?? null });
    });
    return () => {
      active = false;
    };
  }, [botUserId]);

  const app = loaded?.id === botUserId ? loaded.app : null;
  if (!app) return null;
  const showStatus = app.official || app.verified;
  const pageHref = app.listed && app.id ? `/bots/${app.id}` : null;
  if (!showStatus && !app.installUrl && !pageHref) return null;

  const buttons = [app.installUrl, pageHref].filter(Boolean).length;
  const btn = "inline-flex h-9 min-w-0 items-center justify-center gap-1.5 rounded-lg px-3 text-[13px] font-semibold transition-colors";

  return (
    <div className="mt-4 overflow-hidden rounded-xl border border-white/[0.06] bg-[linear-gradient(135deg,color-mix(in_srgb,var(--app-accent)_12%,transparent),transparent_70%)] p-3">
      {showStatus && (
        <div className="flex items-center gap-2.5">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[color-mix(in_srgb,var(--app-accent)_18%,transparent)] text-[var(--app-accent)]">
            {app.official ? <ShieldCheck className="size-[18px]" aria-hidden /> : <BadgeCheck className="size-[18px]" aria-hidden />}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-[#ededf5]">{app.official ? gt("Official app") : gt("Verified app")}</p>
            <p className="truncate text-xs text-[#9a9aad]">
              {app.official ? gt("Made by SerikaCord") : gt("Reviewed and verified by the SerikaCord team")}
            </p>
          </div>
        </div>
      )}
      {buttons > 0 && (
        <div className={`${showStatus ? "mt-3 " : ""}grid gap-2 ${buttons === 2 ? "grid-cols-2" : "grid-cols-1"}`}>
          {app.installUrl && (
            <a
              href={app.installUrl}
              className={`${btn} bg-[var(--app-accent)] text-[var(--text-on-accent)] hover:opacity-90`}
            >
              <Plus className="size-4 shrink-0" aria-hidden />
              <span className="truncate">{gt("Add to Server")}</span>
            </a>
          )}
          {pageHref && (
            <a
              href={pageHref}
              target="_blank"
              rel="noopener noreferrer"
              className={`${btn} bg-white/[0.07] text-white hover:bg-white/[0.12]`}
            >
              <BookOpen className="size-4 shrink-0" aria-hidden />
              <span className="truncate">{gt("Bot page")}</span>
            </a>
          )}
        </div>
      )}
    </div>
  );
}

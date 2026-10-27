"use client";

import { useEffect, useState } from "react";
import { useGT } from "gt-next";
import { BadgeCheck, ExternalLink, Plus } from "lucide-react";
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

  return (
    <div className="mt-4 rounded-lg border border-white/[0.05] bg-white/[0.03] p-3">
      {showStatus && (
        <div className="mb-2.5 flex items-start gap-2">
          <BadgeCheck className="mt-0.5 h-4 w-4 shrink-0 text-[var(--app-accent)]" aria-hidden />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[#e2e2ee]">{app.official ? gt("Official app") : gt("Verified app")}</p>
            <p className="text-xs text-[#9a9aad]">
              {app.official ? gt("Made by SerikaCord") : gt("Reviewed and verified by the SerikaCord team")}
            </p>
          </div>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {app.installUrl && (
          <a
            href={app.installUrl}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--app-accent)] px-3 py-1.5 text-sm font-medium text-[var(--text-on-accent)] transition-opacity hover:opacity-90"
          >
            <Plus className="h-4 w-4" aria-hidden />
            {gt("Add to Server")}
          </a>
        )}
        {pageHref && (
          <a
            href={pageHref}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg bg-white/[0.06] px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-white/[0.12]"
          >
            {gt("View in bot library")}
            <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          </a>
        )}
      </div>
    </div>
  );
}

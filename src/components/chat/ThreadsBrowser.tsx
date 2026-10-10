"use client";

import { useEffect, useMemo, useState } from "react";
import { Archive, Lock, MessagesSquare, Plus, Search } from "lucide-react";
import { useGT } from "gt-next";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Loader } from "@/components/ui/Loader";
import { cn, cdnImage } from "@/lib/utils";
import { decodeHtmlEntities } from "@/lib/chat/messages";
import { renderMentionText } from "@/lib/chat/mentionText";
import {
  filterThreadsByName,
  formatThreadCount,
  partitionThreads,
  threadActivityMs,
  type ThreadSummary,
} from "@/lib/chat/threads";

type BrowserThread = ThreadSummary & { joined?: boolean };

interface ThreadsBrowserProps {
  channelId: string;
  channelName: string;
  /** Bumped by the channel stream (thread created / updated) to refetch. */
  version: number;
  canCreate: boolean;
  onOpenThread: (threadId: string) => void;
  onCreate: () => void;
}

function since(ms: number, locale?: string): string {
  if (!ms) return "";
  const diff = Date.now() - ms;
  const min = Math.floor(diff / 60_000);
  try {
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto", style: "short" });
    if (min < 60) return rtf.format(-Math.max(1, min), "minute");
    const h = Math.floor(min / 60);
    if (h < 24) return rtf.format(-h, "hour");
    return rtf.format(-Math.floor(h / 24), "day");
  } catch {
    return new Date(ms).toLocaleDateString();
  }
}

/**
 * The channel header's threads browser (Discord's Threads popout): joined and
 * other active threads, archived threads on their own tab, a name search and
 * a "Create" button. Lazy-loaded on first open.
 */
export function ThreadsBrowser({ channelId, channelName, version, canCreate, onOpenThread, onCreate }: ThreadsBrowserProps) {
  const gt = useGT();
  const [tab, setTab] = useState<"active" | "archived">("active");
  const [query, setQuery] = useState("");
  const [loaded, setLoaded] = useState<{ key: string; threads: BrowserThread[] } | null>(null);
  const key = `${channelId}:${version}`;

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/channels/${channelId}/threads?archived=true`, { credentials: "include" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return;
        setLoaded({ key: `${channelId}:${version}`, threads: (data?.threads as BrowserThread[] | undefined) ?? [] });
      })
      .catch(() => {
        if (!cancelled) setLoaded({ key: `${channelId}:${version}`, threads: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [channelId, version]);

  // Keep showing the previous list while a refetch runs.
  const threads = useMemo(() => loaded?.threads ?? [], [loaded]);
  const isLoading = !loaded || (loaded.key !== key && threads.length === 0);
  const parts = useMemo(
    () => partitionThreads(filterThreadsByName(threads, query), (t) => Boolean(t.joined)),
    [threads, query],
  );

  const row = (t: BrowserThread) => {
    const last = t.lastMessage;
    const text = last ? renderMentionText(decodeHtmlEntities(last.content || "")).replace(/\s+/g, " ").trim() : "";
    return (
      <button
        key={t.id}
        type="button"
        onClick={() => onOpenThread(t.id)}
        className="flex w-full flex-col gap-1 rounded-md px-3 py-2 text-left transition-colors hover:bg-[var(--app-surface-alt)]"
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-sm font-semibold text-[var(--text-primary)]">{decodeHtmlEntities(t.name)}</span>
          {t.type === "private_thread" && <Lock className="h-3 w-3 shrink-0 text-[var(--app-muted)]" aria-label={gt("Private thread")} />}
          {t.locked ? (
            <Lock className="h-3 w-3 shrink-0 text-[var(--app-muted)]" aria-label={gt("Locked")} />
          ) : t.archived ? (
            <Archive className="h-3 w-3 shrink-0 text-[var(--app-muted)]" aria-label={gt("Archived")} />
          ) : null}
        </span>
        <span className="flex min-w-0 items-center gap-1.5 text-xs text-[var(--app-muted)]">
          {last?.author && (
            <Avatar className="h-4 w-4 shrink-0">
              <AvatarImage src={cdnImage(last.author.avatar)} loading="lazy" alt="" />
              <AvatarFallback className="bg-[var(--app-accent)] text-[8px] text-[var(--text-on-accent)]">
                {(last.author.displayName || last.author.username || "?").charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
          )}
          {last?.author && <span className="shrink-0 font-medium text-[var(--text-secondary)]">{last.author.displayName}</span>}
          <span className="min-w-0 truncate">{text || (last ? gt("(attachment)") : gt("No messages yet"))}</span>
          <span className="ml-auto shrink-0 whitespace-nowrap">
            {gt("{count} messages", { count: formatThreadCount(t.messageCount) })} · {since(threadActivityMs(t))}
          </span>
        </span>
      </button>
    );
  };

  const section = (title: string, list: BrowserThread[]) =>
    list.length === 0 ? null : (
      <div className="mb-2">
        <p className="px-3 pb-1 pt-2 text-[11px] font-bold uppercase tracking-wide text-[var(--app-muted)]">
          {title} — {list.length}
        </p>
        {list.map(row)}
      </div>
    );

  const empty = tab === "active" ? parts.joined.length + parts.other.length === 0 : parts.archived.length === 0;

  return (
    <div className="flex max-h-[min(32rem,70vh)] w-[min(26rem,calc(100vw-1rem))] flex-col">
      <div className="flex items-center gap-2 border-b border-[var(--app-border)] px-3 py-2">
        <MessagesSquare className="h-5 w-5 shrink-0 text-[var(--app-muted)]" />
        <span className="font-semibold text-[var(--text-primary)]">{gt("Threads")}</span>
        <div className="relative ml-auto min-w-0 flex-1">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={gt("Search for Thread Name")}
            aria-label={gt("Search for Thread Name")}
            className="h-7 w-full rounded bg-[var(--app-surface-alt)] pl-2 pr-7 text-sm text-[var(--text-primary)] placeholder:text-[var(--app-muted)] focus:outline-none"
          />
          <Search className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--app-muted)]" />
        </div>
        {canCreate && (
          <button
            type="button"
            onClick={onCreate}
            className="flex shrink-0 items-center gap-1 rounded-md bg-[var(--app-accent)] px-2 py-1 text-xs font-semibold text-[var(--text-on-accent)] transition-opacity hover:opacity-90"
          >
            <Plus className="h-3.5 w-3.5" />
            {gt("Create")}
          </button>
        )}
      </div>
      <div className="flex gap-1 border-b border-[var(--app-border)] px-2 py-1.5" role="tablist">
        {(["active", "archived"] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={cn(
              "rounded px-2 py-0.5 text-sm transition-colors",
              tab === t ? "bg-[var(--app-surface-alt)] text-[var(--text-primary)]" : "text-[var(--app-muted)] hover:text-[var(--text-primary)]",
            )}
          >
            {t === "active" ? gt("Active") : gt("Archived")}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader size={20} />
          </div>
        ) : empty ? (
          <div className="flex flex-col items-center gap-2 px-6 py-8 text-center">
            <MessagesSquare className="h-10 w-10 text-[var(--app-muted)]" />
            <p className="font-semibold text-[var(--text-primary)]">
              {tab === "active" ? gt("There are no threads.") : gt("There are no archived threads.")}
            </p>
            <p className="text-sm text-[var(--app-muted)]">
              {gt("Stay focused on a conversation in #{channel} with a thread.", { channel: channelName })}
            </p>
          </div>
        ) : tab === "active" ? (
          <>
            {section(gt("Joined Threads"), parts.joined)}
            {section(gt("Other Active Threads"), parts.other)}
          </>
        ) : (
          section(gt("Archived Threads"), parts.archived)
        )}
      </div>
    </div>
  );
}

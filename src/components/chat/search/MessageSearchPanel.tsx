"use client";

import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { useGT, useLocale } from "gt-next";
import {
  ChevronLeft,
  ChevronRight,
  FileText,
  Film,
  Hash,
  Image as ImageIcon,
  MessagesSquare,
  Music,
  Pin,
  SearchX,
  Users,
  X,
} from "lucide-react";
import { cn, cdnImage } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Loader } from "@/components/ui/Loader";
import { MessageContent } from "@/components/chat/MessageContent";
import { ChatGtProvider } from "@/components/chat/ChatGtContext";
import { formatMessageTimestamp } from "@/lib/chat/messages";
import { groupSearchHits, searchPageNumbers, SEARCH_RESULTS_PER_PAGE } from "@/lib/chat/searchClient";
import { parseSearchQuery } from "@/lib/chat/searchQuery";
import { queryTerms, searchWords } from "@/lib/chat/searchTokens";
import type { MessageSearchController, SearchHit, SearchHitChannel } from "@/hooks/useMessageSearch";
import type { SearchSort } from "@/lib/chat/searchQuery";

const HIGHLIGHT_NAME = "serika-search-hit";

/**
 * Discord-style search results panel (right side on desktop, full screen on
 * mobile): result count, Newest / Oldest / Most Relevant, hits grouped by
 * channel, jump-to-message, numbered pagination and matched words
 * highlighted. Lazy-loaded by its containers.
 */
export function MessageSearchPanel({
  search,
  onJump,
  onClose,
  serverEmojis,
  mobile = false,
  searchBar,
}: {
  search: MessageSearchController;
  onJump: (hit: SearchHit, channel: SearchHitChannel | null) => void;
  onClose: () => void;
  serverEmojis?: Array<{ id: string; name: string; url: string; animated?: boolean }>;
  mobile?: boolean;
  /** Mobile: the search bar rendered at the top of the sheet. */
  searchBar?: ReactNode;
}) {
  const gt = useGT();
  const locale = useLocale();
  const listRef = useRef<HTMLDivElement>(null);
  const { results, loading, error, sort, page, submitted } = search;

  const channelMap = useMemo(() => new Map((results?.channels || []).map((c) => [c.id, c])), [results]);
  const groups = useMemo(() => groupSearchHits(results?.messages || []), [results]);
  const mentionUsers = useMemo(
    () => (results?.users || []).map((u) => ({ id: u.id, username: u.username, displayName: u.displayName })),
    [results],
  );
  const total = results?.totalResults ?? 0;
  const pageCount = Math.ceil(Math.min(total, results?.pageableResults ?? total) / SEARCH_RESULTS_PER_PAGE);
  const terms = useMemo(() => queryTerms(parseSearchQuery(submitted).text), [submitted]);

  // Highlight matched words with the CSS Custom Highlight API (no DOM
  // changes; browsers without it just show plain results).
  useEffect(() => {
    const root = listRef.current;
    const registry = (globalThis as { CSS?: { highlights?: Map<string, unknown> } }).CSS?.highlights;
    const HighlightCtor = (globalThis as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
    if (!root || !registry || !HighlightCtor) return;
    if (terms.length === 0) {
      registry.delete(HIGHLIGHT_NAME);
      return;
    }
    const ranges: Range[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const wordRe = /[\p{L}\p{N}]+/gu;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = (node as Text).parentElement;
      if (!parent?.closest("[data-search-content]")) continue;
      const text = node.nodeValue || "";
      for (const m of text.matchAll(wordRe)) {
        const words = searchWords(m[0]);
        if (!words.some((w) => terms.some((t) => w === t || w.startsWith(t)))) continue;
        const range = document.createRange();
        range.setStart(node, m.index ?? 0);
        range.setEnd(node, (m.index ?? 0) + m[0].length);
        ranges.push(range);
      }
    }
    registry.set(HIGHLIGHT_NAME, new HighlightCtor(...ranges));
    return () => {
      registry.delete(HIGHLIGHT_NAME);
    };
  }, [results, terms]);

  // New page / sort: back to the top of the list.
  useEffect(() => {
    listRef.current?.scrollTo({ top: 0 });
  }, [results]);

  const sortTabs: Array<{ id: SearchSort; label: string }> = [
    { id: "newest", label: gt("Newest") },
    { id: "oldest", label: gt("Oldest") },
    { id: "relevant", label: gt("Most Relevant") },
  ];

  const channelLabel = (channel: SearchHitChannel | undefined | null): { icon: ReactNode; text: string } => {
    if (!channel) return { icon: <Hash className="w-4 h-4" />, text: gt("Unknown channel") };
    if (channel.type === "dm") {
      return { icon: <MessagesSquare className="w-4 h-4" />, text: channel.recipientNames?.[0] || gt("Direct Message") };
    }
    if (channel.type === "group_dm") {
      return { icon: <Users className="w-4 h-4" />, text: channel.name || (channel.recipientNames || []).join(", ") || gt("Group") };
    }
    if (channel.parentName) return { icon: <Hash className="w-4 h-4" />, text: `${channel.parentName} › ${channel.name}` };
    return { icon: <Hash className="w-4 h-4" />, text: channel.name };
  };

  const attachmentIcon = (contentType: string, name: string) => {
    if (contentType.startsWith("image/") || /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i.test(name)) return <ImageIcon className="w-3.5 h-3.5" />;
    if (contentType.startsWith("video/") || /\.(mp4|webm|mov|mkv|m4v)$/i.test(name)) return <Film className="w-3.5 h-3.5" />;
    if (contentType.startsWith("audio/") || /\.(mp3|ogg|wav|flac|m4a|opus)$/i.test(name)) return <Music className="w-3.5 h-3.5" />;
    return <FileText className="w-3.5 h-3.5" />;
  };

  return (
    <aside
      className={cn(
        "flex flex-col min-h-0 bg-[var(--app-surface)] text-[var(--text-primary)]",
        mobile
          ? "fixed inset-0 z-[60] safe-area-top"
          : "w-[420px] xl:w-[460px] shrink-0 border-l border-[var(--app-border)] h-full",
      )}
      aria-label={gt("Search results")}
    >
      <style>{`::highlight(${HIGHLIGHT_NAME}) { background-color: color-mix(in srgb, var(--app-accent) 38%, transparent); color: inherit; }`}</style>
      {mobile && (
        <div className="flex items-center gap-2 px-2 py-2 border-b border-[var(--app-border)]">
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg text-[var(--app-muted)] hover:text-[var(--text-primary)]"
            aria-label={gt("Close search")}
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div className="flex-1 min-w-0">{searchBar}</div>
        </div>
      )}

      {submitted && (
        <div className="px-4 pt-3 pb-2 border-b border-[var(--app-border)] flex-shrink-0">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold truncate">
              {loading && !results
                ? gt("Searching...")
                : total >= 10000
                  ? gt("10,000+ Results")
                  : total === 1 ? gt("1 Result") : gt("{count} Results", { count: total.toLocaleString(locale) })}
            </p>
            {!mobile && (
              <button
                type="button"
                onClick={onClose}
                className="p-1 rounded text-[var(--app-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--app-surface-alt)]"
                aria-label={gt("Close search")}
                title={gt("Close")}
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
          <div className="mt-2 flex items-center gap-1" role="tablist" aria-label={gt("Sort results")}>
            {sortTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={sort === tab.id}
                onClick={() => search.setSort(tab.id)}
                className={cn(
                  "px-2 py-1 rounded text-xs font-medium transition-colors",
                  sort === tab.id
                    ? "bg-[var(--app-surface-alt)] text-[var(--text-primary)]"
                    : "text-[var(--app-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--app-surface-alt)]",
                )}
              >
                {tab.label}
              </button>
            ))}
            {loading && results && <Loader size={14} className="ml-auto" />}
          </div>
          {results?.indexing && (
            <p className="mt-2 text-xs text-[var(--app-muted)]">
              {gt("We're still indexing older messages, so some older results may be missing.")}
            </p>
          )}
        </div>
      )}

      <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-3">
        {!submitted ? (
          <div className="px-2 py-8 text-center text-sm text-[var(--app-muted)]">
            {gt("Search messages, or use filters like from:, mentions:, has:, in:, before:, during:, after: and pinned:.")}
          </div>
        ) : loading && !results ? (
          <div className="space-y-3" aria-busy="true">
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} className="rounded-lg bg-[var(--app-bg)] p-3 flex gap-3 animate-pulse">
                <div className="w-9 h-9 rounded-full bg-[var(--app-surface-alt)] shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 w-1/3 rounded bg-[var(--app-surface-alt)]" />
                  <div className="h-3 w-5/6 rounded bg-[var(--app-surface-alt)]" />
                </div>
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="py-10 text-center text-sm text-[var(--app-muted)]">
            {error === "error" ? gt("Something went wrong while searching. Try again.") : error}
          </div>
        ) : groups.length === 0 ? (
          <div className="py-12 flex flex-col items-center text-center gap-3 text-[var(--app-muted)]">
            <SearchX className="w-12 h-12 opacity-60" />
            <p className="text-sm font-medium text-[var(--text-primary)]">{gt("No results found")}</p>
            <p className="text-xs max-w-[260px]">{gt("Try different words, or remove some filters.")}</p>
          </div>
        ) : (
          <ChatGtProvider>
            {groups.map((group, gi) => {
              const channel = channelMap.get(group.channelId);
              const label = channelLabel(channel);
              return (
                <section key={`${group.channelId}-${gi}`} className="space-y-1.5">
                  <div className="flex items-center gap-1 px-1 text-xs font-semibold text-[var(--app-muted)]">
                    <span className="shrink-0 flex items-center">{label.icon}</span>
                    <span className="truncate">{label.text}</span>
                  </div>
                  {group.hits.map((hit) => {
                    const name = hit.author?.displayName || hit.author?.username || gt("Unknown User");
                    return (
                      <div
                        key={hit.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => onJump(hit, channel ?? null)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            onJump(hit, channel ?? null);
                          }
                        }}
                        className="group relative rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] px-3 py-2.5 cursor-pointer hover:bg-[var(--app-surface-alt)] focus-visible:outline-2 focus-visible:outline-[var(--app-accent)]"
                      >
                        <div className="flex gap-3">
                          <Avatar className="w-9 h-9 shrink-0 mt-0.5">
                            <AvatarImage src={cdnImage(hit.author?.avatar || undefined)} />
                            <AvatarFallback className="bg-[var(--app-accent)] text-white text-sm">
                              {name.charAt(0).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-baseline gap-1.5 min-w-0">
                              <span className="font-medium text-sm truncate">{name}</span>
                              {hit.author?.isBot && !hit.author?.isSystem && !hit.author?.isDiscord && (
                                <span className="shrink-0 px-1 py-px rounded text-[9px] font-bold uppercase bg-[var(--app-accent)] text-white">
                                  {hit.author?.isWebhook ? gt("Webhook") : gt("Bot")}
                                </span>
                              )}
                              <span className="shrink-0 text-[11px] text-[var(--app-muted)]">
                                {formatMessageTimestamp(hit.createdAt, gt, locale)}
                              </span>
                              {hit.pinned && <Pin className="w-3 h-3 shrink-0 text-[var(--app-muted)]" aria-label={gt("Pinned")} />}
                            </div>
                            {hit.content && (
                              <div data-search-content className="text-sm text-[var(--text-primary)] break-words">
                                <MessageContent
                                  content={hit.content}
                                  mentionUsers={mentionUsers}
                                  serverEmojis={serverEmojis}
                                  serverId={hit.serverId ?? undefined}
                                  edited={hit.edited}
                                  inline
                                />
                              </div>
                            )}
                            {hit.embeds.length > 0 && hit.embeds.some((e) => e.title || e.description) && (
                              <div data-search-content className="mt-1 border-l-4 border-[var(--app-border)] pl-2 text-xs text-[var(--app-muted)] line-clamp-3">
                                {hit.embeds[0].title && <span className="font-semibold text-[var(--text-primary)]">{hit.embeds[0].title} </span>}
                                {hit.embeds[0].description}
                              </div>
                            )}
                            {(hit.attachments.length > 0 || hit.sticker) && (
                              <div className="mt-1 flex flex-wrap gap-1">
                                {hit.attachments.slice(0, 6).map((a, ai) => (
                                  <span
                                    key={`${a.id || a.url}-${ai}`}
                                    data-search-content
                                    className="inline-flex max-w-full items-center gap-1 rounded bg-[var(--app-surface-alt)] px-1.5 py-0.5 text-xs text-[var(--app-muted)]"
                                  >
                                    {attachmentIcon(a.contentType || "", a.filename || a.url || "")}
                                    <span className="truncate">{a.filename || gt("Attachment")}</span>
                                  </span>
                                ))}
                                {hit.sticker && (
                                  <span className="inline-flex items-center gap-1 rounded bg-[var(--app-surface-alt)] px-1.5 py-0.5 text-xs text-[var(--app-muted)]">
                                    {gt("Sticker: {name}", { name: hit.sticker.name })}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                        <span className="absolute right-2 top-2 hidden group-hover:inline-flex group-focus-visible:inline-flex rounded bg-[var(--app-surface)] border border-[var(--app-border)] px-2 py-0.5 text-[11px] font-semibold text-[var(--text-primary)] shadow-sm">
                          {gt("Jump")}
                        </span>
                      </div>
                    );
                  })}
                </section>
              );
            })}
          </ChatGtProvider>
        )}
      </div>

      {pageCount > 1 && (
        <nav className="flex items-center justify-center gap-1 px-3 py-2 border-t border-[var(--app-border)] flex-shrink-0" aria-label={gt("Search result pages")}>
          <button
            type="button"
            disabled={page === 0 || loading}
            onClick={() => search.goToPage(page - 1)}
            className="p-1.5 rounded text-[var(--app-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--app-surface-alt)] disabled:opacity-40"
            aria-label={gt("Previous page")}
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          {searchPageNumbers(page, pageCount).map((n, i) =>
            n === null ? (
              <span key={`gap-${i}`} className="px-1 text-xs text-[var(--app-muted)]">…</span>
            ) : (
              <button
                key={n}
                type="button"
                disabled={loading}
                onClick={() => search.goToPage(n)}
                aria-current={n === page ? "page" : undefined}
                className={cn(
                  "min-w-7 h-7 px-1.5 rounded text-xs font-medium",
                  n === page
                    ? "bg-[var(--app-accent)] text-white"
                    : "text-[var(--app-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--app-surface-alt)]",
                )}
              >
                {n + 1}
              </button>
            ),
          )}
          <button
            type="button"
            disabled={page >= pageCount - 1 || loading}
            onClick={() => search.goToPage(page + 1)}
            className="p-1.5 rounded text-[var(--app-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--app-surface-alt)] disabled:opacity-40"
            aria-label={gt("Next page")}
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </nav>
      )}
    </aside>
  );
}

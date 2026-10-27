"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Search, X } from "lucide-react";
import { useGT } from "gt-next";
import { cn } from "@/lib/utils";
import { filterSettingsSections, findSettingsRowMatch } from "@/components/settings/settingsSearch";

/**
 * Desktop chrome shared by the full-screen user and server settings:
 * SettingsNav (grouped sidebar with search) + SettingsContent (scrolling page
 * column with a sticky compact header, the Discord-style ESC close button,
 * page-switch transition and a floating footer for the unsaved-changes bar).
 * Phones keep their own pushed-page layouts; everything here that would
 * clash is `max-md:hidden`.
 */

export interface SettingsNavItem<Id extends string = string> {
  id: Id;
  label: string;
  icon: LucideIcon | React.ComponentType<{ className?: string }>;
  /** Translated synonyms people may search for ("dark mode" → Appearance). */
  keywords?: string;
  /** Red count pill (pending applications, ...). */
  badge?: number;
  destructive?: boolean;
}

export interface SettingsNavSection<Id extends string = string> {
  title: string;
  items: SettingsNavItem<Id>[];
}

export function SettingsNav<Id extends string>({
  sections,
  activeId,
  onSelect,
  query,
  onQueryChange,
  header,
  footer,
  ariaLabel,
  className,
}: {
  sections: SettingsNavSection<Id>[];
  activeId: Id;
  onSelect: (id: Id) => void;
  /** Search box value; omit both query props to hide the search. */
  query?: string;
  onQueryChange?: (value: string) => void;
  header?: ReactNode;
  footer?: ReactNode;
  ariaLabel?: string;
  className?: string;
}) {
  const gt = useGT();
  const listRef = useRef<HTMLDivElement>(null);
  const searchable = typeof query === "string" && Boolean(onQueryChange);
  const visible = useMemo(
    () => (searchable ? filterSettingsSections(sections, query ?? "") : sections),
    [sections, query, searchable],
  );

  // Arrow keys move between items; Home/End jump to the ends.
  const handleListKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
    const items = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>("[data-settings-nav-item]") ?? []);
    if (items.length === 0) return;
    e.preventDefault();
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    let next = 0;
    if (e.key === "End") next = items.length - 1;
    else if (e.key === "ArrowDown") next = index < 0 ? 0 : Math.min(items.length - 1, index + 1);
    else if (e.key === "ArrowUp") next = index <= 0 ? 0 : index - 1;
    items[next]?.focus();
  };

  const firstMatch = visible[0]?.items[0];

  return (
    <nav
      aria-label={ariaLabel}
      className={cn(
        // Discord layout: on wide screens the sidebar grows to the left and
        // keeps its list pinned against the content.
        "hidden md:flex shrink-0 justify-end bg-[var(--bg-sidebar)] border-r border-[var(--border-subtle)] h-full min-h-0",
        "md:w-[232px] lg:w-[256px] xl:w-auto xl:flex-[1_0_256px]",
        className,
      )}
    >
      <div className="flex h-full min-h-0 w-full md:w-[232px] lg:w-[256px] flex-col">
        {header && <div className="shrink-0 px-3 pt-4">{header}</div>}

        {searchable && (
          <div className="shrink-0 px-3 pt-3 pb-1">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-muted)]" />
              <input
                type="search"
                value={query}
                data-settings-search
                onChange={(e) => onQueryChange?.(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && firstMatch) {
                    e.preventDefault();
                    onSelect(firstMatch.id);
                  } else if (e.key === "ArrowDown") {
                    e.preventDefault();
                    listRef.current?.querySelector<HTMLButtonElement>("[data-settings-nav-item]")?.focus();
                  }
                }}
                placeholder={gt("Search settings")}
                aria-label={gt("Search settings")}
                className="h-8 w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-app)] pl-8 pr-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none transition-[border-color,box-shadow] duration-(--motion-fast) focus:border-[color-mix(in_srgb,var(--app-accent)_60%,transparent)] focus:ring-2 focus:ring-[var(--app-accent)]/25 [&::-webkit-search-cancel-button]:hidden"
              />
            </div>
          </div>
        )}

        <div
          ref={listRef}
          onKeyDown={handleListKeyDown}
          className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain scrollbar-thin px-3 pb-6"
        >
          {visible.length === 0 && (
            <p className="px-2.5 py-6 text-center text-sm text-[var(--text-muted)]">{gt("No settings match your search.")}</p>
          )}
          {visible.map((section, i) => (
            <div key={`${section.title}:${i}`} className="pt-4">
              <h3 className="truncate px-2.5 pb-1.5 text-[11px] font-bold uppercase tracking-[0.06em] text-[var(--text-muted)]">
                {section.title}
              </h3>
              <div className="space-y-0.5">
                {section.items.map((item) => {
                  const active = item.id === activeId;
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      data-settings-nav-item
                      aria-current={active ? "page" : undefined}
                      onClick={() => onSelect(item.id)}
                      className={cn(
                        "settings-nav-item relative flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-sm",
                        item.destructive
                          ? "text-red-500 hover:bg-red-500/10"
                          : active
                            ? "bg-[var(--bg-active)] font-medium text-[var(--text-primary)]"
                            : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]",
                      )}
                    >
                      <Icon className={cn("h-4 w-4 shrink-0", active ? "text-[var(--app-accent)]" : "opacity-80")} />
                      <span className="min-w-0 flex-1 truncate">{item.label}</span>
                      {item.badge ? (
                        <span className="ml-auto min-w-[18px] rounded-full bg-red-500 px-1.5 py-0.5 text-center text-[10px] font-bold leading-none text-white">
                          {item.badge > 99 ? "99+" : item.badge}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          {footer && <div className="pt-3">{footer}</div>}
        </div>
      </div>
    </nav>
  );
}

/** Discord's round close button with the "ESC" caption under it. */
export function SettingsCloseButton({ onClose, label, className }: { onClose: () => void; label?: string; className?: string }) {
  const gt = useGT();
  return (
    <div className={cn("flex shrink-0 flex-col items-center gap-1", className)}>
      <button
        type="button"
        onClick={onClose}
        aria-label={label || gt("Close")}
        className="group flex h-9 w-9 items-center justify-center rounded-full border-2 border-[var(--border-strong)] text-[var(--text-secondary)] transition-[background-color,border-color,color,transform] duration-(--motion-fast) hover:border-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] active:scale-95"
      >
        <X className="h-[18px] w-[18px]" />
      </button>
      <span aria-hidden className="select-none text-[11px] font-semibold tracking-wide text-[var(--text-muted)]">
        ESC
      </span>
    </div>
  );
}

const PAGE_WIDTH = {
  narrow: "max-w-[740px]",
  wide: "max-w-[1100px]",
} as const;

/** Scroll distance after which the compact sticky header shows the title. */
const STICKY_TITLE_AFTER = 48;

export function SettingsContent({
  pageKey,
  title,
  width = "narrow",
  onClose,
  closeLabel,
  footer,
  highlightQuery,
  className,
  innerClassName,
  children,
}: {
  /** Changes on every page switch: resets scroll and replays the enter transition. */
  pageKey: string;
  title: ReactNode;
  width?: keyof typeof PAGE_WIDTH;
  onClose: () => void;
  closeLabel?: string;
  /** Floating bar pinned to the bottom (unsaved changes). */
  footer?: ReactNode;
  /**
   * The nav search query when the page was opened from search: the first row
   * whose label matches is scrolled into view and flashed.
   */
  highlightQuery?: string;
  className?: string;
  /** Extra classes for the page column (phone padding overrides, ...). */
  innerClassName?: string;
  children: ReactNode;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = useState(false);

  // New page: back to the top, then (from a search) jump to the matching row.
  // Latest query for the page-change effect without re-running it per keystroke
  // (declared first, so it is current when that effect runs in the same commit).
  const queryRef = useRef(highlightQuery);
  useEffect(() => {
    queryRef.current = highlightQuery;
  });
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    scroller.scrollTop = 0;
    const query = queryRef.current?.trim();
    if (!query) return;
    let frame = 0;
    let attempts = 0;
    // Pages that load their settings render rows a moment later: retry briefly.
    const tryHighlight = () => {
      const nodes = Array.from(scroller.querySelectorAll<HTMLElement>("[data-settings-label]"));
      const index = findSettingsRowMatch(nodes.map((n) => n.dataset.settingsLabel ?? ""), query);
      if (index >= 0) {
        const row = nodes[index].closest<HTMLElement>("[data-settings-row]") ?? nodes[index];
        row.scrollIntoView({ block: "center", behavior: "smooth" });
        row.classList.remove("settings-row-flash");
        void row.offsetWidth;
        row.classList.add("settings-row-flash");
        return;
      }
      if (++attempts < 20) frame = window.setTimeout(tryHighlight, 100);
    };
    frame = window.setTimeout(tryHighlight, 60);
    return () => window.clearTimeout(frame);
  }, [pageKey]);

  return (
    <div
      className={cn(
        "relative flex min-h-0 min-w-0 flex-1 flex-col bg-[var(--bg-card)]",
        // Wide screens: share the spare room with the sidebar (Discord) so the
        // nav + page sit together. A fixed ratio, so switching between narrow
        // and wide pages never moves the sidebar.
        "xl:flex-[2_1_820px]",
        className,
      )}
    >
      <div
        ref={scrollRef}
        onScroll={(e) => setScrolled(e.currentTarget.scrollTop > STICKY_TITLE_AFTER)}
        className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain scrollbar-thin [scrollbar-gutter:stable]"
      >
        {/* Sticky compact header (desktop): blank at the top of the page, the
            page title fades in once the big title has scrolled away. */}
        <div className="pointer-events-none sticky top-0 z-20 max-md:hidden">
          <div
            aria-hidden
            className={cn(
              "settings-sticky-header pointer-events-none absolute inset-x-0 top-0 h-16 border-b",
              scrolled
                ? "theme-solid border-[var(--border-subtle)] bg-[var(--bg-card)] shadow-[0_6px_16px_-12px_rgba(0,0,0,0.45)]"
                : "border-transparent bg-transparent",
            )}
          />
          <div className="pointer-events-none relative flex h-16 items-start gap-4 px-6 pt-3 lg:px-10">
            <div className={cn("flex h-9 min-w-0 flex-1 items-center", PAGE_WIDTH[width])}>
              <p
                aria-hidden
                className={cn(
                  "settings-sticky-title truncate text-[15px] font-semibold text-[var(--text-primary)]",
                  scrolled ? "opacity-100" : "translate-y-1 opacity-0",
                )}
              >
                {title}
              </p>
            </div>
            <SettingsCloseButton onClose={onClose} label={closeLabel} className="pointer-events-auto" />
          </div>
        </div>

        <div className="flex gap-4 px-4 md:-mt-4 md:px-6 lg:px-10">
          <div className={cn("min-w-0 flex-1 pb-28", PAGE_WIDTH[width], innerClassName)}>
            <div key={pageKey} className="settings-page-enter">
              {children}
            </div>
          </div>
          {/* Keeps the column aligned with the close button above. */}
          <div aria-hidden className="w-9 shrink-0 max-md:hidden" />
        </div>
      </div>

      {footer && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex gap-4 px-4 pb-4 md:px-6 lg:px-10 max-md:pb-[calc(0.75rem+var(--safe-area-bottom))]">
          <div className={cn("pointer-events-auto min-w-0 flex-1", PAGE_WIDTH[width])}>{footer}</div>
          <div aria-hidden className="w-9 shrink-0 max-md:hidden" />
        </div>
      )}
    </div>
  );
}

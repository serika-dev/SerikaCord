"use client";

import { useId, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useGT, useLocale } from "gt-next";
import { ChevronDown, Search, SquareSlash } from "lucide-react";
import type { PublicAppCommand } from "@/lib/services/appDirectory";

/** Lists longer than this start collapsed. */
const COLLAPSE_OVER = 10;
/** Rows shown while collapsed. */
const PREVIEW_COUNT = 8;
/** Lists longer than this get a filter box. */
const FILTER_OVER = 12;

/**
 * The Commands section of a public bot page. Long lists start collapsed to a
 * short preview with a "View all" toggle, and big bots get a filter box that
 * searches names and descriptions. Every row stays in the server-rendered
 * HTML (collapsed rows are `hidden`), so crawlers still see the full list.
 */
export function BotCommands({ commands }: { commands: PublicAppCommand[] }) {
  const gt = useGT();
  const locale = useLocale();
  const listId = useId();
  const sectionRef = useRef<HTMLElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState("");

  // Slash commands first, then user/message context menu commands.
  const ordered = [...commands.filter((c) => c.type === 1), ...commands.filter((c) => c.type === 2 || c.type === 3)];
  const total = ordered.length;
  const collapsible = total > COLLAPSE_OVER;
  const filterable = total > FILTER_OVER;
  const needle = query.trim().toLowerCase().replace(/^\//, "");
  const filtering = filterable && needle.length > 0;

  const matches = (c: PublicAppCommand) =>
    c.name.toLowerCase().includes(needle) || (c.type === 1 && c.description.toLowerCase().includes(needle));
  const isShown = (c: PublicAppCommand, index: number) =>
    filtering ? matches(c) : !collapsible || expanded || index < PREVIEW_COUNT;

  const matchCount = filtering ? ordered.filter(matches).length : total;
  const collapsed = collapsible && !expanded && !filtering;

  const toggle = () => {
    if (!expanded) {
      setExpanded(true);
      return;
    }
    // Collapsing from far down the list: once the rows are gone, jump back
    // to the section so the reader isn't left somewhere below it.
    const scrolledPast = (sectionRef.current?.getBoundingClientRect().top ?? 0) < 0;
    flushSync(() => setExpanded(false));
    if (scrolledPast) sectionRef.current?.scrollIntoView({ block: "start" });
  };

  return (
    <section ref={sectionRef} aria-labelledby="commands-title" className="scroll-mt-24">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 id="commands-title" className="hm-display hm-h2-page flex items-center gap-2.5">
          {gt("Commands")}
          <span className="rounded-full bg-[var(--hm-surface-2)] px-2.5 py-0.5 font-sans text-sm font-semibold tabular-nums text-[var(--hm-body)]">
            {total.toLocaleString(locale)}
          </span>
        </h2>
        {filterable && (
          <div className="relative w-full sm:w-64">
            <label htmlFor={`${listId}-filter`} className="sr-only">{gt("Filter commands")}</label>
            <Search className="pointer-events-none absolute start-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--hm-faint)]" aria-hidden />
            <input
              id={`${listId}-filter`}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              maxLength={100}
              autoComplete="off"
              spellCheck={false}
              placeholder={gt("Filter commands")}
              aria-controls={listId}
              className="h-10 w-full rounded-full border border-[var(--hm-line)] bg-[var(--hm-surface)] pe-4 ps-10 text-sm text-[var(--hm-ink)] outline-none placeholder:text-[var(--hm-faint)] focus:border-[var(--brand-violet-light)]"
            />
          </div>
        )}
      </div>

      <div className="relative rounded-2xl border border-[var(--hm-line)] bg-[var(--hm-surface)]">
        <ul id={listId} className="[&>li]:border-[var(--hm-line)] [&>li:not([hidden])~li:not([hidden])]:border-t">
          {ordered.map((c, i) => {
            const shown = isShown(c, i);
            return c.type === 1 ? (
              <li key={`s-${c.name}`} hidden={!shown} className="flex flex-col gap-0.5 px-4 py-3 sm:flex-row sm:items-baseline sm:gap-4">
                <code className="shrink-0 font-mono text-sm font-semibold text-[var(--hm-ink)]">/{c.name}</code>
                <span className="min-w-0 text-sm text-[var(--hm-body)]">{c.description}</span>
              </li>
            ) : (
              <li key={`c-${c.type}-${c.name}`} hidden={!shown} className="flex flex-col gap-0.5 px-4 py-3 sm:flex-row sm:items-baseline sm:gap-4">
                <span className="inline-flex shrink-0 items-center gap-1.5 text-sm font-semibold text-[var(--hm-ink)]">
                  <SquareSlash className="h-4 w-4 text-[var(--hm-faint)]" aria-hidden />
                  {c.name}
                </span>
                <span className="text-xs text-[var(--hm-faint)]">{c.type === 2 ? gt("User context menu") : gt("Message context menu")}</span>
              </li>
            );
          })}
        </ul>

        {filtering && matchCount === 0 && (
          <p className="px-4 py-6 text-center text-sm text-[var(--hm-body)]">
            {gt("No commands match \"{query}\".", { query: query.trim() })}
          </p>
        )}
        <p role="status" className="sr-only">
          {filtering ? gt("{count} of {total} commands shown", { count: matchCount, total }) : ""}
        </p>

        {collapsed && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-[45px] h-12 bg-gradient-to-t from-[var(--hm-surface)] to-transparent"
          />
        )}

        {collapsible && !filtering && (
          <button
            type="button"
            onClick={toggle}
            aria-expanded={expanded}
            aria-controls={listId}
            className="flex h-[45px] w-full items-center justify-center gap-1.5 rounded-b-2xl border-t border-[var(--hm-line)] text-sm font-semibold text-[var(--hm-accent-text)] transition-colors hover:bg-[var(--hm-surface-2)]"
          >
            {expanded ? gt("Show less") : gt("View all {count} commands", { count: total.toLocaleString(locale) })}
            <ChevronDown className={`h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`} aria-hidden />
          </button>
        )}
      </div>
    </section>
  );
}

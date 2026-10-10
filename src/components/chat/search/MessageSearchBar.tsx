"use client";

import { forwardRef, useId, useImperativeHandle, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useGT } from "gt-next";
import { AtSign, Bot, Calendar, Clock, FileText, Hash, Pin, Search, User, X } from "lucide-react";
import { cn, cdnImage } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  parseSearchQuery,
  quoteSearchValue,
  SEARCH_AUTHOR_TYPES,
  SEARCH_HAS_VALUES,
  tokenAtCaret,
  type SearchFilterKey,
} from "@/lib/chat/searchQuery";
import { localDateString } from "@/lib/chat/searchClient";
import type { MessageSearchController } from "@/hooks/useMessageSearch";

export interface MessageSearchBarHandle {
  /** Focus the bar; `prefill` replaces its text (e.g. "in:general "). */
  focus: (prefill?: string) => void;
}

interface Suggestion {
  key: string;
  icon: ReactNode;
  label: ReactNode;
  hint?: string;
  /** Text inserted over the token under the caret. */
  insert: string;
  /** Keep typing after insert (a bare "from:" key) instead of adding a space. */
  continueToken?: boolean;
  /** Run the search right away (history entries). */
  submit?: boolean;
}

const FILTER_ORDER: SearchFilterKey[] = ["from", "mentions", "has", "before", "during", "after", "in", "pinned", "authorType"];

/**
 * Discord-style search input: filter tokens render as chips (an overlay
 * mirrors the input text), and a popover autocompletes filter keys, members,
 * channels, has: kinds, dates and recent searches. Enter runs the search.
 */
export const MessageSearchBar = forwardRef<MessageSearchBarHandle, {
  search: MessageSearchController;
  placeholder?: string;
  className?: string;
  /** Full-width variant (mobile sheet): always expanded. */
  expanded?: boolean;
  autoFocus?: boolean;
  onSubmitted?: () => void;
}>(function MessageSearchBar({ search, placeholder, className, expanded = false, autoFocus = false, onSubmitted }, ref) {
  const gt = useGT();
  const inputRef = useRef<HTMLInputElement>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();
  const [focused, setFocused] = useState(false);
  const [caret, setCaret] = useState(0);
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const { draft, setDraft } = search;

  useImperativeHandle(ref, () => ({
    focus: (prefill?: string) => {
      const el = inputRef.current;
      if (!el) return;
      if (prefill !== undefined) {
        setDraft(prefill);
        requestAnimationFrame(() => {
          el.focus();
          el.setSelectionRange(prefill.length, prefill.length);
          setCaret(prefill.length);
        });
        return;
      }
      el.focus();
      el.select();
    },
  }), [setDraft]);

  const parsed = useMemo(() => parseSearchQuery(draft), [draft]);

  const filterLabels: Record<SearchFilterKey, { hint: string; icon: ReactNode }> = {
    from: { hint: gt("user"), icon: <User className="w-4 h-4" /> },
    mentions: { hint: gt("user"), icon: <AtSign className="w-4 h-4" /> },
    has: { hint: gt("link, embed, file, image, video, sound, sticker or poll"), icon: <FileText className="w-4 h-4" /> },
    before: { hint: gt("specific date"), icon: <Calendar className="w-4 h-4" /> },
    during: { hint: gt("specific date"), icon: <Calendar className="w-4 h-4" /> },
    after: { hint: gt("specific date"), icon: <Calendar className="w-4 h-4" /> },
    in: { hint: gt("channel"), icon: <Hash className="w-4 h-4" /> },
    pinned: { hint: gt("true or false"), icon: <Pin className="w-4 h-4" /> },
    authorType: { hint: gt("user, bot or webhook"), icon: <Bot className="w-4 h-4" /> },
  };

  const hasLabels: Record<string, string> = {
    link: gt("link"),
    embed: gt("embed"),
    file: gt("file"),
    image: gt("image"),
    video: gt("video"),
    sound: gt("sound"),
    sticker: gt("sticker"),
    poll: gt("poll"),
  };

  const token = tokenAtCaret(draft, caret);
  // Recomputed per render (cheap; the React Compiler memoizes it).
  const suggestions: Suggestion[] = (() => {
    const out: Suggestion[] = [];
    const partial = token.partial.toLowerCase();
    if (token.key === null) {
      for (const key of FILTER_ORDER) {
        if (key === "in" && !search.channels) continue;
        if (partial && !key.toLowerCase().startsWith(partial)) continue;
        out.push({
          key: `filter-${key}`,
          icon: filterLabels[key].icon,
          label: <span className="font-semibold">{key}:</span>,
          hint: filterLabels[key].hint,
          insert: `${key}:`,
          continueToken: true,
        });
      }
      if (!draft.trim()) {
        for (const h of search.history) {
          out.push({ key: `history-${h}`, icon: <Clock className="w-4 h-4" />, label: h, insert: h, submit: true });
        }
      }
      return out;
    }
    const k = token.key;
    if (k === "from" || k === "mentions") {
      const matches = search.users
        .filter((u) => !partial || u.username.toLowerCase().includes(partial) || (u.displayName || "").toLowerCase().includes(partial))
        .slice(0, 8);
      for (const u of matches) {
        out.push({
          key: `${k}-${u.id}`,
          icon: (
            <Avatar className="w-5 h-5">
              <AvatarImage src={cdnImage(u.avatar || undefined)} />
              <AvatarFallback className="text-[10px] bg-[var(--app-accent)] text-white">
                {(u.displayName || u.username || "?").charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
          ),
          label: <span className="font-medium">{u.displayName || u.username}</span>,
          hint: u.username,
          insert: `${k}:${quoteSearchValue(u.username)}`,
        });
      }
    } else if (k === "in") {
      for (const c of (search.channels || []).filter((c) => !partial || c.name.toLowerCase().includes(partial)).slice(0, 8)) {
        out.push({ key: `in-${c.id}`, icon: <Hash className="w-4 h-4" />, label: c.name, insert: `in:${quoteSearchValue(c.name)}` });
      }
    } else if (k === "has") {
      for (const h of SEARCH_HAS_VALUES.filter((h) => !partial || h.startsWith(partial))) {
        out.push({ key: `has-${h}`, icon: <FileText className="w-4 h-4" />, label: hasLabels[h] ?? h, insert: `has:${h}` });
      }
    } else if (k === "pinned") {
      for (const v of ["true", "false"].filter((v) => !partial || v.startsWith(partial))) {
        out.push({ key: `pinned-${v}`, icon: <Pin className="w-4 h-4" />, label: v === "true" ? gt("true") : gt("false"), insert: `pinned:${v}` });
      }
    } else if (k === "authorType") {
      for (const v of SEARCH_AUTHOR_TYPES.filter((v) => !partial || v.startsWith(partial))) {
        const label = v === "user" ? gt("user") : v === "bot" ? gt("bot") : gt("webhook");
        out.push({ key: `authorType-${v}`, icon: <Bot className="w-4 h-4" />, label, insert: `authorType:${v}` });
      }
    } else {
      const dates = [
        { d: localDateString(0), label: gt("Today") },
        { d: localDateString(1), label: gt("Yesterday") },
        { d: localDateString(7), label: gt("A week ago") },
        { d: localDateString(30), label: gt("A month ago") },
        { d: localDateString(365), label: gt("A year ago") },
      ];
      for (const { d, label } of dates.filter((x) => !partial || x.d.startsWith(partial))) {
        out.push({ key: `${k}-${d}`, icon: <Calendar className="w-4 h-4" />, label, hint: d, insert: `${k}:${d}` });
      }
    }
    return out;
  })();

  const isDateToken = token.key === "before" || token.key === "after" || token.key === "during";
  const popoverOpen = focused && !dismissed && (suggestions.length > 0 || isDateToken);
  const activeIndex = suggestions.length ? Math.min(active, suggestions.length - 1) : 0;

  const moveCaret = (pos: number) => {
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(pos, pos);
      setCaret(pos);
    });
  };

  const apply = (s: Suggestion) => {
    if (s.submit) {
      setDraft(s.insert);
      if (search.submit(s.insert)) {
        setDismissed(true);
        onSubmitted?.();
      }
      return;
    }
    const before = draft.slice(0, token.start);
    let after = draft.slice(token.end);
    if (s.continueToken) {
      const value = before + s.insert + after;
      setDraft(value);
      setActive(0);
      moveCaret(before.length + s.insert.length);
      return;
    }
    if (!after.startsWith(" ")) after = ` ${after}`;
    const value = before + s.insert + after;
    setDraft(value);
    setActive(0);
    moveCaret(before.length + s.insert.length + 1);
  };

  const applyDate = (date: string) => {
    if (!token.key) return;
    apply({ key: "date", icon: null, label: date, insert: `${token.key}:${date}` });
  };

  const runSearch = () => {
    if (search.submit()) {
      setDismissed(true);
      onSubmitted?.();
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (popoverOpen && suggestions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((activeIndex + 1) % suggestions.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((activeIndex - 1 + suggestions.length) % suggestions.length);
        return;
      }
      // Tab always completes; Enter completes while a filter value is being
      // typed (Discord), otherwise it searches.
      if (e.key === "Tab" || (e.key === "Enter" && token.key !== null && !e.shiftKey)) {
        e.preventDefault();
        apply(suggestions[activeIndex]);
        return;
      }
    }
    if (e.key === "Enter") {
      e.preventDefault();
      runSearch();
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      if (popoverOpen) {
        setDismissed(true);
      } else if (draft || search.open) {
        search.clear();
      } else {
        inputRef.current?.blur();
      }
    }
  };

  // Chip overlay: the input's own text is transparent; this mirror paints the
  // same text with filter tokens as pills, scrolled in step with the input.
  const segments = useMemo(() => {
    const out: Array<{ text: string; chip: boolean; valid: boolean }> = [];
    let pos = 0;
    for (const t of parsed.tokens) {
      if (t.start > pos) out.push({ text: draft.slice(pos, t.start), chip: false, valid: true });
      out.push({ text: draft.slice(t.start, t.end), chip: true, valid: t.valid });
      pos = t.end;
    }
    if (pos < draft.length) out.push({ text: draft.slice(pos), chip: false, valid: true });
    return out;
  }, [parsed.tokens, draft]);

  const wide = expanded || focused || Boolean(draft);

  return (
    <div className={cn("relative", className)}>
      <div
        className={cn(
          "relative flex items-center rounded bg-[var(--app-surface-alt)] transition-all",
          expanded ? "w-full h-9" : cn("h-6", wide ? "w-60" : "w-36"),
        )}
      >
        <div
          ref={mirrorRef}
          aria-hidden="true"
          className={cn(
            "absolute inset-0 flex items-center overflow-hidden whitespace-pre pointer-events-none text-[var(--text-primary)]",
            expanded ? "pl-3 pr-8 text-[15px]" : "pl-2 pr-7 text-sm",
          )}
        >
          {segments.map((seg, i) =>
            seg.chip ? (
              <span
                key={i}
                className={cn(
                  "rounded-sm",
                  seg.valid
                    ? "bg-[color-mix(in_srgb,var(--app-accent)_24%,transparent)]"
                    : "bg-[color-mix(in_srgb,var(--app-muted)_25%,transparent)] line-through decoration-[var(--app-muted)]",
                )}
              >
                {seg.text}
              </span>
            ) : (
              <span key={i}>{seg.text}</span>
            ),
          )}
        </div>
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-controls={listboxId}
          aria-expanded={popoverOpen}
          aria-autocomplete="list"
          aria-label={gt("Search")}
          autoFocus={autoFocus}
          spellCheck={false}
          autoComplete="off"
          placeholder={placeholder ?? gt("Search")}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setCaret(e.target.selectionStart ?? e.target.value.length);
            setDismissed(false);
            setActive(0);
          }}
          onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
          onScroll={(e) => {
            if (mirrorRef.current) mirrorRef.current.scrollLeft = e.currentTarget.scrollLeft;
          }}
          onFocus={(e) => {
            setFocused(true);
            setDismissed(false);
            setCaret(e.currentTarget.selectionStart ?? draft.length);
          }}
          onBlur={(e) => {
            // Moving into the popover (the date picker) keeps it open.
            if (popoverRef.current?.contains(e.relatedTarget as Node | null)) return;
            setFocused(false);
          }}
          onKeyDown={onKeyDown}
          className={cn(
            "absolute inset-0 w-full h-full bg-transparent text-transparent caret-[var(--text-primary)] placeholder:text-[var(--app-muted)] focus:outline-none selection:bg-[color-mix(in_srgb,var(--app-accent)_40%,transparent)]",
            expanded ? "pl-3 pr-8 text-[15px]" : "pl-2 pr-7 text-sm",
          )}
        />
        {draft ? (
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              search.clear();
              inputRef.current?.focus();
            }}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 text-[var(--app-muted)] hover:text-[var(--text-primary)]"
            aria-label={gt("Clear search")}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        ) : (
          <Search className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--app-muted)] pointer-events-none" />
        )}
      </div>

      {popoverOpen && (
        <div
          role="listbox"
          id={listboxId}
          className={cn(
            "absolute z-50 mt-2 rounded-lg border border-[var(--app-border)] bg-[var(--app-surface)] shadow-xl py-2 text-[var(--text-primary)]",
            expanded ? "left-0 right-0" : "right-0 w-80",
          )}
          ref={popoverRef}
          onMouseDown={(e) => {
            // Keep focus in the search input, except for the date picker.
            if ((e.target as HTMLElement).tagName !== "INPUT") e.preventDefault();
          }}
        >
          <p className="px-3 pb-1 text-[11px] font-bold uppercase tracking-wide text-[var(--app-muted)]">
            {token.key === null
              ? draft.trim()
                ? gt("Search options")
                : search.history.length > 0 ? gt("Search options and history") : gt("Search options")
              : token.key === "from" ? gt("From user")
              : token.key === "mentions" ? gt("Mentions user")
              : token.key === "in" ? gt("In channel")
              : token.key === "has" ? gt("Message contains")
              : token.key === "pinned" ? gt("Pinned")
              : token.key === "authorType" ? gt("Author type")
              : gt("Dates")}
          </p>
          <div className="max-h-72 overflow-y-auto">
            {suggestions.map((s, i) => (
              <button
                type="button"
                role="option"
                aria-selected={i === activeIndex}
                key={s.key}
                onMouseEnter={() => setActive(i)}
                onClick={() => apply(s)}
                className={cn(
                  "w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm",
                  i === activeIndex ? "bg-[var(--app-surface-alt)]" : "hover:bg-[var(--app-surface-alt)]",
                )}
              >
                <span className="shrink-0 text-[var(--app-muted)] flex items-center">{s.icon}</span>
                <span className="truncate">{s.label}</span>
                {s.hint && <span className="ml-auto pl-2 truncate text-xs text-[var(--app-muted)]">{s.hint}</span>}
              </button>
            ))}
            {isDateToken && (
              <label className="flex items-center gap-2 px-3 py-1.5 text-sm text-[var(--app-muted)]">
                <Calendar className="w-4 h-4 shrink-0" />
                <span className="shrink-0">{gt("Pick a date")}</span>
                <input
                  type="date"
                  className="ml-auto rounded bg-[var(--app-surface-alt)] px-2 py-0.5 text-[var(--text-primary)] [color-scheme:light_dark]"
                  max={localDateString(0)}
                  onChange={(e) => {
                    if (e.target.value) applyDate(e.target.value);
                  }}
                  onBlur={(e) => {
                    if (e.relatedTarget !== inputRef.current) setFocused(false);
                  }}
                />
              </label>
            )}
            {token.key === null && !draft.trim() && search.history.length > 0 && (
              <button
                type="button"
                onClick={() => search.clearHistory()}
                className="w-full px-3 pt-1.5 text-left text-xs text-[var(--app-muted)] hover:text-[var(--text-primary)]"
              >
                {gt("Clear search history")}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
});

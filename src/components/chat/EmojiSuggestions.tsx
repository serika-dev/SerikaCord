"use client";

import { memo, useEffect, useRef } from "react";
import { Star } from "lucide-react";
import { useGT } from "gt-next";
import { cn, cdnImage } from "@/lib/utils";
import { twemojiOnError, twemojiSvgUrl } from "@/lib/twemoji-helpers";
import type { EmojiSuggestion } from "@/lib/chat/emojiIndex";

interface EmojiSuggestionsProps {
  query: string;
  results: readonly EmojiSuggestion[];
  activeIndex: number;
  listId: string;
  /** The emoji as it will be inserted (skin tone applied). */
  displayChar: (s: Extract<EmojiSuggestion, { kind: "unicode" }>) => string;
  /** Shown next to this server's custom emoji. */
  localServerName?: string;
  onPick: (s: EmojiSuggestion) => void;
  onActivate: (index: number) => void;
}

function onTwemojiError(e: React.SyntheticEvent<HTMLImageElement>) {
  const img = e.currentTarget;
  if (Number(img.dataset.twemojiAttempt || 0) < 3) {
    twemojiOnError.call(img);
    return;
  }
  // No artwork: show the character instead (the span right after the img).
  img.style.display = "none";
  img.nextElementSibling?.removeAttribute("hidden");
}

/**
 * The `:` emoji autocomplete above the composer: big emoji, `:name:` and its
 * aliases, custom emoji with their server. Keyboard handling lives in
 * MessageBar (↑/↓, Tab/Enter, Esc); rows also take hover and tap.
 */
export const EmojiSuggestions = memo(function EmojiSuggestions({
  query,
  results,
  activeIndex,
  listId,
  displayChar,
  localServerName,
  onPick,
  onActivate,
}: EmojiSuggestionsProps) {
  const gt = useGT();
  const listRef = useRef<HTMLDivElement>(null);

  // Keep the highlighted row in view while arrowing through the list.
  useEffect(() => {
    const row = listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`);
    row?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  return (
    <div className="theme-solid absolute left-2 right-2 bottom-[calc(100%+8px)] z-20 rounded-lg border border-[var(--app-border)] bg-[var(--app-surface-alt)] shadow-[var(--app-elev-2)] overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-3 pt-2 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--app-muted)]">
        <span className="truncate">{gt("Emoji matching {query}", { query: `:${query}` })}</span>
        <span className="hidden sm:inline shrink-0 normal-case font-normal tracking-normal">
          {gt("Tab or Enter to insert, Esc to close")}
        </span>
      </div>
      <div
        ref={listRef}
        id={listId}
        role="listbox"
        aria-label={gt("Emoji suggestions")}
        className="max-h-[min(22.5rem,40dvh)] overflow-y-auto overscroll-contain pb-1"
      >
        {results.map((s, index) => {
          const active = index === activeIndex;
          const custom = s.kind === "custom" ? s.emoji : null;
          const source = custom ? custom.serverName ?? (s.kind === "custom" && s.local ? localServerName : undefined) : undefined;
          return (
            <div
              key={s.key}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={active}
              data-index={index}
              // Keep focus (and the phone keyboard) in the composer.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onPick(s)}
              onMouseEnter={() => onActivate(index)}
              className={cn(
                "mx-1 flex min-h-11 sm:min-h-9 cursor-pointer items-center gap-3 rounded-md px-2 text-left text-[var(--text-primary)] transition-colors",
                active ? "bg-[color-mix(in_srgb,var(--app-accent)_20%,transparent)]" : "hover:bg-[var(--app-surface)]",
              )}
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center">
                {custom ? (
                  <img
                    // Animated emoji only play on the highlighted row.
                    src={cdnImage(custom.url, { still: !!custom.animated && !active })}
                    alt={`:${custom.name}:`}
                    className="h-7 w-7 object-contain"
                    draggable={false}
                  />
                ) : s.kind === "unicode" ? (
                  <>
                    <img
                      src={twemojiSvgUrl(displayChar(s))}
                      alt={displayChar(s)}
                      className="h-7 w-7"
                      draggable={false}
                      onError={onTwemojiError}
                    />
                    <span hidden className="text-2xl leading-none">{displayChar(s)}</span>
                  </>
                ) : null}
              </span>
              <span className="flex min-w-0 flex-1 items-baseline gap-2">
                <span className="truncate text-sm font-medium">:{s.name}:</span>
                {s.aliases.length > 0 && (
                  <span className="hidden min-[400px]:inline truncate text-xs text-[var(--app-muted)]">
                    {s.aliases.map((a) => `:${a}:`).join(" ")}
                  </span>
                )}
              </span>
              {s.favorite && (
                <Star className="h-3.5 w-3.5 shrink-0 fill-current text-[var(--app-muted)]" aria-label={gt("Favorite")} />
              )}
              {source && <span className="max-w-[40%] shrink-0 truncate text-xs text-[var(--app-muted)]">{source}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
});

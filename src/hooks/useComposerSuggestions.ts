"use client";

import { useCallback, useRef, useState } from "react";
import type { RichComposerHandle } from "@/components/chat/RichComposer";

/** Minimal suggestion shape compatible with MessageBar's mentionSuggestions. */
export interface ComposerSuggestion {
  id: string;
  kind: "user" | "unicode-emoji" | "emoji";
  label: string;
  unicodeChar?: string;
  imageUrl?: string;
  animated?: boolean;
  description?: string;
  color?: string;
}

interface SuggestionRecipient {
  id: string;
  username: string;
  displayName?: string;
}

interface UseComposerSuggestionsOptions {
  getComposer: () => RichComposerHandle | null;
  /** Recipient (DM) offered for `@` autocomplete. */
  recipient?: SuggestionRecipient | null;
  /** Group DMs: everyone `@` can mention (takes precedence over `recipient`). */
  recipients?: SuggestionRecipient[] | null;
  /** Called with the composer's serialized text after an insertion (e.g. typing signal). */
  onAfterInsert?: (text: string) => void;
}

/**
 * Self-contained `@user` autocomplete for a RichComposer. Used by the DM
 * composers, which — unlike the server ChatArea — have no built-in mention
 * engine. Emoji (`:`) and slash commands are MessageBar's own. Returns props to
 * spread onto <MessageBar> plus a keydown handler that consumes
 * arrow/enter/tab/escape while open.
 */
export function useComposerSuggestions({
  getComposer,
  recipient = null,
  recipients = null,
  onAfterInsert,
}: UseComposerSuggestionsOptions) {
  const [suggestions, setSuggestions] = useState<ComposerSuggestion[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const rangeRef = useRef<{ start: number; end: number } | null>(null);

  const close = useCallback(() => {
    rangeRef.current = null;
    setSuggestions((prev) => (prev.length > 0 ? [] : prev));
    setActiveIndex((prev) => (prev !== 0 ? 0 : prev));
  }, []);

  const onCaretMove = useCallback(
    (draft: string, caret?: number) => {
      const caretPosition = caret ?? getComposer()?.getCaret() ?? draft.length;
      const beforeCursor = draft.slice(0, caretPosition);

      // @user: offer the DM recipient (or the group's members).
      const atMatch = beforeCursor.match(/(^|\s)@([a-zA-Z0-9_]*)$/);
      const people = recipients ?? (recipient ? [recipient] : []);
      if (atMatch && people.length > 0) {
        const q = atMatch[2].toLowerCase();
        const matches = people.filter((p) => {
          const name = (p.displayName || p.username || "").toLowerCase();
          return !q || name.includes(q) || p.username.toLowerCase().includes(q);
        });
        if (matches.length > 0) {
          rangeRef.current = { start: caretPosition - atMatch[2].length - 1, end: caretPosition };
          setSuggestions(matches.slice(0, 10).map((p) => ({ id: p.id, kind: "user" as const, label: p.displayName || p.username })));
          setActiveIndex(0);
          return;
        }
      }

      close();
    },
    [getComposer, recipient, recipients, close]
  );

  const onMentionSelect = useCallback(
    (suggestion: ComposerSuggestion) => {
      const range = rangeRef.current;
      const composer = getComposer();
      if (!range || !composer) return;
      rangeRef.current = null;
      setSuggestions([]);
      setActiveIndex(0);

      if (suggestion.kind === "user") {
        composer.replaceRangeWithMention(range.start, range.end, {
          id: suggestion.id,
          label: suggestion.label,
          kind: "user",
        });
        composer.insertTextAtCaret(" ");
      }

      onAfterInsert?.(composer.getText());
    },
    [getComposer, onAfterInsert]
  );

  /** Handle nav keys while suggestions are open. Returns true if consumed. */
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent): boolean => {
      if (suggestions.length === 0) return false;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => (i + 1) % suggestions.length);
        return true;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => (i - 1 + suggestions.length) % suggestions.length);
        return true;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        onMentionSelect(suggestions[activeIndex] ?? suggestions[0]);
        return true;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        close();
        return true;
      }
      return false;
    },
    [suggestions, activeIndex, onMentionSelect, close]
  );

  return { mentionSuggestions: suggestions, activeMentionIndex: activeIndex, onCaretMove, onMentionSelect, handleKeyDown, close };
}

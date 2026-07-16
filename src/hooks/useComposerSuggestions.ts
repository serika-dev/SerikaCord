"use client";

import { useCallback, useRef, useState } from "react";
import type { RichComposerHandle } from "@/components/chat/RichComposer";
import { EMOJI_NAMES } from "@/lib/constants/emojis";
import { getCommandSuggestions, type SlashCommand } from "@/lib/chat/slashCommands";

/** Minimal suggestion shape compatible with MessageBar's mentionSuggestions. */
export interface ComposerSuggestion {
  id: string;
  kind: "user" | "unicode-emoji" | "emoji" | "command";
  label: string;
  unicodeChar?: string;
  imageUrl?: string;
  animated?: boolean;
  description?: string;
  usage?: string;
  category?: string;
  commandHint?: string;
  color?: string;
}

interface CustomEmoji {
  id: string;
  name: string;
  url: string;
  animated?: boolean;
  serverName?: string;
}

interface SuggestionRecipient {
  id: string;
  username: string;
  displayName?: string;
}

interface UseComposerSuggestionsOptions {
  getComposer: () => RichComposerHandle | null;
  /** Whether this composer is inside a server (affects available slash commands). */
  isServer?: boolean;
  /** Custom emojis available for `:` autocomplete. */
  customEmojis?: CustomEmoji[];
  /** Recipient (DM) offered for `@` autocomplete. */
  recipient?: SuggestionRecipient | null;
  /** Called with the composer's serialized text after an insertion (e.g. typing signal). */
  onAfterInsert?: (text: string) => void;
}

/**
 * Self-contained emoji (`:`), slash-command (`/`) and `@user` autocomplete for a
 * RichComposer. Used by the DM composer, which — unlike the server ChatArea —
 * has no built-in mention engine. Returns props to spread onto <MessageBar>
 * plus a keydown handler that consumes arrow/enter/tab/escape while open.
 */
export function useComposerSuggestions({
  getComposer,
  isServer = false,
  customEmojis = [],
  recipient = null,
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

      // Slash command: `/query` at start (no spaces).
      const slashMatch = beforeCursor.match(/^\/([a-zA-Z0-9_]*)$/);
      if (slashMatch) {
        const query = slashMatch[1].toLowerCase();
        const commands = getCommandSuggestions(query, isServer);
        if (commands.length > 0) {
          rangeRef.current = { start: 1, end: caretPosition };
          setSuggestions(
            commands.map((cmd: SlashCommand) => ({
              id: cmd.name,
              kind: "command" as const,
              label: cmd.name,
              description: cmd.description,
              usage: cmd.usage,
              category: cmd.category,
              commandHint: cmd.hint,
            }))
          );
          setActiveIndex(0);
          return;
        }
      }

      // Emoji: `:query` with 2+ chars.
      const emojiMatch = beforeCursor.match(/(^|\s):([a-zA-Z0-9_+-]{2,32})$/);
      if (emojiMatch) {
        const q = emojiMatch[2].toLowerCase();
        const start = caretPosition - emojiMatch[2].length - 1;
        const seen = new Set<string>();
        const out: ComposerSuggestion[] = [];
        for (const [name, char] of Object.entries(EMOJI_NAMES)) {
          if (out.length >= 8) break;
          if (!name.includes(q) || seen.has(name)) continue;
          seen.add(name);
          out.push({ id: `unicode:${name}`, kind: "unicode-emoji", label: name, unicodeChar: char });
        }
        for (const e of customEmojis) {
          if (out.length >= 8) break;
          if (!e.name.toLowerCase().includes(q) || seen.has(e.name)) continue;
          seen.add(e.name);
          out.push({ id: e.id, kind: "emoji", label: e.name, imageUrl: e.url, animated: e.animated, description: e.serverName });
        }
        if (out.length > 0) {
          rangeRef.current = { start, end: caretPosition };
          setSuggestions(out);
          setActiveIndex(0);
          return;
        }
      }

      // @user: offer the DM recipient.
      const atMatch = beforeCursor.match(/(^|\s)@([a-zA-Z0-9_]*)$/);
      if (atMatch && recipient) {
        const q = atMatch[2].toLowerCase();
        const name = (recipient.displayName || recipient.username || "").toLowerCase();
        if (!q || name.includes(q) || recipient.username.toLowerCase().includes(q)) {
          rangeRef.current = { start: caretPosition - atMatch[2].length - 1, end: caretPosition };
          setSuggestions([{ id: recipient.id, kind: "user", label: recipient.displayName || recipient.username }]);
          setActiveIndex(0);
          return;
        }
      }

      close();
    },
    [getComposer, isServer, customEmojis, recipient, close]
  );

  const onMentionSelect = useCallback(
    (suggestion: ComposerSuggestion) => {
      const range = rangeRef.current;
      const composer = getComposer();
      if (!range || !composer) return;
      rangeRef.current = null;
      setSuggestions([]);
      setActiveIndex(0);

      if (suggestion.kind === "unicode-emoji") {
        composer.replaceRange(range.start, range.end, suggestion.unicodeChar || "");
        composer.insertTextAtCaret(" ");
      } else if (suggestion.kind === "emoji") {
        composer.replaceRangeWithEmoji(range.start, range.end, {
          id: suggestion.id,
          name: suggestion.label,
          url: suggestion.imageUrl || "",
          animated: suggestion.animated,
        });
      } else if (suggestion.kind === "command") {
        composer.replaceRange(0, range.end, `/${suggestion.label} `);
      } else if (suggestion.kind === "user") {
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

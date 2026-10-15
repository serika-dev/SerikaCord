"use client";

import { useCallback, useRef, useState } from "react";
import type { RichComposerHandle } from "@/components/chat/RichComposer";
import { EMOJI_NAMES } from "@/lib/constants/emojis";
import { getCommandSuggestions, type SlashCommand } from "@/lib/chat/slashCommands";
import { OPT, parseAppCommandContext, type AppLeafCommand } from "@/lib/chat/appCommandContext";

/** Minimal suggestion shape compatible with MessageBar's mentionSuggestions. */
export interface ComposerSuggestion {
  id: string;
  kind: "user" | "unicode-emoji" | "emoji" | "command" | "app-command" | "app-option" | "app-choice" | "param-user";
  label: string;
  unicodeChar?: string;
  imageUrl?: string;
  animated?: boolean;
  description?: string;
  usage?: string;
  category?: string;
  commandHint?: string;
  color?: string;
  // App (bot) commands: same fields the server palette uses (MessageBar renders them).
  appName?: string;
  appIcon?: string | null;
  botId?: string;
  fullName?: string;
  optionNames?: string[];
  paramName?: string;
  paramRequired?: boolean;
  commandName?: string;
  optionType?: number;
  emoji?: string;
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
  /** Group DMs: everyone `@` can mention (takes precedence over `recipient`). */
  recipients?: SuggestionRecipient[] | null;
  /** Called with the composer's serialized text after an insertion (e.g. typing signal). */
  onAfterInsert?: (text: string) => void;
  /** App (bot) slash commands available here (DMs with a bot), see useAppCommands. */
  appLeaves?: AppLeafCommand[];
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
  recipients = null,
  onAfterInsert,
  appLeaves,
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
        const apps: ComposerSuggestion[] = (appLeaves ?? [])
          .filter((leaf) => !query || leaf.fullName.toLowerCase().includes(query) || leaf.description.toLowerCase().includes(query))
          .map((leaf) => ({
            id: `${leaf.application.id}:${leaf.fullName}`,
            kind: "app-command" as const,
            label: leaf.fullName,
            description: leaf.description,
            appName: leaf.application.name,
            appIcon: leaf.application.icon,
            botId: leaf.application.botId ?? undefined,
            fullName: leaf.fullName,
            optionNames: leaf.options.filter((o) => o.type !== OPT.SUB_COMMAND && o.type !== OPT.SUB_COMMAND_GROUP).map((o) => o.name),
          }));
        if (commands.length > 0 || apps.length > 0) {
          rangeRef.current = { start: 1, end: caretPosition };
          setSuggestions([
            ...apps,
            ...commands.map((cmd: SlashCommand) => ({
              id: cmd.name,
              kind: "command" as const,
              label: cmd.name,
              description: cmd.description,
              usage: cmd.usage,
              category: cmd.category,
              commandHint: cmd.hint,
            })),
          ]);
          setActiveIndex(0);
          return;
        }
      }

      // App command options: `/cmd …` → option names, then choices / people.
      if (appLeaves?.length && beforeCursor.startsWith("/") && /\s/.test(beforeCursor)) {
        const ctx = parseAppCommandContext(beforeCursor, appLeaves);
        if (ctx) {
          const argLower = ctx.currentArg.toLowerCase();
          const range = { start: caretPosition - ctx.currentArg.length, end: caretPosition };
          const base = { commandName: ctx.leaf.fullName };
          if (!ctx.valueMode) {
            const list = ctx.remaining.filter((o) => !argLower || o.name.toLowerCase().includes(argLower));
            if (list.length > 0) {
              rangeRef.current = range;
              setSuggestions(list.map((o) => ({ ...base, id: o.name, kind: "app-option" as const, label: o.name, description: o.description || "", paramName: o.name, paramRequired: o.required, optionType: o.type })));
              setActiveIndex(0);
              return;
            }
          }
          const opt = ctx.option;
          if (opt) {
            const people = recipients ?? (recipient ? [recipient] : []);
            if ((opt.type === OPT.USER || opt.type === OPT.MENTIONABLE) && people.length > 0) {
              const matches = people.filter((p) => !argLower || (p.displayName || p.username).toLowerCase().includes(argLower));
              if (matches.length > 0) {
                rangeRef.current = range;
                setSuggestions(matches.slice(0, 8).map((p) => ({ ...base, id: p.id, kind: "param-user" as const, label: p.displayName || p.username, description: p.username, paramName: opt.name, paramRequired: opt.required })));
                setActiveIndex(0);
                return;
              }
            }
            const choices = opt.choices?.length ? opt.choices : opt.type === OPT.BOOLEAN ? [{ name: "True", value: "true" }, { name: "False", value: "false" }] : null;
            if (choices) {
              const filtered = choices.filter((c) => !argLower || c.name.toLowerCase().includes(argLower) || String(c.value).toLowerCase().includes(argLower));
              if (filtered.length > 0) {
                rangeRef.current = range;
                setSuggestions(filtered.map((c) => ({ ...base, id: String(c.value), kind: "app-choice" as const, label: c.name, description: (c as { description?: string }).description, emoji: (c as { emoji?: string }).emoji, paramName: opt.name, paramRequired: opt.required })));
                setActiveIndex(0);
                return;
              }
            }
            rangeRef.current = range;
            setSuggestions([{ ...base, id: "__app-option-hint__", kind: "app-option" as const, label: opt.name, description: opt.description || "", paramName: opt.name, paramRequired: opt.required, optionType: opt.type }]);
            setActiveIndex(0);
            return;
          }
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
    [getComposer, isServer, customEmojis, recipient, recipients, close, appLeaves]
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
      } else if (suggestion.kind === "app-command") {
        composer.replaceRange(0, range.end, `/${suggestion.fullName || suggestion.label} `);
      } else if (suggestion.kind === "app-option") {
        // The hint card only explains the option; picking a name inserts `name:`.
        if (suggestion.id !== "__app-option-hint__") composer.replaceRange(range.start, range.end, `${suggestion.label}:`);
      } else if (suggestion.kind === "app-choice") {
        composer.replaceRange(range.start, range.end, /\s/.test(suggestion.id) ? `"${suggestion.id}" ` : `${suggestion.id} `);
      } else if (suggestion.kind === "user" || suggestion.kind === "param-user") {
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

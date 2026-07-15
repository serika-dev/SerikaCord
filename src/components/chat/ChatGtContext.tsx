"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useGT } from "gt-next";

/**
 * Translation function shape returned by gt-next's `useGT()`.
 */
export type ChatGt = (str: string, params?: Record<string, unknown>) => string;

const ChatGtContext = createContext<ChatGt | null>(null);

/**
 * Provides a single, pre-resolved `gt` lookup to the whole message subtree.
 *
 * WHY THIS EXISTS
 * ---------------
 * Chat lag scales with history length because the message list is not
 * virtualised — every message mounts real DOM plus its React hooks. Adding
 * translations then made each per-message component (MessageGroup,
 * MessageContent, MessageGroupHeader, reactions, attachments, embeds, hover
 * actions…) call gt-next's `useGT()`, which is far from free: each call wires up
 * ~6-8 hooks (locale, default-locale, should-translate, a tracked-translation
 * resolver with its own Set + useSyncExternalStore subscription + useMemo/
 * useEffect bookkeeping). Multiplied by several components per message × N
 * messages, that dominated mount / channel-switch time on every locale.
 *
 * THE FIX
 * -------
 * Resolve every static chat label ONCE here, with plain string-literal `gt("…")`
 * calls. Those literals are exactly what the build-time gt-compiler rewrites to
 * precomputed-hash dictionary lookups, so they stay cheap for non-default
 * locales too (no per-render sha256 hashing — the "unusable on non-English"
 * regression we fought before). We then hand children a lookup function keyed on
 * the English source string, so their existing `gt("edited")` call sites are
 * unchanged but now cost only a `useContext` + object read — zero per-message
 * translation hooks and zero per-message hashing.
 *
 * MAINTENANCE
 * -----------
 * Every source string used with `useChatGt()` in a per-message component must be
 * listed in `map` below. If you add a new `gt("…")` in one of those components,
 * add the matching literal here. A missing entry falls back to the English
 * source (fine on `en`, untranslated elsewhere) and logs a dev warning.
 */
export function ChatGtProvider({ children }: { children: ReactNode }) {
  const gt = useGT();

  const chatGt = useMemo<ChatGt>(() => {
    // All calls below use string literals so the gt-compiler can inject
    // precomputed hashes (cheap dictionary lookup, no runtime hashing).
    const map: Record<string, string> = {
      // MessageContent
      "edited": gt("edited"),
      "Image": gt("Image"),
      "Unknown User": gt("Unknown User"),
      "role": gt("role"),
      "TTS": gt("TTS"),
      // MessageGroup
      "Reply": gt("Reply"),
      "React": gt("React"),
      "Edit": gt("Edit"),
      "Delete": gt("Delete"),
      "Replying to": gt("Replying to"),
      "message": gt("message"),
      "(attachment)": gt("(attachment)"),
      "Sending…": gt("Sending…"),
      "Pinned message": gt("Pinned message"),
      // MessageGroupHeader
      "Unknown": gt("Unknown"),
      "Discord": gt("Discord"),
      "Bot": gt("Bot"),
      // MessageReactions
      "more": gt("more"),
      "Add Reaction": gt("Add Reaction"),
      // MessageAttachments
      "? KB": gt("? KB"),
      // LinkEmbed
      "View GIF on Tenor": gt("View GIF on Tenor"),
      "View GIF on Klipy": gt("View GIF on Klipy"),
      // InviteEmbed
      "Failed to join server": gt("Failed to join server"),
      "Failed to join server. Check your connection.": gt("Failed to join server. Check your connection."),
      "You've been invited to join a server": gt("You've been invited to join a server"),
      "Online": gt("Online"),
      "Members": gt("Members"),
      "Joined": gt("Joined"),
      "Join": gt("Join"),
      // MessageHoverActions
      "More": gt("More"),
      "Copy Text": gt("Copy Text"),
      "Unpin Message": gt("Unpin Message"),
      "Pin Message": gt("Pin Message"),
      "Edit Message": gt("Edit Message"),
      "Delete Message": gt("Delete Message"),
      // Interpolated templates — resolved with self-referential params so the
      // placeholders survive translation and we can substitute real values at
      // the (per-message, dynamic) call site without a dev warning.
      "{names} and {count} more": gt("{names} and {count} more", { names: "{names}", count: "{count}" }),
      "Joined {name}": gt("Joined {name}", { name: "{name}" }),
      // MessageGroupHeader — timeout indicator
      "Timed out — {time} remaining": gt("Timed out — {time} remaining", { time: "{time}" }),
    };

    return (str, params) => {
      let resolved = map[str];
      if (resolved === undefined) {
        if (process.env.NODE_ENV !== "production") {
          // eslint-disable-next-line no-console
          console.warn(`[ChatGtProvider] Missing translation entry for "${str}". Add it to the map in ChatGtContext.tsx.`);
        }
        resolved = str;
      }
      if (!params) return resolved;
      return resolved.replace(/\{(\w+)\}/g, (_m, key: string) =>
        key in params ? String(params[key]) : `{${key}}`,
      );
    };
  }, [gt]);

  return <ChatGtContext.Provider value={chatGt}>{children}</ChatGtContext.Provider>;
}

/**
 * Reads the shared chat `gt` lookup. Falls back to an identity function (the
 * English source string, i.e. the default locale) if used outside a provider,
 * so a misplaced component degrades to untranslated text rather than crashing.
 * All per-message components render under <ChatGtProvider>.
 */
export function useChatGt(): ChatGt {
  const gt = useContext(ChatGtContext);
  return gt ?? identityGt;
}

const identityGt: ChatGt = (str) => str;

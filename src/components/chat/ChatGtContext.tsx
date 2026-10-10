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
      "New": gt("New"),
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
      "Remove embed": gt("Remove embed"),
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
      // CallMessageRow — DM call log rows
      "Call": gt("Call"),
      "Join call": gt("Join call"),
      "You started a call.": gt("You started a call."),
      "{caller} started a call.": gt("{caller} started a call.", { caller: "{caller}" }),
      "You started a call that lasted {duration}.": gt("You started a call that lasted {duration}.", { duration: "{duration}" }),
      "{caller} started a call that lasted {duration}.": gt("{caller} started a call that lasted {duration}.", { caller: "{caller}", duration: "{duration}" }),
      "You missed a call from {caller}.": gt("You missed a call from {caller}.", { caller: "{caller}" }),
      "{callee} missed your call.": gt("{callee} missed your call.", { callee: "{callee}" }),
      "Nobody answered your call.": gt("Nobody answered your call."),
      "You declined a call from {caller}.": gt("You declined a call from {caller}.", { caller: "{caller}" }),
      // GroupSystemRow — group DM system rows
      "{actor} added {target} to the group.": gt("{actor} added {target} to the group.", { actor: "{actor}", target: "{target}" }),
      "{actor} left the group.": gt("{actor} left the group.", { actor: "{actor}" }),
      "{actor} removed {target} from the group.": gt("{actor} removed {target} from the group.", { actor: "{actor}", target: "{target}" }),
      "{actor} changed the group name: {name}": gt("{actor} changed the group name: {name}", { actor: "{actor}", name: "{name}" }),
      "{actor} removed the group name.": gt("{actor} removed the group name.", { actor: "{actor}" }),
      "{actor} changed the group icon.": gt("{actor} changed the group icon.", { actor: "{actor}" }),
      // ThreadRows — thread chip on a starter message, "started a thread" row
      "Open thread {name}": gt("Open thread {name}", { name: "{name}" }),
      "Locked": gt("Locked"),
      "Archived": gt("Archived"),
      "1 Message": gt("1 Message"),
      "{count} Messages": gt("{count} Messages", { count: "{count}" }),
      "There are no recent messages in this thread.": gt("There are no recent messages in this thread."),
      "{actor} started a thread: {name}.": gt("{actor} started a thread: {name}.", { actor: "{actor}", name: "{name}" }),
      "a thread": gt("a thread"),
      "See all threads.": gt("See all threads."),
      // MessageHoverActions — threads
      "Create Thread": gt("Create Thread"),
      // MessageHoverActions — forwarding
      "Forward": gt("Forward"),
      // ForwardedMessageCard
      "Forwarded": gt("Forwarded"),
      "Jump to message": gt("Jump to message"),
      "You don't have access to the original message.": gt("You don't have access to the original message."),
      "Today at {time}": gt("Today at {time}", { time: "{time}" }),
      "Yesterday at {time}": gt("Yesterday at {time}", { time: "{time}" }),
      "{date} at {time}": gt("{date} at {time}", { date: "{date}", time: "{time}" }),
      // PollCard
      "Poll": gt("Poll"),
      "Poll closed": gt("Poll closed"),
      "Select one answer": gt("Select one answer"),
      "Select one or more answers": gt("Select one or more answers"),
      "View votes": gt("View votes"),
      "Your vote": gt("Your vote"),
      "1 vote": gt("1 vote"),
      "{count} votes": gt("{count} votes", { count: "{count}" }),
      "{count}d left": gt("{count}d left", { count: "{count}" }),
      "{count}h left": gt("{count}h left", { count: "{count}" }),
      "{count}m left": gt("{count}m left", { count: "{count}" }),
      "Show results": gt("Show results"),
      "Go back to vote": gt("Go back to vote"),
      "Remove Vote": gt("Remove Vote"),
      "Vote": gt("Vote"),
      "End Poll": gt("End Poll"),
      "End poll now?": gt("End poll now?"),
      "Everyone will see the results and no one can vote anymore.": gt("Everyone will see the results and no one can vote anymore."),
      "Couldn't save your vote.": gt("Couldn't save your vote."),
      "Couldn't end the poll.": gt("Couldn't end the poll."),
      // PollResultRow
      "Poll results": gt("Poll results"),
      "Your poll {question} has closed": gt("Your poll {question} has closed", { question: "{question}" }),
      "{name}'s poll {question} has closed": gt("{name}'s poll {question} has closed", { name: "{name}", question: "{question}" }),
      "Winning answer · {percent}%": gt("Winning answer · {percent}%", { percent: "{percent}" }),
      "There were no votes": gt("There were no votes"),
      "The results were tied": gt("The results were tied"),
      "View Poll": gt("View Poll"),
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

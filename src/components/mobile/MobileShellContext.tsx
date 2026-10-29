"use client";

import { createContext, useContext } from "react";
import { useParams, useSearchParams } from "next/navigation";

/**
 * The phone shell's navigation API (MobileShell). Present only inside the
 * single-page mobile pager; desktop and other screens get null and keep using
 * the router.
 */
export interface MobileShellApi {
  /**
   * Open a conversation ("/channels/s/c", "/dm/x", "/dm/group/g") or a list
   * ("/channels/s", "/channels/messages") in place: no page load, the URL
   * follows. `withUpdate` runs inside the same React transition (e.g. set the
   * current channel together with the new chat).
   */
  open: (href: string, withUpdate?: () => void) => void;
  /** Slide to the channel / DM list. */
  showList: () => void;
  /** Slide to the conversation. */
  showChat: () => void;
  /** Slide to the member list (server channels). */
  showMembers: () => void;
}

export const MobileShellContext = createContext<MobileShellApi | null>(null);

/** The mobile shell API, or null outside the phone pager. */
export function useMobileShell(): MobileShellApi | null {
  return useContext(MobileShellContext);
}

/** Route params of the conversation a pager panel renders (null elsewhere). */
export const ConversationParamsContext = createContext<Record<string, string> | null>(null);

/** Query of the conversation a pager panel renders (null elsewhere). */
export const ConversationSearchContext = createContext<URLSearchParams | null>(null);

// A page instance is rendered either by the router or by the phone shell for
// its whole life (the shell's contexts never appear or vanish under a mounted
// page), so the conditional router hooks below never flip for a component.
// Skipping them in the shell matters: Next re-renders every useParams /
// useSearchParams consumer on each history.pushState/replaceState, which the
// shell does on every panel change, and that used to re-render the whole chat.

/**
 * Route params for a conversation page: the shell's conversation inside the
 * phone pager (the URL there is updated in place, so the router's segments
 * don't follow), the router's params everywhere else.
 */
export function useConversationParams(): Record<string, string | string[] | undefined> {
  const shellParams = useContext(ConversationParamsContext);
  // eslint-disable-next-line react-hooks/rules-of-hooks -- stable per instance, see above
  return shellParams ?? useParams() ?? {};
}

/** Query params for a conversation page (same rules as useConversationParams). */
export function useConversationSearchParams(): URLSearchParams {
  const shellSearch = useContext(ConversationSearchContext);
  // eslint-disable-next-line react-hooks/rules-of-hooks -- stable per instance, see above
  return shellSearch ?? (useSearchParams() as unknown as URLSearchParams);
}

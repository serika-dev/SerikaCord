"use client";

import { useCallback, useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useServer } from "@/contexts/ServerContext";
import { useUnread } from "@/contexts/UnreadContext";
import { emitHotkey, matchHotkey, type HotkeyAction } from "@/lib/keybinds";

/** Channel types the up/down navigation shortcuts can land on. */
const NAVIGABLE = new Set(["text", "announcement", "forum"]);

/** True if the focused element is an editable text field. */
function isTypingTarget(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName.toLowerCase();
  return (
    tag === "input" ||
    tag === "textarea" ||
    tag === "select" ||
    el.getAttribute("contenteditable") === "true" ||
    (el as HTMLElement).isContentEditable
  );
}

/**
 * Global Discord-style keyboard shortcuts. Mount once at the app shell.
 * Navigation is resolved here; UI-toggle actions are broadcast via `emitHotkey`
 * for the owning component to handle.
 */
export function useAppHotkeys() {
  const router = useRouter();
  const pathname = usePathname();
  const { servers, currentServer, channels, currentChannel, setCurrentServer } = useServer();
  const { isChannelUnread, getMentionCount, markChannelRead } = useUnread();

  // Latest values without re-binding the window listener each render.
  const ref = useRef({ servers, currentServer, channels, currentChannel, setCurrentServer, isChannelUnread, getMentionCount, markChannelRead, router });
  useEffect(() => {
    ref.current = { servers, currentServer, channels, currentChannel, setCurrentServer, isChannelUnread, getMentionCount, markChannelRead, router };
  });

  // History of visited text-channel paths for "return to previous channel".
  const channelHistoryRef = useRef<string[]>([]);
  useEffect(() => {
    if (!pathname) return;
    if (!/^\/channels\/[^/]+\/[^/]+$/.test(pathname) && !/^\/dm\//.test(pathname)) return;
    const hist = channelHistoryRef.current;
    if (hist[hist.length - 1] !== pathname) {
      hist.push(pathname);
      if (hist.length > 20) hist.shift();
    }
  }, [pathname]);

  const navigableChannels = useCallback(
    () => ref.current.channels.filter((c) => NAVIGABLE.has(c.type)),
    []
  );

  const gotoChannel = useCallback((serverId: string, channelId: string) => {
    ref.current.router.push(`/channels/${serverId}/${channelId}`);
  }, []);

  const stepChannel = useCallback((dir: 1 | -1, filter?: (id: string) => boolean) => {
    const list = navigableChannels().filter((c) => (filter ? filter(c.id) : true));
    if (list.length === 0) return;
    const server = ref.current.currentServer;
    if (!server) return;
    const curId = ref.current.currentChannel?.id;
    const curIdx = list.findIndex((c) => c.id === curId);
    const nextIdx = curIdx === -1
      ? (dir === 1 ? 0 : list.length - 1)
      : (curIdx + dir + list.length) % list.length;
    gotoChannel(server.id, list[nextIdx].id);
  }, [navigableChannels, gotoChannel]);

  const stepServer = useCallback((dir: 1 | -1) => {
    const list = ref.current.servers;
    if (list.length === 0) return;
    const curIdx = list.findIndex((s) => s.id === ref.current.currentServer?.id);
    // From Home (no current server), Down → first, Up → last.
    const nextIdx = curIdx === -1
      ? (dir === 1 ? 0 : list.length - 1)
      : (curIdx + dir + list.length) % list.length;
    const target = list[nextIdx];
    ref.current.setCurrentServer(target);
    ref.current.router.push(`/channels/${target.id}`);
  }, []);

  const runAction = useCallback((action: HotkeyAction) => {
    const { currentServer, currentChannel, channels, markChannelRead, isChannelUnread, getMentionCount, router } = ref.current;
    switch (action) {
      case "nav-server-prev": return stepServer(-1);
      case "nav-server-next": return stepServer(1);
      case "nav-channel-prev": return stepChannel(-1);
      case "nav-channel-next": return stepChannel(1);
      case "nav-unread-prev": return stepChannel(-1, (id) => isChannelUnread(id));
      case "nav-unread-next": return stepChannel(1, (id) => isChannelUnread(id));
      case "nav-mention-prev": return stepChannel(-1, (id) => getMentionCount(id) > 0);
      case "nav-mention-next": return stepChannel(1, (id) => getMentionCount(id) > 0);
      case "nav-prev-channel": {
        const hist = channelHistoryRef.current;
        // Last entry is the current channel; jump to the one before it.
        const prev = hist[hist.length - 2];
        if (prev) router.push(prev);
        return;
      }
      case "nav-back": return void router.back();
      case "nav-forward": return void router.forward();
      case "toggle-mentions": return void router.push("/channels/notifications");
      case "mark-channel-read": {
        if (currentChannel) markChannelRead(currentChannel.id);
        return;
      }
      case "mark-server-read": {
        if (currentServer) channels.forEach((c) => markChannelRead(c.id));
        return;
      }
      case "open-help-center": return void router.push("/developers/docs");
      case "open-user-settings": return emitHotkey(action);
      // Everything else is owned by a component — broadcast it.
      default:
        emitHotkey(action);
    }
  }, [stepServer, stepChannel]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const hk = matchHotkey(e);
      if (!hk) return;
      const typing = isTypingTarget(document.activeElement);
      if (typing && !hk.worksWhileTyping) return;
      // Tab → focus composer must not clobber normal focus traversal: only
      // grab it when nothing is focused yet (activeElement is <body>).
      if (hk.action === "focus-composer" && document.activeElement !== document.body) return;
      // While a dialog/menu is open, let it own the keyboard (Escape closes it,
      // etc.) — only the help toggle and picker tab shortcuts stay global so
      // they can be used while the emoji picker popover is open.
      const modalOpen = document.querySelector('[role="dialog"],[role="alertdialog"],[role="menu"]');
      const allowedInModal = hk.action === "toggle-help" || hk.action === "toggle-gifs" || hk.action === "toggle-stickers" || hk.action === "toggle-emoji" || hk.action === "open-user-settings";
      if (modalOpen && !allowedInModal) return;
      e.preventDefault();
      e.stopPropagation();
      runAction(hk.action);
    };
    window.addEventListener("keydown", handler, { capture: true });
    return () => window.removeEventListener("keydown", handler, { capture: true } as EventListenerOptions);
  }, [runAction]);
}

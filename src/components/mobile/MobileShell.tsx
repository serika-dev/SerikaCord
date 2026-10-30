"use client";

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useGT } from "gt-next";
import { Users } from "lucide-react";
import { useServer } from "@/contexts/ServerContext";
import { useBackHandler } from "@/hooks/useBackHandler";
import { isNativeApp } from "@/lib/native/bridge";
import { cn } from "@/lib/utils";
import { conversationParams, parseShellRoute, shellListHref, type PagerPanel, type ShellFamily } from "@/lib/mobile/pager";
import { MobilePager, type MobilePagerHandle } from "./MobilePager";
import { ConversationParamsContext, ConversationSearchContext, MobileShellContext, type MobileShellApi } from "./MobileShellContext";

const panelFallback = () => <div className="flex-1 bg-[var(--bg-app)]" />;

// The conversation pages themselves, rendered by the shell for the
// conversation on screen (the router's page for the URL is not mounted on
// phones, so switching never waits for a route load).
const loadChannelPage = () => import("@/app/channels/[serverId]/[channelId]/page");
const loadDmPage = () => import("@/app/dm/[recipientId]/page");
const loadGroupDmPage = () => import("@/app/dm/group/[channelId]/page");
const ChannelConversation = dynamic(loadChannelPage, { loading: panelFallback });
const DmConversation = dynamic(loadDmPage, { loading: panelFallback });
const GroupDmConversation = dynamic(loadGroupDmPage, { loading: panelFallback });

const railFallback = () => <div className="h-full w-[72px] min-w-[72px] bg-[var(--bg-sidebar)]" />;
const MobileServerList = dynamic(() => import("./MobileServerList").then((m) => m.MobileServerList), { loading: railFallback });
const MobileServerView = dynamic(() => import("./MobileServerView").then((m) => m.MobileServerView), { loading: panelFallback });
const MobileMessagesView = dynamic(() => import("./MobileMessagesView").then((m) => m.MobileMessagesView), { loading: panelFallback });
const MemberSidebar = dynamic(() => import("@/components/chat/MemberSidebar").then((m) => m.MemberSidebar), { loading: panelFallback });

/** Marks a history entry the shell pushed for a conversation opened from its list. */
const PUSH_KEY = "__scPagerPush";
/**
 * This page load's id: history state survives a reload, but only entries
 * pushed by this load are known to sit right above their list.
 */
const LOAD_ID = Math.random().toString(36).slice(2, 10);
const pushMark = (href: string) => `${LOAD_ID}:${href}`;

interface ShellNav {
  /** The pathname this state stands for. */
  path: string;
  family: ShellFamily;
  serverId?: string;
  /** Conversation href shown in the chat panel (kept while the list is open). */
  conv: string | null;
  panel: PagerPanel;
}

function navFromPath(pathname: string, prev: ShellNav | null): ShellNav {
  const route = parseShellRoute(pathname);
  if (!route) return prev ?? { path: pathname, family: "server", conv: null, panel: "list" };
  if (route.conversation) {
    return { path: pathname, family: route.family, serverId: route.serverId, conv: route.conversation, panel: "chat" };
  }
  // A list: keep the conversation beside it while it's the same server / DM family.
  const keep = prev && prev.family === route.family && prev.serverId === route.serverId ? prev.conv : null;
  return { path: pathname, family: route.family, serverId: route.serverId, conv: keep, panel: "list" };
}

function historyState(): Record<string, unknown> {
  const state = (window.history.state ?? {}) as Record<string, unknown>;
  // Next.js re-adds its own keys (and only syncs usePathname when they're absent).
  const rest = { ...state };
  delete rest.__NA;
  delete rest.__PRIVATE_NEXTJS_INTERNALS_TREE;
  return rest;
}

/** Update the URL in place (Next's patched replaceState: usePathname follows, nothing remounts or loads). */
function replaceUrl(href: string) {
  if (window.location.pathname === href) return;
  const state = historyState();
  if (state[PUSH_KEY]) state[PUSH_KEY] = parseShellRoute(href)?.conversation ? pushMark(href) : undefined;
  window.history.replaceState(state, "", href);
}

/** A new entry for a conversation opened from the list, so browser Back returns to the list. */
function pushUrl(href: string) {
  if (window.location.pathname === href) return;
  const state = historyState();
  delete state.__serikaOverlay;
  window.history.pushState({ ...state, [PUSH_KEY]: pushMark(href) }, "", href);
}

const MembersPanel = memo(function MembersPanel() {
  const gt = useGT();
  return (
    <div className="flex h-full min-h-0 flex-col pt-safe">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-[var(--app-border)] px-4 font-semibold text-[var(--text-primary)]">
        <Users className="h-5 w-5" aria-hidden="true" />
        <h2>{gt("Members")}</h2>
      </div>
      <div className="min-h-0 flex-1 pb-safe">
        <MemberSidebar />
      </div>
    </div>
  );
});

const ConversationPanel = memo(function ConversationPanel({ href, padTop, footer }: { href: string; padTop: boolean; footer: React.ReactNode }) {
  const params = useMemo(() => conversationParams(href), [href]);
  // The query the conversation was opened with (?call=, ?jump=), read once per conversation.
  const search = useMemo(() => new URLSearchParams(href && typeof window !== "undefined" ? window.location.search : ""), [href]);
  const route = parseShellRoute(href);
  const id = params?.channelId ?? params?.recipientId ?? href;
  return (
    <ConversationParamsContext.Provider value={params}>
      <ConversationSearchContext.Provider value={search}>
      <main className={cn("flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden", padTop && "pt-safe", !footer && "pb-safe")}>
        {route?.family === "server" ? (
          <ChannelConversation key={id} />
        ) : params?.recipientId ? (
          <DmConversation key={id} />
        ) : (
          <GroupDmConversation key={id} />
        )}
      </main>
      {footer}
      </ConversationSearchContext.Provider>
    </ConversationParamsContext.Provider>
  );
});

/**
 * The phone app shell for servers and DMs: one persistent page with the
 * channel (or DM) list, the conversation and the member list side by side
 * (MobilePager). Opening a channel, swiping between panels and going back
 * never load a route: the URL follows with history.pushState/replaceState,
 * so reload, deep links and the back button still work.
 */
export function MobileShell({
  pathname,
  onCreateServer,
  voiceBar,
}: {
  pathname: string;
  onCreateServer: () => void;
  /** Voice bar shown under the conversation while connected elsewhere. */
  voiceBar: React.ReactNode;
}) {
  const router = useRouter();
  const pagerRef = useRef<MobilePagerHandle>(null);
  const { servers, isLoading, currentServer, setCurrentServer } = useServer();
  const [nav, setNav] = useState<ShellNav>(() => navFromPath(pathname, null));
  // The URL changed from outside (router navigation, browser back/forward):
  // derive the panels from it (state from props, no effect round trip).
  if (pathname !== nav.path && parseShellRoute(pathname)) {
    setNav(navFromPath(pathname, nav));
  }
  const navRef = useRef(nav);
  /** Conversation an open() is switching to, until its URL is committed. */
  const pendingConv = useRef<string | null>(null);
  const commitUrlRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    navRef.current = nav;
  }, [nav]);

  const hasChat = !!nav.conv;
  // A new conversation committed: show the chat panel's content again, then
  // let the URL follow (a separate task, after this frame's work).
  useLayoutEffect(() => {
    pagerRef.current?.blankChat(false);
    const commit = commitUrlRef.current;
    commitUrlRef.current = null;
    if (!commit) return;
    const t = setTimeout(commit, 0);
    return () => clearTimeout(t);
  }, [nav.conv]);
  const hasMembers = hasChat && nav.family === "server";

  // A server's list opened by URL (reload, deep link): select that server.
  useEffect(() => {
    if (nav.family !== "server" || !nav.serverId || isLoading || servers.length === 0) return;
    const server = servers.find((s) => s.id === nav.serverId);
    if (!server) {
      router.replace("/channels/me");
      return;
    }
    if (currentServer?.id !== server.id) setCurrentServer(server);
  }, [nav.family, nav.serverId, servers, isLoading, currentServer?.id, setCurrentServer, router]);

  // Warm the conversation chunks so the first open doesn't wait for them.
  useEffect(() => {
    const warm = () => {
      void loadChannelPage();
      void loadDmPage();
      void loadGroupDmPage();
      void import("@/components/chat/MemberSidebar");
    };
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
    if (w.requestIdleCallback) w.requestIdleCallback(warm, { timeout: 2000 });
    else setTimeout(warm, 800);
  }, []);

  /** A panel finished moving (gesture, button, back): commit URL + state after the motion. */
  const onSettle = useCallback((panel: PagerPanel) => {
    const cur = navRef.current;
    const list = shellListHref(cur);
    if (panel === "list") {
      setNav((n) => ({ ...n, panel: "list", path: list }));
      const state = window.history.state as Record<string, unknown> | null;
      if (state?.[PUSH_KEY] === pushMark(window.location.pathname)) window.history.back();
      else replaceUrl(list);
      return;
    }
    // An open() in flight commits its own URL.
    if (panel === "chat" && pendingConv.current) return;
    if (panel === "chat" && cur.conv) {
      const conv = cur.conv;
      setNav((n) => ({ ...n, panel: "chat", path: conv }));
      if (window.location.pathname === list && !isNativeApp()) pushUrl(conv);
      else replaceUrl(conv);
      return;
    }
    if (panel === "members") setNav((n) => ({ ...n, panel: "members" }));
  }, []);

  const api = useMemo<MobileShellApi>(() => ({
    open: (href, withUpdate) => {
      const route = parseShellRoute(href);
      if (!route) {
        withUpdate?.();
        router.push(href);
        return;
      }
      const cur = navRef.current;
      if (!route.conversation) {
        // Another list (server switch from the rail, DM list).
        if (window.location.pathname !== href) replaceUrl(href);
        withUpdate?.();
        setNav((n) => navFromPath(href, n));
        return;
      }
      if (cur.conv === href) {
        // Already the chat beside the list: just slide back to it (no render).
        withUpdate?.();
        pagerRef.current?.goTo("chat");
        return;
      }
      const fromList = cur.panel === "list" && window.location.pathname === shellListHref(cur);
      const next: ShellNav = { path: href, family: route.family, serverId: route.serverId, conv: href, panel: "chat" };
      // The URL follows once the new chat has rendered: Next re-renders its
      // router tree on every history update, which must not hold up the slide.
      pendingConv.current = href;
      commitUrlRef.current = () => {
        if (pendingConv.current !== href) return;
        pendingConv.current = null;
        if (fromList && !isNativeApp()) pushUrl(href);
        else replaceUrl(href);
      };
      if (cur.conv) {
        // The chat panel exists: start the slide now (a compositor animation,
        // its content hidden so the old chat never flashes), then render the
        // new chat once that first frame is out; it shows when committed.
        pagerRef.current?.blankChat(true);
        pagerRef.current?.goTo("chat");
        requestAnimationFrame(() => {
          setTimeout(() => {
            withUpdate?.();
            setNav(next);
          }, 0);
        });
      } else {
        withUpdate?.();
        setNav(next);
      }
    },
    showList: () => pagerRef.current?.goTo("list"),
    showChat: () => pagerRef.current?.goTo("chat"),
    showMembers: () => pagerRef.current?.goTo("members"),
  }), [router]);

  // Android back (native shell): members → chat → list → (NativeAppBridge) home.
  // In browsers the conversation's own history entry takes the back step
  // (no extra overlay entries, so the history stays list → chat).
  useBackHandler(hasChat && nav.panel !== "list" && isNativeApp(), () => {
    pagerRef.current?.goTo(navRef.current.panel === "members" ? "chat" : "list");
  });

  // The member list renders once the browser is idle after a chat opens.
  const [membersReady, setMembersReady] = useState(false);
  useEffect(() => {
    if (!hasMembers || membersReady) return;
    const t = setTimeout(() => setMembersReady(true), 600);
    return () => clearTimeout(t);
  }, [hasMembers, membersReady]);

  // The list panel's element only changes with the family / server selection,
  // so URL updates (which re-render this shell) never re-render the list.
  const createServerRef = useRef(onCreateServer);
  useEffect(() => {
    createServerRef.current = onCreateServer;
  }, [onCreateServer]);
  const hasServer = !!currentServer;
  const list = useMemo(
    () =>
      nav.family === "server" ? (
        <div className="flex h-full min-h-0">
          <MobileServerList onCreateServer={() => createServerRef.current()} onServerSelect={(server) => api.open(`/channels/${server.id}`)} />
          {hasServer && <MobileServerView />}
        </div>
      ) : (
        <MobileMessagesView
          onAddFriend={() => {
            router.push("/channels/me?tab=add");
            window.dispatchEvent(new CustomEvent("openFriendsTab", { detail: { tab: "add" } }));
          }}
        />
      ),
    [nav.family, hasServer, api, router],
  );
  const chat = useMemo(
    () => (nav.conv ? <ConversationPanel href={nav.conv} padTop={nav.family === "server"} footer={voiceBar} /> : null),
    [nav.conv, nav.family, voiceBar],
  );
  const members = useMemo(() => (membersReady || nav.panel === "members" ? <MembersPanel /> : null), [membersReady, nav.panel]);

  return (
    <MobileShellContext.Provider value={api}>
      <MobilePager
        ref={pagerRef}
        panel={hasChat ? nav.panel : "list"}
        hasChat={hasChat}
        hasMembers={hasMembers}
        onSettle={onSettle}
        list={list}
        chat={chat}
        members={members}
      />
    </MobileShellContext.Provider>
  );
}

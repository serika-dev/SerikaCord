"use client";

import { useState, useEffect, useRef, useMemo, useSyncExternalStore } from "react";
import { useRouter, usePathname } from "next/navigation";
import dynamic from "next/dynamic";
import { useAuth } from "@/contexts/AuthContext";
import { useServer } from "@/contexts/ServerContext";
import { useAppHotkeys } from "@/hooks/useAppHotkeys";
import { onHotkey } from "@/lib/keybinds";
import { ServerSidebar } from "@/components/layout/ServerSidebar";
import { ChannelSidebar } from "@/components/layout/ChannelSidebar";
import { BottomNavigation } from "@/components/mobile";
import { VoiceBar } from "@/components/voice/VoiceBar";
import { VoiceAudioSink } from "@/components/voice/VoiceAudioSink";
import { IncomingCall } from "@/components/voice/IncomingCall";
import { voiceService } from "@/lib/services/voiceService";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { MountWhenOpened } from "@/components/ui/MountWhenOpened";
import { T, useGT } from "gt-next";
import { Loader } from "@/components/ui/Loader";
import { AppSplash } from "@/components/boot/AppSplash";
import { Logo } from "@/components/ui/Logo";
import { toast } from "sonner";
import { parseServerLinkReturn } from "@/lib/connections/serverOwned";
import { ServerOnboardingAutoRoute } from "@/components/server/community/ServerOnboardingAutoRoute";
import type { ServerSettingsTab } from "@/components/dialogs/ServerSettingsDialog";
import { useVisualViewportVars } from "@/hooks/useVisualViewport";
import { parseShellRoute } from "@/lib/mobile/pager";
import { PHONE_QUERY } from "@/lib/layout/breakpoints";

const dialogFallback = () => <div className="hidden" />;
const mobileFallback = () => <div className="flex-1 bg-[var(--bg-app)]" />;

const CreateServerDialog = dynamic(
  () => import("@/components/dialogs/CreateServerDialog").then((m) => m.CreateServerDialog),
  { loading: dialogFallback }
);
const CreateChannelDialog = dynamic(
  () => import("@/components/dialogs/CreateChannelDialog").then((m) => m.CreateChannelDialog),
  { loading: dialogFallback }
);
const UserSettingsDialog = dynamic(
  () => import("@/components/dialogs/UserSettingsDialog").then((m) => m.UserSettingsDialog),
  { loading: dialogFallback }
);
const InviteDialog = dynamic(
  () => import("@/components/dialogs/InviteDialog").then((m) => m.InviteDialog),
  { loading: dialogFallback }
);
const ServerSettingsDialog = dynamic(
  () => import("@/components/dialogs/ServerSettingsDialog").then((m) => m.ServerSettingsDialog),
  { loading: dialogFallback }
);
const ChannelSettingsDialog = dynamic(
  () => import("@/components/dialogs/ChannelSettingsDialog").then((m) => m.ChannelSettingsDialog),
  { loading: dialogFallback }
);
// Keyboard-only (Ctrl+/, Ctrl+K): desktop layout only, loaded after first paint.
const KeyboardShortcutsDialog = dynamic(
  () => import("@/components/KeyboardShortcutsDialog").then((m) => m.KeyboardShortcutsDialog),
  { ssr: false }
);
const QuickSwitcher = dynamic(
  () => import("@/components/QuickSwitcher").then((m) => m.QuickSwitcher),
  { ssr: false }
);

// Phone layout breakpoint, read synchronously (no desktop-first render that
// mounts both sidebars and then swaps to the phone shell).
const MOBILE_QUERY = PHONE_QUERY;
function subscribeMobile(onChange: () => void) {
  const mql = window.matchMedia(MOBILE_QUERY);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}
const getMobileSnapshot = () => window.matchMedia(MOBILE_QUERY).matches;
const getMobileServerSnapshot = () => false;

// Rail-sized placeholder: the page beside it doesn't jump when the rail loads.
const railFallback = () => <div className="h-full w-[72px] min-w-[72px] bg-[var(--bg-sidebar)]" />;
const MobileServerList = dynamic(
  () => import("@/components/mobile/MobileServerList").then((m) => m.MobileServerList),
  { loading: railFallback }
);
const MobileServerView = dynamic(
  () => import("@/components/mobile/MobileServerView").then((m) => m.MobileServerView),
  { loading: mobileFallback }
);
const MobileMessagesView = dynamic(
  () => import("@/components/mobile/MobileMessagesView").then((m) => m.MobileMessagesView),
  { loading: mobileFallback }
);
// Phone servers + DMs: one persistent page (list | chat | members).
const MobileShell = dynamic(
  () => import("@/components/mobile/MobileShell").then((m) => m.MobileShell),
  { loading: mobileFallback }
);
const MobileNotificationsView = dynamic(
  () => import("@/components/mobile/MobileNotificationsView").then((m) => m.MobileNotificationsView),
  { loading: mobileFallback }
);
const MobileProfileView = dynamic(
  () => import("@/components/mobile/MobileProfileView").then((m) => m.MobileProfileView),
  { loading: mobileFallback }
);
// Suspended accounts only ever see this screen (loaded on demand).
const SuspendedScreen = dynamic(() => import("@/components/safety/SuspendedScreen"), {
  loading: () => (
    <div className="h-dvh bg-[var(--bg-app)] flex items-center justify-center">
      <Loader size={48} />
    </div>
  ),
});

function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, isLoading, suspended, refresh } = useAuth();
  const router = useRouter();
  const gt = useGT();
  const recheckRef = useRef(false);
  // The splash only appears for a session that was still loading when the app
  // opened; it then stays mounted (same tree position) to fade out over the app.
  const [splashShown] = useState(isLoading);
  const [splashDone, setSplashDone] = useState(false);

  useEffect(() => {
    if (!isLoading && !user && !suspended) {
      // Re-check auth once before redirecting, in case the auth cookie
      // was set by a login/register on another page but the context
      // hasn't refreshed yet. This prevents infinite redirect loops.
      if (!recheckRef.current) {
        recheckRef.current = true;
        void refresh();
        return;
      }
      router.push("/login");
    }
  }, [user, isLoading, suspended, router, refresh]);

  // Suspended: Account Standing + appeal + log out, instead of the app.
  if (suspended && !user) return <SuspendedScreen />;

  let content: React.ReactNode = null;
  if (isLoading) {
    content = null;
  } else if (!user) {
    content = (
      <div className="h-dvh bg-[var(--bg-app)] flex flex-col items-center justify-center">
        <div className="flex flex-col items-center gap-6 text-center px-4">
          <Logo variant="icon" size="xl" />
          
          <div>
            <h1 className="text-2xl font-bold text-[var(--text-primary)] mb-2"><T>Welcome to SerikaCord</T></h1>
            <p className="text-[var(--text-secondary)] max-w-md">
              <T>Sign in to access your servers, chat with friends, and join communities.</T>
            </p>
          </div>
          
          <div className="flex gap-3">
            <Link
              href="/login"
              className="px-6 py-3 bg-[#8B5CF6] hover:bg-[#7C3AED] text-white font-medium rounded-md transition-colors"
            >
              {gt("Sign In")}
            </Link>
            <Link
              href="/register"
              className="px-6 py-3 bg-[var(--bg-card)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] text-[var(--text-primary)] font-medium rounded-md transition-colors"
            >
              {gt("Create Account")}
            </Link>
          </div>
        </div>
      </div>
    );
  } else {
    content = children;
  }

  return (
    <>
      {content}
      {splashShown && !splashDone && <AppSplash exiting={!isLoading} onExited={() => setSplashDone(true)} />}
    </>
  );
}

function ChannelsContent({ children }: { children: React.ReactNode }) {
  const [showCreateServer, setShowCreateServer] = useState(false);
  const [createChannelOptions, setCreateChannelOptions] = useState<{
    open: boolean;
    defaultType?: "text" | "voice" | "category";
    defaultParentId?: string;
  }>({ open: false });
  const [showUserSettings, setShowUserSettings] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<string | null>(null);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteServerId, setInviteServerId] = useState<string | null>(null);
  const [showServerSettings, setShowServerSettings] = useState(false);
  const [serverSettingsTab, setServerSettingsTab] = useState<ServerSettingsTab | null>(null);
  const [channelSettingsId, setChannelSettingsId] = useState<string | null>(null);
  const pathname = usePathname();
  const router = useRouter();
  const gt = useGT();
  const { currentServer, currentChannel, channels } = useServer();

  // Live voice room id (null when not connected) so the mobile VoiceBar can
  // show the channel's name instead of the raw "channel-<id>" room id.
  const voiceRoomId = useSyncExternalStore(
    (onChange) => voiceService.subscribe(() => onChange()),
    () => (voiceService.connected ? voiceService.currentRoomId : null),
    () => null,
  );
  const voiceChannelName = useMemo(
    () => (voiceRoomId ? channels.find((c) => `channel-${c.id}` === voiceRoomId)?.name : undefined),
    [channels, voiceRoomId],
  );

  // Global Discord-style keyboard shortcuts (navigation handled internally;
  // UI actions arrive as broadcast events, wired below).
  useAppHotkeys();
  useEffect(() => {
    const unsubs = [
      onHotkey("create-server", () => setShowCreateServer(true)),
      onHotkey("open-user-settings", () => { setSettingsInitialTab(null); setShowUserSettings(true); }),
    ];
    return () => unsubs.forEach((u) => u());
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const settingsTab = params.get("settings") || params.get("openSettings");
      if (settingsTab) {
        // Clear params to avoid loop / reuse
        const newUrl = window.location.pathname;
        window.history.replaceState({}, document.title, newUrl);

        if (window.matchMedia(PHONE_QUERY).matches) {
          router.push(`/channels/settings/${settingsTab}`);
        } else {
          setShowUserSettings(true);
        }
      }

      // Back from linking an account for a server (OAuth): reopen Server
      // Settings → Server Connections and say how it went.
      const serverLink = parseServerLinkReturn(window.location.search);
      if (serverLink) {
        window.history.replaceState({}, document.title, window.location.pathname);
        if (serverLink.linked) {
          toast.success(gt("Account linked to this server"));
        } else if (serverLink.error) {
          switch (serverLink.error) {
            case "denied":
              toast.error(gt("Linking was cancelled"));
              break;
            case "wrong_user":
              toast.error(gt("Sign in as the server owner to link accounts"));
              break;
            case "not_owner":
              toast.error(gt("Only the server owner can link accounts to the server"));
              break;
            case "too_many":
              toast.error(gt("This server already has the maximum number of connections"));
              break;
            case "provider_disabled":
            case "connections_disabled":
              toast.error(gt("Linking this kind of account is turned off right now"));
              break;
            default:
              toast.error(gt("Could not link the account. Try again."));
          }
        }
        setServerSettingsTab(serverLink.tab);
        setShowServerSettings(true);
      }
    }
  }, [router, gt]);

  // Listen for custom events from UserPanel and mobile views
  useEffect(() => {
    const handleOpenSettings = (e: Event) => {
      setSettingsInitialTab((e as CustomEvent<{ tab?: string } | undefined>).detail?.tab ?? null);
      setShowUserSettings(true);
    };
    const handleOpenInvite = (e: Event) => {
      setInviteServerId((e as CustomEvent<{ serverId?: string } | undefined>).detail?.serverId ?? null);
      setShowInvite(true);
    };
    const handleOpenServerSettings = () => {
      setServerSettingsTab(null);
      setShowServerSettings(true);
    };
    // Phone sheets (server / channel long-press menus) ask for these dialogs.
    const handleOpenCreateChannel = (e: Event) => {
      const detail = (e as CustomEvent<{ type?: "text" | "voice" | "category"; parentId?: string } | undefined>).detail;
      setCreateChannelOptions({ open: true, defaultType: detail?.type, defaultParentId: detail?.parentId });
    };
    const handleOpenChannelSettings = (e: Event) => {
      const id = (e as CustomEvent<{ channelId?: string } | undefined>).detail?.channelId;
      if (id) setChannelSettingsId(id);
    };
    window.addEventListener('openUserSettings', handleOpenSettings);
    window.addEventListener('openInviteDialog', handleOpenInvite);
    window.addEventListener('openServerSettings', handleOpenServerSettings);
    window.addEventListener('openCreateChannel', handleOpenCreateChannel);
    window.addEventListener('openChannelSettings', handleOpenChannelSettings);
    return () => {
      window.removeEventListener('openUserSettings', handleOpenSettings);
      window.removeEventListener('openInviteDialog', handleOpenInvite);
      window.removeEventListener('openServerSettings', handleOpenServerSettings);
      window.removeEventListener('openCreateChannel', handleOpenCreateChannel);
      window.removeEventListener('openChannelSettings', handleOpenChannelSettings);
    };
  }, []);

  // Track if we're on mobile
  const isMobile = useSyncExternalStore(subscribeMobile, getMobileSnapshot, getMobileServerSnapshot);
  // iOS keyboard: track the visual viewport so the phone shell shrinks with it.
  useVisualViewportVars(isMobile);

  const mobileView: "servers" | "messages" | "notifications" | "profile" = pathname?.includes("/messages")
    ? "messages"
    : pathname?.includes("/notifications")
      ? "notifications"
      : pathname?.includes("/profile")
        ? "profile"
        : "servers";

  // In a conversation: a server channel, a DM or a group DM (the shell is
  // shared by /channels/* and /dm/*).
  const isDmRoute = /^\/dm\/.+/.test(pathname || "");
  const isInChannel = isDmRoute || /\/channels\/[^/]+\/[^/]+$/.test(pathname || "");
  const isSettingsRoute = pathname?.startsWith("/channels/settings");
  // The full-page server join flow (/channels/:serverId/onboarding).
  const isOnboardingRoute = /^\/channels\/[^/]+\/onboarding$/.test(pathname || "");
  // Voice channel pages show full controls in the main area.
  const showInFlowVoiceBar = !!isInChannel && !isOnboardingRoute && !!voiceRoomId && currentChannel?.type !== "voice";

  // Transition key: changes only between sections (a server, Home with its
  // DMs, explore, settings), never for a channel or DM switch inside one.
  const contentKey = useMemo(() => {
    if (!pathname) return "channels";
    if (pathname.startsWith("/dm/") || pathname === "/channels/me" || pathname.startsWith("/channels/me/")) return "home";
    if (pathname.startsWith("/channels/settings")) return "/channels/settings";
    if (pathname.startsWith("/channels/explore")) return "/channels/explore";

    const serverMatch = pathname.match(/^\/channels\/([^/]+)/);
    if (serverMatch) {
      const serverId = serverMatch[1];
      const specialRoutes = ["explore", "settings", "me", "notifications", "profile", "messages"];
      if (!specialRoutes.includes(serverId)) {
        return `/channels/server/${serverId}`;
      }
    }
    return pathname;
  }, [pathname]);

  // Servers (channel list + chat + members) and DMs (list + chat) on phones.
  const shellRoute = isMobile ? parseShellRoute(pathname) : null;

  // Mobile Layout
  if (isMobile) {
    return (
      <div className="flex h-[var(--app-height,100dvh)] bg-[var(--bg-app)] overflow-hidden pl-safe pr-safe">
        {shellRoute ? (
          <MobileShell
            pathname={pathname || ""}
            onCreateServer={() => setShowCreateServer(true)}
            voiceBar={
              showInFlowVoiceBar ? (
                <VoiceBar channelName={voiceChannelName} className="desk:hidden pb-[calc(0.5rem+var(--safe-area-bottom))]" />
              ) : null
            }
          />
        ) : (
        <>
        {/* Mobile Server List - Only show in servers view when not in a channel */}
        {mobileView === "servers" && !isInChannel && !isSettingsRoute && (
          <MobileServerList 
            onCreateServer={() => setShowCreateServer(true)}
            onServerSelect={(server) => {
              // Into the server shell without a route load (Back returns here).
              window.history.pushState(null, "", `/channels/${server.id}`);
            }}
          />
        )}

        {/* Mobile Content Area */}
        <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
          {/* Screens enter with a short CSS slide (compositor-only) and never
              wait for the previous screen to animate out, so taps feel
              instant. Channel switches inside one server keep the same key. */}
          {isSettingsRoute ? (
            <main
              key={contentKey}
              className="mobile-screen-enter flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden pt-safe pb-[var(--mobile-content-pb)]"
            >
              {children}
            </main>
          ) : isOnboardingRoute ? (
            // The join flow is edge to edge: it pads the safe areas itself.
            <main key={contentKey} className="mobile-screen-push flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
              {children}
            </main>
          ) : isInChannel ? (
            // When in a specific channel, render the chat full-height —
            // the bottom nav hides itself inside conversations.
            <main
              key={contentKey}
              className={cn(
                "mobile-screen-push flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden",
                // DM headers pad the status bar themselves.
                !isDmRoute && "pt-safe",
                !showInFlowVoiceBar && "pb-safe"
              )}
            >
              {children}
            </main>
          ) : mobileView === "servers" && currentServer ? (
            <MobileServerView key={currentServer.id} />
          ) : mobileView === "messages" ? (
            <div className="mobile-screen-enter flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
              <MobileMessagesView onAddFriend={() => {
                    router.push("/channels/me?tab=add");
                    window.dispatchEvent(new CustomEvent("openFriendsTab", { detail: { tab: "add" } }));
                  }} />
            </div>
          ) : mobileView === "notifications" ? (
            <div className="mobile-screen-enter flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
              <MobileNotificationsView />
            </div>
          ) : mobileView === "profile" ? (
            <div className="mobile-screen-enter flex-1 flex min-w-0 min-h-0 overflow-hidden">
              <MobileProfileView />
            </div>
          ) : (
            // Show channel content or DMs when in servers view without a selected server
            <main
              key={contentKey}
              className="mobile-screen-enter flex-1 flex min-w-0 min-h-0 overflow-hidden pt-safe pb-[var(--mobile-content-pb)]"
            >
              {children}
            </main>
          )}

          {/* Inside a conversation the bottom nav is hidden: keep the voice bar
              in normal flow so the chat shrinks instead of being covered. */}
          {showInFlowVoiceBar && (
            <VoiceBar
              channelName={voiceChannelName}
              className="desk:hidden pb-[calc(0.5rem+var(--safe-area-bottom))]"
            />
          )}
        </div>
        </>
        )}

        {/* Voice Bar above the bottom nav when in a call (not inside a chat or settings) */}
        {!isInChannel && !isSettingsRoute && (
          <VoiceBar
            channelName={voiceChannelName}
            className="theme-solid fixed bottom-[var(--mobile-content-pb)] left-0 right-0 z-40 desk:hidden"
          />
        )}
        <VoiceAudioSink />
        <IncomingCall />
        {currentServer && <ServerOnboardingAutoRoute key={currentServer.id} serverId={currentServer.id} />}

        {/* Bottom Navigation */}
        <BottomNavigation />

        {/* Dialogs (keyboard shortcut dialogs are desktop-only) */}
        <MountWhenOpened open={showCreateServer}>
          <CreateServerDialog
            open={showCreateServer}
            onOpenChange={setShowCreateServer}
          />
        </MountWhenOpened>
        <MountWhenOpened open={createChannelOptions.open}>
          <CreateChannelDialog
            open={createChannelOptions.open}
            onOpenChange={(open) => setCreateChannelOptions((prev) => ({ ...prev, open }))}
            defaultType={createChannelOptions.defaultType}
            defaultParentId={createChannelOptions.defaultParentId}
          />
        </MountWhenOpened>
        <MountWhenOpened open={showUserSettings}>
          <UserSettingsDialog
            open={showUserSettings}
            onOpenChange={setShowUserSettings}
            initialTab={settingsInitialTab}
          />
        </MountWhenOpened>
        <MountWhenOpened open={showInvite}>
          <InviteDialog
            open={showInvite}
            onOpenChange={setShowInvite}
            serverId={inviteServerId}
          />
        </MountWhenOpened>
        <MountWhenOpened open={showServerSettings}>
          <ServerSettingsDialog
            open={showServerSettings}
            onOpenChange={setShowServerSettings}
            initialTab={serverSettingsTab}
          />
        </MountWhenOpened>
        <MountWhenOpened open={!!channelSettingsId}>
          {channelSettingsId && (
            <ChannelSettingsDialog
              open
              onOpenChange={(open) => { if (!open) setChannelSettingsId(null); }}
              channelId={channelSettingsId}
            />
          )}
        </MountWhenOpened>
      </div>
    );
  }

  // Desktop Layout (also iPad and tablets in the native apps, where the web
  // view runs edge to edge: keep the shell clear of the status bar and the
  // home indicator; both insets are 0 in browsers and the desktop apps).
  return (
    <div className="flex h-dvh bg-[var(--bg-app)] overflow-hidden pt-safe pb-safe pl-safe pr-safe">
      {/* Combined Sidebars */}
      <div className="flex flex-shrink-0 h-full min-h-0">
        <ServerSidebar
          onCreateServer={() => setShowCreateServer(true)}
          onInvitePeople={(serverId?: string) => { setInviteServerId(serverId ?? null); setShowInvite(true); }}
        />
        {pathname !== "/channels/explore" && !isOnboardingRoute && (
          <ChannelSidebar
            onCreateChannel={(defaultType, defaultParentId) =>
              setCreateChannelOptions({ open: true, defaultType, defaultParentId })
            }
            onInvitePeople={() => { setInviteServerId(null); setShowInvite(true); }}
            onServerSettings={() => { setServerSettingsTab(null); setShowServerSettings(true); }}
          />
        )}
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
        {/* No exit animation: the next page mounts at once (AnimatePresence
            mode="wait" held every server/DM switch until the old page had
            animated out). A section change gets a short opacity settle. */}
        <main key={contentKey} className="app-page-enter flex-1 flex min-w-0 min-h-0 overflow-hidden">
          {children}
        </main>
      </div>

      {/* Dialogs */}
      <KeyboardShortcutsDialog />
      <QuickSwitcher />
      <MountWhenOpened open={showCreateServer}>
        <CreateServerDialog
          open={showCreateServer}
          onOpenChange={setShowCreateServer}
        />
      </MountWhenOpened>
      <MountWhenOpened open={createChannelOptions.open}>
        <CreateChannelDialog
          open={createChannelOptions.open}
          onOpenChange={(open) => setCreateChannelOptions((prev) => ({ ...prev, open }))}
          defaultType={createChannelOptions.defaultType}
          defaultParentId={createChannelOptions.defaultParentId}
        />
      </MountWhenOpened>
      <MountWhenOpened open={showUserSettings}>
        <UserSettingsDialog
          open={showUserSettings}
          onOpenChange={setShowUserSettings}
          initialTab={settingsInitialTab}
        />
      </MountWhenOpened>
      <MountWhenOpened open={showInvite}>
        <InviteDialog
          open={showInvite}
          onOpenChange={setShowInvite}
          serverId={inviteServerId}
        />
      </MountWhenOpened>
      <MountWhenOpened open={showServerSettings}>
        <ServerSettingsDialog
          open={showServerSettings}
          onOpenChange={setShowServerSettings}
          initialTab={serverSettingsTab}
        />
      </MountWhenOpened>
      <VoiceAudioSink />
      <IncomingCall />
      {currentServer && <ServerOnboardingAutoRoute key={currentServer.id} serverId={currentServer.id} />}
    </div>
  );
}

export default function ChannelsLayoutClient({
  children,
}: {
  children: React.ReactNode;
}) {
  // Server/unread providers live in AppProviders (root layout) so they
  // survive switching between DMs and servers.
  return (
    <AuthGate>
      <ChannelsContent>{children}</ChannelsContent>
    </AuthGate>
  );
}

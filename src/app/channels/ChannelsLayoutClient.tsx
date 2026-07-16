"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { useRouter, usePathname } from "next/navigation";
import dynamic from "next/dynamic";
import { useAuth } from "@/contexts/AuthContext";
import { ServerProvider, useServer } from "@/contexts/ServerContext";
import { UnreadProvider } from "@/contexts/UnreadContext";
import { useAppHotkeys } from "@/hooks/useAppHotkeys";
import { onHotkey } from "@/lib/keybinds";
import { KeyboardShortcutsDialog } from "@/components/KeyboardShortcutsDialog";
import { QuickSwitcher } from "@/components/QuickSwitcher";
import { ServerSidebar } from "@/components/layout/ServerSidebar";
import { ChannelSidebar } from "@/components/layout/ChannelSidebar";
import { BottomNavigation } from "@/components/mobile";
import { VoiceBar } from "@/components/voice/VoiceBar";
import { VoiceAudioSink } from "@/components/voice/VoiceAudioSink";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { T, useGT } from "gt-next";
import { Loader } from "@/components/ui/Loader";
import { Logo } from "@/components/ui/Logo";

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

const MobileServerList = dynamic(
  () => import("@/components/mobile/MobileServerList").then((m) => m.MobileServerList),
  { loading: mobileFallback }
);
const MobileServerView = dynamic(
  () => import("@/components/mobile/MobileServerView").then((m) => m.MobileServerView),
  { loading: mobileFallback }
);
const MobileMessagesView = dynamic(
  () => import("@/components/mobile/MobileMessagesView").then((m) => m.MobileMessagesView),
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

function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, isLoading, refresh } = useAuth();
  const router = useRouter();
  const gt = useGT();
  const recheckRef = useRef(false);

  useEffect(() => {
    if (!isLoading && !user) {
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
  }, [user, isLoading, router, refresh]);

  if (isLoading) {
    return (
      <div className="h-dvh bg-[var(--bg-app)] flex flex-col items-center justify-center">
        <div className="flex flex-col items-center gap-6">
          <Loader size={80} />
          <div className="flex flex-col items-center gap-2">
            <span className="text-lg font-medium text-[var(--text-primary)]">{gt("Loading SerikaCord...")}</span>
            <p className="text-sm text-[var(--text-muted)]">{gt("Preparing your experience")}</p>
          </div>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
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
  }

  return <>{children}</>;
}

function ChannelsContent({ children }: { children: React.ReactNode }) {
  const [showCreateServer, setShowCreateServer] = useState(false);
  const [createChannelOptions, setCreateChannelOptions] = useState<{
    open: boolean;
    defaultType?: "text" | "voice" | "category";
    defaultParentId?: string;
  }>({ open: false });
  const [showUserSettings, setShowUserSettings] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [showServerSettings, setShowServerSettings] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const { currentServer } = useServer();

  // Global Discord-style keyboard shortcuts (navigation handled internally;
  // UI actions arrive as broadcast events, wired below).
  useAppHotkeys();
  useEffect(() => {
    const unsubs = [
      onHotkey("create-server", () => setShowCreateServer(true)),
      onHotkey("create-group-dm", () => setShowCreateServer(true)),
      onHotkey("open-user-settings", () => setShowUserSettings(true)),
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

        if (window.matchMedia('(max-width: 767px)').matches) {
          router.push(`/channels/settings/${settingsTab}`);
        } else {
          setShowUserSettings(true);
        }
      }
    }
  }, [router]);

  // Listen for custom events from UserPanel and mobile views
  useEffect(() => {
    const handleOpenSettings = () => setShowUserSettings(true);
    const handleOpenInvite = () => setShowInvite(true);
    const handleOpenServerSettings = () => setShowServerSettings(true);
    window.addEventListener('openUserSettings', handleOpenSettings);
    window.addEventListener('openInviteDialog', handleOpenInvite);
    window.addEventListener('openServerSettings', handleOpenServerSettings);
    return () => {
      window.removeEventListener('openUserSettings', handleOpenSettings);
      window.removeEventListener('openInviteDialog', handleOpenInvite);
      window.removeEventListener('openServerSettings', handleOpenServerSettings);
    };
  }, []);

  // Track if we're on mobile
  const [isMobile, setIsMobile] = useState(false);
  
  useEffect(() => {
    const query = window.matchMedia('(max-width: 767px)');
    const update = () => setIsMobile(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  const mobileView: "servers" | "messages" | "notifications" | "profile" = pathname?.includes("/messages")
    ? "messages"
    : pathname?.includes("/notifications")
      ? "notifications"
      : pathname?.includes("/profile")
        ? "profile"
        : "servers";

  // Check if we're in a specific channel
  const isInChannel = pathname?.match(/\/channels\/[^/]+\/[^/]+$/);
  const isSettingsRoute = pathname?.startsWith("/channels/settings");

  // Transition key: only animate server switches/explore/settings, bypass channel switching within the same server to prevent snapping.
  const contentKey = useMemo(() => {
    if (!pathname) return "channels";
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

  // Mobile Layout
  if (isMobile) {
    return (
      <div className="flex h-dvh bg-[var(--bg-app)] overflow-hidden">
        {/* Mobile Server List - Only show in servers view when not in a channel */}
        {mobileView === "servers" && !isInChannel && !isSettingsRoute && (
          <MobileServerList 
            onCreateServer={() => setShowCreateServer(true)}
          />
        )}

        {/* Mobile Content Area */}
        <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
          {isSettingsRoute ? (
            <AnimatePresence mode="wait" initial={false}>
              <motion.main
                key={contentKey}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.18, ease: "easeOut" }}
                className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden pb-[var(--mobile-content-pb)]"
              >
                {children}
              </motion.main>
            </AnimatePresence>
          ) : isInChannel ? (
            // When in a specific channel, render the chat full-height —
            // the bottom nav hides itself inside conversations.
            <AnimatePresence mode="wait" initial={false}>
              <motion.main
                key={contentKey}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.18, ease: "easeOut" }}
                className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden pb-[env(safe-area-inset-bottom)]"
              >
                {children}
              </motion.main>
            </AnimatePresence>
          ) : mobileView === "servers" && currentServer ? (
            <MobileServerView />
          ) : mobileView === "messages" ? (
            <MobileMessagesView />
          ) : mobileView === "notifications" ? (
            <MobileNotificationsView />
          ) : mobileView === "profile" ? (
            <div className="flex-1 flex min-w-0 min-h-0 overflow-hidden">
              <MobileProfileView />
            </div>
          ) : (
            // Show channel content or DMs when in servers view without a selected server
            <AnimatePresence mode="wait" initial={false}>
              <motion.main
                key={contentKey}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.18, ease: "easeOut" }}
                className="flex-1 flex min-w-0 min-h-0 overflow-hidden pb-[var(--mobile-content-pb)]"
              >
                {children}
              </motion.main>
            </AnimatePresence>
          )}
        </div>

        {/* Voice Bar (above bottom nav when in call, but not on voice channel page) */}
        <VoiceBar className="fixed bottom-14 left-0 right-0 z-40 md:hidden" />
        <VoiceAudioSink />

        {/* Bottom Navigation */}
        <BottomNavigation />

        {/* Dialogs */}
        <KeyboardShortcutsDialog />
        <QuickSwitcher />
        <CreateServerDialog
          open={showCreateServer}
          onOpenChange={setShowCreateServer}
        />
        <CreateChannelDialog
          open={createChannelOptions.open}
          onOpenChange={(open) => setCreateChannelOptions((prev) => ({ ...prev, open }))}
          defaultType={createChannelOptions.defaultType}
          defaultParentId={createChannelOptions.defaultParentId}
        />
        <UserSettingsDialog
          open={showUserSettings}
          onOpenChange={setShowUserSettings}
        />
        <InviteDialog
          open={showInvite}
          onOpenChange={setShowInvite}
        />
        <ServerSettingsDialog
          open={showServerSettings}
          onOpenChange={setShowServerSettings}
        />
      </div>
    );
  }

  // Desktop Layout
  return (
    <div className="flex h-dvh bg-[var(--bg-app)] overflow-hidden">
      {/* Combined Sidebars */}
      <div className="flex flex-shrink-0 h-full min-h-0">
        <ServerSidebar
          onCreateServer={() => setShowCreateServer(true)}
          onInvitePeople={() => setShowInvite(true)}
        />
        {pathname !== "/channels/explore" && (
          <ChannelSidebar
            onCreateChannel={(defaultType, defaultParentId) =>
              setCreateChannelOptions({ open: true, defaultType, defaultParentId })
            }
            onInvitePeople={() => setShowInvite(true)}
            onServerSettings={() => setShowServerSettings(true)}
          />
        )}
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
        <AnimatePresence mode="wait" initial={false}>
          <motion.main
            key={contentKey}
            initial={{ opacity: 0, x: 6 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -6 }}
            transition={{ duration: 0.12, ease: "easeOut" }}
            className="flex-1 flex min-w-0 min-h-0 overflow-hidden"
          >
            {children}
          </motion.main>
        </AnimatePresence>
      </div>

      {/* Dialogs */}
      <KeyboardShortcutsDialog />
      <QuickSwitcher />
      <CreateServerDialog
        open={showCreateServer}
        onOpenChange={setShowCreateServer}
      />
      <CreateChannelDialog
        open={createChannelOptions.open}
        onOpenChange={(open) => setCreateChannelOptions((prev) => ({ ...prev, open }))}
        defaultType={createChannelOptions.defaultType}
        defaultParentId={createChannelOptions.defaultParentId}
      />
      <UserSettingsDialog
        open={showUserSettings}
        onOpenChange={setShowUserSettings}
      />
      <InviteDialog
        open={showInvite}
        onOpenChange={setShowInvite}
      />
      <ServerSettingsDialog
        open={showServerSettings}
        onOpenChange={setShowServerSettings}
      />
      <VoiceAudioSink />
    </div>
  );
}

export default function ChannelsLayoutClient({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ServerProvider>
      <UnreadProvider>
        <AuthGate>
          <ChannelsContent>{children}</ChannelsContent>
        </AuthGate>
      </UnreadProvider>
    </ServerProvider>
  );
}

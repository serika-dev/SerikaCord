"use client";

import { useState, useEffect, useSyncExternalStore } from "react";
import { ServerSidebar } from "@/components/layout/ServerSidebar";
import { ChannelSidebar } from "@/components/layout/ChannelSidebar";
import dynamic from "next/dynamic";
import { MountWhenOpened } from "@/components/ui/MountWhenOpened";
import { BottomNavigation } from "@/components/mobile";
import { VoiceAudioSink } from "@/components/voice/VoiceAudioSink";
import { IncomingCall } from "@/components/voice/IncomingCall";
import { useAppHotkeys } from "@/hooks/useAppHotkeys";
import { onHotkey } from "@/lib/keybinds";
import { useAuth } from "@/contexts/AuthContext";
import { useVisualViewportVars } from "@/hooks/useVisualViewport";

// Suspended accounts only ever see this screen (loaded on demand).
const SuspendedScreen = dynamic(() => import("@/components/safety/SuspendedScreen"), { ssr: false });

// Loaded on first open only (UserSettingsDialog alone is several hundred KB).
const CreateServerDialog = dynamic(
  () => import("@/components/dialogs/CreateServerDialog").then((m) => m.CreateServerDialog),
  { ssr: false },
);
const UserSettingsDialog = dynamic(
  () => import("@/components/dialogs/UserSettingsDialog").then((m) => m.UserSettingsDialog),
  { ssr: false },
);
// Keyboard-only (Ctrl+/, Ctrl+K): desktop layout only, loaded after first paint.
const KeyboardShortcutsDialog = dynamic(
  () => import("@/components/KeyboardShortcutsDialog").then((m) => m.KeyboardShortcutsDialog),
  { ssr: false },
);
const QuickSwitcher = dynamic(
  () => import("@/components/QuickSwitcher").then((m) => m.QuickSwitcher),
  { ssr: false },
);

// Phone layout breakpoint, read synchronously so phones never render the
// desktop shell (both sidebars + their streams) first and then swap.
const MOBILE_QUERY = "(max-width: 767px)";
function subscribeMobile(onChange: () => void) {
  const mql = window.matchMedia(MOBILE_QUERY);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}
const getMobileSnapshot = () => window.matchMedia(MOBILE_QUERY).matches;
const getMobileServerSnapshot = () => false;

function DMContent({ children }: { children: React.ReactNode }) {
  const [showCreateServer, setShowCreateServer] = useState(false);
  const [showUserSettings, setShowUserSettings] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<string | null>(null);
  const isMobile = useSyncExternalStore(subscribeMobile, getMobileSnapshot, getMobileServerSnapshot);
  // iOS keyboard: track the visual viewport so the shell shrinks with it.
  useVisualViewportVars(isMobile);

  useAppHotkeys();
  useEffect(() => {
    const unsubs = [
      onHotkey("create-server", () => setShowCreateServer(true)),
      onHotkey("open-user-settings", () => { setSettingsInitialTab(null); setShowUserSettings(true); }),
    ];
    return () => unsubs.forEach((u) => u());
  }, []);

  useEffect(() => {
    const handleOpenSettings = (e: Event) => {
      setSettingsInitialTab((e as CustomEvent<{ tab?: string } | undefined>).detail?.tab ?? null);
      setShowUserSettings(true);
    };
    window.addEventListener('openUserSettings', handleOpenSettings);
    return () => window.removeEventListener('openUserSettings', handleOpenSettings);
  }, []);

  // Mobile Layout
  if (isMobile) {
    return (
      <div className="h-[var(--app-height,100dvh)] flex flex-col bg-[var(--bg-app)] overflow-hidden">
        {/* Main DM Content — full height; the bottom nav hides itself
            inside open conversations, so no space is reserved for it. */}
        <main className="flex-1 flex flex-col min-h-0 overflow-hidden pb-safe">
          {children}
        </main>

        <BottomNavigation />

        {/* Dialogs (keyboard shortcut dialogs are desktop-only) */}
        <MountWhenOpened open={showCreateServer}>
          <CreateServerDialog
            open={showCreateServer}
            onOpenChange={setShowCreateServer}
          />
        </MountWhenOpened>
        <MountWhenOpened open={showUserSettings}>
          <UserSettingsDialog
            open={showUserSettings}
            onOpenChange={setShowUserSettings}
            initialTab={settingsInitialTab}
          />
        </MountWhenOpened>
        <VoiceAudioSink />
        <IncomingCall />
      </div>
    );
  }

  // Desktop Layout
  return (
    <div className="h-dvh flex animate-fade-in">
      <ServerSidebar onCreateServer={() => setShowCreateServer(true)} />
      <ChannelSidebar />
      <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
        <main className="flex-1 flex min-w-0 min-h-0 overflow-hidden">{children}</main>
      </div>
      <KeyboardShortcutsDialog />
      <QuickSwitcher />
      <MountWhenOpened open={showCreateServer}>
        <CreateServerDialog
          open={showCreateServer}
          onOpenChange={setShowCreateServer}
        />
      </MountWhenOpened>
      <MountWhenOpened open={showUserSettings}>
        <UserSettingsDialog
          open={showUserSettings}
          onOpenChange={setShowUserSettings}
          initialTab={settingsInitialTab}
        />
      </MountWhenOpened>
      <VoiceAudioSink />
      <IncomingCall />
    </div>
  );
}

export default function DMLayoutClient({ children }: { children: React.ReactNode }) {
  const { user, suspended } = useAuth();
  // Suspended: Account Standing + appeal + log out, instead of the app.
  if (suspended && !user) return <SuspendedScreen />;
  // Server/unread providers live in AppProviders (root layout) so they
  // survive switching between DMs and servers.
  return <DMContent>{children}</DMContent>;
}

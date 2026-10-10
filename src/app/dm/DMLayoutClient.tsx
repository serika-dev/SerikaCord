"use client";

import { useState, useEffect } from "react";
import { ServerSidebar } from "@/components/layout/ServerSidebar";
import { ChannelSidebar } from "@/components/layout/ChannelSidebar";
import dynamic from "next/dynamic";
import { MountWhenOpened } from "@/components/ui/MountWhenOpened";
import { BottomNavigation } from "@/components/mobile";
import { VoiceAudioSink } from "@/components/voice/VoiceAudioSink";
import { IncomingCall } from "@/components/voice/IncomingCall";
import { useAppHotkeys } from "@/hooks/useAppHotkeys";
import { onHotkey } from "@/lib/keybinds";
import { KeyboardShortcutsDialog } from "@/components/KeyboardShortcutsDialog";
import { QuickSwitcher } from "@/components/QuickSwitcher";

// Loaded on first open only (UserSettingsDialog alone is several hundred KB).
const CreateServerDialog = dynamic(
  () => import("@/components/dialogs/CreateServerDialog").then((m) => m.CreateServerDialog),
  { ssr: false },
);
const UserSettingsDialog = dynamic(
  () => import("@/components/dialogs/UserSettingsDialog").then((m) => m.UserSettingsDialog),
  { ssr: false },
);

function DMContent({ children }: { children: React.ReactNode }) {
  const [showCreateServer, setShowCreateServer] = useState(false);
  const [showUserSettings, setShowUserSettings] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState(false);

  useAppHotkeys();
  useEffect(() => {
    const unsubs = [
      onHotkey("create-server", () => setShowCreateServer(true)),
      onHotkey("open-user-settings", () => { setSettingsInitialTab(null); setShowUserSettings(true); }),
    ];
    return () => unsubs.forEach((u) => u());
  }, []);

  useEffect(() => {
    const query = window.matchMedia('(max-width: 767px)');
    const update = () => setIsMobile(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
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
      <div className="h-dvh flex flex-col bg-[var(--bg-app)] overflow-hidden">
        {/* Main DM Content — full height; the bottom nav hides itself
            inside open conversations, so no space is reserved for it. */}
        <main className="flex-1 flex flex-col min-h-0 overflow-hidden pb-safe">
          {children}
        </main>

        <BottomNavigation />

        {/* Dialogs */}
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
  // Server/unread providers live in AppProviders (root layout) so they
  // survive switching between DMs and servers.
  return <DMContent>{children}</DMContent>;
}

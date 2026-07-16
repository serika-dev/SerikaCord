"use client";

import { useState, useEffect } from "react";
import { ServerSidebar } from "@/components/layout/ServerSidebar";
import { ChannelSidebar } from "@/components/layout/ChannelSidebar";
import { CreateServerDialog } from "@/components/dialogs/CreateServerDialog";
import { UserSettingsDialog } from "@/components/dialogs/UserSettingsDialog";
import { BottomNavigation } from "@/components/mobile";
import { VoiceAudioSink } from "@/components/voice/VoiceAudioSink";
import { ServerProvider } from "@/contexts/ServerContext";
import { UnreadProvider } from "@/contexts/UnreadContext";
import { useAppHotkeys } from "@/hooks/useAppHotkeys";
import { onHotkey } from "@/lib/keybinds";
import { KeyboardShortcutsDialog } from "@/components/KeyboardShortcutsDialog";
import { QuickSwitcher } from "@/components/QuickSwitcher";

function DMContent({ children }: { children: React.ReactNode }) {
  const [showCreateServer, setShowCreateServer] = useState(false);
  const [showUserSettings, setShowUserSettings] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

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
    const query = window.matchMedia('(max-width: 767px)');
    const update = () => setIsMobile(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    const handleOpenSettings = () => setShowUserSettings(true);
    window.addEventListener('openUserSettings', handleOpenSettings);
    return () => window.removeEventListener('openUserSettings', handleOpenSettings);
  }, []);

  // Mobile Layout
  if (isMobile) {
    return (
      <div className="h-dvh flex flex-col bg-[var(--bg-app)] overflow-hidden">
        {/* Main DM Content — full height; the bottom nav hides itself
            inside open conversations, so no space is reserved for it. */}
        <main className="flex-1 flex flex-col min-h-0 overflow-hidden">
          {children}
        </main>

        <BottomNavigation />

        {/* Dialogs */}
        <KeyboardShortcutsDialog />
        <QuickSwitcher />
        <CreateServerDialog
          open={showCreateServer}
          onOpenChange={setShowCreateServer}
        />
        <UserSettingsDialog
          open={showUserSettings}
          onOpenChange={setShowUserSettings}
        />
        <VoiceAudioSink />
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
      <CreateServerDialog
        open={showCreateServer}
        onOpenChange={setShowCreateServer}
      />
      <UserSettingsDialog
        open={showUserSettings}
        onOpenChange={setShowUserSettings}
      />
      <VoiceAudioSink />
    </div>
  );
}

export default function DMLayoutClient({ children }: { children: React.ReactNode }) {
  return (
    <ServerProvider>
      <UnreadProvider>
        <DMContent>{children}</DMContent>
      </UnreadProvider>
    </ServerProvider>
  );
}

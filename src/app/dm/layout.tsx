"use client";

import { useState, useEffect } from "react";
import { ServerSidebar } from "@/components/layout/ServerSidebar";
import { ChannelSidebar } from "@/components/layout/ChannelSidebar";
import { CreateServerDialog } from "@/components/dialogs/CreateServerDialog";
import { UserSettingsDialog } from "@/components/dialogs/UserSettingsDialog";
import { BottomNavigation } from "@/components/mobile";
import { AuthProvider } from "@/contexts/AuthContext";
import { ServerProvider, useServer } from "@/contexts/ServerContext";

function DMContent({ children }: { children: React.ReactNode }) {
  const [showCreateServer, setShowCreateServer] = useState(false);
  const [showUserSettings, setShowUserSettings] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  useEffect(() => {
    const handleOpenSettings = () => setShowUserSettings(true);
    window.addEventListener('openUserSettings', handleOpenSettings);
    return () => window.removeEventListener('openUserSettings', handleOpenSettings);
  }, []);

  // Mobile Layout
  if (isMobile) {
    return (
      <div className="h-screen flex flex-col bg-[#0a0a0a] overflow-hidden">
        {/* Main DM Content */}
        <main className="flex-1 flex flex-col min-h-0 pb-16">
          {children}
        </main>

        {/* Bottom Navigation */}
        <BottomNavigation />

        {/* Dialogs */}
        <CreateServerDialog
          open={showCreateServer}
          onOpenChange={setShowCreateServer}
        />
        <UserSettingsDialog
          open={showUserSettings}
          onOpenChange={setShowUserSettings}
        />
      </div>
    );
  }

  // Desktop Layout
  return (
    <div className="h-screen flex animate-fade-in">
      <ServerSidebar onCreateServer={() => setShowCreateServer(true)} />
      <ChannelSidebar />
      <main className="flex-1 flex min-w-0">{children}</main>
      <CreateServerDialog
        open={showCreateServer}
        onOpenChange={setShowCreateServer}
      />
      <UserSettingsDialog
        open={showUserSettings}
        onOpenChange={setShowUserSettings}
      />
    </div>
  );
}

export default function DMLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <ServerProvider>
        <DMContent>{children}</DMContent>
      </ServerProvider>
    </AuthProvider>
  );
}

"use client";

import { useState, useEffect } from "react";
import { ServerSidebar } from "@/components/layout/ServerSidebar";
import { ChannelSidebar } from "@/components/layout/ChannelSidebar";
import { CreateServerDialog } from "@/components/dialogs/CreateServerDialog";
import { UserSettingsDialog } from "@/components/dialogs/UserSettingsDialog";
import { AuthProvider } from "@/contexts/AuthContext";
import { ServerProvider } from "@/contexts/ServerContext";

function DMContent({ children }: { children: React.ReactNode }) {
  const [showCreateServer, setShowCreateServer] = useState(false);
  const [showUserSettings, setShowUserSettings] = useState(false);

  useEffect(() => {
    const handleOpenSettings = () => setShowUserSettings(true);
    window.addEventListener('openUserSettings', handleOpenSettings);
    return () => window.removeEventListener('openUserSettings', handleOpenSettings);
  }, []);

  return (
    <div className="h-screen flex">
      <ServerSidebar onCreateServer={() => setShowCreateServer(true)} />
      <ChannelSidebar />
      {children}
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

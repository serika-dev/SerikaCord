"use client";

import { useState } from "react";
import { AuthProvider } from "@/contexts/AuthContext";
import { ServerProvider } from "@/contexts/ServerContext";
import { ServerSidebar } from "@/components/layout/ServerSidebar";
import { ChannelSidebar } from "@/components/layout/ChannelSidebar";
import { CreateServerDialog } from "@/components/dialogs/CreateServerDialog";
import { CreateChannelDialog } from "@/components/dialogs/CreateChannelDialog";

export default function ChannelsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [showCreateServer, setShowCreateServer] = useState(false);
  const [showCreateChannel, setShowCreateChannel] = useState(false);

  return (
    <AuthProvider>
      <ServerProvider>
        <div className="flex h-screen bg-[#313338] overflow-hidden">
          {/* Server Sidebar */}
          <ServerSidebar onCreateServer={() => setShowCreateServer(true)} />

          {/* Channel Sidebar */}
          <ChannelSidebar
            onCreateChannel={() => setShowCreateChannel(true)}
          />

          {/* Main Content */}
          <main className="flex-1 flex min-w-0">{children}</main>

          {/* Dialogs */}
          <CreateServerDialog
            open={showCreateServer}
            onOpenChange={setShowCreateServer}
          />
          <CreateChannelDialog
            open={showCreateChannel}
            onOpenChange={setShowCreateChannel}
          />
        </div>
      </ServerProvider>
    </AuthProvider>
  );
}

"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter, usePathname } from "next/navigation";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { ServerProvider, useServer } from "@/contexts/ServerContext";
import { ServerSidebar } from "@/components/layout/ServerSidebar";
import { ChannelSidebar } from "@/components/layout/ChannelSidebar";
import { CreateServerDialog } from "@/components/dialogs/CreateServerDialog";
import { CreateChannelDialog } from "@/components/dialogs/CreateChannelDialog";
import { UserSettingsDialog } from "@/components/dialogs/UserSettingsDialog";
import { InviteDialog } from "@/components/dialogs/InviteDialog";
import { ServerSettingsDialog } from "@/components/dialogs/ServerSettingsDialog";
import { 
  BottomNavigation, 
  MobileServerList, 
  MobileServerView,
  MobileMessagesView,
  MobileNotificationsView,
  MobileProfileView,
} from "@/components/mobile";
import { Loader2, MessageSquare, Menu, X } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !user) {
      router.push("/login");
    }
  }, [user, isLoading, router]);

  if (isLoading) {
    return (
      <div className="h-screen bg-[#000000] flex flex-col items-center justify-center">
        <div className="flex flex-col items-center gap-6">
          <div className="w-16 h-16 rounded-xl bg-[#8B5CF6] flex items-center justify-center">
            <MessageSquare className="w-8 h-8 text-white" />
          </div>
          
          <div className="flex flex-col items-center gap-2">
            <div className="flex items-center gap-2">
              <Loader2 className="w-5 h-5 text-[#8B5CF6] animate-spin" />
              <span className="text-lg font-medium text-white">Loading SerikaCord...</span>
            </div>
            <p className="text-sm text-[#666666]">Preparing your experience</p>
          </div>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="h-screen bg-[#000000] flex flex-col items-center justify-center">
        <div className="flex flex-col items-center gap-6 text-center px-4">
          <div className="w-16 h-16 rounded-xl bg-[#8B5CF6] flex items-center justify-center">
            <MessageSquare className="w-8 h-8 text-white" />
          </div>
          
          <div>
            <h1 className="text-2xl font-bold text-white mb-2">Welcome to SerikaCord</h1>
            <p className="text-[#666666] max-w-md">
              Sign in to access your servers, chat with friends, and join communities.
            </p>
          </div>
          
          <div className="flex gap-3">
            <Link
              href="/login"
              className="px-6 py-3 bg-[#8B5CF6] hover:bg-[#7C3AED] text-white font-medium rounded-md transition-colors"
            >
              Sign In
            </Link>
            <Link
              href="/register"
              className="px-6 py-3 bg-[#111111] hover:bg-[#1a1a1a] border border-[#222222] text-white font-medium rounded-md transition-colors"
            >
              Create Account
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
  const [showCreateChannel, setShowCreateChannel] = useState(false);
  const [showUserSettings, setShowUserSettings] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [showServerSettings, setShowServerSettings] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [mobileView, setMobileView] = useState<"servers" | "messages" | "notifications" | "profile">("servers");
  const pathname = usePathname();
  const { currentServer } = useServer();

  // Listen for custom events from UserPanel
  useEffect(() => {
    const handleOpenSettings = () => setShowUserSettings(true);
    window.addEventListener('openUserSettings', handleOpenSettings);
    return () => window.removeEventListener('openUserSettings', handleOpenSettings);
  }, []);

  // Close mobile menu when navigating
  useEffect(() => {
    const handleRouteChange = () => setMobileMenuOpen(false);
    window.addEventListener('popstate', handleRouteChange);
    return () => window.removeEventListener('popstate', handleRouteChange);
  }, []);

  // Track if we're on mobile
  const [isMobile, setIsMobile] = useState(false);
  
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Update mobile view based on pathname
  useEffect(() => {
    if (pathname?.includes("/messages")) {
      setMobileView("messages");
    } else if (pathname?.includes("/notifications")) {
      setMobileView("notifications");
    } else if (pathname?.includes("/profile")) {
      setMobileView("profile");
    } else {
      setMobileView("servers");
    }
  }, [pathname]);

  // Check if we're in a specific channel
  const isInChannel = pathname?.match(/\/channels\/[^/]+\/[^/]+$/);

  // Mobile Layout
  if (isMobile) {
    return (
      <div className="flex h-screen bg-[#0a0a0a] overflow-hidden">
        {/* Mobile Server List - Only show in servers view when not in a channel */}
        {mobileView === "servers" && !isInChannel && (
          <MobileServerList 
            onCreateServer={() => setShowCreateServer(true)}
          />
        )}

        {/* Mobile Content Area */}
        <div className="flex-1 flex flex-col min-w-0">
          {isInChannel ? (
            // When in a specific channel, render the chat
            <main className="flex-1 flex flex-col min-w-0 pb-16">{children}</main>
          ) : mobileView === "servers" && currentServer ? (
            <MobileServerView />
          ) : mobileView === "messages" ? (
            <MobileMessagesView />
          ) : mobileView === "notifications" ? (
            <MobileNotificationsView />
          ) : mobileView === "profile" ? (
            <MobileProfileView />
          ) : (
            // Show channel content or DMs when in servers view without a selected server
            <main className="flex-1 flex min-w-0 pb-16">{children}</main>
          )}
        </div>

        {/* Bottom Navigation */}
        <BottomNavigation />

        {/* Dialogs */}
        <CreateServerDialog
          open={showCreateServer}
          onOpenChange={setShowCreateServer}
        />
        <CreateChannelDialog
          open={showCreateChannel}
          onOpenChange={setShowCreateChannel}
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
    <div className="flex h-screen bg-[#0a0a0a] overflow-hidden">
      {/* Combined Sidebars */}
      <div className="flex">
        <ServerSidebar onCreateServer={() => setShowCreateServer(true)} />
        <ChannelSidebar 
          onCreateChannel={() => setShowCreateChannel(true)}
          onInvitePeople={() => setShowInvite(true)}
          onServerSettings={() => setShowServerSettings(true)}
        />
      </div>

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

export default function ChannelsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthProvider>
      <ServerProvider>
        <AuthGate>
          <ChannelsContent>{children}</ChannelsContent>
        </AuthGate>
      </ServerProvider>
    </AuthProvider>
  );
}

"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { ServerProvider } from "@/contexts/ServerContext";
import { ServerSidebar } from "@/components/layout/ServerSidebar";
import { ChannelSidebar } from "@/components/layout/ChannelSidebar";
import { CreateServerDialog } from "@/components/dialogs/CreateServerDialog";
import { CreateChannelDialog } from "@/components/dialogs/CreateChannelDialog";
import { UserSettingsDialog } from "@/components/dialogs/UserSettingsDialog";
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
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

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

  return (
    <div className="flex h-screen bg-[#0a0a0a] overflow-hidden">
      {/* Mobile Menu Toggle */}
      <button
        onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
        className="fixed top-3 left-3 z-50 p-2 rounded-lg bg-[#111111] border border-[#222222] md:hidden"
      >
        {mobileMenuOpen ? (
          <X className="w-5 h-5 text-white" />
        ) : (
          <Menu className="w-5 h-5 text-white" />
        )}
      </button>

      {/* Mobile Overlay */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-30 md:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Server Sidebar - Hidden on mobile unless menu open */}
      <div className={cn(
        "fixed md:relative z-40 h-full transition-transform duration-200 md:translate-x-0",
        mobileMenuOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        <ServerSidebar onCreateServer={() => setShowCreateServer(true)} />
      </div>

      {/* Channel Sidebar - Hidden on mobile unless menu open */}
      <div className={cn(
        "fixed md:relative z-40 h-full transition-transform duration-200 md:translate-x-0",
        mobileMenuOpen ? "translate-x-[72px]" : "-translate-x-full"
      )}>
        <ChannelSidebar
          onCreateChannel={() => setShowCreateChannel(true)}
        />
      </div>

      {/* Main Content */}
      <main className="flex-1 flex min-w-0 pt-14 md:pt-0">{children}</main>

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

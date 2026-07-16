"use client";

import { useRouter } from "next/navigation";
import { useServer } from "@/contexts/ServerContext";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Plus, Compass } from "lucide-react";
import { cn, cdnImage } from "@/lib/utils";

interface MobileServerListProps {
  onServerSelect?: (server: any) => void;
  onCreateServer?: () => void;
}

export function MobileServerList({ onServerSelect, onCreateServer }: MobileServerListProps) {
  const router = useRouter();
  const { servers, currentServer, setCurrentServer, setCurrentChannel } = useServer();

  const handleServerClick = (server: typeof servers[0]) => {
    setCurrentServer(server);
    setCurrentChannel(null);
    if (onServerSelect) {
      onServerSelect(server);
    } else {
      router.push(`/channels/${server.id}`);
    }
  };

  const handleHomeClick = () => {
    setCurrentServer(null);
    setCurrentChannel(null);
    router.push("/channels/me");
  };

  const handleExploreClick = () => {
    setCurrentServer(null);
    setCurrentChannel(null);
    router.push("/channels/explore");
  };

  // Helper to get unread count (optional property)
  const getUnreadCount = (server: any): number => server.unreadCount || 0;
  const hasNotification = (server: any): boolean => server.hasNotification || false;

  return (
    <div className="flex flex-col w-[76px] min-w-[76px] h-full bg-[var(--bg-sidebar)] border-r border-[var(--border-subtle)] pt-safe">
      <div className="flex-1 overflow-y-auto scrollbar-hide py-3">
        <div className="flex flex-col items-center gap-3 px-3">
          {/* Home Button (DMs) */}
          <div className="relative group">
            {/* Active Indicator */}
            {!currentServer && (
              <div className="absolute left-[-12px] top-1/2 -translate-y-1/2 w-1 h-10 bg-white rounded-r-full" />
            )}
            
            <button
              onClick={handleHomeClick}
              className={cn(
                "relative w-[52px] h-[52px] flex items-center justify-center transition-all duration-200",
                !currentServer 
                  ? "bg-[var(--app-accent)] rounded-[18px]" 
                  : "bg-[var(--bg-sidebar-elevated)] rounded-[24px] hover:bg-[var(--app-accent)] hover:rounded-[18px] active:scale-95"
              )}
            >
              <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="currentColor">
                <path d="M19.73 4.87l-3.5-1.7a1 1 0 00-.87 0L12 4.86 8.64 3.17a1 1 0 00-.87 0l-3.5 1.7A1 1 0 004 5.74v12.52a1 1 0 00.63.93l3.5 1.4a1 1 0 00.74 0L12 19.2l3.13 1.39a1 1 0 00.74 0l3.5-1.4a1 1 0 00.63-.93V5.74a1 1 0 00-.27-.87zM11 17.67l-3 1.33V6.73l3 1.33zm5 1.33l-3-1.33V8.06l3-1.33z"/>
              </svg>
            </button>
          </div>

          {/* Separator */}
          <div className="w-8 h-0.5 bg-[var(--bg-sidebar-elevated)] rounded-full" />

          {/* Server List */}
          {servers.map((server) => {
            const unreadCount = getUnreadCount(server);
            const hasUnread = hasNotification(server);
            const isActive = currentServer?.id === server.id;
            
            return (
              <div key={server.id} className="relative group">
                {/* Unread Indicator */}
                {hasUnread && !isActive && (
                  <div className="absolute left-[-12px] top-1/2 -translate-y-1/2 w-1 h-2 bg-white rounded-r-full" />
                )}

                {/* Active Indicator */}
                {isActive && (
                  <div className="absolute left-[-12px] top-1/2 -translate-y-1/2 w-1 h-10 bg-white rounded-r-full" />
                )}

                <button
                  onClick={() => handleServerClick(server)}
                  className={cn(
                    "relative w-[52px] h-[52px] overflow-hidden transition-all duration-200 active:scale-95",
                    isActive
                      ? "rounded-[18px]"
                      : "rounded-[24px] hover:rounded-[18px]"
                  )}
                >
                  {server.icon ? (
                    <Avatar className="w-[52px] h-[52px] rounded-none">
                      <AvatarImage src={cdnImage(server.icon)} className="object-cover" />
                      <AvatarFallback className="rounded-none bg-[var(--app-accent)] text-white text-xl font-semibold">
                        {server.name.charAt(0).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                  ) : (
                    <div className="w-full h-full bg-[var(--bg-sidebar-elevated)] hover:bg-[var(--app-accent)] flex items-center justify-center text-white text-xl font-semibold transition-colors">
                      {server.name.charAt(0).toUpperCase()}
                    </div>
                  )}

                  {/* Notification Badge */}
                  {unreadCount > 0 && (
                    <span className="absolute bottom-0 right-0 min-w-[18px] h-[18px] px-1 flex items-center justify-center bg-[#ED4245] text-white text-[10px] font-bold rounded-full border-[3px] border-[var(--bg-sidebar)]">
                      {unreadCount > 99 ? "99+" : unreadCount}
                    </span>
                  )}
                </button>
              </div>
            );
          })}

          {/* Separator */}
          <div className="w-8 h-0.5 bg-[var(--bg-sidebar-elevated)] rounded-full" />

          {/* Explore Servers */}
          <button
            onClick={handleExploreClick}
            className="w-[52px] h-[52px] rounded-[24px] bg-[var(--bg-sidebar-elevated)] flex items-center justify-center text-[#23A559] hover:bg-[#23A559] hover:text-white hover:rounded-[18px] transition-all duration-200 active:scale-95"
          >
            <Compass className="w-6 h-6" />
          </button>

          {/* Add Server Button */}
          <button
            onClick={onCreateServer}
            className="w-[52px] h-[52px] rounded-[24px] bg-[var(--bg-sidebar-elevated)] flex items-center justify-center text-[#23A559] hover:bg-[#23A559] hover:text-white hover:rounded-[18px] transition-all duration-200 active:scale-95"
          >
            <Plus className="w-6 h-6" />
          </button>
        </div>
      </div>
    </div>
  );
}

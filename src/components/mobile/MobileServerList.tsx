"use client";

import { useRouter } from "next/navigation";
import { useServer } from "@/contexts/ServerContext";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";

interface MobileServerListProps {
  onServerSelect?: (server: any) => void;
  onCreateServer?: () => void;
}

export function MobileServerList({ onServerSelect, onCreateServer }: MobileServerListProps) {
  const router = useRouter();
  const { servers, currentServer, setCurrentServer } = useServer();

  const handleServerClick = (server: typeof servers[0]) => {
    setCurrentServer(server);
    if (onServerSelect) {
      onServerSelect(server);
    } else {
      router.push(`/channels/${server.id}`);
    }
  };

  const handleHomeClick = () => {
    setCurrentServer(null);
    router.push("/channels/me");
  };

  // Helper to get unread count (optional property that may be added later)
  const getUnreadCount = (server: any): number => server.unreadCount || 0;
  const hasNotification = (server: any): boolean => server.hasNotification || false;

  return (
    <div className="flex flex-col w-[72px] min-w-[72px] h-full bg-[#000000] pt-3 pb-20">
      <ScrollArea className="flex-1">
        <div className="flex flex-col items-center gap-2 px-3">
          {/* Home Button (DMs) */}
          <button
            onClick={handleHomeClick}
            className={cn(
              "relative w-12 h-12 rounded-2xl flex items-center justify-center transition-all duration-200",
              !currentServer 
                ? "bg-[#8B5CF6] rounded-xl" 
                : "bg-[#1a1a1a] hover:bg-[#8B5CF6] hover:rounded-xl"
            )}
          >
            <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19.73 4.87l-3.5-1.7a1 1 0 00-.87 0L12 4.86 8.64 3.17a1 1 0 00-.87 0l-3.5 1.7A1 1 0 004 5.74v12.52a1 1 0 00.63.93l3.5 1.4a1 1 0 00.74 0L12 19.2l3.13 1.39a1 1 0 00.74 0l3.5-1.4a1 1 0 00.63-.93V5.74a1 1 0 00-.27-.87zM11 17.67l-3 1.33V6.73l3 1.33zm5 1.33l-3-1.33V8.06l3-1.33z"/>
            </svg>
          </button>

          {/* Separator */}
          <div className="w-8 h-0.5 bg-[#1a1a1a] rounded-full my-1" />

          {/* Server List */}
          {servers.map((server) => {
            const unreadCount = getUnreadCount(server);
            const hasUnread = hasNotification(server);
            
            return (
              <div key={server.id} className="relative">
                {/* Unread Indicator */}
                {hasUnread && (
                  <div className="absolute left-[-12px] top-1/2 -translate-y-1/2 w-1 h-2 bg-white rounded-r-full" />
                )}
                
                {/* Active Indicator */}
                {currentServer?.id === server.id && (
                  <div className="absolute left-[-12px] top-1/2 -translate-y-1/2 w-1 h-10 bg-white rounded-r-full" />
                )}

                <button
                  onClick={() => handleServerClick(server)}
                  className={cn(
                    "relative w-12 h-12 rounded-2xl overflow-hidden transition-all duration-200",
                    currentServer?.id === server.id
                      ? "rounded-xl"
                      : "hover:rounded-xl"
                  )}
                >
                  {server.icon ? (
                    <Avatar className="w-12 h-12 rounded-none">
                      <AvatarImage src={server.icon} className="object-cover" />
                      <AvatarFallback className="rounded-none bg-[#8B5CF6] text-white text-lg font-semibold">
                        {server.name.charAt(0).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                  ) : (
                    <div className="w-full h-full bg-[#1a1a1a] flex items-center justify-center text-white font-semibold">
                      {server.name.charAt(0).toUpperCase()}
                    </div>
                  )}
                  
                  {/* Notification Badge */}
                  {unreadCount > 0 && (
                    <span className="absolute bottom-0 right-0 min-w-[18px] h-[18px] px-1 flex items-center justify-center bg-[#ED4245] text-white text-xs font-bold rounded-full border-2 border-[#000000]">
                      {unreadCount > 99 ? "99+" : unreadCount}
                    </span>
                  )}
                </button>
              </div>
            );
          })}

          {/* Separator */}
          <div className="w-8 h-0.5 bg-[#1a1a1a] rounded-full my-1" />

          {/* Add Server Button */}
          <button
            onClick={onCreateServer}
            className="w-12 h-12 rounded-2xl bg-[#1a1a1a] flex items-center justify-center text-[#23A559] hover:bg-[#23A559] hover:text-white hover:rounded-xl transition-all duration-200"
          >
            <Plus className="w-6 h-6" />
          </button>
        </div>
      </ScrollArea>
    </div>
  );
}

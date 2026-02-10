"use client";

import { useRouter } from "next/navigation";
import { useServer } from "@/contexts/ServerContext";
import { useEffect, useState, useCallback, memo } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Separator } from "@/components/ui/separator";
import { Plus, Compass, Download, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";

interface ServerSidebarProps {
  onCreateServer: () => void;
}

// Check if running in native app (Electron or Capacitor)
function isNativeApp(): boolean {
  if (typeof window === 'undefined') return false;
  // Check for Electron
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((window as any).electron) return true;
  // Check for Capacitor
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((window as any).Capacitor?.isNativePlatform?.()) return true;
  // Check for standalone mode (PWA)
  if (window.matchMedia('(display-mode: standalone)').matches) return true;
  return false;
}

// Memoized server button for better performance
const ServerButton = memo(function ServerButton({ 
  server, 
  isSelected, 
  onClick 
}: { 
  server: { id: string; name: string; icon?: string }; 
  isSelected: boolean; 
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={onClick}
          className={cn(
            "relative flex items-center justify-center w-12 h-12 rounded-[24px] bg-[#111111] transition-all duration-200 hover:rounded-[16px] group overflow-hidden",
            isSelected && "rounded-[16px]"
          )}
        >
          {server.icon ? (
            <Avatar className="w-12 h-12 rounded-none">
              <AvatarImage src={server.icon} alt={server.name} loading="lazy" />
              <AvatarFallback className="rounded-none bg-[#8B5CF6] text-white">
                {server.name.charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
          ) : (
            <span className="text-lg font-semibold text-white">
              {server.name.charAt(0).toUpperCase()}
            </span>
          )}
          {/* Pill indicator */}
          <div
            className={cn(
              "absolute left-0 w-1 bg-white rounded-r-full transition-all duration-200",
              isSelected ? "h-10" : "h-0 group-hover:h-5"
            )}
          />
        </button>
      </TooltipTrigger>
      <TooltipContent side="right" className="bg-[#111111] text-white border border-[#222222]">
        {server.name}
      </TooltipContent>
    </Tooltip>
  );
});

export function ServerSidebar({ onCreateServer }: ServerSidebarProps) {
  const router = useRouter();
  const { servers, currentServer, setCurrentServer, clearContext, isTransitioning } = useServer();
  const [isNative, setIsNative] = useState(false);

  useEffect(() => {
    setIsNative(isNativeApp());
  }, []);

  const handleServerClick = useCallback((server: typeof servers[0]) => {
    if (currentServer?.id === server.id) return; // Already on this server
    setCurrentServer(server);
    router.push(`/channels/${server.id}`);
  }, [currentServer?.id, setCurrentServer, router]);

  const handleHomeClick = useCallback(() => {
    if (!currentServer) return; // Already on DMs
    clearContext();
    router.push("/channels/me");
  }, [currentServer, clearContext, router]);

  return (
    <TooltipProvider delayDuration={0}>
      <div className={cn(
        "flex flex-col items-center w-[72px] h-full bg-[#0a0a0a] py-3 gap-2 border-r border-[#1a1a1a]",
        isTransitioning && "pointer-events-none"
      )}>
        {/* Home Button (DMs) */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={handleHomeClick}
              className={cn(
                "relative flex items-center justify-center w-12 h-12 rounded-[24px] bg-[#111111] transition-all duration-200 hover:rounded-[16px] hover:bg-[#8B5CF6] group",
                !currentServer && "rounded-[16px] bg-[#8B5CF6]"
              )}
            >
              <MessageSquare className={cn(
                "w-7 h-7 transition-colors",
                !currentServer ? "text-white" : "text-[#888888] group-hover:text-white"
              )} />
              {/* Pill indicator */}
              <div
                className={cn(
                  "absolute left-0 w-1 bg-white rounded-r-full transition-all duration-200",
                  !currentServer ? "h-10" : "h-0 group-hover:h-5"
                )}
              />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right" className="bg-[#111111] text-white border border-[#222222]">
            Direct Messages
          </TooltipContent>
        </Tooltip>

        <Separator className="w-8 h-0.5 bg-[#222222] rounded-full" />

        {/* Server List */}
        <div className="flex-1 w-full overflow-y-auto scrollbar-hide">
          <div className="flex flex-col items-center gap-2 stagger-children">
            {servers.map((server) => (
              <ServerButton
                key={server.id}
                server={server}
                isSelected={currentServer?.id === server.id}
                onClick={() => handleServerClick(server)}
              />
            ))}
          </div>
        </div>

        <Separator className="w-8 h-0.5 bg-[#222222] rounded-full" />

        {/* Add Server Button */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={onCreateServer}
              className="flex items-center justify-center w-12 h-12 rounded-[24px] bg-[#111111] transition-all duration-200 hover:rounded-[16px] hover:bg-[#8B5CF6] group"
            >
              <Plus className="w-6 h-6 text-[#8B5CF6] group-hover:text-white transition-colors" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right" className="bg-[#111111] text-white border border-[#222222]">
            Add a Server
          </TooltipContent>
        </Tooltip>

        {/* Explore Servers */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button 
              onClick={() => router.push("/channels/explore")}
              className="flex items-center justify-center w-12 h-12 rounded-[24px] bg-[#111111] transition-all duration-200 hover:rounded-[16px] hover:bg-[#8B5CF6] group"
            >
              <Compass className="w-6 h-6 text-[#8B5CF6] group-hover:text-white transition-colors" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right" className="bg-[#111111] text-white border border-[#222222]">
            Explore Discoverable Servers
          </TooltipContent>
        </Tooltip>

        {/* Download Apps - Hidden in native apps */}
        {!isNative && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button 
                onClick={() => router.push("/download")}
                className="flex items-center justify-center w-12 h-12 rounded-[24px] bg-[#111111] transition-all duration-200 hover:rounded-[16px] hover:bg-[#8B5CF6] group"
              >
                <Download className="w-6 h-6 text-[#8B5CF6] group-hover:text-white transition-colors" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right" className="bg-[#111111] text-white border border-[#222222]">
              Download Apps
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    </TooltipProvider>
  );
}

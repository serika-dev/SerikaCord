"use client";

import { useRouter } from "next/navigation";
import { useServer } from "@/contexts/ServerContext";
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

export function ServerSidebar({ onCreateServer }: ServerSidebarProps) {
  const router = useRouter();
  const { servers, currentServer, setCurrentServer } = useServer();
  const isNative = isNativeApp();

  const handleServerClick = (server: typeof servers[0]) => {
    setCurrentServer(server);
    router.push(`/channels/${server.id}`);
  };

  const handleHomeClick = () => {
    setCurrentServer(null);
    router.push("/channels/me");
  };

  return (
    <TooltipProvider delayDuration={0}>
      <div className="flex flex-col items-center w-[72px] h-full bg-[var(--app-bg)] py-3 gap-2 border-r border-[var(--app-border)]">
        {/* Home Button (DMs) */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={handleHomeClick}
              className={cn(
                "relative flex items-center justify-center w-12 h-12 rounded-[24px] bg-[var(--bg-sidebar-elevated)] transition-all duration-200 hover:rounded-[16px] hover:bg-[var(--app-accent)] group",
                !currentServer && "rounded-[16px] bg-[var(--app-accent)]"
              )}
            >
              <MessageSquare className="w-7 h-7 text-[var(--text-secondary)] group-hover:text-[var(--text-on-accent)] transition-colors" />
              {/* Pill indicator */}
              <div
                className={cn(
                  "absolute left-0 w-1 bg-[var(--text-primary)] rounded-r-full transition-all duration-200",
                  !currentServer ? "h-10" : "h-0 group-hover:h-5"
                )}
              />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right" className="bg-[var(--bg-card)] text-[var(--text-primary)] border border-[var(--border-subtle)]">
            Direct Messages
          </TooltipContent>
        </Tooltip>

        <Separator className="w-8 h-0.5 bg-[var(--app-border)] rounded-full" />

        {/* Server List */}
        <div className="flex-1 w-full overflow-y-auto scrollbar-hide">
          <div className="flex flex-col items-center gap-2">
            {servers.map((server) => (
              <Tooltip key={server.id}>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => handleServerClick(server)}
                    className={cn(
                      "relative flex items-center justify-center w-12 h-12 rounded-[24px] bg-[var(--bg-sidebar-elevated)] transition-all duration-200 hover:rounded-[16px] group overflow-hidden",
                      currentServer?.id === server.id && "rounded-[16px]"
                    )}
                  >
                    {server.icon ? (
                      <Avatar className="w-12 h-12 rounded-none">
                        <AvatarImage src={server.icon} alt={server.name} />
                        <AvatarFallback className="rounded-none bg-[var(--app-accent)] text-[var(--text-on-accent)]">
                          {server.name.charAt(0).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                    ) : (
                      <span className="text-lg font-semibold text-[var(--text-primary)]">
                        {server.name.charAt(0).toUpperCase()}
                      </span>
                    )}
                    {/* Pill indicator */}
                    <div
                      className={cn(
                        "absolute left-0 w-1 bg-[var(--text-primary)] rounded-r-full transition-all duration-200",
                        currentServer?.id === server.id ? "h-10" : "h-0 group-hover:h-5"
                      )}
                    />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right" className="bg-[var(--bg-card)] text-[var(--text-primary)] border border-[var(--border-subtle)]">
                  {server.name}
                </TooltipContent>
              </Tooltip>
            ))}
          </div>
        </div>

        <Separator className="w-8 h-0.5 bg-[var(--app-border)] rounded-full" />

        {/* Add Server Button */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={onCreateServer}
              className="flex items-center justify-center w-12 h-12 rounded-[24px] bg-[var(--bg-sidebar-elevated)] transition-all duration-200 hover:rounded-[16px] hover:bg-[var(--app-accent)] group"
            >
              <Plus className="w-6 h-6 text-[var(--app-accent)] group-hover:text-[var(--text-on-accent)] transition-colors" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right" className="bg-[var(--bg-card)] text-[var(--text-primary)] border border-[var(--border-subtle)]">
            Add a Server
          </TooltipContent>
        </Tooltip>

        {/* Explore Servers */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button 
              onClick={() => router.push("/channels/explore")}
              className="flex items-center justify-center w-12 h-12 rounded-[24px] bg-[var(--bg-sidebar-elevated)] transition-all duration-200 hover:rounded-[16px] hover:bg-[var(--app-accent)] group"
            >
              <Compass className="w-6 h-6 text-[var(--app-accent)] group-hover:text-[var(--text-on-accent)] transition-colors" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right" className="bg-[var(--bg-card)] text-[var(--text-primary)] border border-[var(--border-subtle)]">
            Explore Discoverable Servers
          </TooltipContent>
        </Tooltip>

        {/* Download Apps - Hidden in native apps */}
        {!isNative && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button 
                onClick={() => router.push("/download")}
                className="flex items-center justify-center w-12 h-12 rounded-[24px] bg-[var(--bg-sidebar-elevated)] transition-all duration-200 hover:rounded-[16px] hover:bg-[var(--app-accent)] group"
              >
                <Download className="w-6 h-6 text-[var(--app-accent)] group-hover:text-[var(--text-on-accent)] transition-colors" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right" className="bg-[var(--bg-card)] text-[var(--text-primary)] border border-[var(--border-subtle)]">
              Download Apps
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    </TooltipProvider>
  );
}

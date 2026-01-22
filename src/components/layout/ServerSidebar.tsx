"use client";

import { useRouter } from "next/navigation";
import { useServer } from "@/contexts/ServerContext";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Separator } from "@/components/ui/separator";
import { Plus, Compass, Download } from "lucide-react";
import { cn } from "@/lib/utils";

interface ServerSidebarProps {
  onCreateServer: () => void;
}

export function ServerSidebar({ onCreateServer }: ServerSidebarProps) {
  const router = useRouter();
  const { servers, currentServer, setCurrentServer } = useServer();

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
      <div className="flex flex-col items-center w-[72px] h-full bg-[#1e1f22] py-3 gap-2">
        {/* Home Button (DMs) */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={handleHomeClick}
              className={cn(
                "relative flex items-center justify-center w-12 h-12 rounded-[24px] bg-[#313338] transition-all duration-200 hover:rounded-[16px] hover:bg-[#5865F2] group",
                !currentServer && "rounded-[16px] bg-[#5865F2]"
              )}
            >
              <svg
                className="w-7 h-7 text-[#dbdee1] group-hover:text-white"
                viewBox="0 0 28 20"
                fill="currentColor"
              >
                <path d="M23.0212 1.67671C21.3107 0.879656 19.5079 0.318797 17.6584 0C17.4062 0.461742 17.1749 0.934541 16.9708 1.4184C15.003 1.12145 12.9974 1.12145 11.0283 1.4184C10.819 0.934541 10.589 0.461744 10.3368 0.00546311C8.48074 0.324393 6.## 0.885118 4.## 1.68231C0.## 7.77919 -0.## 13.## 0.## 17.##C2.## 18.## 4.## 19.## 6.## 20C7.## 18.## 8.## 17.## 8.## 16.##C7.## 16.## 6.## 16.## 5.## 15.##C5.## 15.## 5.## 15.## 5.## 15.##C9.## 17.## 14.## 17.## 18.## 15.##C18.## 15.## 18.## 15.## 18.## 15.##C17.## 16.## 16.## 16.## 15.## 16.##C16.## 17.## 16.## 18.## 17.## 20C19.## 19.## 21.## 18.## 23.## 17.##C24.## 13.## 23.## 7.## 23.## 1.##Z" />
              </svg>
              {/* Pill indicator */}
              <div
                className={cn(
                  "absolute left-0 w-1 bg-white rounded-r-full transition-all duration-200",
                  !currentServer ? "h-10" : "h-0 group-hover:h-5"
                )}
              />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right" className="bg-[#111214] text-white border-none">
            Direct Messages
          </TooltipContent>
        </Tooltip>

        <Separator className="w-8 h-0.5 bg-[#35363c] rounded-full" />

        {/* Server List */}
        <div className="flex-1 w-full overflow-y-auto scrollbar-hide">
          <div className="flex flex-col items-center gap-2">
            {servers.map((server) => (
              <Tooltip key={server.id}>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => handleServerClick(server)}
                    className={cn(
                      "relative flex items-center justify-center w-12 h-12 rounded-[24px] bg-[#313338] transition-all duration-200 hover:rounded-[16px] group overflow-hidden",
                      currentServer?.id === server.id && "rounded-[16px]"
                    )}
                  >
                    {server.icon ? (
                      <Avatar className="w-12 h-12 rounded-none">
                        <AvatarImage src={server.icon} alt={server.name} />
                        <AvatarFallback className="rounded-none bg-[#5865F2] text-white">
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
                        currentServer?.id === server.id ? "h-10" : "h-0 group-hover:h-5"
                      )}
                    />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right" className="bg-[#111214] text-white border-none">
                  {server.name}
                </TooltipContent>
              </Tooltip>
            ))}
          </div>
        </div>

        <Separator className="w-8 h-0.5 bg-[#35363c] rounded-full" />

        {/* Add Server Button */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={onCreateServer}
              className="flex items-center justify-center w-12 h-12 rounded-[24px] bg-[#313338] transition-all duration-200 hover:rounded-[16px] hover:bg-[#23a55a] group"
            >
              <Plus className="w-6 h-6 text-[#23a55a] group-hover:text-white transition-colors" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right" className="bg-[#111214] text-white border-none">
            Add a Server
          </TooltipContent>
        </Tooltip>

        {/* Explore Servers */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button className="flex items-center justify-center w-12 h-12 rounded-[24px] bg-[#313338] transition-all duration-200 hover:rounded-[16px] hover:bg-[#23a55a] group">
              <Compass className="w-6 h-6 text-[#23a55a] group-hover:text-white transition-colors" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right" className="bg-[#111214] text-white border-none">
            Explore Discoverable Servers
          </TooltipContent>
        </Tooltip>

        {/* Download Apps */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button className="flex items-center justify-center w-12 h-12 rounded-[24px] bg-[#313338] transition-all duration-200 hover:rounded-[16px] hover:bg-[#23a55a] group">
              <Download className="w-6 h-6 text-[#23a55a] group-hover:text-white transition-colors" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right" className="bg-[#111214] text-white border-none">
            Download Apps
          </TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
}

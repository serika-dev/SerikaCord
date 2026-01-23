"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useServer } from "@/contexts/ServerContext";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  Hash, 
  Volume2, 
  ChevronDown, 
  ChevronRight, 
  Search, 
  UserPlus,
  MoreHorizontal,
  Lock,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface MobileServerViewProps {
  onBack?: () => void;
}

// Extended types for mobile-specific properties
interface ExtendedServer {
  banner?: string;
  memberCount?: number;
  onlineCount?: number;
}

interface ExtendedChannel {
  category?: string;
  unreadCount?: number;
}

export function MobileServerView({ onBack }: MobileServerViewProps) {
  const router = useRouter();
  const { currentServer, channels, setCurrentChannel } = useServer();
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());

  if (!currentServer) return null;

  // Cast to extended type for optional properties
  const server = currentServer as typeof currentServer & ExtendedServer;

  // Group channels by category
  const categorizedChannels = channels.reduce((acc, channel) => {
    const extChannel = channel as typeof channel & ExtendedChannel;
    const category = extChannel.category || "CHAT";
    if (!acc[category]) acc[category] = [];
    acc[category].push(channel);
    return acc;
  }, {} as Record<string, typeof channels>);

  const toggleCategory = (category: string) => {
    setCollapsedCategories(prev => {
      const newSet = new Set(prev);
      if (newSet.has(category)) {
        newSet.delete(category);
      } else {
        newSet.add(category);
      }
      return newSet;
    });
  };

  const getChannelIcon = (type: string, isLocked?: boolean) => {
    if (isLocked) return <Lock className="w-5 h-5 text-[#666666]" />;
    switch (type) {
      case "voice":
        return <Volume2 className="w-5 h-5 text-[#666666]" />;
      default:
        return <Hash className="w-5 h-5 text-[#666666]" />;
    }
  };

  const handleChannelClick = (channel: typeof channels[0]) => {
    setCurrentChannel(channel);
    router.push(`/channels/${currentServer.id}/${channel.id}`);
  };

  return (
    <div className="flex flex-col h-full bg-[#0a0a0a]">
      {/* Server Banner */}
      <div className="relative">
        {server.banner ? (
          <div 
            className="h-32 bg-cover bg-center"
            style={{ backgroundImage: `url(${server.banner})` }}
          />
        ) : (
          <div className="h-32 bg-gradient-to-br from-[#8B5CF6] to-[#6366F1]" />
        )}
        
        {/* Server Info Overlay */}
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-[#0a0a0a] to-transparent pt-8 pb-3 px-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-white">{currentServer.name}</h1>
              <ChevronRight className="w-4 h-4 text-[#888888]" />
            </div>
            <button className="p-2 rounded-full bg-[#1a1a1a]/80">
              <MoreHorizontal className="w-5 h-5 text-white" />
            </button>
          </div>
          <p className="text-sm text-[#888888] mt-1">
            {server.memberCount || 0} Members • {server.onlineCount || 0} Online
          </p>
        </div>
      </div>

      {/* Search and Add Friend */}
      <div className="flex items-center gap-2 px-4 py-3">
        <button className="flex-1 flex items-center justify-center gap-2 h-10 rounded-full bg-[#1a1a1a] text-[#666666]">
          <Search className="w-4 h-4" />
          <span>Search</span>
        </button>
        <button className="w-10 h-10 flex items-center justify-center rounded-full bg-[#1a1a1a]">
          <UserPlus className="w-5 h-5 text-[#666666]" />
        </button>
      </div>

      {/* Channel List */}
      <ScrollArea className="flex-1">
        <div className="px-2 pb-20">
          {Object.entries(categorizedChannels).map(([category, categoryChannels]) => (
            <div key={category} className="mb-2">
              {/* Category Header */}
              <button
                onClick={() => toggleCategory(category)}
                className="w-full flex items-center gap-1 px-2 py-2 text-xs font-semibold uppercase text-[#666666]"
              >
                <ChevronDown 
                  className={cn(
                    "w-3 h-3 transition-transform",
                    collapsedCategories.has(category) && "-rotate-90"
                  )} 
                />
                {category}
              </button>

              {/* Channels */}
              {!collapsedCategories.has(category) && (
                <div className="space-y-0.5">
                  {categoryChannels.map((channel) => {
                    const extChannel = channel as typeof channel & ExtendedChannel;
                    return (
                      <button
                        key={channel.id}
                        onClick={() => handleChannelClick(channel)}
                        className={cn(
                          "w-full flex items-center gap-2 px-3 py-2 rounded-md transition-colors",
                          "hover:bg-[#1a1a1a] text-[#888888] hover:text-white"
                        )}
                      >
                        {getChannelIcon(channel.type)}
                        <span className="flex-1 text-left truncate">{channel.name}</span>
                        {extChannel.unreadCount && extChannel.unreadCount > 0 && (
                          <span className="min-w-[20px] h-5 px-1.5 flex items-center justify-center bg-[#ED4245] text-white text-xs font-bold rounded-full">
                            {extChannel.unreadCount}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

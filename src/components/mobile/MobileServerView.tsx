"use client";

import { useState, useMemo } from "react";
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
  Settings,
  Bell,
  Megaphone,
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
  parentId?: string | null;
  unreadCount?: number;
}

export function MobileServerView({ onBack }: MobileServerViewProps) {
  const router = useRouter();
  const { currentServer, channels, setCurrentChannel } = useServer();
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());

  // Group channels by parent (category)
  const groupedChannels = useMemo(() => {
    const categories: Array<{ id: string | null; name: string; channels: typeof channels }> = [];
    const channelsByParent: Record<string, typeof channels> = {};
    const categoryChannels = channels.filter(c => c.type === 'category');
    const nonCategoryChannels = channels.filter(c => c.type !== 'category');

    // Group non-category channels by parentId
    nonCategoryChannels.forEach(channel => {
      const extChannel = channel as typeof channel & ExtendedChannel;
      const parentId = extChannel.parentId || 'uncategorized';
      if (!channelsByParent[parentId]) {
        channelsByParent[parentId] = [];
      }
      channelsByParent[parentId].push(channel);
    });

    // Create category groups
    categoryChannels.forEach(category => {
      categories.push({
        id: category.id,
        name: category.name,
        channels: channelsByParent[category.id] || [],
      });
    });

    // Add uncategorized channels
    if (channelsByParent['uncategorized']?.length > 0) {
      categories.unshift({
        id: null,
        name: 'CHANNELS',
        channels: channelsByParent['uncategorized'],
      });
    }

    return categories;
  }, [channels]);

  if (!currentServer) return null;

  // Cast to extended type for optional properties
  const server = currentServer as typeof currentServer & ExtendedServer;

  const toggleCategory = (categoryId: string) => {
    setCollapsedCategories(prev => {
      const newSet = new Set(prev);
      if (newSet.has(categoryId)) {
        newSet.delete(categoryId);
      } else {
        newSet.add(categoryId);
      }
      return newSet;
    });
  };

  const getChannelIcon = (type: string) => {
    switch (type) {
      case "voice":
        return <Volume2 className="w-5 h-5 text-[#666666]" />;
      case "announcement":
        return <Megaphone className="w-5 h-5 text-[#666666]" />;
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
      {/* Server Header */}
      <div className="relative flex-shrink-0">
        {server.banner ? (
          <div 
            className="h-28 bg-cover bg-center"
            style={{ backgroundImage: `url(${server.banner})` }}
          />
        ) : (
          <div className="h-28 bg-gradient-to-br from-[#8B5CF6] to-[#6366F1]" />
        )}
        
        {/* Server Info Overlay */}
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-[#0a0a0a] via-[#0a0a0a]/90 to-transparent pt-10 pb-3 px-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <h1 className="text-xl font-bold text-white truncate">{currentServer.name}</h1>
            </div>
            <div className="flex items-center gap-2">
              <button className="p-2 rounded-full bg-[#1a1a1a]/80 hover:bg-[#252525] transition-colors">
                <Bell className="w-5 h-5 text-white" />
              </button>
              <button className="p-2 rounded-full bg-[#1a1a1a]/80 hover:bg-[#252525] transition-colors">
                <Settings className="w-5 h-5 text-white" />
              </button>
            </div>
          </div>
          <p className="text-sm text-[#888888] mt-1">
            {server.memberCount || 0} members
          </p>
        </div>
      </div>

      {/* Search */}
      <div className="flex items-center gap-2 px-4 py-3 flex-shrink-0 border-b border-[#1a1a1a]">
        <button className="flex-1 flex items-center gap-2 h-10 px-4 rounded-xl bg-[#111111] text-[#666666] hover:bg-[#1a1a1a] transition-colors">
          <Search className="w-4 h-4" />
          <span className="text-sm">Search channels</span>
        </button>
        <button className="w-10 h-10 flex items-center justify-center rounded-xl bg-[#111111] hover:bg-[#1a1a1a] transition-colors">
          <UserPlus className="w-5 h-5 text-[#666666]" />
        </button>
      </div>

      {/* Channel List */}
      <ScrollArea className="flex-1">
        <div className="px-2 py-2 pb-24">
          {groupedChannels.map((category) => (
            <div key={category.id || 'uncategorized'} className="mb-2">
              {/* Category Header */}
              <button
                onClick={() => toggleCategory(category.id || 'uncategorized')}
                className="w-full flex items-center gap-1 px-2 py-2 text-xs font-semibold uppercase text-[#666666] hover:text-[#888888] transition-colors"
              >
                <ChevronDown 
                  className={cn(
                    "w-3 h-3 transition-transform",
                    collapsedCategories.has(category.id || 'uncategorized') && "-rotate-90"
                  )} 
                />
                {category.name}
                <span className="ml-auto text-[10px] text-[#555555]">
                  {category.channels.length}
                </span>
              </button>

              {/* Channels */}
              {!collapsedCategories.has(category.id || 'uncategorized') && (
                <div className="space-y-0.5">
                  {category.channels.map((channel) => {
                    const extChannel = channel as typeof channel & ExtendedChannel;
                    return (
                      <button
                        key={channel.id}
                        onClick={() => handleChannelClick(channel)}
                        className={cn(
                          "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all active:scale-[0.98]",
                          "hover:bg-[#1a1a1a] text-[#888888] hover:text-white"
                        )}
                      >
                        {getChannelIcon(channel.type)}
                        <span className="flex-1 text-left truncate font-medium">{channel.name}</span>
                        {extChannel.unreadCount && extChannel.unreadCount > 0 && (
                          <span className="min-w-[20px] h-5 px-1.5 flex items-center justify-center bg-[#ED4245] text-white text-xs font-bold rounded-full">
                            {extChannel.unreadCount > 99 ? "99+" : extChannel.unreadCount}
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

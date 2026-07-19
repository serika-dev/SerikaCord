"use client";

import { useState, useMemo, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { useServer } from "@/contexts/ServerContext";
import { useUnread } from "@/contexts/UnreadContext";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { 
  Hash, 
  Volume2, 
  ChevronDown, 
  Search, 
  UserPlus,
  Settings,
  Megaphone,
  Users,
  ChevronLeft,
  RefreshCw,
  MoreHorizontal,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { voiceService } from "@/lib/services/voiceService";
import { usePermissions } from "@/hooks/usePermissions";
import { useGT } from "gt-next";

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
  const gt = useGT();
  const { currentServer, channels, setCurrentChannel } = useServer();
  const { isChannelUnread, getMentionCount } = useUnread();
  const { can, isAdmin } = usePermissions(currentServer?.id);
  const canManageServer = can("MANAGE_SERVER") || isAdmin;
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const pullStartY = useRef(0);
  const [pullDistance, setPullDistance] = useState(0);

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

  // Filter channels by search query
  const filteredCategories = useMemo(() => {
    if (!searchQuery.trim()) return groupedChannels;
    
    const query = searchQuery.toLowerCase();
    return groupedChannels.map(category => ({
      ...category,
      channels: category.channels.filter(c => 
        c.name.toLowerCase().includes(query)
      ),
    })).filter(category => category.channels.length > 0);
  }, [groupedChannels, searchQuery]);

  const handleRefresh = useCallback(async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    // Refresh will happen via context
    setTimeout(() => setIsRefreshing(false), 1000);
  }, [isRefreshing]);

  // Pull to refresh handlers
  const handleTouchStart = (e: React.TouchEvent) => {
    if (scrollContainerRef.current?.scrollTop === 0) {
      pullStartY.current = e.touches[0].clientY;
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (scrollContainerRef.current?.scrollTop !== 0) return;
    const currentY = e.touches[0].clientY;
    const diff = currentY - pullStartY.current;
    
    if (diff > 0 && diff < 150) {
      setPullDistance(diff);
    }
  };

  const handleTouchEnd = () => {
    if (pullDistance > 80) {
      handleRefresh();
    }
    setPullDistance(0);
  };

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
        return <Volume2 className="w-5 h-5 text-neutral-500" />;
      case "announcement":
        return <Megaphone className="w-5 h-5 text-neutral-500" />;
      default:
        return <Hash className="w-5 h-5 text-neutral-500" />;
    }
  };

  const handleChannelClick = (channel: typeof channels[0]) => {
    // Voice channels behave like text channels on mobile: tapping opens the
    // channel's call view (participants + a Join button), rather than silently
    // joining/leaving from the sidebar. Joining happens from the call screen.
    setCurrentChannel(channel);
    router.push(`/channels/${currentServer.id}/${channel.id}`);
  };

  return (
    <div className="flex flex-col h-full bg-[var(--bg-app)]">
      {/* Pull to refresh indicator */}
      <div 
        className={cn(
          "absolute left-0 right-0 top-0 flex items-center justify-center transition-all duration-200 z-20",
          pullDistance > 0 ? "opacity-100" : "opacity-0"
        )}
        style={{ height: pullDistance, paddingTop: Math.max(0, pullDistance - 40) }}
      >
        <RefreshCw 
          className={cn(
            "w-6 h-6 text-[var(--app-accent)] transition-transform",
            isRefreshing && "animate-spin",
            pullDistance > 80 && "scale-110"
          )}
          style={{ transform: `rotate(${pullDistance * 2}deg)` }}
        />
      </div>

      {/* Server Header */}
      <div className="relative flex-shrink-0">
        {server.banner ? (
          <div 
            className="h-32 bg-cover bg-center"
            style={{ backgroundImage: `url(${server.banner})` }}
          />
        ) : (
          <div className="h-32 bg-gradient-to-br from-[var(--app-accent)] via-[var(--app-accent)] to-[var(--app-accent)] opacity-80" />
        )}
        
        {/* Gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-[var(--bg-app)] via-black/60 to-transparent" />
        
        {/* Back button (for navigation) */}
        <button
          onClick={onBack}
          className="absolute top-4 left-4 p-2 rounded-full bg-black/40 backdrop-blur-sm text-white active:scale-95 transition-transform"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        
        {/* Server Info Overlay */}
        <div className="absolute bottom-0 left-0 right-0 px-5 pb-4">
          <div className="flex items-end justify-between gap-4">
            <div className="flex-1 min-w-0">
              <h1 className="text-2xl font-bold text-white truncate drop-shadow-lg">
                {currentServer.name}
              </h1>
              <div className="flex items-center gap-3 mt-1">
                <span className="flex items-center gap-1.5 text-sm text-neutral-300">
                  <Users className="w-4 h-4" />
                  {server.memberCount || 0} {gt("members")}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {canManageServer && (
                <button
                  onClick={() => window.dispatchEvent(new CustomEvent("openServerSettings"))}
                  aria-label={gt("Server settings")}
                  className="p-2.5 rounded-xl bg-white/10 backdrop-blur-sm hover:bg-white/20 transition-colors active:scale-95"
                >
                  <Settings className="w-5 h-5 text-white" />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Search & Actions Bar */}
      <div className="flex items-center gap-2 px-4 py-3 flex-shrink-0 border-b border-[var(--border-subtle)]">
        {showSearch ? (
          <div className="flex-1 flex items-center gap-2">
            <input
              type="text"
              placeholder={gt("Search channels...")}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              autoFocus
              className="flex-1 h-10 px-4 rounded-xl bg-[var(--bg-card)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--app-accent)]/50"
            />
            <button 
              onClick={() => {
                setShowSearch(false);
                setSearchQuery("");
              }}
              className="p-2.5 rounded-xl bg-[var(--bg-card)] hover:bg-[var(--bg-hover)] transition-colors active:scale-95"
            >
              <ChevronLeft className="w-5 h-5 text-[var(--text-muted)]" />
            </button>
          </div>
        ) : (
          <>
            <button 
              onClick={() => setShowSearch(true)}
              className="flex-1 flex items-center gap-2 h-10 px-4 rounded-xl bg-[var(--bg-card)] text-[var(--text-muted)] hover:bg-[var(--bg-hover)] transition-colors"
            >
              <Search className="w-4 h-4" />
              <span className="text-sm">{gt("Search channels")}</span>
            </button>
            <button
              onClick={() => window.dispatchEvent(new CustomEvent("openInviteDialog"))}
              aria-label={gt("Invite people")}
              className="p-2.5 rounded-xl bg-[var(--bg-card)] hover:bg-[var(--bg-hover)] transition-colors active:scale-95"
            >
              <UserPlus className="w-5 h-5 text-[var(--text-muted)]" />
            </button>
          </>
        )}
      </div>

      {/* Channel List */}
      <div 
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto overscroll-contain"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <div className="px-2 py-2 pb-28">
          {filteredCategories.length === 0 && searchQuery ? (
            <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
              <div className="w-16 h-16 rounded-2xl bg-[var(--bg-card)] flex items-center justify-center mb-4">
                <Search className="w-8 h-8 text-[var(--text-muted)]" />
              </div>
              <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-1">{gt("No channels found")}</h3>
              <p className="text-[var(--text-muted)] text-sm">
                {gt("Try a different search term")}
              </p>
            </div>
          ) : (
            filteredCategories.map((category) => (
              <div key={category.id || 'uncategorized'} className="mb-3">
                {/* Category Header */}
                <button
                  onClick={() => toggleCategory(category.id || 'uncategorized')}
                  className="w-full flex items-center gap-1.5 px-3 py-2 text-xs font-bold uppercase text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors active:scale-[0.98]"
                >
                  <ChevronDown 
                    className={cn(
                      "w-3 h-3 transition-transform duration-200",
                      collapsedCategories.has(category.id || 'uncategorized') && "-rotate-90"
                    )} 
                  />
                  <span className="tracking-wider">{category.name}</span>
                  <span className="ml-auto text-[10px] text-[var(--text-muted)] font-medium">
                    {category.channels.length}
                  </span>
                </button>

                {/* Channels */}
                {!collapsedCategories.has(category.id || 'uncategorized') && (
                  <div className="space-y-0.5 mt-1">
                    {category.channels.map((channel) => {
                      const isVoice = channel.type === "voice";
                      const unread = !isVoice && isChannelUnread(channel.id);
                      const mentions = isVoice ? 0 : getMentionCount(channel.id);
                      return (
                        <button
                          key={channel.id}
                          onClick={() => handleChannelClick(channel)}
                          className={cn(
                            "w-full flex items-center gap-3 px-3 py-3 rounded-xl transition-all duration-150",
                            "hover:bg-[var(--bg-hover)]/80 active:bg-[var(--bg-hover)] active:scale-[0.98]",
                            isVoice && voiceService.currentRoomId === channel.id
                              ? "bg-green-500/10 text-green-400"
                              : unread
                                ? "text-[var(--text-primary)] font-semibold"
                                : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                          )}
                        >
                          {getChannelIcon(channel.type)}
                          <span className={cn(
                            "flex-1 text-left truncate text-[15px]",
                            unread ? "font-semibold" : "font-medium"
                          )}>
                            {channel.name}
                          </span>
                          {isVoice && voiceService.currentRoomId === channel.id && (
                            <span className="inline-block w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                          )}
                          {mentions > 0 ? (
                            <span className="min-w-[20px] h-5 px-1.5 flex items-center justify-center bg-[#ED4245] text-white text-xs font-bold rounded-full shadow-lg">
                              {mentions > 99 ? "99+" : mentions}
                            </span>
                          ) : unread ? (
                            <span className="w-2.5 h-2.5 flex-shrink-0 rounded-full bg-[var(--text-primary)]" />
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

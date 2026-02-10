"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { UserPlus, Star, RefreshCw, Search, X, ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";

interface Message {
  id: string;
  recipientId: string;
  type: "dm" | "group";
  name: string;
  username: string;
  avatar?: string;
  avatars?: string[];
  lastMessage: string;
  timestamp: string;
  unreadCount?: number;
  isPinned?: boolean;
  isFavorite?: boolean;
  status?: "online" | "idle" | "dnd" | "offline";
}

interface MobileMessagesViewProps {
  onAddFriend?: () => void;
}

export function MobileMessagesView({ onAddFriend }: MobileMessagesViewProps) {
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const pullStartY = useRef(0);
  const [pullDistance, setPullDistance] = useState(0);

  const formatTimestamp = useCallback((date: string | Date) => {
    if (!date) return "";
    const d = new Date(date);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    const minutes = Math.floor(diff / (1000 * 60));
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (minutes < 1) return "Now";
    if (minutes < 60) return `${minutes}m`;
    if (hours < 24) return `${hours}h`;
    if (days < 7) return `${days}d`;
    return d.toLocaleDateString();
  }, []);

  const fetchMessages = useCallback(async () => {
    try {
      const response = await fetch("/api/dms");
      if (response.ok) {
        const data = await response.json();
        // Use Map to deduplicate by recipient ID
        const seenRecipients = new Map<string, Message>();
        
        (data.channels || []).forEach((channel: any) => {
          const recipient = channel.recipients?.[0];
          if (!recipient) return;
          
          const recipientId = recipient.id?.toString() || recipient._id?.toString();
          if (!recipientId) return;
          
          // Only keep the most recent conversation with each user
          const existing = seenRecipients.get(recipientId);
          const channelDate = new Date(channel.updatedAt || 0).getTime();
          const existingDate = existing ? new Date(existing.timestamp || 0).getTime() : 0;
          
          if (!existing || channelDate > existingDate) {
            seenRecipients.set(recipientId, {
              id: channel.id,
              recipientId: recipientId,
              type: channel.type === "group" ? "group" : "dm",
              name: recipient?.displayName || recipient?.username || "Unknown",
              username: recipient?.username || "",
              avatar: recipient?.avatar,
              lastMessage: channel.lastMessage?.content || "Start a conversation",
              timestamp: formatTimestamp(channel.updatedAt),
              status: recipient?.status || "offline",
            });
          }
        });
        
        setMessages(Array.from(seenRecipients.values()));
      }
    } catch (error) {
      console.error("Failed to fetch messages:", error);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
      setPullDistance(0);
    }
  }, [formatTimestamp]);

  useEffect(() => {
    fetchMessages();
    // Auto refresh every 30 seconds
    const interval = setInterval(fetchMessages, 30000);
    return () => clearInterval(interval);
  }, [fetchMessages]);

  const handleRefresh = useCallback(async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    await fetchMessages();
  }, [fetchMessages, isRefreshing]);

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

  const statusColors: Record<string, string> = {
    online: "#22c55e",
    idle: "#eab308",
    dnd: "#ef4444",
    offline: "#6b7280",
  };

  const handleMessageClick = (message: Message) => {
    router.push(`/dm/${message.recipientId}`);
  };

  // Filter messages by search query
  const filteredMessages = messages.filter(m => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return m.name.toLowerCase().includes(query) || 
           m.username.toLowerCase().includes(query) ||
           m.lastMessage.toLowerCase().includes(query);
  });

  // Group messages by pinned/favorites
  const pinnedMessages = filteredMessages.filter(m => m.isPinned || m.isFavorite);
  const regularMessages = filteredMessages.filter(m => !m.isPinned && !m.isFavorite);

  return (
    <div className="flex flex-col h-full bg-[#000000]">
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
            "w-6 h-6 text-[#8B5CF6] transition-transform",
            isRefreshing && "animate-spin",
            pullDistance > 80 && "scale-110"
          )}
          style={{ transform: `rotate(${pullDistance * 2}deg)` }}
        />
      </div>

      {/* Header */}
      <div className="flex flex-col px-5 bg-[#000000] sticky top-0 z-10 pt-safe">
        <div className="flex items-center justify-between pt-4 pb-3">
          {showSearch ? (
            <div className="flex-1 flex items-center gap-3">
              <button 
                onClick={() => {
                  setShowSearch(false);
                  setSearchQuery("");
                }}
                className="p-2 -ml-2 rounded-full hover:bg-[#1a1a1a] transition-colors active:scale-95"
              >
                <ChevronLeft className="w-6 h-6 text-white" />
              </button>
              <input
                type="text"
                placeholder="Search conversations..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                autoFocus
                className="flex-1 bg-[#1a1a1a] border-0 rounded-xl px-4 py-2.5 text-white placeholder:text-neutral-500 text-base focus:outline-none focus:ring-2 focus:ring-[#8B5CF6]/50"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="p-2 rounded-full hover:bg-[#1a1a1a] transition-colors active:scale-95"
                >
                  <X className="w-5 h-5 text-neutral-400" />
                </button>
              )}
            </div>
          ) : (
            <>
              <h1 className="text-3xl font-bold text-white tracking-tight">Messages</h1>
              <div className="flex items-center gap-2">
                <button 
                  onClick={() => setShowSearch(true)}
                  className="p-2.5 rounded-full bg-[#1a1a1a] text-white hover:bg-[#252525] transition-all active:scale-95"
                >
                  <Search className="w-5 h-5" />
                </button>
                <button 
                  onClick={onAddFriend}
                  className="p-2.5 rounded-full bg-[#1a1a1a] text-white hover:bg-[#252525] transition-all active:scale-95"
                >
                  <UserPlus className="w-5 h-5" />
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Pinned/Favorites Section */}
      {pinnedMessages.length > 0 && (
        <div className="px-5 py-3 border-b border-[#1a1a1a]">
          <h2 className="text-xs font-bold text-neutral-500 uppercase tracking-widest mb-3 flex items-center gap-2">
            <Star className="w-3.5 h-3.5" />
            Favorites
          </h2>
          <div className="flex items-center gap-4 overflow-x-auto pb-2 scrollbar-hide -mx-1 px-1">
            {pinnedMessages.map((message) => (
              <button
                key={message.id}
                onClick={() => handleMessageClick(message)}
                className="flex flex-col items-center gap-2 min-w-[72px] group"
              >
                <div className="relative transform transition-transform duration-150 group-active:scale-90">
                  {message.type === "group" && message.avatars ? (
                    <div className="w-16 h-16 rounded-2xl bg-[#1a1a1a] relative overflow-hidden ring-2 ring-transparent group-focus:ring-[#8B5CF6] transition-all">
                      <Avatar className="w-9 h-9 absolute top-1 left-1 border-2 border-[#0a0a0a]">
                        <AvatarImage src={message.avatars[0]} />
                        <AvatarFallback className="bg-[#8B5CF6]">
                          {message.name.charAt(0)}
                        </AvatarFallback>
                      </Avatar>
                      {message.avatars[1] && (
                        <Avatar className="w-9 h-9 absolute bottom-1 right-1 border-2 border-[#0a0a0a]">
                          <AvatarImage src={message.avatars[1]} />
                          <AvatarFallback className="bg-[#6366F1]">+</AvatarFallback>
                        </Avatar>
                      )}
                    </div>
                  ) : (
                    <Avatar className="w-16 h-16 rounded-2xl ring-2 ring-transparent group-focus:ring-[#8B5CF6] transition-all">
                      <AvatarImage src={message.avatar} />
                      <AvatarFallback className="bg-[#8B5CF6] text-white text-xl font-semibold">
                        {message.name.charAt(0).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                  )}
                  {message.isFavorite && (
                    <div className="absolute -top-1 -right-1 w-5 h-5 bg-[#F59E0B] rounded-full flex items-center justify-center border-2 border-black shadow-lg">
                      <Star className="w-3 h-3 text-white fill-white" />
                    </div>
                  )}
                  <div
                    className="absolute bottom-0 right-0 w-4 h-4 rounded-full border-[3px] border-[#000000]"
                    style={{ backgroundColor: statusColors[message.status || "offline"] }}
                  />
                </div>
                <span className="text-xs font-medium text-neutral-400 truncate max-w-[72px] group-hover:text-white transition-colors">
                  {message.name.split(" ")[0]}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Search Bar */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500" />
          <input
            type="text"
            placeholder="Search messages"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full h-10 pl-10 pr-4 rounded-xl bg-[#1a1a1a] text-white text-sm placeholder:text-neutral-500 border border-white/[0.06] focus:border-[#8B5CF6]/50 focus:outline-none transition-colors"
          />
        </div>
      </header>

      {/* Messages List */}
      <div 
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto overscroll-contain"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <div className="px-3 pb-28 pt-2">
          {isLoading ? (
            <div className="flex items-center justify-center py-20">
              <div className="w-8 h-8 border-3 border-[#8B5CF6] border-t-transparent rounded-full animate-spin" />
            </div>
          ) : filteredMessages.length === 0 && searchQuery ? (
            <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
              <div className="w-16 h-16 rounded-2xl bg-[#1a1a1a] flex items-center justify-center mb-4">
                <Search className="w-8 h-8 text-neutral-500" />
              </div>
              <h3 className="text-lg font-semibold text-white mb-1">No results</h3>
              <p className="text-neutral-500 text-sm">
                Try searching for something else
              </p>
            </div>
          ) : messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
              <div className="w-20 h-20 rounded-3xl bg-[#1a1a1a] flex items-center justify-center mb-6">
                <UserPlus className="w-10 h-10 text-neutral-500" />
              </div>
              <h3 className="text-xl font-bold text-white mb-2">No messages yet</h3>
              <p className="text-neutral-500 text-base mb-6 max-w-[280px]">
                Start a conversation by adding friends or joining a server
              </p>
              <button 
                onClick={onAddFriend}
                className="px-8 py-3.5 bg-[#8B5CF6] hover:bg-[#7C3AED] text-white font-bold rounded-2xl transition-all active:scale-95 shadow-lg shadow-purple-500/25"
              >
                Find Friends
              </button>
            </div>
          ) : (
            <div className="space-y-0.5">
              {regularMessages.map((message, index) => (
                <button
                  key={`${message.recipientId}-${index}`}
                  onClick={() => handleMessageClick(message)}
                  className={cn(
                    "w-full flex items-center gap-4 px-3 py-3.5 rounded-2xl transition-all duration-150",
                    "hover:bg-[#1a1a1a]/60 active:bg-[#1a1a1a] active:scale-[0.98]"
                  )}
                >
                  {/* Avatar with status */}
                  <div className="relative flex-shrink-0">
                    {message.type === "group" && message.avatars ? (
                      <div className="w-12 h-12 rounded-full bg-[#1a1a1a] relative">
                        <Avatar className="w-7 h-7 absolute top-0 left-0 ring-2 ring-[#0a0a0a]">
                          <AvatarImage src={message.avatars[0]} />
                          <AvatarFallback className="bg-[#8B5CF6] text-[10px]">
                            {message.name.charAt(0)}
                          </AvatarFallback>
                        </Avatar>
                        {message.avatars[1] && (
                          <Avatar className="w-7 h-7 absolute bottom-0 right-0 ring-2 ring-[#0a0a0a]">
                            <AvatarImage src={message.avatars[1]} />
                            <AvatarFallback className="bg-[#6366F1] text-[10px]">+</AvatarFallback>
                          </Avatar>
                        )}
                      </div>
                    ) : (
                      <Avatar className="w-12 h-12">
                        <AvatarImage src={message.avatar} />
                        <AvatarFallback className="bg-gradient-to-br from-[#8B5CF6] to-[#6366F1] text-white text-base font-semibold">
                          {message.name.charAt(0).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                    )}
                    {/* Status indicator */}
                    <div
                      className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full ring-[3px] ring-[#0a0a0a]"
                      style={{ backgroundColor: statusColors[message.status || "offline"] }}
                    />
                  </div>
                  
                  <div className="flex-1 min-w-0 text-left">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[17px] font-semibold text-white truncate leading-tight">
                        {message.name}
                      </span>
                      <span className={cn(
                        "text-xs flex-shrink-0",
                        message.unreadCount && message.unreadCount > 0 ? "text-[#8B5CF6] font-medium" : "text-neutral-500"
                      )}>
                        {message.timestamp}
                      </span>
                    </div>
                    <p className="text-[15px] text-neutral-400 truncate leading-snug mt-0.5">
                      {message.lastMessage}
                    </p>
                  </div>

                  {/* Unread badge */}
                  {message.unreadCount && message.unreadCount > 0 && (
                    <span className="min-w-[22px] h-[22px] px-1.5 flex items-center justify-center bg-[#ED4245] text-white text-xs font-bold rounded-full shadow-lg">
                      {message.unreadCount > 99 ? "99+" : message.unreadCount}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

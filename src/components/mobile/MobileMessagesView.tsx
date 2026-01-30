"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { UserPlus, Search, MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";

interface Message {
  id: string;
  type: "dm" | "group";
  name: string;
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
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    // Fetch messages/DMs
    const fetchMessages = async () => {
      try {
        const response = await fetch("/api/dms");
        if (response.ok) {
          const data = await response.json();
          // Transform DM channels to message format
          const processedRecipientIds = new Set<string>();
          const formattedMessages = (data.channels || [])
            .map((channel: any) => {
              const recipient = channel.recipients?.[0];
              // Skip if no recipient found (deleted user or data error)
              if (!recipient) return null;

              // Skip if we already have a DM with this user
              if (processedRecipientIds.has(recipient.id)) return null;
              processedRecipientIds.add(recipient.id);

              return {
                id: channel.id,
                type: channel.type === "group" ? "group" : "dm",
                name: recipient.displayName || recipient.username || "Unknown",
                avatar: recipient.avatar,
                lastMessage: channel.lastMessage?.content || "No messages yet",
                timestamp: formatTimestamp(channel.updatedAt),
                status: recipient.status || "offline",
                unreadCount: channel.unreadCount || 0,
              };
            })
            .filter(Boolean); // Remove null items

          setMessages(formattedMessages);
        }
      } catch (error) {
        console.error("Failed to fetch messages:", error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchMessages();
  }, []);

  const formatTimestamp = (date: string | Date) => {
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
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  const statusColors: Record<string, string> = {
    online: "#22c55e",
    idle: "#eab308",
    dnd: "#ef4444",
    offline: "#6b7280",
  };

  const handleMessageClick = (message: Message) => {
    router.push(`/channels/@me/${message.id}`);
  };

  const filteredMessages = messages.filter(m =>
    m.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="flex flex-col h-full bg-[#0a0a0a]">
      {/* Header */}
      <header className="flex-shrink-0 px-4 pt-3 pb-2 safe-area-top">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-2xl font-bold text-white">Messages</h1>
          <button
            onClick={onAddFriend}
            className="flex items-center justify-center w-10 h-10 rounded-full bg-[#1a1a1a] text-white active:scale-95 active:bg-[#252525] transition-all touch-manipulation"
          >
            <UserPlus className="w-5 h-5" />
          </button>
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
      <ScrollArea className="flex-1">
        <div className="px-2 pb-24">
          {isLoading ? (
            <div className="flex items-center justify-center py-20">
              <div className="w-8 h-8 border-3 border-[#8B5CF6] border-t-transparent rounded-full animate-spin" />
            </div>
          ) : filteredMessages.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
              <div className="w-16 h-16 rounded-full bg-[#1a1a1a] flex items-center justify-center mb-4">
                <UserPlus className="w-8 h-8 text-neutral-600" />
              </div>
              <h3 className="text-lg font-semibold text-white mb-1">
                {searchQuery ? "No results found" : "No messages yet"}
              </h3>
              <p className="text-neutral-500 text-sm mb-5 max-w-[240px]">
                {searchQuery
                  ? "Try a different search term"
                  : "Start a conversation by adding some friends"}
              </p>
              {!searchQuery && (
                <button
                  onClick={onAddFriend}
                  className="px-6 py-2.5 bg-[#8B5CF6] hover:bg-[#7C3AED] text-white text-sm font-semibold rounded-full transition-all active:scale-95"
                >
                  Add Friends
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-0.5 py-2">
              {filteredMessages.map((message) => (
                <button
                  key={message.id}
                  onClick={() => handleMessageClick(message)}
                  className={cn(
                    "w-full flex items-center gap-3 px-3 py-3 rounded-xl transition-all touch-manipulation",
                    "hover:bg-white/[0.04] active:bg-white/[0.08] active:scale-[0.98]",
                    message.unreadCount && message.unreadCount > 0 && "bg-[#8B5CF6]/[0.06]"
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

                  {/* Content */}
                  <div className="flex-1 min-w-0 text-left">
                    <div className="flex items-center justify-between gap-2">
                      <span className={cn(
                        "text-[15px] font-semibold truncate",
                        message.unreadCount && message.unreadCount > 0 ? "text-white" : "text-neutral-200"
                      )}>
                        {message.name}
                      </span>
                      <span className={cn(
                        "text-xs flex-shrink-0",
                        message.unreadCount && message.unreadCount > 0 ? "text-[#8B5CF6] font-medium" : "text-neutral-500"
                      )}>
                        {message.timestamp}
                      </span>
                    </div>
                    <p className={cn(
                      "text-sm truncate mt-0.5",
                      message.unreadCount && message.unreadCount > 0 ? "text-neutral-300" : "text-neutral-500"
                    )}>
                      {message.lastMessage}
                    </p>
                  </div>

                  {/* Unread badge */}
                  {message.unreadCount && message.unreadCount > 0 && (
                    <span className="min-w-[20px] h-5 px-1.5 flex items-center justify-center bg-[#8B5CF6] text-white text-[11px] font-bold rounded-full">
                      {message.unreadCount > 99 ? "99+" : message.unreadCount}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

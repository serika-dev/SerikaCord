"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { UserPlus, Star, Pin } from "lucide-react";
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

  useEffect(() => {
    // Fetch messages/DMs
    const fetchMessages = async () => {
      try {
        const response = await fetch("/api/dms");
        if (response.ok) {
          const data = await response.json();
          // Transform DM channels to message format
          const formattedMessages = (data.channels || []).map((channel: any) => {
            const recipient = channel.recipients?.[0];
            return {
              id: channel.id,
              type: channel.type === "group" ? "group" : "dm",
              name: recipient?.displayName || recipient?.username || "Unknown",
              avatar: recipient?.avatar,
              lastMessage: channel.lastMessage?.content || "No messages yet",
              timestamp: formatTimestamp(channel.updatedAt),
              status: recipient?.status || "offline",
            };
          });
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
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const days = Math.floor(hours / 24);

    if (hours < 1) return "now";
    if (hours < 24) return `${hours}h`;
    if (days < 7) return `${days}d`;
    return d.toLocaleDateString();
  };

  const statusColors: Record<string, string> = {
    online: "#8B5CF6",
    idle: "#A78BFA",
    dnd: "#EF4444",
    offline: "#555555",
  };

  const handleMessageClick = (message: Message) => {
    router.push(`/channels/@me/${message.id}`);
  };

  // Group messages by pinned/favorites
  const pinnedMessages = messages.filter(m => m.isPinned || m.isFavorite);
  const regularMessages = messages.filter(m => !m.isPinned && !m.isFavorite);

  return (
    <div className="flex flex-col h-full bg-[#0a0a0a]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-4 border-b border-[#1a1a1a]">
        <h1 className="text-2xl font-bold text-white">Messages</h1>
        <button 
          onClick={onAddFriend}
          className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#1a1a1a] text-[#888888] hover:text-white transition-colors"
        >
          <UserPlus className="w-4 h-4" />
          <span className="text-sm">Add Friends</span>
        </button>
      </div>

      {/* Pinned/Favorites Section */}
      {pinnedMessages.length > 0 && (
        <div className="px-4 py-3 border-b border-[#1a1a1a]">
          <div className="flex items-center gap-4 overflow-x-auto pb-2 scrollbar-hide">
            {pinnedMessages.map((message) => (
              <button
                key={message.id}
                onClick={() => handleMessageClick(message)}
                className="flex flex-col items-center gap-1 min-w-[60px]"
              >
                <div className="relative">
                  {message.type === "group" && message.avatars ? (
                    <div className="w-14 h-14 rounded-full bg-[#1a1a1a] relative overflow-hidden">
                      {/* Group avatar stack */}
                      <Avatar className="w-8 h-8 absolute top-0 left-0 border-2 border-[#0a0a0a]">
                        <AvatarImage src={message.avatars[0]} />
                        <AvatarFallback className="bg-[#8B5CF6]">
                          {message.name.charAt(0)}
                        </AvatarFallback>
                      </Avatar>
                      {message.avatars[1] && (
                        <Avatar className="w-8 h-8 absolute bottom-0 right-0 border-2 border-[#0a0a0a]">
                          <AvatarImage src={message.avatars[1]} />
                          <AvatarFallback className="bg-[#6366F1]">+</AvatarFallback>
                        </Avatar>
                      )}
                    </div>
                  ) : (
                    <Avatar className="w-14 h-14">
                      <AvatarImage src={message.avatar} />
                      <AvatarFallback className="bg-[#8B5CF6] text-white text-lg">
                        {message.name.charAt(0).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                  )}
                  {message.isFavorite && (
                    <div className="absolute -top-1 -right-1 w-5 h-5 bg-[#F59E0B] rounded-full flex items-center justify-center">
                      <Star className="w-3 h-3 text-white fill-white" />
                    </div>
                  )}
                </div>
                <span className="text-xs text-[#888888] truncate max-w-[60px]">
                  {message.name.split(" ")[0]}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Messages List */}
      <ScrollArea className="flex-1">
        <div className="pb-20">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-8 h-8 border-2 border-[#8B5CF6] border-t-transparent rounded-full animate-spin" />
            </div>
          ) : messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
              <div className="w-16 h-16 rounded-full bg-[#1a1a1a] flex items-center justify-center mb-4">
                <UserPlus className="w-8 h-8 text-[#666666]" />
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">No messages yet</h3>
              <p className="text-[#666666] text-sm mb-4">
                Start a conversation by adding friends or joining a server
              </p>
              <button 
                onClick={onAddFriend}
                className="px-4 py-2 bg-[#8B5CF6] hover:bg-[#7C3AED] text-white rounded-full transition-colors"
              >
                Add Friend
              </button>
            </div>
          ) : (
            <div>
              {regularMessages.map((message) => (
                <button
                  key={message.id}
                  onClick={() => handleMessageClick(message)}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[#111111] transition-colors"
                >
                  <div className="relative flex-shrink-0">
                    {message.type === "group" && message.avatars ? (
                      <div className="w-12 h-12 rounded-full bg-[#1a1a1a] relative">
                        <Avatar className="w-7 h-7 absolute top-0 left-0 border-2 border-[#0a0a0a]">
                          <AvatarImage src={message.avatars[0]} />
                          <AvatarFallback className="bg-[#8B5CF6] text-xs">
                            {message.name.charAt(0)}
                          </AvatarFallback>
                        </Avatar>
                        {message.avatars[1] && (
                          <Avatar className="w-7 h-7 absolute bottom-0 right-0 border-2 border-[#0a0a0a]">
                            <AvatarImage src={message.avatars[1]} />
                            <AvatarFallback className="bg-[#6366F1] text-xs">+</AvatarFallback>
                          </Avatar>
                        )}
                      </div>
                    ) : (
                      <Avatar className="w-12 h-12">
                        <AvatarImage src={message.avatar} />
                        <AvatarFallback className="bg-[#8B5CF6] text-white">
                          {message.name.charAt(0).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                    )}
                    <div
                      className="absolute bottom-0 right-0 w-3.5 h-3.5 rounded-full border-2 border-[#0a0a0a]"
                      style={{ backgroundColor: statusColors[message.status || "offline"] }}
                    />
                  </div>
                  
                  <div className="flex-1 min-w-0 text-left">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-white truncate">{message.name}</span>
                      <span className="text-xs text-[#666666] flex-shrink-0">{message.timestamp}</span>
                    </div>
                    <p className="text-sm text-[#888888] truncate">{message.lastMessage}</p>
                  </div>

                  {message.unreadCount && message.unreadCount > 0 && (
                    <span className="min-w-[20px] h-5 px-1.5 flex items-center justify-center bg-[#ED4245] text-white text-xs font-bold rounded-full">
                      {message.unreadCount}
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

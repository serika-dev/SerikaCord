"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Phone,
  Video,
  Pin,
  Users,
  Search,
  Inbox,
  Plus,
  Gift,
  ImageIcon,
  Smile,
  Send,
  Crown,
  Loader2,
  ArrowLeft,
  MessageSquare,
} from "lucide-react";
import { cn } from "@/lib/utils";
import Link from "next/link";

interface User {
  id: string;
  username: string;
  displayName: string;
  avatar?: string;
  status: "online" | "idle" | "dnd" | "offline";
  customStatus?: string;
  isPremium?: boolean;
  bio?: string;
  createdAt?: string;
}

interface Message {
  id: string;
  content: string;
  authorId: string;
  author: User;
  channelId: string;
  createdAt: string;
  updatedAt?: string;
  attachments?: string[];
}

const statusColors = {
  online: "#8B5CF6",
  idle: "#A78BFA",
  dnd: "#EF4444",
  offline: "#555555",
};

export default function DMConversationPage() {
  const params = useParams();
  const router = useRouter();
  const recipientId = params.recipientId as string;
  const { user, isLoading: authLoading } = useAuth();
  const [recipient, setRecipient] = useState<User | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [showUserProfile, setShowUserProfile] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  // Redirect if not authenticated
  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/login");
    }
  }, [user, authLoading, router]);

  // Scroll to bottom of messages
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  // Fetch recipient info
  useEffect(() => {
    const fetchRecipient = async () => {
      try {
        const response = await fetch(`/api/users/${recipientId}`);
        if (response.ok) {
          const data = await response.json();
          setRecipient(data);
        }
      } catch (error) {
        console.error("Failed to fetch recipient:", error);
      }
    };

    if (recipientId) {
      fetchRecipient();
    }
  }, [recipientId]);

  // Fetch DM messages
  const fetchMessages = useCallback(async () => {
    try {
      const response = await fetch(`/api/dms/${recipientId}/messages`);
      if (response.ok) {
        const data = await response.json();
        setMessages(data.messages || []);
        scrollToBottom();
      }
    } catch (error) {
      console.error("Failed to fetch messages:", error);
    } finally {
      setIsLoading(false);
    }
  }, [recipientId]);

  useEffect(() => {
    if (recipientId && user) {
      fetchMessages();
    }
  }, [recipientId, fetchMessages, user]);

  // Set up real-time updates using SSE
  useEffect(() => {
    if (!recipientId || !user) return;

    // Connect to SSE endpoint for real-time messages
    const eventSource = new EventSource(`/api/dms/${recipientId}/stream`);
    eventSourceRef.current = eventSource;

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "message") {
          setMessages((prev) => {
            // Avoid duplicates
            if (prev.some((m) => m.id === data.message.id)) {
              return prev;
            }
            return [...prev, data.message];
          });
          scrollToBottom();
        }
      } catch (error) {
        console.error("SSE parse error:", error);
      }
    };

    eventSource.onerror = () => {
      console.error("SSE connection error");
      eventSource.close();
    };

    return () => {
      eventSource.close();
    };
  }, [recipientId, user]);

  // Send message
  const sendMessage = async () => {
    if (!newMessage.trim() || isSending) return;

    setIsSending(true);
    const messageContent = newMessage.trim();
    setNewMessage("");

    // Optimistic update
    const tempId = `temp-${Date.now()}`;
    const optimisticMessage: Message = {
      id: tempId,
      content: messageContent,
      authorId: user?.id || "",
      author: {
        id: user?.id || "",
        username: user?.username || "",
        displayName: user?.displayName || "",
        avatar: user?.avatar,
        status: user?.status || "online",
        isPremium: user?.isPremium,
      },
      channelId: recipientId,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimisticMessage]);
    scrollToBottom();

    try {
      const response = await fetch(`/api/dms/${recipientId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: messageContent }),
      });

      if (response.ok) {
        const data = await response.json();
        // Replace optimistic message with real one
        setMessages((prev) =>
          prev.map((m) => (m.id === tempId ? data : m))
        );
      } else {
        // Remove optimistic message on error
        setMessages((prev) => prev.filter((m) => m.id !== tempId));
        setNewMessage(messageContent);
      }
    } catch (error) {
      console.error("Failed to send message:", error);
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      setNewMessage(messageContent);
    } finally {
      setIsSending(false);
    }
  };

  // Handle key press
  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // Format timestamp
  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) {
      return `Today at ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
    } else if (days === 1) {
      return `Yesterday at ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
    }
    return date.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
  };

  // Group messages by author and time
  const groupMessages = (messages: Message[]) => {
    const groups: { messages: Message[]; author: User; timestamp: string }[] = [];
    
    messages.forEach((message, index) => {
      const prevMessage = messages[index - 1];
      const isSameAuthor = prevMessage?.authorId === message.authorId;
      const timeDiff = prevMessage 
        ? new Date(message.createdAt).getTime() - new Date(prevMessage.createdAt).getTime()
        : Infinity;
      const isWithinTimeWindow = timeDiff < 5 * 60 * 1000; // 5 minutes

      if (isSameAuthor && isWithinTimeWindow) {
        groups[groups.length - 1].messages.push(message);
      } else {
        groups.push({
          messages: [message],
          author: message.author,
          timestamp: message.createdAt,
        });
      }
    });

    return groups;
  };

  const messageGroups = groupMessages(messages);

  // Show loading while checking auth
  if (authLoading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[#0a0a0a]">
        <Loader2 className="w-8 h-8 text-[#8B5CF6] animate-spin" />
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <div className="flex-1 flex bg-[#0a0a0a]">
      {/* Main chat area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="h-12 min-h-12 px-4 flex items-center justify-between border-b border-[#1a1a1a] bg-[#0a0a0a]">
          <div className="flex items-center gap-3">
            <Link
              href="/channels/me"
              className="p-1.5 hover:bg-[#111111] rounded-md transition-colors"
            >
              <ArrowLeft className="w-5 h-5 text-[#888888]" />
            </Link>
            
            <div className="relative">
              <Avatar className="w-8 h-8">
                <AvatarImage src={recipient?.avatar} />
                <AvatarFallback className="bg-[#8B5CF6] text-white text-sm">
                  {(recipient?.displayName || recipient?.username || "?").charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div
                className="absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-[#0a0a0a]"
                style={{ backgroundColor: statusColors[recipient?.status || "offline"] }}
              />
            </div>
            
            <div className="flex items-center gap-2">
              <span className="font-semibold text-white">
                {recipient?.displayName || recipient?.username || "Loading..."}
              </span>
              {recipient?.isPremium && (
                <Crown className="w-4 h-4 text-[#8B5CF6]" />
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button className="p-2 text-[#888888] hover:text-white transition-colors rounded-md hover:bg-[#111111]">
              <Phone className="w-5 h-5" />
            </button>
            <button className="p-2 text-[#888888] hover:text-white transition-colors rounded-md hover:bg-[#111111]">
              <Video className="w-5 h-5" />
            </button>
            <button className="p-2 text-[#888888] hover:text-white transition-colors rounded-md hover:bg-[#111111]">
              <Pin className="w-5 h-5" />
            </button>
            <button
              onClick={() => setShowUserProfile(!showUserProfile)}
              className={cn(
                "p-2 transition-colors rounded-md hover:bg-[#111111]",
                showUserProfile ? "text-white" : "text-[#888888] hover:text-white"
              )}
            >
              <Users className="w-5 h-5" />
            </button>
            <div className="relative">
              <Input
                placeholder="Search"
                className="h-7 w-32 bg-[#111111] border-none text-white placeholder:text-[#555555] text-sm rounded focus-visible:ring-0"
              />
              <Search className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-[#555555]" />
            </div>
            <button className="p-2 text-[#888888] hover:text-white transition-colors rounded-md hover:bg-[#111111]">
              <Inbox className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Messages area */}
        <ScrollArea className="flex-1">
          <div className="flex flex-col min-h-full">
            {/* Welcome message */}
            <div className="flex-1" />
            <div className="px-4 py-6">
              <div className="flex flex-col items-start gap-2 mb-6">
                <Avatar className="w-20 h-20">
                  <AvatarImage src={recipient?.avatar} />
                  <AvatarFallback className="bg-[#8B5CF6] text-white text-2xl">
                    {(recipient?.displayName || recipient?.username || "?").charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <h2 className="text-2xl font-bold text-white">
                  {recipient?.displayName || recipient?.username}
                </h2>
                <p className="text-[#888888]">
                  This is the beginning of your direct message history with{" "}
                  <span className="font-semibold text-white">
                    {recipient?.displayName || recipient?.username}
                  </span>
                </p>
              </div>

              {/* Messages */}
              {isLoading ? (
                <div className="flex items-center justify-center py-10">
                  <Loader2 className="w-8 h-8 text-[#8B5CF6] animate-spin" />
                </div>
              ) : (
                <div className="space-y-4">
                  {messageGroups.map((group, groupIndex) => (
                    <div key={groupIndex} className="group/message hover:bg-[#111111]/50 -mx-4 px-4 py-0.5 rounded">
                      <div className="flex gap-4">
                        <Avatar className="w-10 h-10 mt-0.5 flex-shrink-0">
                          <AvatarImage src={group.author.avatar} />
                          <AvatarFallback className="bg-[#8B5CF6] text-white">
                            {(group.author.displayName || group.author.username).charAt(0).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-baseline gap-2">
                            <span className="font-medium text-white hover:underline cursor-pointer">
                              {group.author.displayName || group.author.username}
                            </span>
                            {group.author.isPremium && (
                              <Crown className="w-3.5 h-3.5 text-[#8B5CF6]" />
                            )}
                            <span className="text-xs text-[#666666]">
                              {formatTime(group.timestamp)}
                            </span>
                          </div>
                          {group.messages.map((message) => (
                            <div key={message.id} className="text-[#dcddde] break-words">
                              {message.content}
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          </div>
        </ScrollArea>

        {/* Message input */}
        <div className="p-4 pt-0">
          <div className="relative bg-[#111111] rounded-lg">
            <div className="flex items-center px-4 py-2">
              <button className="p-1.5 text-[#888888] hover:text-white transition-colors rounded hover:bg-[#1a1a1a]">
                <Plus className="w-5 h-5" />
              </button>
              
              <input
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                onKeyDown={handleKeyPress}
                placeholder={`Message @${recipient?.displayName || recipient?.username || "..."}`}
                className="flex-1 bg-transparent text-white placeholder:text-[#666666] px-3 py-1 focus:outline-none"
              />

              <div className="flex items-center gap-1">
                <button className="p-1.5 text-[#888888] hover:text-white transition-colors rounded hover:bg-[#1a1a1a]">
                  <Gift className="w-5 h-5" />
                </button>
                <button className="p-1.5 text-[#888888] hover:text-white transition-colors rounded hover:bg-[#1a1a1a]">
                  <ImageIcon className="w-5 h-5" />
                </button>
                <button className="p-1.5 text-[#888888] hover:text-white transition-colors rounded hover:bg-[#1a1a1a]">
                  <Smile className="w-5 h-5" />
                </button>
                <button
                  onClick={sendMessage}
                  disabled={!newMessage.trim() || isSending}
                  className={cn(
                    "p-1.5 rounded transition-colors",
                    newMessage.trim() && !isSending
                      ? "text-[#8B5CF6] hover:text-white hover:bg-[#8B5CF6]"
                      : "text-[#555555] cursor-not-allowed"
                  )}
                >
                  {isSending ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <Send className="w-5 h-5" />
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* User profile sidebar */}
      {showUserProfile && recipient && (
        <div className="w-[340px] bg-[#0a0a0a] border-l border-[#1a1a1a] hidden lg:flex flex-col">
          {/* Banner/Header */}
          <div className="h-[120px] bg-[#8B5CF6] relative">
            {recipient.isPremium && (
              <div className="absolute top-2 right-2 px-2 py-1 bg-black/40 rounded-full flex items-center gap-1">
                <Crown className="w-3 h-3 text-[#8B5CF6]" />
                <span className="text-xs text-white font-medium">Serika+</span>
              </div>
            )}
          </div>

          {/* Avatar */}
          <div className="px-4 relative">
            <div className="absolute -top-16">
              <div className="relative">
                <Avatar className="w-24 h-24 border-[6px] border-[#0a0a0a]">
                  <AvatarImage src={recipient.avatar} />
                  <AvatarFallback className="bg-[#8B5CF6] text-white text-2xl">
                    {(recipient.displayName || recipient.username).charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div
                  className="absolute bottom-1 right-1 w-6 h-6 rounded-full border-4 border-[#0a0a0a]"
                  style={{ backgroundColor: statusColors[recipient.status] }}
                />
              </div>
            </div>
          </div>

          {/* User info */}
          <div className="pt-12 px-4">
            <div className="bg-[#111111] rounded-lg p-4">
              <div className="flex items-center gap-2 mb-1">
                <h3 className="text-xl font-bold text-white">
                  {recipient.displayName || recipient.username}
                </h3>
                {recipient.isPremium && (
                  <Crown className="w-5 h-5 text-[#8B5CF6]" />
                )}
              </div>
              <p className="text-sm text-[#888888]">{recipient.username}</p>
              
              {recipient.customStatus && (
                <p className="text-sm text-[#888888] mt-2">
                  {recipient.customStatus}
                </p>
              )}

              <div className="h-px bg-[#222222] my-4" />

              {recipient.bio && (
                <>
                  <h4 className="text-xs font-semibold uppercase text-[#888888] mb-2">
                    About Me
                  </h4>
                  <p className="text-sm text-[#dcddde]">{recipient.bio}</p>
                  <div className="h-px bg-[#222222] my-4" />
                </>
              )}

              <h4 className="text-xs font-semibold uppercase text-[#888888] mb-2">
                SerikaCord Member Since
              </h4>
              <p className="text-sm text-[#dcddde]">
                {recipient.createdAt
                  ? new Date(recipient.createdAt).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })
                  : "Unknown"}
              </p>
            </div>
          </div>

          {/* Note section */}
          <div className="px-4 mt-4">
            <div className="bg-[#111111] rounded-lg p-4">
              <h4 className="text-xs font-semibold uppercase text-[#888888] mb-2">
                Note
              </h4>
              <textarea
                placeholder="Click to add a note"
                className="w-full bg-transparent text-sm text-[#dcddde] placeholder:text-[#555555] resize-none focus:outline-none"
                rows={2}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

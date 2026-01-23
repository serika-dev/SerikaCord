"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useServer } from "@/contexts/ServerContext";
import { useAuth } from "@/contexts/AuthContext";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import {
  Hash,
  Bell,
  Pin,
  Users,
  Search,
  Inbox,
  HelpCircle,
  PlusCircle,
  Gift,
  Sticker,
  Smile,
  SendHorizontal,
  ChevronLeft,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface Message {
  id: string;
  content: string;
  authorId: string;
  author: {
    id: string;
    username: string;
    displayName: string;
    avatar?: string;
  };
  channelId: string;
  createdAt: string;
  updatedAt: string;
  attachments?: Array<{
    id: string;
    url: string;
    filename: string;
    contentType: string;
  }>;
}

interface ChatAreaProps {
  onToggleMembers?: () => void;
  showMembers?: boolean;
}

export function ChatArea({ onToggleMembers, showMembers }: ChatAreaProps) {
  const { currentChannel, currentServer } = useServer();
  const { user } = useAuth();
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Detect mobile
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const fetchMessages = useCallback(async () => {
    if (!currentChannel) return;

    setIsLoading(true);
    try {
      const response = await fetch(`/api/channels/${currentChannel.id}/messages`);
      if (response.ok) {
        const data = await response.json();
        setMessages(data);
      }
    } catch (error) {
      console.error("Failed to fetch messages:", error);
    } finally {
      setIsLoading(false);
    }
  }, [currentChannel]);

  useEffect(() => {
    fetchMessages();
  }, [fetchMessages]);

  // Real-time SSE connection
  useEffect(() => {
    if (!currentChannel) return;

    const eventSource = new EventSource(`/api/channels/${currentChannel.id}/stream`, {
      withCredentials: true,
    });

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        
        if (data.type === 'message') {
          setMessages((prev) => {
            // Check if message already exists (avoid duplicates from optimistic updates)
            const exists = prev.some((m) => m.id === data.message.id || m.id === data.message._id);
            if (exists) return prev;
            
            // Transform message format if needed
            const newMessage = {
              id: data.message._id || data.message.id,
              content: data.message.content,
              authorId: data.message.authorId?._id || data.message.authorId,
              author: data.message.authorId && typeof data.message.authorId === 'object' ? {
                id: data.message.authorId._id,
                username: data.message.authorId.username,
                displayName: data.message.authorId.displayName,
                avatar: data.message.authorId.avatar,
              } : data.message.author,
              channelId: data.message.channelId,
              createdAt: data.message.createdAt,
              updatedAt: data.message.updatedAt,
              attachments: data.message.attachments,
            };
            return [...prev, newMessage];
          });
        } else if (data.type === 'delete') {
          setMessages((prev) => prev.filter((m) => m.id !== data.messageId));
        } else if (data.type === 'typing') {
          // TODO: Show typing indicator
          console.log(`${data.username} is typing...`);
        }
      } catch (error) {
        console.error("Failed to parse SSE data:", error);
      }
    };

    eventSource.onerror = () => {
      console.error("SSE connection error, reconnecting...");
      eventSource.close();
    };

    return () => {
      eventSource.close();
    };
  }, [currentChannel]);

  useEffect(() => {
    // Scroll to bottom when messages change
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSendMessage = async () => {
    if (!newMessage.trim() || !currentChannel) return;

    const messageContent = newMessage;
    setNewMessage("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "44px";
    }

    try {
      const response = await fetch(`/api/channels/${currentChannel.id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: messageContent }),
      });

      if (!response.ok) {
        // Restore message on error
        setNewMessage(messageContent);
        console.error("Failed to send message");
      }
      // Don't add message here - SSE will deliver it
    } catch (error) {
      // Restore message on error
      setNewMessage(messageContent);
      console.error("Failed to send message:", error);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setNewMessage(e.target.value);
    // Auto-resize textarea
    if (textareaRef.current) {
      textareaRef.current.style.height = "44px";
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 300) + "px";
    }
  };

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    
    if (isToday) {
      return `Today at ${date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
    }
    
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    if (date.toDateString() === yesterday.toDateString()) {
      return `Yesterday at ${date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
    }
    
    return date.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" }) +
      ` at ${date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
  };

  // Group messages by author and time proximity
  const groupedMessages = messages.reduce((groups, message, index) => {
    const prevMessage = messages[index - 1];
    const isGrouped =
      prevMessage &&
      prevMessage.authorId === message.authorId &&
      new Date(message.createdAt).getTime() - new Date(prevMessage.createdAt).getTime() < 5 * 60 * 1000;

    if (isGrouped) {
      groups[groups.length - 1].messages.push(message);
    } else {
      groups.push({ author: message.author, messages: [message] });
    }

    return groups;
  }, [] as Array<{ author: Message["author"]; messages: Message[] }>);

  if (!currentChannel) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-[#0a0a0a] text-[#666666]">
        <div className="w-40 h-40 mb-4 rounded-full bg-[#111111] flex items-center justify-center">
          <Hash className="w-20 h-20 text-[#8B5CF6]" />
        </div>
        <h2 className="text-xl font-semibold text-white mb-2">
          {currentServer ? "Select a channel" : "Welcome to SerikaCord"}
        </h2>
        <p className="text-center max-w-md">
          {currentServer
            ? "Choose a channel from the sidebar to start chatting."
            : "Select a server or start a direct message to begin."}
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-[#0a0a0a] min-w-0">
      {/* Channel Header */}
      <div className="h-12 px-2 sm:px-4 flex items-center justify-between border-b border-[#1a1a1a] flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          {/* Mobile back button */}
          {isMobile && (
            <button
              onClick={() => router.push(`/channels/${currentServer?.id}`)}
              className="p-2 -ml-1 rounded-lg hover:bg-[#1a1a1a] transition-colors"
            >
              <ChevronLeft className="w-5 h-5 text-[#888888]" />
            </button>
          )}
          <Hash className="w-5 sm:w-6 h-5 sm:h-6 text-[#555555] flex-shrink-0" />
          <span className="font-semibold text-white truncate text-sm sm:text-base">{currentChannel.name}</span>
        </div>
        <div className="flex items-center gap-2 sm:gap-4 text-[#888888]">
          <button className="hover:text-white transition-colors hidden sm:block">
            <Bell className="w-5 h-5" />
          </button>
          <button className="hover:text-white transition-colors hidden sm:block">
            <Pin className="w-5 h-5" />
          </button>
          <button
            onClick={onToggleMembers}
            className={cn(
              "hover:text-white transition-colors",
              showMembers && "text-white"
            )}
          >
            <Users className="w-5 h-5" />
          </button>
          <div className="h-6 w-px bg-[#222222] hidden md:block" />
          <div className="relative hidden md:block">
            <input
              type="text"
              placeholder="Search"
              className="w-32 h-6 px-2 rounded bg-[#111111] text-sm text-white placeholder:text-[#666666] focus:outline-none focus:w-48 transition-all"
            />
            <Search className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-[#666666]" />
          </div>
          <button className="hover:text-white transition-colors hidden sm:block">
            <Inbox className="w-5 h-5" />
          </button>
          <button className="hover:text-white transition-colors hidden sm:block">
            <HelpCircle className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Messages Area */}
      <ScrollArea className="flex-1" ref={scrollRef}>
        <div className="flex flex-col py-4">
          {/* Channel Welcome */}
          <div className="px-4 pb-4 mb-4 border-b border-[#1a1a1a]">
            <div className="w-16 h-16 mb-2 rounded-full bg-[#111111] flex items-center justify-center">
              <Hash className="w-10 h-10 text-white" />
            </div>
            <h1 className="text-3xl font-bold text-white mb-2">
              Welcome to #{currentChannel.name}!
            </h1>
            <p className="text-[#666666]">
              This is the start of the #{currentChannel.name} channel.
            </p>
          </div>

          {/* Messages */}
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="w-8 h-8 border-2 border-[#8B5CF6] border-t-transparent rounded-full animate-spin" />
            </div>
          ) : groupedMessages.length === 0 ? (
            <div className="text-center text-[#666666] py-8">
              No messages yet. Be the first to say something!
            </div>
          ) : (
            groupedMessages.map((group, groupIndex) => (
              <div
                key={groupIndex}
                className="group px-4 py-0.5 hover:bg-[#111111] message-hover"
              >
                <div className="flex gap-4">
                  {/* Avatar (only show for first message in group) */}
                  <div className="w-10 flex-shrink-0">
                    {group.messages[0] === group.messages[0] && (
                      <Avatar className="w-10 h-10 mt-0.5">
                        <AvatarImage src={group.author.avatar} alt={group.author.displayName} />
                        <AvatarFallback className="bg-[#8B5CF6] text-white">
                          {group.author.displayName.charAt(0).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    {/* Header (only show for first message in group) */}
                    <div className="flex items-baseline gap-2 mb-1">
                      <span className="font-medium text-white hover:underline cursor-pointer">
                        {group.author.displayName}
                      </span>
                      <span className="text-xs text-[#666666]">
                        {formatTimestamp(group.messages[0].createdAt)}
                      </span>
                    </div>

                    {/* Messages */}
                    {group.messages.map((message) => (
                      <div key={message.id} className="text-[#888888] leading-relaxed">
                        {message.content}
                        {message.attachments?.map((attachment) => (
                          <div key={attachment.id} className="mt-2">
                            {attachment.contentType.startsWith("image/") ? (
                              <img
                                src={attachment.url}
                                alt={attachment.filename}
                                className="max-w-md max-h-80 rounded-md"
                              />
                            ) : (
                              <a
                                href={attachment.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[#8B5CF6] hover:underline"
                              >
                                {attachment.filename}
                              </a>
                            )}
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </ScrollArea>

      {/* Message Input */}
      <div className="px-2 sm:px-4 pb-4 sm:pb-6 flex-shrink-0">
        <div className="relative bg-[#111111] rounded-lg border border-[#1a1a1a]">
          <button className="absolute left-2 sm:left-4 top-1/2 -translate-y-1/2 text-[#888888] hover:text-white transition-colors">
            <PlusCircle className="w-5 sm:w-6 h-5 sm:h-6" />
          </button>
          <Textarea
            ref={textareaRef}
            value={newMessage}
            onChange={handleTextareaChange}
            onKeyDown={handleKeyDown}
            placeholder={`Message #${currentChannel.name}`}
            className="w-full min-h-[44px] max-h-[300px] py-2.5 pl-10 sm:pl-14 pr-24 sm:pr-36 bg-transparent border-none text-white placeholder:text-[#555555] resize-none focus-visible:ring-0 focus-visible:ring-offset-0 text-sm sm:text-base"
            rows={1}
          />
          <div className="absolute right-2 sm:right-4 top-1/2 -translate-y-1/2 flex items-center gap-2 sm:gap-4 text-[#888888]">
            <button className="hover:text-white transition-colors hidden sm:block">
              <Gift className="w-6 h-6" />
            </button>
            <button className="hover:text-white transition-colors hidden sm:block">
              <Sticker className="w-6 h-6" />
            </button>
            <button className="hover:text-white transition-colors">
              <Smile className="w-5 sm:w-6 h-5 sm:h-6" />
            </button>
            {newMessage.trim() && (
              <button
                onClick={handleSendMessage}
                className="text-[#8B5CF6] hover:text-[#A78BFA] transition-colors"
              >
                <SendHorizontal className="w-5 sm:w-6 h-5 sm:h-6" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

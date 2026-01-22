"use client";

import { useState, useEffect, useRef, useCallback } from "react";
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
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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

  useEffect(() => {
    // Scroll to bottom when messages change
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSendMessage = async () => {
    if (!newMessage.trim() || !currentChannel) return;

    try {
      const response = await fetch(`/api/channels/${currentChannel.id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: newMessage }),
      });

      if (response.ok) {
        const message = await response.json();
        setMessages((prev) => [...prev, message]);
        setNewMessage("");
        if (textareaRef.current) {
          textareaRef.current.style.height = "44px";
        }
      }
    } catch (error) {
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
      <div className="flex-1 flex flex-col items-center justify-center bg-[#313338] text-[#949ba4]">
        <div className="w-40 h-40 mb-4 rounded-full bg-[#404249] flex items-center justify-center">
          <Hash className="w-20 h-20 text-[#5865F2]" />
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
    <div className="flex-1 flex flex-col bg-[#313338] min-w-0">
      {/* Channel Header */}
      <div className="h-12 px-4 flex items-center justify-between border-b border-[#1f2023] shadow-sm flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <Hash className="w-6 h-6 text-[#80848e] flex-shrink-0" />
          <span className="font-semibold text-white truncate">{currentChannel.name}</span>
        </div>
        <div className="flex items-center gap-4 text-[#b5bac1]">
          <button className="hover:text-white transition-colors">
            <Bell className="w-5 h-5" />
          </button>
          <button className="hover:text-white transition-colors">
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
          <div className="h-6 w-px bg-[#3f4147]" />
          <div className="relative">
            <input
              type="text"
              placeholder="Search"
              className="w-32 h-6 px-2 rounded bg-[#1e1f22] text-sm text-white placeholder:text-[#949ba4] focus:outline-none focus:w-48 transition-all"
            />
            <Search className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-[#949ba4]" />
          </div>
          <button className="hover:text-white transition-colors">
            <Inbox className="w-5 h-5" />
          </button>
          <button className="hover:text-white transition-colors">
            <HelpCircle className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Messages Area */}
      <ScrollArea className="flex-1" ref={scrollRef}>
        <div className="flex flex-col py-4">
          {/* Channel Welcome */}
          <div className="px-4 pb-4 mb-4 border-b border-[#3f4147]">
            <div className="w-16 h-16 mb-2 rounded-full bg-[#404249] flex items-center justify-center">
              <Hash className="w-10 h-10 text-white" />
            </div>
            <h1 className="text-3xl font-bold text-white mb-2">
              Welcome to #{currentChannel.name}!
            </h1>
            <p className="text-[#949ba4]">
              This is the start of the #{currentChannel.name} channel.
            </p>
          </div>

          {/* Messages */}
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="w-8 h-8 border-2 border-[#5865F2] border-t-transparent rounded-full animate-spin" />
            </div>
          ) : groupedMessages.length === 0 ? (
            <div className="text-center text-[#949ba4] py-8">
              No messages yet. Be the first to say something!
            </div>
          ) : (
            groupedMessages.map((group, groupIndex) => (
              <div
                key={groupIndex}
                className="group px-4 py-0.5 hover:bg-[#2e3035] message-hover"
              >
                <div className="flex gap-4">
                  {/* Avatar (only show for first message in group) */}
                  <div className="w-10 flex-shrink-0">
                    {group.messages[0] === group.messages[0] && (
                      <Avatar className="w-10 h-10 mt-0.5">
                        <AvatarImage src={group.author.avatar} alt={group.author.displayName} />
                        <AvatarFallback className="bg-[#5865F2] text-white">
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
                      <span className="text-xs text-[#949ba4]">
                        {formatTimestamp(group.messages[0].createdAt)}
                      </span>
                    </div>

                    {/* Messages */}
                    {group.messages.map((message) => (
                      <div key={message.id} className="text-[#dbdee1] leading-relaxed">
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
                                className="text-[#00a8fc] hover:underline"
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
      <div className="px-4 pb-6 flex-shrink-0">
        <div className="relative bg-[#383a40] rounded-lg">
          <button className="absolute left-4 top-1/2 -translate-y-1/2 text-[#b5bac1] hover:text-[#dbdee1] transition-colors">
            <PlusCircle className="w-6 h-6" />
          </button>
          <Textarea
            ref={textareaRef}
            value={newMessage}
            onChange={handleTextareaChange}
            onKeyDown={handleKeyDown}
            placeholder={`Message #${currentChannel.name}`}
            className="w-full min-h-[44px] max-h-[300px] py-2.5 pl-14 pr-36 bg-transparent border-none text-[#dbdee1] placeholder:text-[#6d6f78] resize-none focus-visible:ring-0 focus-visible:ring-offset-0"
            rows={1}
          />
          <div className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center gap-4 text-[#b5bac1]">
            <button className="hover:text-[#dbdee1] transition-colors">
              <Gift className="w-6 h-6" />
            </button>
            <button className="hover:text-[#dbdee1] transition-colors">
              <Sticker className="w-6 h-6" />
            </button>
            <button className="hover:text-[#dbdee1] transition-colors">
              <Smile className="w-6 h-6" />
            </button>
            {newMessage.trim() && (
              <button
                onClick={handleSendMessage}
                className="text-[#5865F2] hover:text-[#7983f5] transition-colors"
              >
                <SendHorizontal className="w-6 h-6" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useServer } from "@/contexts/ServerContext";
import { useAuth } from "@/contexts/AuthContext";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  MoreHorizontal,
  Pencil,
  Trash2,
  Copy,
  Reply,
  X,
  FileText,
  Loader2,
  Plus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import data from "@emoji-mart/data";
import Picker from "@emoji-mart/react";

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
  edited?: boolean;
  attachments?: Array<{
    id: string;
    url: string;
    filename: string;
    contentType: string;
    size?: number;
  }>;
  reactions?: Array<{
    emoji: {
      id?: string;
      name: string;
      animated?: boolean;
    };
    count: number;
    userIds: string[];
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
  const [isSending, setIsSending] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttempts = useRef(0);

  // Edit state
  const [editingMessage, setEditingMessage] = useState<Message | null>(null);
  const [editContent, setEditContent] = useState("");

  // Delete confirmation
  const [deleteConfirmMessage, setDeleteConfirmMessage] = useState<Message | null>(null);

  // Attachment state
  const [attachments, setAttachments] = useState<File[]>([]);
  const [attachmentPreviews, setAttachmentPreviews] = useState<string[]>([]);
  const [isUploading, setIsUploading] = useState(false);

  // Emoji picker
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);

  // Reaction picker
  const [reactionPickerMessage, setReactionPickerMessage] = useState<string | null>(null);

  // Typing indicator
  const [typingUsers, setTypingUsers] = useState<string[]>([]);

  // Detect mobile
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  const fetchMessages = useCallback(async () => {
    if (!currentChannel) return;

    setIsLoading(true);
    try {
      const response = await fetch(`/api/channels/${currentChannel.id}/messages`);
      if (response.ok) {
        const data = await response.json();
        const messagesArray = Array.isArray(data) ? data : data.messages || [];
        setMessages(messagesArray);
      } else {
        toast.error("Failed to load messages");
      }
    } catch (error) {
      console.error("Failed to fetch messages:", error);
      toast.error("Failed to load messages");
    } finally {
      setIsLoading(false);
    }
  }, [currentChannel]);

  useEffect(() => {
    fetchMessages();
  }, [fetchMessages]);

  // SSE connection with reconnection logic
  const connectSSE = useCallback(() => {
    if (!currentChannel) return;

    // Clean up existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const eventSource = new EventSource(`/api/channels/${currentChannel.id}/stream`, {
      withCredentials: true,
    });

    eventSource.onopen = () => {
      reconnectAttempts.current = 0;
    };

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === "message") {
          setMessages((prev) => {
            const msgId = data.message.id || data.message._id;
            const exists = prev.some((m) => m.id === msgId);
            if (exists) return prev;

            const author =
              data.message.author ||
              (data.message.authorId && typeof data.message.authorId === "object"
                ? {
                    id: data.message.authorId._id || data.message.authorId.id,
                    username: data.message.authorId.username,
                    displayName: data.message.authorId.displayName || data.message.authorId.username,
                    avatar: data.message.authorId.avatar,
                  }
                : null);

            const newMsg: Message = {
              id: msgId,
              content: data.message.content,
              authorId:
                typeof data.message.authorId === "object"
                  ? data.message.authorId._id || data.message.authorId.id
                  : data.message.authorId,
              author: author,
              channelId: data.message.channelId,
              createdAt: data.message.createdAt,
              updatedAt: data.message.updatedAt,
              edited: data.message.edited,
              attachments: data.message.attachments || [],
            };
            return [...prev, newMsg];
          });
        } else if (data.type === "edit") {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === data.messageId
                ? { ...m, content: data.content, edited: true, updatedAt: new Date().toISOString() }
                : m
            )
          );
        } else if (data.type === "delete") {
          setMessages((prev) => prev.filter((m) => m.id !== data.messageId));
        } else if (data.type === "typing") {
          setTypingUsers((prev) => {
            if (!prev.includes(data.username)) {
              return [...prev, data.username];
            }
            return prev;
          });
          // Remove typing indicator after 3 seconds
          setTimeout(() => {
            setTypingUsers((prev) => prev.filter((u) => u !== data.username));
          }, 3000);
        }
      } catch (error) {
        console.error("Failed to parse SSE data:", error);
      }
    };

    eventSource.onerror = () => {
      eventSource.close();

      // Reconnect with exponential backoff
      const backoffMs = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 30000);
      reconnectAttempts.current++;

      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }

      reconnectTimeoutRef.current = setTimeout(() => {
        if (currentChannel) {
          connectSSE();
        }
      }, backoffMs);
    };

    eventSourceRef.current = eventSource;
  }, [currentChannel]);

  useEffect(() => {
    connectSSE();

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, [connectSSE]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // File upload handling
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    // Limit to 10 files
    const newFiles = files.slice(0, 10 - attachments.length);

    setAttachments((prev) => [...prev, ...newFiles]);

    // Generate previews
    newFiles.forEach((file) => {
      if (file.type.startsWith("image/")) {
        const reader = new FileReader();
        reader.onload = () => {
          setAttachmentPreviews((prev) => [...prev, reader.result as string]);
        };
        reader.readAsDataURL(file);
      } else {
        setAttachmentPreviews((prev) => [...prev, ""]);
      }
    });

    // Clear input
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
    setAttachmentPreviews((prev) => prev.filter((_, i) => i !== index));
  };

  const uploadAttachments = async (): Promise<Array<{ id: string; url: string; filename: string; contentType: string }>> => {
    const uploadedAttachments: Array<{ id: string; url: string; filename: string; contentType: string }> = [];

    for (const file of attachments) {
      const formData = new FormData();
      formData.append("file", file);
      if (currentChannel) {
        formData.append("channelId", currentChannel.id);
      }

      try {
        const response = await fetch("/api/upload/attachment", {
          method: "POST",
          body: formData,
        });

        if (response.ok) {
          const data = await response.json();
          uploadedAttachments.push(data.attachment);
        } else {
          toast.error(`Failed to upload ${file.name}`);
        }
      } catch (error) {
        toast.error(`Failed to upload ${file.name}`);
      }
    }

    return uploadedAttachments;
  };

  const handleSendMessage = async () => {
    if ((!newMessage.trim() && attachments.length === 0) || !currentChannel) return;

    const messageContent = newMessage;
    setNewMessage("");
    setIsSending(true);

    if (textareaRef.current) {
      textareaRef.current.style.height = "44px";
    }

    try {
      let uploadedAttachments: Array<{ id: string; url: string; filename: string; contentType: string }> = [];

      if (attachments.length > 0) {
        setIsUploading(true);
        uploadedAttachments = await uploadAttachments();
        setIsUploading(false);
        setAttachments([]);
        setAttachmentPreviews([]);
      }

      const response = await fetch(`/api/channels/${currentChannel.id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: messageContent,
          attachments: uploadedAttachments,
        }),
      });

      if (!response.ok) {
        setNewMessage(messageContent);
        toast.error("Failed to send message");
      }
    } catch (error) {
      setNewMessage(messageContent);
      toast.error("Failed to send message");
    } finally {
      setIsSending(false);
    }
  };

  const handleEditMessage = async () => {
    if (!editingMessage || !editContent.trim()) return;

    try {
      const response = await fetch(`/api/channels/${editingMessage.channelId}/messages/${editingMessage.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: editContent }),
      });

      if (response.ok) {
        setMessages((prev) =>
          prev.map((m) => (m.id === editingMessage.id ? { ...m, content: editContent, edited: true } : m))
        );
        toast.success("Message edited");
        setEditingMessage(null);
        setEditContent("");
      } else {
        toast.error("Failed to edit message");
      }
    } catch (error) {
      toast.error("Failed to edit message");
    }
  };

  const handleDeleteMessage = async () => {
    if (!deleteConfirmMessage) return;

    try {
      const response = await fetch(
        `/api/channels/${deleteConfirmMessage.channelId}/messages/${deleteConfirmMessage.id}`,
        { method: "DELETE" }
      );

      if (response.ok) {
        setMessages((prev) => prev.filter((m) => m.id !== deleteConfirmMessage.id));
        toast.success("Message deleted");
        setDeleteConfirmMessage(null);
      } else {
        toast.error("Failed to delete message");
      }
    } catch (error) {
      toast.error("Failed to delete message");
    }
  };

  const handleCopyMessage = (content: string) => {
    navigator.clipboard.writeText(content);
    toast.success("Copied to clipboard");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleEditKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleEditMessage();
    }
    if (e.key === "Escape") {
      setEditingMessage(null);
      setEditContent("");
    }
  };

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setNewMessage(e.target.value);
    if (textareaRef.current) {
      textareaRef.current.style.height = "44px";
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 300) + "px";
    }
  };

  const handleEmojiSelect = (emoji: { native: string }) => {
    setNewMessage((prev) => prev + emoji.native);
    setShowEmojiPicker(false);
    textareaRef.current?.focus();
  };

  const handleAddReaction = async (messageId: string, emoji: string) => {
    if (!currentChannel) return;
    
    try {
      const encodedEmoji = encodeURIComponent(emoji);
      const response = await fetch(
        `/api/channels/${currentChannel.id}/messages/${messageId}/reactions/${encodedEmoji}/@me`,
        { method: "PUT" }
      );

      if (response.ok) {
        // Update local state
        setMessages((prev) =>
          prev.map((msg) => {
            if (msg.id !== messageId) return msg;
            
            const reactions = msg.reactions || [];
            const existingReaction = reactions.find((r) => r.emoji.name === emoji);
            
            if (existingReaction) {
              // Check if user already reacted
              if (!existingReaction.userIds.includes(user?.id || "")) {
                return {
                  ...msg,
                  reactions: reactions.map((r) =>
                    r.emoji.name === emoji
                      ? { ...r, count: r.count + 1, userIds: [...r.userIds, user?.id || ""] }
                      : r
                  ),
                };
              }
              return msg;
            } else {
              return {
                ...msg,
                reactions: [...reactions, { emoji: { name: emoji }, count: 1, userIds: [user?.id || ""] }],
              };
            }
          })
        );
      }
    } catch (error) {
      console.error("Failed to add reaction:", error);
    }
    setReactionPickerMessage(null);
  };

  const handleRemoveReaction = async (messageId: string, emoji: string) => {
    if (!currentChannel) return;
    
    try {
      const encodedEmoji = encodeURIComponent(emoji);
      const response = await fetch(
        `/api/channels/${currentChannel.id}/messages/${messageId}/reactions/${encodedEmoji}/@me`,
        { method: "DELETE" }
      );

      if (response.ok) {
        // Update local state
        setMessages((prev) =>
          prev.map((msg) => {
            if (msg.id !== messageId) return msg;
            
            const reactions = msg.reactions || [];
            return {
              ...msg,
              reactions: reactions
                .map((r) =>
                  r.emoji.name === emoji
                    ? {
                        ...r,
                        count: r.count - 1,
                        userIds: r.userIds.filter((id) => id !== user?.id),
                      }
                    : r
                )
                .filter((r) => r.count > 0),
            };
          })
        );
      }
    } catch (error) {
      console.error("Failed to remove reaction:", error);
    }
  };

  const handleReactionClick = (messageId: string, emoji: string, hasReacted: boolean) => {
    if (hasReacted) {
      handleRemoveReaction(messageId, emoji);
    } else {
      handleAddReaction(messageId, emoji);
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

    return (
      date.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" }) +
      ` at ${date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
    );
  };

  const formatFileSize = (bytes?: number) => {
    if (!bytes) return "";
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
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
    <div className="flex-1 flex flex-col bg-[#0a0a0a] min-w-0 min-h-0 overflow-hidden">
      {/* Channel Header */}
      <div className="h-12 px-2 sm:px-4 flex items-center justify-between border-b border-[#1a1a1a] flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
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
          <button className="hover:text-white transition-colors hidden sm:block" onClick={() => toast.info("Notifications coming soon")}>
            <Bell className="w-5 h-5" />
          </button>
          <button className="hover:text-white transition-colors hidden sm:block" onClick={() => toast.info("Pinned messages coming soon")}>
            <Pin className="w-5 h-5" />
          </button>
          <button
            onClick={onToggleMembers}
            className={cn("hover:text-white transition-colors", showMembers && "text-white")}
          >
            <Users className="w-5 h-5" />
          </button>
          <div className="h-6 w-px bg-[#222222] hidden md:block" />
          <div className="relative hidden md:block">
            <input
              type="text"
              placeholder="Search"
              className="w-32 h-6 px-2 rounded bg-[#111111] text-sm text-white placeholder:text-[#666666] focus:outline-none focus:w-48 transition-all"
              onFocus={() => toast.info("Search coming soon")}
            />
            <Search className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-[#666666]" />
          </div>
          <button className="hover:text-white transition-colors hidden sm:block" onClick={() => toast.info("Inbox coming soon")}>
            <Inbox className="w-5 h-5" />
          </button>
          <button className="hover:text-white transition-colors hidden sm:block" onClick={() => toast.info("Help coming soon")}>
            <HelpCircle className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Messages Area */}
      <ScrollArea className="flex-1 min-h-0" ref={scrollRef}>
        <div className="flex flex-col py-4">
          {/* Channel Welcome */}
          <div className="px-4 pb-4 mb-4 border-b border-[#1a1a1a]">
            <div className="w-16 h-16 mb-2 rounded-full bg-[#111111] flex items-center justify-center">
              <Hash className="w-10 h-10 text-white" />
            </div>
            <h1 className="text-3xl font-bold text-white mb-2">Welcome to #{currentChannel.name}!</h1>
            <p className="text-[#666666]">This is the start of the #{currentChannel.name} channel.</p>
          </div>

          {/* Messages */}
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="w-8 h-8 border-2 border-[#8B5CF6] border-t-transparent rounded-full animate-spin" />
            </div>
          ) : groupedMessages.length === 0 ? (
            <div className="text-center text-[#666666] py-8">No messages yet. Be the first to say something!</div>
          ) : (
            groupedMessages.map((group, groupIndex) => (
              <div key={groupIndex} className="group px-4 py-0.5 hover:bg-[#111111] message-hover">
                <div className="flex gap-4">
                  <div className="w-10 flex-shrink-0">
                    <Avatar className="w-10 h-10 mt-0.5">
                      <AvatarImage src={group.author?.avatar} alt={group.author?.displayName} />
                      <AvatarFallback className="bg-[#8B5CF6] text-white">
                        {group.author?.displayName?.charAt(0).toUpperCase() || "?"}
                      </AvatarFallback>
                    </Avatar>
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2 mb-1">
                      <span className="font-medium text-white hover:underline cursor-pointer">
                        {group.author?.displayName || "Unknown"}
                      </span>
                      <span className="text-xs text-[#666666]">{formatTimestamp(group.messages[0].createdAt)}</span>
                    </div>

                    {group.messages.map((message) => (
                      <div key={message.id} className="group/message relative">
                        {editingMessage?.id === message.id ? (
                          <div className="bg-[#1a1a1a] rounded-md p-2 mb-1">
                            <Textarea
                              value={editContent}
                              onChange={(e) => setEditContent(e.target.value)}
                              onKeyDown={handleEditKeyDown}
                              className="bg-[#0a0a0a] border-[#2a2a2a] text-white min-h-[40px] mb-2"
                              autoFocus
                            />
                            <div className="flex items-center gap-2 text-xs">
                              <span className="text-[#888888]">
                                escape to{" "}
                                <button
                                  onClick={() => {
                                    setEditingMessage(null);
                                    setEditContent("");
                                  }}
                                  className="text-[#8B5CF6] hover:underline"
                                >
                                  cancel
                                </button>{" "}
                                • enter to{" "}
                                <button onClick={handleEditMessage} className="text-[#8B5CF6] hover:underline">
                                  save
                                </button>
                              </span>
                            </div>
                          </div>
                        ) : (
                          <>
                            <div className="text-[#888888] leading-relaxed">
                              {message.content}
                              {message.edited && <span className="text-xs text-[#555555] ml-1">(edited)</span>}
                            </div>

                            {/* Attachments */}
                            {message.attachments?.map((attachment) => (
                              <div key={attachment.id} className="mt-2">
                                {attachment.contentType.startsWith("image/") ? (
                                  <img
                                    src={attachment.url}
                                    alt={attachment.filename}
                                    className="max-w-md max-h-80 rounded-md cursor-pointer hover:opacity-90"
                                    onClick={() => window.open(attachment.url, "_blank")}
                                  />
                                ) : (
                                  <a
                                    href={attachment.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex items-center gap-2 p-3 bg-[#1a1a1a] rounded-md hover:bg-[#222222] max-w-sm"
                                  >
                                    <FileText className="w-8 h-8 text-[#8B5CF6]" />
                                    <div className="min-w-0">
                                      <div className="text-[#8B5CF6] hover:underline truncate">{attachment.filename}</div>
                                      <div className="text-xs text-[#666666]">{formatFileSize(attachment.size)}</div>
                                    </div>
                                  </a>
                                )}
                              </div>
                            ))}

                            {/* Reactions Display */}
                            {message.reactions && message.reactions.length > 0 && (
                              <div className="flex flex-wrap gap-1 mt-1">
                                {message.reactions.map((reaction) => {
                                  const hasReacted = reaction.userIds.includes(user?.id || "");
                                  return (
                                    <button
                                      key={reaction.emoji.name}
                                      onClick={() => handleReactionClick(message.id, reaction.emoji.name, hasReacted)}
                                      className={cn(
                                        "flex items-center gap-1 px-2 py-0.5 rounded-full text-sm transition-colors",
                                        hasReacted
                                          ? "bg-[#8B5CF6]/20 border border-[#8B5CF6] text-white"
                                          : "bg-[#1a1a1a] border border-[#2a2a2a] text-[#888888] hover:bg-[#222222]"
                                      )}
                                    >
                                      <span>{reaction.emoji.name}</span>
                                      <span className={hasReacted ? "text-white" : "text-[#666666]"}>{reaction.count}</span>
                                    </button>
                                  );
                                })}
                                <button
                                  onClick={() => setReactionPickerMessage(message.id)}
                                  className="flex items-center justify-center w-7 h-7 rounded-full bg-[#1a1a1a] border border-[#2a2a2a] text-[#666666] hover:bg-[#222222] hover:text-white transition-colors"
                                >
                                  <Plus className="w-4 h-4" />
                                </button>
                              </div>
                            )}

                            {/* Message Actions */}
                            <div className="absolute -top-3 right-0 opacity-0 group-hover/message:opacity-100 transition-opacity z-10">
                              <div className="flex items-center bg-[#1a1a1a] border border-[#2a2a2a] rounded-md shadow-lg">
                                <Popover 
                                  open={reactionPickerMessage === message.id}
                                  onOpenChange={(open) => setReactionPickerMessage(open ? message.id : null)}
                                >
                                  <PopoverTrigger asChild>
                                    <button
                                      className="p-1.5 hover:bg-[#2a2a2a] rounded-l-md transition-colors"
                                      title="Add Reaction"
                                    >
                                      <Smile className="w-4 h-4 text-[#888888]" />
                                    </button>
                                  </PopoverTrigger>
                                  <PopoverContent className="w-auto p-0 border-none" side="top" align="end">
                                    <Picker
                                      data={data}
                                      onEmojiSelect={(emoji: { native: string }) => handleAddReaction(message.id, emoji.native)}
                                      theme="dark"
                                    />
                                  </PopoverContent>
                                </Popover>
                                <button
                                  onClick={() => toast.info("Reply coming soon")}
                                  className="p-1.5 hover:bg-[#2a2a2a] transition-colors"
                                  title="Reply"
                                >
                                  <Reply className="w-4 h-4 text-[#888888]" />
                                </button>
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <button className="p-1.5 hover:bg-[#2a2a2a] rounded-r-md transition-colors">
                                      <MoreHorizontal className="w-4 h-4 text-[#888888]" />
                                    </button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent
                                    align="end"
                                    className="bg-[#111111] border-[#2a2a2a] text-white min-w-[160px]"
                                  >
                                    <DropdownMenuItem
                                      onClick={() => handleCopyMessage(message.content)}
                                      className="hover:bg-[#1a1a1a] cursor-pointer"
                                    >
                                      <Copy className="w-4 h-4 mr-2" />
                                      Copy Text
                                    </DropdownMenuItem>
                                    {message.authorId === user?.id && (
                                      <>
                                        <DropdownMenuSeparator className="bg-[#2a2a2a]" />
                                        <DropdownMenuItem
                                          onClick={() => {
                                            setEditingMessage(message);
                                            setEditContent(message.content);
                                          }}
                                          className="hover:bg-[#1a1a1a] cursor-pointer"
                                        >
                                          <Pencil className="w-4 h-4 mr-2" />
                                          Edit Message
                                        </DropdownMenuItem>
                                        <DropdownMenuItem
                                          onClick={() => setDeleteConfirmMessage(message)}
                                          className="hover:bg-red-500/20 text-red-400 cursor-pointer"
                                        >
                                          <Trash2 className="w-4 h-4 mr-2" />
                                          Delete Message
                                        </DropdownMenuItem>
                                      </>
                                    )}
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </div>
                            </div>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </ScrollArea>

      {/* Typing Indicator */}
      {typingUsers.length > 0 && (
        <div className="px-4 py-1 text-sm text-[#888888]">
          <span className="font-medium">{typingUsers.join(", ")}</span>
          {typingUsers.length === 1 ? " is typing..." : " are typing..."}
        </div>
      )}

      {/* Attachment Previews */}
      {attachments.length > 0 && (
        <div className="px-4 pb-2">
          <div className="flex flex-wrap gap-2 p-2 bg-[#111111] rounded-lg border border-[#1a1a1a]">
            {attachments.map((file, index) => (
              <div key={index} className="relative group">
                {file.type.startsWith("image/") && attachmentPreviews[index] ? (
                  <img src={attachmentPreviews[index]} alt={file.name} className="w-20 h-20 object-cover rounded-md" />
                ) : (
                  <div className="w-20 h-20 bg-[#1a1a1a] rounded-md flex flex-col items-center justify-center p-2">
                    <FileText className="w-6 h-6 text-[#8B5CF6] mb-1" />
                    <span className="text-xs text-[#888888] truncate w-full text-center">{file.name.slice(0, 10)}</span>
                  </div>
                )}
                <button
                  onClick={() => removeAttachment(index)}
                  className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <X className="w-3 h-3 text-white" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Message Input */}
      <div className="px-2 sm:px-4 pb-4 sm:pb-6 flex-shrink-0">
        <div className="relative bg-[#111111] rounded-lg border border-[#1a1a1a]">
          <input type="file" ref={fileInputRef} onChange={handleFileSelect} multiple accept="*/*" className="hidden" />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="absolute left-2 sm:left-4 top-1/2 -translate-y-1/2 text-[#888888] hover:text-white transition-colors"
            title="Upload file"
          >
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
            disabled={isSending}
          />
          <div className="absolute right-2 sm:right-4 top-1/2 -translate-y-1/2 flex items-center gap-2 sm:gap-4 text-[#888888]">
            <button
              onClick={() => toast.info("Gifts coming soon")}
              className="hover:text-white transition-colors hidden sm:block"
            >
              <Gift className="w-6 h-6" />
            </button>
            <button
              onClick={() => toast.info("Stickers coming soon")}
              className="hover:text-white transition-colors hidden sm:block"
            >
              <Sticker className="w-6 h-6" />
            </button>
            <Popover open={showEmojiPicker} onOpenChange={setShowEmojiPicker}>
              <PopoverTrigger asChild>
                <button className="hover:text-white transition-colors">
                  <Smile className="w-5 sm:w-6 h-5 sm:h-6" />
                </button>
              </PopoverTrigger>
              <PopoverContent
                side="top"
                align="end"
                className="w-auto p-0 border-none bg-transparent shadow-xl"
              >
                <Picker data={data} onEmojiSelect={handleEmojiSelect} theme="dark" />
              </PopoverContent>
            </Popover>
            {(newMessage.trim() || attachments.length > 0) && (
              <button
                onClick={handleSendMessage}
                disabled={isSending || isUploading}
                className="text-[#8B5CF6] hover:text-[#A78BFA] transition-colors disabled:opacity-50"
              >
                {isSending || isUploading ? (
                  <Loader2 className="w-5 sm:w-6 h-5 sm:h-6 animate-spin" />
                ) : (
                  <SendHorizontal className="w-5 sm:w-6 h-5 sm:h-6" />
                )}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deleteConfirmMessage} onOpenChange={() => setDeleteConfirmMessage(null)}>
        <DialogContent className="bg-[#1a1a1a] border-[#2a2a2a] text-white">
          <DialogHeader>
            <DialogTitle>Delete Message</DialogTitle>
            <DialogDescription className="text-[#888888]">
              Are you sure you want to delete this message? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="bg-[#111111] p-3 rounded-md text-[#888888] text-sm max-h-32 overflow-y-auto">
            {deleteConfirmMessage?.content}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteConfirmMessage(null)} className="text-white hover:bg-[#2a2a2a]">
              Cancel
            </Button>
            <Button onClick={handleDeleteMessage} className="bg-red-500 hover:bg-red-600 text-white">
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

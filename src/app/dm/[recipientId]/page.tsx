"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { useServer } from "@/contexts/ServerContext";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import {
  Phone,
  Video,
  Pin,
  Users,
  Search,
  Inbox,
  Loader2,
  ArrowLeft,
  FileText,
  Smile,
  Reply,
  MoreHorizontal,
  Pencil,
  Trash2,
  Copy,
  X,
  Plus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { MessageContent } from "@/components/chat/MessageContent";
import { LinkEmbed } from "@/components/chat/LinkEmbed";
import { MemberProfilePopup } from "@/components/user/MemberProfilePopup";
import { MessageBar, type MessageBarHandle } from "@/components/chat/MessageBar";
import { VideoMediaPlayer, AudioMediaPlayer } from "@/components/chat/MediaPlayer";
import { InlineBadges } from "@/components/chat/InlineBadges";
import { StaffPill } from "@/components/chat/StaffPill";
import { ImageLightbox } from "@/components/ui/image-lightbox";
import { Skeleton, UserProfileSkeleton, MessageSkeleton } from "@/components/ui/skeleton";
import { buildGalleryFromMessages, findGalleryIndex } from "@/lib/chat/media";
import { voiceService } from "@/lib/services/voiceService";
import { VoiceBar } from "@/components/voice/VoiceBar";
import { VideoGrid } from "@/components/voice/VideoGrid";
import { CustomEmojiPicker } from "@/components/chat/CustomEmojiPicker";
import { SwipeableRow, type SwipeAction } from "@/components/ui/swipe-actions";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

interface User {
  id: string;
  username: string;
  displayName: string;
  avatar?: string;
  status: "online" | "idle" | "dnd" | "offline";
  customStatus?: string;
  isPremium?: boolean;
  badges?: string[];
  bio?: string;
  createdAt?: string;
}

interface Message {
  id: string;
  content: string;
  type?: "default" | "reply" | "system";
  authorId: string;
  author: User;
  channelId: string;
  createdAt: string;
  updatedAt?: string;
  edited?: boolean;
  pinned?: boolean;
  referencedMessageId?: string;
  referencedMessage?: {
    id: string;
    content: string;
    author?: {
      id: string;
      username: string;
      displayName: string;
      avatar?: string;
    };
    createdAt?: string;
  };
  reactions?: Array<{
    emoji: {
      id?: string;
      name: string;
      animated?: boolean;
      url?: string;
    };
    count: number;
    userIds: string[];
  }>;
  attachments?: Array<{
    id: string;
    url: string;
    filename: string;
    contentType: string;
    size?: number;
  }>;
  customEmojis?: Array<{
    id: string;
    name: string;
    animated?: boolean;
    url: string;
  }>;
  sticker?: {
    id: string;
    name: string;
    imageUrl: string;
    serverId?: string;
    serverName?: string;
  };
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
  const { clearContext } = useServer();
  const [recipient, setRecipient] = useState<User | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [recipientLoading, setRecipientLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [showUserProfile, setShowUserProfile] = useState(true);
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const messageBarRef = useRef<MessageBarHandle>(null);
  const [availableServerEmojis, setAvailableServerEmojis] = useState<Array<{
    id: string;
    name: string;
    url: string;
    serverId?: string;
    serverName?: string;
    animated?: boolean;
  }>>([]);
  const [availableServerStickers, setAvailableServerStickers] = useState<Array<{
    id: string;
    name: string;
    imageUrl: string;
    serverId?: string;
    serverName?: string;
  }>>([]);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [standaloneMedia, setStandaloneMedia] = useState<{ src: string; alt?: string } | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const activeFetchRecipientRef = useRef<string | null>(null);
  const typingTimeoutsRef = useRef<Record<string, NodeJS.Timeout>>({});
  const lastTypingSentAtRef = useRef(0);

  // Edit state
  const [editingMessage, setEditingMessage] = useState<Message | null>(null);
  const [editContent, setEditContent] = useState("");

  // Delete confirmation
  const [deleteConfirmMessage, setDeleteConfirmMessage] = useState<Message | null>(null);

  // Right-click context menu
  const [contextMenu, setContextMenu] = useState<{ message: Message; x: number; y: number } | null>(null);

  // Reaction picker
  const [reactionPickerMessage, setReactionPickerMessage] = useState<string | null>(null);

  // Reply state
  const [replyToMessage, setReplyToMessage] = useState<Message | null>(null);

  // Pins
  const [showPins, setShowPins] = useState(false);
  const [pinnedMessages, setPinnedMessages] = useState<Message[]>([]);
  const [isLoadingPins, setIsLoadingPins] = useState(false);

  // Mobile detection
  const [isMobile, setIsMobile] = useState(false);
  const mediaGallery = useMemo(() => buildGalleryFromMessages(messages), [messages]);
  const mentionUsers = useMemo(() => {
    const entries: Array<{ id: string; username: string; displayName: string }> = [];
    if (user?.id) {
      entries.push({
        id: user.id,
        username: user.username || user.displayName || "you",
        displayName: user.displayName || user.username || "You",
      });
    }
    if (recipient?.id) {
      entries.push({
        id: recipient.id,
        username: recipient.username,
        displayName: recipient.displayName || recipient.username,
      });
    }
    return entries;
  }, [recipient?.displayName, recipient?.id, recipient?.username, user?.displayName, user?.id, user?.username]);

  // Clear server context when entering DM
  useEffect(() => {
    clearContext();
  }, [clearContext]);

  // Detect mobile
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  // Close context menu on outside click
  useEffect(() => {
    if (!contextMenu) return;
    const handleClick = () => setContextMenu(null);
    const handleScroll = () => setContextMenu(null);
    window.addEventListener("click", handleClick);
    window.addEventListener("scroll", handleScroll, true);
    return () => {
      window.removeEventListener("click", handleClick);
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [contextMenu]);

  // Fetch all server emojis the user has access to (for DM emoji picker)
  useEffect(() => {
    if (user?.id) {
      voiceService.setUserId(user.id);
    }
  }, [user?.id]);

  useEffect(() => {
    const fetchAllEmojis = async () => {
      try {
        const res = await fetch('/api/users/@me/emojis');
        if (res.ok) {
          const data = await res.json();
          setAvailableServerEmojis(data.emojis || []);
        }
      } catch {
        // best-effort
      }
    };
    fetchAllEmojis();
  }, []);

  // Fetch all server stickers the user has access to (for DM sticker picker)
  useEffect(() => {
    const fetchAllStickers = async () => {
      try {
        const res = await fetch('/api/users/@me/stickers');
        if (res.ok) {
          const data = await res.json();
          setAvailableServerStickers(data.stickers || []);
        }
      } catch {
        // best-effort
      }
    };
    fetchAllStickers();
  }, []);

  const handleEmojiSelect = useCallback((emoji: string, isCustom?: boolean, emojiData?: { id: string; name: string; animated?: boolean; url?: string }) => {
    const composer = messageBarRef.current?.getComposer();
    if (isCustom && emojiData && emojiData.url && composer) {
      composer.insertEmojiAtCaret({
        id: emojiData.id,
        name: emojiData.name,
        url: emojiData.url,
        animated: emojiData.animated,
      });
    } else if (composer) {
      const emojiString = isCustom && emojiData
        ? `<${emojiData.animated ? "a" : ""}:${emojiData.name}:${emojiData.id}>`
        : emoji;
      composer.insertTextAtCaret(emojiString);
    }
  }, []);

  const addTypingUser = useCallback(
    (username: string) => {
      if (!username || username === user?.username) return;
      setTypingUsers((prev) => (prev.includes(username) ? prev : [...prev, username]));

      if (typingTimeoutsRef.current[username]) {
        clearTimeout(typingTimeoutsRef.current[username]);
      }

      typingTimeoutsRef.current[username] = setTimeout(() => {
        setTypingUsers((prev) => prev.filter((u) => u !== username));
        delete typingTimeoutsRef.current[username];
      }, 3500);
    },
    [user?.username]
  );

  const sendTypingStatus = useCallback(
    async (content?: string) => {
      const draft = content ?? newMessage;
      if (!draft.trim()) return;

      const now = Date.now();
      if (now - lastTypingSentAtRef.current < 2000) return;
      lastTypingSentAtRef.current = now;

      try {
        await fetch(`/api/dms/${recipientId}/typing`, {
          method: "POST",
          keepalive: true,
        });
      } catch {
        // Best-effort only.
      }
    },
    [newMessage, recipientId]
  );

  // Redirect if not authenticated
  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/login");
    }
  }, [user, authLoading, router]);

  // Scroll to bottom of messages
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  // Fetch recipient info
  useEffect(() => {
    const fetchRecipient = async () => {
      setRecipientLoading(true);
      try {
        const response = await fetch(`/api/users/${recipientId}`);
        if (response.ok) {
          const data = await response.json();
          setRecipient(data);
        }
      } catch (error) {
        console.error("Failed to fetch recipient:", error);
      } finally {
        setRecipientLoading(false);
      }
    };

    if (recipientId) {
      fetchRecipient();
    }
  }, [recipientId, scrollToBottom]);

  // Fetch pinned messages
  const fetchPinnedMessages = useCallback(async () => {
    setIsLoadingPins(true);
    try {
      const response = await fetch(`/api/dms/${recipientId}/pins`);
      if (response.ok) {
        const data = await response.json();
        setPinnedMessages(data.messages || []);
      }
    } catch {
      // best-effort
    } finally {
      setIsLoadingPins(false);
    }
  }, [recipientId]);

  // Fetch DM messages
  const fetchMessages = useCallback(async () => {
    // Guard against a slower response from a previously viewed DM overwriting
    // this conversation after a fast switch.
    const requestedRecipientId = recipientId;
    activeFetchRecipientRef.current = requestedRecipientId;
    setIsLoading(true);
    setMessages([]);
    try {
      const response = await fetch(`/api/dms/${requestedRecipientId}/messages`);
      if (activeFetchRecipientRef.current !== requestedRecipientId) return;
      if (response.ok) {
        const data = await response.json();
        if (activeFetchRecipientRef.current !== requestedRecipientId) return;
        setMessages(data.messages || []);
        // Auto-scroll to bottom after loading messages
        setTimeout(scrollToBottom, 200);
      }
    } catch (error) {
      console.error("Failed to fetch messages:", error);
    } finally {
      if (activeFetchRecipientRef.current === requestedRecipientId) {
        setIsLoading(false);
      }
    }
  }, [recipientId, scrollToBottom]);

  useEffect(() => {
    if (recipientId && user) {
      fetchMessages();
    }
  }, [recipientId, fetchMessages, user]);

  // Fetch pinned messages
  useEffect(() => {
    if (recipientId && user) {
      void fetchPinnedMessages();
    }
  }, [recipientId, fetchPinnedMessages, user]);

  // Set up real-time updates using SSE
  useEffect(() => {
    if (!recipientId || !user) return;

    const connectSSE = () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }

      const eventSource = new EventSource(`/api/dms/${recipientId}/stream`);
      eventSourceRef.current = eventSource;

      eventSource.onopen = () => {
        reconnectAttemptsRef.current = 0;
      };

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === "connected" || data.type === "ping") return;
          if (data.type === "typing") {
            addTypingUser(data.username);
            return;
          }
          if (data.type === "message") {
            setMessages((prev) => {
              if (prev.some((m) => m.id === data.message.id)) {
                return prev;
              }

              const ownMessage = data.message.authorId === user?.id || data.message.author?.id === user?.id;
              if (ownMessage) {
                const ownTempIndex = prev.findIndex(
                  (m) =>
                    m.id.startsWith("temp-") &&
                    m.authorId === user?.id &&
                    m.content === data.message.content
                );
                if (ownTempIndex !== -1) {
                  return prev.map((m, index) => (index === ownTempIndex ? data.message : m));
                }
              }

              return [...prev, data.message];
            });
            setTimeout(scrollToBottom, 100);
          }
          if (data.type === "edit") {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === data.messageId
                  ? { ...m, content: data.content, edited: true }
                  : m
              )
            );
          }
          if (data.type === "delete") {
            setMessages((prev) => prev.filter((m) => m.id !== data.messageId));
          }
          if (data.type === "reaction_add" || data.type === "reaction_remove") {
            const add = data.type === "reaction_add";
            if (data.userId !== user?.id) {
              applyReactionEvent(data.messageId, data.emoji, data.userId, add);
            }
          }
          if (data.type === "pin_update") {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === data.messageId
                  ? { ...m, pinned: data.pinned }
                  : m
              )
            );
            void fetchPinnedMessages();
          }
        } catch (error) {
          console.error("SSE parse error:", error);
        }
      };

      eventSource.onerror = () => {
        eventSource.close();

        const backoffMs = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 30000);
        reconnectAttemptsRef.current += 1;
        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current);
        }
        reconnectTimeoutRef.current = setTimeout(() => {
          connectSSE();
        }, backoffMs);
      };
    };

    connectSSE();

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      Object.values(typingTimeoutsRef.current).forEach((timeout) => clearTimeout(timeout));
      typingTimeoutsRef.current = {};
    };
  }, [addTypingUser, recipientId, scrollToBottom, user]);

  // Send message
  const sendMessage = async (sticker?: { id: string; name: string; imageUrl: string; serverId?: string; serverName?: string }) => {
    const isStickerSend = !!sticker;
    const pendingAttachments = messageBarRef.current?.getAttachments() ?? [];
    if ((!newMessage.trim() && !isStickerSend && pendingAttachments.length === 0) || isSending) return;

    const replyReference = replyToMessage;
    setIsSending(true);
    const messageContent = newMessage.trim();
    setNewMessage("");
    messageBarRef.current?.getComposer()?.clear();
    lastTypingSentAtRef.current = 0;

    let tempId: string | null = null;

    try {
      let uploadedAttachments: Array<{ id: string; url: string; filename: string; contentType: string }> = [];
      if (pendingAttachments.length > 0) {
        uploadedAttachments = await messageBarRef.current?.uploadAttachments() ?? [];
        messageBarRef.current?.clearAttachments();
      }

      // Optimistic update — include uploaded attachments so they show immediately
      tempId = `temp-${Date.now()}`;
      const optimisticMessage: Message = {
        id: tempId,
        content: messageContent,
        type: replyReference ? "reply" : "default",
        authorId: user?.id || "",
        author: {
          id: user?.id || "",
          username: user?.username || "",
          displayName: user?.displayName || "",
          avatar: user?.avatar,
          status: user?.status || "online",
          isPremium: user?.isPremium,
          badges: user?.badges,
        },
        channelId: recipientId,
        createdAt: new Date().toISOString(),
        sticker,
        attachments: uploadedAttachments.length > 0 ? uploadedAttachments : undefined,
        referencedMessageId: replyReference?.id,
        referencedMessage: replyReference
          ? {
              id: replyReference.id,
              content: replyReference.content,
              author: replyReference.author,
              createdAt: replyReference.createdAt,
            }
          : undefined,
        reactions: [],
      };
      setMessages((prev) => [...prev, optimisticMessage]);
      scrollToBottom();

      const body: Record<string, unknown> = {};
      if (messageContent) body.content = messageContent;
      if (sticker) body.sticker = sticker;
      if (uploadedAttachments.length > 0) body.attachments = uploadedAttachments;
      if (replyReference) body.replyTo = replyReference.id;

      const response = await fetch(`/api/dms/${recipientId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
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
        if (messageContent) {
          setNewMessage(messageContent);
          messageBarRef.current?.getComposer()?.insertTextAtCaret(messageContent);
        }
      }
    } catch (error) {
      console.error("Failed to send message:", error);
      if (tempId) {
        setMessages((prev) => prev.filter((m) => m.id !== tempId));
      }
      if (messageContent) {
        setNewMessage(messageContent);
        messageBarRef.current?.getComposer()?.insertTextAtCaret(messageContent);
      }
    } finally {
      setIsSending(false);
      setReplyToMessage(null);
    }
  };

  const handleGifSelect = useCallback(async (gifUrl: string) => {
    if (!user) return;

    const tempId = `temp-${Date.now()}`;
    const optimisticMessage: Message = {
      id: tempId,
      content: gifUrl,
      authorId: user.id,
      author: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        avatar: user.avatar,
        status: user.status || "online",
        isPremium: user.isPremium,
        badges: user.badges,
      },
      channelId: recipientId,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimisticMessage]);
    setTimeout(scrollToBottom, 100);

    try {
      const response = await fetch(`/api/dms/${recipientId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: gifUrl }),
      });

      if (response.ok) {
        const data = await response.json();
        setMessages((prev) => prev.map((m) => (m.id === tempId ? data : m)));
      } else {
        setMessages((prev) => prev.filter((m) => m.id !== tempId));
      }
    } catch {
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
    }
  }, [recipientId, scrollToBottom, user]);

  const handleStickerSelect = (sticker: { id: string; name: string; imageUrl: string; serverId?: string; serverName?: string }) => {
    void sendMessage(sticker);
  };

  // Edit message
  const handleEditMessage = async () => {
    if (!editingMessage || !editContent.trim()) return;

    const messageId = editingMessage.id;
    const previous = messages.find((m) => m.id === messageId);
    if (!previous) return;

    setMessages((prev) =>
      prev.map((m) => (m.id === messageId ? { ...m, content: editContent, edited: true } : m))
    );
    setEditingMessage(null);
    setEditContent("");

    try {
      const response = await fetch(`/api/dms/${recipientId}/messages/${messageId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: editContent }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        setMessages((prev) => prev.map((m) => (m.id === messageId ? previous : m)));
        toast.error(data?.error || "Failed to edit message");
      }
    } catch {
      setMessages((prev) => prev.map((m) => (m.id === messageId ? previous : m)));
      toast.error("Failed to edit message. Check your connection.");
    }
  };

  const handleEditKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleEditMessage();
    }
    if (e.key === "Escape") {
      setEditingMessage(null);
      setEditContent("");
    }
  };

  // Delete message
  const handleDeleteMessage = async () => {
    if (!deleteConfirmMessage) return;

    const messageId = deleteConfirmMessage.id;
    const previousMessages = messages;

    setMessages((prev) => prev.filter((m) => m.id !== messageId));
    setDeleteConfirmMessage(null);

    try {
      const response = await fetch(`/api/dms/${recipientId}/messages/${messageId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        setMessages(previousMessages);
        toast.error(data?.error || "Failed to delete message");
      }
    } catch {
      setMessages(previousMessages);
      toast.error("Failed to delete message. Check your connection.");
    }
  };

  // Copy message
  const handleCopyMessage = (content: string) => {
    navigator.clipboard.writeText(content);
    toast.success("Copied to clipboard");
  };

  // Pin toggle
  const handlePinToggle = async (message: Message) => {
    try {
      const response = await fetch(`/api/dms/${recipientId}/messages/${message.id}/pin`, {
        method: message.pinned ? "DELETE" : "PUT",
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        toast.error(data?.error || "Failed to update pin");
        return;
      }

      setMessages((prev) =>
        prev.map((m) => (m.id === message.id ? { ...m, pinned: !message.pinned } : m))
      );
      void fetchPinnedMessages();
      toast.success(message.pinned ? "Message unpinned" : "Message pinned");
    } catch {
      toast.error("Failed to update pin");
    }
  };

  // Reaction helpers
  const applyReactionEvent = useCallback((messageId: string, emoji: string, userId: string, add: boolean) => {
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== messageId) return m;
        const reactions = [...(m.reactions || [])];
        const idx = reactions.findIndex(
          (r) => r.emoji.id
            ? r.emoji.id === emoji
            : r.emoji.name === emoji
        );
        if (add) {
          if (idx !== -1) {
            const r = reactions[idx];
            if (!r.userIds.includes(userId)) {
              reactions[idx] = { ...r, count: r.count + 1, userIds: [...r.userIds, userId] };
            }
          } else {
            reactions.push({
              emoji: { name: emoji },
              count: 1,
              userIds: [userId],
            });
          }
        } else {
          if (idx !== -1) {
            const r = reactions[idx];
            const newUserIds = r.userIds.filter((id) => id !== userId);
            if (newUserIds.length === 0) {
              reactions.splice(idx, 1);
            } else {
              reactions[idx] = { ...r, count: newUserIds.length, userIds: newUserIds };
            }
          }
        }
        return { ...m, reactions };
      })
    );
  }, []);

  const handleAddReaction = async (messageId: string, emoji: string) => {
    if (!user?.id) return;
    setReactionPickerMessage(null);
    applyReactionEvent(messageId, emoji, user.id, true);
    try {
      const encodedEmoji = encodeURIComponent(emoji);
      const response = await fetch(`/api/dms/${recipientId}/messages/${messageId}/reactions?emoji=${encodedEmoji}`, {
        method: "PUT",
      });
      if (!response.ok) {
        applyReactionEvent(messageId, emoji, user.id, false);
        const data = await response.json().catch(() => null);
        toast.error(data?.error || "Failed to add reaction");
      }
    } catch {
      applyReactionEvent(messageId, emoji, user.id, false);
      toast.error("Failed to add reaction. Check your connection.");
    }
  };

  const handleRemoveReaction = async (messageId: string, emoji: string) => {
    if (!user?.id) return;
    applyReactionEvent(messageId, emoji, user.id, false);
    try {
      const encodedEmoji = encodeURIComponent(emoji);
      const response = await fetch(`/api/dms/${recipientId}/messages/${messageId}/reactions?emoji=${encodedEmoji}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        applyReactionEvent(messageId, emoji, user.id, true);
        const data = await response.json().catch(() => null);
        toast.error(data?.error || "Failed to remove reaction");
      }
    } catch {
      applyReactionEvent(messageId, emoji, user.id, true);
      toast.error("Failed to remove reaction. Check your connection.");
    }
  };

  const handleReactionClick = (messageId: string, emoji: string, hasReacted: boolean) => {
    if (hasReacted) {
      void handleRemoveReaction(messageId, emoji);
    } else {
      void handleAddReaction(messageId, emoji);
    }
  };

  // Context menu
  const handleContextMenu = (e: React.MouseEvent, message: Message) => {
    e.preventDefault();
    setContextMenu({ message, x: e.clientX, y: e.clientY });
  };

  // Reaction picker
  const handleReactionPickerOpen = (messageId: string) => {
    setReactionPickerMessage(messageId);
  };

  // Reply
  const handleReply = (message: Message) => {
    setReplyToMessage(message);
    messageBarRef.current?.getComposer()?.focus();
  };

  const handleCancelReply = () => {
    setReplyToMessage(null);
  };

  // Start editing
  const startEditing = (message: Message) => {
    setEditingMessage(message);
    setEditContent(message.content);
  };

  // Swipe actions for mobile
  const getSwipeActions = (message: Message): SwipeAction[] => {
    const actions: SwipeAction[] = [
      {
        label: "Reply",
        icon: <Reply className="w-5 h-5" />,
        onAction: () => handleReply(message),
        className: "bg-[#8B5CF6]",
      },
      {
        label: "React",
        icon: <Smile className="w-5 h-5" />,
        onAction: () => setReactionPickerMessage(message.id),
        className: "bg-[#6366f1]",
      },
    ];
    if (message.authorId === user?.id) {
      actions.push({
        label: "Edit",
        icon: <Pencil className="w-5 h-5" />,
        onAction: () => startEditing(message),
        className: "bg-[#3b82f6]",
      });
      actions.push({
        label: "Delete",
        icon: <Trash2 className="w-5 h-5" />,
        onAction: () => setDeleteConfirmMessage(message),
        className: "bg-red-500",
      });
    }
    return actions;
  };

  // Handle key press
  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const handleMessageInputChange = (value: string, _caret: number) => {
    setNewMessage(value);
    if (value.trim()) {
      void sendTypingStatus(value);
    }
  };
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

  // Memoize message groups for better performance
  const messageGroups = useMemo(() => groupMessages(messages), [messages]);

  const openMediaViewer = useCallback(
    (src: string, alt?: string, messageId?: string) => {
      const mediaIndex = findGalleryIndex(mediaGallery, { src, messageId });
      if (mediaIndex >= 0) {
        setStandaloneMedia(null);
        setLightboxIndex(mediaIndex);
        return;
      }
      setLightboxIndex(null);
      setStandaloneMedia({ src, alt });
    },
    [mediaGallery]
  );

  useEffect(() => {
    if (lightboxIndex === null) return;
    if (!mediaGallery.length) {
      setLightboxIndex(null);
      return;
    }
    if (lightboxIndex >= mediaGallery.length) {
      setLightboxIndex(mediaGallery.length - 1);
    }
  }, [lightboxIndex, mediaGallery.length]);

  const typingStatusText =
    typingUsers.length === 0
      ? ""
      : typingUsers.length === 1
        ? `${typingUsers[0]} is typing...`
        : typingUsers.length === 2
          ? `${typingUsers[0]} and ${typingUsers[1]} are typing...`
          : `${typingUsers[0]}, ${typingUsers[1]} and ${typingUsers.length - 2} others are typing...`;

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
    <div className="chat-shell flex-1 flex bg-[#0a0a0a] animate-fade-in">
      {/* Main chat area */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        {/* Header */}
        <div className="h-16 px-3 sm:px-4 flex items-center justify-between border-b border-[#1a1a1a] bg-[#0a0a0a] safe-area-top">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <Link
              href="/channels/messages"
              className="p-2 hover:bg-[#111111] rounded-lg transition-colors active:scale-95"
            >
              <ArrowLeft className="w-5 h-5 text-[#888888]" />
            </Link>

            <div className="relative flex-shrink-0">
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

            <div className="flex items-center gap-2 min-w-0">
              <span className="font-semibold text-white truncate">
                {recipient?.displayName || recipient?.username || "Loading..."}
              </span>
              <StaffPill badges={recipient?.badges} />
            </div>
          </div>

          <div className="flex items-center gap-1 sm:gap-2">
            <button
              onClick={() => void voiceService.joinChannel(`dm:${recipientId}`)}
              className="p-2 text-[#888888] hover:text-white transition-colors rounded-md hover:bg-[#111111] hidden sm:block"
              title="Start Voice Call"
            >
              <Phone className="w-5 h-5" />
            </button>
            <button
              onClick={() => void voiceService.joinChannel(`dm:${recipientId}`, true)}
              className="p-2 text-[#888888] hover:text-white transition-colors rounded-md hover:bg-[#111111] hidden sm:block"
              title="Start Video Call"
            >
              <Video className="w-5 h-5" />
            </button>
            <button
              onClick={() => setShowPins(true)}
              className="p-2 text-[#888888] hover:text-white transition-colors rounded-md hover:bg-[#111111] hidden sm:block"
              title="Pinned Messages"
            >
              <Pin className="w-5 h-5" />
            </button>
            <button
              onClick={() => setShowUserProfile(!showUserProfile)}
              className={cn(
                "p-2 transition-colors rounded-md hover:bg-[#111111] hidden lg:block",
                showUserProfile ? "text-white" : "text-[#888888] hover:text-white"
              )}
            >
              <Users className="w-5 h-5" />
            </button>
            <div className="relative hidden sm:block">
              <Input
                placeholder="Search"
                className="h-7 w-32 bg-[#111111] border-none text-white placeholder:text-[#555555] text-sm rounded focus-visible:ring-0 transition-all duration-150 focus:w-40"
              />
              <Search className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-[#555555]" />
            </div>
            <button className="p-2 text-[#888888] hover:text-white transition-colors rounded-md hover:bg-[#111111] hidden sm:block">
              <Inbox className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Messages area */}
        <div className="chat-scroller flex-1 overflow-y-auto min-h-0 scrollbar-thin">
          <div className="flex flex-col min-h-full">
            {/* Welcome message */}
            <div className="flex-1" />
            <div className="px-4 py-6">
              <div className="flex flex-col items-start gap-2 mb-6 animate-fade-in-up">
                {recipientLoading ? (
                  <>
                    <Skeleton className="w-20 h-20 rounded-full" variant="circular" />
                    <Skeleton className="h-7 w-40" />
                    <Skeleton className="h-5 w-72" />
                  </>
                ) : (
                  <>
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
                  </>
                )}
              </div>

              {/* Messages */}
              {isLoading ? (
                <MessageSkeleton count={4} />
              ) : (
                <div className="space-y-[var(--chat-row-gap)] animate-fade-in">
                  {messageGroups.map((group, groupIndex) => (
                    <div
                      key={`group-${groupIndex}-${group.author.id}-${group.timestamp}`}
                      className="chat-message-row -mx-4 group/message hover:bg-[#111111]/50 py-0.5 rounded transition-colors duration-100"
                    >
                      <div className="flex gap-4">
                      <div className="w-10 flex-shrink-0">
                        {group.author?.id ? (
                          <MemberProfilePopup
                            member={{
                              id: group.author.id,
                              username: group.author.username || "unknown",
                              displayName: group.author.displayName,
                              avatar: group.author.avatar,
                            }}
                            side="right"
                            align="start"
                          >
                            <button className="block rounded-full focus-visible:outline-2 focus-visible:outline-[#8B5CF6]" aria-label={`View profile of ${group.author.displayName || group.author.username}`}>
                              <Avatar className="w-10 h-10 mt-0.5 cursor-pointer hover:opacity-90 transition-opacity">
                                <AvatarImage src={group.author.avatar} loading="lazy" />
                                <AvatarFallback className="bg-[#8B5CF6] text-white">
                                  {(group.author.displayName || group.author.username).charAt(0).toUpperCase()}
                                </AvatarFallback>
                              </Avatar>
                            </button>
                          </MemberProfilePopup>
                        ) : (
                          <Avatar className="w-10 h-10 mt-0.5 flex-shrink-0">
                            <AvatarImage src={group.author.avatar} loading="lazy" />
                            <AvatarFallback className="bg-[#8B5CF6] text-white">
                              {(group.author.displayName || group.author.username).charAt(0).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                        )}
                      </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-baseline gap-2">
                            {group.author?.id ? (
                              <MemberProfilePopup
                                member={{
                                  id: group.author.id,
                                  username: group.author.username || "unknown",
                                  displayName: group.author.displayName,
                                  avatar: group.author.avatar,
                                }}
                                side="right"
                                align="start"
                              >
                                <button className="font-medium text-white hover:underline focus-visible:outline-2 focus-visible:outline-[#8B5CF6] rounded">
                                  {group.author.displayName || group.author.username}
                                </button>
                              </MemberProfilePopup>
                            ) : (
                              <span className="font-medium text-white">
                                {group.author.displayName || group.author.username}
                              </span>
                            )}
                            <StaffPill badges={group.author?.badges} />
                            <span className="text-xs text-[#666666]">
                              {formatTime(group.timestamp)}
                            </span>
                          </div>
                          {group.messages.map((message, msgIndex) => {
                            const isEditing = editingMessage?.id === message.id;
                            const messageReactions = message.reactions || [];

                            return (
                              <SwipeableRow
                                key={`${groupIndex}-${msgIndex}-${message.id}`}
                                actions={isMobile ? getSwipeActions(message) : []}
                              >
                                <div
                                  onContextMenu={(e) => handleContextMenu(e, message)}
                                  className="relative group/msg"
                                >
                                  {/* Reply reference */}
                                  {message.referencedMessage && (
                                    <div className="mb-1 flex items-center gap-2 text-xs text-[#888888] pl-2 border-l-2 border-[#333333]">
                                      <Reply className="w-3 h-3 flex-shrink-0" />
                                      {message.referencedMessage.author && (
                                        <span className="font-medium text-[#aaa]">
                                          @{message.referencedMessage.author.displayName || message.referencedMessage.author.username}
                                        </span>
                                      )}
                                      <span className="truncate max-w-[300px]">
                                        {message.referencedMessage.content || "(attachment)"}
                                      </span>
                                    </div>
                                  )}

                                  {/* Pinned indicator */}
                                  {message.pinned && (
                                    <div className="absolute -left-2 top-0 bottom-0 flex items-center pointer-events-none">
                                      <Pin className="w-3 h-3 text-[#8B5CF6]" />
                                    </div>
                                  )}

                                  {/* Edit mode */}
                                  {isEditing ? (
                                    <div className="mt-1">
                                      <Textarea
                                        value={editContent}
                                        onChange={(e) => setEditContent(e.target.value)}
                                        onKeyDown={handleEditKeyDown}
                                        autoFocus
                                        className="bg-[#1a1a1a] border-none text-[#dcddde] text-sm rounded-md resize-none focus-visible:ring-1 focus-visible:ring-[#8B5CF6] min-h-[40px]"
                                        rows={2}
                                      />
                                      <div className="text-xs text-[#666666] mt-1">
                                        escape to <button onClick={() => { setEditingMessage(null); setEditContent(""); }} className="text-[#8B5CF6] hover:underline">cancel</button>
                                        {" • "}enter to <button onClick={() => void handleEditMessage()} className="text-[#8B5CF6] hover:underline">save</button>
                                      </div>
                                    </div>
                                  ) : (
                                    <>
                                      <MessageContent
                                        content={message.content}
                                        serverEmojis={message.customEmojis}
                                        mentionUsers={mentionUsers}
                                        currentUserId={user?.id}
                                        sticker={message.sticker}
                                        className="chat-message-body text-[#dcddde]"
                                        onMediaClick={({ src, alt }) => openMediaViewer(src, alt, message.id)}
                                      />
                                      {message.edited && (
                                        <span className="text-xs text-[#666666] ml-1">(edited)</span>
                                      )}
                                      <LinkEmbed content={message.content} />

                                      {/* Attachments */}
                                      {message.attachments?.map((attachment) => (
                                        <div key={attachment.id} className="mt-2">
                                          {attachment.contentType.startsWith("image/") ? (
                                            <img
                                              src={attachment.url}
                                              alt={attachment.filename}
                                              className="chat-media cursor-pointer hover:opacity-90 max-w-sm max-h-[350px] object-contain rounded-md"
                                              onClick={() => openMediaViewer(attachment.url, attachment.filename, message.id)}
                                            />
                                          ) : attachment.contentType.startsWith("video/") ? (
                                            <VideoMediaPlayer
                                              src={attachment.url}
                                              filename={attachment.filename}
                                              contentType={attachment.contentType}
                                              className="max-w-sm rounded-lg overflow-hidden"
                                            />
                                          ) : attachment.contentType.startsWith("audio/") ? (
                                            <AudioMediaPlayer
                                              src={attachment.url}
                                              filename={attachment.filename}
                                              contentType={attachment.contentType}
                                              className="w-full max-w-sm"
                                            />
                                          ) : (
                                            <a
                                              href={attachment.url}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              className="flex items-center gap-2 p-3 bg-[#1a1a1a] rounded-md hover:brightness-110 max-w-sm transition"
                                            >
                                              <FileText className="w-8 h-8 text-[#8B5CF6] flex-shrink-0" />
                                              <div className="min-w-0">
                                                <div className="text-[#8B5CF6] hover:underline truncate">{attachment.filename}</div>
                                                <div className="text-xs text-[#888888]">{attachment.size ? Math.round(attachment.size / 1024) : '?'} KB</div>
                                              </div>
                                            </a>
                                          )}
                                        </div>
                                      ))}

                                      {/* Reactions */}
                                      {messageReactions.length > 0 && (
                                        <div className="flex flex-wrap gap-1 mt-1">
                                          {messageReactions.map((reaction) => {
                                            const hasReacted = user?.id ? reaction.userIds.includes(user.id) : false;
                                            return (
                                              <button
                                                key={`${reaction.emoji.id || reaction.emoji.name}`}
                                                onClick={() => handleReactionClick(message.id, reaction.emoji.id || reaction.emoji.name, hasReacted)}
                                                className={cn(
                                                  "flex items-center gap-1 px-1.5 py-0.5 rounded-md text-xs transition-colors border",
                                                  hasReacted
                                                    ? "bg-[#8B5CF6]/20 border-[#8B5CF6]/50 text-white"
                                                    : "bg-[#1a1a1a] border-[#222222] text-[#dcddde] hover:bg-[#222222]"
                                                )}
                                              >
                                                {reaction.emoji.url ? (
                                                  <img src={reaction.emoji.url} alt={reaction.emoji.name} className="w-4 h-4" />
                                                ) : (
                                                  <span className="text-sm leading-none">{reaction.emoji.name}</span>
                                                )}
                                                <span>{reaction.count}</span>
                                              </button>
                                            );
                                          })}
                                        </div>
                                      )}
                                    </>
                                  )}

                                  {/* Hover actions */}
                                  {!isEditing && (
                                    <div className={cn(
                                      "absolute -top-3 right-0 transition-opacity z-10",
                                      reactionPickerMessage === message.id
                                        ? "opacity-100"
                                        : "opacity-0 group-hover/msg:opacity-100"
                                    )}>
                                      <div className="flex items-center bg-[#1a1a1a] border border-[#222222] rounded-md shadow-lg">
                                        <Popover
                                          open={reactionPickerMessage === message.id}
                                          onOpenChange={(open) => setReactionPickerMessage(open ? message.id : null)}
                                        >
                                          <PopoverTrigger asChild>
                                            <button
                                              className="p-1.5 hover:bg-black/20 rounded-l-md transition-colors"
                                              title="Add Reaction"
                                            >
                                              <Smile className="w-4 h-4 text-[#888888]" />
                                            </button>
                                          </PopoverTrigger>
                                          <PopoverContent className="w-[440px] max-w-[calc(100vw-1rem)] p-0 border-none" side="top" align="end">
                                            <CustomEmojiPicker
                                              onEmojiSelect={(emoji: string, isCustom?: boolean, emojiData?: { id: string; name: string; animated?: boolean; url?: string }) => {
                                                const emojiStr = isCustom && emojiData
                                                  ? `<${emojiData.animated ? "a" : ""}:${emojiData.name}:${emojiData.id}>`
                                                  : emoji;
                                                void handleAddReaction(message.id, emojiStr);
                                              }}
                                              availableServerEmojis={availableServerEmojis}
                                              availableServerStickers={[]}
                                              onGifSelect={() => {}}
                                              onStickerSelect={() => {}}
                                              initialTab="emoji"
                                            />
                                          </PopoverContent>
                                        </Popover>
                                        <button
                                          onClick={() => handleReply(message)}
                                          className="p-1.5 hover:bg-black/20 transition-colors"
                                          title="Reply"
                                        >
                                          <Reply className="w-4 h-4 text-[#888888]" />
                                        </button>
                                        <DropdownMenu>
                                          <DropdownMenuTrigger asChild>
                                            <button className="p-1.5 hover:bg-black/20 rounded-r-md transition-colors" title="More">
                                              <MoreHorizontal className="w-4 h-4 text-[#888888]" />
                                            </button>
                                          </DropdownMenuTrigger>
                                          <DropdownMenuContent side="bottom" align="end" className="bg-[#1a1a1a] border-[#222222] min-w-[160px]">
                                            <DropdownMenuItem onClick={() => handleReply(message)} className="text-[#dcddde] hover:bg-[#222222] focus:bg-[#222222] cursor-pointer">
                                              <Reply className="w-4 h-4 mr-2" /> Reply
                                            </DropdownMenuItem>
                                            <DropdownMenuItem onClick={() => handleCopyMessage(message.content)} className="text-[#dcddde] hover:bg-[#222222] focus:bg-[#222222] cursor-pointer">
                                              <Copy className="w-4 h-4 mr-2" /> Copy Text
                                            </DropdownMenuItem>
                                            <DropdownMenuItem onClick={() => void handlePinToggle(message)} className="text-[#dcddde] hover:bg-[#222222] focus:bg-[#222222] cursor-pointer">
                                              <Pin className="w-4 h-4 mr-2" /> {message.pinned ? "Unpin" : "Pin"}
                                            </DropdownMenuItem>
                                            {message.authorId === user?.id && (
                                              <>
                                                <DropdownMenuSeparator className="bg-[#222222]" />
                                                <DropdownMenuItem onClick={() => startEditing(message)} className="text-[#dcddde] hover:bg-[#222222] focus:bg-[#222222] cursor-pointer">
                                                  <Pencil className="w-4 h-4 mr-2" /> Edit
                                                </DropdownMenuItem>
                                                <DropdownMenuItem onClick={() => setDeleteConfirmMessage(message)} className="text-red-400 hover:bg-red-500/10 focus:bg-red-500/10 cursor-pointer">
                                                  <Trash2 className="w-4 h-4 mr-2" /> Delete
                                                </DropdownMenuItem>
                                              </>
                                            )}
                                          </DropdownMenuContent>
                                        </DropdownMenu>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </SwipeableRow>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          </div>
        </div>

        {typingStatusText && (
          <div className="px-4 pb-1 text-sm text-[#888888]">
            <span className="inline-flex items-center gap-2">
              <span className="flex gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-[#8B5CF6] animate-bounce [animation-delay:0ms]" />
                <span className="h-1.5 w-1.5 rounded-full bg-[#8B5CF6] animate-bounce [animation-delay:120ms]" />
                <span className="h-1.5 w-1.5 rounded-full bg-[#8B5CF6] animate-bounce [animation-delay:240ms]" />
              </span>
              {typingStatusText}
            </span>
          </div>
        )}

        {/* Message input */}
        <div className="p-3 sm:p-4 pt-0 safe-area-bottom">
          {/* Reply preview */}
          {replyToMessage && (
            <div className="flex items-center gap-2 px-3 py-2 mb-1 bg-[#111111] rounded-t-md text-sm">
              <Reply className="w-4 h-4 text-[#8B5CF6] flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <span className="text-[#888888]">Replying to </span>
                <span className="font-medium text-white">
                  {replyToMessage.author.displayName || replyToMessage.author.username}
                </span>
                <div className="text-[#888888] truncate">
                  {replyToMessage.content || "(attachment)"}
                </div>
              </div>
              <button
                onClick={handleCancelReply}
                className="p-1 hover:bg-[#222222] rounded-md transition-colors"
              >
                <X className="w-4 h-4 text-[#888888]" />
              </button>
            </div>
          )}
          <MessageBar
            ref={messageBarRef}
            placeholder={`Message @${recipient?.displayName || recipient?.username || "..."}`}
            ariaLabel={`Message @${recipient?.displayName || recipient?.username || "..."}`}
            onSend={() => void sendMessage()}
            onChange={handleMessageInputChange}
            onKeyDown={handleKeyPress}
            onEmojiSelect={handleEmojiSelect}
            onGifSelect={handleGifSelect}
            onStickerSelect={handleStickerSelect}
            isSending={isSending}
            availableServerEmojis={availableServerEmojis}
            availableServerStickers={availableServerStickers}
          />

          {/* Video Grid for DM calls */}
          <VideoGrid />

          {/* Voice Bar for DM calls */}
          <VoiceBar channelName={recipient?.displayName || recipient?.username || "DM Call"} />
        </div>
      </div>

      {/* User profile sidebar */}
      {showUserProfile && (
        <div className="w-[340px] bg-[#0a0a0a] border-l border-[#1a1a1a] hidden lg:flex flex-col animate-slide-in-right">
          {recipientLoading ? (
            <UserProfileSkeleton />
          ) : recipient ? (
            <>
              {/* Banner/Header */}
              <div className="h-[120px] bg-[#8B5CF6] relative">
                {recipient.isPremium && (
                  <div className="absolute top-2 right-2 px-2 py-1 bg-black/40 rounded-full flex items-center gap-1">
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
                      className="absolute bottom-1 right-1 w-6 h-6 rounded-full border-4 border-[#0a0a0a] transition-colors duration-200"
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
                    <InlineBadges badges={recipient.badges} size="sm" />
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
                    className="w-full bg-transparent text-sm text-[#dcddde] placeholder:text-[#555555] resize-none focus:outline-none transition-colors duration-150"
                    rows={2}
                  />
                </div>
              </div>
            </>
          ) : null}
        </div>
      )}

      {/* Delete confirmation dialog */}
      <Dialog open={!!deleteConfirmMessage} onOpenChange={(open) => { if (!open) setDeleteConfirmMessage(null); }}>
        <DialogContent className="bg-[#1a1a1a] border-[#222222] text-white">
          <DialogHeader>
            <DialogTitle>Delete Message</DialogTitle>
            <DialogDescription className="text-[#888888]">
              Are you sure you want to delete this message? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          {deleteConfirmMessage && (
            <div className="bg-[#0a0a0a] rounded-md p-3 text-sm text-[#dcddde] border border-[#222222]">
              <p className="truncate">{deleteConfirmMessage.content || "(attachment)"}</p>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setDeleteConfirmMessage(null)} className="text-[#888888] hover:text-white">
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => void handleDeleteMessage()} className="bg-red-600 hover:bg-red-700 text-white">
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Pinned messages dialog */}
      <Dialog open={showPins} onOpenChange={setShowPins}>
        <DialogContent className="bg-[#1a1a1a] border-[#222222] text-white max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pin className="w-5 h-5 text-[#8B5CF6]" />
              Pinned Messages
            </DialogTitle>
            <DialogDescription className="text-[#888888]">
              {isLoadingPins ? "Loading..." : `${pinnedMessages.length} pinned message${pinnedMessages.length === 1 ? "" : "s"}`}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[400px] overflow-y-auto space-y-2 scrollbar-thin">
            {pinnedMessages.length === 0 ? (
              <div className="text-center py-8 text-[#888888]">
                No pinned messages yet
              </div>
            ) : (
              pinnedMessages.map((msg) => (
                <div key={msg.id} className="bg-[#0a0a0a] rounded-md p-3 border border-[#222222]">
                  <div className="flex items-center gap-2 mb-1">
                    <Avatar className="w-6 h-6">
                      <AvatarImage src={msg.author?.avatar} />
                      <AvatarFallback className="bg-[#8B5CF6] text-white text-xs">
                        {(msg.author?.displayName || msg.author?.username || "?").charAt(0).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <span className="font-medium text-sm text-white">
                      {msg.author?.displayName || msg.author?.username || "Unknown"}
                    </span>
                    <span className="text-xs text-[#666666]">
                      {formatTime(msg.createdAt)}
                    </span>
                    <button
                      onClick={() => void handlePinToggle(msg)}
                      className="ml-auto p-1 hover:bg-[#222222] rounded-md transition-colors"
                      title="Unpin"
                    >
                      <Pin className="w-4 h-4 text-[#8B5CF6]" />
                    </button>
                  </div>
                  <p className="text-sm text-[#dcddde]">{msg.content || "(attachment)"}</p>
                </div>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Right-click context menu */}
      {contextMenu && (
        <div
          className="fixed z-50 bg-[#1a1a1a] border border-[#222222] rounded-md shadow-xl py-1 min-w-[180px]"
          style={{ left: Math.min(contextMenu.x, window.innerWidth - 200), top: Math.min(contextMenu.y, window.innerHeight - 300) }}
          onClick={() => setContextMenu(null)}
        >
          <button
            onClick={() => handleReply(contextMenu.message)}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[#dcddde] hover:bg-[#222222] transition-colors text-left"
          >
            <Reply className="w-4 h-4" /> Reply
          </button>
          <button
            onClick={() => handleReactionPickerOpen(contextMenu.message.id)}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[#dcddde] hover:bg-[#222222] transition-colors text-left"
          >
            <Smile className="w-4 h-4" /> Add Reaction
          </button>
          <button
            onClick={() => handleCopyMessage(contextMenu.message.content)}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[#dcddde] hover:bg-[#222222] transition-colors text-left"
          >
            <Copy className="w-4 h-4" /> Copy Text
          </button>
          <div className="h-px bg-[#222222] my-1" />
          <button
            onClick={() => void handlePinToggle(contextMenu.message)}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[#dcddde] hover:bg-[#222222] transition-colors text-left"
          >
            <Pin className="w-4 h-4" /> {contextMenu.message.pinned ? "Unpin" : "Pin"}
          </button>
          {contextMenu.message.authorId === user?.id && (
            <>
              <div className="h-px bg-[#222222] my-1" />
              <button
                onClick={() => startEditing(contextMenu.message)}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[#dcddde] hover:bg-[#222222] transition-colors text-left"
              >
                <Pencil className="w-4 h-4" /> Edit
              </button>
              <button
                onClick={() => setDeleteConfirmMessage(contextMenu.message)}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 transition-colors text-left"
              >
                <Trash2 className="w-4 h-4" /> Delete
              </button>
            </>
          )}
        </div>
      )}

      {/* Image Lightbox */}
      <ImageLightbox
        items={standaloneMedia ? [standaloneMedia] : mediaGallery}
        currentIndex={standaloneMedia ? 0 : lightboxIndex ?? 0}
        isOpen={lightboxIndex !== null || standaloneMedia !== null}
        onNavigate={standaloneMedia ? undefined : setLightboxIndex}
        onClose={() => {
          setLightboxIndex(null);
          setStandaloneMedia(null);
        }}
      />
    </div>
  );
}

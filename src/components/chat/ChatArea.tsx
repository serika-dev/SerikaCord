"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
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
import { CustomEmojiPicker } from "@/components/chat/CustomEmojiPicker";
import { LinkEmbed } from "@/components/chat/LinkEmbed";
import { MessageContent } from "@/components/chat/MessageContent";
import { MessageSkeleton } from "@/components/ui/skeleton";
import { ImageLightbox } from "@/components/ui/image-lightbox";
import { buildGalleryFromMessages, findGalleryIndex } from "@/lib/chat/media";

interface Message {
  id: string;
  content: string;
  type?: "default" | "reply" | "system";
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
      url?: string;
    };
    count: number;
    userIds: string[];
  }>;
  customEmojis?: Array<{
    id: string;
    name: string;
    animated?: boolean;
    url: string;
  }>;
  mentionEveryone?: boolean;
  mentionedUserIds?: string[];
  mentionedRoleIds?: string[];
  mentionedChannelIds?: string[];
}

interface MentionUser {
  id: string;
  username: string;
  displayName: string;
}

interface MentionRole {
  id: string;
  name: string;
  color?: string;
  mentionable?: boolean;
  isDefault?: boolean;
}

interface MentionSuggestion {
  id: string;
  kind: "user" | "role" | "everyone" | "here";
  label: string;
  description?: string;
  color?: string;
}

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function replaceAliasMention(content: string, alias: string, token: string): string {
  if (!alias) return content;
  const escapedAlias = escapeRegex(alias);
  const pattern = new RegExp(`(^|\\s)@${escapedAlias}(?=$|[\\s.,!?;:])`, "gi");
  return content.replace(pattern, (_match, prefix: string) => `${prefix}${token}`);
}

function extractDraftMentionIds(content: string): {
  mentionEveryone: boolean;
  mentionedUserIds: string[];
  mentionedRoleIds: string[];
  mentionedChannelIds: string[];
} {
  const mentionedUserIds = Array.from(
    new Set(Array.from(content.matchAll(/<@!?([a-f0-9]{24})>/gi)).map((match) => match[1]))
  );
  const mentionedRoleIds = Array.from(
    new Set(Array.from(content.matchAll(/<@&([a-f0-9]{24})>/gi)).map((match) => match[1]))
  );
  const mentionedChannelIds = Array.from(
    new Set(Array.from(content.matchAll(/<#([a-f0-9]{24})>/gi)).map((match) => match[1]))
  );
  return {
    mentionEveryone: /(^|\s)@(everyone|here)\b/i.test(content),
    mentionedUserIds,
    mentionedRoleIds,
    mentionedChannelIds,
  };
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
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttempts = useRef(0);
  const typingTimeoutsRef = useRef<Record<string, NodeJS.Timeout>>({});
  const lastTypingSentAtRef = useRef(0);

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
  const [composerPickerTab, setComposerPickerTab] = useState<"emoji" | "gifs" | "stickers">("emoji");

  // Reaction picker
  const [reactionPickerMessage, setReactionPickerMessage] = useState<string | null>(null);

  // Server emojis
  const [serverEmojis, setServerEmojis] = useState<Array<{
    id: string;
    name: string;
    url: string;
    serverId: string;
    animated?: boolean;
  }>>([]);
  const [mentionUsers, setMentionUsers] = useState<MentionUser[]>([]);
  const [mentionRoles, setMentionRoles] = useState<MentionRole[]>([]);
  const [currentUserRoleIds, setCurrentUserRoleIds] = useState<string[]>([]);
  const [mentionSuggestions, setMentionSuggestions] = useState<MentionSuggestion[]>([]);
  const [activeMentionIndex, setActiveMentionIndex] = useState(0);
  const mentionRangeRef = useRef<{ start: number; end: number } | null>(null);

  // Typing indicator
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const [replyToMessage, setReplyToMessage] = useState<Message | null>(null);

  // Header utilities
  const [isChannelMuted, setIsChannelMuted] = useState(false);
  const [showPins, setShowPins] = useState(false);
  const [pinnedMessages, setPinnedMessages] = useState<Message[]>([]);
  const [isLoadingPins, setIsLoadingPins] = useState(false);
  const [showInbox, setShowInbox] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<Message[]>([]);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [standaloneMedia, setStandaloneMedia] = useState<{ src: string; alt?: string } | null>(null);

  // Detect mobile
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  // Fetch server emojis
  useEffect(() => {
    const fetchServerEmojis = async () => {
      if (!currentServer) {
        setServerEmojis([]);
        return;
      }
      try {
        const response = await fetch(`/api/servers/${currentServer.id}/emojis`);
        if (response.ok) {
          const data = await response.json();
          const mapped = (data.emojis || []).map((emoji: { id?: string; _id?: string; name?: string; url?: string; imageUrl?: string; serverId?: string; animated?: boolean }) => ({
            id: emoji.id || emoji._id,
            name: emoji.name,
            url: emoji.url || emoji.imageUrl,
            serverId: emoji.serverId,
            animated: emoji.animated,
          }));
          setServerEmojis(mapped);
        }
      } catch (error) {
        console.error("Failed to fetch server emojis:", error);
      }
    };
    fetchServerEmojis();
  }, [currentServer]);

  useEffect(() => {
    const fetchMentionSources = async () => {
      if (!currentServer) {
        setMentionUsers([]);
        setMentionRoles([]);
        setCurrentUserRoleIds([]);
        return;
      }

      try {
        const [membersResponse, rolesResponse] = await Promise.all([
          fetch(`/api/servers/${currentServer.id}/members`),
          fetch(`/api/servers/${currentServer.id}/roles`),
        ]);

        if (membersResponse.ok) {
          const membersData = await membersResponse.json();
          const members = (membersData.members || []) as Array<{
            id: string;
            username: string;
            displayName: string;
            roles?: Array<{ id: string }>;
          }>;

          setMentionUsers(
            members.map((member) => ({
              id: member.id,
              username: member.username,
              displayName: member.displayName || member.username,
            }))
          );

          const self = members.find((member) => member.id === user?.id);
          setCurrentUserRoleIds((self?.roles || []).map((role) => role.id));
        } else {
          setMentionUsers([]);
          setCurrentUserRoleIds([]);
        }

        if (rolesResponse.ok) {
          const rolesData = await rolesResponse.json();
          const roles = (rolesData.roles || []) as Array<{
            id: string;
            name: string;
            color?: string;
            mentionable?: boolean;
            isDefault?: boolean;
          }>;
          setMentionRoles(roles);
        } else {
          setMentionRoles([]);
        }
      } catch (error) {
        console.error("Failed to fetch mention sources:", error);
        setMentionUsers([]);
        setMentionRoles([]);
        setCurrentUserRoleIds([]);
      }
    };

    void fetchMentionSources();
  }, [currentServer, user?.id]);

  const fetchMessages = useCallback(async () => {
    if (!currentChannel) return;

    setIsLoading(true);
    setTypingUsers([]);
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

  const fetchPinnedMessages = useCallback(async () => {
    if (!currentChannel) return;
    setIsLoadingPins(true);
    try {
      const response = await fetch(`/api/channels/${currentChannel.id}/pins?limit=50`);
      if (!response.ok) return;
      const data = await response.json();
      setPinnedMessages(data.messages || []);
    } catch {
      // best-effort UI
    } finally {
      setIsLoadingPins(false);
    }
  }, [currentChannel]);

  const runMessageSearch = useCallback(async (query: string) => {
    if (!currentChannel || query.trim().length < 2) {
      setSearchResults([]);
      return;
    }

    setIsSearching(true);
    try {
      const response = await fetch(
        `/api/channels/${currentChannel.id}/messages/search?q=${encodeURIComponent(query)}&limit=20`
      );
      if (!response.ok) return;
      const data = await response.json();
      setSearchResults(data.messages || []);
    } catch {
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  }, [currentChannel]);

  useEffect(() => {
    if (!currentChannel) return;
    const key = `channel-muted:${currentChannel.id}`;
    setIsChannelMuted(localStorage.getItem(key) === "1");
    setReplyToMessage(null);
    setSearchQuery("");
    setSearchResults([]);
    setShowSearchResults(false);
    mentionRangeRef.current = null;
    setMentionSuggestions([]);
    setActiveMentionIndex(0);
    void fetchPinnedMessages();
  }, [currentChannel, fetchPinnedMessages]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void runMessageSearch(searchQuery);
    }, 220);
    return () => clearTimeout(timer);
  }, [searchQuery, runMessageSearch]);

  const updateMentionSuggestions = useCallback(
    (draft: string, explicitCaretPosition?: number | null) => {
      const caretPosition =
        explicitCaretPosition ??
        (typeof textareaRef.current?.selectionStart === "number"
          ? textareaRef.current.selectionStart
          : draft.length);
      const beforeCursor = draft.slice(0, caretPosition);
      const mentionMatch = beforeCursor.match(/(^|\s)@([^\s@]{0,40})$/);

      if (!mentionMatch) {
        mentionRangeRef.current = null;
        setMentionSuggestions([]);
        setActiveMentionIndex(0);
        return;
      }

      const tokenPrefix = mentionMatch[1] || "";
      const queryRaw = mentionMatch[2] || "";
      const query = queryRaw.toLowerCase();
      const mentionStart = caretPosition - queryRaw.length - 1;
      if (mentionStart - tokenPrefix.length < 0) {
        mentionRangeRef.current = null;
        setMentionSuggestions([]);
        return;
      }

      const staticSuggestionPool: MentionSuggestion[] = [
        { id: "everyone", kind: "everyone", label: "everyone", description: "Notify everyone in this channel" },
        { id: "here", kind: "here", label: "here", description: "Notify currently active members" },
      ];
      const staticSuggestions = staticSuggestionPool.filter((entry) => entry.label.startsWith(query));

      const userSuggestions = mentionUsers
        .filter((entry) => {
          const username = entry.username.toLowerCase();
          const displayName = entry.displayName.toLowerCase();
          return query.length === 0 || username.includes(query) || displayName.includes(query);
        })
        .sort((a, b) => a.displayName.localeCompare(b.displayName))
        .slice(0, 8)
        .map((entry) => ({
          id: entry.id,
          kind: "user" as const,
          label: entry.displayName,
          description: `@${entry.username}`,
        }));

      const roleSuggestions = mentionRoles
        .filter((entry) => !entry.isDefault)
        .filter((entry) => {
          const roleName = entry.name.toLowerCase();
          return query.length === 0 || roleName.includes(query);
        })
        .sort((a, b) => a.name.localeCompare(b.name))
        .slice(0, 8)
        .map((entry) => ({
          id: entry.id,
          kind: "role" as const,
          label: entry.name,
          description: entry.mentionable ? "Role mention" : "Role mention",
          color: entry.color,
        }));

      const nextSuggestions = [...staticSuggestions, ...userSuggestions, ...roleSuggestions].slice(0, 12);

      if (!nextSuggestions.length) {
        mentionRangeRef.current = null;
        setMentionSuggestions([]);
        setActiveMentionIndex(0);
        return;
      }

      mentionRangeRef.current = {
        start: mentionStart,
        end: caretPosition,
      };
      setMentionSuggestions(nextSuggestions);
      setActiveMentionIndex(0);
    },
    [mentionRoles, mentionUsers]
  );

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

  const sendTypingStatus = useCallback(async (content?: string) => {
    const draft = content ?? newMessage;
    if (!currentChannel || !draft.trim()) return;

    const now = Date.now();
    if (now - lastTypingSentAtRef.current < 2000) {
      return;
    }
    lastTypingSentAtRef.current = now;

    try {
      await fetch(`/api/channels/${currentChannel.id}/typing`, {
        method: "POST",
        keepalive: true,
      });
    } catch {
      // Best-effort signal only.
    }
  }, [currentChannel, newMessage]);

  const insertMentionFromSuggestion = useCallback(
    (suggestion: MentionSuggestion) => {
      const activeRange = mentionRangeRef.current;
      if (!activeRange) return;

      const mentionToken =
        suggestion.kind === "user"
          ? `<@${suggestion.id}>`
          : suggestion.kind === "role"
            ? `<@&${suggestion.id}>`
            : suggestion.kind === "everyone"
              ? "@everyone"
              : "@here";

      const before = newMessage.slice(0, activeRange.start);
      const after = newMessage.slice(activeRange.end);
      const separator = after.startsWith(" ") || after.startsWith("\n") || after.length === 0 ? "" : " ";
      const nextMessage = `${before}${mentionToken}${separator}${after}`;
      const nextCaret = before.length + mentionToken.length + separator.length;

      setNewMessage(nextMessage);
      mentionRangeRef.current = null;
      setMentionSuggestions([]);
      setActiveMentionIndex(0);

      requestAnimationFrame(() => {
        if (!textareaRef.current) return;
        textareaRef.current.focus();
        textareaRef.current.style.height = "44px";
        textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 300) + "px";
        textareaRef.current.setSelectionRange(nextCaret, nextCaret);
      });

      void sendTypingStatus(nextMessage);
    },
    [newMessage, sendTypingStatus]
  );

  const applyReactionEvent = useCallback(
    (messageId: string, emoji: string, userId: string, isAdd: boolean) => {
      setMessages((prev) =>
        prev.map((msg) => {
          if (msg.id !== messageId) return msg;

          const reactions = msg.reactions || [];
          const reactionIndex = reactions.findIndex(
            (reaction) => reaction.emoji.id === emoji || reaction.emoji.name === emoji
          );

          if (reactionIndex === -1) {
            if (!isAdd) return msg;
            return {
              ...msg,
              reactions: [...reactions, { emoji: { name: emoji }, count: 1, userIds: [userId] }],
            };
          }

          const targetReaction = reactions[reactionIndex];
          const alreadyReacted = targetReaction.userIds.includes(userId);
          if (isAdd && alreadyReacted) return msg;
          if (!isAdd && !alreadyReacted) return msg;

          const nextReactions = reactions
            .map((reaction, index) => {
              if (index !== reactionIndex) return reaction;
              const nextUserIds = isAdd
                ? [...reaction.userIds, userId]
                : reaction.userIds.filter((id) => id !== userId);
              return {
                ...reaction,
                userIds: nextUserIds,
                count: nextUserIds.length,
              };
            })
            .filter((reaction) => reaction.count > 0);

          return {
            ...msg,
            reactions: nextReactions,
          };
        })
      );
    },
    []
  );

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
        if (data.type === "connected" || data.type === "ping") return;

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
              type: data.message.type,
              authorId:
                typeof data.message.authorId === "object"
                  ? data.message.authorId._id || data.message.authorId.id
                  : data.message.authorId,
              author: author || {
                id: "unknown",
                username: "unknown",
                displayName: "Unknown",
              },
              channelId: data.message.channelId,
              createdAt: data.message.createdAt,
              updatedAt: data.message.updatedAt,
              edited: data.message.edited,
              pinned: data.message.pinned,
              referencedMessageId: data.message.referencedMessageId,
              referencedMessage: data.message.referencedMessage,
              attachments: data.message.attachments || [],
              reactions: data.message.reactions || [],
              customEmojis: data.message.customEmojis || [],
              mentionEveryone: Boolean(data.message.mentionEveryone),
              mentionedUserIds: data.message.mentionedUserIds || [],
              mentionedRoleIds: data.message.mentionedRoleIds || [],
              mentionedChannelIds: data.message.mentionedChannelIds || [],
            };
            const incomingAuthorId = newMsg.authorId || newMsg.author?.id;
            const ownTempIndex = prev.findIndex(
              (msg) =>
                msg.id.startsWith("temp-") &&
                msg.authorId === user?.id &&
                incomingAuthorId === user?.id &&
                msg.content === newMsg.content
            );

            if (ownTempIndex !== -1) {
              return prev.map((msg, index) => (index === ownTempIndex ? newMsg : msg));
            }

            return [...prev, newMsg];
          });
          return;
        }

        if (data.type === "edit") {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === data.messageId
                ? {
                  ...m,
                  content: data.content ?? m.content,
                  pinned: data.pinned !== undefined ? Boolean(data.pinned) : m.pinned,
                  edited: data.content !== undefined ? true : m.edited,
                  updatedAt: new Date().toISOString(),
                }
                : m
            )
          );
          return;
        }

        if (data.type === "delete") {
          setMessages((prev) => prev.filter((m) => m.id !== data.messageId));
          return;
        }

        if (data.type === "reaction_add") {
          applyReactionEvent(data.messageId, data.emoji, data.userId, true);
          return;
        }

        if (data.type === "reaction_remove") {
          applyReactionEvent(data.messageId, data.emoji, data.userId, false);
          return;
        }

        if (data.type === "typing") {
          addTypingUser(data.username);
          return;
        }

        if (data.type === "pin_update") {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === data.messageId ? { ...m, pinned: Boolean(data.pinned) } : m
            )
          );
          void fetchPinnedMessages();
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
  }, [addTypingUser, applyReactionEvent, currentChannel, fetchPinnedMessages, user?.id]);

  useEffect(() => {
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
  }, [connectSSE]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
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
      } catch {
        toast.error(`Failed to upload ${file.name}`);
      }
    }

    return uploadedAttachments;
  };

  const normalizeMessageMentions = useCallback(
    (content: string): string => {
      let nextContent = content;

      const roleCandidates = [...mentionRoles]
        .filter((role) => !role.isDefault)
        .sort((a, b) => b.name.length - a.name.length);
      for (const role of roleCandidates) {
        nextContent = replaceAliasMention(nextContent, role.name, `<@&${role.id}>`);
      }

      const userAliasMap = new Map<string, string>();
      for (const mentionUser of mentionUsers) {
        const aliases = [mentionUser.displayName, mentionUser.username];
        for (const alias of aliases) {
          const normalizedAlias = alias.trim().toLowerCase();
          if (!normalizedAlias || normalizedAlias === "everyone" || normalizedAlias === "here") continue;
          if (!userAliasMap.has(normalizedAlias)) {
            userAliasMap.set(normalizedAlias, mentionUser.id);
          }
        }
      }

      const userCandidates = Array.from(userAliasMap.entries())
        .sort((a, b) => b[0].length - a[0].length)
        .map(([alias, id]) => ({ alias, id }));

      for (const userCandidate of userCandidates) {
        nextContent = replaceAliasMention(nextContent, userCandidate.alias, `<@${userCandidate.id}>`);
      }

      return nextContent;
    },
    [mentionRoles, mentionUsers]
  );

  const handleSendMessage = async (contentOverride?: string) => {
    if (isSending || !currentChannel) return;

    const isOverrideSend = typeof contentOverride === "string";
    const rawMessageContent = isOverrideSend ? contentOverride : newMessage;
    const messageContent = currentServer ? normalizeMessageMentions(rawMessageContent) : rawMessageContent;
    const pendingAttachments = isOverrideSend ? [] : attachments;

    if (!messageContent.trim() && pendingAttachments.length === 0) return;

    const replyReference = replyToMessage;
    if (!isOverrideSend) {
      setNewMessage("");
      mentionRangeRef.current = null;
      setMentionSuggestions([]);
      setActiveMentionIndex(0);
    }
    lastTypingSentAtRef.current = 0;
    setIsSending(true);

    if (textareaRef.current) {
      textareaRef.current.style.height = "44px";
    }

    let tempId: string | null = null;

    try {
      let uploadedAttachments: Array<{ id: string; url: string; filename: string; contentType: string }> = [];

      if (pendingAttachments.length > 0) {
        setIsUploading(true);
        uploadedAttachments = await uploadAttachments();
        setIsUploading(false);
        setAttachments([]);
        setAttachmentPreviews([]);
      }

      tempId = `temp-${Date.now()}`;
      const optimisticMentionData = extractDraftMentionIds(messageContent);
      const optimisticMessage: Message = {
        id: tempId,
        content: messageContent,
        type: replyReference ? "reply" : "default",
        authorId: user?.id || "unknown",
        author: {
          id: user?.id || "unknown",
          username: user?.username || "unknown",
          displayName: user?.displayName || user?.username || "Unknown",
          avatar: user?.avatar,
        },
        channelId: currentChannel.id,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        referencedMessageId: replyReference?.id,
        referencedMessage: replyReference
          ? {
            id: replyReference.id,
            content: replyReference.content,
            author: replyReference.author,
            createdAt: replyReference.createdAt,
          }
          : undefined,
        attachments: uploadedAttachments,
        reactions: [],
        customEmojis: [],
        mentionEveryone: optimisticMentionData.mentionEveryone,
        mentionedUserIds: optimisticMentionData.mentionedUserIds,
        mentionedRoleIds: optimisticMentionData.mentionedRoleIds,
        mentionedChannelIds: optimisticMentionData.mentionedChannelIds,
      };

      setMessages((prev) => [...prev, optimisticMessage]);

      const response = await fetch(`/api/channels/${currentChannel.id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: messageContent,
          replyTo: replyReference?.id,
          attachments: uploadedAttachments,
        }),
      });

      if (response.ok) {
        const payload = await response.json().catch(() => null);
        const message = payload?.message || payload;
        if (message && (message.id || message._id)) {
          const messageId = message.id || message._id;
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === tempId
                ? {
                  ...msg,
                  id: messageId,
                  content: message.content ?? msg.content,
                  type: message.type ?? msg.type,
                  authorId:
                    typeof message.authorId === "object"
                      ? message.authorId._id || message.authorId.id || msg.authorId
                      : message.authorId || msg.authorId,
                  author: message.author || msg.author,
                  createdAt: message.createdAt || msg.createdAt,
                  updatedAt: message.updatedAt || msg.updatedAt,
                  referencedMessageId: message.referencedMessageId || msg.referencedMessageId,
                  referencedMessage: message.referencedMessage || msg.referencedMessage,
                  attachments: message.attachments || msg.attachments,
                  reactions: message.reactions || msg.reactions,
                  customEmojis: message.customEmojis || msg.customEmojis,
                  mentionEveryone:
                    message.mentionEveryone !== undefined ? Boolean(message.mentionEveryone) : msg.mentionEveryone,
                  mentionedUserIds: message.mentionedUserIds || msg.mentionedUserIds,
                  mentionedRoleIds: message.mentionedRoleIds || msg.mentionedRoleIds,
                  mentionedChannelIds: message.mentionedChannelIds || msg.mentionedChannelIds,
                }
                : msg
            )
          );
        }
      } else {
        setMessages((prev) => prev.filter((msg) => msg.id !== tempId));
        if (!isOverrideSend) {
          setNewMessage(rawMessageContent);
        }
        toast.error("Failed to send message");
      }
    } catch {
      if (tempId) {
        setMessages((prev) => prev.filter((msg) => msg.id !== tempId));
      }
      if (!isOverrideSend) {
        setNewMessage(rawMessageContent);
      }
      toast.error("Failed to send message");
    } finally {
      setIsSending(false);
      setReplyToMessage(null);
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
    } catch {
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
    } catch {
      toast.error("Failed to delete message");
    }
  };

  const handleCopyMessage = (content: string) => {
    navigator.clipboard.writeText(content);
    toast.success("Copied to clipboard");
  };

  const toggleChannelNotifications = () => {
    if (!currentChannel) return;
    const next = !isChannelMuted;
    setIsChannelMuted(next);
    localStorage.setItem(`channel-muted:${currentChannel.id}`, next ? "1" : "0");
    toast.success(next ? "Channel notifications muted" : "Channel notifications enabled");
  };

  const handlePinToggle = async (message: Message) => {
    if (!currentChannel) return;

    try {
      const endpoint = `/api/channels/${currentChannel.id}/messages/${message.id}/pin`;
      const response = await fetch(endpoint, {
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

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (mentionSuggestions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveMentionIndex((prev) => (prev + 1) % mentionSuggestions.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveMentionIndex((prev) => (prev - 1 + mentionSuggestions.length) % mentionSuggestions.length);
        return;
      }
      if ((e.key === "Enter" && !e.shiftKey) || e.key === "Tab") {
        e.preventDefault();
        const selected = mentionSuggestions[activeMentionIndex];
        if (selected) {
          insertMentionFromSuggestion(selected);
        }
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        mentionRangeRef.current = null;
        setMentionSuggestions([]);
        setActiveMentionIndex(0);
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSendMessage();
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
    const value = e.target.value;
    setNewMessage(value);
    if (textareaRef.current) {
      textareaRef.current.style.height = "44px";
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 300) + "px";
    }
    if (value.trim()) {
      void sendTypingStatus(value);
    }
    updateMentionSuggestions(value, e.target.selectionStart);
  };

  const handleEmojiSelect = (emoji: string) => {
    setNewMessage((prev) => {
      const next = prev + emoji;
      void sendTypingStatus(next);
      return next;
    });
    setShowEmojiPicker(false);
    textareaRef.current?.focus();
  };

  const handleGifSelect = (gifUrl: string) => {
    setShowEmojiPicker(false);
    setComposerPickerTab("emoji");
    void handleSendMessage(gifUrl);
  };

  const handleStickerSelect = (stickerUrl: string) => {
    setNewMessage((prev) => {
      const separator = prev.trim().length > 0 ? " " : "";
      return `${prev}${separator}${stickerUrl}`;
    });
    setShowEmojiPicker(false);
    setComposerPickerTab("emoji");
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
  const groupedMessages = useMemo(
    () =>
      messages.reduce((groups, message, index) => {
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
      }, [] as Array<{ author: Message["author"]; messages: Message[] }>),
    [messages]
  );

  const typingStatusText = useMemo(() => {
    if (typingUsers.length === 0) return "";
    if (typingUsers.length === 1) return `${typingUsers[0]} is typing...`;
    if (typingUsers.length === 2) return `${typingUsers[0]} and ${typingUsers[1]} are typing...`;
    return `${typingUsers[0]}, ${typingUsers[1]} and ${typingUsers.length - 2} others are typing...`;
  }, [typingUsers]);

  const mediaGallery = useMemo(() => buildGalleryFromMessages(messages), [messages]);

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

  const inboxItems = useMemo(() => {
    const currentUserId = user?.id;
    const currentUsername = user?.username?.toLowerCase() || "";
    const userTokenRegex = currentUserId ? new RegExp(`<@!?${escapeRegex(currentUserId)}>`, "i") : null;
    return messages
      .filter((message) => {
        const mentionedDirectly =
          (currentUserId && message.mentionedUserIds?.includes(currentUserId)) ||
          (userTokenRegex ? userTokenRegex.test(message.content) : false) ||
          (currentUsername ? message.content.toLowerCase().includes(`@${currentUsername}`) : false);

        const mentionedByRole =
          Boolean(message.mentionedRoleIds?.some((roleId) => currentUserRoleIds.includes(roleId))) ||
          currentUserRoleIds.some((roleId) => message.content.includes(`<@&${roleId}>`));

        const mentionedEveryone =
          Boolean(message.mentionEveryone) || /(^|\s)@(everyone|here)\b/i.test(message.content);

        return Boolean(mentionedDirectly || mentionedByRole || mentionedEveryone);
      })
      .slice(-20)
      .reverse();
  }, [currentUserRoleIds, messages, user?.id, user?.username]);

  if (!currentChannel) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-[var(--bg-app)] text-[var(--text-secondary)]">
        <div className="w-40 h-40 mb-4 rounded-full bg-[var(--bg-card)] flex items-center justify-center border border-[var(--border-subtle)]">
          <Hash className="w-20 h-20 text-[#8B5CF6]" />
        </div>
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-2">
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
    <div className="chat-shell flex-1 flex flex-col bg-[var(--app-bg)] min-w-0 min-h-0 overflow-hidden">
      {/* Channel Header */}
      <div className="h-12 px-2 sm:px-4 flex items-center justify-between border-b border-[var(--app-border)] bg-[var(--app-surface)] flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          {isMobile && (
            <button
              onClick={() => router.push(`/channels/${currentServer?.id}`)}
              className="p-2 -ml-1 rounded-lg hover:bg-[var(--app-surface-alt)] transition-colors"
            >
              <ChevronLeft className="w-5 h-5 text-[var(--app-muted)]" />
            </button>
          )}
          <Hash className="w-5 sm:w-6 h-5 sm:h-6 text-[var(--app-muted-2)] flex-shrink-0" />
          <span className="font-semibold text-[var(--text-primary)] truncate text-sm sm:text-base">{currentChannel.name}</span>
        </div>
        <div className="flex items-center gap-2 sm:gap-4 text-[var(--app-muted)]">
          <button
            className="hover:text-[var(--text-primary)] transition-colors hidden sm:block"
            onClick={toggleChannelNotifications}
            title={isChannelMuted ? "Enable notifications" : "Mute notifications"}
          >
            <Bell className={cn("w-5 h-5", isChannelMuted && "text-red-400")} />
          </button>
          <button
            className="hover:text-[var(--text-primary)] transition-colors hidden sm:block"
            onClick={() => {
              setShowPins(true);
              void fetchPinnedMessages();
            }}
            title="View pinned messages"
          >
            <Pin className="w-5 h-5" />
          </button>
          <button
            onClick={onToggleMembers}
            className={cn("hover:text-[var(--text-primary)] transition-colors", showMembers && "text-[var(--text-primary)]")}
          >
            <Users className="w-5 h-5" />
          </button>
          <div className="h-6 w-px bg-[var(--app-border)] hidden md:block" />
          <div className="relative hidden md:block">
            <input
              type="text"
              placeholder="Search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-32 h-6 px-2 rounded bg-[var(--app-surface-alt)] text-sm text-[var(--text-primary)] placeholder:text-[var(--app-muted)] focus:outline-none focus:w-48 transition-all"
              onFocus={() => setShowSearchResults(true)}
            />
            <Search className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--app-muted)]" />
          </div>
          <button
            className="hover:text-[var(--text-primary)] transition-colors hidden sm:block"
            onClick={() => setShowInbox(true)}
            title="Open inbox"
          >
            <Inbox className="w-5 h-5" />
          </button>
          <button
            className="hover:text-[var(--text-primary)] transition-colors hidden sm:block"
            onClick={() => setShowHelp(true)}
            title="Open help"
          >
            <HelpCircle className="w-5 h-5" />
          </button>
        </div>
      </div>

      {showSearchResults && (
        <div className="px-4 py-2 border-b border-[var(--app-border)] bg-[var(--app-surface)]/95">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs uppercase tracking-wider text-[var(--app-muted)]">Search Results</p>
            <button
              onClick={() => setShowSearchResults(false)}
              className="text-xs text-[var(--app-muted)] hover:text-[var(--text-primary)] transition-colors"
            >
              Close
            </button>
          </div>
          {searchQuery.trim().length < 2 ? (
            <p className="text-sm text-[var(--app-muted)]">Type at least 2 characters to search this channel.</p>
          ) : isSearching ? (
            <div className="flex items-center gap-2 text-sm text-[var(--app-muted)]">
              <Loader2 className="w-4 h-4 animate-spin" />
              Searching...
            </div>
          ) : searchResults.length === 0 ? (
            <p className="text-sm text-[var(--app-muted)]">No matching messages.</p>
          ) : (
            <div className="space-y-1 max-h-44 overflow-y-auto pr-1">
              {searchResults.map((result) => (
                <button
                  key={`search-${result.id}`}
                  onClick={() => {
                    document.getElementById(`message-${result.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
                    setShowSearchResults(false);
                  }}
                  className="w-full text-left p-2 rounded-md bg-[var(--app-surface-alt)] hover:brightness-110 transition"
                >
                  <p className="text-xs text-[var(--app-muted)] mb-0.5">
                    {result.author?.displayName || result.author?.username || "Unknown"} • {formatTimestamp(result.createdAt)}
                  </p>
                  <p className="text-sm text-[var(--text-primary)] line-clamp-2">{result.content || "(attachment)"}</p>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Messages Area */}
      <ScrollArea className="chat-scroller flex-1 min-h-0">
        <div className="flex flex-col py-4">
          {/* Channel Welcome */}
          <div className="px-4 pb-4 mb-4 border-b border-[var(--app-border)]">
            <div className="w-16 h-16 mb-2 rounded-2xl bg-[var(--app-surface-alt)] flex items-center justify-center border border-[var(--app-border)]">
              <Hash className="w-10 h-10 text-[var(--text-primary)]" />
            </div>
            <h1 className="text-3xl font-bold text-[var(--text-primary)] mb-2">Welcome to #{currentChannel.name}!</h1>
            <p className="text-[var(--app-muted)]">This is the start of the #{currentChannel.name} channel.</p>
          </div>

          {/* Messages */}
          {isLoading ? (
            <MessageSkeleton count={5} />
          ) : groupedMessages.length === 0 ? (
            <div className="text-center text-[var(--text-muted)] py-8">No messages yet. Be the first to say something!</div>
          ) : (
            groupedMessages.map((group, groupIndex) => (
              <div
                key={groupIndex}
                className="chat-message-row group py-0.5 hover:bg-[var(--app-surface-alt)]/80 message-hover transition-colors"
              >
                <div className="flex gap-4">
                  <div className="w-10 flex-shrink-0">
                    <Avatar className="w-10 h-10 mt-0.5">
                      <AvatarImage src={group.author?.avatar} alt={group.author?.displayName} />
                      <AvatarFallback className="bg-[var(--app-accent)] text-[var(--text-on-accent)]">
                        {group.author?.displayName?.charAt(0).toUpperCase() || "?"}
                      </AvatarFallback>
                    </Avatar>
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2 mb-1">
                      <span className="font-medium text-[var(--text-primary)] hover:underline cursor-pointer">
                        {group.author?.displayName || "Unknown"}
                      </span>
                      <span className="text-xs text-[var(--text-muted)]">{formatTimestamp(group.messages[0].createdAt)}</span>
                    </div>

                    {group.messages.map((message) => (
                      <div key={message.id} id={`message-${message.id}`} className="group/message relative">
                        {editingMessage?.id === message.id ? (
                          <div className="bg-[var(--bg-card)] rounded-md p-2 mb-1 border border-[var(--border-subtle)]">
                            <Textarea
                              value={editContent}
                              onChange={(e) => setEditContent(e.target.value)}
                              onKeyDown={handleEditKeyDown}
                              className="bg-[var(--bg-sidebar-elevated)] border-[var(--border-subtle)] text-[var(--text-primary)] min-h-[40px] mb-2"
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
                            {message.referencedMessage && (
                              <button
                                onClick={() =>
                                  document
                                    .getElementById(`message-${message.referencedMessage?.id}`)
                                    ?.scrollIntoView({ behavior: "smooth", block: "center" })
                                }
                                className="mb-1 text-xs text-[var(--app-muted)] hover:text-[var(--text-primary)] transition-colors flex items-center gap-1 max-w-full"
                              >
                                <Reply className="w-3.5 h-3.5" />
                                <span className="truncate">
                                  Replying to {message.referencedMessage.author?.displayName || message.referencedMessage.author?.username || "message"}:{" "}
                                  {message.referencedMessage.content || "(attachment)"}
                                </span>
                              </button>
                            )}

                            <MessageContent
                              content={message.content}
                              serverEmojis={message.customEmojis?.length ? message.customEmojis : serverEmojis}
                              mentionUsers={mentionUsers}
                              mentionRoles={mentionRoles}
                              currentUserId={user?.id}
                              edited={message.edited}
                              className="chat-message-body text-[var(--app-text)]"
                              onMediaClick={({ src, alt }) => openMediaViewer(src, alt, message.id)}
                            />

                            {message.pinned && (
                              <div className="mt-1 text-[11px] text-[var(--app-muted)] inline-flex items-center gap-1">
                                <Pin className="w-3 h-3" />
                                Pinned message
                              </div>
                            )}

                            {/* Link Embeds */}
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
                                  <video
                                    src={attachment.url}
                                    controls
                                    className="max-w-sm max-h-[350px] rounded-md bg-black"
                                    preload="metadata"
                                  />
                                ) : attachment.contentType.startsWith("audio/") ? (
                                  <audio
                                    src={attachment.url}
                                    controls
                                    className="w-full max-w-sm"
                                  />
                                ) : (
                                  <a
                                    href={attachment.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex items-center gap-2 p-3 bg-[var(--app-surface-alt)] rounded-md hover:brightness-110 max-w-sm transition"
                                  >
                                    <FileText className="w-8 h-8 text-[#8B5CF6]" />
                                    <div className="min-w-0">
                                      <div className="text-[#8B5CF6] hover:underline truncate">{attachment.filename}</div>
                                      <div className="text-xs text-[var(--app-muted)]">{formatFileSize(attachment.size)}</div>
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
                                      key={reaction.emoji.id || reaction.emoji.name}
                                      onClick={() => handleReactionClick(message.id, reaction.emoji.name, hasReacted)}
                                      className={cn(
                                        "flex items-center gap-1 px-2 py-0.5 rounded-full text-sm transition-colors",
                                        hasReacted
                                          ? "bg-[#8B5CF6]/20 border border-[#8B5CF6] text-[var(--text-primary)]"
                                          : "bg-[var(--app-surface-alt)] border border-[var(--app-border)] text-[var(--app-muted)] hover:brightness-110"
                                      )}
                                    >
                                      <span>{reaction.emoji.name}</span>
                                      <span className={hasReacted ? "text-[var(--text-primary)]" : "text-[var(--app-muted)]"}>{reaction.count}</span>
                                    </button>
                                  );
                                })}
                                <button
                                  onClick={() => setReactionPickerMessage(message.id)}
                                  className="flex items-center justify-center w-7 h-7 rounded-full bg-[var(--app-surface-alt)] border border-[var(--app-border)] text-[var(--app-muted)] hover:brightness-110 hover:text-[var(--text-primary)] transition-colors"
                                >
                                  <Plus className="w-4 h-4" />
                                </button>
                              </div>
                            )}

                            {/* Message Actions */}
                            <div className="absolute -top-3 right-0 opacity-0 group-hover/message:opacity-100 transition-opacity z-10">
                              <div className="flex items-center bg-[var(--app-surface-alt)] border border-[var(--app-border)] rounded-md shadow-lg">
                                <Popover
                                  open={reactionPickerMessage === message.id}
                                  onOpenChange={(open) => setReactionPickerMessage(open ? message.id : null)}
                                >
                                  <PopoverTrigger asChild>
                                    <button
                                      className="p-1.5 hover:bg-black/20 rounded-l-md transition-colors"
                                      title="Add Reaction"
                                    >
                                      <Smile className="w-4 h-4 text-[var(--app-muted)]" />
                                    </button>
                                  </PopoverTrigger>
                                  <PopoverContent className="w-auto p-0 border-none" side="top" align="end">
                                    <CustomEmojiPicker
                                      onEmojiSelect={(emoji) => handleAddReaction(message.id, emoji)}
                                      serverEmojis={serverEmojis}
                                    />
                                  </PopoverContent>
                                </Popover>
                                <button
                                  onClick={() => setReplyToMessage(message)}
                                  className="p-1.5 hover:bg-black/20 transition-colors"
                                  title="Reply"
                                >
                                  <Reply className="w-4 h-4 text-[var(--app-muted)]" />
                                </button>
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <button className="p-1.5 hover:bg-black/20 rounded-r-md transition-colors">
                                      <MoreHorizontal className="w-4 h-4 text-[var(--app-muted)]" />
                                    </button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent
                                    align="end"
                                    className="bg-[var(--bg-card)] border-[var(--border-subtle)] text-[var(--text-primary)] min-w-[160px]"
                                  >
                                    <DropdownMenuItem
                                      onClick={() => handleCopyMessage(message.content)}
                                      className="hover:bg-[var(--bg-hover)] cursor-pointer"
                                    >
                                      <Copy className="w-4 h-4 mr-2" />
                                      Copy Text
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      onClick={() => handlePinToggle(message)}
                                      className="hover:bg-[var(--bg-hover)] cursor-pointer"
                                    >
                                      <Pin className="w-4 h-4 mr-2" />
                                      {message.pinned ? "Unpin Message" : "Pin Message"}
                                    </DropdownMenuItem>
                                    {message.authorId === user?.id && (
                                      <>
                                        <DropdownMenuSeparator className="bg-[#2a2a2a]" />
                                        <DropdownMenuItem
                                          onClick={() => {
                                            setEditingMessage(message);
                                            setEditContent(message.content);
                                          }}
                                          className="hover:bg-[var(--bg-hover)] cursor-pointer"
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
          <div ref={messagesEndRef} />
        </div>
      </ScrollArea>

      {/* Typing Indicator */}
      {typingStatusText && (
        <div className="px-4 py-1.5 text-sm text-[var(--app-muted)]">
          <span className="inline-flex items-center gap-2">
            <span className="flex gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--app-accent)] animate-bounce [animation-delay:0ms]" />
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--app-accent)] animate-bounce [animation-delay:120ms]" />
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--app-accent)] animate-bounce [animation-delay:240ms]" />
            </span>
            {typingStatusText}
          </span>
        </div>
      )}

      {/* Attachment Previews */}
      {attachments.length > 0 && (
        <div className="px-4 pb-2">
          <div className="flex flex-wrap gap-2 p-2 bg-[var(--app-surface)] rounded-lg border border-[var(--app-border)]">
            {attachments.map((file, index) => (
              <div key={index} className="relative group">
                {file.type.startsWith("image/") && attachmentPreviews[index] ? (
                  <img src={attachmentPreviews[index]} alt={file.name} className="w-20 h-20 object-cover rounded-md" />
                ) : (
                  <div className="w-20 h-20 bg-[var(--app-surface-alt)] rounded-md flex flex-col items-center justify-center p-2">
                    <FileText className="w-6 h-6 text-[#8B5CF6] mb-1" />
                    <span className="text-xs text-[var(--app-muted)] truncate w-full text-center">{file.name.slice(0, 10)}</span>
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
        {replyToMessage && (
          <div className="mb-2 px-3 py-2 bg-[var(--app-surface)] border border-[var(--app-border)] rounded-lg flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs text-[var(--app-muted)] mb-0.5">
                Replying to {replyToMessage.author?.displayName || replyToMessage.author?.username || "message"}
              </p>
              <p className="text-sm text-[var(--text-primary)] truncate">{replyToMessage.content || "(attachment)"}</p>
            </div>
            <button
              onClick={() => setReplyToMessage(null)}
              className="text-[var(--app-muted)] hover:text-[var(--text-primary)] transition-colors"
              title="Cancel reply"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
        <div className="relative bg-[var(--app-surface)] rounded-lg border border-[var(--app-border)] shadow-[var(--app-elev-1)]">
          {mentionSuggestions.length > 0 && (
            <div className="absolute left-2 right-2 bottom-[calc(100%+8px)] z-20 rounded-md border border-[var(--app-border)] bg-[var(--app-surface-alt)] shadow-[var(--app-elev-2)] overflow-hidden">
              {mentionSuggestions.map((suggestion, index) => (
                <button
                  key={`${suggestion.kind}-${suggestion.id}`}
                  type="button"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    insertMentionFromSuggestion(suggestion);
                  }}
                  className={cn(
                    "w-full flex items-center justify-between gap-3 px-3 py-2 text-left transition-colors",
                    index === activeMentionIndex
                      ? "bg-[var(--app-accent)]/20 text-[var(--text-primary)]"
                      : "hover:bg-[var(--app-surface)] text-[var(--text-primary)]"
                  )}
                >
                  <span className="truncate text-sm">
                    @{suggestion.label}
                  </span>
                  <span className="text-xs text-[var(--app-muted)] truncate">
                    {suggestion.kind === "role" ? "Role" : suggestion.description}
                  </span>
                </button>
              ))}
            </div>
          )}
          <input type="file" ref={fileInputRef} onChange={handleFileSelect} multiple accept="*/*" className="hidden" />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="absolute left-2 sm:left-4 top-1/2 -translate-y-1/2 text-[var(--app-muted)] hover:text-[var(--text-primary)] transition-colors"
            title="Upload file"
          >
            <PlusCircle className="w-5 sm:w-6 h-5 sm:h-6" />
          </button>
          <Textarea
            ref={textareaRef}
            value={newMessage}
            onChange={handleTextareaChange}
            onKeyDown={handleKeyDown}
            onClick={(event) => {
              updateMentionSuggestions(event.currentTarget.value, event.currentTarget.selectionStart);
            }}
            onKeyUp={(event) => {
              updateMentionSuggestions(event.currentTarget.value, event.currentTarget.selectionStart);
            }}
            placeholder={`Message #${currentChannel.name}`}
            className="w-full min-h-[44px] max-h-[300px] py-2.5 pl-10 sm:pl-14 pr-24 sm:pr-36 bg-transparent border-none text-[var(--text-primary)] placeholder:text-[var(--app-muted-2)] resize-none focus-visible:ring-0 focus-visible:ring-offset-0 text-sm sm:text-base"
            rows={1}
            disabled={isSending}
          />
          <div className="absolute right-2 sm:right-4 top-1/2 -translate-y-1/2 flex items-center gap-2 sm:gap-4 text-[var(--app-muted)]">
            <button
              onClick={() => {
                setComposerPickerTab("gifs");
                setShowEmojiPicker(true);
              }}
              className="hover:text-[var(--text-primary)] transition-colors hidden sm:block"
              title="Open GIF picker"
            >
              <Gift className="w-6 h-6" />
            </button>
            <button
              onClick={() => {
                setComposerPickerTab("stickers");
                setShowEmojiPicker(true);
              }}
              className="hover:text-[var(--text-primary)] transition-colors hidden sm:block"
              title="Open sticker picker"
            >
              <Sticker className="w-6 h-6" />
            </button>
            <Popover
              open={showEmojiPicker}
              onOpenChange={(open) => {
                setShowEmojiPicker(open);
                if (!open) {
                  setComposerPickerTab("emoji");
                }
              }}
            >
              <PopoverTrigger asChild>
                <button
                  className="hover:text-[var(--text-primary)] transition-colors"
                  onClick={() => setComposerPickerTab("emoji")}
                >
                  <Smile className="w-5 sm:w-6 h-5 sm:h-6" />
                </button>
              </PopoverTrigger>
              <PopoverContent
                side="top"
                align="end"
                className="w-auto p-0 border-none bg-transparent shadow-xl"
              >
                <CustomEmojiPicker
                  onEmojiSelect={handleEmojiSelect}
                  onGifSelect={handleGifSelect}
                  onStickerSelect={handleStickerSelect}
                  initialTab={composerPickerTab}
                  serverId={currentServer?.id}
                  serverEmojis={serverEmojis}
                />
              </PopoverContent>
            </Popover>
            {(newMessage.trim() || attachments.length > 0) && (
              <button
                onClick={() => {
                  void handleSendMessage();
                }}
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

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deleteConfirmMessage} onOpenChange={() => setDeleteConfirmMessage(null)}>
        <DialogContent className="bg-[var(--bg-card)] border-[var(--border-subtle)] text-[var(--text-primary)]">
          <DialogHeader>
            <DialogTitle>Delete Message</DialogTitle>
            <DialogDescription className="text-[var(--text-secondary)]">
              Are you sure you want to delete this message? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="bg-[var(--bg-sidebar-elevated)] p-3 rounded-md text-[var(--text-secondary)] text-sm max-h-32 overflow-y-auto">
            {deleteConfirmMessage?.content}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteConfirmMessage(null)} className="text-[var(--text-primary)] hover:bg-[var(--bg-hover)]">
              Cancel
            </Button>
            <Button onClick={handleDeleteMessage} className="bg-red-500 hover:bg-red-600 text-white">
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showPins} onOpenChange={setShowPins}>
        <DialogContent className="bg-[var(--bg-card)] border-[var(--border-subtle)] text-[var(--text-primary)] max-w-2xl">
          <DialogHeader>
            <DialogTitle>Pinned Messages</DialogTitle>
            <DialogDescription className="text-[var(--text-secondary)]">
              Quick access to important messages in #{currentChannel?.name}.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-y-auto space-y-2 pr-1">
            {isLoadingPins ? (
              <div className="text-sm text-[var(--text-secondary)] flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                Loading pinned messages...
              </div>
            ) : pinnedMessages.length === 0 ? (
              <div className="text-sm text-[var(--text-secondary)]">No pinned messages yet.</div>
            ) : (
              pinnedMessages.map((message) => (
                <button
                  key={`pin-${message.id}`}
                  onClick={() => {
                    document.getElementById(`message-${message.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
                    setShowPins(false);
                  }}
                  className="w-full text-left p-3 rounded-md bg-[var(--bg-sidebar-elevated)] hover:bg-[var(--bg-hover)] transition"
                >
                  <p className="text-xs text-[var(--text-secondary)] mb-1">
                    {message.author?.displayName || message.author?.username || "Unknown"} • {formatTimestamp(message.createdAt)}
                  </p>
                  <p className="text-sm text-[var(--text-primary)] line-clamp-3">{message.content || "(attachment)"}</p>
                </button>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showInbox} onOpenChange={setShowInbox}>
        <DialogContent className="bg-[var(--bg-card)] border-[var(--border-subtle)] text-[var(--text-primary)] max-w-xl">
          <DialogHeader>
            <DialogTitle>Inbox</DialogTitle>
            <DialogDescription className="text-[var(--text-secondary)]">
              Recent mentions in this channel.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[55vh] overflow-y-auto space-y-2 pr-1">
            {inboxItems.length === 0 ? (
              <p className="text-sm text-[var(--text-secondary)]">No recent mentions.</p>
            ) : (
              inboxItems.map((item) => (
                <button
                  key={`inbox-${item.id}`}
                  onClick={() => {
                    document.getElementById(`message-${item.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
                    setShowInbox(false);
                  }}
                  className="w-full text-left p-3 rounded-md bg-[var(--bg-sidebar-elevated)] hover:bg-[var(--bg-hover)] transition"
                >
                  <p className="text-xs text-[var(--text-secondary)] mb-1">
                    {item.author?.displayName || item.author?.username || "Unknown"} • {formatTimestamp(item.createdAt)}
                  </p>
                  <p className="text-sm text-[var(--text-primary)] line-clamp-2">{item.content}</p>
                </button>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showHelp} onOpenChange={setShowHelp}>
        <DialogContent className="bg-[var(--bg-card)] border-[var(--border-subtle)] text-[var(--text-primary)] max-w-lg">
          <DialogHeader>
            <DialogTitle>Channel Help</DialogTitle>
            <DialogDescription className="text-[var(--text-secondary)]">
              Useful shortcuts and docs.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm text-[var(--text-secondary)]">
            <p>
              Press <span className="px-1.5 py-0.5 rounded bg-[var(--bg-sidebar-elevated)] border border-[var(--border-subtle)]">Enter</span> to send and{" "}
              <span className="px-1.5 py-0.5 rounded bg-[var(--bg-sidebar-elevated)] border border-[var(--border-subtle)]">Shift + Enter</span> for a new line.
            </p>
            <p>Use the pin icon to keep important messages accessible to everyone in the channel.</p>
            <a
              href="https://serikacord.com"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-[#8B5CF6] hover:underline"
            >
              Open SerikaCord docs
            </a>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

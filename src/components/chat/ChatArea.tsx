"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useServer } from "@/contexts/ServerContext";
import { useAuth } from "@/contexts/AuthContext";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
  ChevronLeft, 
  Megaphone,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { MessageBar, type MessageBarHandle } from "@/components/chat/MessageBar";
import { MessageList, type MessageListHandle } from "@/components/chat/MessageList";
import { MessageContextMenu } from "@/components/chat/MessageContextMenu";
import { DeleteMessageDialog } from "@/components/chat/DeleteMessageDialog";
import { PinnedMessagesDialog } from "@/components/chat/PinnedMessagesDialog";
import { TypingIndicator } from "@/components/chat/TypingIndicator";
import { ImageLightbox } from "@/components/ui/image-lightbox";
import {
  incrementUnread,
  clearUnread,
  playNotificationSound,
  isChannelMuted,
  toggleChannelMute,
  subscribeChannelMutes,
  evaluateNotification,
} from "@/lib/services/notificationUX";
import { showNotification } from "@/lib/services/notificationService";
import { useMentions, type MentionData } from "@/hooks/useMentions";
import { useChatSession } from "@/hooks/useChatSession";
import { usePermissions } from "@/hooks/usePermissions";
import { playTts } from "@/lib/chat/tts";
import { useSlashCommands } from "@/hooks/useSlashCommands";
import { useMediaLightbox } from "@/hooks/useMediaLightbox";
import { useIsMobile } from "@/hooks/useIsMobile";
import { formatMessageTimestamp } from "@/lib/chat/messages";
import {
  getCommandSuggestions,
  parseCommandContext,
  DURATION_PRESETS,
  CATEGORY_ORDER,
  getCategoryLabel,
  type SlashCommand,
  type SlashCommandParam,
} from "@/lib/chat/slashCommands";
import type { ChatMessage } from "@/lib/chat/types";
import { EMOJI_NAMES } from "@/lib/constants/emojis";
import { T, useGT, useLocale } from "gt-next";
import { Loader } from "@/components/ui/Loader";

type Message = ChatMessage;

interface MentionUser {
  id: string;
  username: string;
  displayName: string;
  avatar?: string;
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
  kind: "user" | "role" | "everyone" | "here" | "emoji" | "unicode-emoji" | "command" | "param-user" | "param-duration" | "param-choice" | "param-hint" | "channel";
  unicodeChar?: string;
  label: string;
  description?: string;
  color?: string;
  imageUrl?: string;
  animated?: boolean;
  usage?: string;
  // Param suggestion fields
  paramName?: string;
  paramRequired?: boolean;
  paramValue?: string;
  commandName?: string;
  commandHint?: string;
  category?: string;
}

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function replaceAliasMention(content: string, alias: string, token: string): string {
  if (!alias) return content;
  const escapedAlias = escapeRegex(alias);
  const pattern = new RegExp(`(^|\\s)@${escapedAlias}(?=$|[\\s.,!?;:])`, "gi");
  // Only replace in segments that are NOT already inside a token (<@id>, <@&id>, <:name:id>)
  // Split on existing tokens and only process plain-text segments
  const tokenSplit = /(<[@#][^>]{0,80}>|<a?:[a-zA-Z0-9_]+:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}>)/g;
  return content.replace(tokenSplit, (match) => `\x00${match}\x00`)
    .split("\x00")
    .map((seg) => {
      if (seg.startsWith("<") && seg.endsWith(">")) return seg;
      return seg.replace(pattern, (_match, prefix: string) => `${prefix}${token}`);
    })
    .join("");
}

interface ChatAreaProps {
  onToggleMembers?: () => void;
  showMembers?: boolean;
}

export function ChatArea({ onToggleMembers, showMembers }: ChatAreaProps) {
  const { currentChannel, currentServer, channels } = useServer();
  const { user } = useAuth();
  const gt = useGT();
  const locale = useLocale();
  const perms = usePermissions(currentServer?.id);
  const canModerateMessages = perms.isOwner || perms.can("MANAGE_MESSAGES");
  const router = useRouter();
  const isMobile = useIsMobile();
  const messageBarRef = useRef<MessageBarHandle>(null);
  const messageListRef = useRef<MessageListHandle>(null);

  // Server emojis and stickers
  const [serverEmojis, setServerEmojis] = useState<Array<{
    id: string;
    name: string;
    url: string;
    serverId: string;
    animated?: boolean;
  }>>([]);
  const [allServerEmojis, setAllServerEmojis] = useState<Array<{
    id: string;
    name: string;
    url: string;
    serverId: string;
    serverName?: string;
    animated?: boolean;
  }>>([]);
  const [serverStickers, setServerStickers] = useState<Array<{
    id: string;
    name: string;
    imageUrl: string;
    serverId: string;
    serverName: string;
  }>>([]);
  const [mentionUsers, setMentionUsers] = useState<MentionUser[]>([]);
  const [mentionRoles, setMentionRoles] = useState<MentionRole[]>([]);
  const [currentUserRoleIds, setCurrentUserRoleIds] = useState<string[]>([]);
  const [userRoleColorMap, setUserRoleColorMap] = useState<Record<string, string>>({});
  const [mentionSuggestions, setMentionSuggestions] = useState<MentionSuggestion[]>([]);
  const [activeMentionIndex, setActiveMentionIndex] = useState(0);
  const mentionRangeRef = useRef<{ start: number; end: number } | null>(null);

  // Header utilities
  const [channelMuted, setChannelMuted] = useState(false);
  const [showPins, setShowPins] = useState(false);
  const [showInbox, setShowInbox] = useState(false);
  const { mentions: allMentions, totalUnread, markChannelRead, refresh: refreshMentions } = useMentions();
  const [showHelp, setShowHelp] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<Message[]>([]);

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

  // Fetch all server emojis (cross-server)
  useEffect(() => {
    const fetchAllEmojis = async () => {
      try {
        const response = await fetch('/api/users/@me/emojis');
        if (response.ok) {
          const data = await response.json();
          const mapped = (data.emojis || []).map((emoji: { id?: string; _id?: string; name?: string; url?: string; imageUrl?: string; serverId?: string; serverName?: string; animated?: boolean }) => ({
            id: emoji.id || emoji._id,
            name: emoji.name,
            url: emoji.url || emoji.imageUrl,
            serverId: emoji.serverId || '',
            serverName: emoji.serverName,
            animated: emoji.animated,
          }));
          setAllServerEmojis(mapped);
        }
      } catch (error) {
        console.error("Failed to fetch all server emojis:", error);
      }
    };

    fetchAllEmojis();
  }, []);

  // Fetch all server stickers (cross-server)
  useEffect(() => {
    const fetchAllStickers = async () => {
      try {
        const response = await fetch('/api/users/@me/stickers');
        if (response.ok) {
          const data = await response.json();
          const mapped = (data.stickers || []).map((sticker: { id?: string; _id?: string; name?: string; imageUrl?: string; url?: string; serverId?: string; serverName?: string }) => ({
            id: sticker.id || sticker._id,
            name: sticker.name,
            imageUrl: sticker.imageUrl || sticker.url,
            serverId: sticker.serverId || '',
            serverName: sticker.serverName || 'Server',
          }));
          setServerStickers(mapped);
        }
      } catch (error) {
        console.error("Failed to fetch server stickers:", error);
      }
    };

    fetchAllStickers();
  }, []);

  useEffect(() => {
    const fetchMentionSources = async () => {
      if (!currentServer) {
        setMentionUsers([]);
        setMentionRoles([]);
        setCurrentUserRoleIds([]);
        setUserRoleColorMap({});
        return;
      }

      try {
        const [membersResponse, rolesResponse] = await Promise.all([
          fetch(`/api/servers/${currentServer.id}/members?limit=1000`),
          fetch(`/api/servers/${currentServer.id}/roles`),
        ]);

        if (membersResponse.ok) {
          const membersData = await membersResponse.json();
          const members = (membersData.members || []) as Array<{
            id: string;
            username: string;
            displayName: string;
            avatar?: string;
            roles?: Array<{ id: string }>;
            highestRole?: { color?: string } | null;
          }>;

          setMentionUsers(
            members.map((member) => ({
              id: member.id,
              username: member.username,
              displayName: member.displayName || member.username,
              avatar: member.avatar,
            }))
          );

          const colorMap: Record<string, string> = {};
          for (const member of members) {
            const highestRole = member.highestRole;
            if (highestRole?.color && highestRole.color !== '#000000') {
              colorMap[member.id] = highestRole.color;
            }
          }
          setUserRoleColorMap(colorMap);

          const self = members.find((member) => member.id === user?.id);
          setCurrentUserRoleIds((self?.roles || []).map((role) => role.id));
        } else {
          setMentionUsers([]);
          setCurrentUserRoleIds([]);
          setUserRoleColorMap({});
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
        setUserRoleColorMap({});
      }
    };

    void fetchMentionSources();
  }, [currentServer, user?.id]);

  const emojiLookup = useMemo(
    () => [...serverEmojis, ...allServerEmojis],
    [serverEmojis, allServerEmojis]
  );

  const normalizeMessageMentions = useCallback(
    (content: string): string => {
      if (!currentServer) return content;
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
    [currentServer, mentionRoles, mentionUsers]
  );

  // Notification UX for incoming messages from other users.
  const handleIncomingMessage = useCallback(
    (message: Message) => {
      const isDirectMention =
        user?.id && message.mentionedUserIds?.includes(user.id);
      const isRoleMention =
        currentUserRoleIds.length > 0 &&
        message.mentionedRoleIds?.some((rid) => currentUserRoleIds.includes(rid));
      const isMentioned = Boolean(isDirectMention || isRoleMention);
      const isEveryoneMention = Boolean(message.mentionEveryone);

      if (isMentioned || isEveryoneMention) {
        refreshMentions();
      }

      const isTabVisible = document.visibilityState === "visible";

      const decision = evaluateNotification({
        isMentioned: isMentioned || isEveryoneMention,
        isDM: false,
        isEveryoneMention,
        channelId: message.channelId,
        isTabVisible,
      });

      if (decision.incrementBadge) {
        incrementUnread();
      }

      if (decision.playSound) {
        playNotificationSound();
      }

      if (decision.showDesktop) {
        const authorName = message.author?.displayName || message.author?.username || "Someone";
        const showPreview = user?.settings?.notifications?.showPreview !== false;
        const preview = showPreview
          ? (message.content?.slice(0, 80) || (message.attachments?.length ? "📎 Attachment" : "New message"))
          : "New message";
        void showNotification(
          isMentioned ? `${authorName} mentioned you` : authorName,
          preview,
          {
            tag: `message-${message.channelId}`,
            icon: message.author?.avatar || "/icons/icon-192x192.png",
            data: {
              channelId: message.channelId,
              serverId: currentServer?.id,
            },
          }
        );
      }

      // Auto TTS: speak incoming messages when the listener has TTS enabled, or
      // whenever the message was explicitly sent with the /tts prefix (so a
      // /tts message is heard by everyone in the channel — web and desktop).
      const ttsEnabled = user?.settings?.accessibility?.tts === true;
      const hasTtsPrefix = typeof message.content === "string" && message.content.startsWith("/tts ");
      if ((ttsEnabled || hasTtsPrefix) && message.content) {
        const authorName = message.author?.displayName || message.author?.username || "Someone";
        void playTts({
          content: message.content,
          authorName,
          rate: user?.settings?.accessibility?.ttsRate,
          voiceGender: user?.settings?.accessibility?.ttsVoice,
        });
      }

      if (decision.showToast) {
        const authorName = message.author?.displayName || message.author?.username || "Someone";
        const showPreview = user?.settings?.notifications?.showPreview !== false;
        const preview = showPreview
          ? (message.content?.slice(0, 80) || (message.attachments?.length ? "📎 Attachment" : "New message"))
          : "New message";
        toast(authorName, {
          description: preview,
          duration: 4000,
          action: {
            label: "View",
            onClick: () => {
              window.focus();
              messageListRef.current?.scrollToBottom();
            },
          },
        });
      }
    },
    [user?.id, user?.settings, currentUserRoleIds, refreshMentions, currentServer?.id]
  );

  // The whole chat engine (messages, SSE, sends, pins, actions) is shared
  // with DMs via useChatSession.
  const chat = useChatSession<Message>({
    apiBase: currentChannel ? `/api/channels/${currentChannel.id}` : null,
    contextId: currentChannel?.id ?? null,
    user,
    messageBarRef,
    emojiLookup,
    normalizeContent: normalizeMessageMentions,
    onIncomingMessage: handleIncomingMessage,
    onShouldScrollToBottom: () => {
      if (messageListRef.current?.isAtBottom()) {
        requestAnimationFrame(() => messageListRef.current?.scrollToBottom());
      }
    },
  });

  const { executeCommand } = useSlashCommands({
    serverId: currentServer?.id,
    channelId: currentChannel?.id,
    clearMessages: useCallback((count: number, userId?: string) => {
      chat.setMessages((prev) => {
        if (userId) {
          // Remove last N messages from a specific user
          let remaining = count;
          const result = [...prev].reverse().filter((m) => {
            if (m.authorId === userId && remaining > 0) {
              remaining--;
              return false;
            }
            return true;
          });
          return result.reverse();
        }
        // Remove last N messages
        return prev.slice(0, Math.max(0, prev.length - count));
      });
    }, [chat]),
  });

  const handleSend = useCallback(async () => {
    const composer = messageBarRef.current?.getComposer();
    const rawContent = composer?.getText() ?? "";
    const trimmed = rawContent.trim();

    // Intercept slash commands
    if (trimmed.startsWith("/")) {
      const result = await executeCommand(trimmed);
      if (result.handled) {
        // Clear the composer if the command was consumed
        if (result.ttsText) {
          // TTS: send with /tts prefix so every other client hears it, and play
          // locally for the sender (own messages don't come back through SSE).
          composer?.clear();
          void playTts({
            content: result.ttsText,
            rate: user?.settings?.accessibility?.ttsRate,
            voiceGender: user?.settings?.accessibility?.ttsVoice,
          });
          await chat.sendMessage({ contentOverride: `/tts ${result.ttsText}` });
        } else if (result.sendAsMessage) {
          // Commands like /me, /shrug, /8ball, /roll produce a message
          composer?.clear();
          await chat.sendMessage({ contentOverride: result.sendAsMessage });
        } else {
          composer?.clear();
          chat.resetTyping();
        }
        return;
      }
    }

    // Normal send
    void chat.sendMessage();
  }, [executeCommand, chat, user?.settings?.accessibility?.ttsRate, user?.settings?.accessibility?.ttsVoice]);

  const lightbox = useMediaLightbox(chat.mediaGallery);

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

  const { setReplyToMessage } = chat.actions;
  useEffect(() => {
    if (!currentChannel) return;
    setChannelMuted(isChannelMuted(currentChannel.id));
    setReplyToMessage(null);
    setSearchQuery("");
    setSearchResults([]);
    setShowSearchResults(false);
    mentionRangeRef.current = null;
    setMentionSuggestions([]);
    setActiveMentionIndex(0);
  }, [currentChannel, setReplyToMessage]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void runMessageSearch(searchQuery);
    }, 220);
    return () => clearTimeout(timer);
  }, [searchQuery, runMessageSearch]);

  const updateMentionSuggestions = useCallback(
    (draft: string, explicitCaretPosition?: number | null) => {
      const caretPosition =
        explicitCaretPosition ?? messageBarRef.current?.getComposer()?.getCaret() ?? draft.length;
      const beforeCursor = draft.slice(0, caretPosition);

      // Slash command autocomplete: `/query` at the start of the message (no spaces)
      const slashMatch = beforeCursor.match(/^\/([a-zA-Z0-9_]*)$/);
      if (slashMatch) {
        const query = slashMatch[1];
        const isServer = !!currentServer;
        const commands = getCommandSuggestions(query, isServer);
        if (commands.length > 0) {
          const cmdStart = 1; // position after the '/'
          mentionRangeRef.current = { start: cmdStart, end: caretPosition };
          setMentionSuggestions(
            commands.map((cmd: SlashCommand) => ({
              id: cmd.name,
              kind: "command" as const,
              label: cmd.name,
              description: cmd.description,
              usage: cmd.usage,
              category: cmd.category,
              commandHint: cmd.hint,
            })),
          );
          setActiveMentionIndex(prev => prev !== 0 ? 0 : prev);
          return;
        }
      }

      // Slash command param autocomplete: `/command args...`
      // Detect when the user has typed a full command name followed by a space
      // and is now filling in parameters.
      const paramMatch = beforeCursor.match(/^\/(\S+)(\s+.*)$/);
      if (paramMatch) {
        const ctx = parseCommandContext(beforeCursor);
        if (ctx && ctx.param) {
          const param = ctx.param;
          const argQuery = ctx.currentArg.toLowerCase();

          // User target params: show member list
          if (param.isUserTarget && mentionUsers.length > 0) {
            const userSuggestions = mentionUsers
              .filter((entry) => {
                const username = (entry.username || "").toLowerCase();
                const displayName = (entry.displayName || "").toLowerCase();
                return username.includes(argQuery) || displayName.includes(argQuery);
              })
              .slice(0, 8)
              .map((entry) => ({
                id: entry.id,
                kind: "param-user" as const,
                label: entry.displayName || entry.username,
                description: entry.username,
                color: userRoleColorMap[entry.id],
                paramName: param.name,
                paramRequired: param.required,
                commandName: ctx.command.name,
              }));
            if (userSuggestions.length > 0 || argQuery === "") {
              mentionRangeRef.current = {
                start: caretPosition - ctx.currentArg.length,
                end: caretPosition,
              };
              setMentionSuggestions(userSuggestions.length > 0 ? userSuggestions : [{
                id: "__param-hint__",
                kind: "param-hint" as const,
                label: param.name,
                description: param.description,
                paramName: param.name,
                paramRequired: param.required,
                commandName: ctx.command.name,
              }]);
              setActiveMentionIndex(prev => prev !== 0 ? 0 : prev);
              return;
            }
          }

          // Duration params: show preset choices
          if (param.isDuration) {
            const presets = DURATION_PRESETS.filter(
              (p) => !argQuery || p.value.toLowerCase().includes(argQuery) || p.label.toLowerCase().includes(argQuery)
            );
            mentionRangeRef.current = {
              start: caretPosition - ctx.currentArg.length,
              end: caretPosition,
            };
            setMentionSuggestions(
              presets.map((p) => ({
                id: p.value,
                kind: "param-duration" as const,
                label: p.label,
                description: p.value,
                paramName: param.name,
                paramRequired: param.required,
                commandName: ctx.command.name,
              })),
            );
            setActiveMentionIndex(prev => prev !== 0 ? 0 : prev);
            return;
          }

          // Choice params: show predefined choices
          if (param.choices && param.choices.length > 0) {
            const choices = param.choices.filter(
              (c) => !argQuery || c.value.toLowerCase().includes(argQuery) || c.label.toLowerCase().includes(argQuery)
            );
            mentionRangeRef.current = {
              start: caretPosition - ctx.currentArg.length,
              end: caretPosition,
            };
            setMentionSuggestions(
              choices.map((c) => ({
                id: c.value,
                kind: "param-choice" as const,
                label: c.label,
                description: c.description || c.value,
                paramName: param.name,
                paramRequired: param.required,
                commandName: ctx.command.name,
              })),
            );
            setActiveMentionIndex(prev => prev !== 0 ? 0 : prev);
            return;
          }

          // Free-text params: show a hint card
          if (param.isFreeText || (!param.isUserTarget && !param.isDuration && !param.choices)) {
            mentionRangeRef.current = {
              start: caretPosition - ctx.currentArg.length,
              end: caretPosition,
            };
            setMentionSuggestions([
              {
                id: "__param-hint__",
                kind: "param-hint" as const,
                label: param.name,
                description: param.description,
                paramName: param.name,
                paramRequired: param.required,
                commandName: ctx.command.name,
              },
            ]);
            setActiveMentionIndex(prev => prev !== 0 ? 0 : prev);
            return;
          }
        }
      }

      const mentionMatch = beforeCursor.match(/(^|[\s\n])@([^\s@]{0,40})$/m);
      const hashMatch = beforeCursor.match(/(^|[\s\n])#([^\s#]{0,40})$/m);

      if (!mentionMatch && !hashMatch) {
        // Completed emoji shortcode: `:skull:` → auto-insert unicode or custom emoji
        const completedEmojiMatch = beforeCursor.match(/(^|\s):([a-zA-Z0-9_+-]{2,32}):$/);
        if (completedEmojiMatch) {
          const emojiName = completedEmojiMatch[2].toLowerCase();
          const unicodeChar = EMOJI_NAMES[emojiName] || EMOJI_NAMES[emojiName.replace(/-/g, "_")] || EMOJI_NAMES[emojiName.replace(/_/g, "-")];
          const customEmoji = allServerEmojis.find(e => e.name.toLowerCase() === emojiName);
          const composer = messageBarRef.current?.getComposer();
          if (composer) {
            const tokenStart = caretPosition - emojiName.length - 2; // ':' + name + ':'
            if (unicodeChar) {
              composer.replaceRange(tokenStart, caretPosition, unicodeChar);
              mentionRangeRef.current = null;
              setMentionSuggestions(prev => prev.length > 0 ? [] : prev);
              setActiveMentionIndex(prev => prev !== 0 ? 0 : prev);
              return;
            } else if (customEmoji) {
              composer.replaceRangeWithEmoji(tokenStart, caretPosition, {
                id: customEmoji.id,
                name: customEmoji.name,
                url: customEmoji.url,
                animated: customEmoji.animated,
              });
              mentionRangeRef.current = null;
              setMentionSuggestions(prev => prev.length > 0 ? [] : prev);
              setActiveMentionIndex(prev => prev !== 0 ? 0 : prev);
              return;
            }
          }
        }

        // Emoji autocomplete: `:query` with 2+ chars (avoids firing on plain colons)
        const emojiMatch = beforeCursor.match(/(^|\s):([a-zA-Z0-9_+-]{2,32})$/);
        if (emojiMatch) {
          const emojiQuery = emojiMatch[2].toLowerCase();
          const emojiStart = caretPosition - emojiMatch[2].length - 1;
          const seenNames = new Set<string>();
          const emojiSuggestions: MentionSuggestion[] = [];
          // Unicode emoji suggestions from shortcode map
          for (const [name, char] of Object.entries(EMOJI_NAMES)) {
            if (!name.includes(emojiQuery)) continue;
            if (seenNames.has(name)) continue;
            seenNames.add(name);
            emojiSuggestions.push({
              id: `unicode:${name}`,
              kind: "unicode-emoji",
              label: name,
              unicodeChar: char,
            });
            if (emojiSuggestions.length >= 8) break;
          }
          // Custom server emoji suggestions
          for (const entry of allServerEmojis) {
            if (emojiSuggestions.length >= 8) break;
            if (!entry.name.toLowerCase().includes(emojiQuery)) continue;
            if (seenNames.has(entry.name)) continue;
            seenNames.add(entry.name);
            emojiSuggestions.push({
              id: entry.id,
              kind: "emoji",
              label: entry.name,
              description: entry.serverName,
              imageUrl: entry.url,
              animated: entry.animated,
            });
          }
          if (emojiSuggestions.length > 0) {
            mentionRangeRef.current = { start: emojiStart, end: caretPosition };
            setMentionSuggestions(emojiSuggestions);
            setActiveMentionIndex(prev => prev !== 0 ? 0 : prev);
            return;
          }
        }
        mentionRangeRef.current = null;
        setMentionSuggestions(prev => prev.length > 0 ? [] : prev);
        setActiveMentionIndex(prev => prev !== 0 ? 0 : prev);
        return;
      }

      if (hashMatch) {
        const tokenPrefix = hashMatch[1] || "";
        const queryRaw = hashMatch[2] || "";
        const query = queryRaw.toLowerCase();
        const mentionStart = caretPosition - queryRaw.length - 1;
        if (mentionStart - tokenPrefix.length < 0) {
          mentionRangeRef.current = null;
          setMentionSuggestions(prev => prev.length > 0 ? [] : prev);
          setActiveMentionIndex(prev => prev !== 0 ? 0 : prev);
          return;
        }

        const channelSuggestions = channels
          .filter((ch) => ch.type !== "category" && ch.type !== "voice")
          .filter((ch) => {
            const chName = ch.name.toLowerCase();
            return query.length === 0 || chName.includes(query);
          })
          .sort((a, b) => a.name.localeCompare(b.name))
          .slice(0, 8)
          .map((ch) => ({
            id: ch.id,
            kind: "channel" as const,
            label: ch.name,
            description: "Text channel",
          }));

        if (!channelSuggestions.length) {
          mentionRangeRef.current = null;
          setMentionSuggestions(prev => prev.length > 0 ? [] : prev);
          setActiveMentionIndex(prev => prev !== 0 ? 0 : prev);
          return;
        }

        mentionRangeRef.current = {
          start: mentionStart,
          end: caretPosition,
        };
        setMentionSuggestions(channelSuggestions);
        setActiveMentionIndex(prev => prev !== 0 ? 0 : prev);
        return;
      }

      if (!mentionMatch) {
        setMentionSuggestions(prev => prev.length > 0 ? [] : prev);
        setActiveMentionIndex(prev => prev !== 0 ? 0 : prev);
        return;
      }

      const tokenPrefix = mentionMatch[1] || "";
      const queryRaw = mentionMatch[2] || "";
      const query = queryRaw.toLowerCase();
      const mentionStart = caretPosition - queryRaw.length - 1;
      if (mentionStart - tokenPrefix.length < 0) {
        mentionRangeRef.current = null;
        setMentionSuggestions(prev => prev.length > 0 ? [] : prev);
        setActiveMentionIndex(prev => prev !== 0 ? 0 : prev);
        return;
      }

      const staticSuggestionPool: MentionSuggestion[] = [
        { id: "everyone", kind: "everyone", label: "everyone", description: "Notify everyone in this channel" },
        { id: "here", kind: "here", label: "here", description: "Notify currently active members" },
      ];
      const staticSuggestions = staticSuggestionPool.filter((entry) => entry.label.startsWith(query));

      const userSuggestions = mentionUsers
        .filter((entry) => {
          const username = (entry.username || "").toLowerCase();
          const displayName = (entry.displayName || "").toLowerCase();
          return query.length === 0 || username.includes(query) || displayName.includes(query);
        })
        .sort((a, b) => (a.displayName || "").localeCompare(b.displayName || ""))
        .slice(0, 8)
        .map((entry) => ({
          id: entry.id,
          kind: "user" as const,
          label: entry.displayName || entry.username || entry.id,
          description: `@${entry.username || ""}`,
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
          description: "Role mention",
          color: entry.color,
        }));

      const nextSuggestions = [...staticSuggestions, ...userSuggestions, ...roleSuggestions].slice(0, 12);

      if (!nextSuggestions.length) {
        mentionRangeRef.current = null;
        setMentionSuggestions(prev => prev.length > 0 ? [] : prev);
        setActiveMentionIndex(prev => prev !== 0 ? 0 : prev);
        return;
      }

      mentionRangeRef.current = {
        start: mentionStart,
        end: caretPosition,
      };
      setMentionSuggestions(nextSuggestions);
      setActiveMentionIndex(prev => prev !== 0 ? 0 : prev);
    },
    [mentionRoles, mentionUsers, userRoleColorMap, allServerEmojis, currentServer, channels]
  );

  const insertMentionFromSuggestion = useCallback(
    (suggestion: MentionSuggestion) => {
      const activeRange = mentionRangeRef.current;
      const composer = messageBarRef.current?.getComposer();
      if (!activeRange || !composer) return;

      mentionRangeRef.current = null;
      setMentionSuggestions([]);
      setActiveMentionIndex(0);

      if (suggestion.kind === "unicode-emoji") {
        // Insert the Unicode emoji character directly as text
        composer.replaceRange(activeRange.start, activeRange.end, suggestion.unicodeChar || "");
        composer.insertTextAtCaret(" ");
      } else if (suggestion.kind === "emoji") {
        // Insert as an inline image; the composer serializes it to a token
        composer.replaceRangeWithEmoji(activeRange.start, activeRange.end, {
          id: suggestion.id,
          name: suggestion.label,
          url: suggestion.imageUrl || "",
          animated: suggestion.animated,
        });
      } else if (suggestion.kind === "command") {
        // Replace /query with /command + space
        composer.replaceRange(0, activeRange.end, `/${suggestion.label} `);
      } else if (suggestion.kind === "param-user") {
        // Insert user mention pill for command param
        composer.replaceRangeWithMention(activeRange.start, activeRange.end, {
          id: suggestion.id,
          label: suggestion.label,
          kind: "user",
          color: suggestion.color,
        });
        // Add trailing space as text
        composer.insertTextAtCaret(" ");
      } else if (suggestion.kind === "param-duration" || suggestion.kind === "param-choice") {
        // Insert the value for duration/choice params
        composer.replaceRange(activeRange.start, activeRange.end, `${suggestion.id} `);
      } else if (suggestion.kind === "param-hint") {
        // Just dismiss the hint — user continues typing
        mentionRangeRef.current = null;
        setMentionSuggestions([]);
        return;
      } else {
        // User, role, everyone, here, channel — insert as mention pill
        const mentionKind =
          suggestion.kind === "user" ? "user" :
          suggestion.kind === "role" ? "role" :
          suggestion.kind === "everyone" ? "everyone" :
          suggestion.kind === "channel" ? "channel" : "here";
        composer.replaceRangeWithMention(activeRange.start, activeRange.end, {
          id: suggestion.id,
          label: suggestion.label,
          kind: mentionKind,
          color: suggestion.color,
        });
        // Add trailing space as text
        composer.insertTextAtCaret(" ");
      }

      chat.signalTyping(composer.getText());
    },
    [chat]
  );

  // Clear unread badge when tab becomes visible
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        clearUnread();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, []);

  const toggleChannelNotifications = () => {
    if (!currentChannel) return;
    const next = toggleChannelMute(currentChannel.id);
    setChannelMuted(next);
    toast.success(next ? gt("Channel notifications muted") : gt("Channel notifications enabled"));
  };

  // Stay in sync when the channel is muted/unmuted from the sidebar menu
  useEffect(() => {
    if (!currentChannel) return;
    return subscribeChannelMutes((channelId, muted) => {
      if (channelId === currentChannel.id) setChannelMuted(muted);
    });
  }, [currentChannel]);

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
      if (e.key === "Escape") {
        e.preventDefault();
        mentionRangeRef.current = null;
        setMentionSuggestions([]);
        setActiveMentionIndex(0);
        return;
      }
      // Tab inserts the selected suggestion (autocomplete)
      if (e.key === "Tab") {
        const selected = mentionSuggestions[activeMentionIndex];
        if (selected) {
          if (selected.kind === "param-hint") {
            mentionRangeRef.current = null;
            setMentionSuggestions([]);
            setActiveMentionIndex(0);
            return;
          }
          e.preventDefault();
          insertMentionFromSuggestion(selected);
        }
        return;
      }
      // Enter always sends — don't let suggestions intercept it
      if (e.key === "Enter" && !e.shiftKey) {
        // Dismiss any visible suggestions first
        mentionRangeRef.current = null;
        setMentionSuggestions([]);
        setActiveMentionIndex(0);
        e.preventDefault();
        void handleSend();
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  const handleComposerChange = (value: string, caret: number) => {
    chat.signalTyping(value);
    updateMentionSuggestions(value, caret);
  };

  const focusComposer = useCallback(() => {
    messageBarRef.current?.getComposer()?.focus();
  }, []);

  const formatTimestamp = (ts: string) => formatMessageTimestamp(ts, gt, locale);

  // Mark current channel as read when it changes
  useEffect(() => {
    if (currentChannel?.id) {
      markChannelRead(currentChannel.id);
    }
  }, [currentChannel?.id, markChannelRead]);

  if (!currentChannel) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-[var(--bg-app)] text-[var(--text-secondary)]">
        <div className="w-40 h-40 mb-4 rounded-full bg-[var(--bg-card)] flex items-center justify-center border border-[var(--border-subtle)]">
          <Hash className="w-20 h-20 text-[#8B5CF6]" />
        </div>
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-2">
          {currentServer ? gt("Select a channel") : gt("Welcome to SerikaCord")}
        </h2>
        <p className="text-center max-w-md">
          {currentServer
            ? gt("Choose a channel from the sidebar to start chatting.")
            : gt("Select a server or start a direct message to begin.")}
        </p>
      </div>
    );
  }



  const welcomeHeader = (
    <div className="px-4 pb-4 mb-4 border-b border-[var(--app-border)]">
      <div className="w-16 h-16 mb-2 rounded-2xl bg-[var(--app-surface-alt)] flex items-center justify-center border border-[var(--app-border)]">
        <Hash className="w-10 h-10 text-[var(--text-primary)]" />
      </div>
      <h1 className="text-2xl sm:text-3xl font-bold text-[var(--text-primary)] mb-2 break-words">
        {gt("Welcome to #{channel}!", { channel: currentChannel.name })}
      </h1>
      <p className="text-[var(--app-muted)]">{gt("This is the start of the #{channel} channel.", { channel: currentChannel.name })}</p>
    </div>
  );

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
          {currentChannel.type === "announcement" ? (
            <Megaphone className="w-5 sm:w-6 h-5 sm:h-6 text-[var(--app-muted-2)] flex-shrink-0" />
          ) : (
            <Hash className="w-5 sm:w-6 h-5 sm:h-6 text-[var(--app-muted-2)] flex-shrink-0" />
          )}
          <span className="font-semibold text-[var(--text-primary)] truncate text-sm sm:text-base">{currentChannel.name}</span>
          {currentChannel.type === "announcement" && (
            <span className="ml-1 shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-500/15 text-blue-400 select-none hidden sm:inline">ANNOUNCEMENTS</span>
          )}
        </div>
        <div className="flex items-center gap-2 sm:gap-4 text-[var(--app-muted)]">
          <button
            className="hover:text-[var(--text-primary)] transition-colors hidden sm:block"
            onClick={toggleChannelNotifications}
            title={channelMuted ? gt("Enable notifications") : gt("Mute notifications")}
            aria-label={channelMuted ? gt("Enable notifications") : gt("Mute notifications")}
          >
            <Bell className={cn("w-5 h-5", channelMuted && "text-red-400")} />
          </button>
          <button
            className="hover:text-[var(--text-primary)] transition-colors"
            onClick={() => {
              setShowPins(true);
              void chat.fetchPinnedMessages();
            }}
            title={gt("View pinned messages")}
          >
            <Pin className="w-5 h-5" />
          </button>
          <button
            onClick={onToggleMembers}
            aria-label={gt("Toggle member list")}
            className={cn("hover:text-[var(--text-primary)] transition-colors", showMembers && "text-[var(--text-primary)]")}
          >
            <Users className="w-5 h-5" />
          </button>
          <div className="h-6 w-px bg-[var(--app-border)] hidden md:block" />
          <div className="relative hidden md:block">
            <input
              type="text"
              placeholder={gt("Search")}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-32 h-6 px-2 rounded bg-[var(--app-surface-alt)] text-sm text-[var(--text-primary)] placeholder:text-[var(--app-muted)] focus:outline-none focus:w-48 transition-all"
              onFocus={() => setShowSearchResults(true)}
            />
            <Search className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--app-muted)]" />
          </div>
          <button
            className={cn(
              "hover:text-[var(--text-primary)] transition-colors hidden sm:block relative",
              totalUnread > 0 && "text-[var(--app-accent)]"
            )}
            onClick={() => setShowInbox(true)}
            title={gt("Open inbox")}
          >
            <Inbox className="w-5 h-5" />
            {totalUnread > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[16px] h-[16px] px-1 flex items-center justify-center rounded-full bg-[#8B5CF6] text-[10px] font-bold text-white leading-none">
                {totalUnread > 99 ? "99+" : totalUnread}
              </span>
            )}
          </button>
          <button
            className="hover:text-[var(--text-primary)] transition-colors hidden sm:block"
            onClick={() => setShowHelp(true)}
            title={gt("Open help")}
          >
            <HelpCircle className="w-5 h-5" />
          </button>
        </div>
      </div>

      {showSearchResults && (
        <div className="px-4 py-2 border-b border-[var(--app-border)] bg-[var(--app-surface)]/95">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs uppercase tracking-wider text-[var(--app-muted)]">{gt("Search Results")}</p>
            <button
              onClick={() => setShowSearchResults(false)}
              className="text-xs text-[var(--app-muted)] hover:text-[var(--text-primary)] transition-colors"
            >
              {gt("Close")}
            </button>
          </div>
          {searchQuery.trim().length < 2 ? (
            <p className="text-sm text-[var(--app-muted)]">{gt("Type at least 2 characters to search this channel.")}</p>
          ) : isSearching ? (
            <div className="flex items-center gap-2 text-sm text-[var(--app-muted)]">
              <Loader size={16} />
              {gt("Searching...")}
            </div>
          ) : searchResults.length === 0 ? (
            <p className="text-sm text-[var(--app-muted)]">{gt("No matching messages.")}</p>
          ) : (
            <div className="space-y-1 max-h-44 overflow-y-auto pr-1">
              {searchResults.map((result) => (
                <button
                  key={`search-${result.id}`}
                  onClick={() => {
                    messageListRef.current?.scrollToMessage(result.id);
                    setShowSearchResults(false);
                  }}
                  className="w-full text-left p-2 rounded-md bg-[var(--app-surface-alt)] hover:brightness-110 transition"
                >
                  <p className="text-xs text-[var(--app-muted)] mb-0.5">
                    {result.author?.displayName || result.author?.username || gt("Unknown")} • {formatTimestamp(result.createdAt)}
                  </p>
                  <p className="text-sm text-[var(--text-primary)] line-clamp-2">{result.content || gt("(attachment)")}</p>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Messages */}
      <MessageList
        ref={messageListRef}
        groups={chat.groupedMessages}
        isLoading={chat.isLoading}
        hasMoreOlder={chat.hasMoreOlder}
        isLoadingMore={chat.isLoadingMore}
        loadOlderMessages={chat.loadOlderMessages}
        actions={chat.actions}
        currentUserId={user?.id}
        canModerate={canModerateMessages}
        serverId={currentServer?.id}
        serverName={currentServer?.name}
        swipeEnabled={isMobile}
        mentionUsers={mentionUsers}
        mentionRoles={mentionRoles}
        userRoleColorMap={userRoleColorMap}
        serverEmojis={serverEmojis}
        availableServerEmojis={allServerEmojis}
        onMediaClick={lightbox.openMediaViewer}
        onReplyFocus={focusComposer}
        welcomeHeader={welcomeHeader}
        resetKey={currentChannel?.id}
      />

      <TypingIndicator text={chat.typingStatusText} />

      {currentChannel?.type === "announcement" && (
        <div className="mx-4 mb-2 px-4 py-2.5 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center gap-2.5 text-xs text-blue-400">
          <Megaphone className="w-4 h-4 shrink-0" />
          <span><T>This is an</T> <strong><T>announcement channel</T></strong>. <T>Only admins can post here.</T></span>
        </div>
      )}

      <MessageBar
        ref={messageBarRef}
        placeholder={`${gt("Message")} #${currentChannel?.name ?? ""}`}
        ariaLabel={`${gt("Message")} #${currentChannel?.name ?? ""}`}
        onSend={() => void handleSend()}
        onChange={handleComposerChange}
        onKeyDown={handleKeyDown}
        onCaretMove={(text, caret) => updateMentionSuggestions(text, caret)}
        onEmojiSelect={chat.handleEmojiSelect}
        onGifSelect={chat.handleGifSelect}
        onStickerSelect={chat.handleStickerSelect}
        isSending={chat.isSending}
        serverId={currentServer?.id}
        serverEmojis={serverEmojis}
        serverName={currentServer?.name}
        availableServerEmojis={allServerEmojis}
        availableServerStickers={serverStickers}
        replyTo={chat.actions.replyToMessage}
        onCancelReply={() => chat.actions.setReplyToMessage(null)}
        mentionSuggestions={mentionSuggestions}
        onMentionSelect={insertMentionFromSuggestion}
        activeMentionIndex={activeMentionIndex}
        channelId={currentChannel?.id}
      />

      <ImageLightbox
        items={lightbox.lightboxItems}
        currentIndex={lightbox.lightboxCurrentIndex}
        isOpen={lightbox.isLightboxOpen}
        onNavigate={lightbox.standaloneMedia ? undefined : lightbox.setLightboxIndex}
        onClose={lightbox.closeMediaViewer}
      />

      <DeleteMessageDialog
        message={chat.actions.deleteConfirmMessage}
        onCancel={() => chat.actions.setDeleteConfirmMessage(null)}
        onConfirm={() => void chat.actions.confirmDelete()}
      />

      <PinnedMessagesDialog
        open={showPins}
        onOpenChange={setShowPins}
        messages={chat.pinnedMessages}
        isLoading={chat.isLoadingPins}
        contextLabel={`#${currentChannel?.name}`}
        onJumpToMessage={(id) => messageListRef.current?.scrollToMessage(id)}
        onUnpin={(message) => void chat.actions.togglePin(message)}
      />

      <Dialog open={showInbox} onOpenChange={setShowInbox}>
        <DialogContent className="bg-[var(--bg-card)] border-[var(--border-subtle)] text-[var(--text-primary)] max-w-lg">
          <DialogHeader>
            <DialogTitle><T>Inbox — Mentions</T></DialogTitle>
            <DialogDescription className="text-[var(--text-secondary)]">
              <T>Recent mentions across all your servers (last 7 days).</T>
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[55vh] overflow-y-auto space-y-1.5 pr-1">
            {allMentions.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Inbox className="w-12 h-12 text-[var(--text-muted)] mb-3" />
                <p className="text-sm text-[var(--text-secondary)]"><T>No unread mentions. You're all caught up!</T></p>
              </div>
            ) : (
              allMentions.map((item: MentionData) => (
                <button
                  key={`inbox-${item.id}`}
                  onClick={() => {
                    if (item.serverId && item.channelId) {
                      router.push(`/channels/${item.serverId}/${item.channelId}`);
                      setTimeout(() => {
                        messageListRef.current?.scrollToMessage(item.id);
                      }, 500);
                    }
                    setShowInbox(false);
                  }}
                  className="w-full text-left p-3 rounded-md bg-[var(--bg-sidebar-elevated)] hover:bg-[var(--bg-hover)] transition group"
                >
                  <div className="flex items-center gap-2 mb-1">
                    {item.author?.avatar && (
                      <Avatar className="w-5 h-5">
                        <AvatarImage src={item.author.avatar} alt="" />
                        <AvatarFallback className="bg-[var(--app-accent)] text-[var(--text-on-accent)] text-[10px]">
                          {item.author.displayName?.charAt(0).toUpperCase() || "?"}
                        </AvatarFallback>
                      </Avatar>
                    )}
                    <span className="text-xs font-medium text-[var(--text-primary)]">
                      {item.author?.displayName || item.author?.username || gt("Unknown")}
                    </span>
                    <span className="text-xs text-[var(--text-muted)]">{gt("in")}</span>
                    <span className="text-xs text-[var(--app-accent)] font-medium">#{item.channelName}</span>
                    <span className="text-xs text-[var(--text-muted)] ml-auto">{formatTimestamp(item.createdAt)}</span>
                  </div>
                  <p className="text-sm text-[var(--text-secondary)] line-clamp-2 group-hover:text-[var(--text-primary)] transition-colors">{item.content}</p>
                </button>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showHelp} onOpenChange={setShowHelp}>
        <DialogContent className="bg-[var(--bg-card)] border-[var(--border-subtle)] text-[var(--text-primary)] max-w-lg">
          <DialogHeader>
            <DialogTitle><T>Channel Help</T></DialogTitle>
            <DialogDescription className="text-[var(--text-secondary)]">
              <T>Useful shortcuts and docs.</T>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm text-[var(--text-secondary)]">
            <p>
              <T>Press</T> <span className="px-1.5 py-0.5 rounded bg-[var(--bg-sidebar-elevated)] border border-[var(--border-subtle)]">Enter</span> <T>to send and</T>{" "}
              <span className="px-1.5 py-0.5 rounded bg-[var(--bg-sidebar-elevated)] border border-[var(--border-subtle)]">Shift + Enter</span> <T>for a new line.</T>
            </p>
            <p><T>Use the pin icon to keep important messages accessible to everyone in the channel.</T></p>
            <a
              href="https://serika.chat"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-[#8B5CF6] hover:underline"
            >
              <T>Open SerikaCord docs</T>
            </a>
          </div>
        </DialogContent>
      </Dialog>

      <MessageContextMenu
        menu={chat.actions.contextMenu}
        isOwn={(message) => message.authorId === user?.id}
        canModerate={canModerateMessages}
        onClose={() => chat.actions.setContextMenu(null)}
        onReply={(message) => {
          chat.actions.setReplyToMessage(message);
          focusComposer();
        }}
        onAddReaction={(message) => chat.actions.setReactionPickerMessage(message.id)}
        onCopy={chat.actions.copyMessage}
        onPinToggle={(message) => void chat.actions.togglePin(message)}
        onEdit={chat.actions.startEditing}
        onDelete={chat.actions.setDeleteConfirmMessage}
      />
    </div>
  );
}

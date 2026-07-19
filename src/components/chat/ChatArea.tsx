"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useServer, useServerMembers } from "@/contexts/ServerContext";
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
  Shield,
} from "lucide-react";
import { cn, getTimeoutRemaining, cdnImage } from "@/lib/utils";
import { toast } from "sonner";
import { MessageBar, type MessageBarHandle } from "@/components/chat/MessageBar";
import { MessageList, type MessageListHandle } from "@/components/chat/MessageList";
import { MessageContextMenu } from "@/components/chat/MessageContextMenu";
import { DiscordBridgeConsentDialog } from "@/components/chat/DiscordBridgeConsentDialog";
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
import { useTimeoutRemaining } from "@/hooks/useTimeoutRemaining";
import { usePermissions } from "@/hooks/usePermissions";
import { playTts } from "@/lib/chat/tts";
import { useSlashCommands } from "@/hooks/useSlashCommands";
import { useMediaLightbox } from "@/hooks/useMediaLightbox";
import { useIsMobile } from "@/hooks/useIsMobile";
import { formatMessageTimestamp } from "@/lib/chat/messages";
import { parseSearchQuery, hasActiveFilters } from "@/lib/chat/searchQuery";
import {
  getCommandSuggestions,
  parseCommandContext,
  DURATION_PRESETS,
  CATEGORY_ORDER,
  getCategoryLabel,
  type SlashCommand,
  type SlashCommandParam,
} from "@/lib/chat/slashCommands";
import {
  flattenAppCommands,
  parseAppCommandContext,
  OPT,
  type AppLeafCommand,
} from "@/lib/chat/appCommandContext";
import type { ChatMessage } from "@/lib/chat/types";
import { onHotkey } from "@/lib/keybinds";
import { EMOJI_NAMES } from "@/lib/constants/emojis";
import { T, useGT, useLocale } from "gt-next";
import { Loader } from "@/components/ui/Loader";
import { canSendInChannel as canSendInChannelClient } from "@/lib/roles/channelPermissions";

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
  permissions?: string;
}

interface MentionSuggestion {
  id: string;
  kind: "user" | "role" | "everyone" | "here" | "emoji" | "unicode-emoji" | "command" | "param-user" | "param-duration" | "param-choice" | "param-hint" | "channel" | "app-command" | "app-option" | "app-choice";
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
  // App (bot) command fields
  appName?: string;
  appIcon?: string | null;
  botId?: string;
  emoji?: string;
  /** Full space-joined command path, e.g. "amq start". */
  fullName?: string;
  /** Discord option type for app-option suggestions. */
  optionType?: number;
  /** For app-command entries: the command's leaf options (for the pills header). */
  optionNames?: string[];
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

// Per-server SWR caches so bouncing between servers paints emojis/roles instantly
// and skips the refetch, while a background revalidation keeps them fresh.
type ServerEmoji = { id: string; name: string; url: string; serverId: string; animated?: boolean };
const serverEmojiCache = new Map<string, ServerEmoji[]>();
const serverRoleCache = new Map<string, MentionRole[]>();

export function ChatArea({ onToggleMembers, showMembers }: ChatAreaProps) {
  const { currentChannel, currentServer, channels } = useServer();
  // Reuse the members already fetched by ServerContext instead of fetching the
  // full member list a second time on every server open.
  const { members } = useServerMembers();
  const { user } = useAuth();
  const gt = useGT();
  const locale = useLocale();
  const perms = usePermissions(currentServer?.id);
  const canModerateMessages = perms.isOwner || perms.can("MANAGE_MESSAGES");

  // Discord bridge consent: know whether the active channel mirrors to Discord
  // so we can prompt the sender for data-processing consent on their first send.
  const [bridgeConsentOpen, setBridgeConsentOpen] = useState(false);
  const bridgeStatusRef = useRef<Map<string, boolean>>(new Map());
  const [currentChannelBridged, setCurrentChannelBridged] = useState(false);

  useEffect(() => {
    const chId = currentChannel?.id;
    if (!chId || currentChannel?.type !== "text") {
      setCurrentChannelBridged(false);
      return;
    }
    const cached = bridgeStatusRef.current.get(chId);
    if (cached !== undefined) {
      setCurrentChannelBridged(cached);
      return;
    }
    let cancelled = false;
    fetch(`/api/channels/${chId}/bridge-status`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : { bridged: false }))
      .then((d) => {
        if (cancelled) return;
        const bridged = Boolean(d?.bridged);
        bridgeStatusRef.current.set(chId, bridged);
        setCurrentChannelBridged(bridged);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [currentChannel?.id, currentChannel?.type]);
  const canPinMessages = canModerateMessages || perms.can("PIN_MESSAGES");
  const router = useRouter();
  const isMobile = useIsMobile();
  const messageBarRef = useRef<MessageBarHandle>(null);
  const messageListRef = useRef<MessageListHandle>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

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
    serverIcon?: string;
    animated?: boolean;
  }>>([]);
  const [serverStickers, setServerStickers] = useState<Array<{
    id: string;
    name: string;
    imageUrl: string;
    serverId: string;
    serverName: string;
  }>>([]);
  const [mentionRoles, setMentionRoles] = useState<MentionRole[]>([]);
  const [mentionSuggestions, setMentionSuggestions] = useState<MentionSuggestion[]>([]);
  const [activeMentionIndex, setActiveMentionIndex] = useState(0);
  const mentionRangeRef = useRef<{ start: number; end: number } | null>(null);
  // Registered bot (application) commands available in this channel, flattened
  // into individually-invokable leaf commands for the slash palette.
  const [appLeaves, setAppLeaves] = useState<AppLeafCommand[]>([]);

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

  // Fetch registered bot slash commands available in the active channel.
  useEffect(() => {
    const channelId = currentChannel?.id;
    if (!channelId) {
      setAppLeaves([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/channels/${channelId}/application-commands`);
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (!cancelled) setAppLeaves(flattenAppCommands(data.groups || []));
      } catch {
        /* commands are optional; ignore fetch failures */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentChannel?.id]);

  // Fetch server emojis (per-server SWR: paint cache instantly, revalidate).
  useEffect(() => {
    if (!currentServer) {
      setServerEmojis([]);
      return;
    }
    const serverId = currentServer.id;
    const cached = serverEmojiCache.get(serverId);
    if (cached) setServerEmojis(cached);
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(`/api/servers/${serverId}/emojis`);
        if (!response.ok || cancelled) return;
        const data = await response.json();
        const mapped: ServerEmoji[] = (data.emojis || []).map((emoji: { id?: string; _id?: string; name?: string; url?: string; imageUrl?: string; serverId?: string; animated?: boolean }) => ({
          id: emoji.id || emoji._id,
          name: emoji.name,
          url: emoji.url || emoji.imageUrl,
          serverId: emoji.serverId,
          animated: emoji.animated,
        }));
        serverEmojiCache.set(serverId, mapped);
        if (!cancelled) setServerEmojis(mapped);
      } catch (error) {
        console.error("Failed to fetch server emojis:", error);
      }
    })();
    return () => { cancelled = true; };
  }, [currentServer]);

  // Fetch all server emojis (cross-server)
  useEffect(() => {
    const fetchAllEmojis = async () => {
      try {
        const response = await fetch('/api/users/@me/emojis');
        if (response.ok) {
          const data = await response.json();
          const mapped = (data.emojis || []).map((emoji: { id?: string; _id?: string; name?: string; url?: string; imageUrl?: string; serverId?: string; serverName?: string; serverIcon?: string; animated?: boolean }) => ({
            id: emoji.id || emoji._id,
            name: emoji.name,
            url: emoji.url || emoji.imageUrl,
            serverId: emoji.serverId || '',
            serverName: emoji.serverName,
            serverIcon: emoji.serverIcon,
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

  // Roles only — members come from the shared members context (below), avoiding a
  // duplicate `?limit=1000` member fetch. Per-server SWR cache for instant paint.
  useEffect(() => {
    if (!currentServer) {
      setMentionRoles([]);
      return;
    }
    const serverId = currentServer.id;
    const cached = serverRoleCache.get(serverId);
    if (cached) setMentionRoles(cached);
    let cancelled = false;
    (async () => {
      try {
        const rolesResponse = await fetch(`/api/servers/${serverId}/roles`);
        if (!rolesResponse.ok || cancelled) return;
        const rolesData = await rolesResponse.json();
        const roles = (rolesData.roles || []) as MentionRole[];
        serverRoleCache.set(serverId, roles);
        if (!cancelled) setMentionRoles(roles);
      } catch (error) {
        console.error("Failed to fetch roles:", error);
      }
    })();
    return () => { cancelled = true; };
  }, [currentServer]);

  // Mention users / role colors / self role ids are derived from the shared
  // members list (fetched once by ServerContext) — no extra network request.
  const mentionUsers = useMemo<MentionUser[]>(
    () =>
      (members as Array<{ id: string; username: string; displayName?: string; avatar?: string }>).map((m) => ({
        id: m.id,
        username: m.username,
        displayName: m.displayName || m.username,
        avatar: m.avatar,
      })),
    [members]
  );

  const userRoleColorMap = useMemo<Record<string, string>>(() => {
    const colorMap: Record<string, string> = {};
    for (const m of members as Array<{ id: string; highestRole?: { color?: string } | null }>) {
      const color = m.highestRole?.color;
      if (color && color !== "#99AAB5") colorMap[m.id] = color;
    }
    return colorMap;
  }, [members]);

  const currentUserRoleIds = useMemo<string[]>(() => {
    const self = (members as Array<{ id: string; roles?: Array<{ id: string }> }>).find((m) => m.id === user?.id);
    return (self?.roles || []).map((r) => r.id);
  }, [members, user?.id]);

  // Compute the user's role permission bitfields from the fetched role data,
  // used for channel-level overwrite checks (e.g. SEND_MESSAGES).
  const currentUserRolePerms = useMemo<bigint[]>(() => {
    return currentUserRoleIds
      .map((rid) => mentionRoles.find((r) => r.id === rid))
      .filter((r): r is MentionRole => !!r && typeof r.permissions === "string")
      .map((r) => BigInt(r.permissions!));
  }, [currentUserRoleIds, mentionRoles]);

  // Check if the user can send messages in the current channel based on
  // permission overwrites. Admin/owner bypass all overwrites.
  const canSendInCurrentChannel = useMemo(() => {
    return canSendInChannelClient(
      currentChannel as any,
      currentUserRoleIds,
      currentUserRolePerms,
      perms.isOwner,
      perms.isAdmin,
    );
  }, [currentChannel, currentUserRoleIds, currentUserRolePerms, perms.isOwner, perms.isAdmin]);

  // Server-only: if the signed-in user is timed out, block the composer.
  const selfTimeoutUntil = useMemo(() => {
    if (!currentServer) return null;
    const self = (members as Array<{ id: string; communicationDisabledUntil?: string | null }>).find((m) => m.id === user?.id);
    return self?.communicationDisabledUntil ?? null;
  }, [members, user?.id, currentServer]);
  // Ticks every second so the countdown label updates live and the composer
  // re-enables the moment the timeout expires.
  const selfTimeout = useTimeoutRemaining(selfTimeoutUntil);

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
    // Block sending while the current user is timed out in this server.
    if (currentServer) {
      const self = (members as Array<{ id: string; communicationDisabledUntil?: string | null }>).find((m) => m.id === user?.id);
      if (getTimeoutRemaining(self?.communicationDisabledUntil).active) return;
    }

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
          composer?.clear();
          if (result.ephemeral) {
            // Ephemeral built-ins (/roll, /8ball) — only the invoker sees them.
            chat.resetTyping();
            chat.addEphemeralMessage({
              id: `eph-local-${Date.now()}`,
              content: result.sendAsMessage,
              authorId: user?.id,
              author: user
                ? {
                    id: user.id,
                    username: user.username,
                    displayName: user.displayName || user.username,
                    avatar: user.avatar,
                  }
                : null,
              channelId: currentChannel?.id,
              createdAt: new Date().toISOString(),
              ephemeral: true,
              type: "default",
            });
          } else {
            // Public built-ins (/me, /shrug) — sent as a normal message.
            await chat.sendMessage({ contentOverride: result.sendAsMessage });
          }
        } else {
          composer?.clear();
          chat.resetTyping();
        }
        return;
      }
    }

    // Normal send. Bot (application) slash commands are detected server-side:
    // the message endpoint dispatches the interaction and returns without
    // persisting the raw "/command" text (see sendMessage reconciliation).
    void chat.sendMessage();

    // First message in a Discord-bridged channel → ask for sync consent once.
    if (currentChannelBridged && !user?.settings?.dataPrivacy?.discordBridgePrompted) {
      setBridgeConsentOpen(true);
    }
  }, [executeCommand, chat, user?.settings?.accessibility?.ttsRate, user?.settings?.accessibility?.ttsVoice, currentServer, members, user?.id, currentChannelBridged, user?.settings?.dataPrivacy?.discordBridgePrompted]);

  const lightbox = useMediaLightbox(chat.mediaGallery);

  const runMessageSearch = useCallback(async (query: string) => {
    if (!currentChannel) {
      setSearchResults([]);
      return;
    }
    const parsed = parseSearchQuery(query);
    const filtersActive = hasActiveFilters(parsed);
    // Need either a 2+ char text query or at least one filter.
    if (parsed.text.trim().length < 2 && !filtersActive) {
      setSearchResults([]);
      return;
    }

    // Resolve in:<#channel> to a channel id (defaults to the current channel).
    let targetChannelId = currentChannel.id;
    if (parsed.inChannel) {
      const wanted = parsed.inChannel.toLowerCase();
      const match = channels.find((c) => c.name?.toLowerCase() === wanted || c.id === parsed.inChannel);
      if (match) targetChannelId = match.id;
    }
    // Resolve from:<user> to a member id when it matches a known member.
    let fromValue = parsed.from;
    if (parsed.from) {
      const wanted = parsed.from.toLowerCase();
      const member = members.find(
        (m) => m.username?.toLowerCase() === wanted || m.displayName?.toLowerCase() === wanted
      );
      if (member) fromValue = member.id;
    }

    const params = new URLSearchParams({ limit: "20" });
    if (parsed.text.trim().length >= 2) params.set("q", parsed.text.trim());
    if (fromValue) params.set("from", fromValue);
    if (parsed.has) params.set("has", parsed.has);
    if (parsed.before) params.set("before", parsed.before);
    if (parsed.after) params.set("after", parsed.after);

    setIsSearching(true);
    try {
      const response = await fetch(
        `/api/channels/${targetChannelId}/messages/search?${params.toString()}`
      );
      if (!response.ok) return;
      const data = await response.json();
      setSearchResults(data.messages || []);
    } catch {
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  }, [currentChannel, channels, members]);

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
        const query = slashMatch[1].toLowerCase();
        const isServer = !!currentServer;
        const commands = getCommandSuggestions(query, isServer);
        // Registered bot commands whose full path matches the query.
        const appMatches = appLeaves.filter(
          (leaf) =>
            !query ||
            leaf.fullName.toLowerCase().includes(query) ||
            leaf.description.toLowerCase().includes(query),
        );
        const builtInSuggestions: MentionSuggestion[] = commands.map((cmd: SlashCommand) => ({
          id: cmd.name,
          kind: "command" as const,
          label: cmd.name,
          description: cmd.description,
          usage: cmd.usage,
          category: cmd.category,
          commandHint: cmd.hint,
        }));
        const appSuggestions: MentionSuggestion[] = appMatches.map((leaf) => ({
          id: `${leaf.application.id}:${leaf.fullName}`,
          kind: "app-command" as const,
          label: leaf.fullName,
          description: leaf.description,
          appName: leaf.application.name,
          appIcon: leaf.application.icon,
          botId: leaf.application.botId ?? undefined,
          fullName: leaf.fullName,
          optionNames: leaf.options
            .filter((o) => o.type !== OPT.SUB_COMMAND && o.type !== OPT.SUB_COMMAND_GROUP)
            .map((o) => o.name),
        }));
        const merged = [...appSuggestions, ...builtInSuggestions];
        if (merged.length > 0) {
          const cmdStart = 1; // position after the '/'
          mentionRangeRef.current = { start: cmdStart, end: caretPosition };
          setMentionSuggestions(merged);
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

      // App (bot) command parameter autocomplete: `/amq start ...`
      if (appLeaves.length > 0 && beforeCursor.startsWith("/") && /\s/.test(beforeCursor)) {
        const appCtx = parseAppCommandContext(beforeCursor, appLeaves);
        if (appCtx) {
          const { leaf, option, currentArg, valueMode, remaining } = appCtx;
          const cmdName = leaf.fullName;
          const argLower = currentArg.toLowerCase();
          const valueRange = { start: caretPosition - currentArg.length, end: caretPosition };

          // Options list (screenshot: OPTIONS → difficulty / mode / anilist).
          if (!valueMode) {
            const optionList = remaining.filter(
              (o) => !argLower || o.name.toLowerCase().includes(argLower),
            );
            if (optionList.length > 0) {
              mentionRangeRef.current = valueRange;
              setMentionSuggestions(
                optionList.map((o) => ({
                  id: o.name,
                  kind: "app-option" as const,
                  label: o.name,
                  description: o.description || "",
                  paramName: o.name,
                  paramRequired: o.required,
                  commandName: cmdName,
                  optionType: o.type,
                })),
              );
              setActiveMentionIndex((prev) => (prev !== 0 ? 0 : prev));
              return;
            }
          }

          // Value picker for the active option.
          if (option) {
            // USER option → member list.
            if (option.type === OPT.USER && mentionUsers.length > 0) {
              const userSuggestions = mentionUsers
                .filter((entry) => {
                  const username = (entry.username || "").toLowerCase();
                  const displayName = (entry.displayName || "").toLowerCase();
                  return username.includes(argLower) || displayName.includes(argLower);
                })
                .slice(0, 8)
                .map((entry) => ({
                  id: entry.id,
                  kind: "param-user" as const,
                  label: entry.displayName || entry.username,
                  description: entry.username,
                  color: userRoleColorMap[entry.id],
                  paramName: option.name,
                  paramRequired: option.required,
                  commandName: cmdName,
                }));
              if (userSuggestions.length > 0) {
                mentionRangeRef.current = valueRange;
                setMentionSuggestions(userSuggestions);
                setActiveMentionIndex((prev) => (prev !== 0 ? 0 : prev));
                return;
              }
            }

            // Explicit choices (screenshot: 🎵 Audio — guess from theme song).
            const choices =
              option.choices && option.choices.length > 0
                ? option.choices
                : option.type === OPT.BOOLEAN
                  ? [
                      { name: "True", value: "true" },
                      { name: "False", value: "false" },
                    ]
                  : null;
            if (choices) {
              const filtered = choices.filter(
                (c) =>
                  !argLower ||
                  c.name.toLowerCase().includes(argLower) ||
                  String(c.value).toLowerCase().includes(argLower),
              );
              if (filtered.length > 0) {
                mentionRangeRef.current = valueRange;
                setMentionSuggestions(
                  filtered.map((c) => ({
                    id: String(c.value),
                    kind: "app-choice" as const,
                    label: c.name,
                    description: (c as { description?: string }).description,
                    emoji: (c as { emoji?: string }).emoji,
                    paramName: option.name,
                    paramRequired: option.required,
                    commandName: cmdName,
                  })),
                );
                setActiveMentionIndex((prev) => (prev !== 0 ? 0 : prev));
                return;
              }
            }

            // Free-text option → hint card.
            mentionRangeRef.current = valueRange;
            setMentionSuggestions([
              {
                id: "__app-option-hint__",
                kind: "app-option" as const,
                label: option.name,
                description: option.description || "",
                paramName: option.name,
                paramRequired: option.required,
                commandName: cmdName,
                optionType: option.type,
              },
            ]);
            setActiveMentionIndex((prev) => (prev !== 0 ? 0 : prev));
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
    [mentionRoles, mentionUsers, userRoleColorMap, allServerEmojis, currentServer, channels, appLeaves]
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
      } else if (suggestion.kind === "app-command") {
        // Replace /query with the full command path + space (options follow).
        composer.replaceRange(0, activeRange.end, `/${suggestion.fullName || suggestion.label} `);
      } else if (suggestion.kind === "app-option") {
        // Picking an option name inserts `name:` so the value picker opens next.
        if (suggestion.id === "__app-option-hint__") {
          mentionRangeRef.current = null;
          setMentionSuggestions([]);
          return;
        }
        composer.replaceRange(activeRange.start, activeRange.end, `${suggestion.label}:`);
      } else if (suggestion.kind === "app-choice") {
        // Insert the chosen option value, then a space to advance.
        composer.replaceRange(activeRange.start, activeRange.end, `${suggestion.id} `);
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

  /** Begin editing the current user's most recent editable message. */
  const editLastOwnMessage = useCallback(() => {
    if (!user) return false;
    for (let i = chat.messages.length - 1; i >= 0; i--) {
      const m = chat.messages[i];
      if (m.author?.id !== user.id) continue;
      // Skip optimistic (not-yet-persisted) messages
      if (m.pending || m.id.startsWith("temp-")) continue;
      chat.actions.startEditing(m);
      messageListRef.current?.scrollToMessage(m.id);
      return true;
    }
    return false;
  }, [user, chat.messages, chat.actions]);

  const highlightAndScroll = useCallback((id: string) => {
    messageListRef.current?.scrollToMessage(id);
    const el = document.getElementById(`message-${id}`);
    if (el) {
      el.classList.add("message-jump-highlight");
      setTimeout(() => el.classList.remove("message-jump-highlight"), 1600);
    }
  }, []);

  /** Jump to a message, loading the surrounding window first if it isn't in view
   *  (used by pinned-message and search-result navigation). */
  const jumpToMessage = useCallback(async (id: string) => {
    if (!id) return;
    if (document.getElementById(`message-${id}`)) {
      highlightAndScroll(id);
      return;
    }
    const ok = await chat.jumpToMessage(id);
    if (!ok) {
      toast.error(gt("Couldn't find that message"));
      return;
    }
    // Wait for the new window to render before scrolling.
    requestAnimationFrame(() => requestAnimationFrame(() => highlightAndScroll(id)));
  }, [chat, highlightAndScroll, gt]);

  // Honor a ?jump=<messageId> query param (from a copied message link) once the
  // channel's messages have had a moment to load.
  useEffect(() => {
    if (!currentChannel?.id || typeof window === "undefined") return;
    const jid = new URLSearchParams(window.location.search).get("jump");
    if (!jid) return;
    const t = setTimeout(() => {
      void jumpToMessage(jid);
      // Strip the param so refreshes/back don't re-trigger the jump.
      const url = new URL(window.location.href);
      url.searchParams.delete("jump");
      window.history.replaceState(null, "", url.toString());
    }, 700);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentChannel?.id]);

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
      // Tab / Enter accept the highlighted suggestion (autocomplete).
      // Enter only autocompletes here when there's a real selectable item;
      // it otherwise falls through to send below.
      if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
        const selected = mentionSuggestions[activeMentionIndex];
        if (selected) {
          if (selected.kind === "param-hint" || selected.id === "__app-option-hint__") {
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
    }

    const composer = messageBarRef.current?.getComposer();
    const isComposerEmpty = (composer?.getText().trim().length ?? 0) === 0;

    // ArrowUp on an empty composer edits your last message (Discord parity).
    if (e.key === "ArrowUp" && isComposerEmpty && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (editLastOwnMessage()) {
        e.preventDefault();
        return;
      }
    }

    // Escape clears the active reply, then falls back to blurring the composer.
    if (e.key === "Escape") {
      if (chat.actions.replyToMessage) {
        e.preventDefault();
        chat.actions.setReplyToMessage(null);
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

  // Wire broadcast keyboard-shortcut actions owned by the chat surface.
  useEffect(() => {
    const unsubs = [
      onHotkey("toggle-pins", () => setShowPins((v) => !v)),
      onHotkey("toggle-members", () => onToggleMembers?.()),
      onHotkey("focus-composer", () => messageBarRef.current?.getComposer()?.focus()),
      onHotkey("scroll-up", () => messageListRef.current?.scrollByViewport(-1)),
      onHotkey("scroll-down", () => messageListRef.current?.scrollByViewport(1)),
      onHotkey("jump-oldest-unread", () => messageListRef.current?.scrollToTop()),
      onHotkey("search-channel", () => {
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }),
      onHotkey("search-all", () => {
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }),
      onHotkey("edit-last-message", () => editLastOwnMessage()),
    ];
    return () => unsubs.forEach((u) => u());
  }, [onToggleMembers, editLastOwnMessage]);

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
              ref={searchInputRef}
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
          {(() => { const p = parseSearchQuery(searchQuery); return p.text.trim().length < 2 && !hasActiveFilters(p); })() ? (
            <div className="text-sm text-[var(--app-muted)] space-y-1">
              <p>{gt("Type at least 2 characters, or use filters:")}</p>
              <p className="text-xs font-mono text-[var(--app-muted)]/80">from:user · has:link|file|image|video|embed · before:2024-01-01 · after:2024-01-01 · in:#channel</p>
            </div>
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
                    void jumpToMessage(result.id);
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
        hasMoreNewer={chat.hasMoreNewer}
        isLoadingMore={chat.isLoadingMore}
        loadOlderMessages={chat.loadOlderMessages}
        loadNewerMessages={chat.loadNewerMessages}
        actions={chat.actions}
        currentUserId={user?.id}
        canModerate={canModerateMessages}
        canPin={canPinMessages}
        serverId={currentServer?.id}
        serverName={currentServer?.name}
        swipeEnabled={isMobile}
        mentionUsers={mentionUsers}
        mentionRoles={mentionRoles}
        userRoleColorMap={userRoleColorMap}
        serverEmojis={serverEmojis}
        availableServerEmojis={allServerEmojis}
        onMediaClick={lightbox.openMediaViewer}
        onSuppressEmbeds={chat.actions.suppressEmbeds}
        onReplyFocus={focusComposer}
        welcomeHeader={welcomeHeader}
        resetKey={currentChannel?.id}
      />

      <TypingIndicator text={chat.typingStatusText} />

      {currentChannel?.type === "announcement" && canSendInCurrentChannel === false && (
        <div className="mx-4 mb-2 px-4 py-2.5 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center gap-2.5 text-xs text-blue-400">
          <Megaphone className="w-4 h-4 shrink-0" />
          <span><T>This is an</T> <strong><T>announcement channel</T></strong>. <T>Only admins can post here.</T></span>
        </div>
      )}

      {currentChannel?.type !== "announcement" && canSendInCurrentChannel === false && currentChannel?.type !== "voice" && currentChannel?.type !== "stage" && (
        <div className="mx-4 mb-2 px-4 py-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center gap-2.5 text-xs text-amber-400">
          <Shield className="w-4 h-4 shrink-0" />
          <span><T>You do not have permission to send messages in this channel.</T></span>
        </div>
      )}

      <MessageBar
        ref={messageBarRef}
        disabled={selfTimeout.active || !canSendInCurrentChannel}
        placeholder={
          selfTimeout.active
            ? gt("You're timed out — {time} remaining", { time: selfTimeout.label })
            : !canSendInCurrentChannel
            ? gt("You don't have permission to send messages here")
            : `${gt("Message")} #${currentChannel?.name ?? ""}`
        }
        ariaLabel={
          selfTimeout.active
            ? gt("You're timed out — {time} remaining", { time: selfTimeout.label })
            : !canSendInCurrentChannel
            ? gt("You don't have permission to send messages here")
            : `${gt("Message")} #${currentChannel?.name ?? ""}`
        }
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
        draftKey={currentChannel ? `channel:${currentChannel.id}` : undefined}
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
        onJumpToMessage={(id) => void jumpToMessage(id)}
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
                        <AvatarImage src={cdnImage(item.author.avatar)} alt="" />
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
        canPin={canPinMessages}
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
        onDeleteNow={(message) => void chat.actions.deleteMessageNow(message)}
      />

      <DiscordBridgeConsentDialog open={bridgeConsentOpen} onOpenChange={setBridgeConsentOpen} />
    </div>
  );
}

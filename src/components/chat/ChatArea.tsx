"use client";

import dynamic from "next/dynamic";
import { MountWhenOpened } from "@/components/ui/MountWhenOpened";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useServer, useServerMembers, type ServerChannel } from "@/contexts/ServerContext";
import { useAuth } from "@/contexts/AuthContext";
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
  BellOff,
  Pin,
  Users,
  Search,
  Inbox,
  HelpCircle,
  ChevronLeft, 
  Megaphone,
  Shield,
  MessagesSquare,
  Archive,
  Lock,
} from "lucide-react";
import { cn, getTimeoutRemaining } from "@/lib/utils";
import { toast } from "sonner";
import { MessageBar, type MessageBarHandle } from "@/components/chat/MessageBar";
import { MessageList, type MessageListHandle } from "@/components/chat/MessageList";
import { MessageContextMenu } from "@/components/chat/MessageContextMenu";
import { TypingIndicator } from "@/components/chat/TypingIndicator";
import { notifyIncomingMessage, notificationPreview } from "@/lib/notifications/notify";
import type { MentionNames } from "@/lib/chat/mentionText";
import { useUnread, type ReadMarkerSnapshot } from "@/contexts/UnreadContext";
import { refreshMentionsNow } from "@/hooks/useMentions";
import { readMarkerMs } from "@/lib/chat/unreadMarker";
import { onJumpToMessage, openInbox, openNotificationSettings } from "@/lib/notifications/events";
import { useChatSession } from "@/hooks/useChatSession";
import { useTimeoutRemaining } from "@/hooks/useTimeoutRemaining";
import { usePermissions } from "@/hooks/usePermissions";
import { playTts } from "@/lib/chat/tts";
import { useSlashCommands } from "@/hooks/useSlashCommands";
import { useMediaLightbox } from "@/hooks/useMediaLightbox";
import { useIsMobile } from "@/hooks/useIsMobile";
import { decodeHtmlEntities, formatMessageTimestamp } from "@/lib/chat/messages";
import { quoteSearchValue } from "@/lib/chat/searchQuery";
import { useMessageSearch, type SearchHit, type SearchHitChannel } from "@/hooks/useMessageSearch";
import { MessageSearchBar, type MessageSearchBarHandle } from "@/components/chat/search/MessageSearchBar";
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
import { emitHotkey, onHotkey } from "@/lib/keybinds";
import { EMOJI_NAMES } from "@/lib/constants/emojis";
import { T, useGT, useLocale } from "gt-next";
import { Loader } from "@/components/ui/Loader";
import { canSendInChannel as canSendInChannelClient, hasChannelPermission } from "@/lib/roles/channelPermissions";
import { PERMISSION_BITS } from "@/lib/permissions/bits";
import { canHostThreads, isThreadType } from "@/lib/chat/threads";
import {
  closeThreadPanel,
  onThreadsBrowserRequest,
  openCreateThread,
  openThreadPanel,
} from "@/lib/chat/threadPanelStore";
import { useThreadInfo } from "@/hooks/useThreadInfo";
import { ThreadHeaderActions, ThreadHeaderTitle } from "@/components/chat/ThreadHeader";
import { MessageContent } from "@/components/chat/MessageContent";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { isSilentMessage } from "@/lib/chat/messageFlags";
import type { RoleIconData } from "@/components/chat/RoleIcon";

const ImageLightbox = dynamic(() => import("@/components/ui/image-lightbox").then((m) => m.ImageLightbox), { ssr: false });

const PinnedMessagesDialog = dynamic(() => import("@/components/chat/PinnedMessagesDialog").then((m) => m.PinnedMessagesDialog), { ssr: false });

const DeleteMessageDialog = dynamic(() => import("@/components/chat/DeleteMessageDialog").then((m) => m.DeleteMessageDialog), { ssr: false });

const ThreadsBrowser = dynamic(() => import("@/components/chat/ThreadsBrowser").then((m) => m.ThreadsBrowser), { ssr: false });
const MessageSearchPanel = dynamic(() => import("@/components/chat/search/MessageSearchPanel").then((m) => m.MessageSearchPanel), { ssr: false });

const DiscordBridgeConsentDialog = dynamic(() => import("@/components/chat/DiscordBridgeConsentDialog").then((m) => m.DiscordBridgeConsentDialog), { ssr: false });

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
  /** Show this channel instead of the selected one (the thread side panel). */
  channelOverride?: ServerChannel | null;
  /**
   * "panel": the thread side panel next to the channel. It keeps the channel's
   * hotkeys, unread engine reporting and ?jump handling with the main view.
   */
  variant?: "main" | "panel";
  /** Panel: close it (X). */
  onClosePanel?: () => void;
}

// Per-server SWR caches so bouncing between servers paints emojis/roles instantly
// and skips the refetch, while a background revalidation keeps them fresh.
type ServerEmoji = { id: string; name: string; url: string; serverId: string; animated?: boolean };
const serverEmojiCache = new Map<string, ServerEmoji[]>();
const serverRoleCache = new Map<string, MentionRole[]>();

export function ChatArea({ onToggleMembers, showMembers, channelOverride, variant = "main", onClosePanel }: ChatAreaProps) {
  const { currentChannel: selectedChannel, currentServer, channels } = useServer();
  // The thread side panel renders its thread through this same view.
  const currentChannel = channelOverride ?? selectedChannel;
  const isPanel = variant === "panel";
  // Reuse the members already fetched by ServerContext instead of fetching the
  // full member list a second time on every server open.
  const { members } = useServerMembers();
  const { user } = useAuth();
  const locale = useLocale();
  const gt = useGT();
  const perms = usePermissions(currentServer?.id);
  const canModerateMessages = perms.isOwner || perms.can("MANAGE_MESSAGES");

  // Threads (full view, or the side panel): header data, join / archive actions.
  const isThread = isThreadType(currentChannel?.type);
  const threadState = useThreadInfo(isThread && currentChannel ? currentChannel.id : null, currentServer?.id);
  const threadInfo = threadState.info;
  const threadParentId = isThread ? currentChannel?.parentId ?? null : null;
  const parentChannel = useMemo(
    () => (threadParentId ? channels.find((c) => c.id === threadParentId) ?? null : null),
    [threadParentId, channels],
  );
  // Names are stored HTML-escaped (sanitizeInput).
  const threadName = decodeHtmlEntities(threadInfo?.thread?.name || currentChannel?.name || "");
  const hostsThreads = !isPanel && !isThread && canHostThreads(currentChannel?.type);

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
  const searchBarRef = useRef<MessageSearchBarHandle>(null);
  const mobileSearchBarRef = useRef<MessageSearchBarHandle>(null);

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
  const [showPins, setShowPins] = useState(false);
  const {
    isChannelMuted: isConversationMuted,
    setActiveChannel,
    setActivePanelChannel,
    markChannelRead,
    markChannelUnread,
    getReadMarker,
    totalMentionCount,
    unreadChannels,
  } = useUnread();
  const channelMuted = currentChannel ? isConversationMuted(currentChannel.id) : false;
  const inboxBadge = totalMentionCount;
  const hasInboxUnreads = unreadChannels.length > 0;

  // The read marker as it was when this channel was opened: the red "NEW"
  // line and the unread bar stay put while the user reads (and acks) it.
  // Until this view acks, a newer marker (another device's read arriving after
  // the open) still moves it.
  const [openMarker, setOpenMarker] = useState<{ channelId: string | null; marker: ReadMarkerSnapshot | null; acked: boolean }>({
    channelId: null,
    marker: null,
    acked: false,
  });
  const openChannelId = currentChannel?.id ?? null;
  const liveMarker = openChannelId ? getReadMarker(openChannelId) : null;
  if (
    openMarker.channelId !== openChannelId ||
    (!openMarker.acked && readMarkerMs(liveMarker) > readMarkerMs(openMarker.marker))
  ) {
    setOpenMarker({ channelId: openChannelId, marker: liveMarker, acked: false });
  }
  const handleReadUpTo = useCallback(
    (message: { id: string; createdAt: string }) => {
      if (!openChannelId) return;
      setOpenMarker((prev) => (prev.acked ? prev : { ...prev, acked: true }));
      markChannelRead(openChannelId, message);
    },
    [openChannelId, markChannelRead],
  );
  // The channel on screen (mobile has no ChannelSidebar to report it): its
  // messages notify through this view, not the activity stream.
  useEffect(() => {
    if (!openChannelId) return;
    // The side panel's thread is on screen too, next to the channel.
    if (isPanel) {
      setActivePanelChannel(openChannelId);
      return () => setActivePanelChannel(null);
    }
    setActiveChannel(openChannelId);
  }, [openChannelId, isPanel, setActiveChannel, setActivePanelChannel]);
  const handleMarkRead = useCallback(() => {
    if (!openChannelId) return;
    setOpenMarker((prev) => (prev.acked ? prev : { ...prev, acked: true }));
    markChannelRead(openChannelId);
  }, [openChannelId, markChannelRead]);
  const [showHelp, setShowHelp] = useState(false);

  // Discord-style server-wide message search (shared engine with DMs).
  const searchScope = useMemo(
    () => (currentServer?.id ? { kind: "server" as const, serverId: currentServer.id } : null),
    [currentServer?.id],
  );
  const searchUsers = useMemo(
    () => members.map((m) => ({ id: m.id, username: m.username, displayName: m.displayName, avatar: m.avatar })),
    [members],
  );
  const searchChannels = useMemo(
    () => channels.filter((c) => c.type !== "category").map((c) => ({ id: c.id, name: c.name, type: c.type })),
    [channels],
  );
  const search = useMessageSearch({ scope: searchScope, users: searchUsers, channels: searchChannels });
  const setSearchDraft = search.setDraft;
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);

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
  // Keyed on the id: the 25s server-list poll can hand us a fresh object.
  const currentServerIdForFetch = currentServer?.id;
  useEffect(() => {
    const serverId = currentServerIdForFetch;
    if (!serverId) {
      setServerEmojis([]);
      return;
    }
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
  }, [currentServerIdForFetch]);

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
    const serverId = currentServerIdForFetch;
    if (!serverId) {
      setMentionRoles([]);
      return;
    }
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
  }, [currentServerIdForFetch]);

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

  // Role icon (highest role that has one) per member, shown next to names.
  const userRoleIconMap = useMemo<Record<string, RoleIconData>>(() => {
    const iconMap: Record<string, RoleIconData> = {};
    for (const m of members as Array<{ id: string; iconRole?: RoleIconData | null }>) {
      if (m.iconRole && (m.iconRole.icon || m.iconRole.unicodeEmoji)) iconMap[m.id] = m.iconRole;
    }
    return iconMap;
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
  const everyoneRole = useMemo(() => mentionRoles.find((r) => r.isDefault) ?? null, [mentionRoles]);
  // Threads have no overwrites of their own: the parent's apply.
  const threadOverwrites = threadState.permissionOverwrites;
  const permissionChannel = useMemo(() => {
    if (!currentChannel || !isThread) return currentChannel;
    return {
      ...currentChannel,
      permissionOverwrites: parentChannel?.permissionOverwrites ?? threadOverwrites ?? currentChannel.permissionOverwrites,
    };
  }, [currentChannel, isThread, parentChannel, threadOverwrites]);
  const permOpts = useMemo(
    () => ({
      everyoneRoleId: everyoneRole?.id ?? null,
      everyonePermissions: typeof everyoneRole?.permissions === "string" ? BigInt(everyoneRole.permissions) : null,
      userId: user?.id ?? null,
    }),
    [everyoneRole, user?.id],
  );
  const canCreateThreads = useMemo(
    () =>
      hostsThreads &&
      hasChannelPermission(currentChannel, PERMISSION_BITS.CREATE_PUBLIC_THREADS, currentUserRoleIds, currentUserRolePerms, perms.isOwner, perms.isAdmin, permOpts),
    [hostsThreads, currentChannel, currentUserRoleIds, currentUserRolePerms, perms.isOwner, perms.isAdmin, permOpts],
  );
  const canModerateThreads = useMemo(
    () =>
      isThread &&
      hasChannelPermission(permissionChannel, PERMISSION_BITS.MANAGE_THREADS, currentUserRoleIds, currentUserRolePerms, perms.isOwner, perms.isAdmin, permOpts),
    [isThread, permissionChannel, currentUserRoleIds, currentUserRolePerms, perms.isOwner, perms.isAdmin, permOpts],
  );
  const threadLocked = Boolean(threadInfo?.thread?.locked);
  const threadArchived = Boolean(threadInfo?.thread?.archived);
  const lockedOut = isThread && threadLocked && !canModerateThreads;
  const canSendInCurrentChannel = useMemo(() => {
    return canSendInChannelClient(
      permissionChannel,
      currentUserRoleIds,
      currentUserRolePerms,
      perms.isOwner,
      perms.isAdmin,
      {
        everyoneRoleId: everyoneRole?.id ?? null,
        everyonePermissions: typeof everyoneRole?.permissions === "string" ? BigInt(everyoneRole.permissions) : null,
        userId: user?.id ?? null,
      },
    );
  }, [permissionChannel, currentUserRoleIds, currentUserRolePerms, perms.isOwner, perms.isAdmin, everyoneRole, user?.id]);

  // Server-only: if the signed-in user is timed out, block the composer.
  const selfTimeoutUntil = useMemo(() => {
    if (!currentServer) return null;
    const self = (members as Array<{ id: string; communicationDisabledUntil?: string | null }>).find((m) => m.id === user?.id);
    return self?.communicationDisabledUntil ?? null;
  }, [members, user?.id, currentServer]);
  // Ticks every second so the countdown label updates live and the composer
  // re-enables the moment the timeout expires.
  const selfTimeout = useTimeoutRemaining(selfTimeoutUntil);

  // Server verification level (Discord): unverified email, a brand-new
  // account or a brand-new member can't talk yet. Time-based waits tick down
  // and lift on their own; members who get a role are exempt (server-checked).
  const verification = perms.verification;
  const verificationWait = useTimeoutRemaining(verification?.blocked ? verification.until : null);
  const verificationBlocked = Boolean(
    currentServer && verification?.blocked && (verification.reason === "email" || verificationWait.active),
  );
  const verificationMessage = !verificationBlocked
    ? ""
    : verification?.reason === "email"
      ? gt("This server requires a verified email address before you can talk here.")
      : verification?.reason === "account_age"
        ? gt("This server requires your account to be older than 5 minutes. You can talk in {time}.", { time: verificationWait.label })
        : gt("This server requires you to be a member for 10 minutes. You can talk in {time}.", { time: verificationWait.label });

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

  // Names for mention markup in notification previews ("@Alice", not "@user").
  const previewNames = useMemo<MentionNames>(
    () => ({
      users: Object.fromEntries(mentionUsers.map((u) => [u.id, u.displayName])),
      roles: Object.fromEntries(mentionRoles.map((r) => [r.id, r.name])),
      channels: Object.fromEntries(channels.map((c) => [c.id, c.name])),
    }),
    [mentionUsers, mentionRoles, channels],
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
        refreshMentionsNow();
      }

      // Sound / desktop notification (grouped per channel) / toast, honouring
      // this server's and channel's notification settings.
      const authorName = message.author?.displayName || message.author?.username || gt("Someone");
      const showPreview = user?.settings?.notifications?.showPreview !== false;
      const preview = showPreview
        ? (notificationPreview(message.content, 140, previewNames) || (message.attachments?.length ? "📎 " + gt("Attachment") : gt("New message")))
        : gt("New message");
      const parentId = currentChannel?.id === message.channelId ? currentChannel?.parentId : undefined;
      const grandParentId = parentId ? channels.find((c) => c.id === parentId)?.parentId : undefined;
      const serverId = currentServer?.id;
      const channelUrl = serverId ? `/channels/${serverId}/${message.channelId}` : "/channels/me";
      const label = currentChannel?.name ? `#${currentChannel.name}` : gt("a channel");
      // "@silent" messages never sound or pop a notification.
      if (!isSilentMessage(message.flags)) notifyIncomingMessage({
        channelId: message.channelId,
        serverId,
        ancestorIds: [parentId, grandParentId],
        isDM: false,
        isMentioned,
        isRoleMention: !isDirectMention && Boolean(isRoleMention),
        isEveryoneMention,
        viewing: true,
        title: isMentioned ? gt("{name} mentioned you", { name: authorName }) : gt("{name} in {channel}", { name: authorName, channel: label }),
        body: preview,
        showPreview,
        icon: message.author?.avatar,
        url: `${channelUrl}?jump=${encodeURIComponent(message.id)}`,
        formatMany: (count) => gt("{count} new messages", { count }),
        toastTitle: authorName,
        toastAction: gt("View"),
        onToastAction: () => {
          window.focus();
          messageListRef.current?.scrollToBottom();
        },
        quiet: !isMentioned && !isEveryoneMention,
        messageId: message.id,
      });

      // Auto TTS: speak incoming messages when the listener has TTS enabled, or
      // whenever the message was explicitly sent with the /tts prefix (so a
      // /tts message is heard by everyone in the channel — web and desktop).
      const ttsEnabled = user?.settings?.accessibility?.tts === true;
      const hasTtsPrefix = typeof message.content === "string" && message.content.startsWith("/tts ");
      if ((ttsEnabled || hasTtsPrefix) && message.content) {
        void playTts({
          content: message.content,
          authorName,
          rate: user?.settings?.accessibility?.ttsRate,
          voiceGender: user?.settings?.accessibility?.ttsVoice,
        });
      }
    },
    [user?.id, user?.settings, currentUserRoleIds, currentServer?.id, currentChannel?.id, currentChannel?.parentId, currentChannel?.name, channels, gt, previewNames]
  );

  const applyThreadSummary = threadState.applySummary;
  const markThreadJoined = threadState.markJoined;
  // Threads browser (header popout) and the panel openers.
  const [showThreads, setShowThreads] = useState(false);
  const [threadsVersion, setThreadsVersion] = useState(0);
  const currentChannelId = currentChannel?.id ?? null;
  const handleCreateThread = useCallback(
    (message: Message) => {
      if (!currentChannelId) return;
      openCreateThread(currentChannelId, {
        id: message.id,
        content: message.content,
        createdAt: message.createdAt,
        author: message.author
          ? {
              id: message.author.id,
              username: message.author.username,
              displayName: message.author.displayName,
              avatar: message.author.avatar,
            }
          : null,
        attachments: message.attachments,
      });
    },
    [currentChannelId],
  );
  const handleOpenThread = useCallback(
    (threadId: string) => {
      if (currentChannelId) openThreadPanel(currentChannelId, threadId);
    },
    [currentChannelId],
  );
  const handleSeeAllThreads = useCallback(() => setShowThreads(true), []);
  // "See all threads." on a "started a thread" row.
  useEffect(
    () =>
      onThreadsBrowserRequest((parentId) => {
        if (parentId === currentChannelId && !isPanel) setShowThreads(true);
      }),
    [currentChannelId, isPanel],
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
    onOtherEvent: (event) => {
      // This thread's header (archived, locked, renamed, counts).
      if (event.type === "thread_state" && event.thread) applyThreadSummary(event.thread);
      // Threads started here changed: the open threads browser refetches.
      else if (event.type === "thread_create" || event.type === "thread_update") setThreadsVersion((v) => v + 1);
    },
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
      if (verificationBlocked) return;
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
    // Posting in a thread joins it (the server adds you).
    if (isThread) markThreadJoined();

    // First message in a Discord-bridged channel → ask for sync consent once.
    if (currentChannelBridged && !user?.settings?.dataPrivacy?.discordBridgePrompted) {
      setBridgeConsentOpen(true);
    }
  }, [executeCommand, chat, user?.settings?.accessibility?.ttsRate, user?.settings?.accessibility?.ttsVoice, currentServer, members, user?.id, currentChannelBridged, user?.settings?.dataPrivacy?.discordBridgePrompted, isThread, markThreadJoined, user, currentChannel?.id, verificationBlocked]);

  const lightbox = useMediaLightbox(chat.mediaGallery);

  const { setReplyToMessage } = chat.actions;
  useEffect(() => {
    if (!currentChannel) return;
    setReplyToMessage(null);
    mentionRangeRef.current = null;
    setMentionSuggestions([]);
    setActiveMentionIndex(0);
  }, [currentChannel, setReplyToMessage]);


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
            description: gt("Text channel"),
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
        { id: "everyone", kind: "everyone", label: "everyone", description: gt("Notify everyone in this channel") },
        { id: "here", kind: "here", label: "here", description: gt("Notify currently active members") },
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
          description: gt("Role mention"),
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
    [mentionRoles, mentionUsers, userRoleColorMap, allServerEmojis, currentServer, channels, appLeaves, gt]
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


  /** Begin editing the current user's most recent editable message. */
  const editLastOwnMessage = useCallback(() => {
    if (!user) return false;
    for (let i = chat.messages.length - 1; i >= 0; i--) {
      const m = chat.messages[i];
      if (m.author?.id !== user.id) continue;
      // Skip optimistic (not-yet-persisted) messages
      if (m.pending || m.id.startsWith("temp-")) continue;
      // Polls and forwards have no text of their own to edit.
      if (m.poll || m.forward || m.type === "poll_result") continue;
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

  /** Search result click: jump in place, or open its channel at that message. */
  const handleSearchJump = useCallback((hit: SearchHit, channel: SearchHitChannel | null) => {
    if (isMobile) setMobileSearchOpen(false);
    if (currentChannel?.id === hit.channelId) {
      void jumpToMessage(hit.id);
      return;
    }
    const serverId = channel?.serverId || hit.serverId || currentServer?.id;
    if (!serverId) return;
    router.push(`/channels/${serverId}/${hit.channelId}?jump=${encodeURIComponent(hit.id)}`);
  }, [isMobile, currentChannel?.id, currentServer?.id, jumpToMessage, router]);

  // Honor a ?jump=<messageId> query param (from a copied message link) once the
  // channel's messages have had a moment to load.
  useEffect(() => {
    // ?jump belongs to the page's channel, not the side panel's thread.
    if (isPanel || !currentChannel?.id || typeof window === "undefined") return;
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

  // Inbox / notification click aimed at this (already open) channel.
  useEffect(() => {
    if (isPanel || !currentServer?.id || !currentChannel?.id) return;
    return onJumpToMessage(`/channels/${currentServer.id}/${currentChannel.id}`, (id) => {
      void jumpToMessage(id);
      const url = new URL(window.location.href);
      if (url.searchParams.has("jump")) {
        url.searchParams.delete("jump");
        window.history.replaceState(null, "", url.toString());
      }
    });
  }, [currentServer?.id, currentChannel?.id, jumpToMessage, isPanel]);

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
        if (selected && (selected.kind === "param-hint" || selected.id === "__app-option-hint__")) {
          // A hint card isn't selectable: dismiss it. Tab stays in the composer;
          // Enter falls through to the send path below.
          mentionRangeRef.current = null;
          setMentionSuggestions([]);
          setActiveMentionIndex(0);
          if (e.key === "Tab") {
            e.preventDefault();
            return;
          }
        } else {
          if (selected) {
            e.preventDefault();
            insertMentionFromSuggestion(selected);
          }
          return;
        }
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
      if (messageBarRef.current?.getAttachments().length) {
        e.preventDefault();
        messageBarRef.current?.removeLatestAttachment();
        return;
      }
      if (chat.actions.replyToMessage) {
        e.preventDefault();
        chat.actions.setReplyToMessage(null);
        return;
      }
      // Nothing to cancel: Escape marks the channel read (Discord parity).
      // The side panel marks its own thread read instead of the channel.
      if (isPanel) handleMarkRead();
      else emitHotkey("mark-channel-read");
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
    // Global shortcuts belong to the main channel view, not the thread panel.
    if (isPanel) return;
    const unsubs = [
      onHotkey("toggle-pins", () => setShowPins((v) => !v)),
      onHotkey("toggle-members", () => onToggleMembers?.()),
      onHotkey("focus-composer", () => messageBarRef.current?.getComposer()?.focus()),
      onHotkey("scroll-up", () => messageListRef.current?.scrollByViewport(-1)),
      onHotkey("scroll-down", () => messageListRef.current?.scrollByViewport(1)),
      onHotkey("jump-oldest-unread", () => messageListRef.current?.jumpToUnread()),      // Ctrl+F searches this channel (pre-filled in:), Ctrl+Shift+F the server.
      onHotkey("search-channel", () => {
        const prefill = currentChannel?.name ? `in:${quoteSearchValue(currentChannel.name)} ` : undefined;
        if (isMobile) {
          setMobileSearchOpen(true);
          if (prefill) setSearchDraft(prefill);
          return;
        }
        searchBarRef.current?.focus(prefill);
      }),
      onHotkey("search-all", () => {
        if (isMobile) {
          setMobileSearchOpen(true);
          return;
        }
        searchBarRef.current?.focus();
      }),
      onHotkey("edit-last-message", () => editLastOwnMessage()),
    ];
    return () => unsubs.forEach((u) => u());
  }, [onToggleMembers, editLastOwnMessage, isPanel, currentChannel?.name, isMobile, setSearchDraft]);


  // Opening a channel doesn't mark it read: MessageList acks the newest message
  // once it's actually been seen (see onReadUpTo below).

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



  const starter = threadInfo?.starterMessage ?? null;
  const threadOwnerId = threadInfo?.thread?.ownerId ?? null;
  const threadOwnerName = threadOwnerId
    ? (members as Array<{ id: string; username: string; displayName?: string }>).find((m) => m.id === threadOwnerId)?.displayName ||
      (starter?.author?.id === threadOwnerId ? starter.author.displayName : null)
    : null;
  const welcomeHeader = isThread ? (
    <div className="px-4 pb-4 mb-4 border-b border-[var(--app-border)]">
      <div className="w-16 h-16 mb-2 rounded-full bg-[var(--app-surface-alt)] flex items-center justify-center border border-[var(--app-border)]">
        <MessagesSquare className="w-8 h-8 text-[var(--text-primary)]" />
      </div>
      <h1 className="text-2xl font-bold text-[var(--text-primary)] mb-1 break-words">{threadName}</h1>
      {threadOwnerName && (
        <p className="text-sm text-[var(--app-muted)]">{gt("Started by {name}", { name: threadOwnerName })}</p>
      )}
      {starter && (
          <div className="mt-3 rounded-lg border border-[var(--app-border)] bg-[var(--app-surface)] p-3">
            <p className="mb-1 text-sm font-semibold text-[var(--text-primary)]">
              {starter.author?.displayName || starter.author?.username || gt("Unknown")}
              <span className="ml-2 text-xs font-normal text-[var(--app-muted)]">{formatMessageTimestamp(starter.createdAt, gt, locale)}</span>
            </p>
            <MessageContent
              content={starter.content}
              serverEmojis={serverEmojis}
              mentionUsers={mentionUsers}
              mentionRoles={mentionRoles}
              currentUserId={user?.id}
              serverId={currentServer?.id}
              edited={starter.edited}
              className="chat-message-body text-[var(--app-text)]"
            />
          </div>
      )}
    </div>
  ) : (
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
          {isMobile && !isPanel && (
            <button
              onClick={() =>
                router.push(
                  isThread && currentChannel.parentId
                    ? `/channels/${currentServer?.id}/${currentChannel.parentId}`
                    : `/channels/${currentServer?.id}`,
                )
              }
              aria-label={gt("Back")}
              className="p-2 -ml-1 rounded-lg hover:bg-[var(--app-surface-alt)] transition-colors"
            >
              <ChevronLeft className="w-5 h-5 text-[var(--app-muted)]" />
            </button>
          )}
          {isThread ? (
            <ThreadHeaderTitle
              name={threadName}
              parentName={isPanel ? null : parentChannel?.name ?? threadInfo?.parentName ?? currentChannel.parentName ?? null}
              onOpenParent={
                !isPanel && currentChannel.parentId
                  ? () => router.push(`/channels/${currentServer?.id}/${currentChannel.parentId}`)
                  : undefined
              }
              isPrivate={currentChannel.type === "private_thread" || threadInfo?.thread?.type === "private_thread"}
            />
          ) : currentChannel.type === "announcement" ? (
            <Megaphone className="w-5 sm:w-6 h-5 sm:h-6 text-[var(--app-muted-2)] flex-shrink-0" />
          ) : (
            <Hash className="w-5 sm:w-6 h-5 sm:h-6 text-[var(--app-muted-2)] flex-shrink-0" />
          )}
          {!isThread && (
            <span className="font-semibold text-[var(--text-primary)] truncate text-sm sm:text-base">{currentChannel.name}</span>
          )}
          {currentChannel.type === "announcement" && (
            <span className="ml-1 shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-500/15 text-blue-400 select-none hidden sm:inline">ANNOUNCEMENTS</span>
          )}
        </div>
        <div className="flex items-center gap-2 sm:gap-4 text-[var(--app-muted)]">
          {isThread && (
            <ThreadHeaderActions
              threadId={currentChannel.id}
              serverId={currentServer?.id}
              state={threadState}
              canModerateThreads={canModerateThreads}
              onExpand={
                isPanel
                  ? () => {
                      closeThreadPanel();
                      router.push(`/channels/${currentServer?.id}/${currentChannel.id}`);
                    }
                  : undefined
              }
              onClose={isPanel ? onClosePanel : undefined}
            />
          )}
          {hostsThreads && (
            <Popover open={showThreads} onOpenChange={setShowThreads}>
              <PopoverTrigger asChild>
                <button
                  className={cn(
                    "p-2 -m-1 sm:p-0 sm:m-0 rounded-lg flex items-center justify-center hover:text-[var(--text-primary)] transition-colors",
                    showThreads && "text-[var(--text-primary)]",
                  )}
                  title={gt("Threads")}
                  aria-label={gt("Threads")}
                >
                  <MessagesSquare className="w-5 h-5" />
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-auto p-0 border-[var(--app-border)] bg-[var(--app-surface)] text-[var(--text-primary)]">
                <MountWhenOpened open={showThreads}>
                  <ThreadsBrowser
                    channelId={currentChannel.id}
                    channelName={currentChannel.name}
                    version={threadsVersion}
                    canCreate={canCreateThreads}
                    onOpenThread={(threadId) => {
                      setShowThreads(false);
                      handleOpenThread(threadId);
                    }}
                    onCreate={() => {
                      setShowThreads(false);
                      openCreateThread(currentChannel.id, null);
                    }}
                  />
                </MountWhenOpened>
              </PopoverContent>
            </Popover>
          )}
          {!isPanel && (<>
          <button
            className="hover:text-[var(--text-primary)] transition-colors hidden sm:block"
            onClick={() =>
              openNotificationSettings({
                scope: "channel",
                id: currentChannel.id,
                name: `#${currentChannel.name}`,
                serverId: currentServer?.id,
                parentId: currentChannel.parentId ?? null,
              })
            }
            title={gt("Notification Settings")}
            aria-label={gt("Notification Settings")}
          >
            {channelMuted ? <BellOff className="w-5 h-5 text-red-400" /> : <Bell className="w-5 h-5" />}
          </button>
          <button
            className="p-2 -m-1 sm:p-0 sm:m-0 rounded-lg flex items-center justify-center hover:text-[var(--text-primary)] transition-colors"
            onClick={() => {
              setShowPins(true);
              void chat.fetchPinnedMessages();
            }}
            title={gt("View pinned messages")}
            aria-label={gt("View pinned messages")}
          >
            <Pin className="w-5 h-5" />
          </button>
          <button
            onClick={onToggleMembers}
            aria-label={gt("Toggle member list")}
            className={cn("p-2 -m-1 sm:p-0 sm:m-0 rounded-lg flex items-center justify-center hover:text-[var(--text-primary)] transition-colors", showMembers && "text-[var(--text-primary)]")}
          >
            <Users className="w-5 h-5" />
          </button>
          <div className="h-6 w-px bg-[var(--app-border)] hidden md:block" />
          <MessageSearchBar
            ref={searchBarRef}
            search={search}
            placeholder={currentServer?.name ? gt("Search {server}", { server: currentServer.name }) : gt("Search")}
            className="hidden md:block"
          />
          <button
            type="button"
            className="md:hidden p-2 -m-1 rounded-lg flex items-center justify-center hover:text-[var(--text-primary)] transition-colors"
            onClick={() => setMobileSearchOpen(true)}
            title={gt("Search")}
            aria-label={gt("Search")}
          >
            <Search className="w-5 h-5" />
          </button>
          <button
            className={cn(
              "hover:text-[var(--text-primary)] transition-colors hidden sm:block relative",
              (inboxBadge > 0 || hasInboxUnreads) && "text-[var(--text-primary)]"
            )}
            onClick={() => openInbox()}
            title={gt("Inbox")}
            aria-label={gt("Inbox")}
          >
            <Inbox className="w-5 h-5" />
            {inboxBadge > 0 ? (
              <span className="absolute -top-1 -right-1 min-w-[16px] h-[16px] px-1 flex items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white leading-none">
                {inboxBadge > 99 ? "99+" : inboxBadge}
              </span>
            ) : hasInboxUnreads ? (
              <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-[var(--app-accent)]" aria-hidden="true" />
            ) : null}
          </button>
          <button
            className="hover:text-[var(--text-primary)] transition-colors hidden sm:block"
            onClick={() => setShowHelp(true)}
            title={gt("Open help")}
          >
            <HelpCircle className="w-5 h-5" />
          </button>
          </>)}
        </div>
      </div>

      <div className="flex-1 flex min-h-0 min-w-0">
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
      {/* Messages */}
      <MessageList
        onJumpToMessage={jumpToMessage}
        onAtBottomChange={chat.handleAtBottomChange}
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
        userRoleIconMap={userRoleIconMap}
        serverEmojis={serverEmojis}
        availableServerEmojis={allServerEmojis}
        onMediaClick={lightbox.openMediaViewer}
        onSuppressEmbeds={chat.actions.suppressEmbeds}
        onReplyFocus={focusComposer}
        welcomeHeader={welcomeHeader}
        resetKey={currentChannel?.id}
        unreadMarker={openMarker.marker}
        onReadUpTo={handleReadUpTo}
        onMarkRead={handleMarkRead}
        canCreateThread={canCreateThreads}
        onCreateThread={canCreateThreads ? handleCreateThread : undefined}
        onOpenThread={hostsThreads ? handleOpenThread : undefined}
        onSeeAllThreads={hostsThreads ? handleSeeAllThreads : undefined}
        secondary={isPanel}
        onMarkUnread={(plan) => {
          if (openChannelId) markChannelUnread(openChannelId, plan);
        }}
        onJumpToPresent={chat.returnToPresent}
        canManageReactions={canModerateMessages}
      />

      <TypingIndicator text={chat.typingStatusText} />

      {currentChannel?.type === "announcement" && canSendInCurrentChannel === false && (
        <div className="mx-4 mb-2 px-4 py-2.5 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center gap-2.5 text-xs text-blue-400">
          <Megaphone className="w-4 h-4 shrink-0" />
          <span><T>This is an</T> <strong><T>announcement channel</T></strong>. <T>Only admins can post here.</T></span>
        </div>
      )}

      {isThread && threadLocked && (
        <div className="mx-4 mb-2 px-4 py-2.5 rounded-lg bg-[var(--app-surface-alt)] border border-[var(--app-border)] flex items-center gap-2.5 text-xs text-[var(--app-muted)]">
          <Lock className="w-4 h-4 shrink-0" />
          <span>{canModerateThreads ? gt("This thread is locked. Only moderators can send messages.") : gt("This thread is locked.")}</span>
        </div>
      )}

      {isThread && !threadLocked && threadArchived && (
        <div className="mx-4 mb-2 px-4 py-2.5 rounded-lg bg-[var(--app-surface-alt)] border border-[var(--app-border)] flex items-center gap-2.5 text-xs text-[var(--app-muted)]">
          <Archive className="w-4 h-4 shrink-0" />
          <span>{gt("This thread is archived. Sending a message will unarchive it.")}</span>
        </div>
      )}

      {currentChannel?.type !== "announcement" && canSendInCurrentChannel === false && !lockedOut && currentChannel?.type !== "voice" && currentChannel?.type !== "stage" && (
        <div className="mx-4 mb-2 px-4 py-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center gap-2.5 text-xs text-amber-400">
          <Shield className="w-4 h-4 shrink-0" />
          <span><T>You do not have permission to send messages in this channel.</T></span>
        </div>
      )}

      {verificationBlocked && canSendInCurrentChannel && !selfTimeout.active && currentChannel?.type !== "voice" && currentChannel?.type !== "stage" && (
        <div role="status" className="mx-4 mb-2 px-4 py-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center gap-2.5 text-xs text-amber-500">
          <Shield className="w-4 h-4 shrink-0" />
          <span>{verificationMessage}</span>
        </div>
      )}

      <MessageBar
        ref={messageBarRef}
        disabled={selfTimeout.active || !canSendInCurrentChannel || lockedOut || verificationBlocked}
        secondary={isPanel}
        placeholder={
          selfTimeout.active
            ? gt("You're timed out â {time} remaining", { time: selfTimeout.label })
            : verificationBlocked
            ? verificationMessage
            : lockedOut
            ? gt("This thread is locked.")
            : !canSendInCurrentChannel
            ? gt("You don't have permission to send messages here")
            : isThread
            ? `${gt("Message")} ${threadName}`
            : `${gt("Message")} #${currentChannel?.name ?? ""}`
        }
        ariaLabel={
          selfTimeout.active
            ? gt("You're timed out — {time} remaining", { time: selfTimeout.label })
            : verificationBlocked
            ? verificationMessage
            : lockedOut
            ? gt("This thread is locked.")
            : !canSendInCurrentChannel
            ? gt("You don't have permission to send messages here")
            : isThread
            ? `${gt("Message")} ${threadName}`
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
        replyMention={chat.actions.replyMention}
        onToggleReplyMention={chat.actions.toggleReplyMention}
        onCancelReply={() => chat.actions.setReplyToMessage(null)}
        mentionSuggestions={mentionSuggestions}
        onMentionSelect={insertMentionFromSuggestion}
        activeMentionIndex={activeMentionIndex}
        channelId={currentChannel?.id}
        pollApiBase={currentChannel ? `/api/channels/${currentChannel.id}` : undefined}
        draftKey={currentChannel ? `channel:${currentChannel.id}` : undefined}
      />
      </div>

      <MountWhenOpened open={search.open && !isMobile}>
        {search.open && !isMobile && (
          <MessageSearchPanel
            search={search}
            onJump={handleSearchJump}
            onClose={search.close}
            serverEmojis={allServerEmojis}
          />
        )}
      </MountWhenOpened>
      </div>

      <MountWhenOpened open={isMobile && mobileSearchOpen}>
        {isMobile && mobileSearchOpen && (
          <MessageSearchPanel
            mobile
            search={search}
            onJump={handleSearchJump}
            onClose={() => {
              setMobileSearchOpen(false);
              search.close();
            }}
            serverEmojis={allServerEmojis}
            searchBar={
              <MessageSearchBar
                ref={mobileSearchBarRef}
                search={search}
                expanded
                autoFocus={!search.submitted}
                placeholder={currentServer?.name ? gt("Search {server}", { server: currentServer.name }) : gt("Search")}
              />
            }
          />
        )}
      </MountWhenOpened>

      <MountWhenOpened open={lightbox.isLightboxOpen}>
        <ImageLightbox
          items={lightbox.lightboxItems}
          currentIndex={lightbox.lightboxCurrentIndex}
          isOpen={lightbox.isLightboxOpen}
          onNavigate={lightbox.standaloneMedia ? undefined : lightbox.setLightboxIndex}
          onClose={lightbox.closeMediaViewer}
        />
      </MountWhenOpened>

      <MountWhenOpened open={Boolean(chat.actions.deleteConfirmMessage)}>
        <DeleteMessageDialog
          message={chat.actions.deleteConfirmMessage}
          onCancel={() => chat.actions.setDeleteConfirmMessage(null)}
          onConfirm={() => void chat.actions.confirmDelete()}
        />
      </MountWhenOpened>

      <MountWhenOpened open={showPins}>
      <PinnedMessagesDialog
        open={showPins}
        onOpenChange={setShowPins}
        messages={chat.pinnedMessages}
        isLoading={chat.isLoadingPins}
        contextLabel={`#${currentChannel?.name}`}
        onJumpToMessage={(id) => void jumpToMessage(id)}
        onUnpin={(message) => void chat.actions.togglePin(message)}
      />
      </MountWhenOpened>

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
        onMarkUnread={(message) => messageListRef.current?.markUnreadFrom(message.id)}
        onViewReactions={(message) => chat.actions.setReactionsViewer({ message })}
        onReport={chat.actions.setReportMessage}
        onToggleReaction={(message, emoji, hasReacted) => chat.actions.toggleReaction(message.id, emoji, hasReacted)}
        currentUserId={user?.id}
        onCreateThread={canCreateThreads ? handleCreateThread : undefined}
        onOpenThread={hostsThreads ? handleOpenThread : undefined}
      />

      <MountWhenOpened open={bridgeConsentOpen}>
        <DiscordBridgeConsentDialog open={bridgeConsentOpen} onOpenChange={setBridgeConsentOpen} />
      </MountWhenOpened>
    </div>
  );
}

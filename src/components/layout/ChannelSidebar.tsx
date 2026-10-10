"use client";

import dynamic from "next/dynamic";
import { emitHotkey } from "@/lib/keybinds";

import { sharedGet } from "@/lib/bootFetch";
import { useServer } from "@/contexts/ServerContext";
import { useAuth } from "@/contexts/AuthContext";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Hash,
  Volume2,
  Megaphone,
  MessagesSquare,
  ChevronDown,
  Settings,
  UserPlus,
  PlusCircle,
  Folder,
  Bell,
  Shield,
  LogOut,
  Mic,
  MicOff,
  Headphones,
  HeadphoneOff,
  ChevronRight,
  Lock,
  Clock,
  Users,
  Inbox,
  X,
  Edit2,
  Trash2,
  Copy,
  Check,
  Link as LinkIcon,
  BellOff,
  AlertTriangle,
  Phone,
  CheckCheck,
} from "lucide-react";
import { cn, cdnImage } from "@/lib/utils";
import { getDisplayNameStyleClasses, getDisplayNameStyleInline } from "@/lib/userDisplayNameStyle";
import { getNameplateBackground } from "@/lib/constants/nameplates";
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { UserMenuItems } from "@/components/user/UserContextMenu";
import { CustomStatusLine } from "@/components/user/CustomStatus";
import { hasCustomStatus } from "@/lib/social/customStatus";
import { seedMessageRequestCount, useMessageRequests } from "@/lib/social/messageRequestsStore";
import { UserProfilePopup } from "@/components/user/UserProfilePopup";
import { VoiceBar } from "@/components/voice/VoiceBar";
import { VoiceChannelMembers, isVoiceMemberDrag, readVoiceMemberDrag } from "@/components/voice/VoiceChannelMembers";
import { VOICE_STATES_REFRESH_EVENT, moderateVoiceMember } from "@/components/voice/VoiceUserMenu";
import { ServerBadge } from "@/components/ui/badges";
import { isMuteActive, muteUntilFor } from "@/lib/notifications/levels";
import { updateNotificationOverride, useNotificationPrefs } from "@/lib/notifications/prefsStore";
import { openNotificationSettings } from "@/lib/notifications/events";
import { useMuteOptions, useMutedUntilLabel } from "@/components/notifications/useMuteOptions";
import { useUnread } from "@/contexts/UnreadContext";
import { prefetchChannelMessages } from "@/hooks/useChatSession";
import { usePermissions } from "@/hooks/usePermissions";
import { usePolling } from "@/hooks/usePolling";
import { voiceService, type VoiceParticipant } from "@/lib/services/voiceService";
import { startGroupCall } from "@/lib/services/dmCallController";
import { groupDisplayName } from "@/lib/chat/dmCall";
import { dmChannelApiBase, dmChannelHref, groupDmHref, isDmChannelOpen } from "@/lib/chat/groupDm";
import type { GroupInfo } from "@/lib/chat/groupDmClient";
import { GroupDmIcon } from "@/components/dm/GroupDmIcon";
import { MountWhenOpened } from "@/components/ui/MountWhenOpened";
import { T, useGT } from "gt-next";
import { useIsClient } from "@/hooks/useIsClient";
import { toast } from "sonner";
import { useConfirm } from "@/components/ui/confirm-dialog";

const ChannelSettingsDialog = dynamic(() => import("@/components/dialogs/ChannelSettingsDialog").then((m) => m.ChannelSettingsDialog), { ssr: false });
const GroupDmPickerDialog = dynamic(() => import("@/components/dm/GroupDmPickerDialog").then((m) => m.GroupDmPickerDialog), { ssr: false });

/** Channel types shown in a message list, which acks reads itself once seen. */
const MESSAGE_LIST_TYPES = new Set(["text", "announcement", "public_thread", "private_thread"]);

interface DMChannel {
  id: string;
  type: string;
  recipients: {
    id: string;
    username: string;
    displayName: string;
    avatar?: string;
    status: string;
    customStatus?: string | null;
    isPremium?: boolean;
    isSystem?: boolean;
    isBot?: boolean;
    isVerified?: boolean;
    customization?: {
      profileColor?: string;
      profileAccentColor?: string;
      profileGradient?: string[];
      displayNameStyle?: {
        font?: 'default' | 'serif' | 'mono' | 'rounded' | 'cursive' | 'bold';
        effect?: 'solid' | 'gradient' | 'neon' | 'toon' | 'pop';
        color?: string;
        gradient?: string[];
      };
    } | null;
  }[];
  lastMessageId?: string;
  /** Newest message (its own time and author drive unread, not `updatedAt`). */
  lastMessage?: { id?: string; authorId?: string; createdAt?: string } | null;
  updatedAt?: string;
  unreadCount?: number;
  /** Group DMs only: the group's own name (may be a default). */
  name?: string | null;
  /** Group DMs only: the group icon. */
  icon?: string | null;
  /** Group DMs only: the owner. */
  ownerId?: string | null;
}

/** A DM list row's title: the other person, or the group's name / members. */
function dmRowTitle(channel: DMChannel): string {
  if (channel.type === "group_dm") {
    return groupDisplayName(channel.name, channel.recipients.map((r) => r.displayName || r.username));
  }
  const r = channel.recipients[0];
  return r ? r.displayName || r.username : "";
}

const CLOSED_DMS_KEY = "serikacord:closed-dms";

interface ChannelSidebarProps {
  onInvitePeople?: () => void;
  onServerSettings?: () => void;
  onCreateChannel?: (defaultType?: "text" | "voice" | "category", defaultParentId?: string) => void;
  onCreateCategory?: () => void;
  onLeaveServer?: () => void;
}

export function ChannelSidebar({
  onInvitePeople,
  onServerSettings,
  onCreateChannel,
}: ChannelSidebarProps) {
  const { currentServer, channels, currentChannel, leaveServer, deleteChannel, updateChannel, reorderChannels } = useServer();
  const { user } = useAuth();
  const router = useRouter();
  const { can, isAdmin } = usePermissions(currentServer?.id);
  const gt = useGT();
  const confirmDialog = useConfirm();
  const canManageChannels = can("MANAGE_CHANNELS");
  const canManageServer = can("MANAGE_SERVER");
  const canInvite = can("CREATE_INVITE");
  const canManageAny = canManageChannels || canManageServer || isAdmin;
  const { isChannelUnread, getMentionCount, registerChannels, setActiveChannel, seedDmChannels, notifyDmActivity, markChannelRead, markChannelsRead, isChannelMuted } = useUnread();
  const notifPrefs = useNotificationPrefs();
  const muteOptions = useMuteOptions();
  const mutedUntilLabel = useMutedUntilLabel();
  const [activeVoiceChannelName, setActiveVoiceChannelName] = useState<string | undefined>(undefined);
  const [voiceParticipants, setVoiceParticipants] = useState<import("@/lib/services/voiceService").VoiceParticipant[]>([]);

  useEffect(() => {
    if (user?.id) {
      voiceService.setUserId(user.id);
    }
  }, [user?.id]);

  useEffect(() => {
    // Sync initial state
    setVoiceParticipants(voiceService.currentParticipants);
    if (voiceService.connected) {
      const roomId = voiceService.currentRoomId;
      if (roomId) {
        const ch = channels.find(c => `channel-${c.id}` === roomId);
        setActiveVoiceChannelName(ch?.name);
      }
    }

    const unsub = voiceService.subscribe((event) => {
      if (event.type === "participants_changed") {
        setVoiceParticipants(event.participants);
      } else if (event.type === "connected") {
        setVoiceParticipants(voiceService.currentParticipants);
        const roomId = voiceService.currentRoomId;
        if (roomId) {
          const ch = channels.find(c => `channel-${c.id}` === roomId);
          setActiveVoiceChannelName(ch?.name);
        }
      } else if (event.type === "disconnected") {
        setVoiceParticipants([]);
        setActiveVoiceChannelName(undefined);
      }
    });
    return unsub;
  }, [channels]);

  const navigateToChannel = (channel: typeof channels[0]) => {
    if (!currentServer) return;
    router.push(`/channels/${currentServer.id}/${channel.id}`);
  };

  const handleVoiceChannelClick = (channel: typeof channels[0]) => {
    navigateToChannel(channel);
  };

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    channel: typeof channels[0];
  } | null>(null);

  // Channel Settings Dialog state
  const [settingsChannelId, setSettingsChannelId] = useState<string | null>(null);

  // Drag and Drop state
  const [draggedChannel, setDraggedChannel] = useState<typeof channels[0] | null>(null);
  const [dragOverTarget, setDragOverTarget] = useState<string | null>(null);
  const [dropIndicator, setDropIndicator] = useState<{ targetId: string; position: "before" | "after" } | null>(null);
  const dragCounterRef = useRef(0);

  const handleContextMenu = (e: React.MouseEvent, channel: typeof channels[0]) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, channel });
  };

  const closeContextMenu = () => setContextMenu(null);

  // DM row context menu (separate from server channels — different item set).
  const [dmContextMenu, setDmContextMenu] = useState<{ x: number; y: number; channel: DMChannel } | null>(null);
  const messageRequests = useMessageRequests();
  const closeDmContextMenu = () => setDmContextMenu(null);

  // Close context menu when clicking outside or pressing Escape
  useEffect(() => {
    if (!contextMenu && !dmContextMenu) return;
    const handleClick = () => { closeContextMenu(); closeDmContextMenu(); };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        closeContextMenu();
        closeDmContextMenu();
      }
    };
    window.addEventListener('click', handleClick);
    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => {
      window.removeEventListener('click', handleClick);
      window.removeEventListener("keydown", handleKeyDown, { capture: true } as EventListenerOptions);
    };
  }, [contextMenu, dmContextMenu]);

  const handleEditChannel = () => {
    if (contextMenu?.channel) {
      setSettingsChannelId(contextMenu.channel.id);
      closeContextMenu();
    }
  };

  // Drag and Drop handlers
  const handleDragStart = (e: React.DragEvent, channel: typeof channels[0]) => {
    if (!canManageChannels) return;
    setDraggedChannel(channel);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", channel.id);
    // Make the drag image semi-transparent
    if (e.currentTarget instanceof HTMLElement) {
      e.currentTarget.style.opacity = "0.4";
      e.currentTarget.style.transition = "opacity 150ms ease";
    }
  };

  const handleDragEnd = (e: React.DragEvent) => {
    if (e.currentTarget instanceof HTMLElement) {
      e.currentTarget.style.opacity = "1";
    }
    setDraggedChannel(null);
    setDragOverTarget(null);
    setDropIndicator(null);
    dragCounterRef.current = 0;
  };

  const handleDragEnter = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    dragCounterRef.current++;
    setDragOverTarget(targetId);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setDragOverTarget(null);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  // Drop targets compute positions from the real position order, not the
  // display order (mentionFirst lifts channels with unread mentions, and that
  // temporary order must not be persisted).
  const siblingsByPosition = (parentId: string | null) => {
    const categoryIds = new Set(normalChannels.filter(c => c.type === "category").map(c => c.id));
    return normalChannels
      .filter(c => c.type !== "category" && (parentId
        ? String(c.parentId ?? "") === parentId
        : (!c.parentId || !categoryIds.has(c.parentId))))
      .sort((a, b) => a.position - b.position);
  };

  const handleDropOnCategory = async (e: React.DragEvent, categoryId: string | null) => {
    e.preventDefault();
    setDragOverTarget(null);
    setDropIndicator(null);
    dragCounterRef.current = 0;
    if (!draggedChannel || !currentServer) return;
    if (draggedChannel.type === "category") return;

    const targetChildren = categoryId
      ? siblingsByPosition(categoryId).filter(c => c.id !== draggedChannel.id)
      : siblingsByPosition(null).filter(c => c.id !== draggedChannel.id);

    const updates: Array<{ id: string; position: number; parentId?: string | null }> = [
      { id: draggedChannel.id, position: targetChildren.length, parentId: categoryId },
    ];
    targetChildren.forEach((ch, i) => {
      updates.push({ id: ch.id, position: i, parentId: categoryId });
    });

    try {
      await reorderChannels(currentServer.id, updates);
      toast.success(gt("Moved #{name}", { name: draggedChannel.name }));
    } catch (err) {
      toast.error(gt("Failed to move channel"));
    }
    setDraggedChannel(null);
  };

  const handleDragOverChannel = (e: React.DragEvent, targetChannel: typeof channels[0]) => {
    if (!draggedChannel || !canManageChannels) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const isBefore = e.clientY < rect.top + rect.height / 2;
    
    let targetId = targetChannel.id;
    if (draggedChannel.type === "category" && targetChannel.type !== "category" && targetChannel.parentId) {
      const parentCat = categories.find(c => c.id === targetChannel.parentId);
      if (parentCat) {
        targetId = parentCat.id;
      }
    }
    
    setDropIndicator({ targetId, position: isBefore ? "before" : "after" });
    setDragOverTarget(null);
  };

  const handleDropOnChannel = async (e: React.DragEvent, targetChannel: typeof channels[0]) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverTarget(null);
    setDropIndicator(null);
    dragCounterRef.current = 0;
    if (!draggedChannel || !currentServer) return;
    if (draggedChannel.id === targetChannel.id) return;

    // Handle normal channel dropped on a category header
    if (draggedChannel.type !== "category" && targetChannel.type === "category") {
      return handleDropOnCategory(e, targetChannel.id);
    }

    let target = targetChannel;
    if (draggedChannel.type === "category" && target.type !== "category" && target.parentId) {
      const parentCat = categories.find(c => c.id === target.parentId);
      if (parentCat) {
        target = parentCat;
      }
    }

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const isBefore = e.clientY < rect.top + rect.height / 2;
    const targetParent = target.type === "category" ? null : (target.parentId || null);
    if (draggedChannel.type === "category" && targetParent !== null) return;

    let siblings: typeof channels;
    if (targetParent) {
      siblings = siblingsByPosition(targetParent).filter(c => c.id !== draggedChannel.id);
    } else if (target.type === "category") {
      siblings = categories.filter(c => c.id !== draggedChannel.id);
    } else {
      siblings = siblingsByPosition(null).filter(c => c.id !== draggedChannel.id);
    }

    const targetIdx = siblings.findIndex(c => c.id === target.id);
    if (targetIdx === -1) {
      siblings.push(draggedChannel);
    } else {
      const insertIdx = isBefore ? targetIdx : targetIdx + 1;
      siblings.splice(insertIdx, 0, draggedChannel);
    }

    const updates: Array<{ id: string; position: number; parentId?: string | null }> = siblings.map((ch, i) => ({
      id: ch.id,
      position: i,
      parentId: draggedChannel.type === "category" ? null : (ch.parentId || null),
    }));

    if (draggedChannel.type !== "category") {
      const draggedUpdate = updates.find(u => u.id === draggedChannel.id);
      if (draggedUpdate) draggedUpdate.parentId = targetParent;
    }

    try {
      await reorderChannels(currentServer.id, updates);
      toast.success(gt("Moved {name}", { name: `${draggedChannel.type === "category" ? "" : "#"}${draggedChannel.name}` }));
    } catch (err) {
      toast.error(gt("Failed to move channel"));
    }
    setDraggedChannel(null);
  };

  const handleDropOnBottom = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOverTarget(null);
    setDropIndicator(null);
    dragCounterRef.current = 0;
    if (!draggedChannel || !currentServer) return;

    if (draggedChannel.type === "category") {
      const siblings = categories.filter(c => c.id !== draggedChannel.id);
      siblings.push(draggedChannel);

      const updates = siblings.map((ch, i) => ({
        id: ch.id,
        position: i,
        parentId: null,
      }));

      try {
        await reorderChannels(currentServer.id, updates);
        toast.success(gt("Moved category {name} to bottom", { name: draggedChannel.name }));
      } catch (err) {
        toast.error(gt("Failed to move category"));
      }
    } else {
      const targetCategory = categories.length > 0 ? categories[categories.length - 1] : null;
      const targetParentId = targetCategory ? targetCategory.id : null;

      const siblings = targetParentId
        ? siblingsByPosition(targetParentId).filter(c => c.id !== draggedChannel.id)
        : siblingsByPosition(null).filter(c => c.id !== draggedChannel.id);
      
      siblings.push(draggedChannel);

      const updates = siblings.map((ch, i) => ({
        id: ch.id,
        position: i,
        parentId: targetParentId,
      }));

      const draggedUpdate = updates.find(u => u.id === draggedChannel.id);
      if (draggedUpdate) draggedUpdate.parentId = targetParentId;

      try {
        await reorderChannels(currentServer.id, updates);
        toast.success(gt("Moved #{name} to bottom", { name: draggedChannel.name }));
      } catch (err) {
        toast.error(gt("Failed to move channel"));
      }
    }
    setDraggedChannel(null);
  };

  const handleDeleteChannel = async () => {
    const confirmText = contextMenu?.channel?.type === "category"
      ? gt("Delete the category {category}? Its channels stay and move out of the category.", { category: contextMenu.channel.name })
      : gt("Are you sure you want to delete #{channel}?", { channel: contextMenu?.channel?.name ?? "" });
    if (contextMenu?.channel && (await confirmDialog({ title: confirmText, confirmLabel: gt("Delete") }))) {
      try {
        await deleteChannel(contextMenu.channel.id);
        closeContextMenu();
        toast.success(gt("Channel deleted"));
      } catch (error) {
        console.error("Failed to delete channel:", error);
        toast.error(gt("Failed to delete channel"));
      }
    }
  };

  const handleCopyChannelId = () => {
    if (contextMenu?.channel) {
      navigator.clipboard.writeText(contextMenu.channel.id);
      closeContextMenu();
      toast.success(gt("Channel ID copied"));
    }
  };

  const handleCopyChannelLink = () => {
    if (contextMenu?.channel && currentServer) {
      const link = `${window.location.origin}/channels/${currentServer.id}/${contextMenu.channel.id}`;
      navigator.clipboard.writeText(link);
      closeContextMenu();
      toast.success(gt("Channel link copied"));
    }
  };

  const getChannelIcon = (type: string, isLocked?: boolean, isNsfw?: boolean) => {
    const baseIcon = (() => {
      if (isLocked) {
        return <Lock className="w-5 h-5 text-[var(--text-muted)]" />;
      }
      switch (type) {
        case "voice":
          return <Volume2 className="w-5 h-5 text-[var(--text-muted)]" />;
        case "announcement":
          return <Megaphone className="w-5 h-5 text-[var(--text-muted)]" />;
        case "forum":
          return <MessagesSquare className="w-5 h-5 text-[var(--text-muted)]" />;
        case "category":
          return <Folder className="w-5 h-5 text-[var(--text-muted)]" />;
        default:
          return <Hash className="w-5 h-5 text-[var(--text-muted)]" />;
      }
    })();

    if (isNsfw) {
      return (
        <span className="relative flex-shrink-0 w-5 h-5">
          {baseIcon}
          <AlertTriangle className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 text-red-400" />
        </span>
      );
    }

    return <span className="flex-shrink-0">{baseIcon}</span>;
  };

  // iOS detection (or ?platform=ios query param for testing).
  // Must stay above any early return so hook order is stable (React #310).
  const isClient = useIsClient();
  const isIOS = useMemo(() => {
    if (!isClient) return false; // same as the server render until hydrated
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get("platform") === "ios") return true;
    const ua = navigator.userAgent;
    return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  }, [isClient]);

  // Group channels by type & category
  const voiceChannels = useMemo(() => channels.filter(c => c.type === "voice"), [channels]);

  // Channels you've been mentioned in float to the top of their group.
  const mentionFirst = useCallback(
    (a: typeof channels[0], b: typeof channels[0]) => {
      const am = getMentionCount(a.id) > 0 ? 0 : 1;
      const bm = getMentionCount(b.id) > 0 ? 0 : 1;
      if (am !== bm) return am - bm;
      return a.position - b.position;
    },
    [getMentionCount]
  );

  const normalChannels = useMemo(() => {
    return channels.filter(c => c.type !== "public_thread" && c.type !== "private_thread");
  }, [channels]);

  const threadsByParent = useMemo(() => {
    const map = new Map<string, typeof channels>();
    for (const channel of channels) {
      if (channel.type === "public_thread" || channel.type === "private_thread") {
        if (channel.parentId) {
          const pId = channel.parentId.toString();
          if (!map.has(pId)) {
            map.set(pId, []);
          }
          map.get(pId)?.push(channel);
        }
      }
    }
    return map;
  }, [channels]);

  const uncategorizedChannels = useMemo(() => {
    // A channel whose category is gone counts as uncategorized instead of vanishing.
    const categoryIds = new Set(normalChannels.filter(c => c.type === "category").map(c => c.id));
    return normalChannels
      .filter(c => c.type !== "category" && (!c.parentId || !categoryIds.has(c.parentId)))
      .sort(mentionFirst);
  }, [normalChannels, mentionFirst]);

  const categories = useMemo(() => {
    return normalChannels.filter(c => c.type === "category").sort((a, b) => a.position - b.position);
  }, [normalChannels]);

  const channelsByCategory = useMemo(() => {
    const map = new Map<string, typeof channels>();
    for (const channel of normalChannels) {
      if (channel.type === "category") continue;
      if (channel.parentId) {
        const pId = channel.parentId.toString();
        if (!map.has(pId)) {
          map.set(pId, []);
        }
        map.get(pId)?.push(channel);
      }
    }
    // Sort channels inside each category by position, mention channels first.
    for (const key of map.keys()) {
      map.get(key)?.sort(mentionFirst);
    }
    return map;
  }, [normalChannels, mentionFirst]);

  // Tell the unread engine which channel is on screen (no glow / toasts for it).
  // Reading is acked by the message list once the newest message is seen.
  // Views without a message list (voice, stage, forum index) can't ack, so
  // opening them reads them, as before.
  const activeChannelId = currentChannel?.id ?? null;
  const activeChannelType = currentChannel?.type;
  useEffect(() => {
    setActiveChannel(activeChannelId);
    if (activeChannelId && activeChannelType && !MESSAGE_LIST_TYPES.has(activeChannelType)) {
      markChannelRead(activeChannelId);
    }
  }, [activeChannelId, activeChannelType, setActiveChannel, markChannelRead]);

  // Feed the unread engine the channel list (channel→server map + last-activity
  // seed) so it can compute glow/badges and per-server aggregation.
  useEffect(() => {
    if (channels.length === 0) return;
    registerChannels(
      channels.map((c) => ({
        id: c.id,
        serverId: c.serverId,
        type: c.type,
        name: c.name,
        parentId: c.parentId ?? null,
        lastMessageAt: c.lastMessageAt ?? null,
      }))
    );
  }, [channels, registerChannels]);

  // Preload: when a server's channels load, warm the message cache so opening a
  // channel is instant. Priority: unread channels first, then the most
  // recently-active ones (by lastMessageAt). The channel the user is viewing is
  // already being fetched by the mounted chat, so we skip it. Bounded count +
  // concurrency keep this light (server-side decrypt is cached after first warm).
  useEffect(() => {
    if (channels.length === 0) return;
    let cancelled = false;

    const textChannels = channels.filter(
      (c) => (c.type === "text" || c.type === "announcement") && c.id !== currentChannel?.id
    );
    const unread = textChannels.filter((c) => isChannelUnread(c.id));
    const byRecency = [...textChannels].sort((a, b) => {
      const at = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
      const bt = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
      return bt - at;
    });
    // Unread first, then recent, de-duped, capped.
    const seen = new Set<string>();
    const queue: string[] = [];
    for (const c of [...unread, ...byRecency]) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      queue.push(c.id);
      if (queue.length >= 12) break;
    }

    // Warm the routes as well as the messages: router.push doesn't prefetch,
    // so the RSC payload for each channel page would otherwise be fetched at
    // click time. Next dedupes repeat prefetches, so this is cheap.
    if (currentServer) {
      for (const id of queue) {
        router.prefetch(`/channels/${currentServer.id}/${id}`);
      }
    }

    // Concurrency-limited worker pool (3 at a time).
    let cursor = 0;
    const runWorker = async () => {
      while (!cancelled && cursor < queue.length) {
        const id = queue[cursor++];
        await prefetchChannelMessages(`/api/channels/${id}`);
      }
    };
    void Promise.all([runWorker(), runWorker(), runWorker()]);

    return () => {
      cancelled = true;
    };
    // Keyed on the server/channel set so it runs once per server open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentServer?.id, channels.length]);

  // State for collapsed categories
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());

  // Reset collapsed categories on server switch
  useEffect(() => {
    setCollapsedCategories(new Set());
  }, [currentServer?.id]);
  const [dmChannels, setDmChannels] = useState<DMChannel[]>([]);
  // Until the first /api/dms answer, show placeholders rather than "No direct
  // messages yet" (which flashed on every load for people with DMs).
  const [dmsLoaded, setDmsLoaded] = useState(false);
  // Closed DMs (the X on a DM row): channel id → last message id when it was closed.
  // A DM comes back as soon as a newer message arrives, like on Discord. Kept per device.
  const [closedDms, setClosedDms] = useState<Record<string, string>>({});
  useEffect(() => {
    try {
      setClosedDms(JSON.parse(localStorage.getItem(CLOSED_DMS_KEY) || "{}"));
    } catch { /* storage unavailable: nothing closed */ }
  }, []);
  const closeDm = (channel: DMChannel) => {
    setClosedDms((prev) => {
      const next = { ...prev, [channel.id]: channel.lastMessageId ?? "" };
      try { localStorage.setItem(CLOSED_DMS_KEY, JSON.stringify(next)); } catch { /* best effort */ }
      return next;
    });
    if (isDmChannelOpen(channel, pathname)) router.push("/channels/me");
  };
  const [showGroupPicker, setShowGroupPicker] = useState(false);
  const [externalVoiceParticipants, setExternalVoiceParticipants] = useState<Map<string, VoiceParticipant[]>>(new Map());
  const [voiceDropTarget, setVoiceDropTarget] = useState<string | null>(null);
  const canMoveMembers = can("MOVE_MEMBERS");
  const pathname = usePathname();
  // Hide closed DMs until a newer message arrives; the open conversation always shows.
  const visibleDmChannels = useMemo(
    () => dmChannels.filter((channel) => {
      const closedAt = closedDms[channel.id];
      if (closedAt === undefined) return true;
      if (isDmChannelOpen(channel, pathname)) return true;
      return (channel.lastMessageId ?? "") !== closedAt;
    }),
    [dmChannels, closedDms, pathname],
  );
  // Opening a closed DM (from Friends, a profile, "Send Message"...) reopens
  // it for good, so it doesn't vanish again when the user navigates away.
  const reopenedDmId = useMemo(() => {
    if (!pathname?.startsWith("/dm/")) return null;
    const channel = dmChannels.find((ch) => isDmChannelOpen(ch, pathname));
    return channel && closedDms[channel.id] !== undefined ? channel.id : null;
  }, [dmChannels, closedDms, pathname]);
  useEffect(() => {
    if (!reopenedDmId) return;
    setClosedDms((prev) => {
      if (prev[reopenedDmId] === undefined) return prev;
      const next = { ...prev };
      delete next[reopenedDmId];
      try { localStorage.setItem(CLOSED_DMS_KEY, JSON.stringify(next)); } catch { /* best effort */ }
      return next;
    });
  }, [reopenedDmId]);

  const renderChannelItem = (channel: typeof channels[0]) => {
    const showDropBefore = dropIndicator?.targetId === channel.id && dropIndicator.position === "before";
    const showDropAfter = dropIndicator?.targetId === channel.id && dropIndicator.position === "after";
    if (channel.type === "voice") {
      const isActive = voiceService.currentRoomId === `channel-${channel.id}`;
      const channelParticipants = isActive ? voiceParticipants : (externalVoiceParticipants.get(channel.id) || []);
      return (
        <div
          key={channel.id}
          className={cn(
            "mb-0.5 relative",
            canManageChannels && "cursor-grab active:cursor-grabbing"
          )}
          draggable={canManageChannels}
          onDragStart={(e) => handleDragStart(e, channel)}
          onDragEnd={handleDragEnd}
          onDragOver={(e) => {
            // Someone being dragged out of a voice channel (Move Members).
            if (isVoiceMemberDrag(e)) {
              if (!canMoveMembers) return;
              e.preventDefault();
              e.stopPropagation();
              e.dataTransfer.dropEffect = "move";
              if (voiceDropTarget !== channel.id) setVoiceDropTarget(channel.id);
              return;
            }
            handleDragOverChannel(e, channel);
          }}
          onDragLeave={(e) => {
            if (voiceDropTarget === channel.id && !e.currentTarget.contains(e.relatedTarget as Node | null)) setVoiceDropTarget(null);
          }}
          onDrop={(e) => {
            if (isVoiceMemberDrag(e)) {
              e.preventDefault();
              e.stopPropagation();
              setVoiceDropTarget(null);
              const drag = readVoiceMemberDrag(e);
              if (!drag || !currentServer || drag.fromChannelId === channel.id) return;
              void moderateVoiceMember(currentServer.id, drag.userId, { channelId: channel.id }).then((r) => {
                if (!r.ok) toast.error(r.error || gt("Something went wrong. Please try again."));
              });
              return;
            }
            void handleDropOnChannel(e, channel);
          }}
        >
          {showDropBefore && <div className="absolute -top-px left-2 right-2 h-0.5 bg-[var(--app-accent)] rounded-full z-20" />}
          {showDropAfter && <div className="absolute -bottom-px left-2 right-2 h-0.5 bg-[var(--app-accent)] rounded-full z-20" />}
          {voiceDropTarget === channel.id && (
            <div className="pointer-events-none absolute inset-x-2 inset-y-0 rounded ring-2 ring-[var(--app-accent)] z-20" />
          )}
          <button
            onClick={() => handleVoiceChannelClick(channel)}
            onContextMenu={(e) => handleContextMenu(e, channel)}
            className={cn(
              "w-full px-2 py-1 mx-2 rounded flex items-center gap-1.5 transition-all group min-w-0 overflow-hidden",
              isActive
                ? "text-green-400 hover:bg-[var(--bg-sidebar-elevated)]"
                : "text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-sidebar-elevated)]",
              currentChannel?.id === channel.id && "bg-[var(--bg-active)]"
            )}
            style={{ width: "calc(100% - 16px)" }}
          >
            {channel.isNsfw ? (
              <span className="relative flex-shrink-0 w-4 h-4">
                <Volume2 className={cn(
                  "w-4 h-4",
                  isActive ? "text-green-400" : "text-[var(--text-muted)]"
                )} />
                <AlertTriangle className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 text-red-400" />
              </span>
            ) : (
              <Volume2 className={cn(
                "w-4 h-4 flex-shrink-0",
                isActive ? "text-green-400" : "text-[var(--text-muted)]"
              )} />
            )}
            <span className="truncate text-sm flex-1 text-left min-w-0" title={channel.name}>{channel.name}</span>
            {channelParticipants.length > 0 && (
              <span className="flex items-center gap-1 shrink-0">
                <span className={cn("inline-block w-1.5 h-1.5 rounded-full", isActive ? "bg-green-500 animate-pulse" : "bg-green-500/60")} />
                <span className={cn("text-[10px]", isActive ? "text-green-400" : "text-green-400/70")}>{channelParticipants.length}</span>
              </span>
            )}
            {canManageChannels && (
              <Settings
                onClick={(e) => {
                  e.stopPropagation();
                  setSettingsChannelId(channel.id);
                }}
                className="w-4 h-4 shrink-0 text-[var(--text-muted)] hover:text-[var(--text-primary)] opacity-0 group-hover:opacity-100 transition-opacity"
              />
            )}
          </button>
          {/* Participants — Discord style (right-click: volume / moderation; drag to move) */}
          {currentServer && (
            <VoiceChannelMembers
              participants={channelParticipants}
              active={isActive}
              serverId={currentServer.id}
              channelId={channel.id}
              canMove={canMoveMembers}
            />
          )}
        </div>
      );
    }

    const isActive = currentChannel?.id === channel.id;
    // The open channel is being read: no badge on it (like DMs).
    const mentionCount = isActive ? 0 : getMentionCount(channel.id);
    const unread = !isActive && isChannelUnread(channel.id);
    return (
      <div
        key={channel.id}
        draggable={canManageChannels}
        onDragStart={(e) => handleDragStart(e, channel)}
        onDragEnd={handleDragEnd}
        onDragOver={(e) => handleDragOverChannel(e, channel)}
        onDrop={(e) => handleDropOnChannel(e, channel)}
        className={cn(
          "relative",
          canManageChannels && "cursor-grab active:cursor-grabbing"
        )}
      >
        {showDropBefore && <div className="absolute -top-px left-2 right-2 h-0.5 bg-[var(--app-accent)] rounded-full z-20" />}
        {showDropAfter && <div className="absolute -bottom-px left-2 right-2 h-0.5 bg-[var(--app-accent)] rounded-full z-20" />}
        {/* Unread pill: a small white bar on the far left, Discord-style. */}
        {unread && (
          <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-2 rounded-r-full bg-[var(--text-primary)] z-20" />
        )}
        <button
          onClick={() => { navigateToChannel(channel); setActiveChannel(channel.id); }}
          onMouseEnter={() => {
            void prefetchChannelMessages(`/api/channels/${channel.id}`);
            // Warm the route too: programmatic router.push does NOT prefetch,
            // so without this every click pays an RSC round-trip before the
            // page can mount. Hover-prefetching makes the push commit instantly.
            if (currentServer) router.prefetch(`/channels/${currentServer.id}/${channel.id}`);
          }}
          onContextMenu={(e) => handleContextMenu(e, channel)}
          className={cn(
            "w-full px-2 py-1.5 mx-2 rounded press-feedback flex items-center gap-1.5 text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-sidebar-elevated)] transition-all group min-w-0 overflow-hidden",
            isActive && "bg-[var(--bg-active)] text-[var(--app-accent)]",
            !isActive && unread && "text-[var(--text-primary)] font-semibold",
            !isActive && isChannelMuted(channel.id) && "opacity-50"
          )}
          style={{ width: "calc(100% - 16px)" }}
        >
          {getChannelIcon(channel.type, undefined, channel.isNsfw)}
          <span className="truncate text-sm flex-1 text-left min-w-0" title={channel.name}>{channel.name}</span>
          {mentionCount > 0 && !isActive && (
            <span className="shrink-0 min-w-[16px] h-[16px] px-1 flex items-center justify-center rounded-full bg-[#c4306b] text-[10px] font-bold text-white leading-none">
              {mentionCount > 99 ? "99+" : mentionCount}
            </span>
          )}
          {canManageChannels && (
            <Settings
              onClick={(e) => {
                e.stopPropagation();
                setSettingsChannelId(channel.id);
              }}
              className="w-4 h-4 shrink-0 text-[var(--text-muted)] hover:text-[var(--text-primary)] opacity-0 group-hover:opacity-100 transition-opacity"
            />
          )}
        </button>
      </div>
    );
  };

  const renderThreadItem = (thread: typeof channels[0], isLast: boolean) => {
    const isActive = currentChannel?.id === thread.id;
    const unread = !isActive && isChannelUnread(thread.id);
    const mentionCount = isActive ? 0 : getMentionCount(thread.id);

    return (
      <div key={thread.id} className="relative flex items-center pl-6 pr-2 mb-0.5 group">
        <div 
          className="absolute left-[25px] top-0 w-px bg-[var(--border-subtle)]" 
          style={{ height: isLast ? "14px" : "100%" }}
        />
        <div 
          className="absolute left-[25px] top-[14px] w-3 h-px bg-[var(--border-subtle)]"
        />

        {unread && (
          <div className="absolute left-[33px] top-1/2 -translate-y-1/2 w-1 h-2 rounded-r-full bg-[var(--text-primary)] z-20" />
        )}

        <button
          onClick={() => { navigateToChannel(thread); setActiveChannel(thread.id); }}
          onMouseEnter={() => {
            void prefetchChannelMessages(`/api/channels/${thread.id}`);
            if (currentServer) router.prefetch(`/channels/${currentServer.id}/${thread.id}`);
          }}
          onContextMenu={(e) => handleContextMenu(e, thread)}
          className={cn(
            "w-full pl-7 pr-2 py-1 rounded press-feedback flex items-center gap-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-sidebar-elevated)] transition-all min-w-0 overflow-hidden",
            isActive && "bg-[var(--bg-active)] text-[var(--app-accent)] font-medium",
            !isActive && unread && "text-[var(--text-primary)] font-semibold",
            !isActive && isChannelMuted(thread.id) && "opacity-50"
          )}
        >
          <span
            className="px-1 py-0.5 rounded bg-[var(--app-surface-alt)] text-[var(--text-muted)] select-none shrink-0"
            title={gt("Thread")}
            aria-label={gt("Thread")}
          >
            <MessagesSquare className="w-2.5 h-2.5" />
          </span>
          <span className="truncate flex-1 text-left min-w-0" title={thread.name}>
            {thread.name}
          </span>
          {mentionCount > 0 && !isActive && (
            <span className="shrink-0 min-w-[14px] h-[14px] px-1 flex items-center justify-center rounded-full bg-[#c4306b] text-[9px] font-bold text-white leading-none">
              {mentionCount > 99 ? "99+" : mentionCount}
            </span>
          )}
          {canManageChannels && (
            <Settings
              onClick={(e) => {
                e.stopPropagation();
                setSettingsChannelId(thread.id);
              }}
              className="w-3 h-3 shrink-0 text-[var(--text-muted)] hover:text-[var(--text-primary)] opacity-0 group-hover:opacity-100 transition-opacity"
            />
          )}
        </button>
      </div>
    );
  };

  const renderChannelWithThreads = (channel: typeof channels[0]) => {
    const parentHtml = renderChannelItem(channel);
    const childThreads = threadsByParent.get(channel.id) || [];
    
    if (childThreads.length === 0) {
      return parentHtml;
    }
    
    return (
      <div key={channel.id} className="flex flex-col">
        {parentHtml}
        <div className="flex flex-col mt-0.5">
          {childThreads.map((thread, index) => {
            const isLast = index === childThreads.length - 1;
            return renderThreadItem(thread, isLast);
          })}
        </div>
      </div>
    );
  };

  // NOTE: The active channel is derived solely in the channel page
  // (`[serverId]/[channelId]/page.tsx`), which is serverId-aware and avoids the
  // stale-channel race. The sidebar no longer sets `currentChannel` itself.

  const toggleCategory = (categoryId: string) => {
    setCollapsedCategories(prev => {
      const newSet = new Set(prev);
      if (newSet.has(categoryId)) {
        newSet.delete(categoryId);
      } else {
        newSet.add(categoryId);
      }
      return newSet;
    });
  };

  // Poll voice channel participants for channels we're not connected to
  // (visibility-aware: pauses in background tabs, refreshes on focus)
  const fetchVoiceStates = useCallback(async () => {
    if (!currentServer) return;
    const roomIds = voiceChannels
      .map((ch) => `channel-${ch.id}`)
      .filter((roomId) => voiceService.currentRoomId !== roomId); // skip active channel
    const results = new Map<string, VoiceParticipant[]>();
    if (roomIds.length > 0) {
      try {
        const res = await fetch(`/api/voice/states?rooms=${encodeURIComponent(roomIds.join(","))}`);
        if (res.ok) {
          const data = (await res.json()) as { states?: Record<string, VoiceParticipant[]> };
          for (const [roomId, participants] of Object.entries(data.states ?? {})) {
            if (participants?.length > 0) results.set(roomId.replace(/^channel-/, ""), participants);
          }
        }
      } catch {
        // best-effort
      }
    }
    setExternalVoiceParticipants(results);
  }, [currentServer, voiceChannels]);
  usePolling(() => void fetchVoiceStates(), 5000, !!currentServer, currentServer?.id);
  // A moderator action (server mute, move, disconnect) shows up right away.
  useEffect(() => {
    const refresh = () => void fetchVoiceStates();
    window.addEventListener(VOICE_STATES_REFRESH_EVENT, refresh);
    return () => window.removeEventListener(VOICE_STATES_REFRESH_EVENT, refresh);
  }, [fetchVoiceStates]);

  // Fetch DM channels when no server is selected
  const fetchDMChannels = useCallback(async () => {
    const issuedAt = Date.now();
    try {
      const response = await sharedGet("/api/dms");
      if (response.ok) {
        const data = await response.json();
        const channels = (data.channels || []) as DMChannel[];
        channels.sort((a, b) => {
          const aTime = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
          const bTime = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
          return bTime - aTime;
        });
        setDmChannels(channels);
        if (typeof data.messageRequestCount === "number") seedMessageRequestCount(data.messageRequestCount);
        // Seed the server's per-DM unread counts into the unread engine (it
        // reconciles them with anything that arrived since `issuedAt`).
        seedDmChannels(channels, issuedAt);
      }
    } catch (error) {
      console.error("Failed to fetch DM channels:", error);
    } finally {
      setDmsLoaded(true);
    }
  }, [seedDmChannels]);

  useEffect(() => {
    if (!currentServer) {
      const timeoutId = window.setTimeout(() => {
        void fetchDMChannels();
      }, 0);
      return () => window.clearTimeout(timeoutId);
    }
  }, [currentServer, fetchDMChannels]);

  // Keep the DM list live while it's shown (no server selected): re-fetch on tab
  // focus/visibility as a resilient fallback for the SSE stream below.
  usePolling(fetchDMChannels, 20000, !currentServer);

  // Feed DM channels into the unread engine so DM rows get the same
  // read/unread treatment as server channels (bold + pill). The newest
  // message's own time and author are the signal (`updatedAt` also moves for
  // your own sends and renames; your own newest message means "read").
  useEffect(() => {
    if (dmChannels.length === 0) return;
    registerChannels(
      dmChannels.map((c) => {
        const r = c.recipients[0];
        return {
          id: c.id,
          type: "dm",
          lastMessageAt: c.lastMessage?.createdAt ?? null,
          lastMessageId: c.lastMessage?.id ?? null,
          lastMessageAuthorId: c.lastMessage?.authorId ?? null,
          name: dmRowTitle(c) || undefined,
          href: dmChannelHref(c) ?? undefined,
          avatar: c.type === "group_dm" ? c.icon ?? r?.avatar ?? null : r?.avatar ?? null,
        };
      })
    );
  }, [dmChannels, registerChannels]);

  // Real-time DM list updates: when a new DM/message arrives the server pushes a
  // `dm:list:update` over this stream, so a new conversation or reordered
  // conversation shows up instantly without waiting for the poll. Mirrors the
  // mobile MessagesView subscription. Only connected while the DM list is shown.
  useEffect(() => {
    if (currentServer) return;
    let source: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;
    let closed = false;

    const connect = () => {
      if (closed) return;
      source = new EventSource("/api/dms/stream");
      source.onopen = () => {
        attempts = 0;
      };
      source.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          // A group was created / renamed / changed members: upsert its row.
          if (data.type === "group:update" && data.group) {
            const g = data.group as GroupInfo;
            const me = (user?.id ?? "").toLowerCase();
            setDmChannels((prev) => {
              const idx = prev.findIndex((c) => c.id === g.id);
              const row: DMChannel = {
                ...(idx === -1 ? { updatedAt: new Date().toISOString() } : prev[idx]),
                id: g.id,
                type: "group_dm",
                name: g.name,
                icon: g.icon,
                ownerId: g.ownerId,
                recipients: g.members
                  .filter((m) => m.id.toLowerCase() !== me)
                  .map((m) => ({
                    id: m.id,
                    username: m.username,
                    displayName: m.displayName || m.username,
                    avatar: m.avatar ?? undefined,
                    status: m.status || "offline",
                  })),
              };
              if (idx === -1) return [row, ...prev];
              const next = prev.slice();
              next[idx] = row;
              return next;
            });
            return;
          }
          // We left / were removed from a group.
          if (data.type === "group:remove") {
            const channelId = String(data.channelId ?? "");
            setDmChannels((prev) => prev.filter((c) => c.id !== channelId));
            return;
          }
          if (data.type === "dm:list:update") {
            // Apply in place: bump the conversation to the top instantly. A
            // full /api/dms refetch (recipients + decrypt) is only needed when
            // the channel is one we've never seen (a brand-new conversation).
            const channelId = String(data.channelId ?? "");
            const createdAt = data.message?.createdAt;
            // Live unread badge: messages from others count; your own (sent
            // from another device) read the conversation.
            if (channelId && data.message?.authorId) {
              notifyDmActivity(
                channelId,
                typeof createdAt === "string" ? createdAt : undefined,
                typeof data.message?.id === "string" ? data.message.id : undefined,
                String(data.message.authorId),
              );
            }
            setDmChannels((prev) => {
              const idx = prev.findIndex((c) => c.id === channelId);
              if (idx === -1) {
                void fetchDMChannels();
                return prev;
              }
              const updated: DMChannel = {
                ...prev[idx],
                lastMessageId: data.message?.id ?? prev[idx].lastMessageId,
                lastMessage: data.message?.id
                  ? { id: data.message.id, authorId: data.message.authorId, createdAt: typeof createdAt === "string" ? createdAt : undefined }
                  : prev[idx].lastMessage,
                updatedAt: typeof createdAt === "string" ? createdAt : new Date().toISOString(),
              };
              return [updated, ...prev.slice(0, idx), ...prev.slice(idx + 1)];
            });
          }
        } catch {
          /* ignore malformed events */
        }
      };
      source.onerror = () => {
        source?.close();
        if (closed) return;
        const backoff = Math.min(1000 * 2 ** attempts, 30000);
        attempts += 1;
        reconnectTimer = setTimeout(connect, backoff);
      };
    };
    connect();

    return () => {
      closed = true;
      source?.close();
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
  }, [currentServer, fetchDMChannels, notifyDmActivity, user?.id]);

  const statusColors: Record<string, string> = {
    online: "#23A559",
    idle: "#F0B232",
    dnd: "#EF4444",
    offline: "#555555",
  };

  // While navigating DM→server the ServerContext hasn't loaded `currentServer`
  // yet. Without this guard the DM list flashes for a frame. If the URL points
  // at a real server, show a channel-sidebar skeleton instead of that flash.
  if (!currentServer) {
    const serverMatch = pathname?.match(/^\/channels\/([^/]+)/);
    const specialRoutes = ["explore", "settings", "me", "notifications", "profile", "messages"];
    const expectingServer = Boolean(serverMatch && !specialRoutes.includes(serverMatch[1]));
    if (expectingServer) {
      return <ChannelSidebarSkeleton />;
    }
  }

  if (!currentServer) {
    return (
      <div className="flex flex-col w-64 min-w-0 h-full bg-[var(--bg-sidebar)] border-r border-[var(--border-subtle)] overflow-hidden">
        {/* DM Header */}
        <div className="h-12 px-3 flex items-center border-b border-[var(--border-subtle)] shrink-0">
          <button
            type="button"
            onClick={() => emitHotkey("goto-dm")}
            className="w-full h-7 px-2.5 rounded-md bg-[var(--bg-sidebar-elevated)] text-[var(--text-muted)] text-sm text-left hover:brightness-110 transition-all truncate">
            {gt("Find or start a conversation")}
          </button>
        </div>

        {/* Navigation */}
        <div className="px-2 pt-2 pb-1 shrink-0">
          <Link
            href="/channels/me"
            className={cn(
              "flex items-center gap-2.5 px-2 py-2 rounded-md transition-colors w-full min-w-0",
              pathname === "/channels/me"
                ? "bg-[var(--bg-active)] text-[var(--text-primary)]"
                : "text-[var(--text-secondary)] hover:bg-[var(--bg-sidebar-elevated)] hover:text-[var(--text-primary)]"
            )}
          >
            <Users className="w-5 h-5 shrink-0" />
            <span className="font-medium truncate"><T>Friends</T></span>
          </Link>
          {messageRequests.count > 0 && (
            <Link
              href="/channels/me?tab=requests"
              onClick={() => window.dispatchEvent(new CustomEvent("openFriendsTab", { detail: { tab: "requests" } }))}
              className="mt-0.5 flex items-center gap-2.5 px-2 py-2 rounded-md transition-colors w-full min-w-0 text-[var(--text-secondary)] hover:bg-[var(--bg-sidebar-elevated)] hover:text-[var(--text-primary)]"
            >
              <Inbox className="w-5 h-5 shrink-0" />
              <span className="font-medium truncate flex-1">{gt("Message Requests")}</span>
              <span className="shrink-0 min-w-[18px] h-[18px] px-1.5 flex items-center justify-center rounded-full bg-[var(--app-accent)] text-[11px] font-bold text-[var(--text-on-accent)] leading-none">
                {messageRequests.count > 99 ? "99+" : messageRequests.count}
              </span>
            </Link>
          )}
        </div>

        {/* DM List */}
        <ScrollArea className="flex-1 overflow-hidden">
          <div className="px-2 py-1">
            <div className="px-2 mb-1 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase text-[var(--text-muted)] tracking-wide">
                <T>Direct Messages</T>
              </span>
              <button
                type="button"
                onClick={() => setShowGroupPicker(true)}
                aria-label={gt("Create DM")}
                title={gt("Create DM")}
                className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors shrink-0"
              >
                <PlusCircle className="w-4 h-4" />
              </button>
            </div>

            {visibleDmChannels.length > 0 ? (
              <div className="space-y-0.5">
                {visibleDmChannels.map((channel) => {
                  const isGroup = channel.type === "group_dm";
                  const recipient = channel.recipients[0];
                  const href = dmChannelHref(channel);
                  if (!href || (!recipient && !isGroup)) return null;
                  const isActive = pathname === href;
                  const unread = !isActive && isChannelUnread(channel.id);
                  const dmMentions = isActive ? 0 : getMentionCount(channel.id);

                  return (
                    <Link
                      key={channel.id}
                      href={href}
                      onMouseEnter={() => {
                        const base = dmChannelApiBase(channel);
                        if (base) void prefetchChannelMessages(base);
                      }}
                      onContextMenu={(e) => { e.preventDefault(); setDmContextMenu({ x: e.clientX, y: e.clientY, channel }); }}
                      className={cn(
                        "group relative flex items-center gap-2 px-2 py-[5px] rounded-md press-feedback transition-colors min-w-0",
                        isActive
                          ? "bg-[var(--bg-active)] text-[var(--text-primary)]"
                          : "text-[var(--text-secondary)] hover:bg-[var(--bg-sidebar-elevated)] hover:text-[var(--text-primary)]",
                        !isActive && unread && "text-[var(--text-primary)] font-semibold",
                        !isActive && isChannelMuted(channel.id) && "opacity-50"
                      )}
                    >
                      {/* Unread pill: white bar on the far left, Discord-style. */}
                      {unread && (
                        <span className="absolute -left-2 top-1/2 -translate-y-1/2 w-1 h-2 rounded-r-full bg-[var(--text-primary)]" />
                      )}
                      {isGroup || !recipient ? (
                        <GroupDmIcon icon={channel.icon} members={channel.recipients} size={32} />
                      ) : (
                      <div className="relative shrink-0">
                        <Avatar className="w-8 h-8">
                          <AvatarImage src={cdnImage(recipient.avatar)} />
                          <AvatarFallback className="bg-[var(--app-accent)] text-[var(--text-on-accent)] text-xs">
                            {(recipient.displayName || recipient.username).charAt(0).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div
                          className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-[var(--bg-sidebar)]"
                          style={{ backgroundColor: statusColors[recipient.status] || statusColors.offline }}
                        />
                      </div>
                      )}
                      {isGroup || !recipient ? (
                      <div className="relative flex-1 min-w-0 overflow-hidden flex flex-col leading-tight">
                        <span className={cn("truncate text-sm", unread && "font-semibold")}>{dmRowTitle(channel)}</span>
                        <span className="truncate text-xs text-[var(--text-muted)] font-normal">
                          {gt("{count} Members", { count: channel.recipients.length + 1 })}
                        </span>
                      </div>
                      ) : (
                      <div className="relative flex-1 min-w-0 overflow-hidden flex flex-col leading-tight">
                      <div className="min-w-0 flex items-center gap-1">
                        <span className={cn("truncate text-sm", unread && "font-semibold", getDisplayNameStyleClasses(recipient.customization?.displayNameStyle))} style={getDisplayNameStyleInline(recipient.customization?.displayNameStyle)}>
                          {recipient.displayName || recipient.username}
                        </span>
                        {recipient.isSystem && (
                          <span className="shrink-0 px-1 py-[2px] rounded bg-[#5865F2] text-[8px] font-bold text-white uppercase leading-none select-none">
                            SYSTEM
                          </span>
                        )}
                        {recipient.isBot && !recipient.isSystem && (
                          <span className="shrink-0 px-1 py-[2px] rounded bg-[#5865F2] text-[8px] font-bold text-white uppercase leading-none select-none">
                            BOT
                          </span>
                        )}
                      </div>
                      {recipient.status !== "offline" && hasCustomStatus(recipient.customStatus, recipient.customization) && (
                        <CustomStatusLine
                          text={recipient.customStatus}
                          customization={recipient.customization}
                          className="text-xs text-[var(--text-muted)] font-normal"
                          emojiClassName="w-3.5 h-3.5"
                        />
                      )}
                      </div>
                      )}
                      {dmMentions > 0 && (
                        <span className="shrink-0 min-w-[18px] h-[18px] px-1.5 flex items-center justify-center rounded-full bg-[var(--app-accent)] text-[11px] font-bold text-[var(--text-on-accent)] leading-none group-hover:hidden">
                          {dmMentions > 99 ? "99+" : dmMentions}
                        </span>
                      )}
                      <button
                        className="p-1 opacity-0 group-hover:opacity-100 hover:text-[var(--text-primary)] transition-opacity shrink-0"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          closeDm(channel);
                        }}
                        title={isGroup ? gt("Close Group DM") : gt("Close DM")}
                        aria-label={isGroup ? gt("Close Group DM") : gt("Close DM")}
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </Link>
                  );
                })}
              </div>
            ) : !dmsLoaded ? (
              <div className="space-y-1 px-2 py-1" aria-hidden>
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-2 py-[5px]">
                    <div className="w-8 h-8 rounded-full bg-[var(--bg-sidebar-elevated)] animate-pulse" />
                    <div className="h-3 rounded bg-[var(--bg-sidebar-elevated)] animate-pulse" style={{ width: `${45 + ((i * 17) % 40)}%` }} />
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center text-[var(--text-muted)] text-sm py-8">
                No direct messages yet
              </div>
            )}
          </div>
        </ScrollArea>

        {/* User Panel */}
        <UserPanel user={user} />

        <MountWhenOpened open={showGroupPicker}>
          <GroupDmPickerDialog open={showGroupPicker} onOpenChange={setShowGroupPicker} mode="create" />
        </MountWhenOpened>

        {/* DM row context menu */}
        {dmContextMenu && (
          <div
            className="ctx-menu fixed z-50 min-w-[188px]"
            style={{ left: dmContextMenu.x, top: dmContextMenu.y }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              disabled={!isChannelUnread(dmContextMenu.channel.id) && getMentionCount(dmContextMenu.channel.id) === 0}
              onClick={() => { markChannelRead(dmContextMenu.channel.id); closeDmContextMenu(); }}
              className="ctx-item"
            >
              <Check className="w-4 h-4" />
              {gt("Mark As Read")}
            </button>
            {isMuteActive(notifPrefs.doc.channels[dmContextMenu.channel.id]) ? (
              <button
                onClick={() => {
                  void updateNotificationOverride("channel", dmContextMenu.channel.id, { muteUntil: null });
                  closeDmContextMenu();
                }}
                className="ctx-item"
                title={mutedUntilLabel(notifPrefs.doc.channels[dmContextMenu.channel.id]?.muteUntil)}
              >
                <Bell className="w-4 h-4" />
                {gt("Unmute Conversation")}
              </button>
            ) : (
              <div className="relative group/mute">
                <button className="ctx-item w-full">
                  <BellOff className="w-4 h-4" />
                  <span className="flex-1 text-left">{gt("Mute Conversation")}</span>
                  <ChevronRight className="w-3.5 h-3.5 opacity-60" />
                </button>
                <div className="ctx-menu absolute left-full top-0 z-50 hidden min-w-[180px] group-hover/mute:block group-focus-within/mute:block">
                  {muteOptions.map((o) => (
                    <button
                      key={o.key}
                      onClick={() => {
                        void updateNotificationOverride("channel", dmContextMenu.channel.id, { muteUntil: muteUntilFor(o.minutes) });
                        closeDmContextMenu();
                      }}
                      className="ctx-item"
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <button onClick={() => { closeDm(dmContextMenu.channel); closeDmContextMenu(); }} className="ctx-item">
              <X className="w-4 h-4" />
              {gt("Close DM")}
            </button>
            {dmContextMenu.channel.type === "group_dm" && user && (
              <button
                onClick={() => {
                  const ch = dmContextMenu.channel;
                  closeDmContextMenu();
                  voiceService.setUserId(user.id);
                  void startGroupCall({
                    group: {
                      channelId: ch.id,
                      name: dmRowTitle(ch),
                      icon: ch.icon ?? null,
                      memberCount: ch.recipients.length + 1,
                    },
                  });
                  router.push(groupDmHref(ch.id));
                }}
                className="ctx-item"
              >
                <Phone className="w-4 h-4" />
                {gt("Start Call")}
              </button>
            )}
            {dmContextMenu.channel.type === "group_dm" && (
              <button
                onClick={() => {
                  const ch = dmContextMenu.channel;
                  closeDmContextMenu();
                  void (async () => {
                    const ok = await confirmDialog({
                      title: gt("Leave '{name}'", { name: dmRowTitle(ch) }),
                      description: gt("Are you sure you want to leave this group? You won't be able to rejoin unless someone adds you back."),
                      confirmLabel: gt("Leave Group"),
                    });
                    if (!ok) return;
                    const res = await fetch(`/api/group-dms/${ch.id}`, { method: "DELETE" });
                    if (!res.ok) {
                      toast.error(gt("Couldn't leave the group"));
                      return;
                    }
                    setDmChannels((prev) => prev.filter((c) => c.id !== ch.id));
                    if (isDmChannelOpen(ch, pathname)) router.push("/channels/me");
                  })();
                }}
                className="ctx-item text-red-400"
              >
                <LogOut className="w-4 h-4" />
                {gt("Leave Group")}
              </button>
            )}
            <div className="ctx-sep" />
            {dmContextMenu.channel.type === "dm" && dmContextMenu.channel.recipients[0] ? (
              <UserMenuItems user={dmContextMenu.channel.recipients[0]} onDone={closeDmContextMenu} />
            ) : dmContextMenu.channel.type === "group_dm" ? (
              <button
                onClick={() => { void navigator.clipboard.writeText(dmContextMenu.channel.id); closeDmContextMenu(); }}
                className="ctx-item"
              >
                <Copy className="w-4 h-4" />
                {gt("Copy Channel ID")}
              </button>
            ) : (
              <button
                onClick={() => { navigator.clipboard.writeText(dmContextMenu.channel.recipients[0]?.id || ""); closeDmContextMenu(); }}
                className="ctx-item"
              >
                <Copy className="w-4 h-4" />
                {gt("Copy User ID")}
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  // Age-gated server block for iOS — render padlock screen instead of channel list
  if (isIOS && currentServer?.isAgeGated) {
    return (
      <div className="flex flex-col w-60 h-full bg-[var(--bg-sidebar)] border-r border-[var(--border-subtle)]">
        <div className="h-12 px-4 flex items-center border-b border-[var(--border-subtle)] shrink-0">
          <span className="font-semibold truncate text-[var(--text-primary)]">{currentServer.name}</span>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center px-6 text-center select-none">
          <div className="relative mb-6">
            <span className="absolute -top-2 -left-3 text-[var(--text-muted)] text-xs select-none">✦</span>
            <span className="absolute -top-1 right-0 text-[var(--text-muted)] text-[10px] select-none">✧</span>
            <span className="absolute bottom-0 -left-2 text-[var(--text-muted)] text-[8px] select-none">+</span>
            <span className="absolute bottom-2 -right-3 text-[var(--text-muted)] text-xs select-none">·</span>
            <div className="w-16 h-16 rounded-2xl bg-[var(--bg-sidebar-elevated)] flex items-center justify-center border border-[var(--border-subtle)]">
              <Lock className="w-8 h-8 text-[var(--text-muted)]" />
            </div>
          </div>
          <p className="text-sm text-[var(--text-muted)] leading-relaxed max-w-[200px]">
            This server&apos;s content is unavailable on iOS
          </p>
        </div>
        <UserPanel user={user} />
      </div>
    );
  }

  return (
    <div className="flex flex-col w-64 h-full min-h-0 bg-[var(--bg-sidebar)] border-r border-[var(--border-subtle)] overflow-hidden">
      {/* Server Header (banner behind the name when the server has one) */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className={cn(
              "relative flex items-end justify-between border-b border-[var(--border-subtle)] hover:bg-[var(--bg-sidebar-elevated)] transition-colors overflow-hidden shrink-0",
              currentServer.banner ? "h-[120px] px-4 pb-2" : "h-12 px-4 items-center"
            )}
          >
            {currentServer.banner && (
              <>
                <div
                  className="absolute inset-0 bg-cover bg-center"
                  style={{ backgroundImage: `url(${currentServer.banner})` }}
                  aria-hidden="true"
                />
                <div
                  className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent"
                  aria-hidden="true"
                />
              </>
            )}
            <span className="relative flex items-center gap-1.5 min-w-0">
              {currentServer.isPartnered && <ServerBadge type="partnered" size="sm" iconOnly />}
              <span className={cn(
                "font-semibold truncate",
                currentServer.banner ? "text-white drop-shadow" : "text-[var(--text-primary)]"
              )}>
                {currentServer.name}
              </span>
            </span>
            <ChevronDown className={cn(
              "relative w-5 h-5 shrink-0",
              currentServer.banner ? "text-white drop-shadow" : "text-[var(--text-primary)]"
            )} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-56 bg-[var(--bg-sidebar-elevated)] border border-[var(--border-subtle)] text-[var(--text-secondary)]">
          {canInvite && (
            <>
              <DropdownMenuItem
                onClick={onInvitePeople}
                className="text-[var(--app-accent)] focus:bg-[var(--app-accent)] focus:text-[var(--text-on-accent)] cursor-pointer"
              >
                <UserPlus className="w-4 h-4 mr-2" />
                {gt("Invite People")}
              </DropdownMenuItem>
              <DropdownMenuSeparator className="bg-[var(--border-subtle)]" />
            </>
          )}
          {canManageServer && (
            <DropdownMenuItem
              onClick={onServerSettings}
              className="focus:bg-[var(--app-accent)] focus:text-[var(--text-on-accent)] cursor-pointer"
            >
              <Settings className="w-4 h-4 mr-2" />
              {gt("Server Settings")}
            </DropdownMenuItem>
          )}
          {canManageChannels && (
            <>
              <DropdownMenuItem
                onClick={() => onCreateChannel?.("text")}
                className="focus:bg-[var(--app-accent)] focus:text-[var(--text-on-accent)] cursor-pointer"
              >
                <PlusCircle className="w-4 h-4 mr-2" />
                {gt("Create Channel")}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => onCreateChannel?.("category")}
                className="focus:bg-[var(--app-accent)] focus:text-[var(--text-on-accent)] cursor-pointer"
              >
                <Folder className="w-4 h-4 mr-2" />
                {gt("Create Category")}
              </DropdownMenuItem>
            </>
          )}
          {canManageAny && <DropdownMenuSeparator className="bg-[var(--border-subtle)]" />}
          <DropdownMenuItem
            onSelect={() => openNotificationSettings({ scope: "server", id: currentServer.id, name: currentServer.name })}
            className="focus:bg-[var(--app-accent)] focus:text-[var(--text-on-accent)] cursor-pointer"
          >
            <Bell className="w-4 h-4 mr-2" />
            {gt("Notification Settings")}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => window.dispatchEvent(new CustomEvent('openUserSettings', { detail: { tab: 'data-privacy' } }))}
            className="focus:bg-[var(--app-accent)] focus:text-[var(--text-on-accent)] cursor-pointer"
          >
            <Shield className="w-4 h-4 mr-2" />
            {gt("Privacy Settings")}
          </DropdownMenuItem>
          <DropdownMenuSeparator className="bg-[var(--border-subtle)]" />
          <DropdownMenuItem
            onClick={async () => {
              if (currentServer && (await confirmDialog({ title: gt("Leave Server"), description: gt("Leave '{name}'? You'll need a new invite to rejoin.", { name: currentServer.name }), confirmLabel: gt("Leave Server") }))) {
                await leaveServer(currentServer.id);
              }
            }}
            className="text-red-500 focus:bg-red-500 focus:text-[var(--text-on-accent)] cursor-pointer"
          >
            <LogOut className="w-4 h-4 mr-2" />
            {gt("Leave Server")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Channel List */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="py-3">
          {/* Uncategorized Channels drop zone */}
          <div
            className={cn(
              "mb-4 min-h-[8px] rounded transition-colors",
              dragOverTarget === "__uncategorized__" && draggedChannel && "bg-[var(--app-accent)]/10 ring-1 ring-[var(--app-accent)]/40"
            )}
            onDragEnter={(e) => handleDragEnter(e, "__uncategorized__")}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDrop={(e) => handleDropOnCategory(e, null)}
          >
            {uncategorizedChannels.length > 0 && (
              <div className="space-y-0.5">
                {uncategorizedChannels.map((channel) => renderChannelWithThreads(channel))}
              </div>
            )}
          </div>

          {/* Categorized Channels */}
          {categories.map((category) => {
            const isCollapsed = collapsedCategories.has(category.id);
            const categoryChildren = channelsByCategory.get(category.id) || [];
            return (
              <div
                key={category.id}
                className={cn(
                  "mb-4 rounded transition-colors",
                  dragOverTarget === category.id && draggedChannel && "bg-[var(--app-accent)]/5 ring-1 ring-[var(--app-accent)]/30"
                )}
                onDragEnter={(e) => handleDragEnter(e, category.id)}
                onDragLeave={handleDragLeave}
                onDragOver={handleDragOver}
                onDrop={(e) => handleDropOnCategory(e, category.id)}
              >
                {/* Category Header */}
                <div
                  className={cn(
                    "px-2 mb-1 relative",
                    canManageChannels && "cursor-grab active:cursor-grabbing"
                  )}
                  draggable={canManageChannels}
                  onDragStart={(e) => handleDragStart(e, category)}
                  onDragEnd={handleDragEnd}
                  onDragOver={(e) => handleDragOverChannel(e, category)}
                  onDrop={(e) => handleDropOnChannel(e, category)}
                >
                  {dropIndicator?.targetId === category.id && dropIndicator.position === "before" && (
                    <div className="absolute -top-px left-2 right-2 h-0.5 bg-[var(--app-accent)] rounded-full z-20" />
                  )}
                  {dropIndicator?.targetId === category.id && dropIndicator.position === "after" && (
                    <div className="absolute -bottom-px left-2 right-2 h-0.5 bg-[var(--app-accent)] rounded-full z-20" />
                  )}
                  <div
                    className="w-full px-1 flex items-center justify-between group cursor-pointer"
                    onClick={() => toggleCategory(category.id)}
                    onContextMenu={(e) => handleContextMenu(e, category)}
                  >
                    <div className="flex items-center gap-0.5 min-w-0">
                      <ChevronRight
                        className={cn(
                          "w-3 h-3 text-[var(--text-muted)] transition-transform shrink-0",
                          !isCollapsed && "rotate-90"
                        )}
                      />
                      <span className="text-xs font-bold uppercase text-[var(--text-muted)] group-hover:text-[var(--text-secondary)] select-none truncate min-w-0">
                        {category.name}
                      </span>
                    </div>
                    {canManageChannels && (
                      <PlusCircle
                        onClick={(e) => {
                          e.stopPropagation();
                          onCreateChannel?.(undefined, category.id);
                        }}
                        className="w-4 h-4 text-[var(--text-muted)] hover:text-[var(--text-secondary)] opacity-60 hover:opacity-100 group-hover:opacity-100 transition-opacity shrink-0"
                      />
                    )}
                  </div>
                </div>

                {/* Category Children Channels */}
                {!isCollapsed && (
                  <div className="space-y-0.5">
                    {categoryChildren.length > 0 ? (
                      categoryChildren.map((channel) => renderChannelWithThreads(channel))
                    ) : (
                      <div className="pl-6 text-[11px] text-[var(--text-muted)] italic select-none">
                        No channels in this category
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {/* Invisible bottom drop zone — no visual cringe, just works */}
          <div
            className={cn("w-full transition-all", draggedChannel ? "min-h-[32px]" : "min-h-0")}
            onDragOver={(e) => { if (draggedChannel) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; } }}
            onDrop={(e) => { if (draggedChannel) { e.preventDefault(); handleDropOnBottom(e); } }}
          />
        </div>
      </ScrollArea>

      {/* Voice Bar - hide when viewing a voice channel (full controls shown in main area) */}
      {currentChannel?.type !== "voice" && <VoiceBar channelName={activeVoiceChannelName} />}

      {/* User Panel */}
      <UserPanel user={user} />

      {/* Channel Context Menu */}
      {contextMenu && (
        <div
          className="ctx-menu fixed z-50 min-w-[188px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {canManageChannels && (
            <button
              onClick={handleEditChannel}
              className="ctx-item"
            >
              <Edit2 className="w-4 h-4" />
              {contextMenu.channel.type === "category" ? gt("Edit Category") : gt("Edit Channel")}
            </button>
          )}
          {canInvite && (
            <button
              onClick={onInvitePeople}
              className="ctx-item"
            >
              <UserPlus className="w-4 h-4" />
              {gt("Invite People")}
            </button>
          )}
          {(canManageChannels || canInvite) && <div className="ctx-sep" />}
          {contextMenu?.channel?.type !== "category" && (
            <button
              onClick={handleCopyChannelLink}
              className="ctx-item"
            >
              <LinkIcon className="w-4 h-4" />
              {gt("Copy Link")}
            </button>
          )}
          <button
            onClick={handleCopyChannelId}
            className="ctx-item"
          >
            <Copy className="w-4 h-4" />
            {contextMenu?.channel?.type === "category" ? gt("Copy Category ID") : gt("Copy Channel ID")}
          </button>
          <div className="ctx-sep" />
          {(() => {
            const ch = contextMenu.channel;
            const isCategory = ch.type === "category";
            const ids = isCategory ? channels.filter((c) => c.parentId === ch.id).map((c) => c.id) : [ch.id];
            const hasUnread = ids.some((id) => isChannelUnread(id) || getMentionCount(id) > 0);
            const ownEntry = notifPrefs.doc.channels[ch.id];
            const ownMuted = isMuteActive(ownEntry);
            const name = isCategory ? ch.name : `#${ch.name}`;
            return (
              <>
                <button
                  disabled={!hasUnread}
                  onClick={() => { markChannelsRead(ids); closeContextMenu(); }}
                  className="ctx-item disabled:opacity-50"
                >
                  <CheckCheck className="w-4 h-4" />
                  {gt("Mark As Read")}
                </button>
                <button
                  onClick={() => {
                    openNotificationSettings({
                      scope: "channel",
                      id: ch.id,
                      name,
                      serverId: currentServer?.id,
                      parentId: ch.parentId ?? null,
                      kind: isCategory ? "category" : "channel",
                    });
                    closeContextMenu();
                  }}
                  className="ctx-item"
                >
                  <Bell className="w-4 h-4" />
                  {gt("Notification Settings")}
                </button>
                {ownMuted ? (
                  <button
                    onClick={() => {
                      void updateNotificationOverride("channel", ch.id, { muteUntil: null });
                      toast.success(gt("{name} unmuted", { name }));
                      closeContextMenu();
                    }}
                    className="ctx-item"
                    title={mutedUntilLabel(ownEntry?.muteUntil)}
                  >
                    <Bell className="w-4 h-4" />
                    {isCategory ? gt("Unmute Category") : gt("Unmute Channel")}
                  </button>
                ) : (
                  <div className="relative group/mute">
                    <button className="ctx-item w-full">
                      <BellOff className="w-4 h-4" />
                      <span className="flex-1 text-left">{isCategory ? gt("Mute Category") : gt("Mute Channel")}</span>
                      <ChevronRight className="w-3.5 h-3.5 opacity-60" />
                    </button>
                    <div className="ctx-menu absolute left-full top-0 z-50 hidden min-w-[180px] group-hover/mute:block group-focus-within/mute:block">
                      {muteOptions.map((o) => (
                        <button
                          key={o.key}
                          onClick={() => {
                            void updateNotificationOverride("channel", ch.id, { muteUntil: muteUntilFor(o.minutes) });
                            toast.success(gt("{name} muted", { name }));
                            closeContextMenu();
                          }}
                          className="ctx-item"
                        >
                          {o.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </>
            );
          })()}
          {canManageChannels && (
            <>
              <div className="ctx-sep" />
              <button
                onClick={handleDeleteChannel}
                className="ctx-item ctx-item-danger"
              >
                <Trash2 className="w-4 h-4" />
                {contextMenu.channel.type === "category" ? gt("Delete Category") : gt("Delete Channel")}
              </button>
            </>
          )}
        </div>
      )}

      {/* Channel Settings Dialog */}
      {settingsChannelId && (
        <ChannelSettingsDialog
          open={!!settingsChannelId}
          onOpenChange={(open) => { if (!open) setSettingsChannelId(null); }}
          channelId={settingsChannelId}
        />
      )}
    </div>
  );
}

export interface UserPanelProps {
  user: {
    id?: string;
    username?: string;
    displayName?: string;
    avatar?: string;
    status?: string;
    customization?: {
      profileColor?: string;
      profileAccentColor?: string;
      profileGradient?: string[];
      displayNameStyle?: {
        font?: 'default' | 'serif' | 'mono' | 'rounded' | 'cursive' | 'bold';
        effect?: 'solid' | 'gradient' | 'neon' | 'toon' | 'pop';
        color?: string;
        gradient?: string[];
      };
    } | null;
  } | null;
}

export function UserPanel({ user }: UserPanelProps) {
  const gt = useGT();
  const [isMuted, setIsMuted] = useState(voiceService.muted);
  const [isDeafened, setIsDeafened] = useState(voiceService.deafened);
  // Server Mute / Server Deafen from a moderator (shown like Discord: red, with a tooltip).
  const [serverVoice, setServerVoice] = useState(() => ({ mute: voiceService.serverMute, deaf: voiceService.serverDeaf }));

  // Stay in sync with mute/deafen changes made elsewhere (VoiceBar, shortcuts)
  useEffect(() => {
    const unsubscribe = voiceService.subscribe((event) => {
      if (event.type === "mute_toggled") setIsMuted(event.muted);
      if (event.type === "deafen_toggled") setIsDeafened(event.deafened);
      if (event.type === "server_voice_state") setServerVoice({ mute: event.mute, deaf: event.deaf });
    });
    return unsubscribe;
  }, []);

  const handleMuteToggle = () => {
    setIsMuted(voiceService.toggleMute());
  };

  const handleDeafenToggle = () => {
    const deafened = voiceService.toggleDeafen();
    setIsDeafened(deafened);
    setIsMuted(voiceService.muted);
  };

  const handleSettingsClick = () => {
    // Open user settings - for now we'll use an alert, but this should open a modal
    window.dispatchEvent(new CustomEvent('openUserSettings'));
  };

  const nameplateBg = getNameplateBackground(user?.customization);

  return (
    <div className="relative overflow-hidden h-[52px] px-2 flex items-center bg-[var(--bg-sidebar)] border-t border-[var(--border-subtle)]">
      {/* Nameplate — floats behind the whole panel, not boxed in its own pill */}
      {nameplateBg && (
        <span
          aria-hidden
          className="absolute inset-0 pointer-events-none"
          style={{
            background: nameplateBg,
            opacity: 0.55,
            WebkitMaskImage: "linear-gradient(90deg, #000 55%, transparent 100%)",
            maskImage: "linear-gradient(90deg, #000 55%, transparent 100%)",
          }}
        />
      )}
      <UserProfilePopup onOpenSettings={handleSettingsClick}>
        <button
          className="relative z-10 flex items-center gap-2 flex-1 min-w-0 p-1 rounded hover:bg-[var(--bg-sidebar-elevated)]/60 transition-colors"
        >
          <div className="relative shrink-0">
            <Avatar className="w-8 h-8">
              <AvatarImage src={cdnImage(user?.avatar)} alt={user?.displayName} />
              <AvatarFallback className="bg-[var(--app-accent)] text-[var(--text-on-accent)] text-sm">
                {user?.displayName?.charAt(0).toUpperCase() || "?"}
              </AvatarFallback>
            </Avatar>
            <div
              className={cn(
                "absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-[3px] border-[var(--bg-sidebar)]",
                user?.status === "online" && "bg-[#23A559]",
                user?.status === "idle" && "bg-[#F0B232]",
                user?.status === "dnd" && "bg-[#EF4444]",
                (!user?.status || user?.status === "offline") && "bg-[#555555]"
              )}
            />
          </div>
          <div className="relative flex-1 min-w-0 text-left">
            <div className={cn("text-sm font-bold truncate", getDisplayNameStyleClasses(user?.customization?.displayNameStyle))} style={getDisplayNameStyleInline(user?.customization?.displayNameStyle)}>
              {user?.displayName || gt("Unknown")}
            </div>
          </div>
        </button>
      </UserProfilePopup>
      <div className="relative z-10 flex items-center gap-0.5">
        <button
          onClick={handleMuteToggle}
          className={cn(
            "p-1.5 rounded hover:bg-[var(--bg-sidebar-elevated)] transition-colors",
            isMuted || serverVoice.mute ? "text-red-500" : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          )}
          title={serverVoice.mute ? gt("Server Muted") : isMuted ? gt("Unmute") : gt("Mute")}
        >
          {isMuted || serverVoice.mute ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
        </button>
        <button
          onClick={handleDeafenToggle}
          className={cn(
            "p-1.5 rounded hover:bg-[var(--bg-sidebar-elevated)] transition-colors",
            isDeafened || serverVoice.deaf ? "text-red-500" : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          )}
          title={serverVoice.deaf ? gt("Server Deafened") : isDeafened ? gt("Undeafen") : gt("Deafen")}
        >
          {isDeafened || serverVoice.deaf ? <HeadphoneOff className="w-5 h-5" /> : <Headphones className="w-5 h-5" />}
        </button>
        <button
          onClick={handleSettingsClick}
          className="p-1.5 rounded hover:bg-[var(--bg-sidebar-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
          title={gt("User Settings")}
        >
          <Settings className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
}

/** Placeholder shown while the target server's channel list is still loading,
 *  so switching from a DM into a server doesn't flash the DM list. */
function ChannelSidebarSkeleton() {
  return (
    <div className="flex flex-col w-64 min-w-0 h-full bg-[var(--bg-sidebar)] border-r border-[var(--border-subtle)] overflow-hidden">
      {/* Server header bar */}
      <div className="h-12 px-4 flex items-center border-b border-[var(--border-subtle)] shrink-0">
        <div className="h-4 w-32 rounded bg-[var(--bg-sidebar-elevated)] animate-pulse" />
      </div>
      {/* Channel rows */}
      <div className="flex-1 px-2 pt-4 space-y-4 overflow-hidden">
        {[0, 1, 2].map((group) => (
          <div key={group} className="space-y-1.5">
            <div className="h-3 w-20 mx-2 rounded bg-[var(--bg-sidebar-elevated)] animate-pulse" />
            {Array.from({ length: 3 + group }).map((_, i) => (
              <div key={i} className="flex items-center gap-2 px-2 py-1.5">
                <div className="w-4 h-4 rounded bg-[var(--bg-sidebar-elevated)] animate-pulse" />
                <div
                  className="h-3 rounded bg-[var(--bg-sidebar-elevated)] animate-pulse"
                  style={{ width: `${50 + ((i * 17 + group * 11) % 40)}%` }}
                />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

"use client";

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
  X,
  Edit2,
  Trash2,
  Copy,
  Link as LinkIcon,
  BellOff,
  AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getDisplayNameStyleClasses, getDisplayNameStyleInline } from "@/lib/userDisplayNameStyle";
import { getNameplateBackground } from "@/lib/constants/nameplates";
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { UserProfilePopup } from "@/components/user/UserProfilePopup";
import { VoiceBar } from "@/components/voice/VoiceBar";
import { ServerBadge } from "@/components/ui/badges";
import { isChannelMuted, toggleChannelMute } from "@/lib/services/notificationUX";
import { useUnread } from "@/contexts/UnreadContext";
import { prefetchChannelMessages } from "@/hooks/useChatSession";
import { usePermissions } from "@/hooks/usePermissions";
import { usePolling } from "@/hooks/usePolling";
import { voiceService, type VoiceParticipant } from "@/lib/services/voiceService";
import { ChannelSettingsDialog } from "@/components/dialogs/ChannelSettingsDialog";
import { toast } from "sonner";

interface DMChannel {
  id: string;
  type: string;
  recipients: {
    id: string;
    username: string;
    displayName: string;
    avatar?: string;
    status: string;
    isPremium?: boolean;
    isSystem?: boolean;
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
  updatedAt?: string;
}

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
  const { currentServer, channels, currentChannel, setCurrentChannel, leaveServer, deleteChannel, updateChannel, reorderChannels } = useServer();
  const { user } = useAuth();
  const router = useRouter();
  const { can, isAdmin } = usePermissions(currentServer?.id);
  const canManageChannels = can("MANAGE_CHANNELS");
  const canManageServer = can("MANAGE_SERVER");
  const canInvite = can("CREATE_INVITE");
  const canManageAny = canManageChannels || canManageServer || isAdmin;
  const { isChannelUnread, getMentionCount, registerChannels, setActiveChannel } = useUnread();
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

  // Close context menu when clicking outside
  useEffect(() => {
    const handleClick = () => closeContextMenu();
    if (contextMenu) {
      window.addEventListener('click', handleClick);
      return () => window.removeEventListener('click', handleClick);
    }
  }, [contextMenu]);

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

  const handleDropOnCategory = async (e: React.DragEvent, categoryId: string | null) => {
    e.preventDefault();
    setDragOverTarget(null);
    setDropIndicator(null);
    dragCounterRef.current = 0;
    if (!draggedChannel || !currentServer) return;
    if (draggedChannel.type === "category") return;

    const targetChildren = categoryId
      ? (channelsByCategory.get(categoryId) || []).filter(c => c.id !== draggedChannel.id)
      : uncategorizedChannels.filter(c => c.id !== draggedChannel.id);

    const updates: Array<{ id: string; position: number; parentId?: string | null }> = [
      { id: draggedChannel.id, position: targetChildren.length, parentId: categoryId },
    ];
    targetChildren.forEach((ch, i) => {
      updates.push({ id: ch.id, position: i, parentId: categoryId });
    });

    try {
      await reorderChannels(currentServer.id, updates);
      toast.success(`Moved #${draggedChannel.name}`);
    } catch (err) {
      toast.error("Failed to move channel");
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
      siblings = (channelsByCategory.get(targetParent) || []).filter(c => c.id !== draggedChannel.id);
    } else if (target.type === "category") {
      siblings = categories.filter(c => c.id !== draggedChannel.id);
    } else {
      siblings = uncategorizedChannels.filter(c => c.id !== draggedChannel.id);
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
      toast.success(`Moved ${draggedChannel.type === "category" ? "" : "#"}${draggedChannel.name}`);
    } catch (err) {
      toast.error("Failed to move channel");
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
        toast.success(`Moved category ${draggedChannel.name} to bottom`);
      } catch (err) {
        toast.error("Failed to move category");
      }
    } else {
      const targetCategory = categories.length > 0 ? categories[categories.length - 1] : null;
      const targetParentId = targetCategory ? targetCategory.id : null;

      const siblings = targetParentId
        ? (channelsByCategory.get(targetParentId) || []).filter(c => c.id !== draggedChannel.id)
        : uncategorizedChannels.filter(c => c.id !== draggedChannel.id);
      
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
        toast.success(`Moved #${draggedChannel.name} to bottom`);
      } catch (err) {
        toast.error("Failed to move channel");
      }
    }
    setDraggedChannel(null);
  };

  const handleDeleteChannel = async () => {
    if (contextMenu?.channel && confirm(`Are you sure you want to delete #${contextMenu.channel.name}?`)) {
      try {
        await deleteChannel(contextMenu.channel.id);
        closeContextMenu();
        toast.success("Channel deleted");
      } catch (error) {
        console.error("Failed to delete channel:", error);
        toast.error("Failed to delete channel");
      }
    }
  };

  const handleCopyChannelId = () => {
    if (contextMenu?.channel) {
      navigator.clipboard.writeText(contextMenu.channel.id);
      closeContextMenu();
      toast.success("Channel ID copied");
    }
  };

  const handleCopyChannelLink = () => {
    if (contextMenu?.channel && currentServer) {
      const link = `${window.location.origin}/channels/${currentServer.id}/${contextMenu.channel.id}`;
      navigator.clipboard.writeText(link);
      closeContextMenu();
      toast.success("Channel link copied");
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
  const isIOS = useMemo(() => {
    if (typeof window === "undefined") return false;
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get("platform") === "ios") return true;
    const ua = navigator.userAgent;
    return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  }, []);

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

  const uncategorizedChannels = useMemo(() => {
    return channels.filter(c => c.type !== "category" && !c.parentId).sort(mentionFirst);
  }, [channels, mentionFirst]);

  const categories = useMemo(() => {
    return channels.filter(c => c.type === "category").sort((a, b) => a.position - b.position);
  }, [channels]);

  const channelsByCategory = useMemo(() => {
    const map = new Map<string, typeof channels>();
    for (const channel of channels) {
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
  }, [channels, mentionFirst]);

  // Mark channel as read when it becomes active (also updates the unread engine's
  // notion of which channel the user is viewing so its own messages don't glow).
  useEffect(() => {
    setActiveChannel(currentChannel?.id ?? null);
  }, [currentChannel?.id, setActiveChannel]);

  // Feed the unread engine the channel list (channel→server map + last-activity
  // seed) so it can compute glow/badges and per-server aggregation.
  useEffect(() => {
    if (channels.length === 0) return;
    registerChannels(
      channels.map((c) => ({
        id: c.id,
        serverId: c.serverId,
        type: c.type,
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
  const [externalVoiceParticipants, setExternalVoiceParticipants] = useState<Map<string, VoiceParticipant[]>>(new Map());
  const pathname = usePathname();

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
          onDragOver={(e) => handleDragOverChannel(e, channel)}
          onDrop={(e) => handleDropOnChannel(e, channel)}
        >
          {showDropBefore && <div className="absolute -top-px left-2 right-2 h-0.5 bg-[var(--app-accent)] rounded-full z-20" />}
          {showDropAfter && <div className="absolute -bottom-px left-2 right-2 h-0.5 bg-[var(--app-accent)] rounded-full z-20" />}
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
          {/* Participants — Discord style */}
          {channelParticipants.length > 0 && (
            <div className="ml-6 mr-2 space-y-0.5 mb-1">
              {channelParticipants.map((p) => (
                <div
                  key={p.userId}
                  className="flex items-center gap-1.5 px-1.5 py-0.5 rounded group/vp"
                >
                  <Avatar className="w-5 h-5 shrink-0">
                    <AvatarImage src={p.avatar} />
                    <AvatarFallback className="bg-[var(--app-accent)] text-[var(--text-on-accent)] text-[9px]">
                      {(p.displayName || p.username).charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <span className="text-xs text-[var(--text-secondary)] truncate flex-1">
                    {p.displayName || p.username}
                  </span>
                  {!p.audio && (
                    <MicOff className="w-3 h-3 text-red-400 shrink-0" />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      );
    }

    const mentionCount = getMentionCount(channel.id);
    const isActive = currentChannel?.id === channel.id;
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
          <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-2 rounded-r-full bg-white z-20" />
        )}
        <button
          onClick={() => { navigateToChannel(channel); setActiveChannel(channel.id); }}
          onMouseEnter={() => { void prefetchChannelMessages(`/api/channels/${channel.id}`); }}
          onContextMenu={(e) => handleContextMenu(e, channel)}
          className={cn(
            "w-full px-2 py-1.5 mx-2 rounded flex items-center gap-1.5 text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-sidebar-elevated)] transition-all group min-w-0 overflow-hidden",
            isActive && "bg-[var(--bg-active)] text-[var(--app-accent)]",
            !isActive && unread && "text-white font-semibold"
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

  useEffect(() => {
    if (!currentServer || !channels.length || !pathname) return;
    const match = pathname.match(/^\/channels\/[^/]+\/([^/]+)$/);
    if (match) {
      const channelId = match[1];
      const channel = channels.find((c) => c.id === channelId);
      if (channel && currentChannel?.id !== channel.id) {
        setCurrentChannel(channel);
      }
    }
  }, [pathname, channels, currentServer, setCurrentChannel, currentChannel?.id]);

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
    const voiceChannelIds = voiceChannels.map(ch => ch.id);
    {
      const results = new Map<string, VoiceParticipant[]>();
      await Promise.all(voiceChannelIds.map(async (chId) => {
        const roomId = `channel-${chId}`;
        if (voiceService.currentRoomId === roomId) return; // skip active channel
        try {
          const res = await fetch(`/api/voice/state/${roomId}`);
          if (res.ok) {
            const data = await res.json();
            if (data.participants?.length > 0) {
              results.set(chId, data.participants);
            }
          }
        } catch {
          // best-effort
        }
      }));
      setExternalVoiceParticipants(results);
    }
  }, [currentServer, voiceChannels]);
  usePolling(() => void fetchVoiceStates(), 5000, !!currentServer, currentServer?.id);

  // Fetch DM channels when no server is selected
  const fetchDMChannels = useCallback(async () => {
    try {
      const response = await fetch("/api/dms");
      if (response.ok) {
        const data = await response.json();
        const channels = (data.channels || []) as DMChannel[];
        channels.sort((a, b) => {
          const aTime = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
          const bTime = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
          return bTime - aTime;
        });
        setDmChannels(channels);
      }
    } catch (error) {
      console.error("Failed to fetch DM channels:", error);
    }
  }, []);

  useEffect(() => {
    if (!currentServer) {
      const timeoutId = window.setTimeout(() => {
        void fetchDMChannels();
      }, 0);
      return () => window.clearTimeout(timeoutId);
    }
  }, [currentServer, fetchDMChannels]);

  const statusColors: Record<string, string> = {
    online: "#23A559",
    idle: "#F0B232",
    dnd: "#EF4444",
    offline: "#555555",
  };

  if (!currentServer) {
    return (
      <div className="flex flex-col w-64 min-w-0 h-full bg-[var(--bg-sidebar)] border-r border-[var(--border-subtle)] overflow-hidden">
        {/* DM Header */}
        <div className="h-12 px-3 flex items-center border-b border-[var(--border-subtle)] shrink-0">
          <button className="w-full h-7 px-2.5 rounded-md bg-[var(--bg-sidebar-elevated)] text-[var(--text-muted)] text-sm text-left hover:brightness-110 transition-all truncate">
            Find or start a conversation
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
            <span className="font-medium truncate">Friends</span>
          </Link>
        </div>

        {/* DM List */}
        <ScrollArea className="flex-1 overflow-hidden">
          <div className="px-2 py-1">
            <div className="px-2 mb-1 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase text-[var(--text-muted)] tracking-wide">
                Direct Messages
              </span>
              <button className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors shrink-0">
                <PlusCircle className="w-4 h-4" />
              </button>
            </div>

            {dmChannels.length > 0 ? (
              <div className="space-y-0.5">
                {dmChannels.map((channel) => {
                  const recipient = channel.recipients[0];
                  if (!recipient) return null;
                  const isActive = pathname === `/dm/${recipient.id}`;

                  return (
                    <Link
                      key={channel.id}
                      href={`/dm/${recipient.id}`}
                      className={cn(
                        "group flex items-center gap-2 px-2 py-[5px] rounded-md transition-colors min-w-0",
                        isActive
                          ? "bg-[var(--bg-active)] text-[var(--text-primary)]"
                          : "text-[var(--text-secondary)] hover:bg-[var(--bg-sidebar-elevated)] hover:text-[var(--text-primary)]"
                      )}
                    >
                      <div className="relative shrink-0">
                        <Avatar className="w-8 h-8">
                          <AvatarImage src={recipient.avatar} />
                          <AvatarFallback className="bg-[var(--app-accent)] text-[var(--text-on-accent)] text-xs">
                            {(recipient.displayName || recipient.username).charAt(0).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div
                          className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-[var(--bg-sidebar)]"
                          style={{ backgroundColor: statusColors[recipient.status] || statusColors.offline }}
                        />
                      </div>
                      <div className="relative flex-1 min-w-0 overflow-hidden">
                        <span className={cn("block truncate text-sm", getDisplayNameStyleClasses(recipient.customization?.displayNameStyle))} style={getDisplayNameStyleInline(recipient.customization?.displayNameStyle)}>
                          {recipient.displayName || recipient.username}
                        </span>
                        {recipient.isSystem && (
                          <span className="text-[10px] text-blue-400">System</span>
                        )}
                      </div>
                      <button
                        className="p-1 opacity-0 group-hover:opacity-100 hover:text-[var(--text-primary)] transition-opacity shrink-0"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                        }}
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </Link>
                  );
                })}
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
                Invite People
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
              Server Settings
            </DropdownMenuItem>
          )}
          {canManageChannels && (
            <>
              <DropdownMenuItem
                onClick={() => onCreateChannel?.("text")}
                className="focus:bg-[var(--app-accent)] focus:text-[var(--text-on-accent)] cursor-pointer"
              >
                <PlusCircle className="w-4 h-4 mr-2" />
                Create Channel
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => onCreateChannel?.("category")}
                className="focus:bg-[var(--app-accent)] focus:text-[var(--text-on-accent)] cursor-pointer"
              >
                <Folder className="w-4 h-4 mr-2" />
                Create Category
              </DropdownMenuItem>
            </>
          )}
          {canManageAny && <DropdownMenuSeparator className="bg-[var(--border-subtle)]" />}
          <DropdownMenuItem className="focus:bg-[var(--app-accent)] focus:text-[var(--text-on-accent)] cursor-pointer">
            <Bell className="w-4 h-4 mr-2" />
            Notification Settings
          </DropdownMenuItem>
          <DropdownMenuItem className="focus:bg-[var(--app-accent)] focus:text-[var(--text-on-accent)] cursor-pointer">
            <Shield className="w-4 h-4 mr-2" />
            Privacy Settings
          </DropdownMenuItem>
          <DropdownMenuSeparator className="bg-[var(--border-subtle)]" />
          <DropdownMenuItem
            onClick={async () => {
              if (currentServer && confirm(`Are you sure you want to leave ${currentServer.name}?`)) {
                await leaveServer(currentServer.id);
              }
            }}
            className="text-red-500 focus:bg-red-500 focus:text-[var(--text-on-accent)] cursor-pointer"
          >
            <LogOut className="w-4 h-4 mr-2" />
            Leave Server
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
                {uncategorizedChannels.map((channel) => renderChannelItem(channel))}
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
                      categoryChildren.map((channel) => renderChannelItem(channel))
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

          {/* Bottom drop zone for reordering to the absolute end */}
          {draggedChannel && (
            <div
              className={cn(
                "h-12 mx-3 my-2 rounded border border-dashed border-[var(--border-subtle)] bg-[var(--bg-sidebar-elevated)]/40 hover:bg-[var(--bg-sidebar-elevated)] transition-all flex items-center justify-center text-xs text-[var(--text-muted)] animate-pulse"
              )}
              onDragOver={handleDragOver}
              onDragEnter={(e) => handleDragEnter(e, "__bottom_drop_zone__")}
              onDragLeave={handleDragLeave}
              onDrop={handleDropOnBottom}
            >
              Drop here to move to bottom
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Voice Bar - hide when viewing a voice channel (full controls shown in main area) */}
      {currentChannel?.type !== "voice" && <VoiceBar channelName={activeVoiceChannelName} />}

      {/* User Panel */}
      <UserPanel user={user} />

      {/* Channel Context Menu */}
      {contextMenu && (
        <div
          className="fixed z-50 min-w-[180px] bg-[var(--bg-sidebar-elevated)] border border-[var(--border-subtle)] rounded-lg shadow-xl py-1.5 animate-in fade-in-0 zoom-in-95"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {canManageChannels && (
            <button
              onClick={handleEditChannel}
              className="w-full px-3 py-1.5 flex items-center gap-2 text-sm text-[var(--text-primary)] hover:bg-[var(--app-accent)] hover:text-[var(--text-on-accent)] transition-colors"
            >
              <Edit2 className="w-4 h-4" />
              Edit Channel
            </button>
          )}
          {canInvite && (
            <button
              onClick={onInvitePeople}
              className="w-full px-3 py-1.5 flex items-center gap-2 text-sm text-[var(--text-primary)] hover:bg-[var(--app-accent)] hover:text-[var(--text-on-accent)] transition-colors"
            >
              <UserPlus className="w-4 h-4" />
              Invite People
            </button>
          )}
          {(canManageChannels || canInvite) && <div className="h-px bg-[var(--border-subtle)] my-1" />}
          <button
            onClick={handleCopyChannelLink}
            className="w-full px-3 py-1.5 flex items-center gap-2 text-sm text-[var(--text-primary)] hover:bg-[var(--app-accent)] hover:text-[var(--text-on-accent)] transition-colors"
          >
            <LinkIcon className="w-4 h-4" />
            Copy Link
          </button>
          <button
            onClick={handleCopyChannelId}
            className="w-full px-3 py-1.5 flex items-center gap-2 text-sm text-[var(--text-primary)] hover:bg-[var(--app-accent)] hover:text-[var(--text-on-accent)] transition-colors"
          >
            <Copy className="w-4 h-4" />
            Copy Channel ID
          </button>
          <div className="h-px bg-[var(--border-subtle)] my-1" />
          <button
            onClick={() => {
              if (contextMenu?.channel) {
                const nowMuted = toggleChannelMute(contextMenu.channel.id);
                toast.success(
                  nowMuted
                    ? `#${contextMenu.channel.name} muted`
                    : `#${contextMenu.channel.name} unmuted`
                );
              }
              closeContextMenu();
            }}
            className="w-full px-3 py-1.5 flex items-center gap-2 text-sm text-[var(--text-primary)] hover:bg-[var(--app-accent)] hover:text-[var(--text-on-accent)] transition-colors"
          >
            <BellOff className="w-4 h-4" />
            {contextMenu?.channel && isChannelMuted(contextMenu.channel.id) ? "Unmute Channel" : "Mute Channel"}
          </button>
          {canManageChannels && (
            <>
              <div className="h-px bg-[var(--border-subtle)] my-1" />
              <button
                onClick={handleDeleteChannel}
                className="w-full px-3 py-1.5 flex items-center gap-2 text-sm text-red-400 hover:bg-red-500 hover:text-[var(--text-primary)] transition-colors"
              >
                <Trash2 className="w-4 h-4" />
                Delete Channel
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

interface UserPanelProps {
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

function UserPanel({ user }: UserPanelProps) {
  const [isMuted, setIsMuted] = useState(voiceService.muted);
  const [isDeafened, setIsDeafened] = useState(voiceService.deafened);

  // Stay in sync with mute/deafen changes made elsewhere (VoiceBar, shortcuts)
  useEffect(() => {
    const unsubscribe = voiceService.subscribe((event) => {
      if (event.type === "mute_toggled") setIsMuted(event.muted);
      if (event.type === "deafen_toggled") setIsDeafened(event.deafened);
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
              <AvatarImage src={user?.avatar} alt={user?.displayName} />
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
              {user?.displayName || "Unknown"}
            </div>
          </div>
        </button>
      </UserProfilePopup>
      <div className="relative z-10 flex items-center gap-0.5">
        <button
          onClick={handleMuteToggle}
          className={cn(
            "p-1.5 rounded hover:bg-[var(--bg-sidebar-elevated)] transition-colors",
            isMuted ? "text-red-500" : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          )}
          title={isMuted ? "Unmute" : "Mute"}
        >
          {isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
        </button>
        <button
          onClick={handleDeafenToggle}
          className={cn(
            "p-1.5 rounded hover:bg-[var(--bg-sidebar-elevated)] transition-colors",
            isDeafened ? "text-red-500" : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          )}
          title={isDeafened ? "Undeafen" : "Deafen"}
        >
          {isDeafened ? <HeadphoneOff className="w-5 h-5" /> : <Headphones className="w-5 h-5" />}
        </button>
        <button
          onClick={handleSettingsClick}
          className="p-1.5 rounded hover:bg-[var(--bg-sidebar-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
          title="User Settings"
        >
          <Settings className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
}

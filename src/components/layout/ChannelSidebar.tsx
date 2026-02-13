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
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserProfilePopup } from "@/components/user/UserProfilePopup";
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
  }[];
  lastMessageId?: string;
  updatedAt?: string;
}

interface ChannelSidebarProps {
  onInvitePeople?: () => void;
  onServerSettings?: () => void;
  onCreateChannel?: () => void;
  onCreateCategory?: () => void;
  onLeaveServer?: () => void;
}

export function ChannelSidebar({
  onInvitePeople,
  onServerSettings,
  onCreateChannel,
  onCreateCategory,
}: ChannelSidebarProps) {
  const { currentServer, channels, currentChannel, setCurrentChannel, leaveServer, deleteChannel, updateChannel } = useServer();
  const { user } = useAuth();

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    channel: typeof channels[0];
  } | null>(null);
  const [editingChannel, setEditingChannel] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

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
      setEditingChannel(contextMenu.channel.id);
      setEditName(contextMenu.channel.name);
      closeContextMenu();
    }
  };

  const handleSaveEdit = async (channelId: string) => {
    if (editName.trim()) {
      try {
        await updateChannel(channelId, { name: editName.trim() });
        toast.success("Channel updated");
      } catch (error) {
        console.error("Failed to update channel:", error);
        toast.error("Failed to update channel");
      }
    }
    setEditingChannel(null);
    setEditName("");
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

  const getChannelIcon = (type: string, isLocked?: boolean) => {
    if (isLocked) {
      return <Lock className="w-5 h-5 text-[var(--text-muted)] flex-shrink-0" />;
    }
    switch (type) {
      case "voice":
        return <Volume2 className="w-5 h-5 text-[var(--text-muted)] flex-shrink-0" />;
      case "announcement":
        return <Megaphone className="w-5 h-5 text-[var(--text-muted)] flex-shrink-0" />;
      case "category":
        return <Folder className="w-5 h-5 text-[var(--text-muted)] flex-shrink-0" />;
      default:
        return <Hash className="w-5 h-5 text-[var(--text-muted)] flex-shrink-0" />;
    }
  };

  // Group channels by type
  const textChannels = channels.filter(c => c.type === "text");
  const voiceChannels = channels.filter(c => c.type === "voice");
  const announcementChannels = channels.filter(c => c.type === "announcement");

  // State for collapsed categories
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  const [dmChannels, setDmChannels] = useState<DMChannel[]>([]);
  const pathname = usePathname();

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

  // Fetch DM channels when no server is selected
  const fetchDMChannels = useCallback(async () => {
    try {
      const response = await fetch("/api/dms");
      if (response.ok) {
        const data = await response.json();
        setDmChannels(data.channels || []);
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
    online: "#8B5CF6",
    idle: "#A78BFA",
    dnd: "#EF4444",
    offline: "#555555",
  };

  if (!currentServer) {
    return (
      <div className="flex flex-col w-60 h-full bg-[var(--bg-sidebar)] border-r border-[var(--border-subtle)]">
        {/* DM Header */}
        <div className="h-12 px-4 flex items-center border-b border-[var(--border-subtle)]">
          <button className="w-full h-7 px-2 rounded bg-[var(--bg-sidebar-elevated)] text-[var(--text-muted)] text-sm text-left hover:bg-[var(--bg-sidebar-elevated)] transition-colors">
            Find or start a conversation
          </button>
        </div>

        {/* Navigation */}
        <div className="px-2 pt-3 pb-1">
          <Link
            href="/channels/me"
            className={cn(
              "flex items-center gap-3 px-2 py-2 rounded-md transition-colors",
              pathname === "/channels/me"
                ? "bg-[var(--bg-active)] text-[var(--text-primary)]"
                : "text-[var(--text-secondary)] hover:bg-[var(--bg-sidebar-elevated)] hover:text-[var(--text-primary)]"
            )}
          >
            <Users className="w-5 h-5" />
            <span className="font-medium">Friends</span>
          </Link>
        </div>

        {/* DM List */}
        <ScrollArea className="flex-1">
          <div className="px-2 py-2">
            <div className="px-2 mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase text-[var(--text-muted)]">
                Direct Messages
              </span>
              <button className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors">
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
                        "group flex items-center gap-3 px-2 py-1.5 rounded-md transition-colors",
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
                          className="absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-[var(--bg-sidebar)]"
                          style={{ backgroundColor: statusColors[recipient.status] || statusColors.offline }}
                        />
                      </div>
                      <span className="flex-1 truncate text-sm">
                        {recipient.displayName || recipient.username}
                      </span>
                      <button
                        className="p-1 opacity-0 group-hover:opacity-100 hover:text-[var(--text-primary)] transition-opacity"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          // Close DM functionality would go here
                        }}
                      >
                        <X className="w-4 h-4" />
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

  return (
    <div className="flex flex-col w-60 h-full bg-[var(--bg-sidebar)] border-r border-[var(--border-subtle)]">
      {/* Server Header */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="h-12 px-4 flex items-center justify-between border-b border-[var(--border-subtle)] hover:bg-[var(--bg-sidebar-elevated)] transition-colors">
            <span className="font-semibold text-[var(--text-primary)] truncate">
              {currentServer.name}
            </span>
            <ChevronDown className="w-5 h-5 text-[var(--text-primary)]" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-56 bg-[var(--bg-sidebar-elevated)] border border-[var(--border-subtle)] text-[var(--text-secondary)]">
          <DropdownMenuItem
            onClick={onInvitePeople}
            className="text-[var(--app-accent)] focus:bg-[var(--app-accent)] focus:text-[var(--text-on-accent)] cursor-pointer"
          >
            <UserPlus className="w-4 h-4 mr-2" />
            Invite People
          </DropdownMenuItem>
          <DropdownMenuSeparator className="bg-[var(--border-subtle)]" />
          <DropdownMenuItem
            onClick={onServerSettings}
            className="focus:bg-[var(--app-accent)] focus:text-[var(--text-on-accent)] cursor-pointer"
          >
            <Settings className="w-4 h-4 mr-2" />
            Server Settings
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={onCreateChannel}
            className="focus:bg-[var(--app-accent)] focus:text-[var(--text-on-accent)] cursor-pointer"
          >
            <PlusCircle className="w-4 h-4 mr-2" />
            Create Channel
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={onCreateCategory || onCreateChannel}
            className="focus:bg-[var(--app-accent)] focus:text-[var(--text-on-accent)] cursor-pointer"
          >
            <Folder className="w-4 h-4 mr-2" />
            Create Category
          </DropdownMenuItem>
          <DropdownMenuSeparator className="bg-[var(--border-subtle)]" />
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
      <ScrollArea className="flex-1">
        <div className="py-3">
          {/* Announcement Channels (if any) */}
          {announcementChannels.length > 0 && (
            <div className="mb-2">
              <div className="px-2 mb-1">
                <button
                  className="w-full px-1 flex items-center gap-0.5 group"
                  onClick={() => toggleCategory('announcements')}
                >
                  <ChevronRight
                    className={cn(
                      "w-3 h-3 text-[var(--text-muted)] transition-transform",
                      !collapsedCategories.has('announcements') && "rotate-90"
                    )}
                  />
                  <span className="text-xs font-semibold uppercase text-[var(--text-muted)] group-hover:text-[var(--text-secondary)]">
                    Announcements
                  </span>
                </button>
              </div>
              {!collapsedCategories.has('announcements') && announcementChannels.map((channel) => (
                <button
                  key={channel.id}
                  onClick={() => setCurrentChannel(channel)}
                  onContextMenu={(e) => handleContextMenu(e, channel)}
                  className={cn(
                    "w-full px-2 py-1.5 mx-2 rounded flex items-center gap-1.5 text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-sidebar-elevated)] transition-all group",
                    currentChannel?.id === channel.id && "bg-[var(--bg-active)] text-[var(--app-accent)]"
                  )}
                  style={{ width: "calc(100% - 16px)" }}
                >
                  {getChannelIcon(channel.type)}
                  <span className="truncate text-sm font-medium">{channel.name}</span>
                </button>
              ))}
            </div>
          )}

          {/* Text Channels */}
          <div className="mb-2">
            <div className="px-2 mb-1">
              <button
                className="w-full px-1 flex items-center justify-between group"
                onClick={() => toggleCategory('text')}
              >
                <div className="flex items-center gap-0.5">
                  <ChevronRight
                    className={cn(
                      "w-3 h-3 text-[var(--text-muted)] transition-transform",
                      !collapsedCategories.has('text') && "rotate-90"
                    )}
                  />
                  <span className="text-xs font-semibold uppercase text-[var(--text-muted)] group-hover:text-[var(--text-secondary)]">
                    Text Channels
                  </span>
                </div>
                <PlusCircle
                  onClick={(e) => {
                    e.stopPropagation();
                    onCreateChannel?.();
                  }}
                  className="w-4 h-4 text-[var(--text-muted)] hover:text-[var(--text-secondary)] opacity-0 group-hover:opacity-100 transition-opacity"
                />
              </button>
            </div>
            {!collapsedCategories.has('text') && textChannels.map((channel) => (
              editingChannel === channel.id ? (
                <div key={channel.id} className="w-full px-2 py-1 mx-2" style={{ width: "calc(100% - 16px)" }}>
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onBlur={() => handleSaveEdit(channel.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSaveEdit(channel.id);
                      if (e.key === 'Escape') { setEditingChannel(null); setEditName(""); }
                    }}
                    autoFocus
                    className="w-full px-2 py-1 bg-[var(--bg-sidebar-elevated)] border border-[#8B5CF6] rounded text-[var(--text-primary)] text-sm focus:outline-none"
                  />
                </div>
              ) : (
                <button
                  key={channel.id}
                  onClick={() => setCurrentChannel(channel)}
                  onContextMenu={(e) => handleContextMenu(e, channel)}
                  className={cn(
                    "w-full px-2 py-1.5 mx-2 rounded flex items-center gap-1.5 text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-sidebar-elevated)] transition-all group",
                    currentChannel?.id === channel.id && "bg-[var(--bg-active)] text-[var(--app-accent)]"
                  )}
                  style={{ width: "calc(100% - 16px)" }}
                >
                  {getChannelIcon(channel.type)}
                  <span className="truncate text-sm">{channel.name}</span>
                </button>
              )
            ))}
          </div>

          {/* Voice Channels */}
          <div className="mb-2">
            <div className="px-2 mb-1">
              <button
                className="w-full px-1 flex items-center justify-between group"
                onClick={() => toggleCategory('voice')}
              >
                <div className="flex items-center gap-0.5">
                  <ChevronRight
                    className={cn(
                      "w-3 h-3 text-[var(--text-muted)] transition-transform",
                      !collapsedCategories.has('voice') && "rotate-90"
                    )}
                  />
                  <span className="text-xs font-semibold uppercase text-[var(--text-muted)] group-hover:text-[var(--text-secondary)]">
                    Voice Channels
                  </span>
                </div>
                <PlusCircle
                  onClick={(e) => {
                    e.stopPropagation();
                    onCreateChannel?.();
                  }}
                  className="w-4 h-4 text-[var(--text-muted)] hover:text-[var(--text-secondary)] opacity-0 group-hover:opacity-100 transition-opacity"
                />
              </button>
            </div>
            {!collapsedCategories.has('voice') && voiceChannels.map((channel) => (
              <div key={channel.id} className="relative">
                <button
                  onClick={() => setCurrentChannel(channel)}
                  onContextMenu={(e) => handleContextMenu(e, channel)}
                  className={cn(
                    "w-full px-2 py-1.5 mx-2 rounded flex items-center gap-1.5 text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-sidebar-elevated)] transition-all group",
                    currentChannel?.id === channel.id && "bg-[var(--bg-active)] text-[var(--app-accent)]"
                  )}
                  style={{ width: "calc(100% - 16px)" }}
                >
                  {getChannelIcon(channel.type)}
                  <span className="truncate text-sm">{channel.name}</span>
                  <span className="ml-auto flex items-center gap-1 text-xs text-[var(--app-accent)]">
                    <Clock className="w-3 h-3" />
                    <span className="text-[10px] font-medium">Soon</span>
                  </span>
                </button>
              </div>
            ))}
          </div>
        </div>
      </ScrollArea>

      {/* User Panel */}
      <UserPanel user={user} />

      {/* Channel Context Menu */}
      {contextMenu && (
        <div
          className="fixed z-50 min-w-[180px] bg-[var(--bg-sidebar-elevated)] border border-[var(--border-subtle)] rounded-lg shadow-xl py-1.5 animate-in fade-in-0 zoom-in-95"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={handleEditChannel}
            className="w-full px-3 py-1.5 flex items-center gap-2 text-sm text-[var(--text-primary)] hover:bg-[var(--app-accent)] hover:text-[var(--text-on-accent)] transition-colors"
          >
            <Edit2 className="w-4 h-4" />
            Edit Channel
          </button>
          <button
            onClick={onInvitePeople}
            className="w-full px-3 py-1.5 flex items-center gap-2 text-sm text-[var(--text-primary)] hover:bg-[var(--app-accent)] hover:text-[var(--text-on-accent)] transition-colors"
          >
            <UserPlus className="w-4 h-4" />
            Invite People
          </button>
          <div className="h-px bg-[var(--border-subtle)] my-1" />
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
            onClick={() => { closeContextMenu(); /* TODO: Mute channel */ }}
            className="w-full px-3 py-1.5 flex items-center gap-2 text-sm text-[var(--text-primary)] hover:bg-[var(--app-accent)] hover:text-[var(--text-on-accent)] transition-colors"
          >
            <BellOff className="w-4 h-4" />
            Mute Channel
          </button>
          <div className="h-px bg-[var(--border-subtle)] my-1" />
          <button
            onClick={handleDeleteChannel}
            className="w-full px-3 py-1.5 flex items-center gap-2 text-sm text-red-400 hover:bg-red-500 hover:text-[var(--text-primary)] transition-colors"
          >
            <Trash2 className="w-4 h-4" />
            Delete Channel
          </button>
        </div>
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
  } | null;
}

function UserPanel({ user }: UserPanelProps) {
  const [isMuted, setIsMuted] = useState(false);
  const [isDeafened, setIsDeafened] = useState(false);

  const handleMuteToggle = () => {
    setIsMuted(!isMuted);
    // TODO: Implement actual mute functionality
  };

  const handleDeafenToggle = () => {
    setIsDeafened(!isDeafened);
    if (!isDeafened) {
      setIsMuted(true); // Deafening also mutes
    }
    // TODO: Implement actual deafen functionality
  };

  const handleSettingsClick = () => {
    // Open user settings - for now we'll use an alert, but this should open a modal
    window.dispatchEvent(new CustomEvent('openUserSettings'));
  };

  return (
    <div className="h-[52px] px-2 flex items-center bg-[var(--bg-sidebar)] border-t border-[var(--border-subtle)]">
      <UserProfilePopup onOpenSettings={handleSettingsClick}>
        <button
          className="flex items-center gap-2 flex-1 min-w-0 p-1 rounded hover:bg-[var(--bg-sidebar-elevated)] transition-colors"
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
                user?.status === "online" && "bg-[var(--app-accent)]",
                user?.status === "idle" && "bg-[#A78BFA]",
                user?.status === "dnd" && "bg-red-500",
                (!user?.status || user?.status === "offline") && "bg-[var(--text-muted)]"
              )}
            />
          </div>
          <div className="flex-1 min-w-0 text-left">
            <div className="text-sm font-medium text-[var(--text-primary)] truncate">
              {user?.displayName || "Unknown"}
            </div>
            <div className="text-xs text-[var(--text-muted)] truncate">
              {user?.username || "unknown"}
            </div>
          </div>
        </button>
      </UserProfilePopup>
      <div className="flex items-center gap-0.5">
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

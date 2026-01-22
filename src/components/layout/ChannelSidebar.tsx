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
  Headphones,
  Cog,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface ChannelSidebarProps {
  onInvitePeople?: () => void;
  onServerSettings?: () => void;
  onCreateChannel?: () => void;
}

export function ChannelSidebar({
  onInvitePeople,
  onServerSettings,
  onCreateChannel,
}: ChannelSidebarProps) {
  const { currentServer, channels, currentChannel, setCurrentChannel } = useServer();
  const { user } = useAuth();

  const getChannelIcon = (type: string) => {
    switch (type) {
      case "voice":
        return <Volume2 className="w-5 h-5 text-[#80848e] flex-shrink-0" />;
      case "announcement":
        return <Megaphone className="w-5 h-5 text-[#80848e] flex-shrink-0" />;
      default:
        return <Hash className="w-5 h-5 text-[#80848e] flex-shrink-0" />;
    }
  };

  if (!currentServer) {
    return (
      <div className="flex flex-col w-60 h-full bg-[#2b2d31]">
        {/* DM Header */}
        <div className="h-12 px-4 flex items-center border-b border-[#1f2023] shadow-sm">
          <button className="w-full h-7 px-2 rounded bg-[#1e1f22] text-[#949ba4] text-sm text-left">
            Find or start a conversation
          </button>
        </div>

        {/* DM List */}
        <ScrollArea className="flex-1">
          <div className="px-2 py-4">
            <div className="px-2 mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase text-[#949ba4]">
                Direct Messages
              </span>
              <button className="text-[#b5bac1] hover:text-white">
                <PlusCircle className="w-4 h-4" />
              </button>
            </div>
            {/* DM items would go here */}
            <div className="text-center text-[#949ba4] text-sm py-8">
              No direct messages yet
            </div>
          </div>
        </ScrollArea>

        {/* User Panel */}
        <UserPanel user={user} />
      </div>
    );
  }

  return (
    <div className="flex flex-col w-60 h-full bg-[#2b2d31]">
      {/* Server Header */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="h-12 px-4 flex items-center justify-between border-b border-[#1f2023] shadow-sm hover:bg-[#35373c] transition-colors">
            <span className="font-semibold text-white truncate">
              {currentServer.name}
            </span>
            <ChevronDown className="w-5 h-5 text-white" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-56 bg-[#111214] border-none text-[#b5bac1]">
          <DropdownMenuItem
            onClick={onInvitePeople}
            className="text-[#949cf7] focus:bg-[#5865F2] focus:text-white cursor-pointer"
          >
            <UserPlus className="w-4 h-4 mr-2" />
            Invite People
          </DropdownMenuItem>
          <DropdownMenuSeparator className="bg-[#2d2f32]" />
          <DropdownMenuItem
            onClick={onServerSettings}
            className="focus:bg-[#5865F2] focus:text-white cursor-pointer"
          >
            <Settings className="w-4 h-4 mr-2" />
            Server Settings
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={onCreateChannel}
            className="focus:bg-[#5865F2] focus:text-white cursor-pointer"
          >
            <PlusCircle className="w-4 h-4 mr-2" />
            Create Channel
          </DropdownMenuItem>
          <DropdownMenuItem className="focus:bg-[#5865F2] focus:text-white cursor-pointer">
            <Folder className="w-4 h-4 mr-2" />
            Create Category
          </DropdownMenuItem>
          <DropdownMenuSeparator className="bg-[#2d2f32]" />
          <DropdownMenuItem className="focus:bg-[#5865F2] focus:text-white cursor-pointer">
            <Bell className="w-4 h-4 mr-2" />
            Notification Settings
          </DropdownMenuItem>
          <DropdownMenuItem className="focus:bg-[#5865F2] focus:text-white cursor-pointer">
            <Shield className="w-4 h-4 mr-2" />
            Privacy Settings
          </DropdownMenuItem>
          <DropdownMenuSeparator className="bg-[#2d2f32]" />
          <DropdownMenuItem className="text-[#f23f43] focus:bg-[#f23f43] focus:text-white cursor-pointer">
            <LogOut className="w-4 h-4 mr-2" />
            Leave Server
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Channel List */}
      <ScrollArea className="flex-1">
        <div className="py-4">
          {/* Text Channels */}
          <div className="px-2 mb-1">
            <button className="w-full px-1 flex items-center justify-between group">
              <span className="text-xs font-semibold uppercase text-[#949ba4] group-hover:text-[#dbdee1]">
                Text Channels
              </span>
              <PlusCircle
                onClick={onCreateChannel}
                className="w-4 h-4 text-[#949ba4] hover:text-[#dbdee1]"
              />
            </button>
          </div>
          {channels
            .filter((c) => c.type === "text")
            .map((channel) => (
              <button
                key={channel.id}
                onClick={() => setCurrentChannel(channel)}
                className={cn(
                  "w-full px-2 py-1.5 mx-2 rounded flex items-center gap-1.5 text-[#949ba4] hover:text-[#dbdee1] hover:bg-[#35373c]/50 transition-all group",
                  currentChannel?.id === channel.id &&
                    "bg-[#404249] text-white"
                )}
                style={{ width: "calc(100% - 16px)" }}
              >
                {getChannelIcon(channel.type)}
                <span className="truncate text-sm">{channel.name}</span>
              </button>
            ))}

          {/* Voice Channels */}
          <div className="px-2 mt-4 mb-1">
            <button className="w-full px-1 flex items-center justify-between group">
              <span className="text-xs font-semibold uppercase text-[#949ba4] group-hover:text-[#dbdee1]">
                Voice Channels
              </span>
              <PlusCircle
                onClick={onCreateChannel}
                className="w-4 h-4 text-[#949ba4] hover:text-[#dbdee1]"
              />
            </button>
          </div>
          {channels
            .filter((c) => c.type === "voice")
            .map((channel) => (
              <button
                key={channel.id}
                onClick={() => setCurrentChannel(channel)}
                className={cn(
                  "w-full px-2 py-1.5 mx-2 rounded flex items-center gap-1.5 text-[#949ba4] hover:text-[#dbdee1] hover:bg-[#35373c]/50 transition-all group",
                  currentChannel?.id === channel.id &&
                    "bg-[#404249] text-white"
                )}
                style={{ width: "calc(100% - 16px)" }}
              >
                {getChannelIcon(channel.type)}
                <span className="truncate text-sm">{channel.name}</span>
              </button>
            ))}
        </div>
      </ScrollArea>

      {/* User Panel */}
      <UserPanel user={user} />
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
  return (
    <div className="h-[52px] px-2 flex items-center bg-[#232428]">
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <div className="relative">
          <Avatar className="w-8 h-8">
            <AvatarImage src={user?.avatar} alt={user?.displayName} />
            <AvatarFallback className="bg-[#5865F2] text-white text-sm">
              {user?.displayName?.charAt(0).toUpperCase() || "?"}
            </AvatarFallback>
          </Avatar>
          <div
            className={cn(
              "absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-[3px] border-[#232428]",
              user?.status === "online" && "status-online",
              user?.status === "idle" && "status-idle",
              user?.status === "dnd" && "status-dnd",
              (!user?.status || user?.status === "offline") && "status-offline"
            )}
          />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-white truncate">
            {user?.displayName || "Unknown"}
          </div>
          <div className="text-xs text-[#949ba4] truncate">
            {user?.username || "unknown"}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-1">
        <button className="p-1.5 rounded hover:bg-[#3f4248] text-[#b5bac1]">
          <Mic className="w-5 h-5" />
        </button>
        <button className="p-1.5 rounded hover:bg-[#3f4248] text-[#b5bac1]">
          <Headphones className="w-5 h-5" />
        </button>
        <button className="p-1.5 rounded hover:bg-[#3f4248] text-[#b5bac1]">
          <Cog className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
}

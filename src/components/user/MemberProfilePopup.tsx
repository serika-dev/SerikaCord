"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  MessageSquare,
  UserPlus,
  MoreHorizontal,
  Crown,
  Copy,
  Check,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getBadgesByPriority, type BadgeId } from "@/lib/constants/badges";

interface MemberProfilePopupProps {
  children: React.ReactNode;
  member: {
    id: string;
    username: string;
    displayName?: string;
    avatar?: string | null;
    banner?: string | null;
    bio?: string | null;
    status: "online" | "idle" | "dnd" | "offline";
    customStatus?: string | null;
    badges?: string[];
    roles?: Array<{
      id: string;
      name: string;
      color?: string;
    }>;
    joinedAt?: string | null;
    createdAt?: string | null;
    isPremium?: boolean;
    isOwner?: boolean;
  };
  serverId?: string;
  side?: "left" | "right" | "top" | "bottom";
  align?: "start" | "center" | "end";
}

const statusColors: Record<string, string> = {
  online: "#8B5CF6",
  idle: "#A78BFA",
  dnd: "#EF4444",
  offline: "#555555",
};

export function MemberProfilePopup({ 
  children, 
  member, 
  serverId,
  side = "left",
  align = "start",
}: MemberProfilePopupProps) {
  const { user: currentUser } = useAuth();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [fullProfile, setFullProfile] = useState(member);

  // Fetch full profile when popup opens
  useEffect(() => {
    setFullProfile(member);
  }, [member]);

  useEffect(() => {
    if (!open || !member.id) return;

    const fetchProfile = async () => {
      try {
        const response = await fetch(`/api/users/${member.id}`);
        if (response.ok) {
          const data = await response.json();
          setFullProfile((prev) => ({ ...prev, ...data }));
        }
      } catch (error) {
        console.error("Failed to fetch user profile:", error);
      }
    };

    void fetchProfile();
  }, [open, member.id, member]);

  const handleCopyUsername = async () => {
    await navigator.clipboard.writeText(fullProfile.username);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSendMessage = () => {
    setOpen(false);
    window.location.href = `/channels/me/${member.id}`;
  };

  const handleAddFriend = async () => {
    try {
      const response = await fetch(`/api/friends/request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: member.id }),
      });
      if (response.ok) {
        // Show success feedback - could use toast
        console.log("Friend request sent");
      } else {
        const data = await response.json();
        console.error("Failed to send friend request:", data.error);
      }
    } catch (error) {
      console.error("Failed to send friend request:", error);
    }
  };

  const isOwner = serverId && fullProfile.isOwner;
  const isCurrentUser = currentUser?.id === member.id;

  const renderBadges = () => {
    if (!fullProfile.badges || fullProfile.badges.length === 0) return null;

    const badges = getBadgesByPriority(fullProfile.badges as BadgeId[]);

    return (
      <div className="flex items-center gap-1 flex-wrap mt-2">
        {badges.slice(0, 6).map((badge) => {
          const IconComponent = badge.icon;
          return (
            <div
              key={badge.id}
              className="w-6 h-6 rounded-md flex items-center justify-center"
              style={{ backgroundColor: `${badge.color}20` }}
              title={badge.name}
            >
              <IconComponent className="w-3.5 h-3.5" style={{ color: badge.color }} />
            </div>
          );
        })}
        {badges.length > 6 && (
          <div className="w-6 h-6 rounded-md bg-[#222222] flex items-center justify-center text-xs text-[#888888]">
            +{badges.length - 6}
          </div>
        )}
      </div>
    );
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {children}
      </PopoverTrigger>
      <PopoverContent
        side={side}
        align={align}
        sideOffset={8}
        className="w-[340px] p-0 bg-[#111111] border-[#222222] rounded-xl overflow-hidden shadow-xl"
      >
        {/* Banner */}
        <div
          className="h-16 relative"
          style={{
            background: fullProfile.banner
              ? `url(${fullProfile.banner}) center/cover`
              : `linear-gradient(135deg, #8B5CF6 0%, #6366F1 100%)`,
          }}
        />

        {/* Profile Content */}
        <div className="px-4 pb-4 relative">
          {/* Avatar */}
          <div className="absolute -top-8 left-4">
            <div className="relative">
              <Avatar className="w-20 h-20 border-4 border-[#111111]">
                <AvatarImage src={fullProfile.avatar || undefined} />
                <AvatarFallback className="bg-[#8B5CF6] text-white text-2xl">
                  {(fullProfile.displayName || fullProfile.username).charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div
                className="absolute bottom-1 right-1 w-5 h-5 rounded-full border-4 border-[#111111]"
                style={{ backgroundColor: statusColors[fullProfile.status] }}
              />
            </div>
          </div>

          {/* Action Buttons - hide for own profile */}
          {!isCurrentUser && member.id && (
            <div className="flex justify-end gap-2 pt-2 mb-4">
              <button
                onClick={handleSendMessage}
                className="p-2 rounded-full bg-[#8B5CF6] hover:bg-[#7C3AED] text-white transition-colors"
                title="Message"
              >
                <MessageSquare className="w-4 h-4" />
              </button>
              <button
                onClick={handleAddFriend}
                className="p-2 rounded-full bg-[#1a1a1a] hover:bg-[#222222] text-white transition-colors"
                title="Add Friend"
              >
                <UserPlus className="w-4 h-4" />
              </button>
              <button
                className="p-2 rounded-full bg-[#1a1a1a] hover:bg-[#222222] text-white transition-colors"
                title="More"
              >
                <MoreHorizontal className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* User Info Card */}
          <div className={cn("bg-[#0a0a0a] rounded-lg p-3", isCurrentUser ? "mt-14" : "mt-2")}>
            {/* Name & Username */}
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-bold text-white">
                {fullProfile.displayName || fullProfile.username}
              </h3>
              {isOwner && <Crown className="w-4 h-4 text-[#F59E0B]" />}
              {fullProfile.isPremium && <Crown className="w-4 h-4 text-[#8B5CF6]" />}
            </div>
            <button
              onClick={handleCopyUsername}
              className="text-sm text-[#888888] hover:text-white flex items-center gap-1 transition-colors"
            >
              @{fullProfile.username}
              {copied ? (
                <Check className="w-3 h-3 text-[#23A559]" />
              ) : (
                <Copy className="w-3 h-3 opacity-0 group-hover:opacity-100" />
              )}
            </button>

            {/* Custom Status */}
            {fullProfile.customStatus && (
              <p className="text-sm text-[#b5bac1] mt-2">{fullProfile.customStatus}</p>
            )}

            {/* Badges */}
            {renderBadges()}

            {/* Divider */}
            {(fullProfile.bio || fullProfile.roles?.length) && (
              <div className="h-px bg-[#222222] my-3" />
            )}

            {/* Bio */}
            {fullProfile.bio && (
              <div className="mb-3">
                <h4 className="text-xs font-bold text-[#b5bac1] uppercase mb-1">About Me</h4>
                <p className="text-sm text-[#dcddde]">{fullProfile.bio}</p>
              </div>
            )}

            {/* Roles */}
            {fullProfile.roles && fullProfile.roles.length > 0 && (
              <div>
                <h4 className="text-xs font-bold text-[#b5bac1] uppercase mb-2">Roles</h4>
                <div className="flex flex-wrap gap-1">
                  {fullProfile.roles.map((role) => (
                    <div
                      key={role.id}
                      className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs"
                      style={{ 
                        backgroundColor: role.color ? `${role.color}20` : "#222222",
                        color: role.color || "#888888",
                      }}
                    >
                      <div
                        className="w-2.5 h-2.5 rounded-full"
                        style={{ backgroundColor: role.color || "#888888" }}
                      />
                      {role.name}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Member Since */}
            {fullProfile.joinedAt && (
              <div className="mt-3 pt-3 border-t border-[#222222]">
                <h4 className="text-xs font-bold text-[#b5bac1] uppercase mb-1">Member Since</h4>
                <p className="text-sm text-[#888888]">
                  {new Date(fullProfile.joinedAt).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </p>
              </div>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

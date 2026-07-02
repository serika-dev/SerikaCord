"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  MessageSquare,
  UserPlus,
  Copy,
  Check,
  CalendarDays,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { getBadgesByPriority } from "@/lib/constants/badges";
import { BadgeList, type BadgeId as UIBadgeId } from "@/components/ui/badges";

export interface ProfileCardUser {
  id: string;
  username: string;
  displayName?: string;
  avatar?: string | null;
  banner?: string | null;
  bio?: string | null;
  status?: "online" | "idle" | "dnd" | "offline";
  customStatus?: string | null;
  badges?: string[];
  roles?: Array<{ id: string; name: string; color?: string }>;
  joinedAt?: string | null;
  createdAt?: string | null;
  isPremium?: boolean;
  isOwner?: boolean;
  isFriend?: boolean;
  friendRequestSent?: boolean;
}

const STATUS_COLORS: Record<string, string> = {
  online: "#23A559",
  idle: "#F0B232",
  dnd: "#EF4444",
  offline: "#555555",
};

const STATUS_LABELS: Record<string, string> = {
  online: "Online",
  idle: "Idle",
  dnd: "Do Not Disturb",
  offline: "Offline",
};

interface ProfileCardProps {
  user: ProfileCardUser;
  /** Whether this card shows the signed-in user (hides message/add actions) */
  isCurrentUser?: boolean;
  /** Show the server-owner crown */
  showOwnerCrown?: boolean;
  /** Called after an action that should close a containing popup */
  onNavigate?: () => void;
  className?: string;
  /** Whether the current user is already friends with this user */
  isFriend?: boolean;
}

/**
 * The user profile widget. Pure presentational — reused by the member
 * popup, the self popup, and anywhere else a profile preview is needed.
 */
export function ProfileCard({
  user,
  isCurrentUser = false,
  showOwnerCrown = false,
  onNavigate,
  className,
  isFriend = false,
}: ProfileCardProps) {
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  const [friendRequestSent, setFriendRequestSent] = useState(user.friendRequestSent ?? false);

  const status = user.status ?? "offline";
  const displayName = user.displayName || user.username;

  const handleCopyUsername = async () => {
    try {
      await navigator.clipboard.writeText(user.username);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Could not copy username");
    }
  };

  const handleSendMessage = () => {
    onNavigate?.();
    router.push(`/dm/${user.id}`);
  };

  const handleAddFriend = async () => {
    try {
      const response = await fetch(`/api/friends/request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id }),
      });
      if (response.ok) {
        setFriendRequestSent(true);
        toast.success(`Friend request sent to ${displayName}`);
      } else {
        const data = await response.json().catch(() => null);
        toast.error(data?.error || "Failed to send friend request");
      }
    } catch {
      toast.error("Failed to send friend request. Check your connection.");
    }
  };

  const badges = user.badges?.length ? getBadgesByPriority(user.badges as string[]) : [];

  return (
    <div className={cn("w-[340px] rounded-xl overflow-hidden bg-[#0c0c10] border border-white/[0.06] shadow-2xl", className)}>
      {/* Banner — tall, Discord-profile style */}
      <div className="relative h-[120px]">
        {user.banner ? (
          <div
            className="absolute inset-0 bg-cover bg-center"
            style={{ backgroundImage: `url(${user.banner})` }}
          />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-[#8B5CF6] via-[#7C3AED] to-[#4F46E5]" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-[#0c0c10]/70 via-transparent to-transparent" />
      </div>

      <div className="relative px-4 pb-4">
        {/* Avatar overlapping the banner */}
        <div className="absolute -top-11 left-4">
          <div className="relative">
            <Avatar className="w-[88px] h-[88px] border-[5px] border-[#0c0c10] shadow-lg">
              <AvatarImage src={user.avatar || undefined} />
              <AvatarFallback className="bg-[#8B5CF6] text-white text-3xl">
                {displayName.charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div
              className="absolute bottom-1 right-1 w-6 h-6 rounded-full border-[4px] border-[#0c0c10]"
              style={{ backgroundColor: STATUS_COLORS[status] }}
              title={STATUS_LABELS[status]}
            />
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-3 min-h-[44px]">
          {!isCurrentUser && user.id && (
            <>
              <button
                onClick={handleSendMessage}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] active:scale-[0.97] text-white text-sm font-medium transition-all"
              >
                <MessageSquare className="w-4 h-4" />
                Message
              </button>
              {!isFriend && (
                <button
                  onClick={handleAddFriend}
                  disabled={friendRequestSent}
                  aria-label="Add friend"
                  title={friendRequestSent ? "Friend request sent" : "Add Friend"}
                  className="p-2 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] active:scale-[0.97] text-white transition-all disabled:opacity-50"
                >
                  {friendRequestSent ? <Check className="w-4 h-4 text-[#23A559]" /> : <UserPlus className="w-4 h-4" />}
                </button>
              )}
            </>
          )}
        </div>

        {/* Identity */}
        <div className="mt-4">
          <div className="flex items-center gap-2">
            <h3 className="text-xl font-bold text-white leading-tight truncate">{displayName}</h3>
            {showOwnerCrown && user.isOwner && (
              <span title="Server Owner" className="shrink-0 text-[#F59E0B]">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M5 16L3 5l5.5 5L12 4l3.5 6L21 5l-2 11H5zm14 3c0 .6-.4 1-1 1H6c-.6 0-1-.4-1-1v-1h14v1z"/></svg>
              </span>
            )}
          </div>
          <button
            onClick={handleCopyUsername}
            className="group flex items-center gap-1.5 text-sm text-[#9a9aad] hover:text-white transition-colors"
            title="Copy username"
          >
            @{user.username}
            {copied ? (
              <Check className="w-3 h-3 text-[#23A559]" />
            ) : (
              <Copy className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
            )}
          </button>
          {user.customStatus && (
            <p className="text-sm text-[#c8c8d8] mt-1.5">{user.customStatus}</p>
          )}
        </div>

        {/* Badges */}
        {badges.length > 0 && (
          <div className="mt-3">
            <BadgeList badges={badges.map((b) => b.id) as UIBadgeId[]} size="sm" />
          </div>
        )}

        {/* Details card */}
        {(user.bio || (user.roles?.length ?? 0) > 0 || user.joinedAt || user.createdAt) && (
          <div className="mt-4 rounded-lg bg-white/[0.03] border border-white/[0.05] p-3 space-y-3">
            {user.bio && (
              <div>
                <h4 className="text-[11px] font-bold text-[#9a9aad] uppercase tracking-wide mb-1">About Me</h4>
                <p className="text-sm text-[#e2e2ee] whitespace-pre-wrap break-words">{user.bio}</p>
              </div>
            )}

            {user.roles && user.roles.length > 0 && (
              <div>
                <h4 className="text-[11px] font-bold text-[#9a9aad] uppercase tracking-wide mb-1.5">Roles</h4>
                <div className="flex flex-wrap gap-1">
                  {user.roles.map((role) => (
                    <span
                      key={role.id}
                      className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs border border-white/[0.06]"
                      style={{
                        backgroundColor: role.color ? `${role.color}1a` : "rgba(255,255,255,0.04)",
                        color: role.color || "#b8b8c8",
                      }}
                    >
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: role.color || "#888888" }}
                      />
                      {role.name}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {(user.joinedAt || user.createdAt) && (
              <div className="flex items-center gap-4 text-sm text-[#9a9aad]">
                <CalendarDays className="w-4 h-4 shrink-0" />
                <div className="flex flex-wrap gap-x-4 gap-y-0.5">
                  {user.createdAt && (
                    <span title="Account created">
                      Joined SerikaCord{" "}
                      {new Date(user.createdAt).toLocaleDateString("en-US", { month: "short", year: "numeric" })}
                    </span>
                  )}
                  {user.joinedAt && (
                    <span title="Joined this server">
                      Member since{" "}
                      {new Date(user.joinedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

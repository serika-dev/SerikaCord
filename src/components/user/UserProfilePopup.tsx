"use client";

import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  ChevronRight,
  Pencil,
  Circle,
  Moon,
  MinusCircle,
  EyeOff,
  Copy,
  Users,
  Crown,
  Check,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getBadgesByPriority, type BadgeId } from "@/lib/constants/badges";

interface UserProfilePopupProps {
  children: React.ReactNode;
  onOpenSettings?: () => void;
}

const statusOptions = [
  { value: "online", label: "Online", icon: Circle, color: "#8B5CF6" },
  { value: "idle", label: "Idle", icon: Moon, color: "#A78BFA" },
  { value: "dnd", label: "Do Not Disturb", icon: MinusCircle, color: "#EF4444" },
  { value: "offline", label: "Invisible", icon: EyeOff, color: "#555555" },
] as const;

type StatusValue = typeof statusOptions[number]['value'];

export function UserProfilePopup({ children, onOpenSettings }: UserProfilePopupProps) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [showStatusMenu, setShowStatusMenu] = useState(false);
  const [copied, setCopied] = useState(false);
  const [currentStatus, setCurrentStatus] = useState<StatusValue>((user?.status as StatusValue) || "online");

  const handleCopyUserId = async () => {
    if (user?.id) {
      await navigator.clipboard.writeText(user.id);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleStatusChange = async (status: StatusValue) => {
    setCurrentStatus(status);
    setShowStatusMenu(false);
    try {
      await fetch("/api/users/me", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
    } catch (error) {
      console.error("Failed to update status:", error);
    }
  };

  const handleEditProfile = () => {
    setOpen(false);
    onOpenSettings?.();
  };

  const currentStatusOption = statusOptions.find(s => s.value === currentStatus) || statusOptions[0];

  const renderBadges = () => {
    if (!user?.badges || user.badges.length === 0) return null;

    const badges = getBadgesByPriority(user.badges as BadgeId[]);

    return (
      <div className="flex items-center gap-1.5 flex-wrap">
        {badges.slice(0, 8).map((badge) => {
          const IconComponent = badge.icon;
          return (
            <div
              key={badge.id}
              className="w-6 h-6 rounded flex items-center justify-center"
              style={{ backgroundColor: `${badge.color}20` }}
              title={`${badge.name}: ${badge.description}`}
            >
              <IconComponent className="w-3.5 h-3.5" style={{ color: badge.color }} />
            </div>
          );
        })}
        {badges.length > 8 && (
          <span className="text-xs text-[#888888]">+{badges.length - 8}</span>
        )}
      </div>
    );
  };

  if (!user) return <>{children}</>;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {children}
      </PopoverTrigger>
      <PopoverContent 
        side="top" 
        align="start"
        sideOffset={8}
        className="w-[300px] p-0 bg-[#111111] border border-[#222222] rounded-lg overflow-hidden shadow-xl"
      >
        {/* Banner */}
        <div
          className="h-[60px] relative"
          style={{
            background: user.banner
              ? `url(${user.banner}) center/cover`
              : `linear-gradient(135deg, #8B5CF6 0%, #6366F1 100%)`,
          }}
        />

        {/* Avatar and Info */}
        <div className="px-3 pb-3 relative">
          {/* Avatar */}
          <div className="absolute -top-8 left-3">
            <div className="relative">
              <Avatar className="w-[72px] h-[72px] border-[5px] border-[#111111]">
                <AvatarImage src={user.avatar} />
                <AvatarFallback className="bg-[#8B5CF6] text-white text-xl">
                  {user.displayName?.charAt(0).toUpperCase() || "?"}
                </AvatarFallback>
              </Avatar>
              <div
                className="absolute bottom-0.5 right-0.5 w-5 h-5 rounded-full border-[3px] border-[#111111]"
                style={{ backgroundColor: currentStatusOption.color }}
              />
            </div>
          </div>

          {/* User Info */}
          <div className="pt-11">
            <div className="bg-[#0a0a0a] rounded-lg p-3">
              {/* Name */}
              <div className="mb-2">
                <h3 className="text-lg font-bold text-white leading-tight">
                  {user.displayName || user.username}
                </h3>
                <span className="text-sm text-[#888888]">{user.username}</span>
              </div>

              {/* Badges */}
              {user.badges && user.badges.length > 0 && (
                <>
                  <div className="h-px bg-[#222222] my-2" />
                  <div className="text-xs text-[#888888] uppercase font-semibold mb-1.5">
                    Badges
                  </div>
                  {renderBadges()}
                </>
              )}

              {/* Custom status */}
              {user.customStatus && (
                <p className="text-sm text-[#dcddde] mb-2">{user.customStatus}</p>
              )}

              {/* Bio */}
              {user.bio && (
                <p className="text-sm text-[#dcddde] mb-2 line-clamp-3">{user.bio}</p>
              )}

              {/* View Full Bio */}
              {user.bio && user.bio.length > 100 && (
                <button className="text-sm text-[#888888] hover:text-white transition-colors mb-2">
                  View Full Bio
                </button>
              )}

              <div className="h-px bg-[#222222] my-2" />

              {/* Member Since */}
              <div className="text-xs text-[#888888] uppercase font-semibold mb-1">
                SerikaCord Member Since
              </div>
              <p className="text-sm text-[#dcddde]">
                {user.createdAt
                  ? new Date(user.createdAt).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })
                  : "Unknown"}
              </p>
            </div>

            {/* Actions */}
            <div className="mt-2 space-y-0.5">
              {/* Edit Profiles */}
              <button
                onClick={handleEditProfile}
                className="w-full flex items-center gap-3 px-3 py-2 rounded hover:bg-[#1a1a1a] transition-colors text-left"
              >
                <Pencil className="w-4 h-4 text-[#888888]" />
                <span className="text-sm text-[#dcddde]">Edit Profiles</span>
              </button>

              {/* Status Selector */}
              <div className="relative">
                <button
                  onClick={() => setShowStatusMenu(!showStatusMenu)}
                  className="w-full flex items-center justify-between px-3 py-2 rounded hover:bg-[#1a1a1a] transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div
                      className="w-4 h-4 rounded-full flex items-center justify-center"
                      style={{ backgroundColor: currentStatusOption.color }}
                    >
                      {currentStatusOption.value === "dnd" && (
                        <div className="w-2 h-0.5 bg-[#111111] rounded" />
                      )}
                    </div>
                    <span className="text-sm text-[#dcddde]">{currentStatusOption.label}</span>
                  </div>
                  <ChevronRight className={cn(
                    "w-4 h-4 text-[#888888] transition-transform",
                    showStatusMenu && "rotate-90"
                  )} />
                </button>

                {/* Status submenu */}
                {showStatusMenu && (
                  <div className="absolute left-full top-0 ml-1 w-[180px] bg-[#0a0a0a] border border-[#222222] rounded-lg overflow-hidden shadow-xl z-10">
                    {statusOptions.map((status) => (
                      <button
                        key={status.value}
                        onClick={() => handleStatusChange(status.value)}
                        className="w-full flex items-center justify-between px-3 py-2 hover:bg-[#1a1a1a] transition-colors"
                      >
                        <div className="flex items-center gap-2">
                          <div
                            className="w-3 h-3 rounded-full"
                            style={{ backgroundColor: status.color }}
                          />
                          <span className="text-sm text-[#dcddde]">{status.label}</span>
                        </div>
                        {currentStatus === status.value && (
                          <Check className="w-4 h-4 text-[#8B5CF6]" />
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="h-px bg-[#222222] my-1" />

              {/* Switch Accounts */}
              <button className="w-full flex items-center justify-between px-3 py-2 rounded hover:bg-[#1a1a1a] transition-colors">
                <div className="flex items-center gap-3">
                  <Users className="w-4 h-4 text-[#888888]" />
                  <span className="text-sm text-[#dcddde]">Switch Accounts</span>
                </div>
                <ChevronRight className="w-4 h-4 text-[#888888]" />
              </button>

              {/* Copy User ID */}
              <button
                onClick={handleCopyUserId}
                className="w-full flex items-center gap-3 px-3 py-2 rounded hover:bg-[#1a1a1a] transition-colors text-left"
              >
                {copied ? (
                  <Check className="w-4 h-4 text-[#8B5CF6]" />
                ) : (
                  <Copy className="w-4 h-4 text-[#888888]" />
                )}
                <span className="text-sm text-[#dcddde]">
                  {copied ? "Copied!" : "Copy User ID"}
                </span>
              </button>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

"use client";

import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useIsMobile } from "@/hooks/useIsMobile";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogTrigger,
} from "@/components/ui/dialog";
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
  Check,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { BadgeList, type BadgeId as UIBadgeId } from "@/components/ui/badges";

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
  const { user, refresh, updateUser } = useAuth();
  const [open, setOpen] = useState(false);
  const [showStatusMenu, setShowStatusMenu] = useState(false);
  const [copied, setCopied] = useState(false);

  // Use user status directly, fallback to online
  const currentStatus: StatusValue = (user?.status as StatusValue) || "online";

  const handleCopyUserId = async () => {
    if (user?.id) {
      await navigator.clipboard.writeText(user.id);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleStatusChange = async (status: StatusValue) => {
    // Immediately update local state for instant UI feedback
    updateUser({ status });
    setShowStatusMenu(false);
    
    try {
      const response = await fetch("/api/users/me", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!response.ok) {
        // If update failed, refresh to get the correct status back
        await refresh();
      }
    } catch (error) {
      console.error("Failed to update status:", error);
      // Refresh to restore correct state
      await refresh();
    }
  };

  const handleEditProfile = () => {
    setOpen(false);
    onOpenSettings?.();
  };

  const currentStatusOption = statusOptions.find(s => s.value === currentStatus) || statusOptions[0];
  const isMobile = useIsMobile();

  const renderBadges = () => {
    if (!user?.badges || user.badges.length === 0) return null;
    return <BadgeList badges={user.badges as UIBadgeId[]} size="sm" maxDisplay={user.badges.length} expandable={false} />;
  };

  if (!user) return <>{children}</>;

  const renderProfileCard = () => (
    <>
      {/* Banner */}
      <div
        className={cn("relative", isMobile ? "h-28" : "h-[60px]")}
        style={{
          background: user.banner
            ? `url(${user.banner}) center/cover`
            : `linear-gradient(135deg, var(--accent-color) 0%, rgba(99,102,241,0.8) 100%)`,
        }}
      />

      {/* Avatar and Info */}
      <div className={cn("relative", isMobile ? "px-4 pb-4" : "px-3 pb-3")}>
        {/* Avatar */}
        <div className="absolute -top-8 left-3">
          <div className="relative">
            <Avatar className={cn("border-[5px] border-[#111111]", isMobile ? "w-24 h-24" : "w-[72px] h-[72px]")}>
              <AvatarImage src={user.avatar} />
              <AvatarFallback className="bg-[var(--accent-color)] text-white text-xl">
                {user.displayName?.charAt(0).toUpperCase() || "?"}
              </AvatarFallback>
            </Avatar>
            <div
              className={cn("absolute rounded-full border-[3px] border-[#111111]", isMobile ? "bottom-1 right-1 w-7 h-7" : "bottom-0.5 right-0.5 w-5 h-5")}
              style={{ backgroundColor: currentStatusOption.color }}
            />
          </div>
        </div>

        {/* User Info */}
        <div className={cn(isMobile ? "pt-20" : "pt-11")}>
          <div className="bg-[#0a0a0a] rounded-lg p-3">
            {/* Name */}
            <div className="mb-2">
              <h3 className={cn("font-bold text-white leading-tight", isMobile ? "text-2xl" : "text-lg")}>
                {user.displayName || user.username}
              </h3>
              <span className="text-sm text-[#888888]">{user.username}</span>
              {user.settings?.advanced?.developerMode && user.id && (
                <p className="mt-1 text-[10px] font-mono text-[#666666]">ID: {user.id}</p>
              )}
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
              <p className={cn("text-[#dcddde] mb-2", isMobile ? "text-base line-clamp-6" : "text-sm line-clamp-3")}>{user.bio}</p>
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

            {/* Status Selector - Using Popover to prevent overflow */}
            <Popover open={showStatusMenu} onOpenChange={setShowStatusMenu}>
              <PopoverTrigger asChild>
                <button
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
              </PopoverTrigger>
              <PopoverContent
                side={isMobile ? "bottom" : "right"}
                align="start"
                className="w-[180px] p-0 bg-[#0a0a0a] border-[#222222] shadow-xl"
              >
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
                      <Check className="w-4 h-4 text-[var(--accent-color)]" />
                    )}
                  </button>
                ))}
              </PopoverContent>
            </Popover>

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
                <Check className="w-4 h-4 text-[var(--accent-color)]" />
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
    </>
  );

  return (
    <>
      {isMobile ? (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>{children}</DialogTrigger>
          <DialogContent
            className="!fixed !inset-x-0 !bottom-0 !top-auto !left-0 !translate-x-0 !translate-y-0 !max-w-full p-0 rounded-t-2xl bg-[#111111] border border-[#222222] shadow-2xl overflow-hidden max-h-[85vh] flex flex-col"
            showCloseButton={false}
          >
            <div className="w-12 h-1 bg-[#444444] rounded-full mt-3 mb-1 mx-auto shrink-0" />
            <div className="overflow-y-auto">{renderProfileCard()}</div>
          </DialogContent>
        </Dialog>
      ) : (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>{children}</PopoverTrigger>
          <PopoverContent
            side="top"
            align="start"
            sideOffset={8}
            className="w-[300px] p-0 bg-[#111111] border border-[#222222] rounded-lg overflow-hidden shadow-xl"
          >
            {renderProfileCard()}
          </PopoverContent>
        </Popover>
      )}
    </>
  );
}

"use client";

import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useCurrentTime } from "@/hooks/useCurrentTime";
import { useIsMobile } from "@/hooks/useIsMobile";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { SwitchAccountsDialog } from "@/components/dialogs/SwitchAccountsDialog";
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
  Clock,
} from "lucide-react";
import { cn, cdnImage } from "@/lib/utils";
import { BadgeList, type BadgeId as UIBadgeId } from "@/components/ui/badges";
import { MarkdownRenderer } from "@/components/chat/MarkdownRenderer";
import { getProfileBannerStyle, getProfileBackgroundStyle } from "@/lib/userDisplayNameStyle";
import { useGT } from "gt-next";
import { statusLabelInvisible } from "@/lib/statusLabels";

interface UserProfilePopupProps {
  children: React.ReactNode;
  onOpenSettings?: () => void;
}

const statusOptions = [
  { value: "online", label: "Online", icon: Circle, color: "#23A55A" },
  { value: "idle", label: "Idle", icon: Moon, color: "#F0B232" },
  { value: "dnd", label: "Do Not Disturb", icon: MinusCircle, color: "#F23F43" },
  { value: "offline", label: "Invisible", icon: EyeOff, color: "#80848E" },
] as const;

type StatusValue = typeof statusOptions[number]['value'];

export function UserProfilePopup({ children, onOpenSettings }: UserProfilePopupProps) {
  const { user, refresh, updateUser } = useAuth();
  const localTime = useCurrentTime(user?.timezone);
  const gt = useGT();
  const [open, setOpen] = useState(false);
  const [showStatusMenu, setShowStatusMenu] = useState(false);
  const [copied, setCopied] = useState(false);
  const [editingStatus, setEditingStatus] = useState(false);
  const [statusText, setStatusText] = useState("");
  const [showSwitchAccounts, setShowSwitchAccounts] = useState(false);

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
      // On success, don't refresh - we already updated local state
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

  const handleSaveStatus = async () => {
    const trimmed = statusText.trim();
    updateUser({ customStatus: trimmed || undefined });
    setEditingStatus(false);
    try {
      const response = await fetch("/api/users/me", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customStatus: trimmed || null }),
      });
      if (!response.ok) {
        await refresh();
      }
      // On success, don't refresh - we already updated local state
    } catch (error) {
      console.error("Failed to update custom status:", error);
      await refresh();
    }
  };

  const startEditingStatus = () => {
    setStatusText(user?.customStatus || "");
    setEditingStatus(true);
  };

  const currentStatusOption = statusOptions.find(s => s.value === currentStatus) || statusOptions[0];
  const isMobile = useIsMobile();

  const renderBadges = () => {
    if (!user?.badges || user.badges.length === 0) return null;
    return <BadgeList badges={user.badges as UIBadgeId[]} size="sm" maxDisplay={user.badges.length} expandable={false} />;
  };

  if (!user) return <>{children}</>;

  const cardBgStyle = getProfileBackgroundStyle(user.customization, { opaque: true });
  const hasCardBg = Object.keys(cardBgStyle).length > 0;

  const renderProfileCard = () => (
    <>
      {/* Banner */}
      <div
        className={cn("relative", isMobile ? "h-28" : "h-[60px]")}
        style={
          user.banner
            ? { background: `url(${user.banner}) center/cover` }
            : (user.customization?.profileGradient && user.customization.profileGradient.length >= 2) || user.customization?.profileColor
              ? getProfileBannerStyle(user.customization)
              : { background: `linear-gradient(135deg, var(--accent-color) 0%, rgba(99,102,241,0.8) 100%)` }
        }
      />

      {/* Avatar and Info */}
      <div className={cn("relative", isMobile ? "px-4 pb-4" : "px-3 pb-3")}>
        {/* Avatar */}
        <div className="absolute -top-8 left-3">
          <div className="relative">
            <Avatar className={cn("border-[5px] border-[#111111]", isMobile ? "w-24 h-24" : "w-[72px] h-[72px]")}>
              <AvatarImage src={cdnImage(user.avatar)} />
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
              {user.pronouns && (
                <div className="text-xs text-[#888888] mt-0.5">{user.pronouns}</div>
              )}
              {user.settings?.advanced?.developerMode && user.id && (
                <p className="mt-1 text-[10px] font-mono text-[#666666]">ID: {user.id}</p>
              )}
            </div>

            {/* Badges */}
            {user.badges && user.badges.length > 0 && (
              <>
                <div className="h-px bg-[#222222] my-2" />
                <div className="text-xs text-[#888888] uppercase font-semibold mb-1.5">
                  {gt("Badges")}
                </div>
                {renderBadges()}
              </>
            )}

            {/* Custom status */}
            {user.customStatus && (
              <div className="text-sm text-[#dcddde] mb-2">
                <MarkdownRenderer content={user.customStatus} />
              </div>
            )}

            {/* Bio */}
            {user.bio && (
              <div className={cn("text-[#dcddde] mb-2 whitespace-pre-wrap break-words", isMobile ? "text-base line-clamp-6" : "text-sm line-clamp-3")}>
                <MarkdownRenderer content={user.bio} />
              </div>
            )}

            {/* View Full Bio */}
            {user.bio && user.bio.length > 100 && (
              <button className="text-sm text-[#888888] hover:text-white transition-colors mb-2">
                {gt("View Full Bio")}
              </button>
            )}

            {/* Current Time */}
            {user.showTimezone && user.timezone && localTime && (
              <div className="flex items-center gap-1.5 mb-2 text-sm text-[#dcddde]">
                <Clock className="w-3.5 h-3.5 text-[#888888]" />
                <span>
                  {localTime}
                </span>
                <span className="text-[#555555]">•</span>
                <span className="text-xs text-[#888888]">{user.timezone}</span>
              </div>
            )}

            <div className="h-px bg-[#222222] my-2" />

            {/* Member Since */}
            <div className="text-xs text-[#888888] uppercase font-semibold mb-1">
              {gt("SerikaCord Member Since")}
            </div>
            <p className="text-sm text-[#dcddde]">
              {user.createdAt
                ? new Date(user.createdAt).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })
                : gt("Unknown")}
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
              <span className="text-sm text-[#dcddde]">{gt("Edit Profiles")}</span>
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
                    <span className="text-sm text-[#dcddde]">{statusLabelInvisible(currentStatus, gt)}</span>
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
                      <span className="text-sm text-[#dcddde]">{statusLabelInvisible(status.value, gt)}</span>
                    </div>
                    {currentStatus === status.value && (
                      <Check className="w-4 h-4 text-[var(--accent-color)]" />
                    )}
                  </button>
                ))}
              </PopoverContent>
            </Popover>

            {/* Custom Status Editor */}
            {editingStatus ? (
              <div className="px-3 py-2 space-y-2">
                <input
                  type="text"
                  value={statusText}
                  onChange={(e) => setStatusText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSaveStatus();
                    if (e.key === "Escape") setEditingStatus(false);
                  }}
                  placeholder={gt("What's on your mind?")}
                  autoFocus
                  maxLength={200}
                  className="w-full px-2 py-1.5 rounded bg-[#1a1a1a] text-sm text-[#dcddde] placeholder:text-[#666] border border-[#333] focus:outline-none focus:border-[var(--accent-color)]"
                />
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleSaveStatus}
                    className="px-3 py-1 rounded bg-[var(--accent-color)] text-white text-xs hover:brightness-110 transition"
                  >
                    {gt("Save")}
                  </button>
                  <button
                    onClick={() => setEditingStatus(false)}
                    className="px-3 py-1 rounded bg-[#1a1a1a] text-[#888] text-xs hover:bg-[#222] transition"
                  >
                    {gt("Cancel")}
                  </button>
                  {user?.customStatus && (
                    <button
                      onClick={async () => {
                        setStatusText("");
                        setEditingStatus(false);
                        updateUser({ customStatus: undefined });
                        try {
                          const response = await fetch("/api/users/me", {
                            method: "PUT",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ customStatus: null }),
                          });
                          if (!response.ok) {
                            await refresh();
                          }
                        } catch {
                          await refresh();
                        }
                      }}
                      className="px-3 py-1 rounded text-[#888] text-xs hover:text-red-400 transition ml-auto"
                    >
                      {gt("Clear")}
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <button
                onClick={startEditingStatus}
                className="w-full flex items-center gap-3 px-3 py-2 rounded hover:bg-[#1a1a1a] transition-colors text-left"
              >
                <Pencil className="w-4 h-4 text-[#888888]" />
                <span className="text-sm text-[#dcddde]">
                  {user?.customStatus ? gt("Edit Custom Status") : gt("Set Custom Status")}
                </span>
              </button>
            )}

            <div className="h-px bg-[#222222] my-1" />

            {/* Switch Accounts */}
            <button
              onClick={() => {
                setOpen(false);
                setShowSwitchAccounts(true);
              }}
              className="w-full flex items-center justify-between px-3 py-2 rounded hover:bg-[#1a1a1a] transition-colors"
            >
              <div className="flex items-center gap-3">
                <Users className="w-4 h-4 text-[#888888]" />
                <span className="text-sm text-[#dcddde]">{gt("Switch Accounts")}</span>
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
                {copied ? gt("Copied!") : gt("Copy User ID")}
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
            className={cn(
              "!fixed !inset-x-0 !bottom-0 !top-auto !left-0 !translate-x-0 !translate-y-0 !max-w-full p-0 rounded-t-2xl border border-[#222222] shadow-2xl overflow-hidden max-h-[85vh] flex flex-col",
              !hasCardBg && "bg-[#111111]"
            )}
            style={hasCardBg ? cardBgStyle : undefined}
            showCloseButton={false}
          >
            <div className="w-12 h-1 bg-[#444444] rounded-full mt-3 mb-1 mx-auto shrink-0" />
            <div className="overflow-y-auto flex-1 min-h-0">{renderProfileCard()}</div>
          </DialogContent>
        </Dialog>
      ) : (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>{children}</PopoverTrigger>
          <PopoverContent
            side="top"
            align="start"
            sideOffset={8}
            className={cn(
              "w-[300px] p-0 border border-[#222222] rounded-lg overflow-hidden shadow-xl",
              !hasCardBg && "bg-[#111111]"
            )}
            style={hasCardBg ? cardBgStyle : undefined}
          >
            {renderProfileCard()}
          </PopoverContent>
        </Popover>
      )}
      <SwitchAccountsDialog open={showSwitchAccounts} onOpenChange={setShowSwitchAccounts} />
    </>
  );
}

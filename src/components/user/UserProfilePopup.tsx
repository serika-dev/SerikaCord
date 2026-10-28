"use client";

import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useCurrentTime } from "@/hooks/useCurrentTime";
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
  Copy,
  Users,
  Check,
  Clock,
  Smile,
  Target,
  X,
} from "lucide-react";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { useFocusMode } from "@/hooks/useFocusMode";
import { cn, cdnImage } from "@/lib/utils";
import { BadgeList, type BadgeId as UIBadgeId } from "@/components/ui/badges";
import { MarkdownRenderer } from "@/components/chat/MarkdownRenderer";
import { getProfileBannerStyle, getProfileBackgroundStyle } from "@/lib/userDisplayNameStyle";
import { useGT } from "gt-next";
import { statusLabelInvisible } from "@/lib/statusLabels";
import { toServerStatus } from "@/lib/presenceChoice";
import dynamic from "next/dynamic";
import { MountWhenOpened } from "@/components/ui/MountWhenOpened";
import { CustomStatusLine } from "@/components/user/CustomStatus";
import { hasCustomStatus } from "@/lib/social/customStatus";
import { StatusBadge, StatusIcon } from "@/components/user/StatusBadge";

// Only opened from the "Switch Accounts" row; keep it out of the sidebar bundle.
const SwitchAccountsDialog = dynamic(() => import("@/components/dialogs/SwitchAccountsDialog").then((m) => m.SwitchAccountsDialog), { ssr: false });
const CustomStatusDialog = dynamic(() => import("@/components/user/CustomStatusDialog").then((m) => m.CustomStatusDialog), { ssr: false });

interface UserProfilePopupProps {
  children: React.ReactNode;
  onOpenSettings?: () => void;
}

// "offline" is the picker's Invisible (see lib/presenceChoice); `badge` is the
// shape StatusBadge draws for it.
const statusOptions = [
  { value: "online", badge: "online" },
  { value: "idle", badge: "idle" },
  { value: "dnd", badge: "dnd" },
  { value: "offline", badge: "invisible" },
] as const;

type StatusValue = typeof statusOptions[number]['value'];

export function UserProfilePopup({ children }: UserProfilePopupProps) {
  const { user, refresh, updateUser } = useAuth();
  const localTime = useCurrentTime(user?.timezone);
  const gt = useGT();
  const [open, setOpen] = useState(false);
  const [showStatusMenu, setShowStatusMenu] = useState(false);
  const [copied, setCopied] = useState(false);
  const [customStatusOpen, setCustomStatusOpen] = useState(false);
  const [showSwitchAccounts, setShowSwitchAccounts] = useState(false);
  const [showFullBio, setShowFullBio] = useState(false);

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
        // Invisible ("offline" in the UI) is stored as "invisible" so it
        // survives a reload instead of being promoted back to online.
        body: JSON.stringify({ status: toServerStatus(status) }),
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
    window.dispatchEvent(new CustomEvent('openUserSettings', { detail: { tab: 'profiles' } }));
  };

  const clearCustomStatus = async () => {
    updateUser({ customStatus: undefined, customization: { ...(user?.customization || {}), customStatusEmoji: null, customStatusExpiresAt: null } });
    try {
      const response = await fetch("/api/users/me", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customStatus: null, customStatusEmoji: null, customStatusExpiresAt: null }),
      });
      if (!response.ok) await refresh();
    } catch {
      await refresh();
    }
  };

  const hasStatus = hasCustomStatus(user?.customStatus, user?.customization);

  const currentStatusOption = statusOptions.find(s => s.value === currentStatus) || statusOptions[0];
  const isMobile = useIsMobile();
  const { focusMode, setFocusMode } = useFocusMode();

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
            <Avatar className={cn("border-[5px] border-[var(--border-subtle)]", isMobile ? "w-24 h-24" : "w-[72px] h-[72px]")}>
              <AvatarImage src={cdnImage(user.avatar)} />
              <AvatarFallback className="bg-[var(--accent-color)] text-white text-xl">
                {user.displayName?.charAt(0).toUpperCase() || "?"}
              </AvatarFallback>
            </Avatar>
            <StatusBadge
              status={currentStatusOption.badge}
              size={isMobile ? 20 : 14}
              ring={isMobile ? 4 : 3}
              ringColor="var(--border-subtle)"
              className={cn("absolute", isMobile ? "bottom-1 right-1" : "bottom-0.5 right-0.5")}
            />
          </div>
        </div>

        {/* User Info */}
        <div className={cn(isMobile ? "pt-20" : "pt-11")}>
          <div className="bg-[var(--bg-app)] rounded-lg p-3">
            {/* Name */}
            <div className="mb-2">
              <h3 className={cn("font-bold text-[var(--text-primary)] leading-tight", isMobile ? "text-2xl" : "text-lg")}>
                {user.displayName || user.username}
              </h3>
              <span className="text-sm text-[var(--text-secondary)]">{user.username}</span>
              {user.pronouns && (
                <div className="text-xs text-[var(--text-secondary)] mt-0.5">{user.pronouns}</div>
              )}
              {user.settings?.advanced?.developerMode && user.id && (
                <p className="mt-1 text-[10px] font-mono text-[var(--text-muted)]">ID: {user.id}</p>
              )}
            </div>

            {/* Badges */}
            {user.badges && user.badges.length > 0 && (
              <>
                <div className="h-px bg-[var(--app-surface-alt)] my-2" />
                <div className="text-xs text-[var(--text-secondary)] uppercase font-semibold mb-1.5">
                  {gt("Badges")}
                </div>
                {renderBadges()}
              </>
            )}

            {/* Custom status */}
            {hasStatus && (
              <div className="text-sm text-[var(--text-primary)] mb-2">
                <CustomStatusLine
                  text={user.customStatus}
                  customization={user.customization}
                  emojiClassName="w-4 h-4"
                  renderText={(t) => <MarkdownRenderer content={t} />}
                />
              </div>
            )}

            {/* Bio */}
            {user.bio && (
              <div className={cn("text-[var(--text-primary)] mb-2 whitespace-pre-wrap break-words", isMobile ? "text-base" : "text-sm", !showFullBio && (isMobile ? "line-clamp-6" : "line-clamp-3"))}>
                <MarkdownRenderer content={user.bio} />
              </div>
            )}

            {/* View Full Bio */}
            {user.bio && user.bio.length > 100 && (
              <button
                type="button"
                onClick={() => setShowFullBio((v) => !v)}
                className="text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors mb-2"
              >
                {showFullBio ? gt("Show Less") : gt("View Full Bio")}
              </button>
            )}

            {/* Current Time */}
            {user.showTimezone && user.timezone && localTime && (
              <div className="flex items-center gap-1.5 mb-2 text-sm text-[var(--text-primary)]">
                <Clock className="w-3.5 h-3.5 text-[var(--text-secondary)]" />
                <span>
                  {localTime}
                </span>
                <span className="text-[var(--text-muted)]">•</span>
                <span className="text-xs text-[var(--text-secondary)]">{user.timezone}</span>
              </div>
            )}

            <div className="h-px bg-[var(--app-surface-alt)] my-2" />

            {/* Member Since */}
            <div className="text-xs text-[var(--text-secondary)] uppercase font-semibold mb-1">
              {gt("SerikaCord Member Since")}
            </div>
            <p className="text-sm text-[var(--text-primary)]">
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
              className="w-full flex items-center gap-3 px-3 py-2 rounded hover:bg-[var(--bg-hover)] transition-colors text-left"
            >
              <Pencil className="w-4 h-4 text-[var(--text-secondary)]" />
              <span className="text-sm text-[var(--text-primary)]">{gt("Edit Profiles")}</span>
            </button>

            {/* Status Selector - Using Popover to prevent overflow */}
            <Popover open={showStatusMenu} onOpenChange={setShowStatusMenu}>
              <PopoverTrigger asChild>
                <button
                  className="w-full flex items-center justify-between px-3 py-2 rounded hover:bg-[var(--bg-hover)] transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <StatusIcon status={currentStatusOption.badge} size={16} />
                    <span className="text-sm text-[var(--text-primary)]">{statusLabelInvisible(currentStatus, gt)}</span>
                  </div>
                  <ChevronRight className={cn(
                    "w-4 h-4 text-[var(--text-secondary)] transition-transform",
                    showStatusMenu && "rotate-90"
                  )} />
                </button>
              </PopoverTrigger>
              <PopoverContent
                side={isMobile ? "bottom" : "right"}
                align="start"
                className="w-[180px] p-0 bg-[var(--bg-app)] border-[var(--border-subtle)] shadow-xl"
              >
                {statusOptions.map((status) => (
                  <button
                    key={status.value}
                    onClick={() => handleStatusChange(status.value)}
                    className="w-full flex items-center justify-between px-3 py-2 hover:bg-[var(--bg-hover)] transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <StatusIcon status={status.badge} size={12} />
                      <span className="text-sm text-[var(--text-primary)]">{statusLabelInvisible(status.value, gt)}</span>
                    </div>
                    {currentStatus === status.value && (
                      <Check className="w-4 h-4 text-[var(--accent-color)]" />
                    )}
                  </button>
                ))}
                {/* Focus Mode (CORD-13): same setting as Notifications → Focus Mode */}
                <div className="border-t border-[var(--border-subtle)]">
                  <label className="w-full flex items-center justify-between gap-2 px-3 py-2 cursor-pointer hover:bg-[var(--bg-hover)] transition-colors">
                    <span className="flex items-center gap-2 min-w-0">
                      <Target className="w-3.5 h-3.5 shrink-0 text-[var(--text-secondary)]" />
                      <span className="text-sm text-[var(--text-primary)] truncate">{gt("Focus Mode")}</span>
                    </span>
                    <ToggleSwitch size="sm" checked={focusMode} onCheckedChange={(checked) => void setFocusMode(checked)} aria-label={gt("Focus Mode")} />
                  </label>
                </div>
              </PopoverContent>
            </Popover>

            {/* Custom Status: Discord's "Set a custom status" modal */}
            <div className="group/cs flex items-center rounded hover:bg-[var(--bg-hover)] transition-colors">
              <button
                onClick={() => { setOpen(false); setCustomStatusOpen(true); }}
                className="flex-1 min-w-0 flex items-center gap-3 px-3 py-2 text-left"
              >
                {hasStatus ? (
                  <CustomStatusLine text={user?.customStatus} customization={user?.customization} className="text-sm text-[var(--text-primary)]" emojiClassName="w-4 h-4" />
                ) : (
                  <>
                    <Smile className="w-4 h-4 text-[var(--text-secondary)]" />
                    <span className="text-sm text-[var(--text-primary)]">{gt("Set Custom Status")}</span>
                  </>
                )}
              </button>
              {hasStatus && (
                <button
                  onClick={() => void clearCustomStatus()}
                  className="shrink-0 p-1.5 mr-1 rounded-full text-[var(--text-muted)] hover:text-[var(--text-primary)] opacity-70 group-hover/cs:opacity-100"
                  aria-label={gt("Clear Custom Status")}
                  title={gt("Clear Custom Status")}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <div className="h-px bg-[var(--app-surface-alt)] my-1" />

            {/* Switch Accounts */}
            <button
              onClick={() => {
                setOpen(false);
                setShowSwitchAccounts(true);
              }}
              className="w-full flex items-center justify-between px-3 py-2 rounded hover:bg-[var(--bg-hover)] transition-colors"
            >
              <div className="flex items-center gap-3">
                <Users className="w-4 h-4 text-[var(--text-secondary)]" />
                <span className="text-sm text-[var(--text-primary)]">{gt("Switch Accounts")}</span>
              </div>
              <ChevronRight className="w-4 h-4 text-[var(--text-secondary)]" />
            </button>

            {/* Copy User ID */}
            <button
              onClick={handleCopyUserId}
              className="w-full flex items-center gap-3 px-3 py-2 rounded hover:bg-[var(--bg-hover)] transition-colors text-left"
            >
              {copied ? (
                <Check className="w-4 h-4 text-[var(--accent-color)]" />
              ) : (
                <Copy className="w-4 h-4 text-[var(--text-secondary)]" />
              )}
              <span className="text-sm text-[var(--text-primary)]">
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
              "!fixed !inset-x-0 !bottom-0 !top-auto !left-0 !translate-x-0 !translate-y-0 !max-w-full p-0 rounded-t-2xl border border-[var(--border-subtle)] shadow-2xl overflow-hidden max-h-[85vh] flex flex-col",
              !hasCardBg && "bg-[var(--bg-card)]"
            )}
            style={hasCardBg ? cardBgStyle : undefined}
            showCloseButton={false}
          >
            <div className="w-12 h-1 bg-[var(--app-border)] rounded-full mt-3 mb-1 mx-auto shrink-0" />
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
            collisionPadding={12}
            className={cn(
              // Short windows: cap at the room above the user panel and scroll.
              "w-[300px] p-0 border border-[var(--border-subtle)] rounded-lg overflow-x-hidden overflow-y-auto overscroll-contain scrollbar-thin max-h-[var(--radix-popover-content-available-height,calc(100dvh-24px))] shadow-xl",
              !hasCardBg && "bg-[var(--bg-card)]"
            )}
            style={hasCardBg ? cardBgStyle : undefined}
          >
            {renderProfileCard()}
          </PopoverContent>
        </Popover>
      )}
      <MountWhenOpened open={showSwitchAccounts}>
        <SwitchAccountsDialog open={showSwitchAccounts} onOpenChange={setShowSwitchAccounts} />
      </MountWhenOpened>
      <MountWhenOpened open={customStatusOpen}>
        <CustomStatusDialog open={customStatusOpen} onOpenChange={setCustomStatusOpen} />
      </MountWhenOpened>
    </>
  );
}

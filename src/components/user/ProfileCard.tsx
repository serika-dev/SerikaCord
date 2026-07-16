"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  MessageSquare,
  UserPlus,
  Copy,
  Check,
  CalendarDays,
  Plus,
  X,
  Clock,
  ShieldAlert,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { getBadgesByPriority } from "@/lib/constants/badges";
import { BadgeList, type BadgeId as UIBadgeId } from "@/components/ui/badges";
import { MarkdownRenderer } from "@/components/chat/MarkdownRenderer";
import { useCurrentTime } from "@/hooks/useCurrentTime";
import { hasPermissionBit } from "@/lib/roles/bitfield";
import { getDisplayNameStyleClasses, getDisplayNameStyleInline, getProfileBackgroundStyle, getProfileBannerStyle } from "@/lib/userDisplayNameStyle";
import { useUserActivity } from "@/hooks/useMoeActivity";
import { NowWatchingCard } from "@/components/user/NowWatchingCard";
import { MusicActivityCard } from "@/components/user/MusicActivityCard";
import { GameActivityCard } from "@/components/user/GameActivityCard";
import { getConnectionIcon, getConnectionColor, getConnectionHref } from "@/components/user/ConnectionIcon";
import { FullProfileDialog } from "@/components/user/FullProfileDialog";
import { useAuth } from "@/contexts/AuthContext";
import { ExternalLink } from "lucide-react";
import { useGT } from "gt-next";
import { statusLabel } from "@/lib/statusLabels";

export interface ProfileCardUser {
  id: string;
  username: string;
  displayName?: string;
  /** Per-server nickname; takes precedence over displayName when in a server */
  nickname?: string | null;
  avatar?: string | null;
  banner?: string | null;
  bio?: string | null;
  pronouns?: string | null;
  status?: "online" | "idle" | "dnd" | "offline";
  customStatus?: string | null;
  timezone?: string | null;
  showTimezone?: boolean;
  badges?: string[];
  roles?: Array<{ id: string; name: string; color?: string }>;
  joinedAt?: string | null;
  createdAt?: string | null;
  isPremium?: boolean;
  isOwner?: boolean;
  isSystem?: boolean;
  isFriend?: boolean;
  friendRequestSent?: boolean;
  isBot?: boolean;
  isVerified?: boolean;
  connections?: Array<{
    provider: string;
    accountId: string;
    username?: string;
    displayName?: string;
    avatar?: string;
  }>;
  customization?: {
    profileColor?: string;
    profileAccentColor?: string;
    profileGradient?: string[];
    profileGradientAngle?: number;
    profileGradientType?: 'linear' | 'radial';
    profileGradientRadialPosition?: string;
    profileCardEffect?: 'normal' | 'glassmorphism' | 'glow' | 'holographic' | 'neon';
    profileCardBlur?: number;
    profileCardOpacity?: number;
    profileCardBorderColor?: string;
    profileCardBorderGlow?: boolean;
    profileCardBorderWidth?: number;
    displayNameStyle?: {
      font?: 'default' | 'serif' | 'mono' | 'rounded' | 'cursive' | 'bold';
      effect?: 'solid' | 'gradient' | 'neon' | 'toon' | 'pop';
      color?: string;
      gradient?: string[];
    };
  } | null;
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
  /** Server context for role management */
  serverId?: string;
  /** When provided, the "View Full Profile" button calls this instead of
   *  managing a dialog internally. Used by popover wrappers that need to
   *  render the dialog outside the popover to avoid unmount issues. */
  onViewFullProfile?: () => void;
  /** Hide the "Message" action (e.g. inside the DM view where it's redundant) */
  hideMessageButton?: boolean;
  /** Hide the Connections section (e.g. in popups / side panels; keep for full profile view) */
  hideConnections?: boolean;
  /** Remove rounded corners (e.g. for DM sidebar full-height view) */
  noRoundedCorners?: boolean;
  /** When provided and the viewer can moderate, shows an "Open in Mod View"
   *  button that calls this instead of opening a dialog internally. */
  onOpenModView?: () => void;
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
  serverId,
  onViewFullProfile,
  hideMessageButton = false,
  hideConnections = false,
  noRoundedCorners = false,
  onOpenModView,
}: ProfileCardProps) {
  const router = useRouter();
  const { user: currentUser } = useAuth();
  const gt = useGT();
  const isSelf = isCurrentUser || (currentUser?.id && user.id && currentUser.id === user.id);
  const localTime = useCurrentTime(user.timezone);

  const [copied, setCopied] = useState(false);
  const [friendRequestSent, setFriendRequestSent] = useState(user.friendRequestSent ?? false);
  const [memberRoles, setMemberRoles] = useState(user.roles || []);
  const [serverRoles, setServerRoles] = useState<Array<{ id: string; name: string; color?: string; isDefault?: boolean }>>([]);
  const [fullProfileOpen, setFullProfileOpen] = useState(false);
  const [canManageRoles, setCanManageRoles] = useState(false);
  const [canModerate, setCanModerate] = useState(false);
  const [isAdminOfServer, setIsAdminOfServer] = useState(false);
  const [roleMenuOpen, setRoleMenuOpen] = useState(false);
  const [isUpdatingRoles, setIsUpdatingRoles] = useState(false);

  const MANAGE_ROLES_BIT = 1n << 28n;

  useEffect(() => {
    setMemberRoles(user.roles || []);
  }, [user.roles]);

  useEffect(() => {
    if (!serverId) return;
    let active = true;
    const fetchServer = async () => {
      try {
        const [serverRes, permRes] = await Promise.all([
          fetch(`/api/servers/${serverId}`),
          fetch(`/api/servers/${serverId}/members/@me/permissions`),
        ]);
        if (!active) return;
        if (serverRes.ok) {
          const serverData = await serverRes.json();
          const roles = (serverData.server?.roles || []).map((r: { id?: string; name: string; color?: string; isDefault?: boolean }) => ({
            id: r.id || "",
            name: r.name,
            color: r.color,
            isDefault: r.isDefault,
          }));
          setServerRoles(roles);
        }
        if (permRes.ok) {
          const permData = await permRes.json();
          const can = permData.isOwner || hasPermissionBit(permData.permissions, MANAGE_ROLES_BIT);
          setCanManageRoles(can);
          // Moderation entry: owner, admin, or any of kick/ban/timeout/manage-roles.
          const MOD_BITS = [1n << 3n, 1n << 1n, 1n << 2n, 1n << 40n, MANAGE_ROLES_BIT];
          setCanModerate(
            Boolean(permData.isOwner) ||
              MOD_BITS.some((bit) => hasPermissionBit(permData.permissions, bit))
          );
          setIsAdminOfServer(
            Boolean(permData.isOwner) ||
              hasPermissionBit(permData.permissions, 1n << 3n)
          );
        }
      } catch {
        // ignore
      }
    };
    fetchServer();
    return () => { active = false; };
  }, [serverId, MANAGE_ROLES_BIT]);

  const status = user.status ?? "offline";
  const displayName = user.nickname || user.displayName || user.username;
  const userActivity = useUserActivity(user.id);
  const moeActivity = userActivity?.activity ?? null;

  // Right-click context menu for role chips (copy ID / colour hex).
  const [roleCtx, setRoleCtx] = useState<{ x: number; y: number; role: { id: string; name: string; color?: string } } | null>(null);
  useEffect(() => {
    if (!roleCtx) return;
    const close = () => setRoleCtx(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [roleCtx]);

  const handleCopyUsername = async () => {
    try {
      await navigator.clipboard.writeText(user.username);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(gt("Could not copy username"));
    }
  };

  const handleSendMessage = () => {
    onNavigate?.();
    router.push(`/dm/${user.id}`);
  };

  const updateMemberRoles = async (nextRoleIds: string[]) => {
    if (!serverId || !user.id) return;
    setIsUpdatingRoles(true);
    try {
      const res = await fetch(`/api/servers/${serverId}/members/${user.id}/roles`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roleIds: nextRoleIds }),
      });
      if (!res.ok) throw new Error("Failed to update roles");
      setMemberRoles(serverRoles.filter((r) => nextRoleIds.includes(r.id) || r.isDefault));
      toast.success(gt("Roles updated"));
    } catch {
      toast.error(gt("Failed to update roles"));
    } finally {
      setIsUpdatingRoles(false);
    }
  };

  const addRole = (roleId: string) => {
    const next = Array.from(new Set([...memberRoles.map((r) => r.id), roleId]));
    void updateMemberRoles(next.filter((id) => !serverRoles.find((r) => r.id === id)?.isDefault));
    setRoleMenuOpen(false);
  };

  const removeRole = (roleId: string) => {
    const next = memberRoles.filter((r) => r.id !== roleId).map((r) => r.id);
    void updateMemberRoles(next);
  };

  const handleAddFriend = async () => {
    try {
      const response = await fetch(`/api/friends/add`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: user.username }),
      });
      if (response.ok) {
        setFriendRequestSent(true);
        toast.success(gt("Friend request sent to {name}", { name: displayName }));
      } else {
        const data = await response.json().catch(() => null);
        toast.error(data?.error || gt("Failed to send friend request"));
      }
    } catch {
      toast.error(gt("Failed to send friend request. Check your connection."));
    }
  };

  const badges = user.badges?.length ? getBadgesByPriority(user.badges as string[]) : [];

  const bgStyle = getProfileBackgroundStyle(user.customization, { opaque: true });
  const isHolographic = user.customization?.profileCardEffect === 'holographic';

  return (
    <div
      className={cn(
        "w-[min(340px,calc(100vw-1.5rem))] max-h-[100dvh] overflow-y-auto overflow-x-hidden border border-white/[0.06] shadow-2xl transition-all duration-300 bg-[#0c0c10]",
        !noRoundedCorners && "rounded-xl",
        isHolographic && "holographic-animation",
        className
      )}
      style={bgStyle}
    >
      {/* Banner — tall, Discord-profile style */}
      <div className="relative h-[120px]">
        {user.banner ? (
          <div
            className="absolute inset-0 bg-cover bg-center"
            style={{ backgroundImage: `url(${user.banner})` }}
          />
        ) : (user.customization?.profileGradient && user.customization.profileGradient.length >= 2) || user.customization?.profileColor ? (
          <div
            className="absolute inset-0"
            style={getProfileBannerStyle(user.customization)}
          />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-[#8B5CF6] via-[#7C3AED] to-[#4F46E5]" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-[#0c0c10]/70 via-transparent to-transparent" />

        {/* Mod view button in the top right of the banner */}
        {!isSelf && user.id && serverId && isAdminOfServer && onOpenModView && (
          <button
            onClick={onOpenModView}
            aria-label={gt("Open in Mod View")}
            title={gt("Open in Mod View")}
            className="absolute top-3.5 right-3.5 z-20 p-2 rounded-lg bg-black/40 hover:bg-black/60 active:scale-[0.95] text-white backdrop-blur-md border border-white/[0.06] transition-all"
          >
            <ShieldAlert className="w-4 h-4" />
          </button>
        )}
      </div>

      <div className="relative flex-1 flex flex-col min-h-0 px-4 pb-4">
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
              title={statusLabel(status, gt)}
            />
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-3 min-h-[44px]">
          {!isSelf && user.id && (
            <>
              {!hideMessageButton && (
                <button
                  onClick={handleSendMessage}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] active:scale-[0.97] text-white text-sm font-medium transition-all"
                >
                  <MessageSquare className="w-4 h-4" />
                  {gt("Message")}
                </button>
              )}
              {!isFriend && (
                friendRequestSent ? (
                  <button
                    disabled
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/[0.06] text-[#9a9aad] text-sm font-medium cursor-not-allowed"
                  >
                    <Clock className="w-4 h-4" />
                    {gt("Pending")}
                  </button>
                ) : (
                  <button
                    onClick={handleAddFriend}
                    aria-label={gt("Add friend")}
                    title={gt("Add Friend")}
                    className="p-2 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] active:scale-[0.97] text-white transition-all"
                  >
                    <UserPlus className="w-4 h-4" />
                  </button>
                )
              )}
            </>
          )}
        </div>

        {/* Identity */}
        <div className="mt-4">
          <div className="flex items-center gap-2 flex-wrap">
            <h3
              className={cn("text-xl font-bold text-white leading-tight truncate", getDisplayNameStyleClasses(user.customization?.displayNameStyle))}
              style={getDisplayNameStyleInline(user.customization?.displayNameStyle)}
            >
              {displayName}
            </h3>
            {user.isBot && !user.isSystem && (
              <span className={cn(
                "inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-bold rounded leading-none shrink-0 tracking-wide select-none uppercase",
                user.isVerified
                  ? "bg-[#5865F2] text-white"
                  : "bg-[#4f545c]/30 text-[#b9bbbe] border border-white/[0.04]"
              )}>
                {user.isVerified && <Check className="w-3 h-3 shrink-0 stroke-[3px]" />}
                {gt("Bot")}
              </span>
            )}
          </div>
          <button
            onClick={handleCopyUsername}
            className="group flex items-center gap-1.5 text-sm text-[#9a9aad] hover:text-white transition-colors"
            title={gt("Copy username")}
          >
            @{user.username}
            {copied ? (
              <Check className="w-3 h-3 text-[#23A559]" />
            ) : (
              <Copy className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
            )}
          </button>
          {user.pronouns && (
            <div className="text-xs text-[#9a9aad] mt-0.5">{user.pronouns}</div>
          )}
          {user.customStatus && (
            <div className="text-sm text-[#c8c8d8] mt-1.5 italic"><MarkdownRenderer content={user.customStatus} /></div>
          )}
          <div className="flex items-center gap-1.5 mt-1.5">
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ backgroundColor: STATUS_COLORS[status] }}
            />
            <span className="text-xs text-[#9a9aad]">{statusLabel(status, gt)}</span>
          </div>
          {user.showTimezone && user.timezone && localTime && (
            <div className="flex items-center gap-1.5 mt-1.5">
              <Clock className="w-3.5 h-3.5 text-[#9a9aad] shrink-0" />
              <span className="text-xs text-[#9a9aad]">
                {localTime}
              </span>
              <span className="text-[#4e5058] text-xs">•</span>
              <span className="text-xs text-[#9a9aad]">{user.timezone}</span>
            </div>
          )}
        </div>

        {/* Badges */}
        {badges.length > 0 && (
          <div className="mt-3">
            <BadgeList badges={badges.map((b) => b.id) as UIBadgeId[]} size="sm" maxDisplay={badges.length} expandable={false} />
          </div>
        )}

        {/* Activity cards: show only one at a time, with serika.moe first */}
        {moeActivity ? (
          <div className="mt-4">
            <NowWatchingCard activity={moeActivity} />
          </div>
        ) : userActivity?.music ? (
          <div className="mt-4">
            <MusicActivityCard music={userActivity.music} />
          </div>
        ) : userActivity?.activities?.[0] ? (
          <div className="mt-4">
            <GameActivityCard game={userActivity.activities[0]} />
          </div>
        ) : null}

        {/* Connections */}
        {!hideConnections && user.connections && user.connections.length > 0 && (
          <div className="mt-4">
            <h4 className="text-[11px] font-bold text-[#9a9aad] uppercase tracking-wide mb-2">{gt("Connections")}</h4>
            <div className="space-y-1">
              {user.connections.map((conn) => {
                const Icon = getConnectionIcon(conn.provider);
                const color = getConnectionColor(conn.provider);
                const label = conn.displayName || conn.username || conn.accountId;
                const href = getConnectionHref(conn.provider, conn.username || conn.accountId);
                return (
                  <a
                    key={conn.provider}
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-white/[0.05] transition-colors group"
                  >
                    {conn.avatar ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={conn.avatar} alt={label} className="w-5 h-5 rounded-full object-cover shrink-0" />
                    ) : (
                      <Icon size={20} className="shrink-0" style={{ color }} />
                    )}
                    <span className="text-sm text-[#c8c8d8] truncate flex-1">{label}</span>
                    <svg className="w-3 h-3 text-[#9a9aad] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                  </a>
                );
              })}
            </div>
          </div>
        )}

        {/* Details card */}
        {(user.bio || (memberRoles.length > 0 || canManageRoles) || user.joinedAt || user.createdAt) && (
          <div className="mt-4 rounded-lg bg-white/[0.03] border border-white/[0.05] p-3 space-y-3">
            {user.bio && (
              <div>
                <h4 className="text-[11px] font-bold text-[#9a9aad] uppercase tracking-wide mb-1">{gt("About Me")}</h4>
                <div className="text-sm text-[#e2e2ee] whitespace-pre-wrap break-words"><MarkdownRenderer content={user.bio} /></div>
              </div>
            )}

            {(memberRoles.length > 0 || canManageRoles) && serverId && (
              <div>
                <h4 className="text-[11px] font-bold text-[#9a9aad] uppercase tracking-wide mb-1.5">{gt("Roles")}</h4>
                <div className="flex flex-wrap gap-1">
                  {memberRoles.map((role) => (
                    <span
                      key={role.id}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setRoleCtx({ x: e.clientX, y: e.clientY, role });
                      }}
                      className={cn(
                        "flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border border-white/[0.06] cursor-context-menu",
                        canManageRoles && !serverRoles.find((r) => r.id === role.id)?.isDefault && "group pr-1"
                      )}
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
                      {canManageRoles &&
                        serverRoles.length > 0 &&
                        !serverRoles.find((r) => r.id === role.id)?.isDefault && (
                          <button
                            onClick={() => removeRole(role.id)}
                            disabled={isUpdatingRoles}
                            className="ml-0.5 p-0.5 rounded-full hover:bg-white/20 text-current opacity-0 group-hover:opacity-100 transition-opacity"
                            title={gt("Remove role")}
                          >
                            <X className="w-3 h-3" />
                          </button>
                        )}
                    </span>
                  ))}
                  {canManageRoles && (
                    <Popover open={roleMenuOpen} onOpenChange={setRoleMenuOpen}>
                      <PopoverTrigger asChild>
                        <button
                          disabled={isUpdatingRoles}
                          className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border border-white/[0.06] bg-white/[0.04] hover:bg-white/[0.10] text-white transition-colors"
                          title={gt("Add role")}
                        >
                          <Plus className="w-3.5 h-3.5" />
                          {gt("Add Role")}
                        </button>
                      </PopoverTrigger>
                      <PopoverContent
                        align="start"
                        className="w-52 max-h-64 overflow-y-auto p-1 bg-[#1e1f22] border-[#2b2d31] text-white shadow-xl"
                      >
                        {(() => {
                          const assignable = serverRoles.filter(
                            (r) => !r.isDefault && !memberRoles.some((m) => m.id === r.id)
                          );
                          return assignable.length === 0 ? (
                            <p className="px-2 py-1.5 text-xs text-[#949ba4]">{gt("No roles to assign")}</p>
                          ) : (
                            assignable.map((role) => (
                              <button
                                key={role.id}
                                onClick={() => addRole(role.id)}
                                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-[#2b2d31] text-left text-sm transition-colors"
                              >
                                <span
                                  className="w-2.5 h-2.5 rounded-full shrink-0"
                                  style={{ backgroundColor: role.color || "#888888" }}
                                />
                                <span className="truncate">{role.name}</span>
                              </button>
                            ))
                          );
                        })()}
                      </PopoverContent>
                    </Popover>
                  )}
                </div>
              </div>
            )}

            {(user.joinedAt || user.createdAt) && (
              <div className="flex items-center gap-4 text-sm text-[#9a9aad]">
                <CalendarDays className="w-4 h-4 shrink-0" />
                <div className="flex flex-wrap gap-x-4 gap-y-0.5">
                  {user.createdAt && (
                    <span title={gt("Account created")}>
                      {gt("Joined SerikaCord")}{" "}
                      {new Date(user.createdAt).toLocaleDateString("en-US", { month: "short", year: "numeric" })}
                    </span>
                  )}
                  {user.joinedAt && (
                    <span title={gt("Joined this server")}>
                      {gt("Member since")}{" "}
                      {new Date(user.joinedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* View Full Profile button */}
        {user.id && (
          <div className="mt-auto pt-4">
            <button
              onClick={() => {
                if (onViewFullProfile) {
                  onViewFullProfile();
                } else {
                  onNavigate?.();
                  setFullProfileOpen(true);
                }
              }}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] active:scale-[0.97] text-sm font-medium text-white transition-all"
            >
              <ExternalLink className="w-4 h-4" />
              {gt("View Full Profile")}
            </button>
          </div>
        )}
      </div>

      {!onViewFullProfile && (
        <FullProfileDialog
          user={user}
          open={fullProfileOpen}
          onOpenChange={setFullProfileOpen}
          isCurrentUser={!!isSelf}
          isFriend={isFriend}
          serverId={serverId}
          showOwnerCrown={showOwnerCrown}
        />
      )}

      {roleCtx && (
        <div
          className="fixed z-[100] min-w-[180px] py-1 rounded-lg bg-[#1e1f22] border border-[#2b2d31] shadow-xl text-sm"
          style={{ top: roleCtx.y, left: roleCtx.x }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <button
            className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-[#dbdee1] hover:bg-[#2b2d31] transition-colors"
            onClick={() => {
              navigator.clipboard?.writeText(roleCtx.role.id);
              toast.success(gt("Role ID copied"));
              setRoleCtx(null);
            }}
          >
            <Copy className="w-3.5 h-3.5 shrink-0" />
            {gt("Copy Role ID")}
          </button>
          <button
            className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-[#dbdee1] hover:bg-[#2b2d31] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            disabled={!roleCtx.role.color}
            onClick={() => {
              if (!roleCtx.role.color) return;
              navigator.clipboard?.writeText(roleCtx.role.color);
              toast.success(gt("Colour copied"));
              setRoleCtx(null);
            }}
          >
            <span
              className="w-3.5 h-3.5 rounded-full shrink-0 border border-white/20"
              style={{ backgroundColor: roleCtx.role.color || "transparent" }}
            />
            {roleCtx.role.color ? gt("Copy Colour ({hex})", { hex: roleCtx.role.color }) : gt("No colour")}
          </button>
        </div>
      )}
    </div>
  );
}

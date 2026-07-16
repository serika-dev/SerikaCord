"use client";

import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { BadgeList, type BadgeId as UIBadgeId } from "@/components/ui/badges";
import { getBadgesByPriority } from "@/lib/constants/badges";
import { MarkdownRenderer } from "@/components/chat/MarkdownRenderer";
import { getConnectionIcon, getConnectionColor, getConnectionHref } from "@/components/user/ConnectionIcon";
import { MusicActivityCard } from "@/components/user/MusicActivityCard";
import { GameActivityCard } from "@/components/user/GameActivityCard";
import { NowWatchingCard } from "@/components/user/NowWatchingCard";
import { useUserActivity } from "@/hooks/useMoeActivity";
import { useCurrentTime } from "@/hooks/useCurrentTime";
import { CalendarDays, MessageSquare, UserPlus, Clock, Check, Copy, ExternalLink, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { cn, cdnImage } from "@/lib/utils";
import { getDisplayNameStyleClasses, getDisplayNameStyleInline, getProfileBackgroundStyle } from "@/lib/userDisplayNameStyle";
import type { ProfileCardUser } from "@/components/user/ProfileCard";
import { useAuth } from "@/contexts/AuthContext";
import { useGT } from "gt-next";
import { statusLabel } from "@/lib/statusLabels";

interface FullProfileDialogProps {
  user: ProfileCardUser;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isCurrentUser?: boolean;
  isFriend?: boolean;
  serverId?: string;
  showOwnerCrown?: boolean;
  /** When provided and the viewer can moderate, shows a Mod View button. */
  onOpenModView?: () => void;
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

type TabId = "board" | "activity" | "friends" | "servers";

export function FullProfileDialog({
  user,
  open,
  onOpenChange,
  isCurrentUser = false,
  isFriend = false,
  serverId,
  showOwnerCrown = false,
  onOpenModView,
}: FullProfileDialogProps) {
  const router = useRouter();
  const { user: currentUser } = useAuth();
  const gt = useGT();
  const isSelf = isCurrentUser || (currentUser?.id && user.id && currentUser.id === user.id);

  const [activeTab, setActiveTab] = useState<TabId>("board");
  const [copied, setCopied] = useState(false);
  const [friendRequestSent, setFriendRequestSent] = useState(user.friendRequestSent ?? false);
  const [memberRoles, setMemberRoles] = useState(user.roles || []);
  const [mutualFriends, setMutualFriends] = useState<any[]>([]);
  const [mutualServers, setMutualServers] = useState<any[]>([]);
  const [fullUser, setFullUser] = useState<ProfileCardUser>(user);
  const [canModerate, setCanModerate] = useState(false);
  const [isAdminOfServer, setIsAdminOfServer] = useState(false);

  // Gate the Mod View entry on the viewer actually having moderation perms.
  useEffect(() => {
    if (!open || !serverId || !onOpenModView || isSelf || !user.id) return;
    let active = true;
    (async () => {
      try {
        const res = await fetch(`/api/servers/${serverId}/members/@me/permissions`);
        if (!res.ok || !active) return;
        const p = await res.json();
        const bits = [1n << 3n, 1n << 1n, 1n << 2n, 1n << 40n, 1n << 28n];
        const perms = BigInt(p.permissions ?? "0");
        setCanModerate(Boolean(p.isOwner) || bits.some((b) => (perms & b) === b));
        setIsAdminOfServer(Boolean(p.isOwner) || (perms & (1n << 3n)) === (1n << 3n));
      } catch {
        // ignore
      }
    })();
    return () => { active = false; };
  }, [open, serverId, onOpenModView, isSelf, user.id]);

  const status = fullUser.status ?? "offline";
  const displayName = fullUser.nickname || fullUser.displayName || fullUser.username;
  // Only poll live activity / tick the clock while the dialog is open — many of
  // these dialogs are mounted at once (one per avatar/username/mention), so
  // ungated polling saturates the network and main thread. See useUserActivity.
  const userActivity = useUserActivity(fullUser.id, { enabled: open });
  const localTime = useCurrentTime(open ? fullUser.timezone : null);
  const moeActivity = userActivity?.activity ?? null;
  const badges = fullUser.badges?.length ? getBadgesByPriority(fullUser.badges as string[]) : [];

  // Seed from the passed member/user data, but only when the *identity* changes.
  // The member list re-renders (and passes new object references) on every
  // presence poll — keying on `user.id` prevents those from wiping the enriched
  // profile (banner, bio, friend state) fetched below.
  useEffect(() => {
    setFullUser(user);
    setMemberRoles(user.roles || []);
    setFriendRequestSent(user.friendRequestSent ?? false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.id]);

  useEffect(() => {
    if (!open || !user.id) return;
    const fetchFullUser = async () => {
      try {
        const res = await fetch(`/api/users/${user.id}`);
        if (res.ok) {
          const data = await res.json();
          // Merge only defined, non-null values so the fetch enriches the
          // profile without clobbering fields it doesn't return (e.g. banner).
          setFullUser((prev) => {
            const merged = { ...prev } as Record<string, unknown>;
            for (const [k, v] of Object.entries(data)) {
              if (v !== null && v !== undefined) merged[k] = v;
            }
            return merged as unknown as ProfileCardUser;
          });
        }
      } catch (error) {
        console.error("Failed to fetch full user profile:", error);
      }
    };
    void fetchFullUser();
  }, [open, user.id]);

  useEffect(() => {
    if (!open || !user.id || isSelf) return;
    // Fetch mutual friends and servers when dialog opens (skip for own profile)
    const fetchMutuals = async () => {
      try {
        const [friendsRes, serversRes] = await Promise.all([
          fetch(`/api/users/${user.id}/mutual-friends`).catch(() => null),
          fetch(`/api/users/${user.id}/mutual-servers`).catch(() => null),
        ]);
        if (friendsRes?.ok) {
          const data = await friendsRes.json();
          setMutualFriends(data.friends || data || []);
        }
        if (serversRes?.ok) {
          const data = await serversRes.json();
          setMutualServers(data.servers || data || []);
        }
      } catch {
        // ignore
      }
    };
    void fetchMutuals();
  }, [open, user.id, isSelf]);

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
    onOpenChange(false);
    router.push(`/dm/${user.id}`);
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

  const tabs: Array<{ id: TabId; label: string }> = [
    { id: "board", label: gt("Board") },
    { id: "activity", label: gt("Activity") },
    ...(!isSelf ? [
      { id: "friends" as TabId, label: gt("Mutual Friends") },
      { id: "servers" as TabId, label: gt("Mutual Servers") },
    ] : []),
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "p-0 gap-0 bg-[#0c0c10] border-white/[0.06] overflow-hidden",
          // Mobile: bottom sheet that slides up ("pops in from under")
          "!w-screen !max-w-none !left-1/2 !-translate-x-1/2 !top-auto !bottom-0 !translate-y-0",
          "h-[92dvh] !max-h-[92dvh] rounded-t-3xl rounded-b-none border-b-0 border-x-0",
          "data-[state=open]:slide-in-from-bottom-[100%] data-[state=closed]:slide-out-to-bottom-[100%] data-[state=open]:zoom-in-100 data-[state=closed]:zoom-out-100",
          // Desktop: centered card
          "sm:!top-1/2 sm:!bottom-auto sm:!-translate-y-1/2 sm:!w-[min(1000px,95vw)] sm:!max-w-[1000px] sm:h-[85vh] sm:!max-h-[720px] sm:rounded-2xl sm:border"
        )}
        style={getProfileBackgroundStyle(fullUser.customization, { opaque: true })}
      >
        <DialogTitle className="sr-only">{gt("{name}'s Profile", { name: displayName })}</DialogTitle>
        {/* Grab handle (mobile sheet affordance) */}
        <div className="sm:hidden absolute top-0 inset-x-0 z-20 flex justify-center pt-2 pointer-events-none">
          <span className="h-1 w-10 rounded-full bg-white/40" />
        </div>
        <div className="flex flex-col md:flex-row h-full min-h-0 overflow-y-auto md:overflow-hidden">
          {/* Left panel — profile summary (transparent; the sheet root carries the theme) */}
          <div className="w-full md:w-[360px] shrink-0 md:overflow-y-auto">
            {/* Banner */}
            <div className="relative h-[140px]">
              {fullUser.banner ? (
                <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url(${fullUser.banner})` }} />
              ) : fullUser.customization?.profileGradient && fullUser.customization.profileGradient.length >= 2 ? (
                <div className="absolute inset-0" style={{ background: `linear-gradient(135deg, ${fullUser.customization.profileGradient.join(', ')})` }} />
              ) : fullUser.customization?.profileColor ? (
                <div className="absolute inset-0" style={{ backgroundColor: fullUser.customization.profileColor }} />
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

            <div className="relative px-4 pb-4">
              {/* Avatar */}
              <div className="absolute -top-11 left-4">
                <div className="relative">
                  <Avatar className="w-[88px] h-[88px] border-[5px] border-[#0c0c10] shadow-lg">
                    <AvatarImage src={cdnImage(fullUser.avatar || undefined)} />
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
                    <button
                      onClick={handleSendMessage}
                      className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] active:scale-[0.97] text-white text-sm font-medium transition-all"
                    >
                      <MessageSquare className="w-4 h-4" />
                      {gt("Message")}
                    </button>
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
                <div className="flex items-center gap-2">
                  <h3
                    className={cn("text-xl font-bold text-white leading-tight truncate", getDisplayNameStyleClasses(fullUser.customization?.displayNameStyle))}
                    style={getDisplayNameStyleInline(fullUser.customization?.displayNameStyle)}
                  >
                    {displayName}
                  </h3>
                </div>
                <button
                  onClick={handleCopyUsername}
                  className="group flex items-center gap-1.5 text-sm text-[#9a9aad] hover:text-white transition-colors"
                  title={gt("Copy username")}
                >
                  @{fullUser.username}
                  {copied ? (
                    <Check className="w-3 h-3 text-[#23A559]" />
                  ) : (
                    <Copy className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                  )}
                </button>
                {fullUser.pronouns && (
                  <div className="text-xs text-[#9a9aad] mt-0.5">{fullUser.pronouns}</div>
                )}
                {fullUser.customStatus && (
                  <div className="text-sm text-[#c8c8d8] mt-1.5 italic"><MarkdownRenderer content={fullUser.customStatus} /></div>
                )}
                <div className="flex items-center gap-1.5 mt-1.5">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: STATUS_COLORS[status] }} />
                  <span className="text-xs text-[#9a9aad]">{statusLabel(status, gt)}</span>
                </div>
                {fullUser.showTimezone && fullUser.timezone && localTime && (
                  <div className="flex items-center gap-1.5 mt-1.5">
                    <Clock className="w-3.5 h-3.5 text-[#9a9aad] shrink-0" />
                    <span className="text-xs text-[#9a9aad]">
                      {localTime}
                    </span>
                    <span className="text-[#4e5058] text-xs">&bull;</span>
                    <span className="text-xs text-[#9a9aad]">{fullUser.timezone}</span>
                  </div>
                )}
              </div>

              {/* Badges */}
              {badges.length > 0 && (
                <div className="mt-3">
                  <BadgeList badges={badges.map((b) => b.id) as UIBadgeId[]} size="sm" maxDisplay={badges.length} expandable={false} />
                </div>
              )}

              {/* About Me */}
              {fullUser.bio && (
                <div className="mt-4 rounded-lg bg-white/[0.03] border border-white/[0.05] p-3">
                  <h4 className="text-[11px] font-bold text-[#9a9aad] uppercase tracking-wide mb-1">{gt("About Me")}</h4>
                  <div className="text-sm text-[#e2e2ee] whitespace-pre-wrap break-words"><MarkdownRenderer content={fullUser.bio} /></div>
                </div>
              )}

              {/* Roles */}
              {memberRoles.length > 0 && (
                <div className="mt-3">
                  <h4 className="text-[11px] font-bold text-[#9a9aad] uppercase tracking-wide mb-1.5">{gt("Roles")}</h4>
                  <div className="flex flex-wrap gap-1">
                    {memberRoles.map((role) => (
                      <span
                        key={role.id}
                        className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border border-white/[0.06]"
                        style={{
                          backgroundColor: role.color ? `${role.color}1a` : "rgba(255,255,255,0.04)",
                          color: role.color || "#b8b8c8",
                        }}
                      >
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: role.color || "#888888" }} />
                        {role.name}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Dates */}
              {(fullUser.joinedAt || fullUser.createdAt) && (
                <div className="mt-4 flex items-center gap-4 text-sm text-[#9a9aad]">
                  <CalendarDays className="w-4 h-4 shrink-0" />
                  <div className="flex flex-wrap gap-x-4 gap-y-0.5">
                    {fullUser.createdAt && (
                      <span title={gt("Account created")}>
                        {gt("Joined SerikaCord")}{" "}
                        {new Date(fullUser.createdAt).toLocaleDateString("en-US", { month: "short", year: "numeric" })}
                      </span>
                    )}
                    {fullUser.joinedAt && (
                      <span title={gt("Joined this server")}>
                        {gt("Member since")}{" "}
                        {new Date(fullUser.joinedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Right panel — tabs */}
          <div className="flex-1 flex flex-col min-w-0 md:min-h-0 bg-transparent md:bg-[#111114]">
            {/* Tab bar */}
            {/* pr-12 reserves room for the dialog's absolute top-right close
                button so the last tab never collides with it. */}
            <div className="flex items-center gap-1 pl-4 pr-12 pt-4 pb-0 border-b border-white/[0.06] shrink-0 overflow-x-auto scrollbar-hide">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    "px-4 py-2.5 text-sm font-medium transition-colors relative whitespace-nowrap shrink-0",
                    activeTab === tab.id
                      ? "text-white"
                      : "text-[#9a9aad] hover:text-[#c8c8d8]"
                  )}
                >
                  {tab.label}
                  {activeTab === tab.id && (
                    <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#8B5CF6] rounded-full" />
                  )}
                </button>
              ))}
            </div>

            {/* Tab content */}
            <div className="flex-1 md:overflow-y-auto p-4">
              {activeTab === "board" && (
                <div className="space-y-4">
                  {/* Connections */}
                  {fullUser.connections && fullUser.connections.length > 0 && (
                    <div>
                      <h4 className="text-[11px] font-bold text-[#9a9aad] uppercase tracking-wide mb-2">{gt("Connections")}</h4>
                      <div className="grid grid-cols-2 gap-2">
                        {fullUser.connections.map((conn) => {
                          const Icon = getConnectionIcon(conn.provider);
                          const label = conn.displayName || conn.username || conn.accountId;
                          const href = getConnectionHref(conn.provider, conn.username || conn.accountId);
                          const color = getConnectionColor(conn.provider);
                          return (
                            <a
                              key={conn.provider}
                              href={href}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg bg-white/[0.03] border border-white/[0.05] hover:bg-white/[0.06] hover:border-white/[0.1] transition-all group"
                            >
                              {conn.avatar ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={cdnImage(conn.avatar)} alt={label} className="w-6 h-6 rounded-full object-cover shrink-0" />
                              ) : null}
                              <span className="text-sm text-[#c8c8d8] truncate flex-1">{label}</span>
                              <Icon size={22} className="shrink-0" style={{ color }} />
                              <ExternalLink className="w-3 h-3 text-[#9a9aad] shrink-0" />
                            </a>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Activity */}
                  <div>
                    <h4 className="text-[11px] font-bold text-[#9a9aad] uppercase tracking-wide mb-2">{gt("Recent Activity")}</h4>
                    <div className="space-y-3">
                      {moeActivity && <NowWatchingCard activity={moeActivity} />}
                      {userActivity?.music && <MusicActivityCard music={userActivity.music} />}
                      {userActivity?.activities?.map((game) => (
                        <GameActivityCard key={`${game.type}-${game.name}`} game={game} />
                      ))}
                      {!moeActivity && !userActivity?.music && (!userActivity?.activities || userActivity.activities.length === 0) && (
                        <div className="flex flex-col items-center justify-center text-center text-[#9a9aad] py-12 rounded-lg bg-white/[0.02] border border-white/[0.04]">
                          <p className="text-sm">{gt("No recent activity to show.")}</p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {activeTab === "activity" && (
                <div className="space-y-4">
                  {moeActivity && <NowWatchingCard activity={moeActivity} />}
                  {userActivity?.music && <MusicActivityCard music={userActivity.music} />}
                  {userActivity?.activities?.map((game) => (
                    <GameActivityCard key={`${game.type}-${game.name}`} game={game} />
                  ))}
                  {!moeActivity && !userActivity?.music && (!userActivity?.activities || userActivity.activities.length === 0) && (
                    <div className="flex flex-col items-center justify-center h-full text-center text-[#9a9aad] py-20">
                      <p className="text-sm">{gt("No activity in the last 30 days.")}</p>
                    </div>
                  )}
                </div>
              )}

              {activeTab === "friends" && (
                <div className="space-y-1">
                  {mutualFriends.length > 0 ? (
                    mutualFriends.map((f: any) => (
                      <div key={f.id || f._id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-white/[0.04] transition-colors">
                        <Avatar className="w-8 h-8">
                          <AvatarImage src={cdnImage(f.avatar || undefined)} />
                          <AvatarFallback className="bg-[#8B5CF6] text-white text-sm">
                            {(f.displayName || f.username || "?").charAt(0).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-white truncate">{f.displayName || f.username}</p>
                          <p className="text-xs text-[#9a9aad] truncate">@{f.username}</p>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="flex flex-col items-center justify-center h-full text-center text-[#9a9aad] py-20">
                      <p className="text-sm">{gt("No mutual friends.")}</p>
                    </div>
                  )}
                </div>
              )}

              {activeTab === "servers" && (
                <div className="space-y-1">
                  {mutualServers.length > 0 ? (
                    mutualServers.map((s: any) => (
                      <div key={s.id || s._id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-white/[0.04] transition-colors">
                        {s.icon ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={cdnImage(s.icon)} alt={s.name} className="w-8 h-8 rounded-full object-cover" />
                        ) : (
                          <div className="w-8 h-8 rounded-full bg-[#8B5CF6] flex items-center justify-center text-white text-sm font-bold">
                            {(s.name || "?").charAt(0).toUpperCase()}
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-white truncate">{s.name}</p>
                          {s.memberCount && <p className="text-xs text-[#9a9aad]">{s.memberCount} {gt("members")}</p>}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="flex flex-col items-center justify-center h-full text-center text-[#9a9aad] py-20">
                      <p className="text-sm">{gt("No mutual servers.")}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

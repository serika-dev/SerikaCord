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
import { useMoeActivity, useUserActivity } from "@/hooks/useMoeActivity";
import { CalendarDays, MessageSquare, UserPlus, Clock, Check, Copy, ExternalLink, Crown } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { getDisplayNameStyleClasses, getDisplayNameStyleInline, getProfileBackgroundStyle } from "@/lib/userDisplayNameStyle";
import type { ProfileCardUser } from "@/components/user/ProfileCard";
import { useAuth } from "@/contexts/AuthContext";

interface FullProfileDialogProps {
  user: ProfileCardUser;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isCurrentUser?: boolean;
  isFriend?: boolean;
  serverId?: string;
  showOwnerCrown?: boolean;
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
}: FullProfileDialogProps) {
  const router = useRouter();
  const { user: currentUser } = useAuth();
  const isSelf = isCurrentUser || (currentUser?.id && user.id && currentUser.id === user.id);

  const [activeTab, setActiveTab] = useState<TabId>("board");
  const [copied, setCopied] = useState(false);
  const [friendRequestSent, setFriendRequestSent] = useState(user.friendRequestSent ?? false);
  const [memberRoles, setMemberRoles] = useState(user.roles || []);
  const [mutualFriends, setMutualFriends] = useState<any[]>([]);
  const [mutualServers, setMutualServers] = useState<any[]>([]);
  const [fullUser, setFullUser] = useState<ProfileCardUser>(user);

  const status = fullUser.status ?? "offline";
  const displayName = fullUser.displayName || fullUser.username;
  const moeActivity = useMoeActivity(fullUser.id);
  const userActivity = useUserActivity(fullUser.id);
  const badges = fullUser.badges?.length ? getBadgesByPriority(fullUser.badges as string[]) : [];

  useEffect(() => {
    setFullUser(user);
    setMemberRoles(user.roles || []);
    setFriendRequestSent(user.friendRequestSent ?? false);
  }, [user]);

  useEffect(() => {
    if (!open || !user.id) return;
    const fetchFullUser = async () => {
      try {
        const res = await fetch(`/api/users/${user.id}`);
        if (res.ok) {
          const data = await res.json();
          setFullUser((prev) => ({
            ...prev,
            ...data,
          }));
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
      toast.error("Could not copy username");
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
        toast.success(`Friend request sent to ${displayName}`);
      } else {
        const data = await response.json().catch(() => null);
        toast.error(data?.error || "Failed to send friend request");
      }
    } catch {
      toast.error("Failed to send friend request. Check your connection.");
    }
  };

  const tabs: Array<{ id: TabId; label: string }> = [
    { id: "board", label: "Board" },
    { id: "activity", label: "Activity" },
    ...(!isSelf ? [
      { id: "friends" as TabId, label: "Mutual Friends" },
      { id: "servers" as TabId, label: "Mutual Servers" },
    ] : []),
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="!max-w-[1000px] !w-[1000px] !max-h-[720px] p-0 gap-0 bg-[#0c0c10] border-white/[0.06] overflow-hidden">
        <DialogTitle className="sr-only">{displayName}&apos;s Profile</DialogTitle>
        <div className="flex h-[720px]">
          {/* Left panel — profile summary */}
          <div className="w-[360px] shrink-0 overflow-y-auto" style={getProfileBackgroundStyle(fullUser.customization)}>
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
            </div>

            <div className="relative px-4 pb-4">
              {/* Avatar */}
              <div className="absolute -top-11 left-4">
                <div className="relative">
                  <Avatar className="w-[88px] h-[88px] border-[5px] border-[#0c0c10] shadow-lg">
                    <AvatarImage src={fullUser.avatar || undefined} />
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
                {!isSelf && user.id && (
                  <>
                    <button
                      onClick={handleSendMessage}
                      className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] active:scale-[0.97] text-white text-sm font-medium transition-all"
                    >
                      <MessageSquare className="w-4 h-4" />
                      Message
                    </button>
                    {!isFriend && (
                      friendRequestSent ? (
                        <button
                          disabled
                          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/[0.06] text-[#9a9aad] text-sm font-medium cursor-not-allowed"
                        >
                          <Clock className="w-4 h-4" />
                          Pending
                        </button>
                      ) : (
                        <button
                          onClick={handleAddFriend}
                          aria-label="Add friend"
                          title="Add Friend"
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
                  {showOwnerCrown && fullUser.isOwner && (
                    <span title="Server Owner" className="shrink-0 text-[#F59E0B]">
                      <Crown className="w-4 h-4" />
                    </span>
                  )}
                </div>
                <button
                  onClick={handleCopyUsername}
                  className="group flex items-center gap-1.5 text-sm text-[#9a9aad] hover:text-white transition-colors"
                  title="Copy username"
                >
                  @{fullUser.username}
                  {copied ? (
                    <Check className="w-3 h-3 text-[#23A559]" />
                  ) : (
                    <Copy className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                  )}
                </button>
                {fullUser.customStatus && (
                  <div className="text-sm text-[#c8c8d8] mt-1.5 italic"><MarkdownRenderer content={fullUser.customStatus} /></div>
                )}
                <div className="flex items-center gap-1.5 mt-1.5">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: STATUS_COLORS[status] }} />
                  <span className="text-xs text-[#9a9aad]">{STATUS_LABELS[status]}</span>
                </div>
                {fullUser.showTimezone && fullUser.timezone && (
                  <div className="flex items-center gap-1.5 mt-1.5">
                    <Clock className="w-3.5 h-3.5 text-[#9a9aad] shrink-0" />
                    <span className="text-xs text-[#9a9aad]">
                      {new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: fullUser.timezone })}
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
                  <h4 className="text-[11px] font-bold text-[#9a9aad] uppercase tracking-wide mb-1">About Me</h4>
                  <div className="text-sm text-[#e2e2ee] whitespace-pre-wrap break-words"><MarkdownRenderer content={fullUser.bio} /></div>
                </div>
              )}

              {/* Roles */}
              {memberRoles.length > 0 && (
                <div className="mt-3">
                  <h4 className="text-[11px] font-bold text-[#9a9aad] uppercase tracking-wide mb-1.5">Roles</h4>
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
                      <span title="Account created">
                        Joined SerikaCord{" "}
                        {new Date(fullUser.createdAt).toLocaleDateString("en-US", { month: "short", year: "numeric" })}
                      </span>
                    )}
                    {fullUser.joinedAt && (
                      <span title="Joined this server">
                        Member since{" "}
                        {new Date(fullUser.joinedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Right panel — tabs */}
          <div className="flex-1 flex flex-col min-w-0 bg-[#111114]">
            {/* Tab bar */}
            <div className="flex items-center gap-1 px-4 pt-4 pb-0 border-b border-white/[0.06] shrink-0">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    "px-4 py-2.5 text-sm font-medium transition-colors relative",
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
            <div className="flex-1 overflow-y-auto p-4">
              {activeTab === "board" && (
                <div className="space-y-4">
                  {/* Connections */}
                  {fullUser.connections && fullUser.connections.length > 0 && (
                    <div>
                      <h4 className="text-[11px] font-bold text-[#9a9aad] uppercase tracking-wide mb-2">Connections</h4>
                      <div className="grid grid-cols-2 gap-2">
                        {fullUser.connections.map((conn) => {
                          const Icon = getConnectionIcon(conn.provider);
                          const label = conn.displayName || conn.username || conn.accountId;
                          const href = getConnectionHref(conn.provider, conn.accountId);
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
                                <img src={conn.avatar} alt={label} className="w-6 h-6 rounded-full object-cover shrink-0" />
                              ) : (
                                <Icon size={22} className="shrink-0" style={{ color }} />
                              )}
                              <span className="text-sm text-[#c8c8d8] truncate flex-1">{label}</span>
                              <ExternalLink className="w-3 h-3 text-[#9a9aad] opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                            </a>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Activity */}
                  <div>
                    <h4 className="text-[11px] font-bold text-[#9a9aad] uppercase tracking-wide mb-2">Recent Activity</h4>
                    {userActivity?.game && <GameActivityCard game={userActivity.game} />}
                    {userActivity?.music && <MusicActivityCard music={userActivity.music} />}
                    {moeActivity && <NowWatchingCard activity={moeActivity} />}
                    {!userActivity?.game && !userActivity?.music && !moeActivity && (
                      <div className="flex flex-col items-center justify-center text-center text-[#9a9aad] py-12 rounded-lg bg-white/[0.02] border border-white/[0.04]">
                        <p className="text-sm">No recent activity to show.</p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {activeTab === "activity" && (
                <div className="space-y-4">
                  {userActivity?.game && <GameActivityCard game={userActivity.game} />}
                  {userActivity?.music && <MusicActivityCard music={userActivity.music} />}
                  {moeActivity && <NowWatchingCard activity={moeActivity} />}
                  {!userActivity?.game && !userActivity?.music && !moeActivity && (
                    <div className="flex flex-col items-center justify-center h-full text-center text-[#9a9aad] py-20">
                      <p className="text-sm">No activity in the last 30 days.</p>
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
                          <AvatarImage src={f.avatar || undefined} />
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
                      <p className="text-sm">No mutual friends.</p>
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
                          <img src={s.icon} alt={s.name} className="w-8 h-8 rounded-full object-cover" />
                        ) : (
                          <div className="w-8 h-8 rounded-full bg-[#8B5CF6] flex items-center justify-center text-white text-sm font-bold">
                            {(s.name || "?").charAt(0).toUpperCase()}
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-white truncate">{s.name}</p>
                          {s.memberCount && <p className="text-xs text-[#9a9aad]">{s.memberCount} members</p>}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="flex flex-col items-center justify-center h-full text-center text-[#9a9aad] py-20">
                      <p className="text-sm">No mutual servers.</p>
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

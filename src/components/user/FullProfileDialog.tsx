"use client";

import { ServerTagPill } from "@/components/user/ServerTagPill";
import { useState, useEffect, useMemo } from "react";
import dynamic from "next/dynamic";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { BadgeList, type BadgeId as UIBadgeId } from "@/components/ui/badges";
import { useBadges } from "@/hooks/useBadges";
import { MarkdownRenderer } from "@/components/chat/MarkdownRenderer";
import { ConnectionIcon, getConnectionHref } from "@/components/user/ConnectionIcon";
import { MusicActivityCard } from "@/components/user/MusicActivityCard";
import { GameActivityCard } from "@/components/user/GameActivityCard";
import { NowWatchingCard } from "@/components/user/NowWatchingCard";
import { ProfileBoard } from "@/components/user/ProfileBoard";
import { useUserActivity } from "@/hooks/useMoeActivity";
import { useCurrentTime } from "@/hooks/useCurrentTime";
import { BadgeCheck, CalendarDays, MessageSquare, UserPlus, Clock, Check, Copy, ExternalLink, ShieldAlert, Camera, Pencil, Plus, Smile, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { cn, cdnImage } from "@/lib/utils";
import { getDisplayNameStyleClasses, getDisplayNameStyleInline, getProfileBackgroundStyle } from "@/lib/userDisplayNameStyle";
import type { ProfileCardUser } from "@/components/user/ProfileCard";
import { useAuth } from "@/contexts/AuthContext";
import { useGT } from "gt-next";
import { statusLabel } from "@/lib/statusLabels";
import { CustomStatusLine } from "@/components/user/CustomStatus";
import { UserNoteField } from "@/components/user/UserNoteField";
import { activeCustomStatus, hasCustomStatus } from "@/lib/social/customStatus";
import { useServerOptional } from "@/contexts/ServerContext";
import { MountWhenOpened } from "@/components/ui/MountWhenOpened";
import { StatusEmoji } from "@/components/user/CustomStatus";
import { InlineEditable } from "@/components/user/profileEditor/InlineEditable";
import { ServerTagSelect } from "@/components/user/profileEditor/ServerTagSelect";
import { useProfileMediaUpload } from "@/components/user/profileEditor/useProfileMediaUpload";
import { useSelfProfileSave } from "@/components/user/profileEditor/useSelfProfileSave";
import { overlaySelfProfile, readEditorOpen, resolveSelfTag, writeEditorOpen } from "@/components/user/profileEditor/selfProfile";

// Own-profile editing: the side panel and the full status dialog are their
// own chunks, loaded only when you open them on your own profile.
const ProfileEditorPanel = dynamic(() => import("@/components/user/profileEditor/ProfileEditorPanel"), {
  ssr: false,
  loading: () => <div className="h-full bg-[var(--app-surface)]" />,
});
const CustomStatusDialog = dynamic(() => import("@/components/user/CustomStatusDialog").then((m) => m.CustomStatusDialog), { ssr: false });

/** The editor remembers being open only on wide screens (it covers the sheet on phones). */
function initialEditorOpen(): boolean {
  if (typeof window === "undefined" || !window.matchMedia?.("(min-width: 768px)").matches) return false;
  return readEditorOpen();
}

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

interface ActivityHistoryEntry {
  type: string;
  name: string;
  imageUrl: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  durationSeconds: number;
  sessions: number;
}

/** "3h 20m", "45m", "30s" — compact human playtime. */
function formatPlaytime(seconds: number): string {
  if (!seconds || seconds < 60) return `${Math.max(0, Math.round(seconds))}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  return `${m}m`;
}

/** "just now", "3h ago", "2d ago". */
function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const diff = Math.max(0, Date.now() - then);
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

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
  const isSelf = Boolean(isCurrentUser || (currentUser?.id && user.id && currentUser.id === user.id));
  const servers = useServerOptional()?.servers;

  const [activeTab, setActiveTab] = useState<TabId>("board");
  const [copied, setCopied] = useState(false);
  const [friendRequestSent, setFriendRequestSent] = useState(user.friendRequestSent ?? false);
  // Set when Add Friend auto-accepted their pending request (we're friends now).
  const [becameFriend, setBecameFriend] = useState(false);
  const isFriendNow = isFriend || becameFriend;
  const [memberRoles, setMemberRoles] = useState(user.roles || []);
  const [mutualFriends, setMutualFriends] = useState<any[]>([]);
  const [mutualServers, setMutualServers] = useState<any[]>([]);
  const [activityHistory, setActivityHistory] = useState<ActivityHistoryEntry[]>([]);
  const [fullUser, setFullUser] = useState<ProfileCardUser>(user);
  const [canModerate, setCanModerate] = useState(false);
  const [isAdminOfServer, setIsAdminOfServer] = useState(false);
  const [editorOpen, setEditorOpen] = useState(() => isSelf && initialEditorOpen());
  const [statusDialogOpen, setStatusDialogOpen] = useState(false);
  const { save: saveProfile } = useSelfProfileSave();
  const media = useProfileMediaUpload();

  const toggleEditor = (next: boolean) => {
    setEditorOpen(next);
    writeEditorOpen(next);
  };

  // Your own profile shows your live AuthContext user over the fetched one,
  // so edits here (or in settings / the status dialog) appear immediately.
  const view = useMemo(
    () => (isSelf && currentUser ? overlaySelfProfile(fullUser, currentUser as Parameters<typeof overlaySelfProfile>[1], servers ?? []) : fullUser),
    [isSelf, currentUser, fullUser, servers],
  );
  const selfTag = isSelf && currentUser ? resolveSelfTag(currentUser.customization, fullUser.customization, servers ?? []) : null;

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

  const status = view.status ?? "offline";
  const displayName = view.nickname || view.displayName || view.username;
  // In a server where you have a nickname, the name you see is the nickname.
  const editsNickname = Boolean(isSelf && serverId && view.nickname);
  // Only poll live activity / tick the clock while the dialog is open — many of
  // these dialogs are mounted at once (one per avatar/username/mention), so
  // ungated polling saturates the network and main thread. See useUserActivity.
  // Only the actually-open dialog polls, so we can afford a fast interval for a
  // realtime-feeling game/coding status. See useUserActivity.
  const userActivity = useUserActivity(fullUser.id, { enabled: open, intervalMs: 5_000 });
  const localTime = useCurrentTime(open ? fullUser.timezone : null);
  const moeActivity = userActivity?.activity ?? null;
  const { resolve: resolveBadges } = useBadges();
  const badges = resolveBadges(view.badges);

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

  // Persistent recent-activity history (games/apps), privacy-gated server-side.
  useEffect(() => {
    if (!open || !user.id) return;
    let active = true;
    fetch(`/api/users/${user.id}/activity-history?limit=12`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (active && data?.activities) setActivityHistory(data.activities);
      })
      .catch(() => {});
    return () => { active = false; };
  }, [open, user.id]);

  const handleCopyUsername = async () => {
    try {
      await navigator.clipboard.writeText(user.username);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(gt("Could not copy username"));
    }
  };

  const saveName = async (next: string) => {
    if (!editsNickname || !serverId) {
      void saveProfile({ displayName: next });
      return;
    }
    const before = fullUser.nickname;
    setFullUser((prev) => ({ ...prev, nickname: next || null }));
    try {
      const res = await fetch(`/api/servers/${serverId}/members/@me`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nickname: next || null }),
      });
      if (!res.ok) throw new Error();
    } catch {
      setFullUser((prev) => ({ ...prev, nickname: before }));
      toast.error(gt("Couldn't change your nickname"));
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
      const data = await response.json().catch(() => null);
      if (response.ok) {
        // They had already sent us a request, so the server made us friends.
        if (data?.accepted || data?.user) {
          setBecameFriend(true);
          setFriendRequestSent(false);
          toast.success(gt("You are now friends with {name}!", { name: displayName }));
        } else {
          setFriendRequestSent(true);
          toast.success(gt("Friend request sent to {name}", { name: displayName }));
        }
      } else {
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
          "p-0 gap-0 bg-[#0c0c10] border-white/[0.06] overflow-hidden sw-scrollbars",
          // Own profile on desktop: the edit tab sits outside the card's left
          // edge, so the card itself can't clip; the inner layout clips instead.
          isSelf && "md:overflow-visible",
          // Mobile: bottom sheet that slides up ("pops in from under")
          "!w-screen !max-w-none !left-1/2 !-translate-x-1/2 !top-auto !bottom-0 !translate-y-0",
          "h-[92dvh] !max-h-[92dvh] rounded-t-3xl rounded-b-none border-b-0 border-x-0 pb-[var(--safe-area-bottom)] sm:pb-0",
          "data-[state=open]:slide-in-from-bottom-[100%] data-[state=closed]:slide-out-to-bottom-[100%] data-[state=open]:zoom-in-100 data-[state=closed]:zoom-out-100",
          // Desktop: centered card
          "sm:!top-1/2 sm:!bottom-auto sm:!-translate-y-1/2 sm:!w-[min(1000px,95vw)] sm:!max-w-[1000px] sm:h-[85vh] sm:!max-h-[720px] sm:rounded-2xl sm:border",
          // Own profile: the dialog widens to make room for the editor panel.
          isSelf && "md:transition-[width,max-width] md:duration-200 md:ease-out motion-reduce:transition-none",
          isSelf && editorOpen && "md:!w-[min(1280px,96vw)] md:!max-w-[1280px]"
        )}
        style={getProfileBackgroundStyle(view.customization, { opaque: true })}
        onEscapeKeyDown={(e) => {
          // Escape inside an inline edit cancels the edit, not the dialog.
          if (document.activeElement?.closest("[data-inline-editor]")) e.preventDefault();
        }}
      >
        <DialogTitle className="sr-only">{gt("{name}'s Profile", { name: displayName })}</DialogTitle>
        {/* Grab handle (mobile sheet affordance) */}
        <div className="sm:hidden absolute top-0 inset-x-0 z-20 flex justify-center pt-2 pointer-events-none">
          <span className="h-1 w-10 rounded-full bg-white/40" />
        </div>
        {/* Edit tab (own profile, editor folded) */}
        {isSelf && !editorOpen && (
          <button
            type="button"
            onClick={() => toggleEditor(true)}
            aria-label={gt("Edit profile")}
            title={gt("Edit profile")}
            className={cn(
              "absolute z-20 flex items-center justify-center text-white/85 shadow-md transition-[width,background-color,color] duration-150 ease-out hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-accent)] motion-reduce:transition-none",
              // Phones: a tab on the sheet's left edge.
              "left-0 top-[72px] h-10 w-7 rounded-r-lg border border-l-0 border-white/10 bg-black/50 backdrop-blur-md hover:w-9 hover:bg-black/70",
              // Desktop: a tab sticking out of the card's left edge, like Discord's.
              "md:left-auto md:right-full md:top-14 md:h-11 md:w-9 md:rounded-l-xl md:rounded-r-none md:border md:border-r-0 md:border-white/[0.08] md:bg-[#16161d] md:backdrop-blur-none md:hover:w-11 md:hover:bg-[#1f1f28]",
            )}
          >
            <Pencil className="w-4 h-4" />
          </button>
        )}
        <div className="flex flex-col md:flex-row h-full min-h-0 overflow-y-auto md:overflow-hidden md:rounded-[inherit] scrollbar-thin">
          {/* Own profile editor: a left column on desktop, a layer over the sheet on phones */}
          {isSelf && (
            <aside
              inert={!editorOpen}
              aria-label={gt("Profile editor")}
              className={cn(
                "z-30 overflow-hidden transition-[width,transform] duration-200 ease-out motion-reduce:transition-none",
                "max-md:absolute max-md:inset-0",
                "md:relative md:h-full md:shrink-0 md:border-r md:border-[var(--border-subtle)]",
                editorOpen ? "max-md:translate-x-0 md:w-[280px]" : "max-md:-translate-x-full md:w-0 md:border-r-0",
              )}
            >
              <div
                className={cn(
                  "h-full md:w-[280px] transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none",
                  editorOpen ? "opacity-100 translate-x-0" : "opacity-0 md:-translate-x-2",
                )}
              >
                <MountWhenOpened open={editorOpen}>
                  <ProfileEditorPanel onCollapse={() => toggleEditor(false)} serverId={serverId} media={media} />
                </MountWhenOpened>
              </div>
            </aside>
          )}
          {/* Left panel — profile summary (transparent; the sheet root carries the theme) */}
          <div className="w-full md:w-[360px] shrink-0 md:overflow-y-auto scrollbar-thin">
            {/* Banner */}
            <div className="relative h-[140px]">
              {view.banner ? (
                <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url(${view.banner})` }} />
              ) : view.customization?.profileGradient && view.customization.profileGradient.length >= 2 ? (
                <div className="absolute inset-0" style={{ background: `linear-gradient(135deg, ${view.customization.profileGradient.join(', ')})` }} />
              ) : view.customization?.profileColor ? (
                <div className="absolute inset-0" style={{ backgroundColor: view.customization.profileColor }} />
              ) : (
                <div className="absolute inset-0 bg-gradient-to-br from-[#8B5CF6] via-[#7C3AED] to-[#4F46E5]" />
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-[#0c0c10]/70 via-transparent to-transparent" />

              {isSelf && (
                <button
                  type="button"
                  onClick={() => media.pick({ kind: "banner" })}
                  aria-label={gt("Change Banner")}
                  className="group/banner absolute inset-0 z-10 flex items-center justify-center focus-visible:outline-none"
                >
                  <span className="flex items-center gap-1.5 rounded-full bg-black/60 px-3 py-1.5 text-xs font-semibold text-white opacity-0 backdrop-blur-sm transition-opacity duration-150 group-hover/banner:opacity-100 group-focus-visible/banner:opacity-100 pointer-coarse:opacity-90">
                    {media.uploading.banner ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Camera className="w-3.5 h-3.5" />}
                    {gt("Change Banner")}
                  </span>
                </button>
              )}

              {/* Mod view button in the top right of the banner */}
              {!isSelf && user.id && serverId && isAdminOfServer && onOpenModView && (
                <button
                  onClick={onOpenModView}
                  aria-label={gt("Open in Mod View")}
                  title={gt("Open in Mod View")}
                  className="absolute top-3.5 right-3.5 max-md:right-14 max-md:top-2 max-md:size-11 max-md:flex max-md:items-center max-md:justify-center z-20 p-2 rounded-lg bg-black/40 hover:bg-black/60 active:scale-[0.95] text-white backdrop-blur-md border border-white/[0.06] transition-all"
                >
                  <ShieldAlert className="w-4 h-4" />
                </button>
              )}
            </div>

            <div className="relative px-4 pb-4">
              {/* Avatar */}
              <div className="absolute -top-11 left-4 z-20">
                <div className="relative">
                  <Avatar className="w-[88px] h-[88px] border-[5px] border-[#0c0c10] shadow-lg">
                    <AvatarImage src={cdnImage(view.avatar || undefined)} />
                    <AvatarFallback className="bg-[#8B5CF6] text-white text-3xl">
                      {displayName.charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  {isSelf && (
                    <button
                      type="button"
                      onClick={() => media.pick({ kind: "avatar" })}
                      aria-label={gt("Change Avatar")}
                      className="group/avatar absolute inset-[5px] z-10 flex flex-col items-center justify-center gap-0.5 rounded-full bg-black/55 text-[10px] font-semibold uppercase leading-tight text-white opacity-0 transition-opacity duration-150 hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-accent)] pointer-coarse:opacity-0"
                    >
                      {media.uploading.avatar ? <Loader2 className="w-5 h-5 animate-spin" /> : <Camera className="w-5 h-5" />}
                      <span className="px-2 text-center">{gt("Change Avatar")}</span>
                    </button>
                  )}
                  <div
                    className="absolute bottom-1 right-1 z-20 w-6 h-6 rounded-full border-[4px] border-[#0c0c10]"
                    style={{ backgroundColor: STATUS_COLORS[status] }}
                    title={statusLabel(status, gt)}
                  />
                  {/* Custom status: a thought bubble rising from the avatar */}
                  {(isSelf || hasCustomStatus(view.customStatus, view.customization)) && (
                    <div className="absolute left-[86px] top-0 z-30 w-max max-w-[244px] max-md:max-w-[min(320px,calc(100vw-130px))]">
                      <span aria-hidden className="absolute left-0 top-[40px] size-[7px] rounded-full border border-white/10 bg-[#1a1a22] shadow" />
                      <span aria-hidden className="absolute left-[7px] top-[26px] size-[11px] rounded-full border border-white/10 bg-[#1a1a22] shadow" />
                      <div className="ml-4 rounded-[18px] border border-white/10 bg-[#1a1a22]/95 px-3 py-1.5 shadow-lg backdrop-blur-md">
                        {isSelf ? (
                          <InlineEditable
                            field="customStatus"
                            value={activeCustomStatus(view.customStatus, view.customization).text || ""}
                            onSave={(next) => void saveProfile({ customStatus: next })}
                            label={gt("Edit custom status")}
                            placeholder={gt("What's on your mind?")}
                            className="-mx-1.5 px-1.5 rounded-xl"
                            inputClassName="text-sm w-[180px]"
                            leading={(
                              <button
                                type="button"
                                // Keep focus in the input so it doesn't save-and-close first.
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => setStatusDialogOpen(true)}
                                aria-label={gt("Choose a status emoji")}
                                title={gt("Choose a status emoji")}
                                className="flex size-7 shrink-0 items-center justify-center rounded-md bg-black/40 text-white/80 hover:text-white"
                              >
                                {(() => {
                                  const emoji = activeCustomStatus(view.customStatus, view.customization).emoji;
                                  return emoji ? <StatusEmoji emoji={emoji} className="w-4 h-4" /> : <Smile className="w-4 h-4" />;
                                })()}
                              </button>
                            )}
                          >
                            {hasCustomStatus(view.customStatus, view.customization) ? (
                              <div className="text-sm text-[#e2e2ee] pr-7 min-h-6 flex items-center min-w-0">
                                <CustomStatusLine text={view.customStatus} customization={view.customization} className="max-w-full" emojiClassName="w-4 h-4" renderText={(t) => <MarkdownRenderer content={t} />} />
                              </div>
                            ) : (
                              <div className="text-sm text-white/45 pr-7 min-h-6 flex items-center gap-1">
                                <Plus className="w-3.5 h-3.5 shrink-0" />
                                {gt("Set a custom status")}
                              </div>
                            )}
                          </InlineEditable>
                        ) : (
                          <div className="text-sm text-[#e2e2ee] min-h-6 flex items-center min-w-0">
                            <CustomStatusLine text={view.customStatus} customization={view.customization} className="max-w-full" emojiClassName="w-4 h-4" renderText={(t) => <MarkdownRenderer content={t} />} />
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                  {isSelf && (
                    // Touch screens can't hover: a small camera badge instead.
                    <button
                      type="button"
                      onClick={() => media.pick({ kind: "avatar" })}
                      aria-label={gt("Change Avatar")}
                      className="hidden pointer-coarse:flex absolute top-0 right-0 z-20 size-7 items-center justify-center rounded-full border-2 border-[#0c0c10] bg-black/70 text-white"
                    >
                      <Camera className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* Actions */}
              <div className="flex justify-end gap-2 pt-3 min-h-[44px]">
                {!isSelf && user.id && (
                  <>
                    <button
                      onClick={handleSendMessage}
                      className="flex items-center gap-1.5 px-3.5 py-2 max-sm:min-h-11 max-sm:px-4 rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] active:scale-[0.97] text-white text-sm font-medium transition-all"
                    >
                      <MessageSquare className="w-4 h-4" />
                      {gt("Message")}
                    </button>
                    {!isFriendNow && !view.isDiscord && (
                      friendRequestSent ? (
                        <button
                          disabled
                          className="flex items-center gap-1.5 px-3 py-2 max-sm:min-h-11 rounded-lg bg-white/[0.06] text-[#9a9aad] text-sm font-medium cursor-not-allowed"
                        >
                          <Clock className="w-4 h-4" />
                          {gt("Pending")}
                        </button>
                      ) : (
                        <button
                          onClick={handleAddFriend}
                          aria-label={gt("Add friend")}
                          title={gt("Add Friend")}
                          className="p-2 max-sm:size-11 max-sm:flex max-sm:items-center max-sm:justify-center rounded-lg bg-white/[0.06] hover:bg-white/[0.12] active:scale-[0.97] text-white transition-all"
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
                <div className="flex items-center gap-2 min-w-0">
                  {isSelf ? (
                    <InlineEditable
                      field={editsNickname ? "nickname" : "displayName"}
                      value={editsNickname ? view.nickname || "" : view.displayName || ""}
                      onSave={(next) => void saveName(next)}
                      label={editsNickname ? gt("Edit server nickname") : gt("Edit display name")}
                      placeholder={view.username}
                      className="min-w-0"
                      inputClassName="text-lg font-bold"
                    >
                      <h3
                        className={cn("text-xl font-bold text-white leading-tight truncate pr-7", getDisplayNameStyleClasses(view.customization?.displayNameStyle))}
                        style={getDisplayNameStyleInline(view.customization?.displayNameStyle)}
                      >
                        {displayName}
                      </h3>
                    </InlineEditable>
                  ) : (
                    <h3
                      className={cn("text-xl font-bold text-white leading-tight truncate", getDisplayNameStyleClasses(view.customization?.displayNameStyle))}
                      style={getDisplayNameStyleInline(view.customization?.displayNameStyle)}
                    >
                      {displayName}
                    </h3>
                  )}
                  {isSelf ? (
                    <ServerTagSelect tag={selfTag} />
                  ) : (
                    <ServerTagPill customization={view.customization} size="md" />
                  )}
                </div>
                <button
                  onClick={handleCopyUsername}
                  className="group flex items-center gap-1.5 text-sm text-[#9a9aad] hover:text-white transition-colors"
                  title={gt("Copy username")}
                >
                  @{view.username}
                  {copied ? (
                    <Check className="w-3 h-3 text-[#23A559]" />
                  ) : (
                    <Copy className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                  )}
                </button>
                {isSelf ? (
                  <InlineEditable
                    field="pronouns"
                    value={view.pronouns || ""}
                    onSave={(next) => void saveProfile({ pronouns: next })}
                    label={gt("Edit pronouns")}
                    placeholder={gt("Add your pronouns")}
                    className="mt-0.5 w-fit max-w-full"
                    inputClassName="text-xs"
                  >
                    <div className={cn("text-xs pr-7 min-h-6 flex items-center", view.pronouns ? "text-[#9a9aad]" : "text-white/35 italic")}>
                      {view.pronouns || gt("Add pronouns")}
                    </div>
                  </InlineEditable>
                ) : view.pronouns && (
                  <div className="text-xs text-[#9a9aad] mt-0.5">{view.pronouns}</div>
                )}
                <div className="flex items-center gap-1.5 mt-1.5">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: STATUS_COLORS[status] }} />
                  <span className="text-xs text-[#9a9aad]">{statusLabel(status, gt)}</span>
                </div>
                {view.showTimezone && view.timezone && localTime && (
                  <div className="flex items-center gap-1.5 mt-1.5">
                    <Clock className="w-3.5 h-3.5 text-[#9a9aad] shrink-0" />
                    <span className="text-xs text-[#9a9aad]">
                      {localTime}
                    </span>
                    <span className="text-[#4e5058] text-xs">&bull;</span>
                    <span className="text-xs text-[#9a9aad]">{view.timezone}</span>
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
              {isSelf ? (
                <div className="mt-4 rounded-lg bg-white/[0.03] border border-white/[0.05] p-3">
                  <h4 className="text-[11px] font-bold text-[#9a9aad] uppercase tracking-wide mb-1">{gt("About Me")}</h4>
                  <InlineEditable
                    field="bio"
                    value={view.bio || ""}
                    onSave={(next) => void saveProfile({ bio: next })}
                    label={gt("Edit About Me")}
                    placeholder={gt("Tell everyone a little about yourself")}
                  >
                    {view.bio ? (
                      <div className="text-sm text-[#e2e2ee] whitespace-pre-wrap break-words pr-7"><MarkdownRenderer content={view.bio} /></div>
                    ) : (
                      <div className="text-sm text-white/35 italic pr-7 py-0.5">{gt("Double-click to write something about yourself")}</div>
                    )}
                  </InlineEditable>
                </div>
              ) : view.bio && (
                <div className="mt-4 rounded-lg bg-white/[0.03] border border-white/[0.05] p-3">
                  <h4 className="text-[11px] font-bold text-[#9a9aad] uppercase tracking-wide mb-1">{gt("About Me")}</h4>
                  <div className="text-sm text-[#e2e2ee] whitespace-pre-wrap break-words"><MarkdownRenderer content={view.bio} /></div>
                </div>
              )}

              {/* Private note (only visible to you) */}
              {!isSelf && view.id && !view.isSystem && !view.isDiscord && (
                <UserNoteField userId={view.id} className="mt-3" />
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
              {(view.joinedAt || view.createdAt) && (
                <div className="mt-4 flex items-center gap-4 text-sm text-[#9a9aad]">
                  <CalendarDays className="w-4 h-4 shrink-0" />
                  <div className="flex flex-wrap gap-x-4 gap-y-0.5">
                    {view.createdAt && (
                      <span title={gt("Account created")}>
                        {gt("Joined SerikaCord")}{" "}
                        {new Date(view.createdAt).toLocaleDateString("en-US", { month: "short", year: "numeric" })}
                      </span>
                    )}
                    {view.joinedAt && (
                      <span title={gt("Joined this server")}>
                        {gt("Member since")}{" "}
                        {new Date(view.joinedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
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
            <div className="flex items-center gap-1 pl-4 pr-12 max-md:pr-4 pt-4 pb-0 border-b border-white/[0.06] shrink-0 overflow-x-auto scrollbar-hide">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    "px-4 py-2.5 max-sm:py-3 text-sm font-medium transition-colors relative whitespace-nowrap shrink-0",
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
            <div className="flex-1 md:overflow-y-auto p-4 scrollbar-thin [scrollbar-gutter:stable]">
              {activeTab === "board" && (
                <div className="space-y-4">
                  {/* Board: game sections, app widgets, Serika Wishlist lists, Connections and
                      Recent activity, in one order the owner can rearrange. */}
                  <ProfileBoard
                    userId={view.id}
                    isSelf={!!isSelf}
                    sections={{
                      connections: {
                        hasContent: !!view.connections?.length,
                        node: (
                          <div className="grid grid-cols-1 min-[420px]:grid-cols-2 gap-2">
                            {(view.connections ?? []).map((conn) => {
                              const label = conn.displayName || conn.username || conn.accountId;
                              const href = getConnectionHref(conn.provider, conn.username || conn.accountId);
                              return (
                                <a
                                  key={`${conn.provider}:${conn.accountId}`}
                                  href={href}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="sw-focus flex items-center gap-2.5 px-3 py-2.5 rounded-[8px] bg-[var(--sw-surface)] border border-[var(--sw-hairline)] hover:bg-white/[0.06] hover:border-[var(--sw-hairline-strong)] transition-colors group/conn min-w-0"
                                >
                                  {conn.avatar ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img src={cdnImage(conn.avatar)} alt="" className="w-6 h-6 rounded-full object-cover shrink-0" />
                                  ) : null}
                                  <span className="text-sm text-[#c8c8d8] truncate flex-1">{label}</span>
                                  {conn.verified && <BadgeCheck className="w-3.5 h-3.5 text-green-500 shrink-0" aria-label={gt("Verified domain")} />}
                                  <ConnectionIcon provider={conn.provider} accountId={conn.accountId} size={22} className="shrink-0" />
                                  <ExternalLink className="w-3 h-3 text-[#9a9aad] shrink-0" aria-hidden />
                                </a>
                              );
                            })}
                          </div>
                        ),
                      },
                      activity: {
                        hasContent: !!(moeActivity || userActivity?.music || userActivity?.activities?.length),
                        showEmptyToOwner: true,
                        node: (
                          <div className="space-y-3">
                            {moeActivity && <NowWatchingCard activity={moeActivity} />}
                            {userActivity?.music && <MusicActivityCard music={userActivity.music} />}
                            {userActivity?.activities?.map((game) => (
                              <GameActivityCard key={`${game.type}-${game.name}`} game={game} />
                            ))}
                            {!moeActivity && !userActivity?.music && (!userActivity?.activities || userActivity.activities.length === 0) && (
                              <div className="flex flex-col items-center justify-center text-center text-[#9a9aad] py-10 rounded-[10px] bg-white/[0.02] border border-[var(--sw-hairline)]">
                                <p className="text-sm">{gt("No recent activity to show.")}</p>
                              </div>
                            )}
                          </div>
                        ),
                      },
                    }}
                  />
                </div>
              )}

              {activeTab === "activity" && (
                <div className="space-y-4">
                  {/* Live activity */}
                  {moeActivity && <NowWatchingCard activity={moeActivity} />}
                  {userActivity?.music && <MusicActivityCard music={userActivity.music} />}
                  {userActivity?.activities?.map((game) => (
                    <GameActivityCard key={`${game.type}-${game.name}`} game={game} />
                  ))}

                  {/* Persistent recent-activity history */}
                  {activityHistory.length > 0 && (
                    <div>
                      <h4 className="text-[11px] font-bold text-[#9a9aad] uppercase tracking-wide mb-2">{gt("Recently Played")}</h4>
                      <div className="space-y-1.5">
                        {activityHistory.map((entry) => (
                          <div
                            key={`${entry.type}-${entry.name}`}
                            className="flex items-center gap-3 px-3 py-2 rounded-lg bg-white/[0.03] border border-white/[0.05]"
                          >
                            {entry.imageUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={entry.imageUrl} alt={entry.name} className="w-9 h-9 rounded-md object-cover shrink-0 bg-black/30" />
                            ) : (
                              <div className="w-9 h-9 rounded-md bg-[#8B5CF6]/20 flex items-center justify-center shrink-0">
                                <span className="text-sm font-bold text-[#8B5CF6]">{(entry.name || "?").charAt(0).toUpperCase()}</span>
                              </div>
                            )}
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-white truncate">{entry.name}</p>
                              <p className="text-xs text-[#9a9aad] truncate">
                                {formatPlaytime(entry.durationSeconds)} · {formatRelative(entry.lastSeenAt)}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {!moeActivity && !userActivity?.music && (!userActivity?.activities || userActivity.activities.length === 0) && activityHistory.length === 0 && (
                    <div className="flex flex-col items-center justify-center h-full text-center text-[#9a9aad] py-20">
                      <p className="text-sm">{gt("No activity to show.")}</p>
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
        {isSelf && media.element}
        {isSelf && (
          <MountWhenOpened open={statusDialogOpen}>
            <CustomStatusDialog open={statusDialogOpen} onOpenChange={setStatusDialogOpen} />
          </MountWhenOpened>
        )}
      </DialogContent>
    </Dialog>
  );
}

"use client";

import { useState, useMemo, useEffect } from "react";
import { Crown, Play, Pause, Music2, Gamepad2, Code2, Bot, Check, Copy, MessageSquare, Clock, UserPlus, UserPlus2, ShieldAlert, Phone, Video } from "lucide-react";
import { hasPermissionBit } from "@/lib/roles/bitfield";
import { InviteDialog } from "@/components/dialogs/InviteDialog";
import { ModViewDialog } from "@/components/user/ModViewDialog";
import { useServer, useServerMembers } from "@/contexts/ServerContext";
import { useAuth } from "@/contexts/AuthContext";
import { useUserActivity } from "@/hooks/useMoeActivity";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MemberProfilePopup } from "@/components/user/MemberProfilePopup";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn, getTimeoutRemaining, cdnImage } from "@/lib/utils";
import { getDisplayNameStyleClasses, getDisplayNameStyleInline } from "@/lib/userDisplayNameStyle";
import { getNameplateBackground } from "@/lib/constants/nameplates";
import { T, useGT } from "gt-next";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

interface MemberRole {
  id: string;
  name: string;
  color: string;
  position: number;
  permissions: string;
  hoist: boolean;
  mentionable: boolean;
  managed: boolean;
  isDefault: boolean;
  memberCount: number;
}

interface Member {
  id: string;
  membershipId: string;
  username: string;
  displayName: string;
  avatar?: string | null;
  status: "online" | "idle" | "dnd" | "offline";
  customStatus?: string | null;
  isPremium?: boolean;
  isOwner?: boolean;
  isBot?: boolean;
  isSystem?: boolean;
  isVerified?: boolean;
  joinedAt?: string | null;
  communicationDisabledUntil?: string | null;
  roles: MemberRole[];
  highestRole?: MemberRole | null;
  highestHoistedRole?: MemberRole | null;
  customization?: {
    profileColor?: string;
    profileAccentColor?: string;
    profileGradient?: string[];
    displayNameStyle?: {
      font?: 'default' | 'serif' | 'mono' | 'rounded' | 'cursive' | 'bold';
      effect?: 'solid' | 'gradient' | 'neon' | 'toon' | 'pop';
      color?: string;
      gradient?: string[];
    };
    nameplate?: {
      type?: 'none' | 'color' | 'gradient' | 'preset';
      color?: string;
      gradient?: string[];
      presetId?: string;
    };
  } | null;
}

interface GroupedRoleMembers {
  key: string;
  label: string;
  color?: string;
  position: number;
  members: Member[];
}

function sortMembersByName(items: Member[]): Member[] {
  return [...items].sort((a, b) => {
    const nameA = (a.displayName || a.username || "").toLowerCase();
    const nameB = (b.displayName || b.username || "").toLowerCase();
    return nameA.localeCompare(nameB);
  });
}

export function MemberSidebar() {
  const gt = useGT();
  const { currentServer } = useServer();
  const { members, isMembersLoading: isLoading } = useServerMembers();
  const [canModerate, setCanModerate] = useState(false);

  useEffect(() => {
    if (!currentServer) { setCanModerate(false); return; }
    let active = true;
    (async () => {
      try {
        const res = await fetch(`/api/servers/${currentServer.id}/members/@me/permissions`);
        if (!res.ok || !active) return;
        const data = await res.json();
        // owner, admin, or any of kick/ban/timeout/manage-roles.
        const MOD_BITS = [1n << 3n, 1n << 1n, 1n << 2n, 1n << 40n, 1n << 28n];
        setCanModerate(
          Boolean(data.isOwner) || MOD_BITS.some((bit) => hasPermissionBit(data.permissions, bit))
        );
      } catch { /* ignore */ }
    })();
    return () => { active = false; };
  }, [currentServer]);

  const groupedOnlineMembers = useMemo(() => {
    const onlineMembers = sortMembersByName(members.filter((member) => member.status !== "offline"));
    const groups = new Map<string, GroupedRoleMembers>();

    for (const member of onlineMembers) {
      const hoistedRole = member.roles.find((role) => role.hoist) || null;
      const key = hoistedRole ? `role-${hoistedRole.id}` : "no-role";

      if (!groups.has(key)) {
        groups.set(key, {
          key,
          label: hoistedRole?.name || gt("Online"),
          color: hoistedRole?.color,
          position: hoistedRole?.position ?? -1,
          members: [],
        });
      }

      groups.get(key)?.members.push(member);
    }

    return Array.from(groups.values()).sort((a, b) => {
      if (a.key === "no-role") return 1;
      if (b.key === "no-role") return -1;
      return b.position - a.position;
    });
  }, [members]);

  const offlineMembers = useMemo(
    () => sortMembersByName(members.filter((member) => member.status === "offline")),
    [members]
  );

  if (!currentServer) return null;

  return (
    <div className="w-full md:w-56 shrink-0 h-full bg-[var(--app-bg)] border-l border-[var(--app-border)] overflow-hidden" style={{ touchAction: "pan-y" }}>
      <ScrollArea className="h-full member-scroll-area">
        <div className="py-4 space-y-4">
          {isLoading ? (
            <div className="space-y-4">
              {[0, 1].map((group) => (
                <div key={group} className="space-y-1">
                  <div className="mx-4 h-3 w-16 rounded bg-[var(--app-surface)] animate-pulse" />
                  {Array.from({ length: 4 - group }).map((_, i) => (
                    <div key={i} className="mx-2 px-2 py-1.5 flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-[var(--app-surface)] animate-pulse shrink-0" />
                      <div
                        className="h-3 rounded bg-[var(--app-surface)] animate-pulse"
                        style={{ width: `${45 + ((i * 19 + group * 13) % 40)}%` }}
                      />
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ) : (
            <>
              {groupedOnlineMembers.map((group) => (
                <div key={group.key} className="space-y-1">
                  <p className="px-4 text-[11px] font-semibold uppercase tracking-wide text-[#7d7d7d]">
                    {group.label} — {group.members.length}
                  </p>
                  {group.members.map((member) => (
                    <MemberItem key={member.id || member.membershipId} member={member} serverId={currentServer.id} canModerate={canModerate} />
                  ))}
                </div>
              ))}

              {offlineMembers.length > 0 && (
                <div className="space-y-1">
                  <p className="px-4 text-[11px] font-semibold uppercase tracking-wide text-[#7d7d7d]">
                    {gt("Offline")} — {offlineMembers.length}
                  </p>
                  {offlineMembers.map((member) => (
                    <MemberItem key={member.id || member.membershipId} member={member} serverId={currentServer.id} canModerate={canModerate} />
                  ))}
                </div>
              )}

              {members.length === 0 && (
                <div className="text-center text-[var(--app-muted-2)] text-sm py-8">
                  <T>No members found</T>
                </div>
              )}
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

interface MemberItemProps {
  member: Member;
  serverId?: string;
  canModerate?: boolean;
}

function MemberItem({ member, serverId, canModerate }: MemberItemProps) {
  const gt = useGT();
  const router = useRouter();
  const { user } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [modViewOpen, setModViewOpen] = useState(false);
  const isSelf = user?.id === member.id;

  const handleAddFriend = async () => {
    setMenuOpen(false);
    try {
      const res = await fetch(`/api/friends/add`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: member.username }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        toast.success(gt("Friend request sent to {name}", { name: member.displayName || member.username }));
      } else {
        toast.error(data?.error || gt("Failed to send friend request"));
      }
    } catch {
      toast.error(gt("Failed to send friend request"));
    }
  };
  const isOffline = member.status === "offline";
  const roleColor = member.highestRole?.color;
  // Only poll live activity for members who are actually around.
  const userActivity = useUserActivity(member.id, { enabled: !isOffline, intervalMs: 15_000 });
  const moeActivity = userActivity?.activity ?? null;
  const musicActivity = userActivity?.music ?? null;
  const gameActivities = userActivity?.activities ?? [];
  const gameActivity = gameActivities[0] ?? null;
  const extraGameCount = gameActivities.length > 1 ? gameActivities.length - 1 : 0;
  const subtitle = (!isOffline && member.customStatus) || null;
  const nameplateBg = getNameplateBackground(member.customization);
  const timeout = getTimeoutRemaining(member.communicationDisabledUntil);

  return (
    <MemberProfilePopup member={member} serverId={serverId} side="left" align="start">
      <div
        className="relative"
        onContextMenu={(e) => { e.preventDefault(); setMenuOpen(true); }}
      >
      <button
        className={cn(
          "relative overflow-hidden px-2 py-1.5 mx-2 rounded-lg flex items-center gap-3 bg-white/[0.02] hover:bg-[var(--app-surface)] transition-colors group",
          isOffline && "opacity-50"
        )}
        style={{ width: "calc(100% - 16px)", touchAction: "pan-y" }}
      >
        {nameplateBg && (
          <span
            aria-hidden
            className="absolute inset-0 pointer-events-none"
            style={{ background: nameplateBg, opacity: 0.5, WebkitMaskImage: "linear-gradient(90deg, #000 60%, transparent 100%)", maskImage: "linear-gradient(90deg, #000 60%, transparent 100%)" }}
          />
        )}
        <div className="relative flex-shrink-0">
          <Avatar className="w-8 h-8">
            <AvatarImage src={cdnImage(member.avatar || undefined)} alt={member.displayName || member.username} />
            <AvatarFallback className="bg-[#8B5CF6] text-white text-xs">
              {(member.displayName || member.username || "?").charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div
            className={cn(
              "absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-[2.5px] border-[var(--app-bg)]",
              member.status === "online" && "bg-[#23A559]",
              member.status === "idle" && "bg-[#F0B232]",
              member.status === "dnd" && "bg-[#EF4444]",
              member.status === "offline" && "bg-[#555555]"
            )}
          />
        </div>
        <div className="relative flex-1 min-w-0 text-left">
          {(() => {
            const styleClasses = getDisplayNameStyleClasses(member.customization?.displayNameStyle);
            const styleInline = getDisplayNameStyleInline(member.customization?.displayNameStyle);
            const hasCustomStyle = Boolean(member.customization?.displayNameStyle && (member.customization.displayNameStyle.color || member.customization.displayNameStyle.gradient?.length || member.customization.displayNameStyle.effect !== 'solid' || member.customization.displayNameStyle.font !== 'default'));
            return (
              <div className={cn("flex items-center gap-1 text-sm font-medium text-[var(--text-primary)]", styleClasses)} style={hasCustomStyle ? styleInline : (roleColor ? { color: roleColor } : undefined)}>
                <span className="truncate">{member.displayName || member.username || gt("Unknown")}</span>
                {member.isOwner && (
                  <Crown className="w-3.5 h-3.5 flex-shrink-0 text-[#F59E0B]" />
                )}
                {timeout.active && (
                  <span
                    title={gt("Timed out — {time} remaining", { time: timeout.label })}
                    className="inline-flex flex-shrink-0 text-[#EF4444]"
                  >
                    <Clock className="w-3.5 h-3.5" />
                  </span>
                )}
                {member.isSystem && (
                  <span className="inline-flex items-center px-1 py-0.5 text-[9px] font-bold rounded leading-none shrink-0 tracking-wide select-none uppercase scale-90 origin-left bg-[#5865F2] text-white">
                    {gt("SYSTEM")}
                  </span>
                )}
                {member.isBot && !member.isSystem && (
                  <span className={cn(
                    "inline-flex items-center gap-0.5 px-1 py-0.5 text-[9px] font-bold rounded leading-none shrink-0 tracking-wide select-none uppercase scale-90 origin-left",
                    member.isVerified 
                      ? "bg-[#5865F2] text-white" 
                      : "bg-[#4f545c]/30 text-[#b9bbbe] border border-white/[0.04]"
                  )}>
                    {member.isVerified && <Check className="w-2.5 h-2.5 shrink-0 stroke-[3px]" />}
                    {gt("Bot")}
                  </span>
                )}
              </div>
            );
          })()}
          {moeActivity ? (
            <div className="flex items-center gap-1 text-xs text-[#8B5CF6] min-w-0">
              {moeActivity.isPaused ? (
                <Pause className="w-2.5 h-2.5 shrink-0 fill-current" />
              ) : (
                <Play className="w-2.5 h-2.5 shrink-0 fill-current" />
              )}
              <span className="truncate min-w-0">{gt("Watching")} {moeActivity.titleName}</span>
            </div>
          ) : musicActivity ? (
            <div className="flex items-center gap-1 text-xs text-[var(--text-secondary)] min-w-0">
              <Music2 className="w-2.5 h-2.5 shrink-0 fill-current" />
              <span className="truncate min-w-0">{musicActivity.name} — {musicActivity.artist}</span>
            </div>
          ) : gameActivity ? (
            <div className="flex items-center gap-1 text-xs text-[var(--text-secondary)] min-w-0">
              {gameActivity.type === "vscode" ? (
                <Code2 className="w-2.5 h-2.5 shrink-0" />
              ) : gameActivity.type === "windsurf" || gameActivity.type === "devin" || gameActivity.type === "cursor" || gameActivity.type === "zed" ? (
                <Code2 className="w-2.5 h-2.5 shrink-0" />
              ) : gameActivity.type === "claude" ? (
                <Bot className="w-2.5 h-2.5 shrink-0" />
              ) : (
                <Gamepad2 className="w-2.5 h-2.5 shrink-0" />
              )}
              <span className="truncate min-w-0">{gameActivity.name}</span>
              {extraGameCount > 0 && (
                <span className="text-[10px] text-[var(--text-muted)]">+{extraGameCount}</span>
              )}
            </div>
          ) : (
            subtitle && (
              <div className="text-xs text-[var(--text-secondary)] truncate">{subtitle}</div>
            )
          )}
        </div>
      </button>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <span className="absolute inset-0 pointer-events-none" aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent side="left" align="start" className="w-52">
          {!isSelf && (
            <DropdownMenuItem onClick={() => { setMenuOpen(false); router.push(`/dm/${member.id}`); }}>
              <MessageSquare className="w-4 h-4" />
              {gt("Send Message")}
            </DropdownMenuItem>
          )}
          {!isSelf && !member.isBot && !member.isSystem && (
            <DropdownMenuItem onClick={handleAddFriend}>
              <UserPlus className="w-4 h-4" />
              {gt("Add Friend")}
            </DropdownMenuItem>
          )}
          {!isSelf && !member.isBot && !member.isSystem && (
            <>
              <DropdownMenuItem onClick={() => { setMenuOpen(false); router.push(`/dm/${member.id}?call=voice`); }}>
                <Phone className="w-4 h-4" />
                {gt("Call")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => { setMenuOpen(false); router.push(`/dm/${member.id}?call=video`); }}>
                <Video className="w-4 h-4" />
                {gt("Video Call")}
              </DropdownMenuItem>
            </>
          )}
          {serverId && !member.isSystem && (
            <DropdownMenuItem onClick={() => { setMenuOpen(false); setInviteOpen(true); }}>
              <UserPlus2 className="w-4 h-4" />
              {gt("Invite to Server")}
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => { setMenuOpen(false); navigator.clipboard?.writeText(member.username); toast.success(gt("Username copied")); }}>
            <Copy className="w-4 h-4" />
            {gt("Copy Username")}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => { setMenuOpen(false); navigator.clipboard?.writeText(member.id); toast.success(gt("User ID copied")); }}>
            <Copy className="w-4 h-4" />
            {gt("Copy User ID")}
          </DropdownMenuItem>
          {serverId && user?.badges?.some((b: string) => ["admin", "serikacord_developer"].includes(b)) && (
            <DropdownMenuItem onClick={() => { setMenuOpen(false); navigator.clipboard?.writeText(member.membershipId); toast.success(gt("Membership ID copied")); }}>
              <Copy className="w-4 h-4" />
              {gt("Copy Membership ID")}
            </DropdownMenuItem>
          )}
          {serverId && canModerate && !isSelf && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => { setMenuOpen(false); setModViewOpen(true); }}>
                <ShieldAlert className="w-4 h-4" />
                {gt("Open Mod View")}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {serverId && (
        <InviteDialog open={inviteOpen} onOpenChange={setInviteOpen} />
      )}
      {serverId && (
        <ModViewDialog
          user={{ id: member.id, username: member.username, displayName: member.displayName, avatar: member.avatar }}
          serverId={serverId}
          open={modViewOpen}
          onOpenChange={setModViewOpen}
        />
      )}
      </div>
    </MemberProfilePopup>
  );
}

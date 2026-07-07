"use client";

import { useState, useCallback, useMemo, useRef } from "react";
import { Crown, Play, Pause, Music2 } from "lucide-react";
import { useServer } from "@/contexts/ServerContext";
import { useUserActivity } from "@/hooks/useMoeActivity";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MemberProfilePopup } from "@/components/user/MemberProfilePopup";
import { cn } from "@/lib/utils";
import { getDisplayNameStyleClasses, getDisplayNameStyleInline } from "@/lib/userDisplayNameStyle";
import { getNameplateBackground } from "@/lib/constants/nameplates";

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
  joinedAt?: string | null;
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
  const { currentServer, members, isMembersLoading: isLoading } = useServer();

  const groupedOnlineMembers = useMemo(() => {
    const onlineMembers = sortMembersByName(members.filter((member) => member.status !== "offline"));
    const groups = new Map<string, GroupedRoleMembers>();

    for (const member of onlineMembers) {
      const hoistedRole = member.roles.find((role) => role.hoist) || null;
      const key = hoistedRole ? `role-${hoistedRole.id}` : "no-role";

      if (!groups.has(key)) {
        groups.set(key, {
          key,
          label: hoistedRole?.name || "No Role",
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
    <div className="w-full md:w-56 shrink-0 h-full bg-[var(--app-bg)] border-l border-[var(--app-border)] overflow-hidden">
      <ScrollArea className="h-full member-scroll-area">
        <div className="py-4 space-y-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="w-6 h-6 border-2 border-[#8B5CF6] border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <>
              {groupedOnlineMembers.map((group) => (
                <div key={group.key} className="space-y-1">
                  <p className="px-4 text-[11px] font-semibold uppercase tracking-wide text-[#7d7d7d]">
                    {group.label} — {group.members.length}
                  </p>
                  {group.members.map((member) => (
                    <MemberItem key={member.id || member.membershipId} member={member} serverId={currentServer.id} />
                  ))}
                </div>
              ))}

              {offlineMembers.length > 0 && (
                <div className="space-y-1">
                  <p className="px-4 text-[11px] font-semibold uppercase tracking-wide text-[#7d7d7d]">
                    Offline — {offlineMembers.length}
                  </p>
                  {offlineMembers.map((member) => (
                    <MemberItem key={member.id || member.membershipId} member={member} serverId={currentServer.id} />
                  ))}
                </div>
              )}

              {members.length === 0 && (
                <div className="text-center text-[var(--app-muted-2)] text-sm py-8">
                  No members found
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
}

function MemberItem({ member, serverId }: MemberItemProps) {
  const isOffline = member.status === "offline";
  const roleColor = member.highestRole?.color;
  // Only poll live activity for members who are actually around.
  const userActivity = useUserActivity(member.id, { enabled: !isOffline, intervalMs: 15_000 });
  const moeActivity = userActivity?.activity ?? null;
  const musicActivity = userActivity?.music ?? null;
  const subtitle = (!isOffline && member.customStatus) || null;
  const nameplateBg = getNameplateBackground(member.customization);

  return (
    <MemberProfilePopup member={member} serverId={serverId} side="left" align="start">
      <button
        className={cn(
          "relative overflow-hidden w-full px-2 py-1.5 mx-2 rounded-lg flex items-center gap-3 bg-white/[0.02] hover:bg-[var(--app-surface)] transition-all group",
          isOffline && "opacity-50"
        )}
        style={{ width: "calc(100% - 16px)" }}
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
            <AvatarImage src={member.avatar || undefined} alt={member.displayName || member.username} />
            <AvatarFallback className="bg-[#8B5CF6] text-white text-xs">
              {(member.displayName || member.username || "?").charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div
            className={cn(
              "absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-[2.5px] border-[var(--app-bg)]",
              member.status === "online" && "bg-[#8B5CF6]",
              member.status === "idle" && "bg-[#A78BFA]",
              member.status === "dnd" && "bg-red-500",
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
                <span className="truncate">{member.displayName || member.username || "Unknown"}</span>
                {member.isOwner && (
                  <Crown className="w-3.5 h-3.5 flex-shrink-0 text-[#F59E0B]" />
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
              <span className="truncate min-w-0">Watching {moeActivity.titleName}</span>
            </div>
          ) : musicActivity ? (
            <div className="flex items-center gap-1 text-xs text-[var(--text-secondary)] min-w-0">
              <Music2 className="w-2.5 h-2.5 shrink-0 fill-current" />
              <span className="truncate min-w-0">{musicActivity.name} — {musicActivity.artist}</span>
            </div>
          ) : (
            subtitle && (
              <div className="text-xs text-[var(--text-secondary)] truncate">{subtitle}</div>
            )
          )}
        </div>
      </button>
    </MemberProfilePopup>
  );
}

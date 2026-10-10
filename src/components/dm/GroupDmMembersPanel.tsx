"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useGT } from "gt-next";
import { Crown, LogOut, UserMinus, UserPlus } from "lucide-react";
import { UserMenuItems } from "@/components/user/UserContextMenu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn, cdnImage } from "@/lib/utils";
import { getDisplayNameStyleClasses, getDisplayNameStyleInline } from "@/lib/userDisplayNameStyle";
import type { GroupMember } from "@/lib/chat/groupDmClient";

const STATUS_COLOR: Record<string, string> = {
  online: "var(--status-online, #23A559)",
  idle: "var(--status-idle, #F0B232)",
  dnd: "var(--status-dnd, #EF4444)",
  offline: "var(--status-offline, #80848e)",
};

/**
 * The right-hand member list of a group DM: "Members — N", the owner's crown,
 * and per-member actions (message; remove from group for the owner), plus
 * "Add Friends" and "Leave Group".
 */
export function GroupDmMembersPanel({
  members,
  ownerId,
  currentUserId,
  onAddFriends,
  onRemove,
  onLeave,
  canAddMore,
}: {
  members: GroupMember[];
  ownerId: string | null;
  currentUserId: string;
  onAddFriends: () => void;
  onRemove: (member: GroupMember) => void;
  onLeave: () => void;
  canAddMore: boolean;
}) {
  const gt = useGT();
  const router = useRouter();
  const [menu, setMenu] = useState<{ x: number; y: number; member: GroupMember } | null>(null);
  const iOwn = !!ownerId && ownerId.toLowerCase() === currentUserId.toLowerCase();

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("click", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  const sorted = [...members].sort((a, b) => {
    const rank = (m: GroupMember) => (m.status && m.status !== "offline" ? 0 : 1);
    return rank(a) - rank(b) || (a.displayName || a.username).localeCompare(b.displayName || b.username);
  });

  return (
    <aside className="flex h-full w-60 shrink-0 flex-col border-l border-[var(--border-subtle)] bg-[var(--bg-sidebar)]">
      <div className="px-4 pt-4 pb-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
        {gt("Members — {count}", { count: members.length })}
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {sorted.map((m) => {
          const name = m.displayName || m.username;
          const isOwner = !!ownerId && m.id.toLowerCase() === ownerId.toLowerCase();
          const isMe = m.id.toLowerCase() === currentUserId.toLowerCase();
          const offline = !m.status || m.status === "offline";
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => { if (!isMe) router.push(`/dm/${m.id}`); }}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setMenu({ x: e.clientX, y: e.clientY, member: m });
              }}
              className={cn(
                "group flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-[var(--bg-sidebar-elevated)]",
                offline && "opacity-50 hover:opacity-100",
              )}
              title={isMe ? name : gt("Message {name}", { name })}
            >
              <div className="relative shrink-0">
                <Avatar className="h-8 w-8">
                  <AvatarImage src={cdnImage(m.avatar)} alt="" />
                  <AvatarFallback className="bg-[var(--app-accent)] text-[var(--text-on-accent)] text-xs">
                    {name.charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <span
                  className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-[var(--bg-sidebar)]"
                  style={{ backgroundColor: STATUS_COLOR[m.status || "offline"] || STATUS_COLOR.offline }}
                />
              </div>
              <span className="flex min-w-0 flex-1 items-center gap-1">
                <span
                  className={cn("truncate text-sm font-medium text-[var(--text-primary)]", getDisplayNameStyleClasses(m.customization?.displayNameStyle))}
                  style={getDisplayNameStyleInline(m.customization?.displayNameStyle)}
                >
                  {name}
                </span>
                {isOwner && (
                  <span title={gt("Group Owner")} aria-label={gt("Group Owner")} className="shrink-0">
                    <Crown className="h-3.5 w-3.5 text-yellow-500" aria-hidden />
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>
      <div className="flex flex-col gap-1 border-t border-[var(--border-subtle)] p-2">
        <button
          type="button"
          onClick={onAddFriends}
          disabled={!canAddMore}
          className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-sidebar-elevated)] hover:text-[var(--text-primary)] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <UserPlus className="h-4 w-4" />
          {gt("Add Friends to DM")}
        </button>
        <button
          type="button"
          onClick={onLeave}
          className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-red-400 hover:bg-red-500/10"
        >
          <LogOut className="h-4 w-4" />
          {gt("Leave Group")}
        </button>
      </div>

      {menu && (
        <div
          className="ctx-menu fixed z-50 min-w-[200px] max-h-[calc(100vh-16px)] overflow-y-auto"
          style={{ left: Math.min(menu.x, window.innerWidth - 216), top: Math.min(menu.y, window.innerHeight - 420) }}
          onClick={(e) => e.stopPropagation()}
        >
          <UserMenuItems
            user={{ id: menu.member.id, username: menu.member.username, displayName: menu.member.displayName, avatar: menu.member.avatar }}
            onDone={() => setMenu(null)}
          />
          {iOwn && menu.member.id.toLowerCase() !== currentUserId.toLowerCase() && (
            <>
            <div className="ctx-sep" />
            <button
              className="ctx-item text-red-400"
              onClick={() => { onRemove(menu.member); setMenu(null); }}
            >
              <UserMinus className="h-4 w-4" />
              {gt("Remove From Group")}
            </button>
            </>
          )}
          {menu.member.id.toLowerCase() === currentUserId.toLowerCase() && (
            <button
              className="ctx-item text-red-400"
              onClick={() => { onLeave(); setMenu(null); }}
            >
              <LogOut className="h-4 w-4" />
              {gt("Leave Group")}
            </button>
          )}
        </div>
      )}
    </aside>
  );
}

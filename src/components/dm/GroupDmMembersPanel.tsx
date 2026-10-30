"use client";

import { useEffect, useMemo, useState } from "react";
import { useGT } from "gt-next";
import { LogOut, UserMinus, UserPlus } from "lucide-react";
import { UserMenuItems } from "@/components/user/UserContextMenu";
import type { GroupMember } from "@/lib/chat/groupDmClient";
import { MemberList } from "@/components/chat/MemberSidebar";
import { toMemberListMember } from "@/lib/chat/dmMembers";

/**
 * The member list of a group DM, the same list (rows, presence, activity,
 * nameplates, profile card on click) as a server's: the owner in a "Group
 * Owner" group, then Online / Offline. The context menu keeps the group's own
 * actions (remove from group for the owner, leave), plus "Add Friends" and
 * "Leave Group" below the list.
 */
export function GroupDmMembersPanel({
  members,
  ownerId,
  currentUserId,
  onAddFriends,
  onRemove,
  onLeave,
  canAddMore,
  className,
}: {
  members: GroupMember[];
  ownerId: string | null;
  currentUserId: string;
  onAddFriends: () => void;
  onRemove: (member: GroupMember) => void;
  onLeave: () => void;
  canAddMore: boolean;
  className?: string;
}) {
  const gt = useGT();
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

  const ownerLabel = gt("Group Owner");
  const listMembers = useMemo(
    () => members.map((m) => toMemberListMember(m, { ownerId, ownerLabel })),
    [members, ownerId, ownerLabel],
  );

  return (
    <aside className={className ?? "flex h-full w-60 shrink-0 flex-col"}>
      <MemberList
        members={listMembers}
        className="w-full md:w-full bg-[var(--bg-sidebar)] border-[var(--border-subtle)]"
        onMemberContextMenu={(e, m) => {
          e.preventDefault();
          e.stopPropagation();
          const member = members.find((x) => x.id === m.id);
          if (member) setMenu({ x: e.clientX, y: e.clientY, member });
        }}
        footer={
          <div data-touch-scope="" className="flex flex-col gap-1 border-t border-[var(--border-subtle)] p-2 bg-[var(--bg-sidebar)]">
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
        }
      />

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

// Client-side shapes for group DMs (what /api/group-dms/:id returns and the
// `group_update` / `group:update` live events carry).
import { groupDisplayName } from "@/lib/chat/dmCall";

export interface GroupMember {
  id: string;
  username: string;
  displayName?: string | null;
  avatar?: string | null;
  status?: string;
  customStatus?: string | null;
  isBot?: boolean;
  isSystem?: boolean;
  badges?: string[];
  customization?: {
    displayNameStyle?: {
      font?: "default" | "serif" | "mono" | "rounded" | "cursive" | "bold";
      effect?: "solid" | "gradient" | "neon" | "toon" | "pop";
      color?: string;
      gradient?: string[];
    };
  } | null;
}

export interface GroupInfo {
  id: string;
  type: "group_dm";
  name: string | null;
  icon: string | null;
  ownerId: string | null;
  members: GroupMember[];
  memberCount: number;
}

/** The group's title for `viewerId`: its own name, else the other members' names. */
export function groupTitle(group: Pick<GroupInfo, "name" | "members">, viewerId?: string | null): string {
  const me = viewerId?.toLowerCase();
  const names = group.members
    .filter((m) => !me || m.id.toLowerCase() !== me)
    .map((m) => m.displayName || m.username);
  return groupDisplayName(group.name, names);
}

/** Whether `userId` is still in the group. */
export function isGroupMember(group: Pick<GroupInfo, "members">, userId: string | null | undefined): boolean {
  if (!userId) return false;
  const me = userId.toLowerCase();
  return group.members.some((m) => m.id.toLowerCase() === me);
}

// Tab-lifetime cache so reopening a group paints its header instantly.
const groupCache = new Map<string, GroupInfo>();

export function getCachedGroup(channelId: string): GroupInfo | null {
  return groupCache.get(channelId) ?? null;
}

export function cacheGroup(group: GroupInfo): void {
  groupCache.delete(group.id);
  groupCache.set(group.id, group);
  if (groupCache.size > 50) {
    const oldest = groupCache.keys().next().value;
    if (oldest) groupCache.delete(oldest);
  }
}

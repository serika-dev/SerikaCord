/** Shapes the server settings pages share (as returned by the server API). */

export interface Role {
  id: string;
  name: string;
  color: string;
  position: number;
  permissions: string;
  hoist: boolean;
  mentionable: boolean;
  managed: boolean;
  isDefault: boolean;
  memberCount?: number;
  icon?: string | null;
  unicodeEmoji?: string | null;
}

export interface RoleDraft {
  name: string;
  color: string;
  permissions: string;
  hoist: boolean;
  mentionable: boolean;
  icon?: string | null;
  unicodeEmoji?: string | null;
}

export interface Invite {
  code: string;
  uses: number;
  maxUses: number | null;
  expiresAt: string | null;
  createdBy: {
    id: string;
    username: string;
    avatar?: string;
  };
  channel: {
    id: string;
    name: string;
  };
  createdAt: string;
}

export interface VanityInfo {
  code: string | null;
  uses: number;
  isPartnered: boolean;
  lockToVanity: boolean;
}

export interface BannedUser {
  id: string;
  username: string;
  avatar?: string;
  reason?: string;
  bannedAt: string;
  bannedBy: {
    id: string;
    username: string;
  };
}

export interface ServerMember {
  id: string;
  membershipId: string;
  username: string;
  displayName?: string;
  avatar?: string;
  status: "online" | "idle" | "dnd" | "offline";
  customStatus?: string | null;
  isPremium?: boolean;
  roles: Role[];
  highestRole?: Role | null;
  highestHoistedRole?: Role | null;
  joinedAt: string;
  accountCreatedAt?: string | null;
  communicationDisabledUntil?: string | null;
  isBot?: boolean;
}

export interface ServerEmoji {
  id: string;
  name: string;
  imageUrl: string;
  animated: boolean;
}

export interface ServerChannel {
  id: string;
  name: string;
  type: string;
}

export interface ServerSticker {
  id: string;
  name: string;
  description?: string;
  imageUrl: string;
  tags?: string[];
}

export interface ServerApplication {
  id: string;
  user: {
    id: string;
    username: string;
    displayName?: string;
    avatar?: string;
    createdAt: string;
  };
  status: "pending" | "approved" | "rejected" | "interviewed";
  answers: { question: string; answer: string }[];
  createdAt: string;
  processedAt?: string;
  rejectionReason?: string;
}

/** Highest role first. */
export function byPositionDesc(a: { position: number }, b: { position: number }): number {
  return b.position - a.position;
}

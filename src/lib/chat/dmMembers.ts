/**
 * DM and group DM people as rows of the shared member list (MemberList), so
 * they look and behave like a server's members. Pure: tested in
 * tests/dm-members.test.ts.
 */
import type { MemberListMember, MemberRole } from "@/components/chat/MemberSidebar";

type Status = MemberListMember["status"];

export interface DmPerson {
  id: string;
  username: string;
  displayName?: string | null;
  avatar?: string | null;
  status?: string | null;
  customStatus?: string | null;
  isBot?: boolean;
  isSystem?: boolean;
  isVerified?: boolean;
  isPremium?: boolean;
  customization?: unknown;
}

const STATUSES = new Set(["online", "idle", "dnd", "offline"]);

/** Unknown / missing presence reads as offline (like the server list). */
export function normalizeStatus(status: string | null | undefined): Status {
  return (status && STATUSES.has(status) ? status : "offline") as Status;
}

/**
 * One person as a member-list row. The group owner gets a hoisted pseudo-role
 * so the list shows them in their own "Group Owner" group, with the crown.
 */
export function toMemberListMember(person: DmPerson, opts: { ownerId?: string | null; ownerLabel?: string } = {}): MemberListMember {
  const isOwner = !!opts.ownerId && opts.ownerId.toLowerCase() === person.id.toLowerCase();
  const ownerRole: MemberRole | null = isOwner
    ? { id: "group-owner", name: opts.ownerLabel || "Group Owner", color: "", position: 1, permissions: "0", hoist: true, mentionable: false, managed: true, isDefault: false, memberCount: 1 }
    : null;
  return {
    id: person.id,
    username: person.username,
    displayName: person.displayName || person.username,
    avatar: person.avatar ?? null,
    status: normalizeStatus(person.status),
    customStatus: person.customStatus ?? null,
    isBot: !!person.isBot,
    isSystem: !!person.isSystem,
    isVerified: !!person.isVerified,
    isPremium: !!person.isPremium,
    isOwner,
    roles: ownerRole ? [ownerRole] : [],
    customization: (person.customization as MemberListMember["customization"]) ?? null,
  };
}

/** A 1:1 DM's list: the other person and you (each once, the other first). */
export function directMessageMembers(recipient: DmPerson | null, self: DmPerson | null): MemberListMember[] {
  const out: MemberListMember[] = [];
  if (recipient) out.push(toMemberListMember(recipient));
  if (self && (!recipient || self.id.toLowerCase() !== recipient.id.toLowerCase())) out.push(toMemberListMember(self));
  return out;
}

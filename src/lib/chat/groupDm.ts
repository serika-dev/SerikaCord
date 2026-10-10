// Pure group DM rules shared by the group DM API (src/lib/api/groupDms.ts) and
// the client (DM list, group page, friend picker). No DB access, so the rules
// are unit-tested in tests/groupDm.test.ts.

/** Discord's limit: a group DM holds at most 10 people, including you. */
export const GROUP_DM_MAX_MEMBERS = 10;
/** Longest group name accepted (Discord allows 100). */
export const GROUP_DM_NAME_MAX = 100;

/** System rows a group DM leaves in its history (Discord message types 1, 2, 4, 5). */
export const GROUP_DM_EVENT_TYPES = [
  'recipient_add',
  'recipient_remove',
  'channel_name_change',
  'channel_icon_change',
] as const;

export type GroupDmEventType = (typeof GROUP_DM_EVENT_TYPES)[number];

const EVENT_TYPE_SET = new Set<string>(GROUP_DM_EVENT_TYPES);

export function isGroupDmEventType(type: unknown): type is GroupDmEventType {
  return typeof type === 'string' && EVENT_TYPE_SET.has(type);
}

const lower = (id: string) => String(id).toLowerCase();

/** Ids de-duplicated case-insensitively, first spelling kept, blanks dropped. */
export function dedupeIds(ids: readonly (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (typeof id !== 'string' || !id.trim()) continue;
    const key = lower(id);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(id);
  }
  return out;
}

function includesId(list: readonly string[] | null | undefined, id: string): boolean {
  const key = lower(id);
  return (list || []).some((x) => lower(x) === key);
}

export type GroupPlan =
  | { ok: true; memberIds: string[] }
  | { ok: false; error: string };

/**
 * Who a new group DM holds: the creator first (the owner), then the requested
 * friends in order. Everyone must be the creator's friend, and the group must
 * have at least two other people (one friend is a 1:1 DM) and at most
 * GROUP_DM_MAX_MEMBERS people in total.
 */
export function planGroupCreate(
  creatorId: string,
  requestedIds: readonly string[],
  creatorFriendIds: readonly string[] | null | undefined,
): GroupPlan {
  const others = dedupeIds(requestedIds).filter((id) => lower(id) !== lower(creatorId));
  if (others.length < 2) return { ok: false, error: 'Pick at least two friends to start a group' };
  if (others.length + 1 > GROUP_DM_MAX_MEMBERS) {
    return { ok: false, error: `A group DM can have at most ${GROUP_DM_MAX_MEMBERS} members` };
  }
  if (others.some((id) => !includesId(creatorFriendIds, id))) {
    return { ok: false, error: 'You can only add friends to a group DM' };
  }
  return { ok: true, memberIds: [creatorId, ...others] };
}

export type GroupAddPlan =
  | { ok: true; added: string[]; memberIds: string[] }
  | { ok: false; error: string };

/**
 * Add people to an existing group: only the adder's friends, people already in
 * the group are skipped, and the group can't grow past GROUP_DM_MAX_MEMBERS.
 */
export function planGroupAdd(
  currentMemberIds: readonly string[] | null | undefined,
  adderId: string,
  requestedIds: readonly string[],
  adderFriendIds: readonly string[] | null | undefined,
): GroupAddPlan {
  const current = dedupeIds(currentMemberIds || []);
  const added = dedupeIds(requestedIds).filter((id) => lower(id) !== lower(adderId) && !includesId(current, id));
  if (added.length === 0) return { ok: false, error: 'Everyone you picked is already in this group' };
  if (added.some((id) => !includesId(adderFriendIds, id))) {
    return { ok: false, error: 'You can only add friends to a group DM' };
  }
  if (current.length + added.length > GROUP_DM_MAX_MEMBERS) {
    return { ok: false, error: `A group DM can have at most ${GROUP_DM_MAX_MEMBERS} members` };
  }
  return { ok: true, added, memberIds: [...current, ...added] };
}

/** Who still remains after `userId` leaves (or is removed). */
export function membersWithout(memberIds: readonly string[] | null | undefined, userId: string): string[] {
  return dedupeIds(memberIds || []).filter((id) => lower(id) !== lower(userId));
}

/**
 * The owner after `leavingId` leaves: unchanged unless the owner is the one
 * leaving, in which case ownership passes to the longest-standing remaining
 * member (the first one in the member list). Null when nobody is left.
 */
export function nextGroupOwner(
  memberIds: readonly string[] | null | undefined,
  leavingId: string,
  currentOwnerId: string | null | undefined,
): string | null {
  const remaining = membersWithout(memberIds, leavingId);
  if (remaining.length === 0) return null;
  if (currentOwnerId && lower(currentOwnerId) !== lower(leavingId) && includesId(remaining, currentOwnerId)) {
    return remaining.find((id) => lower(id) === lower(currentOwnerId)) ?? currentOwnerId;
  }
  return remaining[0];
}

/** Whether `userId` owns the group (a group without an owner is owned by its first member). */
export function isGroupOwner(
  channel: { ownerId?: string | null; recipientIds?: string[] | null },
  userId: string,
): boolean {
  const owner = channel.ownerId || (channel.recipientIds || [])[0];
  return !!owner && lower(owner) === lower(userId);
}

/**
 * Clean up a group name: whitespace collapsed and trimmed, cut at
 * GROUP_DM_NAME_MAX characters. An empty result means "no custom name" (the
 * group then shows its members' names).
 */
export function normalizeGroupName(raw: string | null | undefined): string {
  return String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, GROUP_DM_NAME_MAX).trim();
}

/** Where the conversation for a group DM lives. */
export function groupDmHref(channelId: string): string {
  return `/dm/group/${channelId}`;
}

/** The REST base of a group DM conversation (useChatSession's apiBase). */
export function groupDmApiBase(channelId: string): string {
  return `/api/group-dms/${channelId}`;
}

type DmListChannel = { id: string; type?: string | null; recipients?: { id: string }[] | null };

/** The page a DM list row opens: the group page, or the 1:1 DM with the other person. */
export function dmChannelHref(channel: DmListChannel): string | null {
  if (channel.type === 'group_dm') return groupDmHref(channel.id);
  const other = channel.recipients?.[0];
  return other ? `/dm/${other.id}` : null;
}

/** The chat REST base of a DM list row (for message prefetching). */
export function dmChannelApiBase(channel: DmListChannel): string | null {
  if (channel.type === 'group_dm') return groupDmApiBase(channel.id);
  const other = channel.recipients?.[0];
  return other ? `/api/dms/${other.id}` : null;
}

/** Whether `pathname` is the open conversation of this DM list row. */
export function isDmChannelOpen(channel: DmListChannel, pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  const href = dmChannelHref(channel);
  return !!href && pathname === href;
}

/**
 * Plain-English preview of a group system row for the DM list and
 * notifications (the chat itself renders a translated row).
 */
export function groupEventPreview(
  type: GroupDmEventType,
  actorName: string,
  targetName?: string | null,
  name?: string | null,
): string {
  switch (type) {
    case 'recipient_add':
      return `${actorName} added ${targetName || 'someone'} to the group.`;
    case 'recipient_remove':
      return targetName && targetName !== actorName
        ? `${actorName} removed ${targetName} from the group.`
        : `${actorName} left the group.`;
    case 'channel_name_change':
      return name ? `${actorName} changed the group name to ${name}.` : `${actorName} removed the group name.`;
    case 'channel_icon_change':
      return `${actorName} changed the group icon.`;
  }
}

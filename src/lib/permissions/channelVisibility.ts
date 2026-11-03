/**
 * Which of a server's channels a member may see in the channel list. Shared by
 * every route that returns a server's channels (GET /api/servers/:id and
 * GET /api/servers/:id/channels in src/lib/api/servers.ts) so they can't drift
 * apart. Pure: the caller loads the member's roles and the channel rows.
 *
 * - Text, voice, forum, ... channels: VIEW_CHANNEL after base role permissions
 *   and the channel's overwrites (channelOverwrites.ts).
 * - Categories: shown when they hold a channel the member sees. An empty
 *   category (or one whose every channel is hidden) shows only to members who
 *   can view it and hold MANAGE_CHANNELS, so its name doesn't give away hidden
 *   channels.
 * - Threads: only joined, unarchived ones, and never one whose parent is hidden.
 * - Owner and ADMINISTRATOR see every channel.
 *
 * Rules screening (pending members) is a separate filter: pass it as `allow`.
 */
import { PERMISSION_BITS } from "./bits";
import { computeChannelPermissions, hasBit, type ChannelOverwrite } from "./channelOverwrites";

export interface VisibilityChannel {
  id: string;
  type?: string | null;
  parentId?: string | null;
  permissionOverwrites?: unknown;
  threadMemberIds?: readonly string[] | null;
  archived?: boolean | null;
}

export interface ChannelViewer {
  userId: string;
  serverId: string;
  isOwner: boolean;
  everyoneRoleId: string | null;
  /** The @everyone role's bitfield (null: unknown, the default applies). */
  everyonePermissions: bigint | null;
  /** Bitfields of the member's other roles. */
  rolePermissions: readonly bigint[];
  /** The member's role ids. */
  memberRoleIds: readonly string[];
}

const isThread = (c: VisibilityChannel) => c.type === "public_thread" || c.type === "private_thread";

/** The member's permissions in `channel` (pass a thread's parent). */
export function viewerChannelPermissions(viewer: ChannelViewer, channel: VisibilityChannel | null): bigint {
  if (viewer.isOwner) return computeChannelPermissions({ isOwner: true, ctx: {} });
  return computeChannelPermissions({
    everyonePermissions: viewer.everyonePermissions,
    rolePermissions: viewer.rolePermissions,
    overwrites: (channel?.permissionOverwrites || []) as ChannelOverwrite[],
    ctx: {
      serverId: viewer.serverId,
      everyoneRoleId: viewer.everyoneRoleId,
      memberRoleIds: viewer.memberRoleIds,
      userId: viewer.userId,
    },
  });
}

export function visibleServerChannels<C extends VisibilityChannel>(
  channels: readonly C[],
  viewer: ChannelViewer,
  allow?: (channel: C) => boolean,
): C[] {
  const serverPerms = viewerChannelPermissions(viewer, null);
  const seesEverything = hasBit(serverPerms, PERMISSION_BITS.ADMINISTRATOR);
  const managesChannels = hasBit(serverPerms, PERMISSION_BITS.MANAGE_CHANNELS);
  const canView = (c: C) =>
    seesEverything || hasBit(viewerChannelPermissions(viewer, c), PERMISSION_BITS.VIEW_CHANNEL);
  const allowed = (c: C) => !allow || allow(c);

  const visible = new Set<string>();
  // Plain channels first: categories and threads depend on them.
  for (const c of channels) {
    if (c.type === "category" || isThread(c)) continue;
    if (canView(c) && allowed(c)) visible.add(c.id);
  }
  for (const c of channels) {
    if (c.type !== "category") continue;
    if (!allowed(c)) continue;
    const hasVisibleChild = channels.some((ch) => ch.parentId === c.id && !isThread(ch) && visible.has(ch.id));
    if (hasVisibleChild || seesEverything || (managesChannels && canView(c))) visible.add(c.id);
  }
  const ids = new Set(channels.map((c) => c.id));
  for (const c of channels) {
    if (!isThread(c)) continue;
    if (c.archived) continue; // archived threads leave the sidebar; the threads browser lists them
    if (!(c.threadMemberIds || []).some((id) => id === viewer.userId)) continue;
    // A thread whose parent isn't in the list (not loaded) keeps the old behaviour: shown.
    if (c.parentId && ids.has(c.parentId) && !visible.has(c.parentId)) continue;
    visible.add(c.id);
  }
  return channels.filter((c) => visible.has(c.id));
}

function bits(value: string | null | undefined): bigint {
  try {
    return BigInt(value || "0");
  } catch {
    return 0n; // malformed bitfield
  }
}

/** A viewer from the server's role rows (already loaded) and the member's role ids. */
export function channelViewerFromRoles(opts: {
  userId: string;
  serverId: string;
  ownerId: string | null | undefined;
  roles: ReadonlyArray<{ id: string; isDefault?: boolean | null; permissions?: string | null }>;
  memberRoleIds: readonly string[] | null | undefined;
}): ChannelViewer {
  const memberRoleIds = [...(opts.memberRoleIds || [])];
  const held = new Set(memberRoleIds);
  const everyone = opts.roles.find((r) => r.isDefault) ?? null;
  const rolePermissions: bigint[] = [];
  for (const r of opts.roles) {
    if (r.id !== everyone?.id && held.has(r.id)) rolePermissions.push(bits(r.permissions));
  }
  return {
    userId: opts.userId,
    serverId: opts.serverId,
    isOwner: Boolean(opts.ownerId && opts.ownerId === opts.userId),
    everyoneRoleId: everyone?.id ?? null,
    everyonePermissions: everyone ? bits(everyone.permissions) : null,
    rolePermissions,
    memberRoleIds,
  };
}

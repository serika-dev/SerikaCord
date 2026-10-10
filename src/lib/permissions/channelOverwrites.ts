/**
 * Channel permission resolution shared by the server (src/lib/api/channels.ts,
 * src/lib/api/servers.ts) and the client mirror (src/lib/roles/channelPermissions.ts).
 *
 * Pure: no DB, no React. Resolution follows Discord's order:
 *   1. base = @everyone role permissions | every other role the member has
 *      (owner and ADMINISTRATOR short-circuit to everything)
 *   2. the @everyone overwrite (keyed by the server id or the @everyone role id)
 *   3. all of the member's other role overwrites, OR-ed together, applied at once
 *   4. the member's own overwrite
 * Each step applies `perms = (perms & ~deny) | allow`, so a role allow re-grants
 * what @everyone denied ("Private Channel" + allowed roles), and a member
 * overwrite beats both.
 */
import { ALL_PERMISSIONS, PERMISSION_BITS } from "./bits";

export interface ChannelOverwrite {
  id: string;
  type: string;
  allow?: string | null;
  deny?: string | null;
}

export interface ChannelPermissionContext {
  /** The channel's server id; some overwrites key @everyone by it. */
  serverId?: string | null;
  /** The server's @everyone (isDefault) role id, when known. */
  everyoneRoleId?: string | null;
  /** The member's role ids (may or may not include the @everyone role). */
  memberRoleIds?: readonly string[] | null;
  /** The member's user id, for member-type overwrites. */
  userId?: string | null;
}

/**
 * The @everyone permissions new servers get (servers.ts DEFAULT_PERMISSIONS.everyone).
 * Used as the base when a server has no @everyone role row, so legacy servers keep
 * working instead of locking every member out.
 */
export const DEFAULT_EVERYONE_PERMISSIONS = 1071698660929n;

function toBits(value: string | null | undefined): bigint {
  if (!value) return 0n;
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}

/** Apply a channel's overwrites to `base` in Discord order. */
export function applyChannelOverwrites(
  base: bigint,
  overwrites: readonly ChannelOverwrite[] | null | undefined,
  ctx: ChannelPermissionContext,
): bigint {
  const list = overwrites || [];
  if (list.length === 0) return base;
  let perms = base;
  const apply = (allow: bigint, deny: bigint) => {
    perms = (perms & ~deny) | allow;
  };

  const { serverId, everyoneRoleId, userId } = ctx;
  const isEveryoneId = (id: string) =>
    (!!serverId && id === serverId) || (!!everyoneRoleId && id === everyoneRoleId);

  // 1. @everyone. A channel may carry both spellings (server id and role id);
  //    apply them together as one step.
  let everyoneAllow = 0n;
  let everyoneDeny = 0n;
  for (const o of list) {
    if (o.type === "role" && isEveryoneId(o.id)) {
      everyoneAllow |= toBits(o.allow);
      everyoneDeny |= toBits(o.deny);
    }
  }
  apply(everyoneAllow, everyoneDeny);

  // 2. The member's other roles, OR-ed together.
  const roleIds = new Set((ctx.memberRoleIds || []).filter((id) => !isEveryoneId(id)));
  let roleAllow = 0n;
  let roleDeny = 0n;
  for (const o of list) {
    if (o.type === "role" && roleIds.has(o.id)) {
      roleAllow |= toBits(o.allow);
      roleDeny |= toBits(o.deny);
    }
  }
  apply(roleAllow, roleDeny);

  // 3. The member.
  if (userId) {
    for (const o of list) {
      if (o.type === "member" && o.id === userId) apply(toBits(o.allow), toBits(o.deny));
    }
  }
  return perms;
}

/**
 * Full channel permission bitfield for a member.
 *
 * `rolePermissions` are the bitfields of the member's roles, `everyonePermissions`
 * the @everyone role's (null when unknown: falls back to DEFAULT_EVERYONE_PERMISSIONS).
 * Owner and ADMINISTRATOR get everything. MANAGE_CHANNELS keeps its long-standing
 * bypass of channel overwrites for viewing and sending.
 */
export function computeChannelPermissions(opts: {
  isOwner?: boolean;
  everyonePermissions?: bigint | null;
  rolePermissions?: readonly bigint[];
  overwrites?: readonly ChannelOverwrite[] | null;
  ctx: ChannelPermissionContext;
}): bigint {
  if (opts.isOwner) return ALL_PERMISSIONS;
  let base = opts.everyonePermissions ?? DEFAULT_EVERYONE_PERMISSIONS;
  for (const p of opts.rolePermissions || []) base |= p;
  if ((base & PERMISSION_BITS.ADMINISTRATOR) === PERMISSION_BITS.ADMINISTRATOR) return ALL_PERMISSIONS;

  let perms = applyChannelOverwrites(base, opts.overwrites, opts.ctx);
  if ((base & PERMISSION_BITS.MANAGE_CHANNELS) === PERMISSION_BITS.MANAGE_CHANNELS) {
    perms |= PERMISSION_BITS.VIEW_CHANNEL | PERMISSION_BITS.SEND_MESSAGES | PERMISSION_BITS.SEND_MESSAGES_IN_THREADS;
  }
  return perms;
}

export function hasBit(perms: bigint, bit: bigint): boolean {
  return (perms & bit) === bit;
}

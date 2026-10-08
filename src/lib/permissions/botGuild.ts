/**
 * Pure permission/hierarchy math for bot API guild mutations
 * (`src/lib/api/botApi.ts`). No DB access so it can be unit tested.
 */
import { ALL_PERMISSIONS, PERMISSION_BITS } from './bits';
import { normalizeId } from '@/lib/db/normalizeId';

export interface GuildRoleLike {
  id: string;
  position?: number | null;
  permissions?: string | null;
  isDefault?: boolean | null;
  managed?: boolean | null;
}

export interface BotGuildStanding {
  /** Effective server-wide bitfield (owner: everything). */
  perms: bigint;
  isOwner: boolean;
  /** Position of the bot's highest non-default role (0 if none). */
  topPosition: number;
}

const norm = (id: string) => normalizeId(String(id)).toLowerCase();

function safeBigInt(raw: string | null | undefined): bigint {
  try {
    return BigInt(raw || '0');
  } catch {
    return 0n;
  }
}

/** Resolve a member's standing from the server's roles and their role ids. */
export function computeGuildStanding(
  roles: readonly GuildRoleLike[],
  memberRoleIds: readonly string[] | null | undefined,
  isOwner: boolean,
): BotGuildStanding {
  const ids = new Set((memberRoleIds || []).map(norm));
  let perms = 0n;
  let topPosition = 0;
  for (const r of roles) {
    const held = r.isDefault || ids.has(norm(r.id));
    if (!held) continue;
    perms |= safeBigInt(r.permissions);
    if (!r.isDefault) topPosition = Math.max(topPosition, r.position ?? 0);
  }
  if (isOwner) perms = ALL_PERMISSIONS;
  return { perms, isOwner, topPosition };
}

/** True when the standing grants `perm` (owner and ADMINISTRATOR grant all). */
export function standingHas(s: BotGuildStanding, perm: bigint): boolean {
  if (s.isOwner) return true;
  if ((s.perms & PERMISSION_BITS.ADMINISTRATOR) !== 0n) return true;
  return (s.perms & perm) === perm;
}

/** Highest non-default role position among `memberRoleIds`. */
export function memberTopPosition(roles: readonly GuildRoleLike[], memberRoleIds: readonly string[] | null | undefined): number {
  const ids = new Set((memberRoleIds || []).map(norm));
  let top = 0;
  for (const r of roles) {
    if (!r.isDefault && ids.has(norm(r.id))) top = Math.max(top, r.position ?? 0);
  }
  return top;
}

/** The bot may manage something sitting at `position` only if it is strictly below the bot's top role. */
export function outranks(s: BotGuildStanding, position: number): boolean {
  return s.isOwner || position < s.topPosition;
}

/** The bot may only hand out permission bits it holds itself (owner/admin: anything). */
export function canGrantBits(s: BotGuildStanding, requested: bigint): boolean {
  if (s.isOwner) return true;
  if ((s.perms & PERMISSION_BITS.ADMINISTRATOR) !== 0n) return true;
  return (requested & ~s.perms) === 0n;
}

/** Parse a role permission string from a request body; null when malformed. */
export function parseBitfield(raw: unknown): bigint | null {
  if (raw === undefined || raw === null || raw === '') return 0n;
  const str = String(raw).trim();
  if (!/^\d{1,40}$/.test(str)) return null;
  try {
    return BigInt(str);
  } catch {
    return null;
  }
}

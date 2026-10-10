// Server-side enforcement of the verification level and explicit media
// content filter (rules in src/lib/servers/verification.ts). The per-server
// settings are cached briefly in Redis; the settings routes drop the key.
import { cache } from '@/lib/db';
import { Role, Server, User } from '@/lib/models';
import { sameId } from '@/lib/servers/guards';
import {
  evaluateVerificationGate,
  normalizeContentFilter,
  normalizeVerificationLevel,
  shouldFilterMedia,
  verificationErrorMessage,
  type ExplicitContentFilter,
  type VerificationGateResult,
  type VerificationLevel,
} from '@/lib/servers/verification';

export interface ServerGate {
  ownerId: string | null;
  verificationLevel: VerificationLevel;
  explicitContentFilter: ExplicitContentFilter;
  everyoneRoleId: string | null;
}

const gateKey = (serverId: string) => `server:gate:${serverId}`;

export async function getServerGate(serverId: string): Promise<ServerGate | null> {
  const cached = await cache.get<ServerGate>(gateKey(serverId)).catch(() => null);
  if (cached) return cached;
  const server = await Server.findById(serverId);
  if (!server) return null;
  const settings = (server.settings || {}) as { moderation?: { verificationLevel?: unknown; explicitContentFilter?: unknown } };
  const everyone = await Role.findOne({ serverId, isDefault: true }).catch(() => null);
  const gate: ServerGate = {
    ownerId: server.ownerId ?? null,
    // The column is written by every settings route; the JSON copy is the
    // fallback for servers saved before the column was kept in sync.
    verificationLevel: normalizeVerificationLevel(
      server.verificationLevel && server.verificationLevel !== 'none'
        ? server.verificationLevel
        : settings.moderation?.verificationLevel,
    ),
    explicitContentFilter: normalizeContentFilter(
      server.explicitContentFilter && server.explicitContentFilter !== 'disabled'
        ? server.explicitContentFilter
        : settings.moderation?.explicitContentFilter,
    ),
    everyoneRoleId: (everyone?.id as string | undefined) ?? null,
  };
  await cache.set(gateKey(serverId), gate, 60).catch(() => {});
  return gate;
}

export async function invalidateServerGate(serverId: string): Promise<void> {
  await cache.del(gateKey(serverId)).catch(() => {});
}

type GateMember = { roles?: string[] | null; joinedAt?: Date | string | null } | null | undefined;
type GateUser = { id: string; isVerified?: boolean | null; createdAt?: Date | string | null; isBot?: boolean | null; isSystem?: boolean | null };

function realRoleCount(member: GateMember, everyoneRoleId: string | null): number {
  return (member?.roles || []).filter((r) => !everyoneRoleId || !sameId(r, everyoneRoleId)).length;
}

/** The verification state of a member (for the composer banner and the API gate). */
export async function memberVerificationState(
  serverId: string,
  userOrId: GateUser | string,
  member: GateMember,
): Promise<VerificationGateResult & { level: VerificationLevel }> {
  const open = { blocked: false, reason: null, until: null };
  const gate = await getServerGate(serverId);
  if (!gate || gate.verificationLevel === 'none') return { ...open, level: gate?.verificationLevel ?? 'none' };
  const userId = typeof userOrId === 'string' ? userOrId : userOrId.id;
  const roleCount = realRoleCount(member, gate.everyoneRoleId);
  if ((gate.ownerId && sameId(gate.ownerId, userId)) || roleCount > 0) return { ...open, level: gate.verificationLevel };
  const user: GateUser | null = typeof userOrId === 'string' || userOrId.createdAt === undefined
    ? ((await User.findById(userId).catch(() => null)) as GateUser | null)
    : userOrId;
  if (!user) return { ...open, level: gate.verificationLevel };
  const result = evaluateVerificationGate({
    level: gate.verificationLevel,
    exempt: Boolean(user.isBot || user.isSystem),
    roleCount,
    emailVerified: Boolean(user.isVerified),
    accountCreatedAt: user.createdAt ?? null,
    memberJoinedAt: member?.joinedAt ?? null,
  });
  return { ...result, level: gate.verificationLevel };
}

/** 403 body when the server's verification level stops this member from talking, else null. */
export async function verificationDenial(
  serverId: string,
  userOrId: GateUser | string,
  member: GateMember,
): Promise<{ status: number; body: Record<string, unknown> } | null> {
  const state = await memberVerificationState(serverId, userOrId, member).catch(() => null);
  if (!state || !state.blocked || !state.reason) return null;
  return {
    status: 403,
    body: {
      error: verificationErrorMessage(state.reason),
      code: 'verification_level',
      verificationReason: state.reason,
      verificationUntil: state.until,
    },
  };
}

/** Whether this author's image/video attachments get flagged sensitive in this channel. */
export async function shouldFlagAuthorMedia(
  serverId: string,
  userId: string,
  member: GateMember,
  channelNsfw?: boolean | null,
): Promise<boolean> {
  const gate = await getServerGate(serverId).catch(() => null);
  if (!gate || gate.explicitContentFilter === 'disabled') return false;
  return shouldFilterMedia({
    filter: gate.explicitContentFilter,
    roleCount: realRoleCount(member, gate.everyoneRoleId),
    channelNsfw,
    exempt: Boolean(gate.ownerId && sameId(gate.ownerId, userId)),
  });
}

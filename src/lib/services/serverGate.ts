// Server-side enforcement of the verification level and explicit media
// content filter (rules in src/lib/servers/verification.ts). The per-server
// settings are cached briefly in Redis; the settings routes drop the key.
import { cache } from '@/lib/db';
import { Role, Server, User, UserConnection } from '@/lib/models';
import { sameId } from '@/lib/servers/guards';
import {
  VERIFICATION_ACTIONS,
  evaluateVerificationGate,
  normalizeContentFilter,
  normalizeVerificationLevel,
  normalizeVerificationOptions,
  restrictsAny,
  shouldFilterMedia,
  verificationErrorMessage,
  type ExplicitContentFilter,
  type VerificationAction,
  type VerificationGateResult,
  type VerificationLevel,
  type VerificationOptions,
} from '@/lib/servers/verification';
import { isScreeningBlocked, SCREENING_ERROR } from '@/lib/servers/community';
import { OAUTH_ONLY_PROVIDERS } from '@/lib/connections/policy';
import { isVerifiedDomainConnection } from '@/lib/connections/domain';
import { getScreeningConfig } from '@/lib/services/serverCommunity';

export interface ServerGate {
  ownerId: string | null;
  verificationLevel: VerificationLevel;
  explicitContentFilter: ExplicitContentFilter;
  everyoneRoleId: string | null;
  /** Custom waits and which actions stay locked (settings.moderation.verification). */
  verificationOptions?: VerificationOptions;
}

const gateKey = (serverId: string) => `server:gate:${serverId}`;

export async function getServerGate(serverId: string): Promise<ServerGate | null> {
  const cached = await cache.get<ServerGate>(gateKey(serverId)).catch(() => null);
  if (cached) return cached;
  const server = await Server.findById(serverId);
  if (!server) return null;
  const settings = (server.settings || {}) as { moderation?: { verificationLevel?: unknown; explicitContentFilter?: unknown; verification?: unknown } };
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
    verificationOptions: normalizeVerificationOptions(settings.moderation?.verification),
  };
  await cache.set(gateKey(serverId), gate, 60).catch(() => {});
  return gate;
}

export async function invalidateServerGate(serverId: string): Promise<void> {
  await cache.del(gateKey(serverId)).catch(() => {});
}

type GateMember = { roles?: string[] | null; joinedAt?: Date | string | null; pending?: boolean | null } | null | undefined;
type GateUser = { id: string; isVerified?: boolean | null; createdAt?: Date | string | null; isBot?: boolean | null; isSystem?: boolean | null };

function realRoleCount(member: GateMember, everyoneRoleId: string | null): number {
  return (member?.roles || []).filter((r) => !everyoneRoleId || !sameId(r, everyoneRoleId)).length;
}

/** Whether the user has an account verified through a sign-in flow or a DNS-verified domain. */
async function hasVerifiedConnection(userId: string): Promise<boolean> {
  const rows = await UserConnection.find({ userId }).catch(() => []);
  return rows.some((c) => (OAUTH_ONLY_PROVIDERS as readonly string[]).includes(c.provider) || isVerifiedDomainConnection(c));
}

export type MemberVerificationState = VerificationGateResult & {
  level: VerificationLevel;
  options: VerificationOptions;
};

/** The verification state of a member (for the composer banner and the API gate). */
export async function memberVerificationState(
  serverId: string,
  userOrId: GateUser | string,
  member: GateMember,
): Promise<MemberVerificationState> {
  const open = { blocked: false, reason: null, until: null };
  const gate = await getServerGate(serverId);
  const options = normalizeVerificationOptions(gate?.verificationOptions);
  if (!gate || gate.verificationLevel === 'none') return { ...open, level: gate?.verificationLevel ?? 'none', options };
  const userId = typeof userOrId === 'string' ? userOrId : userOrId.id;
  const roleCount = realRoleCount(member, gate.everyoneRoleId);
  if ((gate.ownerId && sameId(gate.ownerId, userId)) || roleCount > 0) return { ...open, level: gate.verificationLevel, options };
  const user: GateUser | null = typeof userOrId === 'string' || userOrId.createdAt === undefined
    ? ((await User.findById(userId).catch(() => null)) as GateUser | null)
    : userOrId;
  if (!user) return { ...open, level: gate.verificationLevel, options };
  const exempt = Boolean(user.isBot || user.isSystem);
  const result = evaluateVerificationGate({
    level: gate.verificationLevel,
    exempt,
    roleCount,
    emailVerified: Boolean(user.isVerified),
    accountCreatedAt: user.createdAt ?? null,
    memberJoinedAt: member?.joinedAt ?? null,
    hasVerifiedConnection: gate.verificationLevel === 'very_high' && !exempt ? await hasVerifiedConnection(userId) : undefined,
    options,
  });
  return { ...result, level: gate.verificationLevel, options };
}

/**
 * 403 body when the server's verification level stops this member from doing
 * one of `actions` (default: anything), else the rules-screening denial (or null).
 */
export async function verificationDenial(
  serverId: string,
  userOrId: GateUser | string,
  member: GateMember,
  actions: readonly VerificationAction[] = VERIFICATION_ACTIONS,
): Promise<{ status: number; body: Record<string, unknown> } | null> {
  const state = await memberVerificationState(serverId, userOrId, member).catch(() => null);
  if (!state || !state.blocked || !state.reason || !restrictsAny(state.options, actions)) {
    return screeningDenial(serverId, userOrId, member);
  }
  return {
    status: 403,
    body: {
      error: verificationErrorMessage(state.reason, state.options),
      code: 'verification_level',
      verificationReason: state.reason,
      verificationUntil: state.until,
      verificationRestrict: state.options.restrict,
    },
  };
}

/**
 * Rules screening state of a member: blocked while the server has screening on
 * and they joined during it without accepting the rules yet. The owner, bots,
 * system users and members a moderator gave a role are never blocked.
 */
export async function memberScreeningBlocked(
  serverId: string,
  userOrId: GateUser | string,
  member: GateMember,
): Promise<boolean> {
  if (!member?.pending) return false;
  const config = await getScreeningConfig(serverId).catch(() => null);
  if (!config?.enabled) return false;
  const gate = await getServerGate(serverId).catch(() => null);
  const userId = typeof userOrId === 'string' ? userOrId : userOrId.id;
  const isOwner = Boolean(gate?.ownerId && sameId(gate.ownerId, userId));
  let exempt = isOwner;
  if (!exempt) {
    const user: GateUser | null = typeof userOrId === 'string' || userOrId.isBot === undefined
      ? ((await User.findById(userId).catch(() => null)) as GateUser | null)
      : userOrId;
    exempt = Boolean(user?.isBot || user?.isSystem);
  }
  return isScreeningBlocked({
    enabled: true,
    pending: true,
    exempt,
    roleCount: realRoleCount(member, gate?.everyoneRoleId ?? null),
  });
}

/** 403 body when rules screening stops this member from talking, else null. */
export async function screeningDenial(
  serverId: string,
  userOrId: GateUser | string,
  member: GateMember,
): Promise<{ status: number; body: Record<string, unknown> } | null> {
  const blocked = await memberScreeningBlocked(serverId, userOrId, member).catch(() => false);
  if (!blocked) return null;
  return { status: 403, body: { error: SCREENING_ERROR, code: 'rules_screening' } };
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

/**
 * While rules screening blocks a member and the server restricts channels,
 * the channel / category ids they may still open; null when nothing is hidden.
 */
export async function pendingChannelAccess(
  serverId: string,
  userOrId: GateUser | string,
  member: GateMember,
): Promise<Set<string> | null> {
  if (!member?.pending) return null;
  const config = await getScreeningConfig(serverId).catch(() => null);
  if (!config?.enabled || !config.restrictChannels) return null;
  // On a lookup error keep the channels hidden (fail closed for pending members).
  const blocked = await memberScreeningBlocked(serverId, userOrId, member).catch(() => true);
  return blocked ? new Set(config.accessibleChannelIds) : null;
}

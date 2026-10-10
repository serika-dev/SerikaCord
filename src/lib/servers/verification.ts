// Discord's server verification level and explicit media content filter, as
// pure rules (no DB): the server routes (send, react, join voice) and the
// composer banner both use them.
//
//   none       no restriction
//   low        must have a verified email
//   medium     + registered on SerikaCord for longer than 5 minutes
//   high       + member of this server for longer than 10 minutes
//   very_high  Discord needs a verified phone; SerikaCord has no phone
//              verification, so it is treated like high
//
// As on Discord, the owner, administrators and members with any role (other
// than @everyone) are exempt; bots and system users are too.

export const VERIFICATION_LEVELS = ['none', 'low', 'medium', 'high', 'very_high'] as const;
export type VerificationLevel = (typeof VERIFICATION_LEVELS)[number];

export const CONTENT_FILTERS = ['disabled', 'members_without_roles', 'all_members'] as const;
export type ExplicitContentFilter = (typeof CONTENT_FILTERS)[number];

export const ACCOUNT_AGE_MS = 5 * 60_000;
export const MEMBER_AGE_MS = 10 * 60_000;

/** Reads a stored level (column or settings JSON), tolerating Discord's numeric form. */
export function normalizeVerificationLevel(value: unknown): VerificationLevel {
  if (typeof value === 'number') return VERIFICATION_LEVELS[value] ?? 'none';
  if (typeof value === 'string' && (VERIFICATION_LEVELS as readonly string[]).includes(value)) return value as VerificationLevel;
  return 'none';
}

export function normalizeContentFilter(value: unknown): ExplicitContentFilter {
  if (typeof value === 'number') return CONTENT_FILTERS[value] ?? 'disabled';
  if (typeof value === 'string' && (CONTENT_FILTERS as readonly string[]).includes(value)) return value as ExplicitContentFilter;
  return 'disabled';
}

export const VERIFICATION_LEVEL_RANK: Record<VerificationLevel, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
  very_high: 4,
};

export type VerificationBlockReason = 'email' | 'account_age' | 'member_age';

export interface VerificationGateInput {
  level: VerificationLevel;
  /** Owner, administrator, bot, system user — never gated. */
  exempt?: boolean;
  /** Role ids the member holds, excluding @everyone. Any role exempts. */
  roleCount: number;
  emailVerified: boolean;
  accountCreatedAt?: Date | string | null;
  memberJoinedAt?: Date | string | null;
  now?: number;
}

export interface VerificationGateResult {
  blocked: boolean;
  reason: VerificationBlockReason | null;
  /** When the restriction lifts on its own (time based reasons), ISO. */
  until: string | null;
}

const OPEN: VerificationGateResult = { blocked: false, reason: null, until: null };

function ms(value: Date | string | null | undefined): number | null {
  if (!value) return null;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : null;
}

/** Whether a member may talk (send, react, join voice) under the server's verification level. */
export function evaluateVerificationGate(input: VerificationGateInput): VerificationGateResult {
  const rank = VERIFICATION_LEVEL_RANK[input.level] ?? 0;
  if (rank === 0 || input.exempt || input.roleCount > 0) return OPEN;
  const now = input.now ?? Date.now();
  if (!input.emailVerified) return { blocked: true, reason: 'email', until: null };
  if (rank >= 2) {
    const created = ms(input.accountCreatedAt);
    if (created !== null && now - created < ACCOUNT_AGE_MS) {
      return { blocked: true, reason: 'account_age', until: new Date(created + ACCOUNT_AGE_MS).toISOString() };
    }
  }
  if (rank >= 3) {
    const joined = ms(input.memberJoinedAt);
    if (joined !== null && now - joined < MEMBER_AGE_MS) {
      return { blocked: true, reason: 'member_age', until: new Date(joined + MEMBER_AGE_MS).toISOString() };
    }
  }
  return OPEN;
}

/** The API error text for a verification block (the client shows its own translated banner). */
export function verificationErrorMessage(reason: VerificationBlockReason): string {
  switch (reason) {
    case 'email':
      return 'This server requires a verified email address before you can talk here';
    case 'account_age':
      return 'This server requires your account to be older than 5 minutes before you can talk here';
    case 'member_age':
      return 'This server requires you to be a member for 10 minutes before you can talk here';
  }
}

/**
 * Whether an image/video from this author is scanned by the explicit media
 * content filter. With no classifier available, scanned media is flagged as
 * sensitive and shown blurred until clicked. Age-restricted (NSFW) channels
 * are never scanned, as on Discord.
 */
export function shouldFilterMedia(input: {
  filter: ExplicitContentFilter;
  roleCount: number;
  channelNsfw?: boolean | null;
  exempt?: boolean;
}): boolean {
  if (input.channelNsfw) return false;
  if (input.filter === 'all_members') return true;
  if (input.filter === 'members_without_roles') return !input.exempt && input.roleCount === 0;
  return false;
}

/** Image and video attachments are the media the filter covers. */
export function isFilterableMedia(contentType: string | null | undefined): boolean {
  const ct = String(contentType || '').toLowerCase();
  return ct.startsWith('image/') || ct.startsWith('video/');
}

/** Marks scanned media as sensitive; returns a new array (other attachments untouched). */
export function flagSensitiveMedia<T extends { contentType?: string | null }>(attachments: T[]): Array<T & { sensitive?: boolean }> {
  return attachments.map((a) => (isFilterableMedia(a.contentType) ? { ...a, sensitive: true } : a));
}

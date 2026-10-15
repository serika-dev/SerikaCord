// Account standing (Discord-style): strikes, temporary restrictions and the
// resulting standing level, as pure rules. Storage + enforcement live in
// src/lib/services/trustSafety.ts; tests in tests/trust-safety.test.ts.
//
//   strike       a violation on the account; expires after STRIKE_EXPIRY_DAYS
//   restriction  a temporary limit (e.g. can't chat for 24h)
//   standing     all_good → limited → very_limited → at_risk → suspended
//
// MAX_STRIKES active strikes suspend (ban) the account. A banned account can
// still sign in, but only sees its standing and can appeal.

export const MAX_STRIKES = 5;
export const STRIKE_EXPIRY_DAYS = 180;
export const SCAM_CHAT_RESTRICTION_HOURS = 24;
export const APPEAL_MESSAGE_MAX = 2000;
export const APPEAL_MESSAGE_MIN = 10;

export const STRIKE_CATEGORIES = ['scam', 'csam', 'spam', 'harassment', 'hate', 'impersonation', 'nsfw', 'other'] as const;
export type StrikeCategory = (typeof STRIKE_CATEGORIES)[number];

export const RESTRICTION_TYPES = ['chat'] as const;
export type RestrictionType = (typeof RESTRICTION_TYPES)[number];

export type StandingLevel = 'all_good' | 'limited' | 'very_limited' | 'at_risk' | 'suspended';

export interface StrikeLike {
  createdAt: Date | string | null;
  expiresAt?: Date | string | null;
  revokedAt?: Date | string | null;
}

export interface RestrictionLike {
  until: Date | string | null;
  liftedAt?: Date | string | null;
}

function t(value: Date | string | null | undefined): number | null {
  if (!value) return null;
  const n = new Date(value).getTime();
  return Number.isFinite(n) ? n : null;
}

export function strikeExpiry(createdAt: Date, days = STRIKE_EXPIRY_DAYS): Date {
  return new Date(createdAt.getTime() + days * 24 * 3600_000);
}

/** A strike counts while it isn't revoked and hasn't expired. */
export function isStrikeActive(strike: StrikeLike, now = Date.now()): boolean {
  if (strike.revokedAt) return false;
  const exp = t(strike.expiresAt);
  return exp === null || exp > now;
}

export function isRestrictionActive(r: RestrictionLike, now = Date.now()): boolean {
  if (r.liftedAt) return false;
  const until = t(r.until);
  return until !== null && until > now;
}

export function activeStrikeCount(strikes: readonly StrikeLike[], now = Date.now()): number {
  return strikes.filter((s) => isStrikeActive(s, now)).length;
}

/** Whether issuing one more strike reaches the suspension threshold. */
export function reachesSuspension(activeCount: number): boolean {
  return activeCount >= MAX_STRIKES;
}

/**
 * Standing from the account state: suspended when banned; otherwise by active
 * strikes (0 → all good, 1 → limited, 2 → very limited, 3+ → at risk). An
 * active restriction makes a clean account at least "limited".
 */
export function computeStandingLevel(input: { banned: boolean; activeStrikes: number; activeRestrictions: number }): StandingLevel {
  if (input.banned) return 'suspended';
  if (input.activeStrikes >= 3) return 'at_risk';
  if (input.activeStrikes === 2) return 'very_limited';
  if (input.activeStrikes === 1 || input.activeRestrictions > 0) return 'limited';
  return 'all_good';
}

export function normalizeStrikeCategory(value: unknown): StrikeCategory {
  return typeof value === 'string' && (STRIKE_CATEGORIES as readonly string[]).includes(value) ? (value as StrikeCategory) : 'other';
}

/** Trims an appeal; null when too short / not text. */
export function normalizeAppealMessage(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, APPEAL_MESSAGE_MAX);
  return text.length >= APPEAL_MESSAGE_MIN ? text : null;
}

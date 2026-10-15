// Discord's server verification level and explicit media content filter, as
// pure rules (no DB): the server routes (send, react, join voice) and the
// composer banner both use them.
//
//   none       no restriction
//   low        must have a verified email
//   medium     + registered on SerikaCord for longer than N minutes (default 5)
//   high       + member of this server for longer than N minutes (default 10)
//   very_high  + a verified linked account (OAuth connection or DNS-verified
//              domain); SerikaCord's stand-in for Discord's phone check
//
// Servers tune the two waits and pick which actions stay locked until a
// member qualifies (VerificationOptions: e.g. reacting allowed, chatting not).
//
// As on Discord, the owner, administrators and members with any role (other
// than @everyone) are exempt; bots and system users are too.

export const VERIFICATION_LEVELS = ['none', 'low', 'medium', 'high', 'very_high'] as const;
export type VerificationLevel = (typeof VERIFICATION_LEVELS)[number];

export const CONTENT_FILTERS = ['disabled', 'members_without_roles', 'all_members'] as const;
export type ExplicitContentFilter = (typeof CONTENT_FILTERS)[number];

export const ACCOUNT_AGE_MS = 5 * 60_000;
export const MEMBER_AGE_MS = 10 * 60_000;

// ─── Customisation ────────────────────────────────────────────────────────────

/** What a member who doesn't meet the level yet may be stopped from doing. */
export const VERIFICATION_ACTIONS = ['send', 'attach', 'links', 'react', 'voice', 'threads'] as const;
export type VerificationAction = (typeof VERIFICATION_ACTIONS)[number];

/** Upper bound for either wait: 30 days. */
export const VERIFICATION_MAX_MINUTES = 30 * 24 * 60;

export interface VerificationOptions {
  /** medium+: minimum SerikaCord account age, minutes. */
  accountAgeMinutes: number;
  /** high+: minimum time as a member of this server, minutes. */
  memberAgeMinutes: number;
  /** Actions locked until the member qualifies. Empty means nothing is locked. */
  restrict: VerificationAction[];
}

export const DEFAULT_VERIFICATION_OPTIONS: VerificationOptions = {
  accountAgeMinutes: ACCOUNT_AGE_MS / 60_000,
  memberAgeMinutes: MEMBER_AGE_MS / 60_000,
  restrict: [...VERIFICATION_ACTIONS],
};

function minutes(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(VERIFICATION_MAX_MINUTES, Math.max(1, Math.round(n)));
}

/** Reads stored options (settings.moderation.verification), filling defaults. */
export function normalizeVerificationOptions(input: unknown): VerificationOptions {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const restrict = Array.isArray(raw.restrict)
    ? VERIFICATION_ACTIONS.filter((a) => (raw.restrict as unknown[]).includes(a))
    : [...DEFAULT_VERIFICATION_OPTIONS.restrict];
  return {
    accountAgeMinutes: minutes(raw.accountAgeMinutes, DEFAULT_VERIFICATION_OPTIONS.accountAgeMinutes),
    memberAgeMinutes: minutes(raw.memberAgeMinutes, DEFAULT_VERIFICATION_OPTIONS.memberAgeMinutes),
    restrict,
  };
}

/** Whether any of `actions` is locked for a blocked member under these options. */
export function restrictsAny(options: VerificationOptions, actions: readonly VerificationAction[]): boolean {
  return actions.some((a) => options.restrict.includes(a));
}

/** "5 minutes", "2 hours", "3 days" (English; API errors only, the client translates). */
export function formatVerificationWait(totalMinutes: number): string {
  const m = Math.max(1, Math.round(totalMinutes));
  if (m % 1440 === 0) return `${m / 1440} day${m === 1440 ? '' : 's'}`;
  if (m % 60 === 0) return `${m / 60} hour${m === 60 ? '' : 's'}`;
  return `${m} minute${m === 1 ? '' : 's'}`;
}

// A link: an explicit scheme, "www.", any domain followed by a path
// ("scam.info/x"), or a bare domain on a TLD commonly used for links.
const SCHEME_RE = /(?:[a-z][a-z0-9+.-]*:\/\/|\bwww\.)\S/i;
const DOMAIN_PATH_RE = /\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,24}\/\S/i;
const BARE_DOMAIN_RE = /\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|gg|io|co|xyz|ru|me|tv|app|dev|link|ly|to|cc|chat|info|site|online|shop|store|live|top|club|fun|click|pro|biz|gift|gifts|win|vip|icu|cfd|sbs|lol|ws|su|tk|ml|ga|cf|gq|pw|cn|uk|de|nl|fr|us|ca|au|io|ai|so|sh|gl|in|is|it)\b/i;

/** Whether message content carries a link (for the `links` restriction). */
export function containsLink(content: unknown): boolean {
  if (typeof content !== 'string' || !content) return false;
  return SCHEME_RE.test(content) || DOMAIN_PATH_RE.test(content) || BARE_DOMAIN_RE.test(content);
}

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

export type VerificationBlockReason = 'email' | 'account_age' | 'member_age' | 'connection';

export interface VerificationGateInput {
  level: VerificationLevel;
  /** Owner, administrator, bot, system user — never gated. */
  exempt?: boolean;
  /** Role ids the member holds, excluding @everyone. Any role exempts. */
  roleCount: number;
  emailVerified: boolean;
  accountCreatedAt?: Date | string | null;
  memberJoinedAt?: Date | string | null;
  /** very_high: has a verified linked account. */
  hasVerifiedConnection?: boolean;
  /** Custom waits; defaults to 5 / 10 minutes. */
  options?: Pick<VerificationOptions, 'accountAgeMinutes' | 'memberAgeMinutes'>;
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
  const accountAgeMs = (input.options?.accountAgeMinutes ?? ACCOUNT_AGE_MS / 60_000) * 60_000;
  const memberAgeMs = (input.options?.memberAgeMinutes ?? MEMBER_AGE_MS / 60_000) * 60_000;
  if (!input.emailVerified) return { blocked: true, reason: 'email', until: null };
  if (rank >= 4 && input.hasVerifiedConnection === false) return { blocked: true, reason: 'connection', until: null };
  if (rank >= 2) {
    const created = ms(input.accountCreatedAt);
    if (created !== null && now - created < accountAgeMs) {
      return { blocked: true, reason: 'account_age', until: new Date(created + accountAgeMs).toISOString() };
    }
  }
  if (rank >= 3) {
    const joined = ms(input.memberJoinedAt);
    if (joined !== null && now - joined < memberAgeMs) {
      return { blocked: true, reason: 'member_age', until: new Date(joined + memberAgeMs).toISOString() };
    }
  }
  return OPEN;
}

/** The API error text for a verification block (the client shows its own translated banner). */
export function verificationErrorMessage(
  reason: VerificationBlockReason,
  options: Pick<VerificationOptions, 'accountAgeMinutes' | 'memberAgeMinutes'> = DEFAULT_VERIFICATION_OPTIONS,
): string {
  switch (reason) {
    case 'email':
      return 'This server requires a verified email address before you can talk here';
    case 'account_age':
      return `This server requires your account to be older than ${formatVerificationWait(options.accountAgeMinutes)} before you can talk here`;
    case 'member_age':
      return `This server requires you to be a member for ${formatVerificationWait(options.memberAgeMinutes)} before you can talk here`;
    case 'connection':
      return 'This server requires a verified linked account (a connection or verified domain) before you can talk here';
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

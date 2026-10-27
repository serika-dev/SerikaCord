/**
 * App Directory listing rules (pure, client-safe).
 *
 * An application appears in the public bot library (/bots) and in Server
 * Settings → App Discovery when it:
 *   - has a bot user (bot_id),
 *   - is public (bot_public, anyone can add it),
 *   - is opted into the directory by its owner (directory_listed; NULL means
 *     "never chosen", which keeps the old behaviour: verified apps count as
 *     listed), and
 *   - has not been delisted by staff (directory_delisted).
 * Server-side the SQL in src/lib/services/appDirectory.ts mirrors
 * `isDirectoryVisible`. Tested in tests/app-directory.test.ts.
 */

export const APP_CATEGORIES = [
  'moderation', 'utility', 'music', 'games', 'fun', 'social', 'economy',
  'productivity', 'art', 'education', 'developer-tools', 'other',
] as const;

export type AppCategory = typeof APP_CATEGORIES[number];

const CATEGORY_SET: ReadonlySet<string> = new Set(APP_CATEGORIES);

export function isAppCategory(value: unknown): value is AppCategory {
  return typeof value === 'string' && CATEGORY_SET.has(value);
}

type GtFn = (text: string, vars?: Record<string, unknown>) => string;

/** Display name of a category. Each label is its own literal gt() call (gt-next compile-time hashing). */
export function appCategoryLabel(id: string, gt: GtFn): string {
  switch (id) {
    case 'moderation': return gt('Moderation');
    case 'utility': return gt('Utility');
    case 'music': return gt('Music');
    case 'games': return gt('Games');
    case 'fun': return gt('Fun');
    case 'social': return gt('Social');
    case 'economy': return gt('Economy');
    case 'productivity': return gt('Productivity');
    case 'art': return gt('Art & Creativity');
    case 'education': return gt('Education');
    case 'developer-tools': return gt('Developer Tools');
    case 'other': return gt('Other');
    default: return id;
  }
}

// ─── Limits ──────────────────────────────────────────────────────────────────

export const LISTING_LIMITS = {
  shortDescription: 200,
  longDescription: 4000,
  categories: 3,
  tags: 5,
  tagLength: 24,
  url: 512,
  delistReason: 500,
  verificationNote: 500,
} as const;

/** Bots must be in this many servers before they can apply for verification. */
export const VERIFICATION_SERVER_THRESHOLD = 100;

/** After a rejection, owners wait this long before applying again. */
export const VERIFICATION_REAPPLY_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

/** When a rejected app may apply again, or null when there is no cooldown. */
export function verificationCooldownEndsAt(app: { verificationStatus?: string | null; verificationReviewedAt?: Date | string | null }): Date | null {
  if (app.verificationStatus !== 'rejected' || !app.verificationReviewedAt) return null;
  const reviewed = new Date(app.verificationReviewedAt).getTime();
  if (!Number.isFinite(reviewed)) return null;
  return new Date(reviewed + VERIFICATION_REAPPLY_COOLDOWN_MS);
}

// ─── Visibility ──────────────────────────────────────────────────────────────

export interface ListingFlags {
  botId?: string | null;
  botPublic?: boolean | null;
  verified?: boolean | null;
  directoryListed?: boolean | null;
  directoryDelisted?: boolean | null;
}

/**
 * The owner's choice. Apps that never chose keep the old "listed = verified"
 * meaning, but only while the bot is public: a private app is listed only
 * when its owner explicitly opted in.
 */
export function isOwnerListed(app: ListingFlags): boolean {
  if (app.directoryListed !== null && app.directoryListed !== undefined) return app.directoryListed;
  return !!app.verified && app.botPublic !== false;
}

/** botPublic defaults to true in the schema, so only an explicit false makes an app private. */
export function isPublicBot(app: ListingFlags): boolean {
  return !!app.botId && app.botPublic !== false;
}

/** Shown in /bots, App Discovery and the public directory API. */
export function isDirectoryVisible(app: ListingFlags): boolean {
  return isOwnerListed(app) && !app.directoryDelisted && isPublicBot(app);
}

/**
 * Whether the public detail page (/bots/:id) may show the app: listed and not
 * delisted. A listed app that was later made private still has a page, with
 * "Add to Server" disabled and an explanation, but only when its owner
 * explicitly opted in (isOwnerListed never counts a private, never-chosen app).
 */
export function isDirectoryPageVisible(app: ListingFlags): boolean {
  return isOwnerListed(app) && !app.directoryDelisted && !!app.botId;
}

export type DirectoryState = 'draft' | 'listed' | 'delisted' | 'hidden';

/**
 * Listing status for the developer portal: Draft (not opted in), Listed,
 * Delisted (by staff) or Hidden (opted in, but private or without a bot, so
 * nobody can find it).
 */
export function directoryState(app: ListingFlags): DirectoryState {
  if (app.directoryDelisted) return 'delisted';
  if (!isOwnerListed(app)) return 'draft';
  return isPublicBot(app) ? 'listed' : 'hidden';
}

export type ListingProblem = 'no_bot' | 'not_public' | 'missing_description' | 'missing_category';

/** What still blocks an owner from listing the app. Empty = ready. */
export function listingProblems(app: ListingFlags & { shortDescription?: string | null; categories?: readonly string[] | null }): ListingProblem[] {
  const problems: ListingProblem[] = [];
  if (!app.botId) problems.push('no_bot');
  else if (app.botPublic === false) problems.push('not_public');
  if (!app.shortDescription?.trim()) problems.push('missing_description');
  if (!(app.categories ?? []).some(isAppCategory)) problems.push('missing_category');
  return problems;
}

// ─── Verification ────────────────────────────────────────────────────────────

export interface VerificationRequirement {
  id: 'bot' | 'servers';
  met: boolean;
  current?: number;
  required?: number;
}

export function verificationRequirements(app: { botId?: string | null }, serverCount: number): VerificationRequirement[] {
  return [
    { id: 'bot', met: !!app.botId },
    { id: 'servers', met: serverCount >= VERIFICATION_SERVER_THRESHOLD, current: serverCount, required: VERIFICATION_SERVER_THRESHOLD },
  ];
}

// ─── Input validation ────────────────────────────────────────────────────────

// Control characters (except tab and newline) are stripped from free text.
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

export function cleanText(value: string, max: number): string {
  return value.replace(CONTROL_CHARS, '').replace(/\r\n?/g, '\n').trim().slice(0, max);
}

/** http(s) URLs only (no javascript:, data:, file: ...), with a host and no credentials. */
export function isSafeHttpUrl(value: unknown, max: number = LISTING_LIMITS.url): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) return false;
  try {
    const u = new URL(value);
    return (u.protocol === 'https:' || u.protocol === 'http:') && !!u.hostname && !u.username && !u.password;
  } catch {
    return false;
  }
}

/** Returns the URL when it is safe to put in an href/src, else null. */
export function safeHttpUrlOrNull(value: unknown): string | null {
  return isSafeHttpUrl(value) ? value : null;
}

export interface ListingPatch {
  listed?: boolean;
  shortDescription?: string;
  longDescription?: string;
  categories?: AppCategory[];
  tags?: string[];
  website?: string | null;
  supportUrl?: string | null;
  termsOfServiceUrl?: string | null;
  privacyPolicyUrl?: string | null;
  coverImage?: null;
}

export type ListingPatchResult = { ok: true; patch: ListingPatch } | { ok: false; error: string };

const URL_FIELDS = ['website', 'supportUrl', 'termsOfServiceUrl', 'privacyPolicyUrl'] as const;

/** Validate an owner's directory PATCH body. Unknown keys are ignored. */
export function validateListingPatch(body: unknown): ListingPatchResult {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'Invalid body' };
  const b = body as Record<string, unknown>;
  const patch: ListingPatch = {};

  if (b.listed !== undefined) {
    if (typeof b.listed !== 'boolean') return { ok: false, error: 'listed must be a boolean' };
    patch.listed = b.listed;
  }
  if (b.shortDescription !== undefined) {
    if (typeof b.shortDescription !== 'string') return { ok: false, error: 'shortDescription must be a string' };
    if (b.shortDescription.length > LISTING_LIMITS.shortDescription * 2) return { ok: false, error: 'Short description is too long' };
    const v = cleanText(b.shortDescription, Number.MAX_SAFE_INTEGER).replace(/\s*\n\s*/g, ' ');
    if (v.length > LISTING_LIMITS.shortDescription) return { ok: false, error: `Short description must be ${LISTING_LIMITS.shortDescription} characters or fewer` };
    patch.shortDescription = v;
  }
  if (b.longDescription !== undefined) {
    if (typeof b.longDescription !== 'string') return { ok: false, error: 'longDescription must be a string' };
    const v = cleanText(b.longDescription, Number.MAX_SAFE_INTEGER);
    if (v.length > LISTING_LIMITS.longDescription) return { ok: false, error: `Description must be ${LISTING_LIMITS.longDescription} characters or fewer` };
    patch.longDescription = v;
  }
  if (b.categories !== undefined) {
    if (!Array.isArray(b.categories)) return { ok: false, error: 'categories must be an array' };
    const unique = [...new Set(b.categories)];
    if (!unique.every(isAppCategory)) return { ok: false, error: 'Unknown category' };
    if (unique.length > LISTING_LIMITS.categories) return { ok: false, error: `Pick at most ${LISTING_LIMITS.categories} categories` };
    patch.categories = unique as AppCategory[];
  }
  if (b.tags !== undefined) {
    if (!Array.isArray(b.tags) || b.tags.length > LISTING_LIMITS.tags * 4) return { ok: false, error: 'tags must be an array' };
    const tags: string[] = [];
    for (const raw of b.tags) {
      if (typeof raw !== 'string') return { ok: false, error: 'Tags must be strings' };
      const tag = cleanText(raw, Number.MAX_SAFE_INTEGER).replace(/\s+/g, ' ');
      if (!tag) continue;
      if (tag.length > LISTING_LIMITS.tagLength) return { ok: false, error: `Tags must be ${LISTING_LIMITS.tagLength} characters or fewer` };
      if (!tags.some((t) => t.toLowerCase() === tag.toLowerCase())) tags.push(tag);
    }
    if (tags.length > LISTING_LIMITS.tags) return { ok: false, error: `Add at most ${LISTING_LIMITS.tags} tags` };
    patch.tags = tags;
  }
  for (const key of URL_FIELDS) {
    const raw = b[key];
    if (raw === undefined) continue;
    if (raw === null || raw === '') { patch[key] = null; continue; }
    if (typeof raw !== 'string') return { ok: false, error: `${key} must be a string` };
    const v = raw.trim();
    if (!v) { patch[key] = null; continue; }
    if (!isSafeHttpUrl(v)) return { ok: false, error: `${key} must be an http(s) URL` };
    patch[key] = v;
  }
  if (b.coverImage !== undefined) {
    // Covers are uploaded through POST .../cover; the directory PATCH can only remove one.
    if (b.coverImage !== null) return { ok: false, error: 'Upload a cover image instead of passing a URL' };
    patch.coverImage = null;
  }
  return { ok: true, patch };
}

export const APP_NAME_MAX = 32;

export interface GeneralAppPatch {
  name?: string;
  description?: string;
  tags?: string[];
  icon?: null;
  coverImage?: null;
  botPublic?: boolean;
  botRequireCodeGrant?: boolean;
  termsOfServiceUrl?: string | null;
  privacyPolicyUrl?: string | null;
  customInstallUrl?: string | null;
}

export type GeneralAppPatchResult = { ok: true; patch: GeneralAppPatch } | { ok: false; error: string };

/**
 * Validate the publicly visible fields of PATCH /api/developers/applications/:id
 * (they show in /bots and App Discovery). Only keys present in `body` are
 * returned. Images can only be cleared here; uploads set them.
 */
export function validateGeneralAppPatch(body: Record<string, unknown>): GeneralAppPatchResult {
  const patch: GeneralAppPatch = {};
  if (body.name !== undefined) {
    if (typeof body.name !== 'string') return { ok: false, error: 'name must be a string' };
    const name = cleanText(body.name, Number.MAX_SAFE_INTEGER).replace(/\s+/g, ' ');
    if (!name) return { ok: false, error: 'Name is required' };
    if (name.length > APP_NAME_MAX) return { ok: false, error: `Name must be ${APP_NAME_MAX} characters or less` };
    patch.name = name;
  }
  if (body.description !== undefined || body.tags !== undefined) {
    const r = validateListingPatch({
      ...(body.description !== undefined ? { shortDescription: body.description ?? '' } : {}),
      ...(body.tags !== undefined ? { tags: body.tags ?? [] } : {}),
    });
    if (!r.ok) return { ok: false, error: r.error.replace(/^Short description/, 'Description').replace(/^shortDescription/, 'description') };
    if (r.patch.shortDescription !== undefined) patch.description = r.patch.shortDescription;
    if (r.patch.tags !== undefined) patch.tags = r.patch.tags;
  }
  for (const key of ['icon', 'coverImage'] as const) {
    const v = body[key];
    if (v === undefined) continue;
    if (v !== null && v !== '') return { ok: false, error: `Upload the ${key === 'icon' ? 'icon' : 'cover image'} instead of passing a URL` };
    patch[key] = null;
  }
  for (const key of ['botPublic', 'botRequireCodeGrant'] as const) {
    const v = body[key];
    if (v === undefined) continue;
    if (typeof v !== 'boolean') return { ok: false, error: `${key} must be a boolean` };
    patch[key] = v;
  }
  for (const key of ['termsOfServiceUrl', 'privacyPolicyUrl', 'customInstallUrl'] as const) {
    const v = body[key];
    if (v === undefined) continue;
    if (v === null || v === '') { patch[key] = null; continue; }
    if (typeof v !== 'string' || !isSafeHttpUrl(v.trim())) return { ok: false, error: `${key} must be an http(s) URL` };
    patch[key] = v.trim();
  }
  return { ok: true, patch };
}

/** Staff moderation reasons and verification notes: plain text, trimmed and capped. */
export function cleanStaffReason(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const v = cleanText(value, max);
  return v || null;
}

// ─── Install links ───────────────────────────────────────────────────────────

const INSTALL_SCOPES = new Set(['bot', 'applications.commands']);

/**
 * The OAuth2 "Add to Server" link for an app: its saved install scopes
 * (always including bot) and permissions. Saved permissions use Serika's bit
 * numbering; snowflake-format apps read link permissions in Discord's, so
 * the caller passes the converter (src/lib/botapi/permissionBits.ts).
 */
export function buildInstallUrl(
  app: { clientId: string; installParams?: unknown; apiIdFormat?: string | null },
  opts: { guildId?: string | null; toDiscordBits?: (bits: string) => string } = {},
): string {
  const params = (app.installParams && typeof app.installParams === 'object' ? app.installParams : {}) as { scopes?: unknown; permissions?: unknown };
  const saved = Array.isArray(params.scopes) ? params.scopes.filter((s): s is string => typeof s === 'string' && INSTALL_SCOPES.has(s)) : [];
  const scopes = ['bot', ...saved.filter((s) => s !== 'bot')];
  if (!Array.isArray(params.scopes)) scopes.push('applications.commands');
  let permissions = typeof params.permissions === 'string' && /^\d{1,40}$/.test(params.permissions) ? params.permissions : '0';
  if (app.apiIdFormat === 'snowflake' && opts.toDiscordBits) permissions = opts.toDiscordBits(permissions);
  const q = new URLSearchParams({ client_id: app.clientId, scope: [...new Set(scopes)].join(' '), permissions });
  if (opts.guildId) q.set('guild_id', opts.guildId);
  return `/oauth2/authorize?${q.toString()}`;
}

// Badge definitions shared by the API and the client: the shape, the lucide
// icon allowlist and input validation. Badges live in the `badges` table so
// staff can create/edit them without a deploy; users.badges stores the ids.
//
// Keep this file pure data + functions — no React, no lucide imports — so the
// Elysia API can use it without pulling client code into the server bundle.
// The name → component map lives in ./icons.ts (client only).

/**
 * Lucide icons a badge may use, by component name. Admins pick from this list;
 * the API rejects anything else so a badge can never reference an arbitrary
 * export. Adding an icon here also requires mapping it in ./icons.ts
 * (TypeScript enforces that).
 */
export const BADGE_ICON_NAMES = [
  // Staff & roles
  'ShieldCheck', 'Shield', 'ShieldHalf', 'ShieldAlert', 'BadgeCheck', 'Crown', 'Gavel', 'Hammer', 'Wrench',
  // Community
  'Handshake', 'HeartHandshake', 'HandHeart', 'Heart', 'Users', 'UserStar', 'UserCheck', 'Smile', 'PartyPopper', 'Gift', 'Cake',
  // Development
  'Code', 'Terminal', 'Bot', 'Bug', 'FlaskConical', 'Cpu', 'Atom', 'Braces', 'GitBranch', 'Server', 'Database',
  // Achievements
  'Star', 'Sparkles', 'Sparkle', 'Award', 'Trophy', 'Medal', 'Gem', 'Diamond', 'Flame', 'Zap', 'Rocket', 'Target', 'Flag', 'Infinity', 'Hourglass',
  // Creative
  'Music', 'Headphones', 'Mic', 'Palette', 'Brush', 'PenTool', 'Camera', 'Film', 'Gamepad2', 'Joystick', 'Dice5', 'Puzzle',
  // Nature & fun
  'Moon', 'Sun', 'Snowflake', 'Leaf', 'Clover', 'Flower2', 'Cat', 'Dog', 'PawPrint', 'Ghost', 'Skull', 'Coffee', 'Pizza',
  // Misc
  'Globe', 'Languages', 'Megaphone', 'BookOpen', 'GraduationCap', 'Lightbulb', 'Lock', 'Key', 'Eye', 'Compass', 'Anchor', 'Feather', 'Swords', 'WandSparkles', 'Orbit', 'Telescope',
] as const;

export type BadgeIconName = (typeof BADGE_ICON_NAMES)[number];

/** Icon used when a badge has neither a valid icon nor an image. */
export const DEFAULT_BADGE_ICON: BadgeIconName = 'Award';

const ICON_NAMES: ReadonlySet<string> = new Set(BADGE_ICON_NAMES);

export function isBadgeIconName(value: unknown): value is BadgeIconName {
  return typeof value === 'string' && ICON_NAMES.has(value);
}

export interface BadgeDefinition {
  /** Stable slug stored in users.badges, e.g. `serikacord_developer`. */
  id: string;
  name: string;
  description: string;
  /** Lucide icon name from BADGE_ICON_NAMES, or null when iconUrl is used. */
  icon: string | null;
  /** Custom image (https URL, or a /path on our CDN). Wins over `icon`. */
  iconUrl: string | null;
  /** 6-digit hex, e.g. `#8B5CF6` (UI appends alpha suffixes to it). */
  color: string;
  /** Higher sorts first. */
  priority: number;
  /** Assigned by recalculateUserBadges from user state, not by hand. */
  automatic?: boolean;
  /** Hidden badges are left out of the public list, so they render nowhere. */
  hidden?: boolean;
}

/** What GET /api/badges returns per badge. */
export type PublicBadge = Pick<BadgeDefinition, 'id' | 'name' | 'description' | 'icon' | 'iconUrl' | 'color' | 'priority'>;

export const BADGE_ID_PATTERN = /^[a-z0-9_]{2,40}$/;
export const BADGE_NAME_MAX = 64;
export const BADGE_DESCRIPTION_MAX = 200;
export const BADGE_PRIORITY_MIN = 0;
export const BADGE_PRIORITY_MAX = 1000;
export const BADGE_ICON_URL_MAX = 512;

const HEX6 = /^#[0-9a-fA-F]{6}$/;
const HEX3 = /^#[0-9a-fA-F]{3}$/;
// CDN object paths only: no protocol-relative `//host`, no `..`, no
// query/fragment tricks — just a plain key under BADGE_CDN_ORIGIN.
const SAFE_PATH = /^\/[A-Za-z0-9._~\-/%]+$/;

/** Where a `/path` iconUrl is served from (B2 bucket behind cdn.serika.chat). */
export const BADGE_CDN_ORIGIN = 'https://cdn.serika.chat';

export function isValidBadgeId(value: unknown): value is string {
  return typeof value === 'string' && BADGE_ID_PATTERN.test(value);
}

/** `#abc` → `#aabbcc`; returns null for anything that is not a hex colour. */
export function normalizeBadgeColor(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  if (HEX6.test(v)) return v;
  if (HEX3.test(v)) return `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`;
  return null;
}

/**
 * Accept an https URL (no embedded credentials) or a `/path` on our CDN.
 * Anything else — http:, data:, javascript:, `//host`, `../` — is rejected.
 */
export function normalizeBadgeIconUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  if (!v || v.length > BADGE_ICON_URL_MAX) return null;
  if (v.startsWith('/')) {
    if (v.startsWith('//') || !SAFE_PATH.test(v) || v.split('/').includes('..')) return null;
    return v;
  }
  try {
    const url = new URL(v);
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) return null;
    const out = url.toString();
    return out.length <= BADGE_ICON_URL_MAX ? out : null;
  } catch {
    return null;
  }
}

/** Absolute URL to render for a stored iconUrl (`/path` → CDN). */
export function badgeIconSrc(iconUrl: string | null | undefined): string | null {
  if (!iconUrl) return null;
  return iconUrl.startsWith('/') ? `${BADGE_CDN_ORIGIN}${iconUrl}` : iconUrl;
}

export interface BadgeWriteInput {
  id?: string;
  name?: string;
  description?: string;
  icon?: string | null;
  iconUrl?: string | null;
  color?: string;
  priority?: number;
  hidden?: boolean;
}

export type BadgeInputResult =
  | { ok: true; value: BadgeWriteInput }
  | { ok: false; error: string };

/**
 * Validate and normalise an admin badge payload. `create` requires id, name
 * and color; `update` validates only the fields present. Used by the API (the
 * authority) and the admin panel (instant feedback before submitting).
 * `automatic` is intentionally not accepted: it is owned by the code that
 * computes those badges (src/lib/services/badges.ts).
 */
export function validateBadgeInput(input: Record<string, unknown>, mode: 'create' | 'update'): BadgeInputResult {
  const out: BadgeWriteInput = {};

  if (mode === 'create') {
    const id = typeof input.id === 'string' ? input.id.trim() : '';
    if (!isValidBadgeId(id)) {
      return { ok: false, error: 'Badge ID must be 2–40 characters of lowercase letters, numbers or underscores' };
    }
    out.id = id;
  }

  if (input.name !== undefined || mode === 'create') {
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    if (!name) return { ok: false, error: 'Name is required' };
    if (name.length > BADGE_NAME_MAX) return { ok: false, error: `Name must be at most ${BADGE_NAME_MAX} characters` };
    out.name = name;
  }

  if (input.description !== undefined) {
    if (typeof input.description !== 'string') return { ok: false, error: 'Description must be text' };
    const description = input.description.trim();
    if (description.length > BADGE_DESCRIPTION_MAX) {
      return { ok: false, error: `Description must be at most ${BADGE_DESCRIPTION_MAX} characters` };
    }
    out.description = description;
  } else if (mode === 'create') {
    out.description = '';
  }

  if (input.color !== undefined || mode === 'create') {
    const color = normalizeBadgeColor(input.color);
    if (!color) return { ok: false, error: 'Color must be a hex value like #8B5CF6' };
    out.color = color;
  }

  if (input.priority !== undefined) {
    const p = input.priority;
    if (typeof p !== 'number' || !Number.isInteger(p) || p < BADGE_PRIORITY_MIN || p > BADGE_PRIORITY_MAX) {
      return { ok: false, error: `Priority must be a whole number from ${BADGE_PRIORITY_MIN} to ${BADGE_PRIORITY_MAX}` };
    }
    out.priority = p;
  } else if (mode === 'create') {
    out.priority = 0;
  }

  if (input.icon !== undefined) {
    if (input.icon === null || input.icon === '') {
      out.icon = null;
    } else if (isBadgeIconName(input.icon)) {
      out.icon = input.icon;
    } else {
      return { ok: false, error: 'Icon is not in the allowed icon list' };
    }
  }

  if (input.iconUrl !== undefined) {
    if (input.iconUrl === null || input.iconUrl === '') {
      out.iconUrl = null;
    } else {
      const url = normalizeBadgeIconUrl(input.iconUrl);
      if (!url) return { ok: false, error: 'Image URL must be an https:// URL or a /path on the Serika CDN' };
      out.iconUrl = url;
    }
  }

  if (mode === 'create' && !out.icon && !out.iconUrl) {
    out.icon = DEFAULT_BADGE_ICON;
  }

  if (input.hidden !== undefined) {
    if (typeof input.hidden !== 'boolean') return { ok: false, error: 'Hidden must be true or false' };
    out.hidden = input.hidden;
  }

  return { ok: true, value: out };
}

/** Priority desc, then name — the order badges render in everywhere. */
export function compareBadges(a: Pick<BadgeDefinition, 'priority' | 'name'>, b: Pick<BadgeDefinition, 'priority' | 'name'>): number {
  return b.priority - a.priority || a.name.localeCompare(b.name);
}

/**
 * Turn a user's badge ids into definitions, dropping unknown/hidden ids and
 * duplicates, sorted for display.
 */
export function resolveBadgeIds(
  ids: readonly string[] | null | undefined,
  byId: ReadonlyMap<string, BadgeDefinition>,
): BadgeDefinition[] {
  if (!ids || ids.length === 0) return [];
  const seen = new Set<string>();
  const out: BadgeDefinition[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const def = byId.get(id);
    if (def && !def.hidden) out.push(def);
  }
  return out.sort(compareBadges);
}

export function toPublicBadge(b: BadgeDefinition): PublicBadge {
  return {
    id: b.id,
    name: b.name,
    description: b.description,
    icon: b.icon,
    iconUrl: b.iconUrl,
    color: b.color,
    priority: b.priority,
  };
}

/**
 * Defensive parse of a badge list from the network or localStorage: keeps only
 * well-formed entries and re-validates icon names / image URLs so nothing
 * unexpected reaches an <img src>. Returns null if `raw` is not an array.
 */
export function sanitizeBadgeList(raw: unknown): BadgeDefinition[] | null {
  if (!Array.isArray(raw)) return null;
  const out: BadgeDefinition[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    if (!isValidBadgeId(r.id) || typeof r.name !== 'string') continue;
    const color = normalizeBadgeColor(r.color);
    if (!color) continue;
    out.push({
      id: r.id,
      name: r.name.slice(0, BADGE_NAME_MAX),
      description: typeof r.description === 'string' ? r.description.slice(0, BADGE_DESCRIPTION_MAX) : '',
      icon: isBadgeIconName(r.icon) ? r.icon : null,
      iconUrl: r.iconUrl ? normalizeBadgeIconUrl(r.iconUrl) : null,
      color,
      priority: typeof r.priority === 'number' && Number.isFinite(r.priority) ? r.priority : 0,
      automatic: r.automatic === true,
      hidden: r.hidden === true,
    });
  }
  return out;
}

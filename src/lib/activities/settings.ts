/**
 * Activities (Embedded App SDK) settings for an application: validation of
 * what the developer portal saves, and the URL-mapping rules the Activities
 * proxy routes by. Pure, no I/O. Design: docs/architecture/activities.md.
 *
 * URL mappings follow Discord's portal rules: a `prefix` path ("/" is the root
 * mapping that serves the app itself) and a protocol-less `target`
 * ("example.com" or "api.example.com/v2"). `{name}` tokens in the prefix match
 * one path segment and can be used in the target host, e.g.
 * `/google/{subdomain}` -> `{subdomain}.google.com`. Mappings are matched in
 * order (first match wins, like Discord), except the root mapping, which is
 * always tried last.
 */

export const ACTIVITY_LIMITS = {
  MAPPINGS: 30,
  PREFIX: 128,
  TARGET: 255,
  DISPLAY_NAME: 64,
  MAX_PARTICIPANTS: 100,
} as const;

/** Platforms an Activity can say it supports (Discord: web, iOS, Android; we add the desktop app). */
export const ACTIVITY_PLATFORMS = ['web', 'desktop', 'ios', 'android'] as const;
export type ActivityPlatform = (typeof ACTIVITY_PLATFORMS)[number];

/** The SDK's OrientationLockState values. */
export const OrientationLockState = { UNLOCKED: 1, PORTRAIT: 2, LANDSCAPE: 3 } as const;
export type OrientationLock = (typeof OrientationLockState)[keyof typeof OrientationLockState];

export interface UrlMapping {
  prefix: string;
  target: string;
}

export interface ActivitySettings {
  enabled: boolean;
  urlMappings: UrlMapping[];
  supportedPlatforms: ActivityPlatform[];
  /** Default orientation lock on phones / tablets. */
  orientationLockPhone: OrientationLock;
  orientationLockTablet: OrientationLock;
  /** Only adults may launch or join (Discord's "age gate"). */
  ageGated: boolean;
  /** Name shown on the shelf and invitation card; null = the application's name. */
  displayName: string | null;
  /** Cover art shown on the shelf and invitation card (an app-owned CDN URL). */
  imageUrl: string | null;
}

export const DEFAULT_ACTIVITY_SETTINGS: ActivitySettings = {
  enabled: false,
  urlMappings: [],
  supportedPlatforms: ['web', 'desktop'],
  orientationLockPhone: OrientationLockState.UNLOCKED,
  orientationLockTablet: OrientationLockState.UNLOCKED,
  ageGated: false,
  displayName: null,
  imageUrl: null,
};

/** Application flag Discord sets on apps with an Activity. */
export const APPLICATION_FLAG_EMBEDDED = 1 << 17;

/** Paths the proxy keeps for itself: never routed to the app. */
export const RESERVED_PATH_PREFIXES = ['/.serika', '/.proxy', '/.well-known/serika'] as const;

const TOKEN_RE = /\{([a-z]+)\}/g;
const HAS_TOKEN_RE = /\{[a-z]+\}/;
const PREFIX_SEGMENT_RE = /^(?:[A-Za-z0-9._~-]+|\{[a-z]+\})+$/;
const HOST_LABEL_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?|\{[a-z]+\})$/;
const TARGET_PATH_SEGMENT_RE = /^[A-Za-z0-9._~!$&'()*+,;=:@%-]+$/;
const BLOCKED_HOST_SUFFIXES = ['localhost', 'local', 'internal', 'lan', 'home', 'arpa', 'test', 'invalid', 'example', 'onion'];

export type MappingError = { index: number | null; field: 'prefix' | 'target' | null; message: string };

/**
 * Normalize and validate one prefix: starts with "/", no trailing slash (except
 * the root), segments of URL-safe characters or `{token}`s, no dot segments,
 * not one of the proxy's reserved paths.
 */
export function normalizePrefix(raw: unknown): { ok: true; prefix: string; tokens: string[] } | { ok: false; message: string } {
  if (typeof raw !== 'string') return { ok: false, message: 'Prefix must be a string.' };
  let p = raw.trim();
  if (!p) return { ok: false, message: 'Prefix is required.' };
  if (!p.startsWith('/')) p = `/${p}`;
  if (p.length > 1) p = p.replace(/\/+$/, '');
  if (p.length > ACTIVITY_LIMITS.PREFIX) return { ok: false, message: `Prefix must be at most ${ACTIVITY_LIMITS.PREFIX} characters.` };
  if (p === '/') return { ok: true, prefix: '/', tokens: [] };
  const segments = p.slice(1).split('/');
  for (const seg of segments) {
    if (!seg) return { ok: false, message: 'Prefix cannot contain empty path segments ("//").' };
    if (seg === '.' || seg === '..') return { ok: false, message: 'Prefix cannot contain "." or ".." segments.' };
    if (!PREFIX_SEGMENT_RE.test(seg)) return { ok: false, message: 'Prefix can only use letters, numbers, "-", "_", ".", "~" and {name} parameters.' };
  }
  const lower = p.toLowerCase();
  if (RESERVED_PATH_PREFIXES.some((r) => lower === r || lower.startsWith(`${r}/`))) {
    return { ok: false, message: `"${segments[0]}" is reserved by SerikaCord's Activity proxy.` };
  }
  const tokens = [...p.matchAll(TOKEN_RE)].map((m) => m[1]);
  if (new Set(tokens).size !== tokens.length) return { ok: false, message: 'Each {name} parameter can appear only once in a prefix.' };
  return { ok: true, prefix: p, tokens };
}

/** True when `host` is an IPv4 or IPv6 literal (incl. bracketed and integer forms). */
export function isIpLiteral(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, '');
  if (h.includes(':')) return true; // IPv6
  if (/^\d+$/.test(h)) return true; // integer IPv4 (http://2130706433)
  if (/^0x[0-9a-f]+$/i.test(h)) return true;
  return /^[0-9.]+$/.test(h) || /^(?:(?:0x[0-9a-f]+|\d+)\.){1,3}(?:0x[0-9a-f]+|\d+)$/i.test(h);
}

/**
 * Normalize and validate one target: protocol-less host[:port][/path], with a
 * public-looking DNS name (no IP literals, no single-label or internal names,
 * not the Activities domain itself). Host labels may be `{token}`s defined by
 * the prefix.
 */
export function normalizeTarget(
  raw: unknown,
  prefixTokens: string[],
  opts: { blockedHosts?: string[] } = {},
): { ok: true; target: string } | { ok: false; message: string } {
  if (typeof raw !== 'string') return { ok: false, message: 'Target must be a string.' };
  let t = raw.trim();
  if (!t) return { ok: false, message: 'Target is required.' };
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(t)) return { ok: false, message: 'Leave out the protocol: use "example.com", not "https://example.com".' };
  if (t.length > ACTIVITY_LIMITS.TARGET) return { ok: false, message: `Target must be at most ${ACTIVITY_LIMITS.TARGET} characters.` };
  if (/[\s\\?#@]/.test(t)) return { ok: false, message: 'Target cannot contain spaces, "\\", "?", "#" or "@".' };
  t = t.replace(/\/+$/, '');
  const slash = t.indexOf('/');
  const authority = (slash === -1 ? t : t.slice(0, slash)).toLowerCase();
  const path = slash === -1 ? '' : t.slice(slash);

  let host = authority;
  let port = '';
  const colon = authority.lastIndexOf(':');
  if (colon !== -1 && !authority.startsWith('[')) {
    host = authority.slice(0, colon);
    port = authority.slice(colon + 1);
    if (!/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535) return { ok: false, message: 'Target port must be between 1 and 65535.' };
  }
  host = host.replace(/\.$/, '');
  if (!host) return { ok: false, message: 'Target needs a host name.' };
  if (isIpLiteral(host)) return { ok: false, message: 'Target must be a domain name, not an IP address.' };
  const labels = host.split('.');
  if (labels.length < 2) return { ok: false, message: 'Target must be a full domain name like "example.com".' };
  for (const label of labels) {
    if (!HOST_LABEL_RE.test(label)) return { ok: false, message: `"${label}" is not a valid part of a domain name.` };
  }
  const tld = labels[labels.length - 1];
  if (HAS_TOKEN_RE.test(tld)) return { ok: false, message: 'The last part of the target domain cannot be a {name} parameter.' };
  if (labels.slice(-2).every((l) => l.startsWith('{'))) return { ok: false, message: 'Target must name a fixed domain, not only {name} parameters.' };
  if (BLOCKED_HOST_SUFFIXES.includes(tld)) return { ok: false, message: 'Target must be a public domain name.' };
  for (const blocked of opts.blockedHosts ?? []) {
    const b = blocked.toLowerCase().replace(/\.$/, '');
    if (b && (host === b || host.endsWith(`.${b}`))) return { ok: false, message: 'Target cannot point at the Activities domain.' };
  }
  const used = [...host.matchAll(TOKEN_RE)].map((m) => m[1]);
  for (const name of used) {
    if (!prefixTokens.includes(name)) return { ok: false, message: `{${name}} is not defined in the prefix.` };
  }
  if (path) {
    if (HAS_TOKEN_RE.test(path)) return { ok: false, message: '{name} parameters can only be used in the target host.' };
    for (const seg of path.slice(1).split('/')) {
      if (!seg || seg === '.' || seg === '..' || !TARGET_PATH_SEGMENT_RE.test(seg)) return { ok: false, message: 'Target path contains an invalid segment.' };
    }
  }
  return { ok: true, target: `${host}${port ? `:${port}` : ''}${path}` };
}

/** Earlier mapping whose prefix is a whole-segment prefix of `later` (so `later` is unreachable). */
export function shadowingPrefix(earlier: string, later: string): boolean {
  if (earlier === '/' || earlier === later) return false;
  const e = earlier.split('/');
  const l = later.split('/');
  if (e.length > l.length) return false;
  return e.every((seg, i) => seg === l[i] || /^\{[a-z]+\}$/.test(seg));
}

/**
 * Validate the whole mapping list. When `requireRoot` (Activities enabled),
 * exactly one root ("/") mapping must exist. Returns warnings for mappings an
 * earlier, shorter prefix makes unreachable (Discord's "put the longest first").
 */
export function validateUrlMappings(
  input: unknown,
  opts: { requireRoot?: boolean; blockedHosts?: string[] } = {},
): { ok: true; mappings: UrlMapping[]; warnings: MappingError[] } | { ok: false; errors: MappingError[] } {
  if (!Array.isArray(input)) return { ok: false, errors: [{ index: null, field: null, message: 'URL mappings must be a list.' }] };
  if (input.length > ACTIVITY_LIMITS.MAPPINGS) {
    return { ok: false, errors: [{ index: null, field: null, message: `At most ${ACTIVITY_LIMITS.MAPPINGS} URL mappings.` }] };
  }
  const errors: MappingError[] = [];
  const mappings: UrlMapping[] = [];
  const seen = new Set<string>();
  input.forEach((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      errors.push({ index, field: null, message: 'Each mapping needs a prefix and a target.' });
      return;
    }
    const entry = raw as Record<string, unknown>;
    const prefix = normalizePrefix(entry.prefix);
    if (!prefix.ok) { errors.push({ index, field: 'prefix', message: prefix.message }); return; }
    const key = prefix.prefix.toLowerCase();
    if (seen.has(key)) { errors.push({ index, field: 'prefix', message: 'This prefix is already mapped.' }); return; }
    seen.add(key);
    const target = normalizeTarget(entry.target, prefix.tokens, { blockedHosts: opts.blockedHosts });
    if (!target.ok) { errors.push({ index, field: 'target', message: target.message }); return; }
    if (prefix.prefix === '/' && HAS_TOKEN_RE.test(target.target)) {
      errors.push({ index, field: 'target', message: 'The root mapping cannot use {name} parameters.' });
      return;
    }
    mappings.push({ prefix: prefix.prefix, target: target.target });
  });
  if (errors.length === 0 && opts.requireRoot && !mappings.some((m) => m.prefix === '/')) {
    errors.push({ index: null, field: null, message: 'Add a root mapping ("/") that points at your Activity.' });
  }
  if (errors.length) return { ok: false, errors };
  const warnings: MappingError[] = [];
  mappings.forEach((m, i) => {
    const by = mappings.slice(0, i).find((earlier) => shadowingPrefix(earlier.prefix, m.prefix));
    if (by) warnings.push({ index: i, field: 'prefix', message: `Never used: "${by.prefix}" above it matches first. Move longer prefixes up.` });
  });
  return { ok: true, mappings, warnings };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function prefixRegex(prefix: string): RegExp {
  const source = prefix
    .split(/(\{[a-z]+\})/)
    .map((part) => {
      const tok = /^\{([a-z]+)\}$/.exec(part);
      return tok ? `(?<${tok[1]}>[A-Za-z0-9_-]+)` : escapeRegex(part);
    })
    .join('');
  return new RegExp(`^${source}(?=/|$)`);
}

export interface ResolvedMapping {
  mapping: UrlMapping;
  /** Upstream host[:port], tokens substituted, lower-case. */
  host: string;
  /** Upstream path (target path + the rest of the request path), always starting with "/". */
  path: string;
}

/**
 * Route a request path (no query) to its upstream. `/.proxy/<rest>` and
 * `/<rest>` resolve the same way (Discord accepts both). Non-root mappings are
 * tried in order; the root mapping catches everything else. Null when nothing
 * matches or the path is reserved.
 */
export function resolveUrlMapping(mappings: UrlMapping[], requestPath: string): ResolvedMapping | null {
  if (!requestPath.startsWith('/')) return null;
  let path = requestPath;
  if (path === '/.proxy' || path.startsWith('/.proxy/')) path = path.slice('/.proxy'.length) || '/';
  const lower = path.toLowerCase();
  if (RESERVED_PATH_PREFIXES.some((r) => lower === r || lower.startsWith(`${r}/`))) return null;

  const build = (mapping: UrlMapping, groups: Record<string, string>, rest: string): ResolvedMapping | null => {
    const slash = mapping.target.indexOf('/');
    const rawHost = slash === -1 ? mapping.target : mapping.target.slice(0, slash);
    const targetPath = slash === -1 ? '' : mapping.target.slice(slash);
    let bad = false;
    const host = rawHost.replace(/\{([a-z]+)\}/g, (_, name: string) => {
      const v = groups[name];
      if (!v || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(v)) bad = true;
      return (v ?? '').toLowerCase();
    });
    if (bad) return null;
    const joined = `${targetPath}${rest.startsWith('/') || rest === '' ? rest : `/${rest}`}`;
    return { mapping, host, path: joined || '/' };
  };

  for (const mapping of mappings) {
    if (mapping.prefix === '/') continue;
    const m = prefixRegex(mapping.prefix).exec(path);
    if (!m) continue;
    return build(mapping, m.groups ?? {}, path.slice(m[0].length));
  }
  const root = mappings.find((m) => m.prefix === '/');
  return root ? build(root, {}, path) : null;
}

// ─── Settings patch ─────────────────────────────────────────

export type ActivitySettingsPatch = Partial<ActivitySettings> & { maxParticipants?: number | null };

/**
 * Validate a portal PATCH. Only keys present in `input` are returned. URL
 * mappings must include a root mapping when the result is enabled (`current`
 * gives the stored values for keys the patch leaves out).
 */
export function validateActivitySettingsPatch(
  input: unknown,
  current: ActivitySettings,
  opts: { blockedHosts?: string[]; isOwnedImageUrl?: (url: string) => boolean } = {},
): { ok: true; patch: ActivitySettingsPatch; warnings: MappingError[] } | { ok: false; error: string; mappingErrors?: MappingError[] } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, error: 'Expected an object.' };
  const b = input as Record<string, unknown>;
  const patch: ActivitySettingsPatch = {};
  let warnings: MappingError[] = [];

  if (b.enabled !== undefined) {
    if (typeof b.enabled !== 'boolean') return { ok: false, error: 'enabled must be true or false.' };
    patch.enabled = b.enabled;
  }
  const enabled = patch.enabled ?? current.enabled;
  if (b.urlMappings !== undefined || (patch.enabled && !current.enabled)) {
    const res = validateUrlMappings(b.urlMappings ?? current.urlMappings, { requireRoot: enabled, blockedHosts: opts.blockedHosts });
    if (!res.ok) return { ok: false, error: res.errors[0].message, mappingErrors: res.errors };
    if (b.urlMappings !== undefined) patch.urlMappings = res.mappings;
    warnings = res.warnings;
  }
  if (b.supportedPlatforms !== undefined) {
    if (!Array.isArray(b.supportedPlatforms)) return { ok: false, error: 'supportedPlatforms must be a list.' };
    const out: ActivityPlatform[] = [];
    for (const p of b.supportedPlatforms) {
      if (!(ACTIVITY_PLATFORMS as readonly unknown[]).includes(p)) return { ok: false, error: `Unknown platform "${String(p)}".` };
      if (!out.includes(p as ActivityPlatform)) out.push(p as ActivityPlatform);
    }
    if (out.length === 0) return { ok: false, error: 'Pick at least one platform.' };
    patch.supportedPlatforms = ACTIVITY_PLATFORMS.filter((p) => out.includes(p));
  }
  for (const key of ['orientationLockPhone', 'orientationLockTablet'] as const) {
    if (b[key] === undefined) continue;
    const v = b[key];
    if (v !== 1 && v !== 2 && v !== 3) return { ok: false, error: `${key} must be 1 (unlocked), 2 (portrait) or 3 (landscape).` };
    patch[key] = v;
  }
  if (b.ageGated !== undefined) {
    if (typeof b.ageGated !== 'boolean') return { ok: false, error: 'ageGated must be true or false.' };
    patch.ageGated = b.ageGated;
  }
  if (b.displayName !== undefined) {
    if (b.displayName === null || b.displayName === '') patch.displayName = null;
    else if (typeof b.displayName !== 'string') return { ok: false, error: 'displayName must be a string.' };
    else {
      const name = b.displayName.replace(/[\u0000-\u001f\u007f]/g, '').trim();
      if (name.length > ACTIVITY_LIMITS.DISPLAY_NAME) return { ok: false, error: `Name must be at most ${ACTIVITY_LIMITS.DISPLAY_NAME} characters.` };
      patch.displayName = name || null;
    }
  }
  if (b.imageUrl !== undefined) {
    if (b.imageUrl === null || b.imageUrl === '') patch.imageUrl = null;
    else if (typeof b.imageUrl !== 'string' || !opts.isOwnedImageUrl?.(b.imageUrl)) return { ok: false, error: 'Upload the image instead of linking it.' };
    else patch.imageUrl = b.imageUrl;
  }
  if (b.maxParticipants !== undefined) {
    if (b.maxParticipants === null || b.maxParticipants === 0) patch.maxParticipants = null;
    else if (!Number.isInteger(b.maxParticipants) || (b.maxParticipants as number) < 1 || (b.maxParticipants as number) > ACTIVITY_LIMITS.MAX_PARTICIPANTS) {
      return { ok: false, error: `Max participants must be between 1 and ${ACTIVITY_LIMITS.MAX_PARTICIPANTS}.` };
    } else patch.maxParticipants = b.maxParticipants as number;
  }
  return { ok: true, patch, warnings };
}

/** Coerce a stored row (any shape) into settings, falling back to defaults. */
export function settingsFromRow(row: Record<string, unknown> | null | undefined): ActivitySettings {
  if (!row) return { ...DEFAULT_ACTIVITY_SETTINGS };
  const mappings = validateUrlMappings(row.urlMappings ?? []);
  const lock = (v: unknown): OrientationLock => (v === 2 || v === 3 ? v : 1);
  const platforms = Array.isArray(row.supportedPlatforms)
    ? ACTIVITY_PLATFORMS.filter((p) => (row.supportedPlatforms as unknown[]).includes(p))
    : DEFAULT_ACTIVITY_SETTINGS.supportedPlatforms;
  return {
    enabled: row.enabled === true,
    urlMappings: mappings.ok ? mappings.mappings : [],
    supportedPlatforms: platforms.length ? platforms : DEFAULT_ACTIVITY_SETTINGS.supportedPlatforms,
    orientationLockPhone: lock(row.orientationLockPhone),
    orientationLockTablet: lock(row.orientationLockTablet),
    ageGated: row.ageGated === true,
    displayName: typeof row.displayName === 'string' && row.displayName ? row.displayName : null,
    imageUrl: typeof row.imageUrl === 'string' && row.imageUrl ? row.imageUrl : null,
  };
}

/** The Activities domain host label for an app (its client id), or null when unusable. */
export function activityHostLabel(clientId: string | null | undefined): string | null {
  const id = String(clientId ?? '').toLowerCase();
  return /^[0-9]{1,32}$/.test(id) ? id : null;
}

/** Parse `<client_id>.<domain>` (case-insensitive, port ignored); null when the host isn't an Activity host. */
export function clientIdFromActivityHost(hostHeader: string | null | undefined, domain: string): string | null {
  if (!hostHeader || !domain) return null;
  const host = hostHeader.toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '');
  const suffix = `.${domain.toLowerCase().replace(/^\.+|\.$/g, '')}`;
  if (!host.endsWith(suffix)) return null;
  return activityHostLabel(host.slice(0, -suffix.length));
}

/** True when the Host header is the Activities domain or any subdomain of it (port ignored). */
export function isActivitiesHost(hostHeader: string | null | undefined, domain: string): boolean {
  if (!hostHeader || !domain) return false;
  const host = hostHeader.toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '');
  const d = domain.toLowerCase().replace(/^\.+|\.$/g, '');
  return !!d && (host === d || host.endsWith(`.${d}`));
}

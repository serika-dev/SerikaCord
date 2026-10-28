/**
 * Per-server profiles: what a member can override in one server, how the
 * overrides are stored and validated, and how they fall back to the main
 * profile.
 *
 * Storage (server_members):
 *   nickname, avatar, banner   own columns (Discord's guild member fields)
 *   profile_overrides jsonb    everything else: bio, pronouns, display name
 *                              style, nameplate and profile theme colours
 *
 * A field that is absent means "use the main profile". Pure (no env, DB or
 * React), shared by the API, the editor and tests/member-profile.test.ts.
 */
import { normalizeHexColor } from "@/lib/appearance/customization";
import { sanitizeNameplate, type NameplateCustomization } from "@/lib/constants/nameplates";

export const NAME_FONTS = ["default", "serif", "mono", "rounded", "cursive", "bold"] as const;
export const NAME_EFFECTS = ["solid", "gradient", "neon", "toon", "pop"] as const;
export type NameFont = (typeof NAME_FONTS)[number];
export type NameEffect = (typeof NAME_EFFECTS)[number];

/** Same limits as the main profile (PUT /api/users/me). */
export const MEMBER_PROFILE_LIMITS = {
  nickname: 32,
  pronouns: 32,
  bio: 1000,
} as const;

export interface MemberDisplayNameStyle {
  font?: NameFont;
  effect?: NameEffect;
  color?: string;
  gradient?: string[];
}

/** Profile theme: replaces both main colours together (a gradient wins over the colour). */
export interface MemberProfileTheme {
  profileColor: string;
  profileGradient: string[];
}

/** What lives in server_members.profile_overrides. */
export interface MemberProfileJson {
  bio?: string;
  pronouns?: string;
  displayNameStyle?: MemberDisplayNameStyle;
  nameplate?: NameplateCustomization;
  theme?: MemberProfileTheme;
}

/** Every override of one membership (columns + json). */
export interface MemberProfileOverrides extends MemberProfileJson {
  nickname?: string;
  avatar?: string;
  banner?: string;
}

export type MemberOverrideField = keyof MemberProfileOverrides;

/** Editor order. */
export const MEMBER_OVERRIDE_FIELDS: readonly MemberOverrideField[] = [
  "nickname",
  "pronouns",
  "avatar",
  "banner",
  "bio",
  "displayNameStyle",
  "nameplate",
  "theme",
];

const JSON_FIELDS = ["bio", "pronouns", "displayNameStyle", "nameplate", "theme"] as const;

const isObject = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);

// Control characters except tab / newline.
const CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

function clampChars(value: string, max: number): string {
  const chars = Array.from(value);
  return chars.length > max ? chars.slice(0, max).join("") : value;
}

/** Single-line text: one trimmed line, clamped. */
export function cleanLine(raw: string, max: number): string {
  return clampChars(raw.replace(CONTROL_RE, "").replace(/[\r\n\t]+/g, " ").trim(), max);
}

/** Multi-line text (bio): keeps inner newlines, drops trailing space, clamped. */
export function cleanBio(raw: string, max: number = MEMBER_PROFILE_LIMITS.bio): string {
  return clampChars(raw.replace(/\r\n?/g, "\n").replace(CONTROL_RE, "").replace(/\s+$/, "").replace(/^\s*\n/, ""), max);
}

/** `#RRGGBB` (uppercase, like the editors' swatches, so selections match), or null. */
function hex(value: unknown): string | null {
  return normalizeHexColor(value)?.toUpperCase() ?? null;
}

function hexList(raw: unknown, min: number, max: number): string[] | null {
  if (!Array.isArray(raw)) return null;
  if (raw.length === 0) return [];
  if (raw.length < min || raw.length > max) return null;
  const out = raw.map(hex);
  return out.some((c) => !c) ? null : (out as string[]);
}

/** A display name style from untrusted input, or null when it isn't one. */
export function sanitizeDisplayNameStyle(raw: unknown): MemberDisplayNameStyle | null {
  if (!isObject(raw)) return null;
  const font = (NAME_FONTS as readonly string[]).includes(String(raw.font ?? "default")) ? (String(raw.font ?? "default") as NameFont) : null;
  const effect = (NAME_EFFECTS as readonly string[]).includes(String(raw.effect ?? "solid")) ? (String(raw.effect ?? "solid") as NameEffect) : null;
  if (!font || !effect) return null;
  let color = "";
  if (raw.color !== undefined && raw.color !== null && raw.color !== "") {
    const c = hex(raw.color);
    if (!c) return null;
    color = c;
  }
  const gradient = raw.gradient === undefined || raw.gradient === null ? [] : hexList(raw.gradient, 2, 4);
  if (!gradient) return null;
  return { font, effect, color, gradient };
}

/** A profile theme from untrusted input, or null when it isn't one. */
export function sanitizeTheme(raw: unknown): MemberProfileTheme | null {
  if (!isObject(raw)) return null;
  let profileColor = "";
  if (raw.profileColor !== undefined && raw.profileColor !== null && raw.profileColor !== "") {
    const c = hex(raw.profileColor);
    if (!c) return null;
    profileColor = c;
  }
  const profileGradient = raw.profileGradient === undefined || raw.profileGradient === null ? [] : hexList(raw.profileGradient, 2, 4);
  if (!profileGradient) return null;
  return { profileColor, profileGradient };
}

const NAMEPLATE_TYPES = ["none", "color", "gradient", "preset", "image"] as const;

/** A stored nameplate with only its known keys (values are re-checked when rendered). */
function readNameplate(raw: unknown): NameplateCustomization | null {
  if (!isObject(raw)) return null;
  const type = String(raw.type ?? "none");
  if (!(NAMEPLATE_TYPES as readonly string[]).includes(type)) return null;
  const out: NameplateCustomization = { type: type as NameplateCustomization["type"] };
  if (typeof raw.color === "string") out.color = raw.color;
  if (Array.isArray(raw.gradient) && raw.gradient.every((c) => typeof c === "string")) out.gradient = (raw.gradient as string[]).slice(0, 4);
  if (typeof raw.presetId === "string") out.presetId = raw.presetId;
  if (typeof raw.imageUrl === "string") out.imageUrl = raw.imageUrl;
  return out;
}

/**
 * Read a stored profile_overrides value defensively: anything malformed is
 * dropped (it then falls back to the main profile) rather than rendered.
 * Nameplate images are re-checked when rendered (getNameplateBackground).
 */
export function readProfileJson(raw: unknown): MemberProfileJson {
  if (!isObject(raw)) return {};
  const out: MemberProfileJson = {};
  if (typeof raw.bio === "string") {
    const bio = cleanBio(raw.bio);
    if (bio) out.bio = bio;
  }
  if (typeof raw.pronouns === "string") {
    const p = cleanLine(raw.pronouns, MEMBER_PROFILE_LIMITS.pronouns);
    if (p) out.pronouns = p;
  }
  const style = raw.displayNameStyle === undefined ? null : sanitizeDisplayNameStyle(raw.displayNameStyle);
  if (style) out.displayNameStyle = style;
  const nameplate = readNameplate(raw.nameplate);
  if (nameplate) out.nameplate = nameplate;
  const theme = raw.theme === undefined ? null : sanitizeTheme(raw.theme);
  if (theme) out.theme = theme;
  return out;
}

/** The overrides of a member row (`profileOverrides` may be missing on old rows). */
export function memberOverridesFromRow(row: {
  nickname?: string | null;
  avatar?: string | null;
  banner?: string | null;
  profileOverrides?: unknown;
} | null | undefined): MemberProfileOverrides {
  if (!row) return {};
  const out: MemberProfileOverrides = { ...readProfileJson(row.profileOverrides) };
  if (row.nickname) out.nickname = row.nickname;
  if (row.avatar) out.avatar = row.avatar;
  if (row.banner) out.banner = row.banner;
  return out;
}

/** Fields this member overrides, in editor order. */
export function overriddenFields(overrides: MemberProfileOverrides | null | undefined): MemberOverrideField[] {
  if (!overrides) return [];
  return MEMBER_OVERRIDE_FIELDS.filter((f) => overrides[f] !== undefined && overrides[f] !== null && overrides[f] !== "");
}

export function hasServerProfile(overrides: MemberProfileOverrides | null | undefined): boolean {
  return overriddenFields(overrides).length > 0;
}

/** The main-profile fields a server profile falls back to. */
export interface MainProfileLike {
  displayName?: string | null;
  username?: string | null;
  avatar?: string | null;
  banner?: string | null;
  bio?: string | null;
  pronouns?: string | null;
  customization?: Record<string, unknown> | null;
}

export interface EffectiveMemberProfile {
  displayName: string;
  avatar: string | null;
  banner: string | null;
  bio: string | null;
  pronouns: string | null;
  customization: Record<string, unknown> | null;
}

/**
 * Customization with the server overrides applied on top of the main one.
 * Returns the same object when nothing is overridden (cheap for member lists).
 */
export function applyCustomizationOverrides<C extends Record<string, unknown> | null | undefined>(
  customization: C,
  overrides: MemberProfileOverrides | null | undefined,
): C | Record<string, unknown> {
  if (!overrides || (!overrides.displayNameStyle && !overrides.nameplate && !overrides.theme)) return customization;
  const out: Record<string, unknown> = { ...(customization || {}) };
  if (overrides.displayNameStyle) out.displayNameStyle = overrides.displayNameStyle;
  if (overrides.nameplate) out.nameplate = overrides.nameplate;
  if (overrides.theme) {
    out.profileColor = overrides.theme.profileColor;
    out.profileGradient = overrides.theme.profileGradient;
  }
  return out;
}

/** How a member looks in one server: overrides first, main profile underneath. */
export function resolveMemberProfile(main: MainProfileLike, overrides: MemberProfileOverrides | null | undefined): EffectiveMemberProfile {
  const o = overrides || {};
  return {
    displayName: o.nickname || main.displayName || main.username || "",
    avatar: o.avatar || main.avatar || null,
    banner: o.banner || main.banner || null,
    bio: o.bio || main.bio || null,
    pronouns: o.pronouns || main.pronouns || null,
    customization: (applyCustomizationOverrides(main.customization ?? null, o) as Record<string, unknown> | null) ?? null,
  };
}

/** The main profile's value of one field, in override form ("" / undefined when unset). */
export function mainValueOf(main: MainProfileLike, field: MemberOverrideField): MemberProfileOverrides[MemberOverrideField] {
  const c = (main.customization || {}) as Record<string, unknown>;
  switch (field) {
    case "nickname": return main.displayName || main.username || "";
    case "avatar": return main.avatar || undefined;
    case "banner": return main.banner || undefined;
    case "bio": return main.bio || "";
    case "pronouns": return main.pronouns || "";
    case "displayNameStyle": return sanitizeDisplayNameStyle(c.displayNameStyle ?? {}) ?? { font: "default", effect: "solid", color: "", gradient: [] };
    case "nameplate": return isObject(c.nameplate) ? (c.nameplate as NameplateCustomization) : { type: "none" };
    case "theme": return sanitizeTheme({ profileColor: c.profileColor ?? "", profileGradient: c.profileGradient ?? [] }) ?? { profileColor: "", profileGradient: [] };
  }
}

/**
 * "Copy from main profile": the text and style fields as overrides, so they
 * can be tweaked for this server. Images aren't copied: without an override
 * they already show the main avatar / banner.
 */
export function copyMainIntoOverrides(main: MainProfileLike, current: MemberProfileOverrides = {}): MemberProfileOverrides {
  const next: MemberProfileOverrides = { ...current };
  const name = main.displayName || "";
  if (name) next.nickname = cleanLine(name, MEMBER_PROFILE_LIMITS.nickname);
  if (main.bio) next.bio = cleanBio(main.bio);
  if (main.pronouns) next.pronouns = cleanLine(main.pronouns, MEMBER_PROFILE_LIMITS.pronouns);
  next.displayNameStyle = mainValueOf(main, "displayNameStyle") as MemberDisplayNameStyle;
  next.nameplate = mainValueOf(main, "nameplate") as NameplateCustomization;
  next.theme = mainValueOf(main, "theme") as MemberProfileTheme;
  return next;
}

const sameValue = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Fields whose override differs between two override sets (empty strings count as unset). */
export function diffOverrides(a: MemberProfileOverrides, b: MemberProfileOverrides): MemberOverrideField[] {
  const norm = (v: unknown) => (v === "" ? undefined : v);
  return MEMBER_OVERRIDE_FIELDS.filter((f) => !sameValue(norm(a[f]), norm(b[f])));
}

/**
 * The PATCH body that turns `saved` into `draft`: changed fields only, with
 * null for "back to the main profile".
 */
export function overridesPatch(saved: MemberProfileOverrides, draft: MemberProfileOverrides): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const f of diffOverrides(saved, draft)) {
    const v = draft[f];
    body[f] = v === undefined || v === "" ? null : v;
  }
  return body;
}

/**
 * Whether `url` is a per-server image this user uploaded for this server:
 * `<cdn>/<avatars|banners>/<serverId>/<userId>/<file>` (the key the upload
 * routes store under). Anything else (other hosts, other folders, query
 * strings, path tricks) is refused.
 */
export function isMemberMediaUrl(
  url: unknown,
  opts: { kind: "avatar" | "banner"; serverId: string; userId: string; cdnUrl: string },
): boolean {
  if (typeof url !== "string" || url.length === 0 || url.length > 512) return false;
  let cdn: URL;
  let parsed: URL;
  try {
    cdn = new URL(opts.cdnUrl);
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== cdn.protocol || parsed.host !== cdn.host || parsed.username || parsed.password || parsed.search || parsed.hash) return false;
  const base = cdn.pathname.replace(/\/+$/, "");
  if (!parsed.pathname.startsWith(`${base}/`)) return false;
  const parts = parsed.pathname.slice(base.length + 1).split("/");
  if (parts.length !== 4) return false;
  const [folder, serverId, userId, file] = parts;
  if (folder !== (opts.kind === "avatar" ? "avatars" : "banners")) return false;
  if (serverId.toLowerCase() !== opts.serverId.toLowerCase() || userId.toLowerCase() !== opts.userId.toLowerCase()) return false;
  return /^[A-Za-z0-9_.-]{1,128}$/.test(file) && !file.startsWith(".");
}

export type MemberProfilePatchResult =
  | {
      ok: true;
      /** Column updates (null clears). */
      columns: { nickname?: string | null; avatar?: string | null; banner?: string | null };
      /** The complete next profile_overrides value, or undefined when untouched. */
      json?: MemberProfileJson;
      /** The overrides after the patch. */
      next: MemberProfileOverrides;
      changed: MemberOverrideField[];
    }
  | { ok: false; error: string; field?: MemberOverrideField };

/**
 * Validate a PATCH /servers/:id/members/@me body against the current
 * overrides. Each field: a value sets the override, null (or "") removes it,
 * absent leaves it. `reset: true` removes every override first. Images must
 * be this member's own per-server uploads, one of their recent images, or
 * unchanged.
 */
export function sanitizeMemberProfilePatch(
  raw: unknown,
  ctx: {
    userId: string; serverId: string; cdnUrl: string; current: MemberProfileOverrides;
    /**
     * Applied to a nickname after its length is checked (the API HTML-escapes
     * nicknames, which can make them longer than the limit people typed).
     */
    storeNickname?: (nickname: string) => string;
    /**
     * The user's recent avatars / banners (src/lib/profiles/recentMedia.ts):
     * already-uploaded images of theirs that may be reused here as-is.
     */
    recentMedia?: { avatar?: readonly string[]; banner?: readonly string[] };
  },
): MemberProfilePatchResult {
  if (!isObject(raw)) return { ok: false, error: "Invalid body" };
  const current = ctx.current;
  const next: MemberProfileOverrides = raw.reset === true ? {} : { ...current };
  const fail = (field: MemberOverrideField, error: string): MemberProfilePatchResult => ({ ok: false, error, field });

  if (raw.nickname !== undefined) {
    if (raw.nickname === null || raw.nickname === "") delete next.nickname;
    else if (typeof raw.nickname !== "string") return fail("nickname", "nickname must be a string");
    else {
      if (Array.from(raw.nickname.trim()).length > MEMBER_PROFILE_LIMITS.nickname) return fail("nickname", `nickname must be at most ${MEMBER_PROFILE_LIMITS.nickname} characters`);
      const clean = cleanLine(raw.nickname, MEMBER_PROFILE_LIMITS.nickname);
      const n = clean && ctx.storeNickname ? ctx.storeNickname(clean) : clean;
      if (n) next.nickname = n;
      else delete next.nickname;
    }
  }

  for (const kind of ["avatar", "banner"] as const) {
    const value = raw[kind];
    if (value === undefined) continue;
    if (value === null || value === "") { delete next[kind]; continue; }
    if (typeof value !== "string") return fail(kind, `${kind} must be a string`);
    if (value === current[kind]) { next[kind] = value; continue; }
    const recent = ctx.recentMedia?.[kind]?.includes(value) === true;
    if (!recent && !isMemberMediaUrl(value, { kind, serverId: ctx.serverId, userId: ctx.userId, cdnUrl: ctx.cdnUrl })) {
      return fail(kind, `${kind} must be an image you uploaded for this server`);
    }
    next[kind] = value;
  }

  if (raw.bio !== undefined) {
    if (raw.bio === null || raw.bio === "") delete next.bio;
    else if (typeof raw.bio !== "string") return fail("bio", "bio must be a string");
    else {
      if (Array.from(raw.bio).length > MEMBER_PROFILE_LIMITS.bio + 50) return fail("bio", `bio must be at most ${MEMBER_PROFILE_LIMITS.bio} characters`);
      const bio = cleanBio(raw.bio);
      if (bio) next.bio = bio;
      else delete next.bio;
    }
  }

  if (raw.pronouns !== undefined) {
    if (raw.pronouns === null || raw.pronouns === "") delete next.pronouns;
    else if (typeof raw.pronouns !== "string") return fail("pronouns", "pronouns must be a string");
    else {
      if (Array.from(raw.pronouns.trim()).length > MEMBER_PROFILE_LIMITS.pronouns) return fail("pronouns", `pronouns must be at most ${MEMBER_PROFILE_LIMITS.pronouns} characters`);
      const p = cleanLine(raw.pronouns, MEMBER_PROFILE_LIMITS.pronouns);
      if (p) next.pronouns = p;
      else delete next.pronouns;
    }
  }

  if (raw.displayNameStyle !== undefined) {
    if (raw.displayNameStyle === null) delete next.displayNameStyle;
    else {
      const style = sanitizeDisplayNameStyle(raw.displayNameStyle);
      if (!style) return fail("displayNameStyle", "displayNameStyle has an unknown font, effect or a colour that isn't hex");
      next.displayNameStyle = style;
    }
  }

  if (raw.nameplate !== undefined) {
    if (raw.nameplate === null) delete next.nameplate;
    else {
      const result = sanitizeNameplate(raw.nameplate, { userId: ctx.userId, cdnUrl: ctx.cdnUrl });
      if ("error" in result) return fail("nameplate", result.error);
      next.nameplate = result.nameplate;
    }
  }

  if (raw.theme !== undefined) {
    if (raw.theme === null) delete next.theme;
    else {
      const theme = sanitizeTheme(raw.theme);
      if (!theme) return fail("theme", "theme colours must be hex (gradient: 2 to 4 colours)");
      next.theme = theme;
    }
  }

  const changed = diffOverrides(current, next);
  const columns: { nickname?: string | null; avatar?: string | null; banner?: string | null } = {};
  for (const f of ["nickname", "avatar", "banner"] as const) {
    if (changed.includes(f)) columns[f] = next[f] ?? null;
  }
  const jsonChanged = changed.some((f) => (JSON_FIELDS as readonly string[]).includes(f));
  let json: MemberProfileJson | undefined;
  if (jsonChanged) {
    json = {};
    for (const f of JSON_FIELDS) {
      if (next[f] !== undefined) (json as Record<string, unknown>)[f] = next[f];
    }
  }
  return { ok: true, columns, json, next, changed };
}

/**
 * A profile object (ProfileCardUser-like, main values) shown as it looks in
 * one server: nickname, avatar, banner, bio, pronouns and styles replaced
 * where the member overrides them. `displayName` keeps the main name; the
 * nickname field carries the server one (cards show nickname || displayName).
 */
export function withServerProfile<T extends MainProfileLike & { nickname?: string | null }>(
  profile: T,
  overrides: MemberProfileOverrides | null | undefined,
): T {
  if (!overrides || !hasServerProfile(overrides)) return profile;
  const eff = resolveMemberProfile(profile, overrides);
  return {
    ...profile,
    nickname: overrides.nickname || profile.nickname || null,
    avatar: eff.avatar,
    banner: eff.banner,
    bio: eff.bio,
    pronouns: eff.pronouns,
    customization: eff.customization,
  };
}

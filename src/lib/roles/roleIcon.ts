/**
 * Role icons (Discord's role icon: an uploaded image or a unicode emoji shown
 * next to member names). Pure helpers shared by the role API and the UI.
 */

export interface RoleIconRole {
  id: string;
  name?: string;
  position?: number;
  icon?: string | null;
  unicodeEmoji?: string | null;
  isDefault?: boolean;
}

/**
 * An uploaded role icon must be one of our own CDN uploads (the emoji upload
 * endpoint stores under `<CDN>/emojis/`); anything else would let a role show
 * an arbitrary remote image.
 */
export function isValidRoleIcon(url: unknown, cdnUrl: string): boolean {
  if (typeof url !== "string" || url.length === 0 || url.length > 512) return false;
  let parsed: URL;
  let cdn: URL;
  try {
    parsed = new URL(url);
    cdn = new URL(cdnUrl);
  } catch {
    return false;
  }
  if (parsed.protocol !== cdn.protocol || parsed.host !== cdn.host || parsed.username || parsed.password) return false;
  const base = cdn.pathname.replace(/\/+$/, "");
  return parsed.pathname.startsWith(`${base}/emojis/`) || parsed.pathname.startsWith(`${base}/role-icons/`);
}

const PICTOGRAPHIC = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;

/** A single unicode emoji (with modifiers / ZWJ sequences), not arbitrary text. */
export function isValidUnicodeEmoji(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const v = value.trim();
  if (!v || v.length > 32) return false;
  if (!PICTOGRAPHIC.test(v)) return false;
  // No letters or digits other than keycap sequences (e.g. 1️⃣).
  return !/[\p{L}]/u.test(v) && !/\s/.test(v);
}

/**
 * Normalizes a PATCH role icon body: `icon` (image URL) and `unicodeEmoji`
 * are mutually exclusive, like Discord. Returns the fields to store or an
 * error message.
 */
export function normalizeRoleIconInput(
  input: { icon?: string | null; unicodeEmoji?: string | null },
  cdnUrl: string,
): { icon?: string | null; unicodeEmoji?: string | null } | { error: string } {
  const out: { icon?: string | null; unicodeEmoji?: string | null } = {};
  if (input.icon !== undefined) {
    if (input.icon === null || input.icon === "") {
      out.icon = null;
    } else if (!isValidRoleIcon(input.icon, cdnUrl)) {
      return { error: "Role icons must be uploaded to SerikaCord first" };
    } else {
      out.icon = input.icon;
      out.unicodeEmoji = null;
    }
  }
  if (input.unicodeEmoji !== undefined) {
    if (input.unicodeEmoji === null || input.unicodeEmoji === "") {
      out.unicodeEmoji = null;
    } else if (!isValidUnicodeEmoji(input.unicodeEmoji)) {
      return { error: "Invalid role emoji" };
    } else {
      out.unicodeEmoji = input.unicodeEmoji.trim();
      out.icon = null;
    }
  }
  return out;
}

/**
 * The role whose icon shows next to a member's name: their highest role that
 * has one (Discord), or null.
 */
export function pickIconRole<T extends RoleIconRole>(roles: readonly T[] | null | undefined): T | null {
  let best: T | null = null;
  for (const role of roles || []) {
    if (role.isDefault) continue;
    if (!role.icon && !role.unicodeEmoji) continue;
    if (!best || (role.position ?? 0) > (best.position ?? 0)) best = role;
  }
  return best;
}

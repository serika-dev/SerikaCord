/**
 * Shape check for the profile update body of POST /api/users/me.
 *
 * PUT /api/users/me validates its body with a TypeBox schema, but the POST
 * variant also accepts a text/plain body (sendBeacon / keepalive from a closing
 * tab), which Elysia hands over as a string, so it can't use a route schema.
 * This mirrors the PUT schema's limits by hand so both paths take the same
 * input. Keep the two in step.
 *
 * Pure (no env, DB or React); tested in tests/profile-patch-body.test.ts.
 */

export const PROFILE_PATCH_LIMITS = {
  displayName: 32,
  bio: 1000,
  pronouns: 32,
  timezone: 64,
  customStatus: 128,
  customStatusExpiresAt: 64,
} as const;

export const PROFILE_STATUSES = ["online", "idle", "dnd", "offline", "invisible"] as const;

const isObject = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);

/** Parse a beacon body (JSON string or object). null when it isn't a JSON object. */
export function parseProfilePatchBody(body: unknown): Record<string, unknown> | null {
  let data: unknown = body;
  if (typeof body === "string") {
    try {
      data = JSON.parse(body);
    } catch {
      return null;
    }
  }
  return isObject(data) ? data : null;
}

/** null when valid, else a short error naming the first bad field. */
export function validateProfilePatchBody(data: Record<string, unknown>): string | null {
  const str = (key: keyof typeof PROFILE_PATCH_LIMITS, nullable: boolean): string | null => {
    const v = data[key];
    if (v === undefined) return null;
    if (v === null && nullable) return null;
    if (typeof v !== "string" || v.length > PROFILE_PATCH_LIMITS[key]) return `Invalid ${key}`;
    return null;
  };
  const errors = [
    str("displayName", false),
    str("bio", false),
    str("pronouns", false),
    str("timezone", true),
    str("customStatus", true),
    str("customStatusExpiresAt", true),
  ];
  const firstError = errors.find(Boolean);
  if (firstError) return firstError;

  if (data.showTimezone !== undefined && typeof data.showTimezone !== "boolean") return "Invalid showTimezone";
  if (data.status !== undefined && !(PROFILE_STATUSES as readonly unknown[]).includes(data.status)) return "Invalid status";
  if (data.customStatusEmoji !== undefined && data.customStatusEmoji !== null && !isObject(data.customStatusEmoji)) {
    return "Invalid customStatusEmoji";
  }
  if (data.settings !== undefined && !isObject(data.settings)) return "Invalid settings";
  if (data.customization !== undefined && !isObject(data.customization)) return "Invalid customization";
  if (data.gifFavorites !== undefined) {
    if (!Array.isArray(data.gifFavorites)) return "Invalid gifFavorites";
    for (const f of data.gifFavorites) {
      if (!isObject(f) || typeof f.url !== "string") return "Invalid gifFavorites";
      if (f.title !== undefined && typeof f.title !== "string") return "Invalid gifFavorites";
      if (f.source !== undefined && typeof f.source !== "string") return "Invalid gifFavorites";
      if (f.addedAt !== undefined && (typeof f.addedAt !== "number" || !Number.isFinite(f.addedAt))) return "Invalid gifFavorites";
    }
  }
  return null;
}

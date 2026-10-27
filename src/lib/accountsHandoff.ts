/**
 * Client-safe pieces of the Serika Accounts sign-in hand-off ("Sign in with
 * passkey"). The server side (PKCE, state, the code exchange) lives in
 * `src/lib/services/accountsHandoff.ts`; see docs/architecture/security.md.
 *
 * Pure: no browser or server globals, so it is shared by the login page, the
 * Elysia routes and the unit tests.
 */
import { safeRedirect } from "./safeRedirect";

/** Where the browser starts the flow (same origin, full-page navigation). */
export const HANDOFF_START_PATH = "/api/auth/accounts/start";
/** Where Serika Accounts sends the browser back with `code` + `state`. */
export const HANDOFF_CALLBACK_PATH = "/api/auth/accounts/callback";
/** Post-login landing when no (valid) `next` was given. */
export const DEFAULT_NEXT_PATH = "/channels/me";
/** Serika Accounts security settings, where passkeys are added and managed. */
export const ACCOUNTS_SECURITY_URL = "https://accounts.serika.dev/settings?tab=security";
/**
 * Serika Accounts connections settings, where Discord (and SerikaMoe) are
 * linked. SerikaCord picks a new link up from there (services/discordConnection).
 */
export const ACCOUNTS_CONNECTIONS_URL = "https://accounts.serika.dev/settings?tab=connections";

/**
 * Error codes the callback puts on `/login?error=`. Anything else on that
 * parameter is ignored by the login page.
 */
export const HANDOFF_ERROR_CODES = [
  "passkey_expired", // code used/expired, state mismatch or the flow cookie is gone
  "passkey_cancelled", // the user backed out on Serika Accounts
  "passkey_unavailable", // Serika Accounts unreachable / rate limited
  "passkey_age", // the account is age-restricted
  "passkey_rate_limited", // too many attempts from this address
  "passkey_failed", // anything else
] as const;
export type HandoffErrorCode = (typeof HANDOFF_ERROR_CODES)[number];

export function parseHandoffError(value: string | null | undefined): HandoffErrorCode | null {
  if (!value) return null;
  return (HANDOFF_ERROR_CODES as readonly string[]).includes(value) ? (value as HandoffErrorCode) : null;
}

/**
 * Sanitize a post-login target: a same-origin relative path only, and never
 * an API route (a GET there could trigger an action or loop the flow).
 * The origin is only used for parsing; the result is always a path.
 */
export function sanitizeNextPath(value: unknown): string {
  if (typeof value !== "string" || value.length > 2048) return DEFAULT_NEXT_PATH;
  const path = safeRedirect(value, DEFAULT_NEXT_PATH, "https://serika.chat");
  if (path === "/api" || path.startsWith("/api/") || path.startsWith("/api?")) return DEFAULT_NEXT_PATH;
  return path;
}

/**
 * Same-origin URL that starts the hand-off. `passkey: false` opens the
 * Serika Accounts sign-in page without starting the passkey prompt (used for
 * accounts that need a two-factor code).
 */
export function passkeyStartHref(next: string, opts: { passkey?: boolean } = {}): string {
  const params = new URLSearchParams();
  const safeNext = sanitizeNextPath(next);
  if (safeNext !== DEFAULT_NEXT_PATH) params.set("next", safeNext);
  if (opts.passkey === false) params.set("passkey", "0");
  const query = params.toString();
  return query ? `${HANDOFF_START_PATH}?${query}` : HANDOFF_START_PATH;
}

/** `/login` URL the callback sends the browser to (error or success). */
export function loginReturnPath(next: string, extra: Record<string, string>): string {
  const params = new URLSearchParams(extra);
  const safeNext = sanitizeNextPath(next);
  if (safeNext !== DEFAULT_NEXT_PATH) params.set("redirect", safeNext);
  return `/login?${params.toString()}`;
}

/**
 * Login error codes from POST /api/auth/login that call for the Serika
 * Accounts sign-in instead of a generic error.
 */
export type LoginHandoffReason = "passkey" | "two_factor";
export function handoffReasonForLoginCode(code: unknown): LoginHandoffReason | null {
  if (code === "PASSKEY_REQUIRED") return "passkey";
  if (code === "TWO_FACTOR_REQUIRED") return "two_factor";
  return null;
}

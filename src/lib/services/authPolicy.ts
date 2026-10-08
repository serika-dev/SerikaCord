/**
 * Pure auth helpers (no DB, no network) shared by the auth service and the
 * /api/auth routes, kept separate so they can be unit tested.
 */

// ── Local user ↔ accounts user linking ─────────────────────────────────────

export interface LinkCandidate {
  id: string;
  email?: string | null;
  isBot?: boolean | null;
  isSystem?: boolean | null;
}

export interface AccountsIdentity {
  id: string;
  email?: string | null;
  isVerified?: boolean | null;
}

/**
 * Whether an accounts.serika.dev user may take over an existing local row
 * whose id differs from theirs (a legacy pre-accounts row with the same
 * username). Only when the row is a normal user and both sides carry the same
 * email, verified on the accounts side. Bot, system and email-less rows
 * (e.g. bots, Discord-created users) are never adopted.
 */
export function canAdoptLocalUser(existing: LinkCandidate, accountsUser: AccountsIdentity): boolean {
  if (!existing || !accountsUser) return false;
  if (existing.id === accountsUser.id) return true;
  if (existing.isBot || existing.isSystem) return false;
  if (accountsUser.isVerified !== true) return false;
  const a = (existing.email || '').trim().toLowerCase();
  const b = (accountsUser.email || '').trim().toLowerCase();
  return !!a && !!b && a === b;
}

const USERNAME_MAX = 32;

/**
 * A username that won't collide with an existing local row: `<name>_<suffix>`
 * where the suffix comes from the owner's id. `attempt` lengthens the suffix
 * in case the first candidate is also taken. Stays within the 32-char limit
 * and the `[a-zA-Z0-9_]` charset.
 */
export function dedupeUsername(username: string, id: string, attempt = 0): string {
  const suffixLen = 6 + attempt * 4;
  const suffix = (id || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, suffixLen) || Math.random().toString(36).slice(2, 2 + suffixLen);
  const base = (username || 'user').replace(/[^a-zA-Z0-9_]/g, '').slice(0, USERNAME_MAX - suffix.length - 1) || 'user';
  return `${base}_${suffix}`;
}

// ── saved_accounts cookie (account switcher) ───────────────────────────────

export interface SavedAccountEntry {
  email: string;
  username: string;
  displayName?: string;
  avatar?: string;
  token?: string;
  refreshToken?: string;
  savedAt: number;
}

/** What the browser may see about a saved account: never its tokens. */
export interface PublicSavedAccount {
  email: string;
  username: string;
  displayName?: string;
  avatar?: string;
  savedAt: number;
  switchable: boolean;
}

export function parseSavedAccounts(cookieValue: unknown): SavedAccountEntry[] {
  let raw: unknown = cookieValue;
  if (typeof cookieValue === 'string') {
    if (!cookieValue) return [];
    try {
      raw = JSON.parse(decodeURIComponent(cookieValue));
    } catch {
      try {
        raw = JSON.parse(cookieValue);
      } catch {
        return [];
      }
    }
  }
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (a): a is SavedAccountEntry =>
      !!a && typeof a === 'object' && typeof (a as SavedAccountEntry).email === 'string' && typeof (a as SavedAccountEntry).username === 'string',
  );
}

/**
 * Serialize the saved_accounts cookie. It holds bearer + refresh tokens, so
 * it is HttpOnly (page scripts can't read it) and Secure; the client lists
 * accounts through GET /api/auth/saved-accounts instead.
 */
export function encodeSavedAccountsCookie(accounts: SavedAccountEntry[]): string {
  const expires = new Date();
  expires.setFullYear(expires.getFullYear() + 1);
  return `saved_accounts=${encodeURIComponent(JSON.stringify(accounts))}; HttpOnly; Secure; Path=/; SameSite=Lax; Expires=${expires.toUTCString()}`;
}

export function upsertSavedAccount(accounts: SavedAccountEntry[], entry: SavedAccountEntry): SavedAccountEntry[] {
  const entryEmail = entry.email.toLowerCase();
  const entryUsername = entry.username.toLowerCase();
  const filtered = accounts.filter((a) => {
    if (a.email.toLowerCase() === entryEmail) return false;
    if (a.username.toLowerCase() === entryUsername) return false;
    return true;
  });
  filtered.push(entry);
  return filtered;
}

export function removeSavedAccount(
  accounts: SavedAccountEntry[],
  match: { email?: string | null; username?: string | null },
): SavedAccountEntry[] {
  const email = match.email?.toLowerCase();
  const username = match.username?.toLowerCase();
  return accounts.filter((a) => {
    if (email && a.email.toLowerCase() === email) return false;
    if (username && a.username.toLowerCase() === username) return false;
    return true;
  });
}

/** Token-free view of the saved accounts, deduplicated by email (newest wins). */
export function toPublicSavedAccounts(accounts: SavedAccountEntry[]): PublicSavedAccount[] {
  const byEmail = new Map<string, SavedAccountEntry>();
  for (const a of accounts) {
    const key = a.email.toLowerCase();
    const prev = byEmail.get(key);
    if (!prev || (a.savedAt || 0) > (prev.savedAt || 0)) byEmail.set(key, a);
  }
  return Array.from(byEmail.values()).map((a) => ({
    email: a.email,
    username: a.username,
    displayName: a.displayName,
    avatar: a.avatar,
    savedAt: a.savedAt || 0,
    switchable: !!a.token,
  }));
}

// ── OAuth connection state ─────────────────────────────────────────────────

/**
 * The oauth2_state / lastfm_state cookie is `<provider>:<nonce>`; the nonce
 * maps to the initiating user server-side. Returns the nonce when the cookie
 * belongs to `provider` and looks like one of ours.
 */
export function parseOAuthStateCookie(value: unknown, provider: string): string | null {
  if (typeof value !== 'string' || !value) return null;
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    // keep raw
  }
  const prefix = `${provider}:`;
  if (!decoded.startsWith(prefix)) return null;
  const nonce = decoded.slice(prefix.length);
  return /^[a-f0-9]{32,128}$/.test(nonce) ? nonce : null;
}

// ── Steam OpenID 2.0 ───────────────────────────────────────────────────────

export const STEAM_OPENID_ENDPOINT = 'https://steamcommunity.com/openid/login';
const STEAM_ID_URL = /^https:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/;

/**
 * Structural checks on a Steam OpenID positive assertion. Returns the SteamID64
 * only when mode/op_endpoint/return_to/claimed_id/identity all line up; the
 * caller must still confirm the signature with Steam (check_authentication).
 */
export function checkSteamAssertion(
  query: Record<string, unknown>,
  expectedReturnTo: string,
): { steamId: string } | { error: string } {
  const q = (k: string) => (typeof query[k] === 'string' ? (query[k] as string) : '');
  if (q('openid.mode') !== 'id_res') return { error: 'mode' };
  if (q('openid.op_endpoint') !== STEAM_OPENID_ENDPOINT) return { error: 'op_endpoint' };
  const returnTo = q('openid.return_to');
  if (!returnTo || (returnTo !== expectedReturnTo && !returnTo.startsWith(`${expectedReturnTo}?`))) {
    return { error: 'return_to' };
  }
  const claimed = q('openid.claimed_id');
  const identity = q('openid.identity');
  if (!claimed || claimed !== identity) return { error: 'claimed_id' };
  const m = STEAM_ID_URL.exec(identity);
  if (!m) return { error: 'identity' };
  if (!q('openid.sig') || !q('openid.signed')) return { error: 'signature' };
  return { steamId: m[1] };
}

/** Form body for Steam's check_authentication call: every openid.* param, mode swapped. */
export function buildSteamCheckAuthBody(query: Record<string, unknown>): URLSearchParams {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (k.startsWith('openid.') && typeof v === 'string') body.set(k, v);
  }
  body.set('openid.mode', 'check_authentication');
  return body;
}

/** Steam answers check_authentication with key:value lines; only `is_valid:true` passes. */
export function isSteamCheckAuthValid(responseText: string): boolean {
  return responseText.split(/\r?\n/).some((line) => line.trim() === 'is_valid:true');
}

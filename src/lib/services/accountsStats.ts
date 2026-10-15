import { config } from "../config";

/**
 * Public, aggregate-only stats from the accounts service
 * (`GET /api/stats/public` → `{ users }`), for the homepage's social proof.
 * Cached in memory so visitors never wait on the accounts service: one
 * request per 10 minutes (1 minute after a failure), 3 s timeout, and `null`
 * whenever there is no real number to show.
 */

const TTL_MS = 10 * 60_000;
const FAILURE_TTL_MS = 60_000;
const TIMEOUT_MS = 3_000;

let cached: { users: number | null; expires: number } | null = null;
let inflight: Promise<number | null> | null = null;

/** `{ users: <positive integer> }` → the count; anything else → null. */
export function parsePublicStats(body: unknown): number | null {
  if (!body || typeof body !== "object") return null;
  const users = (body as { users?: unknown }).users;
  if (typeof users !== "number" || !Number.isFinite(users) || users < 1) return null;
  return Math.floor(users);
}

async function fetchAccountCount(): Promise<number | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${config.ACCOUNTS_API_URL}/api/stats/public`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return parsePublicStats(await res.json().catch(() => null));
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/** Total Serika accounts (shared across Serika apps), or null if unknown. */
export async function getSerikaAccountCount(): Promise<number | null> {
  const now = Date.now();
  if (cached && cached.expires > now) return cached.users;
  if (!inflight) {
    inflight = fetchAccountCount()
      .then((users) => {
        // Keep showing the last good number if a refresh fails.
        const value = users ?? cached?.users ?? null;
        cached = { users: value, expires: Date.now() + (users === null ? FAILURE_TTL_MS : TTL_MS) };
        return value;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

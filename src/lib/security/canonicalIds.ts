/**
 * Canonical (lowercase) UUIDs on the API surface.
 *
 * Postgres compares `uuid` values case-insensitively, but route code compares
 * ids as strings (`server.ownerId === params.userId`, `Set.has`, `Map.get`).
 * An uppercase id in a path therefore matched the right rows in SQL while
 * slipping past the string checks (owner protection, role hierarchy). Every
 * UUID that reaches a handler is lowercased first so both sides agree.
 */

const UUID_ANYWHERE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const HAS_UPPER_HEX = /[A-F]/;

/** Lowercase every UUID in `pathname`; returns the input unchanged when it has none. */
export function canonicalizeUuidPath(pathname: string): string {
  if (!HAS_UPPER_HEX.test(pathname)) return pathname;
  return pathname.replace(UUID_ANYWHERE, (id) => id.toLowerCase());
}

/**
 * The same request with UUIDs in its path lowercased. Returns the original
 * object when nothing changes (so WebSocket upgrades keep working).
 */
export function withCanonicalUuidPath(req: Request): Request {
  const url = new URL(req.url);
  const next = canonicalizeUuidPath(url.pathname);
  if (next === url.pathname) return req;
  url.pathname = next;
  return new Request(url, req);
}

/** Lowercase a single id when it is a UUID; anything else is returned as is. */
export function canonicalUuid<T>(id: T): T {
  if (typeof id !== 'string') return id;
  return (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? id.toLowerCase() : id) as T;
}

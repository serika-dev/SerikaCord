import { sharedGet } from "@/lib/bootFetch";
import { BoundedMap } from "@/lib/utils/boundedMap";

/**
 * Tiny client-side cache for rarely-changing JSON GETs (cross-server emojis,
 * stickers, a channel's app commands). Chat containers remount on every
 * channel/DM switch, and each mount used to refetch these, competing with the
 * messages request on the switch path. Fresh entries resolve from memory;
 * stale ones refetch (identical in-flight requests are shared).
 */
type Entry = { data: unknown; at: number };

const store = new BoundedMap<string, Entry>(200);
const pending = new Map<string, Promise<unknown>>();

/** The last good response for `url`, however old (for an instant first paint). */
export function peekJson<T>(url: string): T | undefined {
  return store.get(url)?.data as T | undefined;
}

/**
 * GET `url` as JSON, served from memory when younger than `maxAgeMs`.
 * Resolves `null` on a network error or non-2xx (failures are not cached).
 */
export function getJsonCached<T>(url: string, maxAgeMs: number): Promise<T | null> {
  const hit = store.get(url);
  if (hit && Date.now() - hit.at < maxAgeMs) return Promise.resolve(hit.data as T);
  let p = pending.get(url);
  if (!p) {
    p = sharedGet(url)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: unknown) => {
        if (data != null) store.set(url, { data, at: Date.now() });
        return data ?? null;
      })
      .catch(() => null)
      .finally(() => {
        pending.delete(url);
      });
    pending.set(url, p);
  }
  return p as Promise<T | null>;
}

/** Forget cached entries whose URL starts with `prefix` (after a local edit). */
export function invalidateJson(prefix: string): void {
  for (const key of [...store.keys()]) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}

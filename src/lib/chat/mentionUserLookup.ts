/**
 * Last-resort name lookup for `<@id>` mentions nobody on screen can name
 * (someone who left the server, a user mentioned in a DM, a bot outside the
 * member list). Each id is fetched once from `/api/users/:id` and kept for
 * the signed-in account; a few requests run at a time. React reads it through
 * `useSyncExternalStore` (hooks/useMentionNames), so nothing polls.
 */
import type { MentionUserInfo } from "@/lib/chat/mentionResolver";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_ENTRIES = 500;
const MAX_CONCURRENT = 4;

/** id → user, or null once a lookup failed (not retried this session). Replaced on every change. */
let cache: ReadonlyMap<string, MentionUserInfo | null> = new Map();
const queued = new Set<string>();
const queue: string[] = [];
const listeners = new Set<() => void>();
let running = 0;
let owner: string | null = null;
let generation = 0;

function emit() {
  for (const l of listeners) l();
}

function pump() {
  while (running < MAX_CONCURRENT && queue.length > 0) {
    const id = queue.shift()!;
    const gen = generation;
    running++;
    fetch(`/api/users/${encodeURIComponent(id)}`, { credentials: "same-origin" })
      .then(async (r) => {
        if (!r.ok) return null;
        const u = await r.json().catch(() => null);
        return u && typeof u.id === "string"
          ? { id: u.id, username: u.username ?? undefined, displayName: u.displayName || u.username || undefined, avatar: u.avatar ?? undefined }
          : null;
      })
      .catch(() => null)
      .then((user: MentionUserInfo | null) => {
        running--;
        queued.delete(id);
        // The account changed while this was in flight: drop the answer.
        if (gen === generation) {
          const next = new Map(cache.size >= MAX_ENTRIES ? [] : cache);
          next.set(id, user);
          cache = next;
          emit();
        }
        pump();
      });
  }
}

/** Cached answer: a user, null (lookup failed), or undefined (never asked). */
export function peekMentionUser(id: string): MentionUserInfo | null | undefined {
  return cache.get(id);
}

/** The whole cache as an immutable map (a new object after every change), for useSyncExternalStore. */
export function getMentionUserSnapshot(): ReadonlyMap<string, MentionUserInfo | null> {
  return cache;
}

/**
 * Ask for `id` once. `viewerId` scopes the cache to the signed-in account
 * (cleared when it changes). Non-UUID ids are ignored.
 */
export function requestMentionUser(id: string, viewerId: string | null | undefined): void {
  if (!viewerId || !UUID_RE.test(id)) return;
  if (owner !== viewerId) {
    owner = viewerId;
    generation++;
    cache = new Map();
    queued.clear();
    queue.length = 0;
  }
  if (cache.has(id) || queued.has(id)) return;
  queued.add(id);
  queue.push(id);
  pump();
}

export function subscribeMentionUsers(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

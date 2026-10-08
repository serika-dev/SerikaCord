// Pure validation helpers for server/channel routes (no DB, no network), so
// they can be unit tested. Used by src/lib/api/servers.ts and channels.ts.
import { normalizeId } from '@/lib/db/normalizeId';

const THREAD_TYPES = new Set(['public_thread', 'private_thread']);

/** Compare two ids, tolerating legacy ObjectIds, case and null. */
export function sameId(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return normalizeId(a).toLowerCase() === normalizeId(b).toLowerCase();
}

function idKey(id: string): string {
  return normalizeId(id).toLowerCase();
}

export interface ChannelReorderUpdate {
  id: string;
  position: number;
  parentId?: string | null;
}

/**
 * Validates a drag-and-drop reorder payload against the server's own
 * channels. Every id must be a (non-thread) channel of this server, and a new
 * parent must be one of this server's categories. Returns an error message,
 * or null when the payload is safe to apply.
 */
export function validateChannelReorder(
  updates: ChannelReorderUpdate[],
  ownChannels: Array<{ id: string; type?: string | null }>,
): string | null {
  const byId = new Map<string, { id: string; type?: string | null }>();
  for (const ch of ownChannels) byId.set(idKey(ch.id), ch);

  for (const update of updates) {
    const target = typeof update.id === 'string' ? byId.get(idKey(update.id)) : undefined;
    if (!target || THREAD_TYPES.has(String(target.type))) {
      return 'Channel does not belong to this server';
    }
    if (update.parentId === undefined || update.parentId === null || update.parentId === '') continue;
    if (target.type === 'category') return 'A category cannot have a parent category';
    const parent = byId.get(idKey(update.parentId));
    if (!parent || parent.type !== 'category') return 'Invalid parent category';
  }
  return null;
}

export interface PermissionOverwriteCopy {
  id: string;
  type: 'role' | 'member';
  allow: string;
  deny: string;
}

/**
 * Deep-copies a channel's permission overwrites (jsonb) so a new channel can
 * start synced with its category without sharing the same objects. Malformed
 * entries are dropped.
 */
export function copyPermissionOverwrites(raw: unknown): PermissionOverwriteCopy[] {
  if (!Array.isArray(raw)) return [];
  const out: PermissionOverwriteCopy[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const o = entry as Record<string, unknown>;
    if (typeof o.id !== 'string' || !o.id) continue;
    if (o.type !== 'role' && o.type !== 'member') continue;
    out.push({
      id: o.id,
      type: o.type,
      allow: typeof o.allow === 'string' ? o.allow : String(o.allow ?? '0'),
      deny: typeof o.deny === 'string' ? o.deny : String(o.deny ?? '0'),
    });
  }
  return out;
}

export interface ServerSafety {
  antiSpam: boolean;
  mentionSpamLimit: number;
}

export const DEFAULT_SERVER_SAFETY: ServerSafety = { antiSpam: true, mentionSpamLimit: 5 };

/** Reads the stored `settings.safety` section with the same defaults the UI shows. */
export function resolveServerSafety(raw: { antiSpam?: unknown; mentionSpamLimit?: unknown } | null | undefined): ServerSafety {
  const limit = raw?.mentionSpamLimit;
  return {
    antiSpam: raw?.antiSpam !== false,
    mentionSpamLimit:
      typeof limit === 'number' && Number.isFinite(limit) && limit >= 1
        ? Math.floor(limit)
        : DEFAULT_SERVER_SAFETY.mentionSpamLimit,
  };
}

/**
 * True when a message mentions more targets (users + roles, @everyone/@here
 * counting as one) than the server allows. Only applies while anti-spam is on.
 */
export function exceedsMentionLimit(
  mentions: { mentionEveryone?: boolean; mentionedUserIds?: string[]; mentionedRoleIds?: string[] },
  safety: ServerSafety,
): boolean {
  if (!safety.antiSpam) return false;
  const count =
    (mentions.mentionedUserIds?.length ?? 0)
    + (mentions.mentionedRoleIds?.length ?? 0)
    + (mentions.mentionEveryone ? 1 : 0);
  return count > safety.mentionSpamLimit;
}

/**
 * Gives every soundboard entry a valid `id`. Entries added after the move to
 * Postgres had none (and legacy Mongo `_id`s don't pass the UUID route guard),
 * which made them impossible to delete. Returns a new array and whether
 * anything changed, so callers only persist when needed.
 */
export function ensureSoundboardIds<T extends Record<string, unknown>>(
  raw: unknown,
  isValidId: (id: string) => boolean,
  makeId: () => string,
): { sounds: Array<T & { id: string }>; changed: boolean } {
  if (!Array.isArray(raw)) return { sounds: [], changed: false };
  let changed = false;
  const seen = new Set<string>();
  const sounds = raw
    .filter((s): s is T => Boolean(s) && typeof s === 'object')
    .map((s) => {
      const id = (s as Record<string, unknown>).id;
      if (typeof id === 'string' && isValidId(id) && !seen.has(id)) {
        seen.add(id);
        return s as T & { id: string };
      }
      changed = true;
      const fresh = makeId();
      seen.add(fresh);
      return { ...s, id: fresh } as T & { id: string };
    });
  if (sounds.length !== raw.length) changed = true;
  return { sounds, changed };
}

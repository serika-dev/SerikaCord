import { normalizeId } from '@/lib/db/normalizeId';

/**
 * Pure helpers for the friend / pending-request / block id lists stored on
 * `users`. Ids are compared after normalizeId so legacy ObjectId-shaped ids
 * and their UUID form count as the same user, and every helper returns a
 * deduplicated list so a double-click (or two devices) can never add the same
 * user twice.
 */

export function sameId(a: string, b: string): boolean {
  return normalizeId(a) === normalizeId(b);
}

export function hasId(list: readonly string[] | null | undefined, id: string): boolean {
  return (list || []).some((x) => sameId(x, id));
}

/** Drop duplicate ids (first occurrence wins, order kept). */
export function dedupeIds(list: readonly string[] | null | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of list || []) {
    if (!id) continue;
    const key = normalizeId(id);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(id);
  }
  return out;
}

/** `list` plus `id`, without duplicates. */
export function addId(list: readonly string[] | null | undefined, id: string): string[] {
  const base = dedupeIds(list);
  return hasId(base, id) ? base : [...base, id];
}

/** `list` without any entry equal to `id` (and without duplicates). */
export function removeId(list: readonly string[] | null | undefined, id: string): string[] {
  return dedupeIds(list).filter((x) => !sameId(x, id));
}

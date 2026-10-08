/**
 * Structural sharing for polled lists: returns `next` with every item that is
 * deep-equal (by JSON) to the previous item with the same key replaced by
 * that previous object, or `prev` itself when nothing changed at all. Keeps
 * object identities stable so memoized rows skip re-rendering.
 */
export function reuseUnchanged<T>(prev: T[], next: T[], keyOf: (item: T) => unknown): T[] {
  const prevByKey = new Map<unknown, T>();
  for (const item of prev) prevByKey.set(keyOf(item), item);
  let changed = prev.length !== next.length;
  const out = next.map((item, i) => {
    const old = prevByKey.get(keyOf(item));
    if (old !== undefined && JSON.stringify(old) === JSON.stringify(item)) {
      if (prev[i] !== old) changed = true;
      return old;
    }
    changed = true;
    return item;
  });
  return changed ? out : prev;
}

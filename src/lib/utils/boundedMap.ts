/**
 * Drop-in bounded Map for module-level in-process caches.
 *
 * Most server caches here are TTL caches that only overwrite entries on
 * re-access — nothing ever *removes* keys that stop being accessed (rotated
 * auth tokens, one-off game lookups, departed users), so on a long-lived
 * `bun server.ts` process they grow forever. This subclass evicts the
 * oldest-inserted entry once `maxSize` is exceeded, turning every such cache
 * into a bounded FIFO/LRU-ish cache with a one-line change at the call site.
 *
 * Callers that refresh recency (delete+set on read) get true LRU behaviour;
 * everyone else gets FIFO, which is fine for short-TTL caches.
 */
export class BoundedMap<K, V> extends Map<K, V> {
  constructor(private readonly maxSize: number) {
    super();
  }

  override set(key: K, value: V): this {
    // Re-inserting moves the key to the back of the iteration order.
    if (this.has(key)) this.delete(key);
    super.set(key, value);
    while (this.size > this.maxSize) {
      const oldest = this.keys().next().value;
      if (oldest === undefined) break;
      this.delete(oldest);
    }
    return this;
  }
}

/**
 * Expiring cache of role permission bitfields keyed by `${serverId}:${roleId}`.
 *
 * Every entry carries its own expiry, so no write path can create an entry
 * that lives forever (the old setTimeout-on-miss design let warm writes
 * outlive the timer). Pure: no DB access, injectable clock for tests.
 */
import { BoundedMap } from '@/lib/utils/boundedMap';

export const ROLE_CACHE_TTL_MS = 60_000;

interface Entry {
  perms: string;
  exp: number;
}

export class RolePermCache {
  private readonly map: BoundedMap<string, Entry>;

  constructor(
    maxSize = 10_000,
    private readonly ttlMs = ROLE_CACHE_TTL_MS,
    private readonly now: () => number = Date.now,
  ) {
    this.map = new BoundedMap<string, Entry>(maxSize);
  }

  private static key(serverId: string, roleId: string): string {
    return `${serverId}:${roleId}`;
  }

  get(serverId: string, roleId: string): string | undefined {
    const key = RolePermCache.key(serverId, roleId);
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (entry.exp <= this.now()) {
      this.map.delete(key);
      return undefined;
    }
    return entry.perms;
  }

  set(serverId: string, roleId: string, perms: string): void {
    this.map.set(RolePermCache.key(serverId, roleId), { perms, exp: this.now() + this.ttlMs });
  }

  /** Drop one role, or every role of the server when `roleId` is omitted. */
  invalidate(serverId: string, roleId?: string): void {
    if (roleId) {
      this.map.delete(RolePermCache.key(serverId, roleId));
      return;
    }
    const prefix = `${serverId}:`;
    for (const key of Array.from(this.map.keys())) {
      if (key.startsWith(prefix)) this.map.delete(key);
    }
  }

  get size(): number {
    return this.map.size;
  }
}

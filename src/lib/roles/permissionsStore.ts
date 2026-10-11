/**
 * Per-server "my permissions" snapshots shared by every `usePermissions`
 * consumer (a `useSyncExternalStore` source). Pure: no fetching here, so it is
 * unit-testable; the hook decides when to load via `claimRefresh`.
 */
export interface PermissionsSnapshot<V> {
  isOwner: boolean;
  bitfield: bigint;
  verification: V | null;
}

/** A snapshot younger than this is reused without asking the server again. */
export const PERMISSIONS_FRESH_MS = 5000;

export class PermissionsStore<V> {
  private readonly snapshots = new Map<string, PermissionsSnapshot<V>>();
  private readonly loadedAt = new Map<string, number>();
  private readonly inflight = new Set<string>();
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly freshMs = PERMISSIONS_FRESH_MS,
    private readonly maxServers = 100,
  ) {}

  /** Stable across calls until `set` replaces it (required by useSyncExternalStore). */
  get = (serverId: string): PermissionsSnapshot<V> | undefined => this.snapshots.get(serverId);

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  set(serverId: string, snapshot: PermissionsSnapshot<V>, now = Date.now()): void {
    this.loadedAt.set(serverId, now);
    const prev = this.snapshots.get(serverId);
    // Keep the old object when nothing changed so consumers don't re-render.
    if (
      prev &&
      prev.isOwner === snapshot.isOwner &&
      prev.bitfield === snapshot.bitfield &&
      JSON.stringify(prev.verification) === JSON.stringify(snapshot.verification)
    ) {
      return;
    }
    this.snapshots.delete(serverId);
    this.snapshots.set(serverId, snapshot);
    while (this.snapshots.size > this.maxServers) {
      const oldest = this.snapshots.keys().next().value;
      if (oldest === undefined) break;
      this.snapshots.delete(oldest);
      this.loadedAt.delete(oldest);
    }
    for (const l of [...this.listeners]) l();
  }

  /**
   * Returns a `done` callback when the caller should (re)load `serverId` —
   * nothing cached, or the snapshot is stale and no load is in flight — and
   * `null` otherwise. Call `done` when the load settles.
   */
  claimRefresh(serverId: string, now = Date.now()): (() => void) | null {
    if (this.inflight.has(serverId)) return null;
    const at = this.loadedAt.get(serverId);
    if (at !== undefined && this.snapshots.has(serverId) && now - at < this.freshMs) return null;
    this.inflight.add(serverId);
    return () => {
      this.inflight.delete(serverId);
    };
  }
}

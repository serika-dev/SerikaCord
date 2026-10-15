// The version of a conversation's public key set: a digest over what senders
// encrypt to (members' identity and backup keys, active and revoked devices).
// Clients cache key bundles and say which version they encrypted for; the
// send routes refuse a stale one (409 e2ee_keys_changed) so a client never
// keeps encrypting to a revoked device or a replaced identity key, and the
// client refetches and retries once. Pure (no hashing here: the server hashes
// this string, clients only compare versions). Unit-tested.

export interface VersionedDevice {
  id: string;
  ecdhPub: string;
  signPub: string;
  sig: string;
  revokedAt?: string | Date | null;
}

export interface VersionedBundle {
  userId: string;
  identityPub: string | null;
  backupPub: string | null;
  backupSig: string | null;
  devices: VersionedDevice[];
  revokedDevices?: VersionedDevice[];
}

function revokedMs(value: VersionedDevice["revokedAt"]): number {
  if (!value) return 0;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : 0;
}

/**
 * Canonical text of a key set: order-independent (members by user id,
 * devices by id), and blind to everything that isn't key material (names,
 * last-seen times), so it only changes when what senders must encrypt to
 * changes.
 */
export function canonicalKeySet(bundles: VersionedBundle[]): string {
  const members = [...bundles]
    .map((b) => {
      const devices = [...(b.devices ?? []), ...(b.revokedDevices ?? [])]
        .map((d) => [d.id, d.ecdhPub, d.signPub, d.sig, revokedMs(d.revokedAt)] as const)
        .sort((a, c) => (a[0] < c[0] ? -1 : a[0] > c[0] ? 1 : 0));
      return [b.userId.toLowerCase(), b.identityPub ?? "", b.backupPub ?? "", b.backupSig ?? "", devices] as const;
    })
    .sort((a, c) => (a[0] < c[0] ? -1 : a[0] > c[0] ? 1 : 0));
  return JSON.stringify(["serika-e2ee-keyset-v1", members]);
}

/** A key-set version as sent by clients: short hex, nothing else. */
export function isKeysVersion(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{16,64}$/.test(value);
}

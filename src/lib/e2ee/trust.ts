// Trust on first use for contacts' identity keys (pure, isomorphic, tested).
// The client keeps one pin per contact in IndexedDB (client/keyStore
// IdentityPin); client/session applies these rules to the in-memory copy and,
// in the same read-modify-write transaction, to the stored one, so tabs never
// overwrite each other's decisions. See docs/architecture/e2ee.md "Trust on
// first use".

export interface TrustPin {
  /** The identity key we currently trust. */
  key: string;
  /** Every key ever acknowledged for this user (verifies their older devices). */
  seen: string[];
  /** Safety number compared in person (for `key`). */
  verified: boolean;
  /** A different key the server announced, waiting for the user to review it. */
  pending?: string | null;
  updatedAt: number;
}

export type ObservedTrust = "new" | "trusted" | "verified" | "changed";

export interface IdentityObservation<P extends TrustPin = TrustPin> {
  /** The pin after this observation (the same object when nothing changed). */
  pin: P;
  /** Whether `pin` differs from the one passed in (must be saved). */
  dirty: boolean;
  trust: ObservedTrust;
  /** The key devices may be encrypted to / verified under (null while a change waits for review). */
  currentKey: string | null;
  /** The new key waiting for review (trust "changed"). */
  pendingKey: string | null;
}

/**
 * A contact's identity key as the server announced it. `stale` copies (key
 * bundles cached on this device) never change what is pending: an old copy
 * must neither clear a change the user hasn't reviewed nor bring back a key
 * they already replaced.
 */
export function observeIdentity<P extends TrustPin>(
  pin: P | null | undefined,
  identityPub: string,
  now: number,
  opts: { stale?: boolean } = {},
): IdentityObservation<P> {
  if (!pin) {
    const created = { key: identityPub, seen: [identityPub], verified: false, pending: null, updatedAt: now } as unknown as P;
    return { pin: created, dirty: true, trust: "new", currentKey: identityPub, pendingKey: null };
  }
  if (pin.key === identityPub) {
    const trust: ObservedTrust = pin.verified ? "verified" : "trusted";
    if (pin.pending && !opts.stale) {
      return { pin: { ...pin, pending: null, updatedAt: now }, dirty: true, trust, currentKey: identityPub, pendingKey: null };
    }
    return { pin, dirty: false, trust, currentKey: identityPub, pendingKey: null };
  }
  // Until reviewed, only devices vouched for by keys we already trusted count.
  if (!opts.stale && pin.pending !== identityPub) {
    return { pin: { ...pin, pending: identityPub, updatedAt: now }, dirty: true, trust: "changed", currentKey: null, pendingKey: identityPub };
  }
  return { pin, dirty: false, trust: "changed", currentKey: null, pendingKey: identityPub };
}

/**
 * The user accepted `identityPub` (the new security code they were shown):
 * it becomes the trusted key, the old one stays in `seen` (their older
 * devices still verify old messages). `verified` when they also compared the
 * safety number. Accepting a key that is already the trusted one only clears
 * a pending change for that same key (another tab got there first).
 */
export function acceptIdentity<P extends TrustPin>(pin: P | null | undefined, identityPub: string, now: number, verified = false): P {
  if (!pin) return { key: identityPub, seen: [identityPub], verified, pending: null, updatedAt: now } as unknown as P;
  if (pin.key === identityPub) {
    const pending = pin.pending === identityPub ? null : pin.pending ?? null;
    if (pending === (pin.pending ?? null) && (!verified || pin.verified)) return pin;
    return { ...pin, pending, verified: pin.verified || verified, updatedAt: now };
  }
  return {
    ...pin,
    key: identityPub,
    seen: [...new Set([...pin.seen, pin.key, identityPub])],
    verified,
    pending: null,
    updatedAt: now,
  };
}

/**
 * "Mark as verified" / "Clear verification" for the safety number of
 * `identityPub` (the key the dialog showed). Verifying a key that isn't the
 * trusted one yet (a pending change) accepts it as verified; clearing only
 * ever applies to the trusted key.
 */
export function setIdentityVerified<P extends TrustPin>(pin: P | null | undefined, identityPub: string, verified: boolean, now: number): P | null {
  if (!pin) return verified ? acceptIdentity(null, identityPub, now, true) as P : null;
  if (pin.key === identityPub) {
    if (pin.verified === verified) return pin;
    return { ...pin, verified, updatedAt: now };
  }
  return verified ? acceptIdentity(pin, identityPub, now, true) : pin;
}

/** Whether two pins say the same thing (ignores updatedAt). */
export function samePin(a: TrustPin | null | undefined, b: TrustPin | null | undefined): boolean {
  if (!a || !b) return !a && !b;
  return a.key === b.key
    && a.verified === b.verified
    && (a.pending ?? null) === (b.pending ?? null)
    && a.seen.length === b.seen.length
    && a.seen.every((k, i) => b.seen[i] === k);
}

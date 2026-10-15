"use client";

// The tiny, crypto-free part of the client E2EE state: a snapshot React can
// subscribe to (useSyncExternalStore) without loading the crypto module.
// session.ts (lazy-loaded) does the work and publishes here.

export type E2eePhase =
  /** Not started yet (or signed out). */
  | "idle"
  /** WebCrypto or IndexedDB is missing / blocked here. */
  | "unavailable"
  /** The server has E2EE switched off and this device has no keys. */
  | "disabled"
  /** Keys on this device, published and usable. */
  | "ready"
  /** The account has keys elsewhere: restore them here with the passphrase (or reset). */
  | "needs-restore"
  | "error";

export interface E2eeSnapshot {
  phase: E2eePhase;
  /** Server-side feature flag (E2EE_ENABLED). */
  enabled: boolean;
  userId: string | null;
  deviceId: string | null;
  identityPub: string | null;
  /** A passphrase backup exists for the current keys. */
  hasPassphrase: boolean;
  /** The server holds a backup this device could restore from. */
  serverHasBackup: boolean;
  /** Show the "set a recovery passphrase" onboarding. */
  remindPassphrase: boolean;
  error: string | null;
  /** Bumped whenever trust pins change (safety-number banners re-check). */
  pinsVersion: number;
  /**
   * This account's encryption was reset on another device: this device's old
   * keys were archived (old history stays readable here) and it needs the new
   * recovery passphrase.
   */
  resetElsewhere: boolean;
  /**
   * The private identity / backup keys here can still be exported (no backup
   * sealed yet). Once sealed they are re-imported non-extractable, and
   * changing the passphrase needs the current one.
   */
  keysExtractable: boolean;
}

const INITIAL: E2eeSnapshot = {
  phase: "idle",
  enabled: false,
  userId: null,
  deviceId: null,
  identityPub: null,
  hasPassphrase: false,
  serverHasBackup: false,
  remindPassphrase: false,
  error: null,
  pinsVersion: 0,
  resetElsewhere: false,
  keysExtractable: false,
};

let snapshot: E2eeSnapshot = INITIAL;
const listeners = new Set<() => void>();

export function getE2eeSnapshot(): E2eeSnapshot {
  return snapshot;
}

export function getServerE2eeSnapshot(): E2eeSnapshot {
  return INITIAL;
}

export function subscribeE2ee(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setE2eeSnapshot(patch: Partial<E2eeSnapshot>): void {
  const next = { ...snapshot, ...patch };
  const changed = (Object.keys(patch) as Array<keyof E2eeSnapshot>).some((k) => snapshot[k] !== next[k]);
  if (!changed) return;
  snapshot = next;
  listeners.forEach((l) => l());
}

export function resetE2eeSnapshot(): void {
  snapshot = INITIAL;
  listeners.forEach((l) => l());
}

/** Lazy-load the crypto-bearing session module. */
export function loadE2eeSession() {
  return import("./session");
}

// UI requests (open the restore / passphrase dialogs from anywhere).
export type E2eeDialogRequest = "onboard" | "restore" | "change-passphrase" | "reset";
const dialogListeners = new Set<(req: E2eeDialogRequest) => void>();

export function openE2eeDialog(request: E2eeDialogRequest): void {
  dialogListeners.forEach((l) => l(request));
}

export function onE2eeDialogRequest(listener: (req: E2eeDialogRequest) => void): () => void {
  dialogListeners.add(listener);
  return () => dialogListeners.delete(listener);
}

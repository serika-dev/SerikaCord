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
  /**
   * Bumped whenever a cached conversation key set turned out to have changed
   * (a device added / removed, keys reset): open chats re-check what they
   * show, banners refresh.
   */
  keysVersion: number;
  /**
   * Bumped when this device changed a conversation's on / off state itself
   * (e.g. confirmed "turned off" while the server already reported it off, so
   * no live event follows): open chats re-check.
   */
  conversationsVersion: number;
  /**
   * This browser had encryption keys for the account before and they are
   * gone (cleared site data, storage eviction): guide to linking / restoring.
   */
  keysLost: boolean;
  /** The server can keep PIN backups (E2EE on and its pepper configured). */
  pinAvailable: boolean;
  /** A 6-digit PIN backup exists for the current keys. */
  hasPin: boolean;
  /** Wrong PIN tries left before the PIN backup is destroyed (null: no PIN). */
  pinAttemptsLeft: number | null;
  /** The PIN backup was destroyed after too many wrong attempts (and no new one set yet). */
  pinLocked: boolean;
  /**
   * The account has no PIN yet and this device can set one: DM pages show
   * "Create a 6-digit PIN" (or, with a recovery passphrase, "Upgrade to a
   * 6-digit PIN") until it's done.
   */
  requirePinSetup: boolean;
  /** The account has a recovery passphrase but no PIN: the setup starts by entering the passphrase. */
  pinUpgrade: boolean;
  /** No PIN, no passphrase, and the keys here are sealed: the PIN must be set on the first device. */
  pinSetupElsewhere: boolean;
  /** "Not now" on the unlock screen of DM pages (this session only). */
  unlockGateDeferred: boolean;
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
  keysVersion: 0,
  conversationsVersion: 0,
  keysLost: false,
  pinAvailable: false,
  hasPin: false,
  pinAttemptsLeft: null,
  pinLocked: false,
  requirePinSetup: false,
  pinUpgrade: false,
  pinSetupElsewhere: false,
  unlockGateDeferred: false,
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

/**
 * What a DM / group DM page shows instead of the conversation: the PIN setup
 * (required once per account), or the unlock screen on a device without keys
 * (until "Not now"). Bots / system accounts are never gated.
 */
export function e2eeGateFor(snap: E2eeSnapshot, unsupported: boolean): "setup" | "unlock" | null {
  if (unsupported) return null;
  if (snap.phase === "ready" && snap.requirePinSetup) return "setup";
  if (snap.phase === "needs-restore" && snap.enabled && !snap.unlockGateDeferred) return "unlock";
  return null;
}

/** Lazy-load the crypto-bearing session module. */
export function loadE2eeSession() {
  return import("./session");
}

// UI requests (open the restore / passphrase dialogs from anywhere).
export type E2eeDialogRequest =
  | "onboard"
  | "restore"
  | "change-passphrase"
  | "reset"
  /** This (new) device: show a code / QR for another device to approve. */
  | "link-new"
  /** This (existing) device: approve a new device by its code / QR. */
  | "link-approve"
  /** Create a 6-digit PIN (first setup, after a reset, or upgrading an account with a passphrase). */
  | "pin-setup"
  /** New device: enter the PIN to get the keys. */
  | "pin-unlock"
  /** Change the PIN (needs the current one). */
  | "pin-change";
/** sessionStorage key: a link code opened from a scanned QR (/e2ee/link), picked up by E2eeHost. */
export const E2EE_LINK_INPUT_KEY = "serika-e2ee:link-input";

/** Extra input for a dialog (link-approve: a code / scanned link to start with). */
export interface E2eeDialogOptions {
  linkInput?: string;
}
const dialogListeners = new Set<(req: E2eeDialogRequest, options?: E2eeDialogOptions) => void>();

export function openE2eeDialog(request: E2eeDialogRequest, options?: E2eeDialogOptions): void {
  dialogListeners.forEach((l) => l(request, options));
}

export function onE2eeDialogRequest(listener: (req: E2eeDialogRequest, options?: E2eeDialogOptions) => void): () => void {
  dialogListeners.add(listener);
  return () => dialogListeners.delete(listener);
}

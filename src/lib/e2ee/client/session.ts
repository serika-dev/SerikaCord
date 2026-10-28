"use client";

// The client E2EE session (lazy-loaded): device setup, passphrase backup,
// restore / reset, device linking, contact key trust (TOFU + safety numbers),
// and encrypting / decrypting messages and attachments for the chat engine.
// Decrypted messages are cached in memory and, encrypted under a per-device
// key, in IndexedDB (plainCache.ts); plaintext is never written to disk.
//
// The server is untrusted: key bundles must belong to the user asked for, a
// 1:1 DM's members must be exactly us + the person in the URL, group messages
// are only encrypted to the members the group shows, rows must belong to the
// open conversation, and payload URLs must point at our CDN.
//
// Speed (docs/architecture/e2ee.md "Performance"): keys load from IndexedDB
// before the server is asked anything, so decryption starts at once; key
// bundles are served from memory / IndexedDB and revalidated in the
// background (the send routes refuse a stale key set, and the chat retries);
// decrypted results are reused instead of decrypted again.
import {
  ATTACHMENT_BLOB_TYPE,
  E2eeFormatError,
  E2eeVerifyError,
  backupRecipientId,
  capRecipients,
  compareGroupMembers,
  computeSafetyNumber,
  conversationKey,
  deriveLinkSecrets,
  describeDevice,
  e2eeTargetForCallRoom,
  encryptMessage,
  exportPrivateJwk,
  exportPublicKey,
  generateBackupKeyPair,
  generateDeviceKeys,
  generateEphemeralKeyPair,
  generateIdentityKeyPair,
  hasDuplicateIds,
  importBackupPrivateJwk,
  importIdentityPrivateJwk,
  isCdnUrl,
  isE2eeCryptoAvailable,
  isExactDmMembers,
  isStrongRecoveryPassphrase,
  LINK_TTL_SECONDS,
  linkCommitment,
  linkQrPayload,
  openBackup,
  openEnvelope,
  openLinkPayload,
  parseEnvelope,
  parseLinkInput,
  payloadUrlsAllowed,
  publicKeyFromJwk,
  sealBackup,
  sealLinkPayload,
  selectNotifyRecipients,
  signBackupKey,
  signDevice,
  signNotifyKey,
  signDtlsFingerprints,
  toB64,
  verifyBackupKey,
  verifyDevice,
  verifyDtlsFingerprints,
  verifyEnvelopeSignature,
  verifyNotifyKey,
  UUID_RE,
  type BackupSecrets,
  type E2eeTarget,
  type Envelope,
  type LinkSecrets,
  type MessagePayload,
  type PublicDevice,
  type PublicNotifyKey,
  type WrapRecipient,
} from "@/lib/e2ee";
import { fromB64, fromUtf8, randomBytes, utf8 } from "@/lib/e2ee/encoding";
import {
  PIN_MAX_ATTEMPTS,
  PIN_PBKDF2_ITERATIONS,
  isEasyPin,
  isValidPin,
  openPinBundle,
  pinSecretCheck,
  sealPinBundle,
  signPinCommit,
  signRecoveryRemoval,
} from "@/lib/e2ee/pin";
import { PBKDF2_SALT_BYTES } from "@/lib/e2ee/constants";
import { acceptIdentity, observeIdentity, samePin, setIdentityVerified } from "@/lib/e2ee/trust";
import {
  checkOffRecord,
  dmPair,
  parseConversationState,
  signConversationOff,
  verifyConversationStateSig,
  type ConversationStateRecord,
  type OffRejection,
} from "@/lib/e2ee/conversationState";
import {
  E2eeUnavailableError,
  KeyStore,
  acceptConversationOff,
  getConversationStateMemory,
  isKeyStoreAvailable,
  type ArchivedKeys,
  type IdentityPin,
  type StoredDevice,
  type StoredIdentity,
} from "./keyStore";
import { getE2eeSnapshot, resetE2eeSnapshot, setE2eeSnapshot } from "./state";
import {
  forgetPlainMemory,
  getCachedBundles,
  getPlainMany,
  listCachedBundles,
  peekPlain,
  plainCacheKey,
  putCachedBundles,
  putPlainMany,
  rememberPlain,
  rememberText,
  rememberValidatedChannel,
  validatedChannelOf,
  type PlainEntry,
} from "./plainCache";
import { applyPayload } from "./view";
import { decryptFileBytes, derivePinKeysOffThread, encryptFileBytes } from "./fileCrypto";

// ─── Module state (one signed-in account at a time) ───────────────────────────

let store: KeyStore | null = null;
let userId: string | null = null;
let identity: StoredIdentity | null = null;
let backupKey: StoredIdentity | null = null;
let device: StoredDevice | null = null;
let pins: Record<string, IdentityPin> = {};
/**
 * Bumped whenever trust in a contact changes (a security code accepted or
 * verified, here or in another tab): key sets checked against older pins are
 * never cached.
 */
let trustEpoch = 0;
/** Tells this account's other tabs that pins changed (they reload them). */
let pinsChannel: BroadcastChannel | null = null;
/** Keys from before an encryption reset: decrypt / verify old history only. */
let archived: ArchivedKeys[] = [];
let resetElsewhere = false;
let initPromise: Promise<void> | null = null;
/** Settles once this device's keys are loaded from IndexedDB (no network). */
let localPromise: Promise<void> | null = null;

const MAX_ARCHIVED = 5;

const lower = (s: string) => s.toLowerCase();

/** Our CDN as the client knows it (the server config isn't bundled for the browser). */
function clientCdnUrl(): string {
  return process.env.NEXT_PUBLIC_CDN_URL || "https://cdn.serika.chat";
}

export class E2eeApiError extends Error {
  constructor(readonly status: number, message: string, readonly code: string | null = null, readonly details: Record<string, unknown> | null = null) {
    super(message);
    this.name = "E2eeApiError";
  }
}

/** A PIN unlock failed: wrong PIN (with tries left), the backup was destroyed, there is none, or PINs are unavailable. */
export class E2eePinError extends Error {
  constructor(readonly reason: "wrong" | "locked" | "no_pin" | "unavailable" | "rate_limited", readonly attemptsLeft: number | null = null) {
    super(reason === "wrong" ? "Wrong PIN" : reason === "locked" ? "The PIN backup was reset" : reason === "no_pin" ? "No PIN backup" : reason === "rate_limited" ? "Too many attempts" : "PINs are unavailable");
    this.name = "E2eePinError";
  }
}

/** Setting a PIN here needs proof first: the current PIN, the recovery passphrase, or it can't be done on this device. */
export class E2eePinProofError extends Error {
  constructor(readonly needs: "pin" | "passphrase" | "impossible") {
    super(needs === "impossible" ? "Set your PIN on the device where you first set up encryption" : "Confirm it's you first");
    this.name = "E2eePinProofError";
  }
}

/** Changing the passphrase once keys are sealed needs the current one (they can't be exported any more). */
export class E2eeCurrentPassphraseError extends Error {
  constructor() {
    super("Enter your current recovery passphrase");
    this.name = "E2eeCurrentPassphraseError";
  }
}

/** Approving a link needs the recovery passphrase (no recent proof of it on this device). */
export class E2eeLinkPassphraseError extends Error {
  constructor() {
    super("Enter your recovery passphrase to link a device");
    this.name = "E2eeLinkPassphraseError";
  }
}

/** Approving a link needs a recovery passphrase, and the account has none yet. */
export class E2eeLinkNeedsPassphraseError extends Error {
  constructor() {
    super("Set a recovery passphrase to link devices from this one");
    this.name = "E2eeLinkNeedsPassphraseError";
  }
}

/** A stalled request (mobile networks) must not hold up later refreshes forever. */
const API_TIMEOUT_MS = 20_000;

async function api<T = Record<string, unknown>>(path: string, init: RequestInit = {}): Promise<T> {
  // AbortController + timer rather than AbortSignal.timeout (Chromium 103+; the Qt shell is 102).
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), API_TIMEOUT_MS) : null;
  try {
    const res = await fetch(`/api/e2ee${path}`, {
      credentials: "include",
      cache: "no-store",
      ...init,
      ...(controller ? { signal: controller.signal } : {}),
      headers: { ...(init.body ? { "Content-Type": "application/json" } : {}), ...(init.headers || {}) },
    });
    // The body too: a stalled response body must not hold a step open.
    const data = (await res.json().catch((err: unknown) => {
      if (controller?.signal.aborted) throw err;
      return {};
    })) as T & { error?: string; code?: unknown };
    if (!res.ok) {
      throw new E2eeApiError(res.status, data?.error || `Request failed (${res.status})`, typeof data?.code === "string" ? data.code : null, data as Record<string, unknown>);
    }
    return data;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function deviceName(): string {
  if (typeof navigator === "undefined") return "Device";
  const ua = navigator.userAgent;
  const app = /QtWebEngine|SerikaCord/i.test(ua)
    ? "SerikaCord app"
    : /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Windows/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${app} on ${os}` : app;
}

/** Serialize key setup across tabs (they share IndexedDB). */
async function withSetupLock<T>(fn: () => Promise<T>): Promise<T> {
  const locks = (typeof navigator !== "undefined" ? (navigator as Navigator & { locks?: LockManager }).locks : undefined);
  if (!locks?.request) return fn();
  return locks.request(`serika-e2ee-setup:${userId ?? ""}`, () => fn()) as Promise<T>;
}

function clearKeyCaches() {
  channelKeyCache.clear();
  channelKeysSettled.clear();
  channelKeysInflight.clear();
  userKeyCache.clear();
}

function resetModuleState() {
  store = null;
  userId = null;
  identity = null;
  backupKey = null;
  device = null;
  pins = {};
  archived = [];
  resetElsewhere = false;
  initPromise = null;
  localPromise = null;
  clearKeyCaches();
  decryptCache.clear();
  frankingKeys.clear();
  verifyCache.clear();
  sentPlaintext.clear();
  signerBook.clear();
  signersPrimed = false;
  revokedSeen.clear();
  freshSigners.clear();
  conversationBook.clear();
  if (escrowTimer) clearTimeout(escrowTimer);
  escrowTimer = null;
  linkNew = null;
  linkApprove = null;
  linkNewPoll = null;
  linkApprovePoll = null;
  proofAt = 0;
  offChecks.clear();
  try {
    pinsChannel?.close();
  } catch {
    /* already closed */
  }
  pinsChannel = null;
}

/** Forget everything in memory (sign-out / account switch). Keys stay in IndexedDB. */
export function shutdownE2ee(): void {
  resetModuleState();
  resetE2eeSnapshot();
}

// ─── Setup ────────────────────────────────────────────────────────────────────

interface StatusResponse {
  enabled: boolean;
  identity: { identityPub: string; backupPub: string; hasBackup: boolean } | null;
  device: { id: string; active: boolean } | null;
  /** Servers before the PIN backup don't send it. */
  pin?: { available: boolean; set: boolean; attemptsLeft: number | null; lockedAt: string | null } | null;
}

/**
 * Start (or refresh) E2EE for the signed-in user. Never throws; the outcome is
 * published to the snapshot. Safe to call repeatedly.
 */
export function initE2ee(user: { id: string }): Promise<void> {
  if (userId && lower(user.id) !== lower(userId)) resetModuleState();
  if (initPromise) return initPromise;
  userId = user.id;
  let markLocal: () => void = () => {};
  localPromise = new Promise<void>((resolve) => {
    markLocal = resolve;
  });
  const attempt = { failed: false };
  const run = (async () => {
    try {
      await runInit(markLocal);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setE2eeSnapshot({ phase: err instanceof E2eeUnavailableError ? "unavailable" : "error", error: message });
      attempt.failed = true;
    } finally {
      markLocal();
    }
  })();
  initPromise = run;
  // Let a later call retry after a failure.
  void run.then(() => {
    if (attempt.failed && initPromise === run) initPromise = null;
  });
  return run;
}

/** Wait for the current init to settle; starts it for `selfId` when it hasn't started. */
export async function whenE2eeSettled(selfId?: string | null): Promise<void> {
  if (!initPromise && selfId) void initE2ee({ id: selfId });
  if (initPromise) await initPromise;
}

/**
 * Wait until this device's keys are loaded from storage (no network: the
 * server check runs on in the background). Starts E2EE for `selfId` when it
 * hasn't started yet, so nothing waits for an idle callback.
 */
export async function whenLocalReady(selfId?: string | null): Promise<void> {
  if (!initPromise && selfId) void initE2ee({ id: selfId });
  if (localPromise) await localPromise;
}

/** Archived keys are only ever used to read: never keep an exportable copy. */
async function nonExtractableCopy(key: StoredIdentity | null, kind: "identity" | "backup"): Promise<StoredIdentity | null> {
  if (!key || !key.priv.extractable) return key;
  try {
    const jwk = await exportPrivateJwk(key.priv);
    const priv = kind === "identity" ? await importIdentityPrivateJwk(jwk, false) : await importBackupPrivateJwk(jwk, false);
    return { priv, pub: key.pub };
  } catch {
    return key;
  }
}

/**
 * Move this device's current keys to the local archive (old history stays
 * readable here) and clear them. Never deletes a key outright.
 */
async function archiveCurrentKeys(): Promise<void> {
  const s = store!;
  if (identity || backupKey || device) {
    const already = identity && archived.some((a) => a.identity?.pub === identity!.pub);
    if (!already) {
      const entry: ArchivedKeys = {
        identity: await nonExtractableCopy(identity, "identity"),
        backup: await nonExtractableCopy(backupKey, "backup"),
        device,
        archivedAt: Date.now(),
      };
      archived = [entry, ...archived].slice(0, MAX_ARCHIVED);
      await s.put("archive", archived);
    }
  }
  await s.clearKeys();
  identity = backupKey = device = null;
  clearKeyCaches();
}

// "This browser had keys for this account": set once a device is ready, so a
// later start without keys can say they were cleared (storage eviction, site
// data cleared) instead of treating this like a brand-new device.
const HAD_KEYS_PREFIX = "serika-e2ee:had-keys:";

function hadKeysHere(uid: string): boolean {
  try {
    return localStorage.getItem(HAD_KEYS_PREFIX + lower(uid)) === "1";
  } catch {
    return false;
  }
}

function markHadKeys(uid: string) {
  try {
    localStorage.setItem(HAD_KEYS_PREFIX + lower(uid), "1");
  } catch {
    /* private mode: no hint next time */
  }
}

let persistAsked = false;

/** Ask the browser not to evict our storage (keys!), notably iOS Safari / PWAs. */
function requestPersistentStorage() {
  if (persistAsked) return;
  persistAsked = true;
  try {
    const storage = typeof navigator !== "undefined" ? navigator.storage : undefined;
    if (!storage?.persist) return;
    void storage.persisted?.().then((already) => (already ? true : storage.persist())).catch(() => {});
  } catch {
    /* not supported */
  }
}

async function loadLocalKeys(withPins: boolean): Promise<void> {
  const s = store!;
  const local = withPins
    ? await s.getMany(["identity", "backup", "device", "archive", "pins"])
    : await s.getMany(["identity", "backup", "device", "archive"]);
  identity = local.identity;
  backupKey = local.backup;
  device = local.device;
  archived = local.archive ?? [];
  if (withPins) pins = (local as { pins?: Record<string, IdentityPin> | null }).pins ?? {};
}

async function runInit(markLocal: () => void): Promise<void> {
  if (!isE2eeCryptoAvailable() || !(await isKeyStoreAvailable())) {
    setE2eeSnapshot({ phase: "unavailable", userId, error: null });
    return;
  }
  const uid = userId!;
  store = new KeyStore(uid);
  // This device's keys first, in one transaction: decryption can start now.
  await loadLocalKeys(true);
  listenForPinChanges();
  void purgeExpiredEscrow();
  const keysLost = !identity && !device && archived.length === 0 && hadKeysHere(uid);
  markLocal();
  await withSetupLock(async () => {
    // Another tab may have finished setting this device up meanwhile.
    await loadLocalKeys(false);
    const status = await api<StatusResponse>(`/status${device ? `?device=${encodeURIComponent(device.id)}` : ""}`);
    const server = status.identity;

    // The account's encryption was reset elsewhere (or the server claims so):
    // archive these keys instead of deleting them, so history encrypted to
    // them stays readable here, and tell the user.
    if (identity && server && server.identityPub !== identity.pub) {
      await archiveCurrentKeys();
      resetElsewhere = true;
    }

    if (identity && backupKey) {
      if (!server) {
        // Server lost our keys (or never got them): publish again.
        if (!status.enabled) return publishPhase("disabled", status);
        await publishIdentity({ identity, backup: backupKey }, false);
      }
      if (!device || !status.device?.active || device.identityPub !== identity.pub) {
        if (!status.enabled) {
          return publishPhase(device ? "ready" : "disabled", status);
        }
        await createAndPublishDevice();
      }
      return publishPhase("ready", status);
    }

    if (server) return publishPhase("needs-restore", status, keysLost);
    if (!status.enabled) return publishPhase("disabled", status);
    await generateFreshKeys(false);
    return publishPhase("ready", { ...status, identity: null });
  });
}

async function publishPhase(phase: "ready" | "disabled" | "needs-restore", status: StatusResponse, keysLost = false) {
  const backupState = store ? await store.get("backupState") : null;
  const serverHasBackup = Boolean(status.identity?.hasBackup);
  // A reset clears the server backup, so a backup there always belongs to the current keys.
  const hasPassphrase = phase === "ready" && serverHasBackup;
  if (phase === "ready" && userId && device) {
    markHadKeys(userId);
    requestPersistentStorage();
  }
  const pin = status.pin ?? null;
  const pinAvailable = status.enabled && Boolean(pin?.available);
  // The account's PIN backup (a new device unlocks with it; a ready one can change it).
  const hasPin = Boolean(pin?.set);
  const extractable = keysExtractable();
  setE2eeSnapshot({
    phase,
    enabled: status.enabled,
    userId,
    deviceId: device?.id ?? null,
    identityPub: identity?.pub ?? null,
    hasPassphrase,
    serverHasBackup,
    // With PIN backups available the PIN replaces the passphrase onboarding.
    remindPassphrase: phase === "ready" && status.enabled && !pinAvailable && !hasPassphrase && Date.now() >= (backupState?.remindAfter ?? 0),
    error: null,
    resetElsewhere,
    keysExtractable: extractable,
    keysLost: phase === "needs-restore" && keysLost && !resetElsewhere,
    pinAvailable,
    hasPin,
    pinAttemptsLeft: hasPin && typeof pin?.attemptsLeft === "number" ? pin.attemptsLeft : null,
    pinLocked: !hasPin && Boolean(pin?.lockedAt),
    // Every account converts to a PIN: from the keys here (only copy), or
    // by entering the recovery passphrase first ("Upgrade to a 6-digit PIN").
    requirePinSetup: phase === "ready" && pinAvailable && !hasPin && (hasPassphrase || extractable),
    pinUpgrade: pinAvailable && !hasPin && serverHasBackup,
    pinSetupElsewhere: phase === "ready" && pinAvailable && !hasPin && !hasPassphrase && !extractable,
  });
}

function keysExtractable(): boolean {
  return Boolean(identity?.priv.extractable && backupKey?.priv.extractable);
}

async function publishIdentity(keys: { identity: StoredIdentity; backup: StoredIdentity }, reset: boolean, password?: string): Promise<void> {
  const backupSig = await signBackupKey(keys.identity.priv, userId!, keys.backup.pub);
  await api("/identity", {
    method: "PUT",
    body: JSON.stringify({
      identityPub: keys.identity.pub,
      backupPub: keys.backup.pub,
      backupSig,
      ...(reset ? { reset: true, password: password ?? "" } : {}),
    }),
  });
}

async function createAndPublishDevice(): Promise<void> {
  const keys = await generateDeviceKeys(false);
  const desc = await describeDevice(keys);
  const sig = await signDevice(identity!.priv, userId!, desc);
  await api("/devices", { method: "POST", body: JSON.stringify({ ...desc, sig, name: deviceName() }) });
  device = {
    id: desc.id,
    ecdhPriv: keys.ecdh.privateKey,
    signPriv: keys.sign.privateKey,
    ecdhPub: desc.ecdhPub,
    signPub: desc.signPub,
    sig,
    identityPub: identity!.pub,
  };
  await store!.put("device", device);
}

/**
 * New identity + backup keys. They stay extractable only until a recovery
 * passphrase seals them (setRecoveryPassphrase re-imports them
 * non-extractable). A reset publishes first (the server checks the account
 * password), and only then archives the old keys, so a refused reset changes
 * nothing on this device.
 */
async function generateFreshKeys(reset: boolean, password?: string): Promise<void> {
  const [idPair, bkPair] = await Promise.all([generateIdentityKeyPair(true), generateBackupKeyPair(true)]);
  const [idPub, bkPub] = await Promise.all([exportPublicKey(idPair.publicKey), exportPublicKey(bkPair.publicKey)]);
  const fresh = { identity: { priv: idPair.privateKey, pub: idPub }, backup: { priv: bkPair.privateKey, pub: bkPub } };
  await publishIdentity(fresh, reset, password);
  if (reset) await archiveCurrentKeys();
  identity = fresh.identity;
  backupKey = fresh.backup;
  await store!.put("identity", identity);
  await store!.put("backup", backupKey);
  await store!.put("backupState", { hasPassphrase: false, remindAfter: 0 });
  await createAndPublishDevice();
}

function requireStore(): KeyStore {
  if (!store || !userId) throw new E2eeUnavailableError("Encryption isn't set up yet");
  return store;
}

async function refreshStatus(): Promise<void> {
  const status = await api<StatusResponse>(`/status${device ? `?device=${encodeURIComponent(device.id)}` : ""}`);
  await publishPhase(identity && device ? "ready" : status.identity ? "needs-restore" : "disabled", status);
}

// ─── Link escrow (short-lived) ─────────────────────────────────────────────────
// Once sealed, the identity / backup private keys are non-extractable, so a
// device couldn't hand them to a device it links. Right after the user proved
// the recovery passphrase here (setting it, restoring, "enter your passphrase
// to link") or this device was linked, it keeps them as JWK sealed under a
// separate non-extractable AES-GCM key (keyStore "linkEscrow") for at most
// ESCROW_TTL_MS: the expiry is enforced on every read, expired copies are
// deleted on start, when the page becomes visible and by a timer, and a
// successful link approval deletes it at once. Later approvals ask for the
// passphrase again. Threat model in docs/architecture/e2ee.md.

/** How long a device may hand its keys to a device it links without the passphrase. */
export const LINK_ESCROW_TTL_MS = 10 * 60_000;
let escrowTimer: ReturnType<typeof setTimeout> | null = null;
let escrowWatch = false;

function escrowAad(uid: string, identityPub: string) {
  return utf8(`serika-e2ee-link-escrow-v1|${lower(uid)}|${identityPub}`);
}

async function sealEscrow(secrets: BackupSecrets): Promise<void> {
  if (!store || !userId || !identity) return;
  try {
    const key = await globalThis.crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    const iv = randomBytes(12);
    const body = utf8(JSON.stringify({ identity: secrets.identity, backup: secrets.backup }));
    const ct = await globalThis.crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: escrowAad(userId, identity.pub) }, key, body);
    const expiresAt = Date.now() + LINK_ESCROW_TTL_MS;
    await store.put("linkEscrow", { key, iv, ct, identityPub: identity.pub, expiresAt });
    scheduleEscrowExpiry(expiresAt);
  } catch {
    /* linking from this device will ask for the passphrase */
  }
}

function escrowValid(e: { expiresAt?: number } | null | undefined): boolean {
  const now = Date.now();
  return Boolean(e && typeof e.expiresAt === "number" && e.expiresAt > now && e.expiresAt <= now + LINK_ESCROW_TTL_MS);
}

async function dropEscrow(): Promise<void> {
  if (escrowTimer) clearTimeout(escrowTimer);
  escrowTimer = null;
  if (store) await store.delete("linkEscrow").catch(() => {});
}

function scheduleEscrowExpiry(expiresAt: number) {
  if (escrowTimer) clearTimeout(escrowTimer);
  escrowTimer = setTimeout(() => void purgeExpiredEscrow(), Math.max(0, expiresAt - Date.now()) + 1000);
  if (!escrowWatch && typeof document !== "undefined") {
    escrowWatch = true;
    // Timers stop in background tabs / frozen WebViews: re-check when the page comes back.
    document.addEventListener("visibilitychange", () => void purgeExpiredEscrow());
  }
}

/** Delete the link escrow once it expired (or when it predates expiries: stage 1 kept it at rest). */
async function purgeExpiredEscrow(): Promise<void> {
  const s = store;
  if (!s) return;
  const escrow = await s.get("linkEscrow").catch(() => null);
  if (escrow && !escrowValid(escrow)) await dropEscrow();
  else if (escrow?.expiresAt) scheduleEscrowExpiry(escrow.expiresAt);
}

/** The identity + backup private keys, when this device can produce them without the passphrase. */
async function currentSecrets(): Promise<BackupSecrets | null> {
  if (!identity || !backupKey || !userId) return null;
  if (identity.priv.extractable && backupKey.priv.extractable) {
    return { identity: await exportPrivateJwk(identity.priv), backup: await exportPrivateJwk(backupKey.priv) };
  }
  const escrow = store ? await store.get("linkEscrow").catch(() => null) : null;
  if (!escrow) return null;
  if (!escrowValid(escrow) || escrow.identityPub !== identity.pub) {
    await dropEscrow();
    return null;
  }
  try {
    const plain = await globalThis.crypto.subtle.decrypt(
      { name: "AES-GCM", iv: new Uint8Array(escrow.iv), additionalData: escrowAad(userId, identity.pub) },
      escrow.key,
      escrow.ct,
    );
    const parsed = JSON.parse(fromUtf8(new Uint8Array(plain))) as BackupSecrets;
    if (publicKeyFromJwk(parsed.identity) !== identity.pub || publicKeyFromJwk(parsed.backup) !== backupKey.pub) return null;
    return parsed;
  } catch {
    return null;
  }
}

// ─── Passphrase backup / restore / reset ──────────────────────────────────────

/** Keep only non-extractable copies of the identity / backup private keys on this device. */
async function sealKeysOnDevice(s: KeyStore, secrets: BackupSecrets): Promise<void> {
  const pubs = { identity: identity!.pub, backup: backupKey!.pub };
  const [idPriv, bkPriv] = await Promise.all([
    importIdentityPrivateJwk(secrets.identity, false),
    importBackupPrivateJwk(secrets.backup, false),
  ]);
  identity = { priv: idPriv, pub: pubs.identity };
  backupKey = { priv: bkPriv, pub: pubs.backup };
  await s.put("identity", identity);
  await s.put("backup", backupKey);
}

/**
 * Seal the identity + backup keys under a (new) recovery passphrase. Once a
 * backup exists the keys on this device are non-extractable, so changing the
 * passphrase opens the current backup with `currentPassphrase` instead.
 */
export async function setRecoveryPassphrase(passphrase: string, currentPassphrase?: string, currentPin?: string): Promise<void> {
  const s = requireStore();
  if (!identity || !backupKey) throw new E2eeUnavailableError("Encryption isn't set up on this device");
  if (!isStrongRecoveryPassphrase(passphrase)) throw new E2eeFormatError("This passphrase is too easy to guess");
  let secrets: BackupSecrets;
  // Extractable (no passphrase yet), or within the short window after this
  // device was set up / linked: no current passphrase needed.
  const held = keysExtractable() || !currentPassphrase ? await currentSecrets() : null;
  if (held) {
    secrets = held;
  } else if (currentPin) {
    // A PIN-only account turning on the passphrase as an extra recovery method.
    secrets = await unlockSecretsWithPin(currentPin);
  } else {
    if (!currentPassphrase) throw new E2eeCurrentPassphraseError();
    const data = await api<{ backup: { blob: string; salt: string; iters: number } }>("/backup");
    secrets = await openBackup(currentPassphrase, userId!, data.backup);
    if (publicKeyFromJwk(secrets.identity) !== identity.pub || publicKeyFromJwk(secrets.backup) !== backupKey.pub) {
      throw new E2eeFormatError("The saved backup doesn't match the keys on this device.");
    }
  }
  const record = await sealBackup(passphrase, userId!, secrets);
  await api("/backup", { method: "PUT", body: JSON.stringify({ ...record, identityPub: identity.pub }) });
  await withSetupLock(() => sealKeysOnDevice(s, secrets));
  await sealEscrow(secrets);
  await s.put("backupState", { hasPassphrase: true, remindAfter: 0 });
  setE2eeSnapshot({ hasPassphrase: true, serverHasBackup: true, remindPassphrase: false, keysExtractable: false });
}

/** "Not now": remind again in three days. */
export async function snoozePassphraseReminder(): Promise<void> {
  const s = requireStore();
  const current = await s.get("backupState");
  await s.put("backupState", { hasPassphrase: current?.hasPassphrase ?? false, remindAfter: Date.now() + 3 * 86_400_000 });
  setE2eeSnapshot({ remindPassphrase: false });
}

/** Store restored / linked identity + backup keys (non-extractable) and register this device. */
async function adoptKeys(s: KeyStore, secrets: BackupSecrets, pubs: { identityPub: string; backupPub: string }, hasPassphrase: boolean): Promise<void> {
  await withSetupLock(async () => {
    identity = { priv: await importIdentityPrivateJwk(secrets.identity, false), pub: pubs.identityPub };
    backupKey = { priv: await importBackupPrivateJwk(secrets.backup, false), pub: pubs.backupPub };
    await s.put("identity", identity);
    await s.put("backup", backupKey);
    await s.put("backupState", { hasPassphrase, remindAfter: 0 });
    await createAndPublishDevice();
  });
  await sealEscrow(secrets);
  resetElsewhere = false;
  decryptCache.clear();
  clearKeyCaches();
  await refreshStatus();
}

/** Restore identity + backup keys on this device from the passphrase backup (stored non-extractable). */
export async function restoreFromPassphrase(passphrase: string): Promise<void> {
  const s = requireStore();
  const data = await api<{ backup: { blob: string; salt: string; iters: number }; identityPub: string; backupPub: string }>("/backup");
  const secrets = await openBackup(passphrase, userId!, data.backup);
  if (publicKeyFromJwk(secrets.identity) !== data.identityPub || publicKeyFromJwk(secrets.backup) !== data.backupPub) {
    throw new E2eeFormatError("This backup doesn't match your current keys. Reset encryption to start over.");
  }
  // Proven before the state flips to ready (the PIN upgrade then skips asking again).
  proofAt = Date.now();
  await adoptKeys(s, secrets, { identityPub: data.identityPub, backupPub: data.backupPub }, true);
}

/**
 * Forgotten passphrase / lost devices: new identity + backup keys. Needs the
 * account password (checked by the server). Contacts see a security-code
 * change; history encrypted to the old keys stays readable on this device
 * only (archived locally) and is lost everywhere else.
 */
export async function resetEncryption(password: string): Promise<void> {
  requireStore();
  await withSetupLock(() => generateFreshKeys(true, password));
  resetElsewhere = false;
  decryptCache.clear();
  clearKeyCaches();
  await refreshStatus();
  // New keys exist only here now: the PIN setup (or, without PIN backups, the passphrase) comes next.
  if (!getE2eeSnapshot().pinAvailable) setE2eeSnapshot({ remindPassphrase: true });
}

// ─── 6-digit PIN backup (lib/e2ee/pin.ts) ──────────────────────────────────────
// The PIN (600 000 PBKDF2 iterations, in the attachment worker when it runs)
// gives a verifier for the server and a wrap key that never leaves the
// device; the bundle also needs the server secret S, which the server only
// returns for the right verifier (10 wrong tries in total destroy it).

interface PinParams {
  salt: string;
  iterations: number;
  attemptsLeft: number;
  identityPub: string;
}

function pinApiError(err: unknown): never {
  if (err instanceof E2eeApiError) {
    const left = typeof err.details?.attemptsLeft === "number" ? (err.details.attemptsLeft as number) : null;
    if (err.status === 403 && err.code === "e2ee_pin_wrong") throw new E2eePinError("wrong", left);
    if (err.status === 410) throw new E2eePinError("locked", 0);
    if (err.status === 404) throw new E2eePinError("no_pin");
    if (err.status === 503) throw new E2eePinError("unavailable");
    if (err.status === 429) throw new E2eePinError("rate_limited");
  }
  throw err;
}

/** Prove the PIN to the server and open the bundle: the account's identity + backup private keys. */
async function pinBundleSecrets(pin: string): Promise<{ secrets: BackupSecrets; identityPub: string }> {
  if (!userId) throw new E2eeUnavailableError("Encryption isn't set up yet");
  if (!isValidPin(pin)) throw new E2eeFormatError("A PIN is 6 digits");
  const uid = userId;
  const params = await api<PinParams>("/pin").catch(pinApiError);
  const keys = await derivePinKeysOffThread(pin, uid, fromB64(params.salt), params.iterations);
  try {
    const res = await api<{ secret: string; bundle: string; identityPub: string }>("/pin/unlock", {
      method: "POST",
      body: JSON.stringify({ verifier: toB64(keys.verifier) }),
    }).catch(pinApiError);
    const secret = fromB64(res.secret);
    try {
      const secrets = await openPinBundle(keys, secret, uid, res.identityPub, res.bundle);
      return { secrets, identityPub: res.identityPub };
    } finally {
      secret.fill(0);
    }
  } finally {
    keys.wrap.fill(0);
    keys.verifier.fill(0);
  }
}

/** New device: unlock the account's keys with the PIN and register this device. */
export async function unlockWithPin(pin: string): Promise<void> {
  const s = requireStore();
  const { secrets } = await pinBundleSecrets(pin);
  const status = await api<StatusResponse>("/status");
  const pubs = status.identity;
  if (!pubs || publicKeyFromJwk(secrets.identity) !== pubs.identityPub || publicKeyFromJwk(secrets.backup) !== pubs.backupPub) {
    throw new E2eeFormatError("This PIN backup doesn't match your current keys. Reset encryption to start over.");
  }
  await adoptKeys(s, secrets, { identityPub: pubs.identityPub, backupPub: pubs.backupPub }, Boolean(pubs.hasBackup));
}

/**
 * Existing device: the identity + backup private keys via the PIN (they are
 * non-extractable here). Opens the short link-escrow window like the
 * passphrase does, so linking / setting a passphrase right after needs
 * nothing else.
 */
export async function unlockSecretsWithPin(pin: string): Promise<BackupSecrets> {
  requireStore();
  if (!identity || !backupKey) throw new E2eeUnavailableError("Encryption isn't set up on this device");
  const { secrets } = await pinBundleSecrets(pin);
  if (publicKeyFromJwk(secrets.identity) !== identity.pub || publicKeyFromJwk(secrets.backup) !== backupKey.pub) {
    throw new E2eeFormatError("The PIN backup doesn't match the keys on this device.");
  }
  await sealEscrow(secrets);
  return secrets;
}

/** Existing device: unlock linking another device with the PIN. */
export async function unlockLinkingWithPin(pin: string): Promise<void> {
  await unlockSecretsWithPin(pin);
}

/**
 * What setting a PIN on this device needs first: nothing (the keys are at
 * hand), the current PIN, the recovery passphrase, or it can't be done here
 * (keys sealed, no backup to open them with: set it on the first device).
 */
export async function pinSetupProof(): Promise<"none" | "pin" | "passphrase" | "impossible"> {
  await whenLocalReady();
  if (await currentSecrets()) return "none";
  const snap = getE2eeSnapshot();
  if (snap.hasPin) return "pin";
  if (snap.serverHasBackup) return "passphrase";
  return "impossible";
}

/**
 * Set (or replace) the PIN backup. The keys come from this device (still
 * extractable, or the short escrow window), else from the current PIN or the
 * recovery passphrase. Two steps on the server: a fresh secret S, then the
 * bundle sealed with it, signed by the identity key. Afterwards the keys here
 * are non-extractable (as after a passphrase), with the 10-minute escrow.
 */
export async function setPin(pin: string, proof: { currentPin?: string; passphrase?: string } = {}): Promise<void> {
  const s = requireStore();
  if (!identity || !backupKey || !userId) throw new E2eeUnavailableError("Encryption isn't set up on this device");
  if (!isValidPin(pin)) throw new E2eeFormatError("A PIN is 6 digits");
  if (isEasyPin(pin)) throw new E2eeFormatError("This PIN is too easy to guess");
  const uid = userId;
  let secrets = await currentSecrets();
  if (!secrets && proof.currentPin) secrets = await unlockSecretsWithPin(proof.currentPin);
  if (!secrets && proof.passphrase) {
    const data = await api<{ backup: { blob: string; salt: string; iters: number } }>("/backup");
    const opened = await openBackup(proof.passphrase, uid, data.backup);
    if (publicKeyFromJwk(opened.identity) !== identity.pub || publicKeyFromJwk(opened.backup) !== backupKey.pub) {
      throw new E2eeFormatError("The saved backup doesn't match the keys on this device.");
    }
    secrets = opened;
  }
  if (!secrets) {
    const snap = getE2eeSnapshot();
    throw new E2eePinProofError(snap.hasPin ? "pin" : snap.serverHasBackup ? "passphrase" : "impossible");
  }
  const begin = await api<{ secret: string; iterations?: number }>("/pin/begin", { method: "POST" });
  const iterations = Math.max(PIN_PBKDF2_ITERATIONS, typeof begin.iterations === "number" ? begin.iterations : 0);
  const salt = randomBytes(PBKDF2_SALT_BYTES);
  const keys = await derivePinKeysOffThread(pin, uid, salt, iterations);
  const secret = fromB64(begin.secret);
  try {
    const identityPub = identity.pub;
    const bundle = await sealPinBundle(keys, secret, uid, identityPub, secrets);
    const commit = { identityPub, salt: toB64(salt), iterations, bundle, secretCheck: await pinSecretCheck(secret) };
    const sig = await signPinCommit(identity.priv, uid, commit);
    await api("/pin/commit", { method: "POST", body: JSON.stringify({ ...commit, verifier: toB64(keys.verifier), sig }) });
  } finally {
    secret.fill(0);
    keys.wrap.fill(0);
    keys.verifier.fill(0);
  }
  const held = secrets;
  await withSetupLock(() => sealKeysOnDevice(s, held));
  await sealEscrow(held);
  const state = await s.get("backupState");
  await s.put("backupState", { hasPassphrase: state?.hasPassphrase ?? false, remindAfter: 0 });
  proofAt = 0;
  setE2eeSnapshot({
    hasPin: true,
    pinLocked: false,
    pinAttemptsLeft: PIN_MAX_ATTEMPTS,
    requirePinSetup: false,
    pinUpgrade: false,
    pinSetupElsewhere: false,
    remindPassphrase: false,
    keysExtractable: false,
  });
}

/** Remove the PIN backup (the recovery passphrase stays): signed by the identity key. */
export async function removePin(): Promise<void> {
  requireStore();
  if (!identity || !userId) throw new E2eeUnavailableError("Encryption isn't set up on this device");
  const ts = Date.now();
  const sig = await signRecoveryRemoval(identity.priv, userId, identity.pub, "pin", ts);
  await api("/pin/remove", { method: "POST", body: JSON.stringify({ identityPub: identity.pub, ts, sig }) });
  await refreshStatus();
}

/** Remove the recovery passphrase backup (the PIN stays): signed by the identity key. */
export async function removeRecoveryPassphrase(): Promise<void> {
  const s = requireStore();
  if (!identity || !userId) throw new E2eeUnavailableError("Encryption isn't set up on this device");
  const ts = Date.now();
  const sig = await signRecoveryRemoval(identity.priv, userId, identity.pub, "passphrase", ts);
  await api("/backup/remove", { method: "POST", body: JSON.stringify({ identityPub: identity.pub, ts, sig }) });
  const state = await s.get("backupState");
  await s.put("backupState", { hasPassphrase: false, remindAfter: state?.remindAfter ?? 0 });
  await refreshStatus();
}

// "Upgrade to a 6-digit PIN" starts by proving the account: the recovery
// passphrase (restoring with it, or entering it), or — when it's forgotten
// but this device can still produce the keys — the account password.
let proofAt = 0;
const PROOF_TTL_MS = LINK_ESCROW_TTL_MS;

/** The account was proven on this device moments ago and the keys are at hand: the PIN can be created now. */
export async function hasRecentProof(): Promise<boolean> {
  if (!proofAt || Date.now() - proofAt > PROOF_TTL_MS) return false;
  return (await currentSecrets()) !== null;
}

/**
 * "Forgot your passphrase?" while upgrading: the account password (checked
 * by the server like "Reset encryption") stands in for it, but only when
 * this device can produce the keys without the passphrase (still
 * extractable, or the short escrow window). Sealed keys can't be exported:
 * then only a reset (or another device) helps.
 */
export async function proveWithAccountPassword(password: string): Promise<void> {
  requireStore();
  if (!(await currentSecrets())) throw new E2eePinProofError("passphrase");
  await api("/reauth", { method: "POST", body: JSON.stringify({ password }) });
  proofAt = Date.now();
}

// ─── Devices ──────────────────────────────────────────────────────────────────

export interface OwnDevice extends PublicDevice {
  name: string | null;
  createdAt: string | null;
  lastSeenAt: string | null;
  revokedAt: string | null;
  current: boolean;
}

export async function listOwnDevices(): Promise<OwnDevice[]> {
  const data = await api<{ devices: Array<Omit<OwnDevice, "current">> }>("/devices");
  return data.devices.map((d) => ({ ...d, current: d.id === device?.id }));
}

export async function revokeDevice(id: string): Promise<void> {
  await api(`/devices/${encodeURIComponent(id)}`, { method: "DELETE" });
  clearKeyCaches();
  if (id === device?.id && store) {
    await store.delete("device");
    device = null;
    initPromise = null;
    await initE2ee({ id: userId! });
  }
}

// ─── Contact keys and trust ───────────────────────────────────────────────────

export type MemberTrust = "self" | "new" | "trusted" | "verified" | "changed" | "missing";

export interface MemberKeys {
  userId: string;
  identityPub: string | null;
  trust: MemberTrust;
  /** The new key waiting for acknowledgement (trust === "changed"). */
  pendingKey: string | null;
  /** Encryption targets: devices + backup key vouched for by the trusted key. */
  recipients: WrapRecipient[];
  /**
   * Notification keys (Android push previews) signed by one of those devices:
   * wrapped to as well while the envelope stays under the recipient limit.
   */
  notifyRecipients: WrapRecipient[];
  /** Every known device (incl. revoked): verifies sender signatures. */
  signers: Map<string, { signPub: string; revokedAt: number | null; trusted: boolean }>;
}

export interface ChannelKeys {
  channelId: string;
  e2ee: boolean;
  members: MemberKeys[];
  at: number;
  /** The server's key-set version (sent with encrypted messages; stale → 409). */
  version: string | null;
}

interface Bundle {
  userId: string;
  identityPub: string | null;
  backupPub: string | null;
  backupSig: string | null;
  devices: Array<PublicDevice & { revokedAt: string | null }>;
  revokedDevices: Array<PublicDevice & { revokedAt: string | null }>;
  /** Active notification keys (servers before stage 2 don't send it). */
  notifyKeys?: PublicNotifyKey[];
}

interface RawChannelKeys {
  channelId: string;
  e2ee: boolean;
  version?: string | null;
  members: Bundle[];
}

/** After this, cached key sets are revalidated in the background (still used meanwhile). */
const CHANNEL_KEYS_TTL = 60_000;
const channelKeyCache = new Map<string, { value: Promise<ChannelKeys>; at: number }>();
/** The last key set that loaded per conversation (sync access; revalidation baseline). */
const channelKeysSettled = new Map<string, ChannelKeys>();
const channelKeysInflight = new Map<string, Promise<ChannelKeys>>();
const userKeyCache = new Map<string, { value: Promise<MemberKeys>; at: number }>();
const verifyCache = new Map<string, boolean>();

async function cachedVerifyDevice(identityPub: string, uid: string, d: PublicDevice): Promise<boolean> {
  const k = `${identityPub}|${lower(uid)}|${d.id}|${d.ecdhPub}|${d.signPub}|${d.sig}`;
  const hit = verifyCache.get(k);
  if (hit !== undefined) return hit;
  const ok = await verifyDevice(identityPub, uid, d);
  if (verifyCache.size > 2000) verifyCache.clear();
  verifyCache.set(k, ok);
  return ok;
}

async function cachedVerifyNotifyKey(signPub: string, uid: string, k: PublicNotifyKey): Promise<boolean> {
  const key = `notify|${signPub}|${lower(uid)}|${k.id}|${k.deviceId}|${k.ecdhPub}|${k.sig}`;
  const hit = verifyCache.get(key);
  if (hit !== undefined) return hit;
  const ok = await verifyNotifyKey(signPub, uid, k);
  if (verifyCache.size > 2000) verifyCache.clear();
  verifyCache.set(key, ok);
  return ok;
}

/** Banners and dialogs re-check trust. */
function pinsChanged() {
  setE2eeSnapshot({ pinsVersion: getE2eeSnapshot().pinsVersion + 1 });
}

/**
 * Trust in a contact changed: key sets, decryptions and "turned off" checks
 * made against the old pins are re-done.
 */
function trustChanged() {
  trustEpoch++;
  clearKeyCaches();
  decryptCache.clear();
  forgetPlainMemory();
  offChecks.clear();
}

function listenForPinChanges() {
  if (pinsChannel || typeof window === "undefined" || typeof BroadcastChannel === "undefined") return;
  try {
    const channel = new BroadcastChannel("serika-e2ee-pins");
    channel.onmessage = (e: MessageEvent) => {
      void reloadPinsFromStore(e.data);
    };
    pinsChannel = channel;
  } catch {
    pinsChannel = null;
  }
}

/** Another tab accepted / verified a security code: take its pins. */
async function reloadPinsFromStore(data: unknown) {
  const from = (data as { userId?: unknown } | null)?.userId;
  const s = store;
  if (!s || !userId || typeof from !== "string" || lower(from) !== lower(userId)) return;
  const stored = await s.get("pins").catch(() => null);
  if (s !== store || !stored) return;
  pins = stored;
  trustChanged();
  pinsChanged();
}

/**
 * Apply `op` to one contact's pin in IndexedDB, in a single read-modify-write
 * transaction (another tab's decision is never overwritten by this tab's
 * older copy), and adopt the stored result here. `explicit`: the user changed
 * trust (accept / verify), so everything derived from the old pin is re-done
 * and the other tabs are told.
 */
async function persistPin(uid: string, op: (stored: IdentityPin | null) => IdentityPin | null, explicit = false): Promise<IdentityPin | null> {
  const s = store;
  const out: { pin: IdentityPin | null } = { pin: null };
  if (s) {
    await s.update("pins", (current) => {
      const all = { ...(current ?? {}) };
      const next = op(all[uid] ?? null);
      if (next) all[uid] = next;
      out.pin = all[uid] ?? null;
      return all;
    });
    if (s !== store) return out.pin;
  } else {
    out.pin = op(pins[uid] ?? null);
  }
  const before = pins[uid] ?? null;
  if (out.pin) pins[uid] = out.pin;
  if (explicit || !samePin(before, out.pin)) {
    trustChanged();
    if (explicit && userId) {
      try {
        pinsChannel?.postMessage({ userId: lower(userId) });
      } catch {
        /* other tabs pick it up on their next load */
      }
    }
  }
  pinsChanged();
  return out.pin;
}

/** Our own identity keys: the current one and the ones from before a reset (old devices still verify). */
function ownIdentityKeys(): string[] {
  const keys = [identity?.pub, ...archived.map((a) => a.identity?.pub)].filter((k): k is string => Boolean(k));
  return [...new Set(keys)];
}

/**
 * Turn a server key bundle into trust state. `expectedUserId` is the user we
 * asked for: a bundle for anyone else is refused (the server can't answer a
 * lookup for Alice with Mallory's keys).
 */
async function processBundle(b: Bundle, expectedUserId?: string, opts: { cachedOnly?: boolean; stale?: boolean } = {}): Promise<MemberKeys> {
  if (!b || typeof b.userId !== "string" || !UUID_RE.test(b.userId)) throw new E2eeFormatError("Malformed key bundle");
  if (expectedUserId !== undefined && lower(b.userId) !== lower(expectedUserId)) {
    throw new E2eeFormatError("The server sent keys for the wrong person");
  }
  const uid = lower(b.userId);
  const isSelf = Boolean(userId && uid === lower(userId));
  let trust: MemberTrust;
  let currentKey: string | null;
  let historyKeys: string[];
  let pendingKey: string | null = null;
  if (isSelf) {
    trust = "self";
    currentKey = identity?.pub ?? null;
    historyKeys = ownIdentityKeys();
  } else if (!b.identityPub) {
    trust = "missing";
    currentKey = null;
    historyKeys = pins[uid]?.seen ?? [];
  } else {
    const pin = pins[uid];
    if (opts.cachedOnly) {
      // A stale copy (priming the push trust list): never touches pins, and
      // only keys already accepted count.
      trust = pin && pin.key === b.identityPub ? (pin.verified ? "verified" : "trusted") : pin ? "changed" : "missing";
      currentKey = pin && pin.key === b.identityPub ? b.identityPub : null;
    } else {
      // Trust on first use (lib/e2ee/trust.ts). A copy cached on this device
      // never changes what is pending: it may simply be old.
      const stale = opts.stale === true;
      const announced = b.identityPub;
      const seen = observeIdentity(pin, announced, Date.now(), { stale });
      trust = seen.trust;
      currentKey = seen.currentKey;
      pendingKey = seen.pendingKey;
      if (seen.dirty) {
        pins[uid] = seen.pin;
        void persistPin(uid, (stored) => observeIdentity(stored, announced, Date.now(), { stale }).pin).catch(() => pinsChanged());
      }
    }
    historyKeys = [...new Set([...(currentKey ? [currentKey] : []), ...(pins[uid]?.seen ?? [])])];
  }

  const recipients: WrapRecipient[] = [];
  const signers: MemberKeys["signers"] = new Map();
  const all = [...(b.devices ?? []), ...(b.revokedDevices ?? [])];
  await Promise.all(all.map(async (d) => {
    let trusted = false;
    for (const key of historyKeys) {
      if (await cachedVerifyDevice(key, uid, d)) {
        trusted = true;
        break;
      }
    }
    signers.set(d.id, { signPub: d.signPub, revokedAt: d.revokedAt ? new Date(d.revokedAt).getTime() : null, trusted });
    if (!d.revokedAt && currentKey && (await cachedVerifyDevice(currentKey, uid, d))) {
      recipients.push({ id: d.id, pub: d.ecdhPub });
    }
  }));
  // Notification keys: only ones signed by a device we encrypt to (its
  // signing key vouches for it; the server can't add one).
  const deviceTargets = new Set(recipients.map((r) => r.id));
  const trustedDevices = new Map(all.filter((d) => !d.revokedAt && deviceTargets.has(d.id)).map((d) => [d.id, d.signPub] as const));
  const notifyRecipients = await selectNotifyRecipients(uid, b.notifyKeys, trustedDevices, cachedVerifyNotifyKey);
  if (currentKey && b.backupPub && (await verifyBackupKey(currentKey, uid, b.backupPub, b.backupSig))) {
    recipients.push({ id: backupRecipientId(uid), pub: b.backupPub });
  }
  // This device always gets a copy (other tabs, the send echo) even before the
  // server's list catches up.
  if (isSelf && device && !recipients.some((r) => r.id === device!.id)) recipients.push({ id: device.id, pub: device.ecdhPub });
  if (isSelf && device && !signers.has(device.id)) signers.set(device.id, { signPub: device.signPub, revokedAt: null, trusted: true });
  noteSigners(uid, signers, opts.cachedOnly === true);
  return { userId: uid, identityPub: b.identityPub, trust, pendingKey, recipients, notifyRecipients, signers };
}

// ─── Trusted senders for native push previews ────────────────────────────────
// The Android app verifies the sender signature of an encrypted push itself,
// against the sender devices this device trusts (vouched for by a pinned
// identity key, not revoked). Every processed key bundle updates that list;
// listeners (lib/e2ee/client/notifyKey.ts) hand changes to native code.

/** userId → deviceId → signing key (raw P-256, base64). */
const signerBook = new Map<string, Record<string, string>>();
const signerListeners = new Set<(changed: Record<string, Record<string, string>>) => void>();
let signerPending: Record<string, Record<string, string>> = {};
let signerTimer: ReturnType<typeof setTimeout> | null = null;
let signersPrimed = false;
/** Devices this session has seen revoked (a stale copy never brings them back). */
const revokedSeen = new Map<string, Set<string>>();
/** Users whose entry came from the server this session (a stale copy never overrides it). */
const freshSigners = new Set<string>();

function noteSigners(uid: string, signers: MemberKeys["signers"], cachedOnly: boolean) {
  if (cachedOnly && freshSigners.has(uid)) return;
  if (!cachedOnly) freshSigners.add(uid);
  let revoked = revokedSeen.get(uid);
  for (const [id, s] of signers) {
    if (!s.revokedAt) continue;
    if (!revoked) revokedSeen.set(uid, (revoked = new Set()));
    revoked.add(id);
  }
  const next: Record<string, string> = {};
  for (const [id, s] of signers) if (s.trusted && !s.revokedAt && !revoked?.has(id)) next[id] = s.signPub;
  const prev = signerBook.get(uid);
  const same = prev && Object.keys(prev).length === Object.keys(next).length && Object.entries(next).every(([id, k]) => prev[id] === k);
  if (same) return;
  signerBook.set(uid, next);
  if (signerListeners.size === 0) return;
  signerPending[uid] = next;
  if (signerTimer) return;
  signerTimer = setTimeout(() => {
    signerTimer = null;
    const batch = signerPending;
    signerPending = {};
    signerListeners.forEach((l) => l(batch));
  }, 300);
}

/**
 * Subscribe to trusted-sender changes (per user: the full new device list).
 * The listener first gets everything known so far.
 */
export function onTrustedSignersChanged(listener: (changed: Record<string, Record<string, string>>) => void): () => void {
  signerListeners.add(listener);
  if (signerBook.size > 0) listener(Object.fromEntries(signerBook));
  return () => {
    signerListeners.delete(listener);
  };
}

// ─── Encrypted conversations for native push previews ──────────────────────────
// The Android app must know which conversations are encrypted (it then never
// shows the server's text or offers Reply) and what they are (a 1:1 DM with
// whom, or a group), from this device's own checks: a 1:1 DM is noted once
// its channel proved to be exactly us + the person in the URL, a group once
// its page (URL) decrypted it. One-way, like the "seen encrypted" memory.

export type EncryptedConversationInfo = { kind: "dm"; peer: string } | { kind: "group_dm" };
/** What native code is sent: an encrypted conversation, or `plain` (turned off: forget it). */
export type ConversationSyncInfo = EncryptedConversationInfo | { kind: "plain" };

const conversationBook = new Map<string, EncryptedConversationInfo>();
const conversationListeners = new Set<(changed: Record<string, ConversationSyncInfo>) => void>();
let conversationPending: Record<string, ConversationSyncInfo> = {};
let conversationTimer: ReturnType<typeof setTimeout> | null = null;

function flushConversationsSoon() {
  if (conversationTimer || conversationListeners.size === 0) return;
  conversationTimer = setTimeout(() => {
    conversationTimer = null;
    const batch = conversationPending;
    conversationPending = {};
    conversationListeners.forEach((l) => l(batch));
  }, 300);
}

/**
 * A conversation was turned off (verified): native code forgets it (newer
 * APKs drop `plain` entries; older ones ignore them and keep showing
 * "New encrypted message", which fails safe).
 */
function noteConversationPlain(channelId: string) {
  const key = lower(channelId);
  if (!UUID_RE.test(key)) return;
  conversationBook.delete(key);
  if (conversationListeners.size === 0) return;
  conversationPending[key] = { kind: "plain" };
  flushConversationsSoon();
}

function noteEncryptedConversation(channelId: string, info: EncryptedConversationInfo) {
  const key = lower(channelId);
  if (!UUID_RE.test(key) || (info.kind === "dm" && !UUID_RE.test(info.peer))) return;
  const prev = conversationBook.get(key);
  if (prev && prev.kind === info.kind && (prev.kind !== "dm" || prev.peer === (info as { peer: string }).peer)) return;
  conversationBook.set(key, info);
  if (conversationListeners.size === 0) return;
  conversationPending[key] = info;
  flushConversationsSoon();
}

/** Subscribe to newly noted encrypted (or turned-off) conversations; the listener first gets everything known. */
export function onEncryptedConversationsChanged(listener: (changed: Record<string, ConversationSyncInfo>) => void): () => void {
  conversationListeners.add(listener);
  if (conversationBook.size > 0) listener(Object.fromEntries(conversationBook));
  return () => {
    conversationListeners.delete(listener);
  };
}

/** Every encrypted conversation noted this session. */
export function encryptedConversationsSnapshot(): Record<string, EncryptedConversationInfo> {
  return Object.fromEntries(conversationBook);
}

/** Group DMs this device remembers as encrypted (keyed by the URL's channel: `gdm:<id>`). */
export async function noteRememberedGroups(): Promise<void> {
  await whenLocalReady();
  const local = store ? await store.getMany(["conversations", "conversationStates"]).catch(() => null) : null;
  for (const key of Object.keys(local?.conversations ?? {})) {
    if (!key.startsWith("gdm:")) continue;
    // Turned off (a verified record): native code forgets it instead.
    if (local?.conversationStates?.[key]?.off) noteConversationPlain(key.slice(4));
    else noteEncryptedConversation(key.slice(4), { kind: "group_dm" });
  }
}

/** Everything in the trusted-sender list (userId → deviceId → signing key). */
export function trustedSignersSnapshot(): Record<string, Record<string, string>> {
  return Object.fromEntries(signerBook);
}

/**
 * Fill the trusted-sender list from every key set cached on this device (no
 * network), so pushes from contacts of conversations not opened yet this
 * session can be verified too. Once per session.
 */
export async function primeTrustedSigners(selfId?: string | null): Promise<void> {
  if (signersPrimed) return;
  await whenLocalReady(selfId);
  if (!userId) return;
  signersPrimed = true;
  const cached = await listCachedBundles<RawChannelKeys>(userId, 200);
  for (const { channelId, data } of cached) {
    if (channelKeysSettled.has(channelId)) continue;
    await processChannelKeys(data, channelId, { cachedOnly: true }).catch(() => null);
  }
}

/**
 * Sign this device's notification key (lib/e2ee/notifyKeys.ts) with its
 * signing key. Null when this device has no keys.
 */
export async function signNotificationKey(id: string, ecdhPub: string, selfId?: string | null): Promise<{ userId: string; deviceId: string; sig: string } | null> {
  await whenLocalReady(selfId);
  if (!device) await whenE2eeSettled(selfId);
  if (!device || !userId || getE2eeSnapshot().phase !== "ready") return null;
  const sig = await signNotifyKey(device.signPriv, userId, { id, deviceId: device.id, ecdhPub });
  return { userId: lower(userId), deviceId: device.id, sig };
}

/** A member processed with a conversation's key set doubles as that user's keys (calls, unknown senders). */
function seedUserKeys(m: MemberKeys) {
  const prev = userKeyCache.get(m.userId);
  if (prev && Date.now() - prev.at < CHANNEL_KEYS_TTL) return;
  userKeyCache.set(m.userId, { value: Promise.resolve(m), at: Date.now() });
}

async function processChannelKeys(data: RawChannelKeys, key: string, opts: { cachedOnly?: boolean; stale?: boolean } = {}): Promise<ChannelKeys> {
  if (!data || typeof data.channelId !== "string" || lower(data.channelId) !== key) throw new E2eeFormatError("The server sent keys for another conversation");
  if (!Array.isArray(data.members) || hasDuplicateIds(data.members.map((m) => String(m?.userId ?? "")))) {
    throw new E2eeFormatError("The server sent a malformed member list");
  }
  const members = await Promise.all(data.members.map((m) => processBundle(m, undefined, opts)));
  if (!opts.cachedOnly) for (const m of members) if (!(opts.stale && m.trust === "changed")) seedUserKeys(m);
  return { channelId: key, e2ee: data.e2ee === true, members, at: Date.now(), version: typeof data.version === "string" ? data.version : null };
}

/** A conversation's key set changed: forget results checked against the old one, and tell open views. */
function keySetChanged(key: string) {
  for (const k of [...decryptCache.keys()]) if (k.startsWith(`${key}|`)) decryptCache.delete(k);
  // The memory layer remembers how trusted senders were: re-check everything (IndexedDB hits are re-checked anyway).
  forgetPlainMemory();
  setE2eeSnapshot({ keysVersion: getE2eeSnapshot().keysVersion + 1 });
}

/** Ask the server (with the version we have: an unchanged set comes back without bundles). */
function refreshChannelKeys(key: string): Promise<ChannelKeys> {
  const running = channelKeysInflight.get(key);
  if (running) return running;
  const known = channelKeysSettled.get(key) ?? null;
  const p = (async () => {
    for (let attempt = 0; ; attempt++) {
      const epoch = trustEpoch;
      // Settled sets are dropped when trust changes: an older one's member trust is never reused.
      const base = attempt === 0 ? known : channelKeysSettled.get(key) ?? null;
      const query = base?.version ? `?v=${encodeURIComponent(base.version)}` : "";
      const data = await api<RawChannelKeys & { unchanged?: boolean }>(`/channels/${encodeURIComponent(key)}/keys${query}`);
      let next: ChannelKeys;
      if (data.unchanged === true && base && typeof data.channelId === "string" && lower(data.channelId) === key && data.version === base.version) {
        next = { ...base, e2ee: data.e2ee === true, at: Date.now() };
      } else {
        next = await processChannelKeys(data, key);
        void putCachedBundles<RawChannelKeys>(userId, key, { channelId: data.channelId, e2ee: data.e2ee === true, version: data.version ?? null, members: data.members });
      }
      if (epoch !== trustEpoch) {
        // A security code was accepted / verified meanwhile: this was checked
        // against the old pins. Check again (never cache the old verdict).
        if (attempt < 2) continue;
        return next;
      }
      channelKeyCache.set(key, { value: Promise.resolve(next), at: Date.now() });
      channelKeysSettled.set(key, next);
      // Compared with the set this refresh started from (open views re-check a changed one).
      const prev = base ?? known;
      if (prev && prev.version !== next.version) keySetChanged(key);
      return next;
    }
  })();
  channelKeysInflight.set(key, p);
  const clear = () => {
    if (channelKeysInflight.get(key) === p) channelKeysInflight.delete(key);
  };
  p.then(clear, clear);
  return p;
}

/**
 * Keys of a DM / group DM's members. Served from memory, else from the copy
 * in IndexedDB (no network on the critical path), and revalidated in the
 * background once older than a minute. `fresh` waits for the server.
 */
export function getChannelKeys(channelId: string, fresh = false): Promise<ChannelKeys> {
  const key = lower(channelId);
  if (fresh) return refreshChannelKeys(key);
  const entry = channelKeyCache.get(key);
  if (entry) {
    if (Date.now() - entry.at > CHANNEL_KEYS_TTL) void refreshChannelKeys(key).catch(() => {});
    return entry.value;
  }
  const value = (async () => {
    const cached = await getCachedBundles<RawChannelKeys>(userId, key);
    if (cached) {
      let keys: ChannelKeys | null = null;
      const epoch = trustEpoch;
      try {
        keys = await processChannelKeys(cached.data, key, { stale: true });
      } catch {
        /* unusable copy: ask the server */
      }
      if (keys) {
        // The copy disagrees with a key trusted here: it may just be old (from
        // before a code was accepted), so the server decides what to show.
        if (keys.members.some((m) => m.trust === "changed")) {
          const fallback = keys;
          return refreshChannelKeys(key).catch(() => fallback);
        }
        if (epoch === trustEpoch) channelKeysSettled.set(key, keys);
        void refreshChannelKeys(key).catch(() => {});
        return keys;
      }
    }
    return refreshChannelKeys(key);
  })();
  // at 0: stale from the start, so the next access revalidates too (deduped while in flight).
  channelKeyCache.set(key, { value, at: 0 });
  value.catch(() => {
    if (channelKeyCache.get(key)?.value === value) channelKeyCache.delete(key);
  });
  return value;
}

/** One user's keys (calls, and senders not in the loaded member list). */
export function getUserKeys(uid: string, fresh = false): Promise<MemberKeys> {
  const key = lower(uid);
  const cached = userKeyCache.get(key);
  if (cached && !fresh && Date.now() - cached.at < CHANNEL_KEYS_TTL) return cached.value;
  const p = api<{ keys: Bundle }>(`/users/${encodeURIComponent(uid)}/keys`).then((d) => processBundle(d.keys, key));
  userKeyCache.set(key, { value: p, at: Date.now() });
  p.catch(() => {
    if (userKeyCache.get(key)?.value === p) userKeyCache.delete(key);
  });
  return p;
}

/**
 * Someone's keys changed (realtime `e2ee_keys` event): refetch every cached
 * conversation key set they are in, so banners, sends and signature checks
 * use the new devices at once.
 */
export function onRemoteKeysChanged(changedUserId: string): void {
  const id = lower(changedUserId);
  userKeyCache.delete(id);
  for (const [key, keys] of channelKeysSettled) {
    if (!keys.members.some((m) => m.userId === id)) continue;
    const entry = channelKeyCache.get(key);
    if (entry) entry.at = 0;
    void refreshChannelKeys(key).catch(() => {});
  }
  if (userId && id === lower(userId)) void refreshStatus().catch(() => {});
}

/**
 * Accept a contact's new identity key ("security code changed"):
 * `identityPub` is the key the user was shown (MemberKeys.pendingKey), so a
 * newer change that arrived meanwhile is never accepted unseen. Stored in the
 * same trust store "Verify" writes to (not marked verified), for every tab of
 * this device. Messages from their new devices that failed as unknown
 * devices are checked again. False when there was nothing to accept.
 */
export async function acknowledgeIdentityChange(uid: string, identityPub?: string | null): Promise<boolean> {
  const key = lower(uid);
  const accepted = identityPub ?? pins[key]?.pending ?? null;
  if (!accepted) return false;
  await persistPin(key, (stored) => acceptIdentity(stored, accepted, Date.now()), true);
  return true;
}

/**
 * Mark the safety number of `identityPub` (the key the dialog showed; by
 * default the trusted one) as verified in person, or clear it. Verifying a
 * pending new key also accepts it.
 */
export async function markVerified(uid: string, verified = true, identityPub?: string | null): Promise<void> {
  const key = lower(uid);
  const shown = identityPub ?? pins[key]?.key ?? null;
  if (!shown) return;
  await persistPin(key, (stored) => setIdentityVerified(stored, shown, verified, Date.now()), true);
}

export function getPin(uid: string): IdentityPin | null {
  return pins[lower(uid)] ?? null;
}

export function listPins(): Array<{ userId: string } & IdentityPin> {
  return Object.entries(pins).map(([uid, p]) => ({ userId: uid, ...p }));
}

/**
 * What the safety-number dialog shows for `uid`: the number for their pending
 * new key when their code changed (else the trusted one), which key that is,
 * and whether that exact key was verified here.
 */
export async function safetyCodeFor(uid: string): Promise<{ groups: string[] | null; identityPub: string | null; verified: boolean; changed: boolean }> {
  const pin = pins[lower(uid)];
  const shown = pin?.pending ?? pin?.key ?? null;
  const groups = shown ? await safetyNumberWith(uid, shown) : null;
  return {
    groups,
    identityPub: shown,
    verified: Boolean(pin && shown === pin.key && pin.verified),
    changed: Boolean(pin?.pending && shown === pin.pending),
  };
}

/** The 60-digit safety number between us and `uid` (their trusted key, or the pending one). */
export async function safetyNumberWith(uid: string, identityPub?: string | null): Promise<string[] | null> {
  if (!identity || !userId) return null;
  const pin = pins[lower(uid)];
  const theirs = identityPub ?? pin?.pending ?? pin?.key ?? null;
  if (!theirs) return null;
  return computeSafetyNumber({ userId, identityPub: identity.pub }, { userId: uid, identityPub: theirs });
}

/** Turn encryption on; `withoutRecovery` names others who haven't set a recovery passphrase. */
export async function enableChannelEncryption(channelId: string): Promise<{ changed: boolean; withoutRecovery: string[] }> {
  const res = await api<{ changed?: boolean; withoutRecovery?: unknown }>(`/channels/${encodeURIComponent(channelId)}/enable`, { method: "POST" });
  offChecks.clear();
  const key = lower(channelId);
  channelKeyCache.delete(key);
  channelKeysSettled.delete(key);
  const names = Array.isArray(res.withoutRecovery) ? res.withoutRecovery.filter((n): n is string => typeof n === "string") : [];
  return { changed: res.changed !== false, withoutRecovery: names };
}

// ─── Turning encryption off (lib/e2ee/conversationState.ts) ───────────────────

/** The channel a conversation's messages are bound to: the URL's group, or the DM channel (checked against the URL's person). */
function boundChannel(target: E2eeTarget, channelId: string): string | null {
  if (target.kind === "group") return lower(channelId) === lower(target.channelId) ? lower(target.channelId) : null;
  if (!UUID_RE.test(channelId)) return null;
  // A 1:1 DM already proven to be another channel on this device: refuse.
  const known = validatedChannelOf(conversationKey(target));
  if (known && known !== lower(channelId)) return null;
  return lower(channelId);
}

/** What a record for this conversation must name (kind, and a 1:1 DM's two people). */
function expectedConversation(target: E2eeTarget, selfId: string): { kind: "dm"; members: [string, string] } | { kind: "group_dm" } {
  return target.kind === "dm" ? { kind: "dm", members: dmPair(selfId, target.recipientId) } : { kind: "group_dm" };
}

/**
 * Turn encryption off for the open conversation: this device signs the
 * record (the server can't do it on its own), the server flips the flag and
 * posts the notice. This device accepts its own record at once.
 */
export async function disableChannelEncryption(channelId: string, target: E2eeTarget): Promise<{ changed: boolean }> {
  await whenLocalReady();
  if (!device) await whenE2eeSettled();
  if (!device || !userId) throw new E2eeSendBlockedError("not_ready");
  const bound = boundChannel(target, channelId);
  if (!bound) throw new E2eeSendBlockedError("member_mismatch");
  if (target.kind === "dm") {
    const keys = await getChannelKeys(bound).catch(() => null);
    if (!keys || !isExactDmMembers(keys.members.map((m) => m.userId), userId, target.recipientId)) throw new E2eeSendBlockedError("member_mismatch");
  }
  const expected = expectedConversation(target, userId);
  const record = await signConversationOff(device.signPriv, {
    channelId: bound,
    kind: expected.kind,
    ...(expected.kind === "dm" ? { members: expected.members } : {}),
    userId,
    deviceId: device.id,
  });
  const res = await api<{ changed?: boolean }>(`/channels/${encodeURIComponent(bound)}/disable`, { method: "POST", body: JSON.stringify({ record }) });
  await acceptConversationOff(userId, conversationKey(target), { ts: record.ts, by: record.userId, deviceId: record.deviceId, channelId: bound }).catch(() => {});
  noteConversationPlain(bound);
  offChecks.clear();
  // Open chats re-check (the server may have been off already: no live event then).
  setE2eeSnapshot({ conversationsVersion: getE2eeSnapshot().conversationsVersion + 1 });
  return { changed: res.changed !== false };
}

export type OffVerification =
  | { ok: true; record: ConversationStateRecord }
  | { ok: false; reason: OffRejection | "no_record" | "keys_unavailable" | "not_ready"; by?: string };

/** Checks in flight only (results are never reused: every check runs against the current memory). */
const offChecks = new Map<string, Promise<OffVerification>>();

/**
 * Whether this device accepts that the conversation (what the user opened:
 * `target`; `channelId` its channel) was turned off: the record (given, e.g.
 * from a live event, or fetched from the server) must name this kind of
 * conversation (and a 1:1 DM's two people), be signed by a device this device
 * trusts for a member of exactly this conversation, and be newer than the
 * last time this device saw it encrypted and than any record it saw
 * superseded. Accepted records are remembered (plaintext allowed there until
 * it is seen encrypted again).
 */
export function verifyConversationOff(target: E2eeTarget, channelId: string, record?: unknown): Promise<OffVerification> {
  const given = record === undefined ? null : parseConversationState(record);
  const cacheKey = `${conversationKey(target)}|${lower(channelId)}|${record === undefined ? "server" : given?.sig ?? "malformed"}`;
  const running = offChecks.get(cacheKey);
  if (running) return running;
  const p = runOffCheck(target, channelId, record === undefined ? undefined : given).catch((): OffVerification => ({ ok: false, reason: "keys_unavailable" }));
  offChecks.set(cacheKey, p);
  const clear = () => {
    if (offChecks.get(cacheKey) === p) offChecks.delete(cacheKey);
  };
  p.then(clear, clear);
  return p;
}

/** The record's signer as this device trusts it, and whether everything but freshness holds. */
async function checkOffRecordHere(target: E2eeTarget, bound: string, record: ConversationStateRecord, freshness: { seenEncryptedAt: number | null; acceptedOffTs?: number | null; consumedOffTs?: number | null }) {
  const uid = userId!;
  let keys = await getChannelKeys(bound).catch(() => null);
  if (!keys) return { ok: false, reason: "keys_unavailable" } as const;
  const signerOf = (k: ChannelKeys) => k.members.find((m) => m.userId === record.userId)?.signers.get(record.deviceId);
  // A device added since the key set was cached: ask the server once.
  if (!signerOf(keys)) keys = (await getChannelKeys(bound, true).catch(() => null)) ?? keys;
  const memberIds = keys.members.map((m) => m.userId);
  if (target.kind === "dm" && !isExactDmMembers(memberIds, uid, target.recipientId)) return { ok: false, reason: "wrong_conversation" } as const;
  const signer = signerOf(keys);
  return checkOffRecord({
    record,
    channelId: bound,
    expected: expectedConversation(target, uid),
    memberIds,
    signer,
    signatureValid: signer ? await verifyConversationStateSig(signer.signPub, record) : false,
    now: Date.now(),
    ...freshness,
  });
}

async function runOffCheck(target: E2eeTarget, channelId: string, given: ConversationStateRecord | null | undefined): Promise<OffVerification> {
  await whenLocalReady();
  if (!userId) return { ok: false, reason: "not_ready" };
  const uid = userId;
  const bound = boundChannel(target, channelId);
  if (!bound) return { ok: false, reason: "wrong_conversation" };
  let rec = given ?? null;
  if (given === undefined) {
    const state = await api<{ record?: unknown }>(`/channels/${encodeURIComponent(bound)}/state`);
    rec = parseConversationState(state.record);
    if (!rec) return { ok: false, reason: "no_record" };
  }
  if (!rec) return { ok: false, reason: "malformed" };
  const record = rec;
  const memory = await getConversationStateMemory(uid, conversationKey(target)).catch(() => null);
  const verdict = await checkOffRecordHere(target, bound, record, {
    seenEncryptedAt: memory?.seenEncryptedAt ?? null,
    acceptedOffTs: memory?.lastOffTs ?? null,
    consumedOffTs: memory?.consumedOffTs ?? null,
  });
  // Who the record names (the banner can say "from a device you haven't accepted yet").
  if (!verdict.ok) return { ...verdict, by: record.userId };
  await acceptConversationOff(uid, conversationKey(target), { ts: record.ts, by: record.userId, deviceId: record.deviceId, channelId: bound });
  noteConversationPlain(bound);
  return { ok: true, record };
}

/**
 * A "turned off" notice row's record, when it verifies for this conversation
 * (signer, binding, signature; not freshness: it's history). Null otherwise.
 * The caller places the off point at the signed time, not the row's.
 */
export async function verifiedOffNotice(target: E2eeTarget, channelId: string, record: unknown): Promise<ConversationStateRecord | null> {
  const parsed = parseConversationState(record);
  if (!parsed || !userId) return null;
  const bound = boundChannel(target, channelId);
  if (!bound) return null;
  const verdict = await checkOffRecordHere(target, bound, parsed, { seenEncryptedAt: null }).catch(() => null);
  return verdict?.ok ? parsed : null;
}

/** A conversation was turned on again: forget "off" checks still running. */
export function forgetOffChecks(): void {
  offChecks.clear();
}

// ─── Who a conversation's messages are encrypted to ───────────────────────────

export interface ConversationMemberCheck {
  /** The member list is usable: a 1:1 DM's is exactly us + the URL's person; a group's is loaded. */
  ok: boolean;
  /** The members messages are encrypted to (group: only the ones the group shows). */
  members: MemberKeys[];
  /** Group: in the server's key list but not shown in the group (never encrypted to). */
  hidden: string[];
  /** Group: shown but missing from the key list. */
  missing: string[];
}

/**
 * Bind a conversation's key list to what the user opened: a 1:1 DM must be
 * exactly us + the person in the URL; a group's messages only go to the
 * members its UI shows (`shownMemberIds`, null while not loaded).
 */
export function checkMembers(keys: ChannelKeys, target: E2eeTarget, shownMemberIds: string[] | null | undefined): ConversationMemberCheck {
  const ids = keys.members.map((m) => m.userId);
  if (!userId) return { ok: false, members: [], hidden: [], missing: [] };
  if (target.kind === "dm") {
    const ok = isExactDmMembers(ids, userId, target.recipientId);
    return { ok, members: ok ? keys.members : [], hidden: [], missing: [] };
  }
  if (lower(keys.channelId) !== lower(target.channelId) || !shownMemberIds) return { ok: false, members: [], hidden: [], missing: [] };
  const check = compareGroupMembers(ids, shownMemberIds, userId);
  return { ok: true, members: keys.members.filter((m) => check.allowed.has(m.userId)), hidden: check.hidden, missing: check.missing };
}

/** checkMembers for the banner (loads the keys). */
export async function checkConversationMembers(channelId: string, target: E2eeTarget, shownMemberIds: string[] | null | undefined, fresh = false) {
  const keys = await getChannelKeys(channelId, fresh);
  return { keys, check: checkMembers(keys, target, shownMemberIds) };
}

// ─── Sending ──────────────────────────────────────────────────────────────────

export type SendBlockReason = "not_ready" | "identity_changed" | "no_recipients" | "member_mismatch" | "members_unknown";

export class E2eeSendBlockedError extends Error {
  constructor(readonly reason: SendBlockReason, readonly userIds: string[] = []) {
    super(
      reason === "identity_changed"
        ? "Someone's security code changed. Review it before sending."
        : reason === "no_recipients"
          ? "Nobody in this conversation can receive encrypted messages yet."
          : reason === "member_mismatch"
            ? "This conversation's member list doesn't match its encryption keys."
            : reason === "members_unknown"
              ? "The member list isn't loaded yet."
              : "Encryption isn't set up on this device.",
    );
    this.name = "E2eeSendBlockedError";
  }
}

/** Plaintext of messages we encrypted, keyed by envelope signature (the echo decrypts instantly). */
const sentPlaintext = new Map<string, { payload: MessagePayload; payloadText: string; key: string }>();

export interface EncryptedForChannel {
  envelope: Envelope;
  /** The key-set version this was encrypted for (the server refuses a stale one). */
  keysVersion: string | null;
}

/**
 * Encrypt a payload for the open conversation. `target` is what the user
 * opened (URL), `shownMemberIds` the members a group's UI shows: keys only go
 * to those people, whatever else the server lists. Uses the cached key set
 * (`freshKeys` asks the server first: the retry after a 409).
 */
export async function encryptForChannel(
  channelId: string,
  payload: MessagePayload,
  target: E2eeTarget,
  shownMemberIds?: string[] | null,
  opts: { selfId?: string | null; freshKeys?: boolean } = {},
): Promise<EncryptedForChannel> {
  await whenLocalReady(opts.selfId);
  // A device being set up right now (first start): wait for it.
  if (!identity || !device) await whenE2eeSettled(opts.selfId);
  if (!identity || !device || !userId) throw new E2eeSendBlockedError("not_ready");
  if (target.kind === "group" && lower(channelId) !== lower(target.channelId)) throw new E2eeSendBlockedError("member_mismatch");
  if (target.kind === "group" && !shownMemberIds) throw new E2eeSendBlockedError("members_unknown");
  let keys = await getChannelKeys(channelId, opts.freshKeys === true);
  let check = checkMembers(keys, target, shownMemberIds);
  // The cached set may predate a member change (someone joined the group):
  // ask the server before encrypting rather than after a refused send.
  if (!opts.freshKeys && (!check.ok || check.missing.length > 0)) {
    keys = await getChannelKeys(channelId, true);
    check = checkMembers(keys, target, shownMemberIds);
  }
  if (!check.ok) throw new E2eeSendBlockedError("member_mismatch");
  noteEncryptedConversation(channelId, target.kind === "dm" ? { kind: "dm", peer: lower(target.recipientId) } : { kind: "group_dm" });
  const changed = check.members.filter((m) => m.trust === "changed").map((m) => m.userId);
  if (changed.length > 0) throw new E2eeSendBlockedError("identity_changed", changed);
  // Readers first; notification keys (push previews) only while under the recipient limit.
  const recipients = capRecipients(check.members.flatMap((m) => m.recipients), check.members.flatMap((m) => m.notifyRecipients ?? []));
  const others = check.members.filter((m) => m.trust !== "self");
  if (others.length > 0 && !others.some((m) => m.recipients.length > 0)) throw new E2eeSendBlockedError("no_recipients");
  const { envelope, key } = await encryptMessage({
    payload,
    context: { channelId, senderUserId: userId, senderDeviceId: device.id },
    recipients,
    signKey: device.signPriv,
  });
  const payloadText = JSON.stringify(payload);
  if (sentPlaintext.size > 200) sentPlaintext.delete(sentPlaintext.keys().next().value!);
  sentPlaintext.set(envelope.sig, { payload, payloadText, key: toB64(key) });
  return { envelope, keysVersion: keys.version };
}

export interface EncryptedUpload {
  file: File;
  secret: { key: string; iv: string; sha256: string };
  meta: { name: string; type: string; size: number };
}

/** Encrypt a file for upload as an opaque `e2ee-*.bin` blob (in a worker when possible). */
export async function encryptFileForUpload(file: File): Promise<EncryptedUpload> {
  const enc = await encryptFileBytes(await file.arrayBuffer());
  return {
    file: new File([enc.blob], enc.blobName, { type: ATTACHMENT_BLOB_TYPE }),
    secret: { key: enc.key, iv: enc.iv, sha256: enc.sha256 },
    meta: { name: file.name, type: file.type || "", size: file.size },
  };
}

// ─── Receiving ────────────────────────────────────────────────────────────────

export type DecryptFailure =
  | "not_ready"
  | "restore"
  | "no_key"
  | "unwrap"
  | "decrypt"
  | "commitment"
  | "payload"
  | "signature"
  | "unknown_device"
  | "revoked_device"
  | "edit_mismatch"
  | "wrong_conversation"
  | "keys_unavailable"
  | "foreign_url"
  | "malformed";

export type DecryptResult =
  | { ok: true; payload: MessagePayload; verified: boolean }
  | { ok: false; reason: DecryptFailure };

/** In-flight and finished decryptions, by conversation | message | envelope | sender. */
const decryptCache = new Map<string, Promise<DecryptResult>>();
/** envelope signature → disclosure material for franking reports (memory only). */
const frankingKeys = new Map<string, { key: string; payload: string }>();

interface RawMessageLike {
  id: string;
  authorId?: string;
  author?: { id?: string };
  channelId?: string;
  createdAt?: string | Date;
  edited?: boolean;
  e2ee?: unknown;
}

const senderOf = (msg: RawMessageLike) => msg.authorId || msg.author?.id || "";

/** Envelope shape checks, once per stored object (a page passes each row through several steps). */
const parsedEnvelopes = new WeakMap<object, Envelope | null>();
function envelopeOf(value: unknown): Envelope | null {
  if (!value || typeof value !== "object") return null;
  const hit = parsedEnvelopes.get(value);
  if (hit !== undefined) return hit;
  const env = parseEnvelope(value);
  parsedEnvelopes.set(value, env);
  return env;
}

async function signerFor(channelId: string, senderId: string, deviceId: string) {
  const sender = lower(senderId);
  const fromChannel = await getChannelKeys(channelId).catch(() => null);
  let member = fromChannel?.members.find((m) => m.userId === sender);
  let signer = member?.signers.get(deviceId);
  if (!signer) {
    member = await getUserKeys(senderId, true).catch(() => undefined);
    signer = member?.signers.get(deviceId);
  }
  // getUserKeys already refuses a bundle for anyone else; never accept a signer from another person.
  if (member && member.userId !== sender) return { member: undefined, signer: undefined };
  return { member, signer };
}

/** Our private keys that may open an envelope (current first, then archived), by wrap recipient id. */
function openingKeys(): Array<{ id: string; privateKey: CryptoKey }> {
  const out: Array<{ id: string; privateKey: CryptoKey }> = [];
  if (device) out.push({ id: device.id, privateKey: device.ecdhPriv });
  for (const a of archived) if (a.device) out.push({ id: a.device.id, privateKey: a.device.ecdhPriv });
  if (userId) {
    const r = backupRecipientId(userId);
    if (backupKey) out.push({ id: r, privateKey: backupKey.priv });
    for (const a of archived) if (a.backup) out.push({ id: r, privateKey: a.backup.priv });
  }
  return out;
}

async function decryptOne(msg: RawMessageLike, channelId: string): Promise<DecryptResult> {
  const envelope = envelopeOf(msg.e2ee);
  if (!envelope) return { ok: false, reason: "malformed" };
  const senderId = senderOf(msg);
  if (!senderId) return { ok: false, reason: "malformed" };
  await whenLocalReady();
  if (!identity && !device && archived.length === 0) {
    // Keys may still be on their way (a restore / link in progress): wait for the server check.
    await whenE2eeSettled();
  }
  const phase = getE2eeSnapshot().phase;
  if (!identity && !device && archived.length === 0) return { ok: false, reason: phase === "needs-restore" ? "restore" : "not_ready" };
  const context = { channelId, senderUserId: senderId, senderDeviceId: envelope.sd };

  let opened: Awaited<ReturnType<typeof openEnvelope>> | null = null;
  const sent = sentPlaintext.get(envelope.sig);
  const candidates = openingKeys().filter((c) => envelope.keys.some((k) => k.r === c.id));
  if (candidates.length === 0 && !sent) {
    return { ok: false, reason: !identity && !device && phase === "needs-restore" ? "restore" : "no_key" };
  }
  let failure: DecryptFailure | null = null;
  for (const candidate of candidates) {
    try {
      opened = await openEnvelope(envelope, context, candidate);
      failure = null;
      break;
    } catch (err) {
      const code = err instanceof E2eeVerifyError ? err.code : "decrypt";
      failure = (["no_key", "unwrap", "decrypt", "commitment", "payload"].includes(code) ? code : "decrypt") as DecryptFailure;
      // Another of our keys may hold this entry (e.g. an archived backup key);
      // a bad ciphertext fails the same way under every key.
      if (failure !== "unwrap") break;
    }
  }
  if (!opened && !sent) return { ok: false, reason: failure ?? "no_key" };
  const payload = opened?.payload ?? sent!.payload;
  // An edit's envelope names the message it replaces; a replayed or swapped
  // envelope from another message is rejected.
  if (payload.mid && payload.mid !== lower(msg.id)) return { ok: false, reason: "edit_mismatch" };

  // Sender device signature, under a key we trust for the sender. A device
  // nobody we trust vouched for is not a sender we can show.
  const { member, signer } = await signerFor(channelId, senderId, envelope.sd);
  if (!signer || !signer.trusted) return { ok: false, reason: "unknown_device" };
  if (!(await verifyEnvelopeSignature(envelope, channelId, signer.signPub))) return { ok: false, reason: "signature" };
  const sentAt = msg.createdAt ? new Date(msg.createdAt).getTime() : Date.now();
  if (signer.revokedAt && sentAt > signer.revokedAt + 60_000) return { ok: false, reason: "revoked_device" };

  frankingKeys.set(envelope.sig, {
    key: opened ? toB64(opened.key) : sent!.key,
    payload: opened ? opened.payloadText : sent!.payloadText,
  });
  if (frankingKeys.size > 5000) frankingKeys.delete(frankingKeys.keys().next().value!);
  const verified = member?.trust !== "changed" && member?.trust !== "missing";
  return { ok: true, payload, verified };
}

/**
 * A cached decryption, re-checked against what we know now: the sender
 * device must still be trusted and not revoked before the message was sent
 * (else the message is decrypted again, which reports the real reason).
 * With no key set loaded yet (or a sender who left the group), trust follows
 * the local pins: it was verified on this device before, and the background
 * key refresh re-checks open conversations.
 */
function cachedResult(entry: PlainEntry, msg: RawMessageLike, channelId: string): DecryptResult | null {
  if (entry.payload.mid && entry.payload.mid !== lower(String(msg.id))) return null;
  const sender = lower(senderOf(msg));
  if (!sender || sender !== lower(entry.sender)) return null;
  const keys = channelKeysSettled.get(lower(channelId));
  const member = keys?.members.find((m) => m.userId === sender);
  if (member) {
    const signer = member.signers.get(entry.sd);
    if (!signer || !signer.trusted) return null;
    const sentAt = msg.createdAt ? new Date(msg.createdAt).getTime() : Date.now();
    if (signer.revokedAt && sentAt > signer.revokedAt + 60_000) return null;
    return { ok: true, payload: entry.payload, verified: member.trust !== "changed" && member.trust !== "missing" };
  }
  // Key set not loaded yet, or the sender isn't in it (left the group).
  const self = Boolean(userId && sender === lower(userId));
  const pin = pins[sender];
  if (!self && !pin) return null;
  return { ok: true, payload: entry.payload, verified: self || Boolean(pin && !pin.pending) };
}

// Write-behind for the encrypted IndexedDB cache (one transaction per burst).
let persistQueue: Array<{ key: string; entry: PlainEntry }> = [];
let persistTimer: ReturnType<typeof setTimeout> | null = null;

function queuePersist(key: string, entry: PlainEntry) {
  persistQueue.push({ key, entry });
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    const batch = persistQueue;
    persistQueue = [];
    void putPlainMany(userId, batch);
  }, 50);
}

/** Payload files / sticker only from our CDN (and, when known, only the blobs stored on the row). */
function urlsAllowed(payload: MessagePayload, storedAttachmentUrls?: string[]): boolean {
  return payloadUrlsAllowed(payload, {
    cdnUrl: clientCdnUrl(),
    // Unknown stored blobs (previews): still nothing outside our CDN's attachments.
    storedAttachmentUrls: storedAttachmentUrls ?? (payload.attachments ?? []).map((a) => a.url),
  });
}

/**
 * Decrypt (cached: in flight / memory / the encrypted IndexedDB cache, each
 * re-checked against current trust). `prefetched` is this message's entry
 * from a batched IndexedDB lookup; `storedAttachmentUrls` are the blobs the
 * server stored on the row. Only results whose URLs pass the allowlist are
 * cached, so a cache hit never carries a foreign URL.
 */
export function decryptMessage(msg: RawMessageLike, channelId: string, prefetched?: PlainEntry, storedAttachmentUrls?: string[]): Promise<DecryptResult> {
  const envelope = envelopeOf(msg.e2ee);
  const sender = senderOf(msg);
  const cacheKey = `${lower(channelId)}|${msg.id}|${envelope?.sig ?? "?"}|${lower(sender)}`;
  const hit = decryptCache.get(cacheKey);
  if (hit) return hit;
  const plainKey = envelope && sender ? plainCacheKey(channelId, String(msg.id), envelope.sig, sender) : null;
  const entry = plainKey ? (prefetched ?? peekPlain(userId, plainKey)) : undefined;
  const fromCache = entry ? cachedResult(entry, msg, channelId) : null;
  let p: Promise<DecryptResult>;
  if (fromCache) {
    p = Promise.resolve(fromCache);
    if (fromCache.ok && plainKey && userId && entry) rememberPlain(userId, plainKey, { ...entry, verified: fromCache.verified });
  } else {
    p = decryptOne(msg, channelId)
      .catch((): DecryptResult => ({ ok: false, reason: "decrypt" }))
      .then((r) => {
        if (r.ok && plainKey && envelope && userId && urlsAllowed(r.payload, storedAttachmentUrls)) {
          const plain: PlainEntry = { payload: r.payload, sd: envelope.sd, sender: lower(sender) };
          rememberPlain(userId, plainKey, { ...plain, verified: r.verified });
          queuePersist(plainKey, plain);
        }
        return r;
      });
  }
  if (decryptCache.size > 5000) decryptCache.delete(decryptCache.keys().next().value!);
  decryptCache.set(cacheKey, p);
  // Transient failures (keys not loaded yet, unknown device) may succeed later.
  void p.then((r) => {
    if (!r.ok && (r.reason === "not_ready" || r.reason === "restore" || r.reason === "unknown_device")) decryptCache.delete(cacheKey);
  });
  return p;
}

/** Franking disclosure for an envelope we decrypted in this tab (report flow), by its signature. */
export function frankingDisclosure(sig: string): { key: string; payload: string } | null {
  return frankingKeys.get(sig) ?? null;
}

/**
 * Franking disclosure for a shown message, opening its envelope again when
 * it came from the decrypted-message cache (the message key is never cached).
 */
export async function frankingDisclosureFor(message: { id: string; authorId?: string; channelId?: string; envelope: unknown }): Promise<{ key: string; payload: string } | null> {
  const envelope = parseEnvelope(message.envelope);
  if (!envelope) return null;
  const known = frankingKeys.get(envelope.sig);
  if (known) return known;
  if (!message.authorId || !message.channelId) return null;
  await whenLocalReady();
  const context = { channelId: message.channelId, senderUserId: message.authorId, senderDeviceId: envelope.sd };
  for (const candidate of openingKeys().filter((c) => envelope.keys.some((k) => k.r === c.id))) {
    try {
      const opened = await openEnvelope(envelope, context, candidate);
      const disclosure = { key: toB64(opened.key), payload: opened.payloadText };
      frankingKeys.set(envelope.sig, disclosure);
      return disclosure;
    } catch {
      /* next key */
    }
  }
  const sent = sentPlaintext.get(envelope.sig);
  return sent ? { key: sent.key, payload: sent.payloadText } : null;
}

// ─── Chat engine glue ─────────────────────────────────────────────────────────

type RawChat = Record<string, unknown> & RawMessageLike & { referencedMessage?: Record<string, unknown> | null; attachments?: unknown };

function storedUrlsOf(attachments: unknown): string[] {
  if (!Array.isArray(attachments)) return [];
  return attachments.map((a) => (a && typeof (a as { url?: unknown }).url === "string" ? (a as { url: string }).url : "")).filter(Boolean);
}

export interface DecryptContext {
  /**
   * The open conversation's channel id: the URL's for a group, the DM channel
   * for a 1:1 DM (whose members are then checked against `dmPeer`). Rows of
   * any other channel are refused.
   */
  channelId: string | null;
  /** 1:1 DM: the person in the URL. The channel's members must be exactly us + them. */
  dmPeer?: string | null;
  /** The signed-in user: starts E2EE right away if it hasn't started yet. */
  selfId?: string | null;
  /** Live (just arrived) rows: never cached yet, so skip the IndexedDB lookup. */
  live?: boolean;
  /** `channelId` is the group DM in the URL (not a server-supplied id). */
  group?: boolean;
}

/**
 * Turn raw API / SSE messages carrying envelopes into renderable ones:
 * content, attachments (with their decryption keys), sticker, reply preview
 * and mentions come from the decrypted payload; `e2ee` becomes a status.
 * Messages without an envelope are returned untouched (the glue flags
 * plaintext rows of encrypted conversations). Cached results are used first;
 * the rest decrypt in parallel, newest first (the bottom of the chat is what
 * is on screen).
 */
export async function decryptRawMessages<T extends Record<string, unknown>>(raw: T[], ctx: DecryptContext): Promise<T[]> {
  await whenLocalReady(ctx.selfId);
  const expected = ctx.channelId ? lower(ctx.channelId) : null;
  // Which conversation this is: a 1:1 DM's channel must be exactly us + the URL's person.
  let conversationError: DecryptFailure | null = null;
  if (!expected) conversationError = "keys_unavailable";
  else {
    const keys = await getChannelKeys(expected).catch(() => null);
    if (ctx.dmPeer) {
      if (!userId) conversationError = "not_ready";
      else if (!keys) conversationError = "keys_unavailable";
      else if (!isExactDmMembers(keys.members.map((m) => m.userId), userId, ctx.dmPeer)) conversationError = "wrong_conversation";
      // The first paint may fill this DM's placeholders from memory (chatGlue.hydrateFromMemory).
      if (!conversationError) {
        rememberValidatedChannel(conversationKey({ kind: "dm", recipientId: ctx.dmPeer }), expected);
        noteEncryptedConversation(expected, { kind: "dm", peer: lower(ctx.dmPeer) });
      }
    } else {
      rememberValidatedChannel(conversationKey({ kind: "group", channelId: expected }), expected);
      if (ctx.group) noteEncryptedConversation(expected, { kind: "group_dm" });
    }
  }

  const failed = (item: T, m: RawChat, reason: DecryptFailure) => ({
    ...item,
    content: "",
    attachments: [],
    sticker: undefined,
    e2ee: { status: "error", reason, envelope: m.e2ee },
  }) as unknown as T;

  // Rows to decrypt, and one cache lookup for all of them.
  const jobs: Array<{ index: number; m: RawChat; plainKey: string | null }> = [];
  const out: T[] = raw.slice();
  raw.forEach((item, index) => {
    const m = item as unknown as RawChat;
    if (!m || !m.e2ee || typeof m.e2ee !== "object" || "status" in (m.e2ee as object)) return;
    if (conversationError) {
      out[index] = failed(item, m, conversationError);
      return;
    }
    if (typeof m.channelId === "string" && m.channelId && lower(m.channelId) !== expected) {
      out[index] = failed(item, m, "wrong_conversation");
      return;
    }
    const env = envelopeOf(m.e2ee);
    const sender = senderOf(m);
    jobs.push({ index, m, plainKey: env && sender ? plainCacheKey(expected!, String(m.id), env.sig, sender) : null });
  });
  if (jobs.length === 0) return out;
  const prefetched = ctx.live
    ? new Map<string, PlainEntry>()
    : await getPlainMany(userId, jobs.map((j) => j.plainKey).filter((k): k is string => Boolean(k)));

  const results = new Array<DecryptResult>(jobs.length);
  await Promise.all(
    jobs
      .map((job, i) => ({ job, i }))
      .reverse()
      .map(async ({ job, i }) => {
        results[i] = await decryptMessage(job.m, expected!, job.plainKey ? prefetched.get(job.plainKey) : undefined, storedUrlsOf(job.m.attachments));
      }),
  );

  const plainById = new Map<string, string>();
  jobs.forEach((job, i) => {
    const item = raw[job.index];
    const result = results[i];
    if (!result.ok) {
      out[job.index] = failed(item, job.m, result.reason);
      return;
    }
    const p = result.payload;
    // Files and stickers only from our CDN, and only the blobs stored on this message.
    if (!payloadUrlsAllowed(p, { cdnUrl: clientCdnUrl(), storedAttachmentUrls: storedUrlsOf(job.m.attachments) })) {
      out[job.index] = failed(item, job.m, "foreign_url");
      return;
    }
    const id = lower(String(job.m.id));
    plainById.set(id, p.content);
    rememberText(expected!, id, p.content);
    out[job.index] = applyPayload(item, p, result.verified, job.m.e2ee, expected!);
  });
  // Replies to encrypted messages decrypted in the same batch: our own text wins.
  return out.map((item) => {
    const m = item as unknown as RawChat;
    const ref = m.referencedMessage as { id?: unknown; content?: unknown; encrypted?: unknown; quotedBySender?: unknown } | null | undefined;
    if (!ref?.encrypted || ref.id === undefined) return item;
    const own = plainById.get(lower(String(ref.id)));
    if (own === undefined || (ref.content === own && !ref.quotedBySender)) return item;
    return { ...item, referencedMessage: { ...ref, content: own, quotedBySender: false } } as T;
  });
}

/**
 * Fill envelope-only placeholders (the localStorage message cache keeps
 * encrypted messages without their text) from the encrypted IndexedDB cache:
 * after a reload the conversation shows its text before the network page
 * arrives. Only placeholders of the open conversation are filled (a group:
 * the URL's channel; a 1:1 DM: a channel whose cached key set is exactly us +
 * the URL's person), each hit is re-checked like any cached result, and its
 * URLs must be on our CDN. Returns the same array when nothing was filled.
 */
export async function hydratePlaceholders<M extends { id: string; channelId?: string; authorId?: string; createdAt?: string | Date; e2ee?: { status?: string; envelope?: unknown } }>(
  messages: M[],
  target: E2eeTarget,
  selfId?: string | null,
): Promise<M[]> {
  const pending = messages
    .map((m, index) => {
      if (m.e2ee?.status !== "pending" || !m.channelId || !m.authorId) return null;
      const sig = (m.e2ee.envelope as { sig?: unknown } | null | undefined)?.sig;
      return typeof sig === "string" ? { index, m, channelId: lower(m.channelId), key: plainCacheKey(m.channelId, m.id, sig, m.authorId) } : null;
    })
    .filter((x): x is { index: number; m: M; channelId: string; key: string } => x !== null);
  if (pending.length === 0) return messages;
  await whenLocalReady(selfId);
  if (!userId) return messages;
  const uid = userId;
  // Which of the placeholders' channels really are this conversation.
  const allowed = new Set<string>();
  for (const channelId of new Set(pending.map((p) => p.channelId))) {
    if (target.kind === "group") {
      if (channelId === lower(target.channelId)) allowed.add(channelId);
      continue;
    }
    const keys = await getChannelKeys(channelId).catch(() => null);
    if (keys && isExactDmMembers(keys.members.map((m) => m.userId), uid, target.recipientId)) {
      allowed.add(channelId);
      rememberValidatedChannel(conversationKey(target), channelId);
      noteEncryptedConversation(channelId, { kind: "dm", peer: lower(target.recipientId) });
    }
  }
  const usable = pending.filter((p) => allowed.has(p.channelId));
  if (usable.length === 0) return messages;
  const found = await getPlainMany(uid, usable.map((p) => p.key));
  let changed = false;
  const next = messages.slice();
  for (const { index, m, key, channelId } of usable) {
    const entry = found.get(key);
    const result = entry ? cachedResult(entry, m as unknown as RawMessageLike, channelId) : null;
    if (!entry || !result?.ok || !urlsAllowed(result.payload)) continue;
    rememberPlain(uid, key, { ...entry, verified: result.verified });
    rememberText(channelId, m.id, result.payload.content);
    next[index] = applyPayload(m as unknown as Record<string, unknown>, result.payload, result.verified, m.e2ee!.envelope, channelId) as unknown as M;
    changed = true;
  }
  return changed ? next : messages;
}

// ─── Previews (notifications, DM list: stage 2) ───────────────────────────────

export type PreviewResult =
  | { ok: true; text: string; attachments: number; sticker: boolean; verified: boolean }
  | { ok: false; reason: DecryptFailure };

/**
 * Decrypt one message for a preview (in-app / desktop notification, DM list),
 * reusing every cache. `channelId` is the conversation the message must
 * decrypt under (its AAD binds it). Never throws.
 */
export async function decryptForPreview(
  msg: RawMessageLike,
  channelId: string,
  selfId?: string | null,
  opts: { dmPeer?: string | null } = {},
): Promise<PreviewResult> {
  try {
    await whenLocalReady(selfId);
    if (!envelopeOf(msg.e2ee)) return { ok: false, reason: "malformed" };
    if (typeof msg.channelId === "string" && msg.channelId && lower(msg.channelId) !== lower(channelId)) return { ok: false, reason: "wrong_conversation" };
    const key = lower(channelId);
    // A 1:1 DM's preview: the channel must be exactly us + that person (as when it's opened).
    if (opts.dmPeer) {
      const keys = await getChannelKeys(key).catch(() => null);
      if (!keys) return { ok: false, reason: "keys_unavailable" };
      if (!userId || !isExactDmMembers(keys.members.map((m) => m.userId), userId, opts.dmPeer)) return { ok: false, reason: "wrong_conversation" };
      // It carries an envelope: this DM is encrypted.
      noteEncryptedConversation(key, { kind: "dm", peer: lower(opts.dmPeer) });
    }
    const plainKey = (() => {
      const env = envelopeOf(msg.e2ee);
      const sender = senderOf(msg);
      return env && sender ? plainCacheKey(key, String(msg.id), env.sig, sender) : null;
    })();
    const prefetched = plainKey ? (await getPlainMany(userId, [plainKey])).get(plainKey) : undefined;
    const r = await decryptMessage(msg, key, prefetched);
    if (!r.ok) return r;
    return { ok: true, text: r.payload.content, attachments: r.payload.attachments?.length ?? 0, sticker: Boolean(r.payload.sticker), verified: r.verified };
  } catch {
    return { ok: false, reason: "decrypt" };
  }
}

// ─── Attachments (display) ────────────────────────────────────────────────────

const objectUrls = new Map<string, Promise<string>>();
const MAX_OBJECT_URLS = 64;
/** Whether the CDN answers CORS requests (null: not known yet). Once it doesn't, go straight to the relay. */
let cdnCors: boolean | null = null;

async function readBody(res: Response, onProgress?: (fraction: number) => void): Promise<ArrayBuffer> {
  const total = Number(res.headers.get("content-length") || 0);
  if (!onProgress || !res.body || !total) return res.arrayBuffer();
  const reader = res.body.getReader();
  const out = new Uint8Array(total);
  let received = 0;
  const chunks: Uint8Array[] = [];
  let overflow = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!overflow && received + value.byteLength <= total) out.set(value, received);
    else {
      if (!overflow) chunks.push(out.subarray(0, received));
      overflow = true;
      chunks.push(value);
    }
    received += value.byteLength;
    onProgress(Math.min(1, received / total));
  }
  if (!overflow) return received === total ? out.buffer : out.slice(0, received).buffer;
  const joined = new Uint8Array(received);
  let offset = 0;
  for (const c of chunks) {
    joined.set(c, offset);
    offset += c.byteLength;
  }
  return joined.buffer;
}

async function fetchCiphertext(url: string, onProgress?: (fraction: number) => void): Promise<ArrayBuffer> {
  // Never fetch anything but our CDN's attachment blobs (payload URLs are checked too).
  if (!isCdnUrl(url, clientCdnUrl(), "/attachments/")) throw new E2eeFormatError("Not an attachment on our CDN");
  if (cdnCors !== false) {
    try {
      const res = await fetch(url, { mode: "cors", credentials: "omit" });
      if (res.ok) {
        cdnCors = true;
        return await readBody(res, onProgress);
      }
    } catch {
      // CDN without CORS: use the same-origin relay from now on.
      if (cdnCors === null) cdnCors = false;
    }
  }
  const res = await fetch(`/api/e2ee/blob?url=${encodeURIComponent(url)}`, { credentials: "include" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return readBody(res, onProgress);
}

/** A `blob:` URL of the decrypted file (cached; the oldest are revoked). `onProgress` reports the download. */
export function decryptedObjectUrl(
  att: { url: string; contentType?: string; e2ee: { key: string; iv: string; sha256: string } },
  onProgress?: (fraction: number) => void,
): Promise<string> {
  const cacheKey = `${att.url}|${att.e2ee.sha256}`;
  const hit = objectUrls.get(cacheKey);
  if (hit) return hit;
  const p = (async () => {
    const plain = await decryptFileBytes(await fetchCiphertext(att.url, onProgress), att.e2ee);
    return URL.createObjectURL(new Blob([plain], { type: att.contentType || "application/octet-stream" }));
  })();
  objectUrls.set(cacheKey, p);
  p.catch(() => objectUrls.delete(cacheKey));
  if (objectUrls.size > MAX_OBJECT_URLS) {
    const [oldestKey, oldest] = objectUrls.entries().next().value!;
    objectUrls.delete(oldestKey);
    void oldest.then((u) => URL.revokeObjectURL(u)).catch(() => {});
  }
  return p;
}

// ─── Calls (DTLS fingerprint signatures) ──────────────────────────────────────

/** Sign our SDP's DTLS fingerprints for `roomId`; null when this device has no keys. */
export async function signCallSdp(roomId: string, sdp: string, selfId?: string | null): Promise<{ d: string; s: string } | null> {
  // Only the device key is needed: no waiting for the server check (and a
  // call answered before E2EE started still gets signed).
  await whenLocalReady(selfId);
  if (!device) await whenE2eeSettled(selfId);
  if (!device || !userId) return null;
  try {
    return { d: device.id, s: await signDtlsFingerprints(device.signPriv, roomId, userId, sdp) };
  } catch {
    return null;
  }
}

/** Verify a peer's SDP signature against their trusted, active devices. */
export async function verifyCallSdp(roomId: string, peerUserId: string, sdp: string, proof: unknown): Promise<boolean> {
  const p = proof as { d?: unknown; s?: unknown } | null;
  if (!p || typeof p.d !== "string" || typeof p.s !== "string") return false;
  await whenLocalReady();
  const member = await getUserKeys(peerUserId).catch(() => null);
  let signer = member?.signers.get(p.d);
  if (!signer) signer = (await getUserKeys(peerUserId, true).catch(() => null))?.signers.get(p.d);
  if (!signer || !signer.trusted || signer.revokedAt) return false;
  return verifyDtlsFingerprints(signer.signPub, p.s, roomId, peerUserId, sdp);
}

/**
 * Joining a DM / group DM call: load the peers' keys now, in parallel with
 * ICE / media setup, so checking their SDP signatures doesn't wait on the
 * network.
 */
export function prefetchCallKeys(roomId: string, selfId: string): void {
  const target = selfId ? e2eeTargetForCallRoom(roomId, selfId) : null;
  if (!target) return;
  void whenLocalReady(selfId)
    .then((): Promise<unknown> => (target.kind === "dm" ? getUserKeys(target.recipientId) : getChannelKeys(target.channelId)))
    .catch(() => {});
}

// ─── Linking a device (lib/e2ee/link.ts) ──────────────────────────────────────

export type LinkProgress =
  /** Waiting for the other device. */
  | { step: "waiting" }
  /** Compare this code with the other device. */
  | { step: "compare"; sas: string }
  /** New device: the other device sent its keys (apply them once the codes were confirmed here). */
  | { step: "received"; sas: string }
  /** Existing device: keys sent, waiting for the new device to finish. */
  | { step: "sent"; sas: string }
  | { step: "done" }
  | { step: "expired" };

interface LinkSessionData {
  code: string;
  status: "waiting" | "joined" | "revealed" | "sent" | "done";
  commit: string | null;
  oldPub: string | null;
  newPub: string | null;
  payload: unknown;
  expiresAt: number;
  name?: string | null;
}

interface NewDeviceLinkState {
  code: string;
  commit: string;
  eph: CryptoKeyPair;
  newPub: string;
  expiresAt: number;
  oldPub: string | null;
  secrets: LinkSecrets | null;
  payload: unknown;
}

interface ApproveLinkState {
  code: string;
  commit: string;
  /** The new device's key from the scanned QR (checked against its commitment). */
  qrPub: string | null;
  eph: CryptoKeyPair;
  oldPub: string;
  newPub: string | null;
  secrets: LinkSecrets | null;
  sent: boolean;
}

let linkNew: NewDeviceLinkState | null = null;
let linkApprove: ApproveLinkState | null = null;

async function getLinkSession(code: string): Promise<LinkSessionData | null> {
  try {
    return await api<LinkSessionData>(`/link/${encodeURIComponent(code)}`);
  } catch (err) {
    if (err instanceof E2eeApiError && err.status === 404) return null;
    throw err;
  }
}

/** One poll at a time per side (a slow step must never overlap the next poll). */
let linkNewPoll: Promise<LinkProgress> | null = null;
let linkApprovePoll: Promise<LinkProgress> | null = null;

/** New device: open a link request; show its code / QR on screen. */
export async function startDeviceLink(): Promise<{ code: string; expiresAt: number; qr: string }> {
  requireStore();
  if (linkNew) void cancelDeviceLink();
  const eph = await generateEphemeralKeyPair();
  const newPub = await exportPublicKey(eph.publicKey);
  const commit = await linkCommitment(newPub);
  const res = await api<{ code: string; expiresAt: number }>("/link", { method: "POST", body: JSON.stringify({ commit, name: deviceName() }) });
  linkNew = { code: res.code, commit, eph, newPub, expiresAt: res.expiresAt, oldPub: null, secrets: null, payload: null };
  const origin = typeof location !== "undefined" ? location.origin : "https://serika.chat";
  return { code: res.code, expiresAt: res.expiresAt, qr: linkQrPayload(origin, res.code, newPub) };
}

/**
 * New device: check on the request (the other device joined → reveal our key
 * and show the code). Single-flight, and the other device's key is pinned
 * the moment it is first seen, before anything is awaited or revealed: once
 * our key is out, a different key can never be accepted (a relay could
 * otherwise pick one after seeing ours to make the codes match).
 */
export function pollDeviceLink(): Promise<LinkProgress> {
  if (linkNewPoll) return linkNewPoll;
  const p = pollDeviceLinkOnce().finally(() => {
    if (linkNewPoll === p) linkNewPoll = null;
  });
  linkNewPoll = p;
  return p;
}

async function pollDeviceLinkOnce(): Promise<LinkProgress> {
  const state = linkNew;
  if (!state || !userId) return { step: "expired" };
  const data = await getLinkSession(state.code);
  if (!data || linkNew !== state) return { step: "expired" };
  if (!data.oldPub) {
    if (state.oldPub) throw new E2eeVerifyError("link_mismatch", "The link request was changed");
    return { step: "waiting" };
  }
  if (state.oldPub && data.oldPub !== state.oldPub) {
    linkNew = null;
    throw new E2eeVerifyError("link_mismatch", "The link request was changed");
  }
  state.oldPub = data.oldPub;
  if (!state.secrets) {
    // Only now (after the other device committed to its key) do we reveal ours.
    const secrets = await deriveLinkSecrets(state.eph.privateKey, state.oldPub, {
      userId, code: state.code, commit: state.commit, newPub: state.newPub, oldPub: state.oldPub,
    });
    if (!data.newPub) await api(`/link/${encodeURIComponent(state.code)}/reveal`, { method: "POST", body: JSON.stringify({ pub: state.newPub }) });
    else if (data.newPub !== state.newPub) throw new E2eeVerifyError("link_mismatch", "The link request was changed");
    state.secrets = secrets;
  }
  if (data.payload) {
    state.payload = data.payload;
    return { step: "received", sas: state.secrets.sas };
  }
  return { step: "compare", sas: state.secrets.sas };
}

/**
 * New device, after the user confirmed the codes match and the other device
 * sent its keys: open them, check they are this account's published keys,
 * store them (non-extractable) and register this device.
 */
export async function completeDeviceLink(): Promise<void> {
  const s = requireStore();
  const state = linkNew;
  if (!state?.secrets || !state.payload) throw new E2eeFormatError("Nothing to link yet");
  const secrets = await openLinkPayload(state.secrets.key, userId!, state.code, state.payload);
  const status = await api<StatusResponse>("/status");
  const pubs = status.identity;
  if (!pubs || publicKeyFromJwk(secrets.identity) !== pubs.identityPub || publicKeyFromJwk(secrets.backup) !== pubs.backupPub) {
    throw new E2eeFormatError("The keys from your other device don't match your account's current keys.");
  }
  await adoptKeys(s, secrets, { identityPub: pubs.identityPub, backupPub: pubs.backupPub }, Boolean(pubs.hasBackup));
  linkNew = null;
  // Tells the other device it worked (and drops the sealed copy on the server).
  await api(`/link/${encodeURIComponent(state.code)}/done`, { method: "POST" }).catch(() => {});
}

export async function cancelDeviceLink(): Promise<void> {
  const state = linkNew;
  linkNew = null;
  if (state) await api(`/link/${encodeURIComponent(state.code)}`, { method: "DELETE" }).catch(() => {});
}

export interface LinkRequestInfo {
  code: string;
  /** The requesting device's name as it described itself (server-relayed: informational). */
  name: string | null;
  /** When the request was opened (ms). */
  createdAt: number;
}

/** Existing device: look a request up (nothing is sent) so the user can check it before approving. */
export async function inspectLinkRequest(input: string): Promise<LinkRequestInfo> {
  const parsed = parseLinkInput(input);
  if (!parsed) throw new E2eeFormatError("That code doesn't look right");
  const data = await getLinkSession(parsed.code);
  if (!data || !data.commit) throw new E2eeApiError(404, "That code is not valid or has expired");
  if (data.status !== "waiting") throw new E2eeApiError(409, "Another device already answered this request");
  return { code: parsed.code, name: typeof data.name === "string" ? data.name : null, createdAt: data.expiresAt - LINK_TTL_SECONDS * 1000 };
}

/** Existing device: start approving the request in a scanned QR / typed code. */
export async function beginLinkApproval(input: string): Promise<void> {
  requireStore();
  await whenE2eeSettled();
  if (!identity || !backupKey || !device) throw new E2eeUnavailableError("Set up encryption on this device first");
  const parsed = parseLinkInput(input);
  if (!parsed) throw new E2eeFormatError("That code doesn't look right");
  if (linkApprove) linkApprove = null;
  const data = await getLinkSession(parsed.code);
  if (!data || !data.commit) throw new E2eeApiError(404, "That code is not valid or has expired");
  if (data.status !== "waiting") throw new E2eeApiError(409, "Another device already answered this request");
  if (parsed.newPub && (await linkCommitment(parsed.newPub)) !== data.commit) {
    throw new E2eeVerifyError("link_mismatch", "The QR code doesn't match the link request");
  }
  const eph = await generateEphemeralKeyPair();
  const oldPub = await exportPublicKey(eph.publicKey);
  await api(`/link/${encodeURIComponent(parsed.code)}/join`, { method: "POST", body: JSON.stringify({ pub: oldPub, commit: data.commit }) });
  linkApprove = { code: parsed.code, commit: data.commit, qrPub: parsed.newPub, eph, oldPub, newPub: null, secrets: null, sent: false };
}

/** Existing device: wait for the new device's key, then show the code to compare (single-flight). */
export function pollLinkApproval(): Promise<LinkProgress> {
  if (linkApprovePoll) return linkApprovePoll;
  const p = pollLinkApprovalOnce().finally(() => {
    if (linkApprovePoll === p) linkApprovePoll = null;
  });
  linkApprovePoll = p;
  return p;
}

async function pollLinkApprovalOnce(): Promise<LinkProgress> {
  const state = linkApprove;
  if (!state || !userId) return { step: "expired" };
  const data = await getLinkSession(state.code);
  if (linkApprove !== state) return { step: "expired" };
  if (!data) return { step: "expired" };
  if (data.status === "done" && state.sent) {
    linkApprove = null;
    return { step: "done" };
  }
  if (data.oldPub !== state.oldPub) throw new E2eeVerifyError("link_mismatch", "The link request was changed");
  if (!data.newPub) return { step: "waiting" };
  if (!state.secrets) {
    // The key the new device reveals must open the commitment we saw before joining (and match the QR).
    if ((await linkCommitment(data.newPub)) !== state.commit || (state.qrPub && state.qrPub !== data.newPub)) {
      linkApprove = null;
      await api(`/link/${encodeURIComponent(state.code)}`, { method: "DELETE" }).catch(() => {});
      throw new E2eeVerifyError("link_mismatch", "The new device's key doesn't match its request");
    }
    state.newPub = data.newPub;
    state.secrets = await deriveLinkSecrets(state.eph.privateKey, data.newPub, {
      userId, code: state.code, commit: state.commit, newPub: data.newPub, oldPub: state.oldPub,
    });
  } else if (data.newPub !== state.newPub) {
    throw new E2eeVerifyError("link_mismatch", "The link request was changed");
  }
  return state.sent ? { step: "sent", sas: state.secrets.sas } : { step: "compare", sas: state.secrets.sas };
}

/**
 * Existing device, after the user confirmed the codes match: send the
 * identity + backup keys sealed for the new device. Throws
 * E2eeLinkPassphraseError when this device needs the passphrase once first.
 */
export async function confirmLinkApproval(): Promise<void> {
  const state = linkApprove;
  if (!state?.secrets || !userId) throw new E2eeFormatError("Nothing to approve");
  const secrets = await currentSecrets();
  if (!secrets) {
    const snap = getE2eeSnapshot();
    if (!snap.serverHasBackup && !snap.hasPin) throw new E2eeLinkNeedsPassphraseError();
    throw new E2eeLinkPassphraseError();
  }
  const payload = await sealLinkPayload(state.secrets.key, userId, state.code, secrets);
  await api(`/link/${encodeURIComponent(state.code)}/payload`, { method: "POST", body: JSON.stringify(payload) });
  state.sent = true;
  // One approval per proof of the passphrase.
  await dropEscrow();
}

/** Existing device whose keys were sealed before linking existed: unlock linking with the passphrase once. */
export async function unlockLinkingWithPassphrase(passphrase: string): Promise<void> {
  requireStore();
  if (!identity || !backupKey) throw new E2eeUnavailableError("Encryption isn't set up on this device");
  const data = await api<{ backup: { blob: string; salt: string; iters: number } }>("/backup");
  const secrets = await openBackup(passphrase, userId!, data.backup);
  if (publicKeyFromJwk(secrets.identity) !== identity.pub || publicKeyFromJwk(secrets.backup) !== backupKey.pub) {
    throw new E2eeFormatError("The saved backup doesn't match the keys on this device.");
  }
  await sealEscrow(secrets);
  proofAt = Date.now();
}

export async function cancelLinkApproval(): Promise<void> {
  const state = linkApprove;
  linkApprove = null;
  if (state && !state.sent) await api(`/link/${encodeURIComponent(state.code)}`, { method: "DELETE" }).catch(() => {});
}

export { E2eeUnavailableError };

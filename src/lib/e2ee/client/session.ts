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
  signBackupKey,
  signDevice,
  signDtlsFingerprints,
  toB64,
  verifyBackupKey,
  verifyDevice,
  verifyDtlsFingerprints,
  verifyEnvelopeSignature,
  UUID_RE,
  type BackupSecrets,
  type E2eeTarget,
  type Envelope,
  type LinkSecrets,
  type MessagePayload,
  type PublicDevice,
  type WrapRecipient,
} from "@/lib/e2ee";
import { fromUtf8, randomBytes, utf8 } from "@/lib/e2ee/encoding";
import {
  E2eeUnavailableError,
  KeyStore,
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
  peekPlain,
  plainCacheKey,
  putCachedBundles,
  putPlainMany,
  rememberPlain,
  rememberText,
  rememberValidatedChannel,
  type PlainEntry,
} from "./plainCache";
import { applyPayload } from "./view";
import { decryptFileBytes, encryptFileBytes } from "./fileCrypto";

// ─── Module state (one signed-in account at a time) ───────────────────────────

let store: KeyStore | null = null;
let userId: string | null = null;
let identity: StoredIdentity | null = null;
let backupKey: StoredIdentity | null = null;
let device: StoredDevice | null = null;
let pins: Record<string, IdentityPin> = {};
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
  constructor(readonly status: number, message: string, readonly code: string | null = null) {
    super(message);
    this.name = "E2eeApiError";
  }
}

/** Changing the passphrase once keys are sealed needs the current one (they can't be exported any more). */
export class E2eeCurrentPassphraseError extends Error {
  constructor() {
    super("Enter your current recovery passphrase");
    this.name = "E2eeCurrentPassphraseError";
  }
}

/** Linking from this device needs the recovery passphrase once (its keys were sealed before linking existed). */
export class E2eeLinkPassphraseError extends Error {
  constructor() {
    super("Enter your recovery passphrase once to link devices from this one");
    this.name = "E2eeLinkPassphraseError";
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
    if (!res.ok) throw new E2eeApiError(res.status, data?.error || `Request failed (${res.status})`, typeof data?.code === "string" ? data.code : null);
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
  linkNew = null;
  linkApprove = null;
  linkNewPoll = null;
  linkApprovePoll = null;
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
  setE2eeSnapshot({
    phase,
    enabled: status.enabled,
    userId,
    deviceId: device?.id ?? null,
    identityPub: identity?.pub ?? null,
    hasPassphrase,
    serverHasBackup,
    remindPassphrase: phase === "ready" && status.enabled && !hasPassphrase && Date.now() >= (backupState?.remindAfter ?? 0),
    error: null,
    resetElsewhere,
    keysExtractable: keysExtractable(),
    keysLost: phase === "needs-restore" && keysLost && !resetElsewhere,
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

// ─── Link escrow ──────────────────────────────────────────────────────────────
// Once sealed, the identity / backup private keys are non-extractable, so a
// device couldn't hand them to a device it links. Whenever this device holds
// them in the clear (sealing, restoring, being linked) it also keeps them as
// JWK sealed under a separate non-extractable AES-GCM key (keyStore
// "linkEscrow"). Only the linking flow opens it, after the user compared the
// codes on both devices. Threat model note in docs/architecture/e2ee.md.

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
    await store.put("linkEscrow", { key, iv, ct, identityPub: identity.pub });
  } catch {
    /* linking from this device will ask for the passphrase once */
  }
}

/** The identity + backup private keys, when this device can produce them without the passphrase. */
async function currentSecrets(): Promise<BackupSecrets | null> {
  if (!identity || !backupKey || !userId) return null;
  if (identity.priv.extractable && backupKey.priv.extractable) {
    return { identity: await exportPrivateJwk(identity.priv), backup: await exportPrivateJwk(backupKey.priv) };
  }
  const escrow = store ? await store.get("linkEscrow").catch(() => null) : null;
  if (!escrow || escrow.identityPub !== identity.pub) return null;
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
export async function setRecoveryPassphrase(passphrase: string, currentPassphrase?: string): Promise<void> {
  const s = requireStore();
  if (!identity || !backupKey) throw new E2eeUnavailableError("Encryption isn't set up on this device");
  if (!isStrongRecoveryPassphrase(passphrase)) throw new E2eeFormatError("This passphrase is too easy to guess");
  let secrets: BackupSecrets;
  if (identity.priv.extractable && backupKey.priv.extractable) {
    secrets = { identity: await exportPrivateJwk(identity.priv), backup: await exportPrivateJwk(backupKey.priv) };
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
  setE2eeSnapshot({ remindPassphrase: true });
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

async function savePins() {
  if (store) await store.put("pins", pins);
  setE2eeSnapshot({ pinsVersion: getE2eeSnapshot().pinsVersion + 1 });
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
async function processBundle(b: Bundle, expectedUserId?: string): Promise<MemberKeys> {
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
    if (!pin) {
      pins[uid] = { key: b.identityPub, seen: [b.identityPub], verified: false, pending: null, updatedAt: Date.now() };
      void savePins();
      trust = "new";
      currentKey = b.identityPub;
    } else if (pin.key === b.identityPub) {
      if (pin.pending) {
        pins[uid] = { ...pin, pending: null, updatedAt: Date.now() };
        void savePins();
      }
      trust = pin.verified ? "verified" : "trusted";
      currentKey = b.identityPub;
    } else {
      if (pin.pending !== b.identityPub) {
        pins[uid] = { ...pin, pending: b.identityPub, updatedAt: Date.now() };
        void savePins();
      }
      trust = "changed";
      pendingKey = b.identityPub;
      // Until acknowledged, only devices vouched for by keys we already trusted count.
      currentKey = null;
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
  if (currentKey && b.backupPub && (await verifyBackupKey(currentKey, uid, b.backupPub, b.backupSig))) {
    recipients.push({ id: backupRecipientId(uid), pub: b.backupPub });
  }
  // This device always gets a copy (other tabs, the send echo) even before the
  // server's list catches up.
  if (isSelf && device && !recipients.some((r) => r.id === device!.id)) recipients.push({ id: device.id, pub: device.ecdhPub });
  if (isSelf && device && !signers.has(device.id)) signers.set(device.id, { signPub: device.signPub, revokedAt: null, trusted: true });
  return { userId: uid, identityPub: b.identityPub, trust, pendingKey, recipients, signers };
}

/** A member processed with a conversation's key set doubles as that user's keys (calls, unknown senders). */
function seedUserKeys(m: MemberKeys) {
  const prev = userKeyCache.get(m.userId);
  if (prev && Date.now() - prev.at < CHANNEL_KEYS_TTL) return;
  userKeyCache.set(m.userId, { value: Promise.resolve(m), at: Date.now() });
}

async function processChannelKeys(data: RawChannelKeys, key: string): Promise<ChannelKeys> {
  if (!data || typeof data.channelId !== "string" || lower(data.channelId) !== key) throw new E2eeFormatError("The server sent keys for another conversation");
  if (!Array.isArray(data.members) || hasDuplicateIds(data.members.map((m) => String(m?.userId ?? "")))) {
    throw new E2eeFormatError("The server sent a malformed member list");
  }
  const members = await Promise.all(data.members.map((m) => processBundle(m)));
  for (const m of members) seedUserKeys(m);
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
    const query = known?.version ? `?v=${encodeURIComponent(known.version)}` : "";
    const data = await api<RawChannelKeys & { unchanged?: boolean }>(`/channels/${encodeURIComponent(key)}/keys${query}`);
    let next: ChannelKeys;
    if (data.unchanged === true && known && typeof data.channelId === "string" && lower(data.channelId) === key && data.version === known.version) {
      next = { ...known, e2ee: data.e2ee === true, at: Date.now() };
    } else {
      next = await processChannelKeys(data, key);
      void putCachedBundles<RawChannelKeys>(userId, key, { channelId: data.channelId, e2ee: data.e2ee === true, version: data.version ?? null, members: data.members });
    }
    channelKeyCache.set(key, { value: Promise.resolve(next), at: Date.now() });
    channelKeysSettled.set(key, next);
    if (known && known.version !== next.version) keySetChanged(key);
    return next;
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
      try {
        const keys = await processChannelKeys(cached.data, key);
        channelKeysSettled.set(key, keys);
        void refreshChannelKeys(key).catch(() => {});
        return keys;
      } catch {
        /* unusable copy: ask the server */
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

/** Accept a contact's new identity key ("security code changed"). */
export async function acknowledgeIdentityChange(uid: string): Promise<void> {
  const key = lower(uid);
  const pin = pins[key];
  if (!pin?.pending) return;
  pins[key] = { key: pin.pending, seen: [...new Set([...pin.seen, pin.pending])], verified: false, pending: null, updatedAt: Date.now() };
  await savePins();
  clearKeyCaches();
  // Messages from their new devices failed as unknown devices: verify again.
  decryptCache.clear();
  forgetPlainMemory();
}

/** Mark a contact's current key as verified in person (safety number matched). */
export async function markVerified(uid: string, verified = true): Promise<void> {
  const key = lower(uid);
  const pin = pins[key];
  if (!pin) return;
  pins[key] = { ...pin, verified, updatedAt: Date.now() };
  await savePins();
  clearKeyCaches();
  decryptCache.clear();
  forgetPlainMemory();
}

export function getPin(uid: string): IdentityPin | null {
  return pins[lower(uid)] ?? null;
}

export function listPins(): Array<{ userId: string } & IdentityPin> {
  return Object.entries(pins).map(([uid, p]) => ({ userId: uid, ...p }));
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
  const key = lower(channelId);
  channelKeyCache.delete(key);
  channelKeysSettled.delete(key);
  const names = Array.isArray(res.withoutRecovery) ? res.withoutRecovery.filter((n): n is string => typeof n === "string") : [];
  return { changed: res.changed !== false, withoutRecovery: names };
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
  const changed = check.members.filter((m) => m.trust === "changed").map((m) => m.userId);
  if (changed.length > 0) throw new E2eeSendBlockedError("identity_changed", changed);
  const recipients = check.members.flatMap((m) => m.recipients);
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
      if (!conversationError) rememberValidatedChannel(conversationKey({ kind: "dm", recipientId: ctx.dmPeer }), expected);
    } else {
      rememberValidatedChannel(conversationKey({ kind: "group", channelId: expected }), expected);
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
export async function decryptForPreview(msg: RawMessageLike, channelId: string, selfId?: string | null): Promise<PreviewResult> {
  try {
    await whenLocalReady(selfId);
    if (!envelopeOf(msg.e2ee)) return { ok: false, reason: "malformed" };
    const key = lower(channelId);
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
  if (!secrets) throw new E2eeLinkPassphraseError();
  const payload = await sealLinkPayload(state.secrets.key, userId, state.code, secrets);
  await api(`/link/${encodeURIComponent(state.code)}/payload`, { method: "POST", body: JSON.stringify(payload) });
  state.sent = true;
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
}

export async function cancelLinkApproval(): Promise<void> {
  const state = linkApprove;
  linkApprove = null;
  if (state && !state.sent) await api(`/link/${encodeURIComponent(state.code)}`, { method: "DELETE" }).catch(() => {});
}

export { E2eeUnavailableError };

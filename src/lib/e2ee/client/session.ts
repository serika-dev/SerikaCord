"use client";

// The client E2EE session (lazy-loaded): device setup, passphrase backup,
// restore / reset, contact key trust (TOFU + safety numbers), and encrypting /
// decrypting messages and attachments for the chat engine. Plaintext lives in
// memory only; nothing decrypted is ever persisted.
//
// The server is untrusted: key bundles must belong to the user asked for, a
// 1:1 DM's members must be exactly us + the person in the URL, group messages
// are only encrypted to the members the group shows, rows must belong to the
// open conversation, and payload URLs must point at our CDN.
import {
  ATTACHMENT_BLOB_TYPE,
  E2eeFormatError,
  E2eeVerifyError,
  backupRecipientId,
  compareGroupMembers,
  computeSafetyNumber,
  decryptAttachment,
  describeDevice,
  encryptAttachment,
  encryptMessage,
  exportPrivateJwk,
  exportPublicKey,
  generateBackupKeyPair,
  generateDeviceKeys,
  generateIdentityKeyPair,
  hasDuplicateIds,
  importBackupPrivateJwk,
  importIdentityPrivateJwk,
  isCdnUrl,
  isE2eeCryptoAvailable,
  isExactDmMembers,
  isStrongRecoveryPassphrase,
  openBackup,
  openEnvelope,
  parseEnvelope,
  payloadUrlsAllowed,
  publicKeyFromJwk,
  sealBackup,
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
  type MessagePayload,
  type PayloadAttachment,
  type PublicDevice,
  type WrapRecipient,
} from "@/lib/e2ee";
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

const MAX_ARCHIVED = 5;

const lower = (s: string) => s.toLowerCase();

/** Our CDN as the client knows it (the server config isn't bundled for the browser). */
function clientCdnUrl(): string {
  return process.env.NEXT_PUBLIC_CDN_URL || "https://cdn.serika.chat";
}

export class E2eeApiError extends Error {
  constructor(readonly status: number, message: string) {
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

async function api<T = Record<string, unknown>>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api/e2ee${path}`, {
    credentials: "include",
    cache: "no-store",
    ...init,
    headers: { ...(init.body ? { "Content-Type": "application/json" } : {}), ...(init.headers || {}) },
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new E2eeApiError(res.status, data?.error || `Request failed (${res.status})`);
  return data;
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
  channelKeyCache.clear();
  decryptCache.clear();
  decryptedText.clear();
  frankingKeys.clear();
  userKeyCache.clear();
  verifyCache.clear();
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
  initPromise = (async () => {
    try {
      await runInit();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setE2eeSnapshot({ phase: err instanceof E2eeUnavailableError ? "unavailable" : "error", error: message });
      // Let a later call retry after a failure.
      initPromise = null;
    }
  })();
  return initPromise;
}

/** Wait for the current init to settle (no-op when not started). */
export async function whenE2eeSettled(): Promise<void> {
  if (initPromise) await initPromise;
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
  channelKeyCache.clear();
  userKeyCache.clear();
}

async function runInit(): Promise<void> {
  if (!isE2eeCryptoAvailable() || !(await isKeyStoreAvailable())) {
    setE2eeSnapshot({ phase: "unavailable", userId, error: null });
    return;
  }
  const uid = userId!;
  store = new KeyStore(uid);
  await withSetupLock(async () => {
    [identity, backupKey, device] = await Promise.all([store!.get("identity"), store!.get("backup"), store!.get("device")]);
    pins = (await store!.get("pins")) ?? {};
    archived = (await store!.get("archive")) ?? [];
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

    if (server) return publishPhase("needs-restore", status);
    if (!status.enabled) return publishPhase("disabled", status);
    await generateFreshKeys(false);
    return publishPhase("ready", { ...status, identity: null });
  });
}

async function publishPhase(phase: "ready" | "disabled" | "needs-restore", status: StatusResponse) {
  const backupState = store ? await store.get("backupState") : null;
  const serverHasBackup = Boolean(status.identity?.hasBackup);
  // A reset clears the server backup, so a backup there always belongs to the current keys.
  const hasPassphrase = phase === "ready" && serverHasBackup;
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

/** Restore identity + backup keys on this device from the passphrase backup (stored non-extractable). */
export async function restoreFromPassphrase(passphrase: string): Promise<void> {
  const s = requireStore();
  const data = await api<{ backup: { blob: string; salt: string; iters: number }; identityPub: string; backupPub: string }>("/backup");
  const secrets = await openBackup(passphrase, userId!, data.backup);
  if (publicKeyFromJwk(secrets.identity) !== data.identityPub || publicKeyFromJwk(secrets.backup) !== data.backupPub) {
    throw new E2eeFormatError("This backup doesn't match your current keys. Reset encryption to start over.");
  }
  await withSetupLock(async () => {
    identity = { priv: await importIdentityPrivateJwk(secrets.identity, false), pub: data.identityPub };
    backupKey = { priv: await importBackupPrivateJwk(secrets.backup, false), pub: data.backupPub };
    await s.put("identity", identity);
    await s.put("backup", backupKey);
    await s.put("backupState", { hasPassphrase: true, remindAfter: 0 });
    await createAndPublishDevice();
  });
  resetElsewhere = false;
  decryptCache.clear();
  channelKeyCache.clear();
  await refreshStatus();
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
  channelKeyCache.clear();
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
  channelKeyCache.clear();
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
}

interface Bundle {
  userId: string;
  identityPub: string | null;
  backupPub: string | null;
  backupSig: string | null;
  devices: Array<PublicDevice & { revokedAt: string | null }>;
  revokedDevices: Array<PublicDevice & { revokedAt: string | null }>;
}

const CHANNEL_KEYS_TTL = 60_000;
const channelKeyCache = new Map<string, Promise<ChannelKeys>>();
const channelKeyAt = new Map<string, number>();
const userKeyCache = new Map<string, Promise<MemberKeys>>();
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

/** Keys of a DM / group DM's members (cached for a minute). */
export function getChannelKeys(channelId: string, fresh = false): Promise<ChannelKeys> {
  const key = lower(channelId);
  const at = channelKeyAt.get(key) ?? 0;
  const cached = channelKeyCache.get(key);
  if (cached && !fresh && Date.now() - at < CHANNEL_KEYS_TTL) return cached;
  const p = (async () => {
    const data = await api<{ channelId: string; e2ee: boolean; members: Bundle[] }>(`/channels/${encodeURIComponent(channelId)}/keys`);
    if (typeof data.channelId !== "string" || lower(data.channelId) !== key) throw new E2eeFormatError("The server sent keys for another conversation");
    if (!Array.isArray(data.members) || hasDuplicateIds(data.members.map((m) => String(m?.userId ?? "")))) {
      throw new E2eeFormatError("The server sent a malformed member list");
    }
    const members = await Promise.all(data.members.map((m) => processBundle(m)));
    return { channelId: key, e2ee: data.e2ee === true, members, at: Date.now() };
  })();
  channelKeyCache.set(key, p);
  channelKeyAt.set(key, Date.now());
  p.catch(() => {
    channelKeyCache.delete(key);
    channelKeyAt.delete(key);
  });
  return p;
}

/** One user's keys (calls, and senders not in the loaded member list). */
export function getUserKeys(uid: string, fresh = false): Promise<MemberKeys> {
  const key = lower(uid);
  const cached = userKeyCache.get(key);
  if (cached && !fresh) return cached;
  const p = api<{ keys: Bundle }>(`/users/${encodeURIComponent(uid)}/keys`).then((d) => processBundle(d.keys, key));
  userKeyCache.set(key, p);
  p.catch(() => userKeyCache.delete(key));
  setTimeout(() => {
    if (userKeyCache.get(key) === p) userKeyCache.delete(key);
  }, CHANNEL_KEYS_TTL);
  return p;
}

/** Accept a contact's new identity key ("security code changed"). */
export async function acknowledgeIdentityChange(uid: string): Promise<void> {
  const key = lower(uid);
  const pin = pins[key];
  if (!pin?.pending) return;
  pins[key] = { key: pin.pending, seen: [...new Set([...pin.seen, pin.pending])], verified: false, pending: null, updatedAt: Date.now() };
  await savePins();
  channelKeyCache.clear();
  userKeyCache.delete(key);
  // Messages from their new devices failed as unknown devices: verify again.
  decryptCache.clear();
}

/** Mark a contact's current key as verified in person (safety number matched). */
export async function markVerified(uid: string, verified = true): Promise<void> {
  const key = lower(uid);
  const pin = pins[key];
  if (!pin) return;
  pins[key] = { ...pin, verified, updatedAt: Date.now() };
  await savePins();
  channelKeyCache.clear();
  decryptCache.clear();
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

export async function enableChannelEncryption(channelId: string): Promise<void> {
  await api(`/channels/${encodeURIComponent(channelId)}/enable`, { method: "POST" });
  channelKeyCache.delete(lower(channelId));
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

/**
 * Encrypt a payload for the open conversation. `target` is what the user
 * opened (URL), `shownMemberIds` the members a group's UI shows: keys only go
 * to those people, whatever else the server lists.
 */
export async function encryptForChannel(
  channelId: string,
  payload: MessagePayload,
  target: E2eeTarget,
  shownMemberIds?: string[] | null,
): Promise<Envelope> {
  await whenE2eeSettled();
  if (!identity || !device || !userId) throw new E2eeSendBlockedError("not_ready");
  if (target.kind === "group" && lower(channelId) !== lower(target.channelId)) throw new E2eeSendBlockedError("member_mismatch");
  if (target.kind === "group" && !shownMemberIds) throw new E2eeSendBlockedError("members_unknown");
  const keys = await getChannelKeys(channelId);
  const check = checkMembers(keys, target, shownMemberIds);
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
  return envelope;
}

export interface EncryptedUpload {
  file: File;
  secret: { key: string; iv: string; sha256: string };
  meta: { name: string; type: string; size: number };
}

/** Encrypt a file for upload as an opaque `e2ee-*.bin` blob. */
export async function encryptFileForUpload(file: File): Promise<EncryptedUpload> {
  const enc = await encryptAttachment(await file.arrayBuffer());
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

const decryptCache = new Map<string, Promise<DecryptResult>>();
/** messageId → plaintext we decrypted ourselves (reply quotes prefer it over the sender's snippet). */
const decryptedText = new Map<string, string>();
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
  const envelope = parseEnvelope(msg.e2ee);
  if (!envelope) return { ok: false, reason: "malformed" };
  const senderId = msg.authorId || msg.author?.id || "";
  if (!senderId) return { ok: false, reason: "malformed" };
  await whenE2eeSettled();
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

/** Decrypt (cached by message id + envelope signature). */
export function decryptMessage(msg: RawMessageLike, channelId: string): Promise<DecryptResult> {
  const envelope = parseEnvelope(msg.e2ee);
  const cacheKey = `${lower(channelId)}|${msg.id}|${envelope?.sig ?? "?"}`;
  const hit = decryptCache.get(cacheKey);
  if (hit) return hit;
  const p = decryptOne(msg, channelId).catch((): DecryptResult => ({ ok: false, reason: "decrypt" }));
  if (decryptCache.size > 5000) decryptCache.delete(decryptCache.keys().next().value!);
  decryptCache.set(cacheKey, p);
  // Transient failures (keys not loaded yet, unknown device) may succeed later.
  void p.then((r) => {
    if (!r.ok && (r.reason === "not_ready" || r.reason === "restore" || r.reason === "unknown_device")) decryptCache.delete(cacheKey);
  });
  return p;
}

/** Franking disclosure for an envelope we decrypted (report flow), by its signature. */
export function frankingDisclosure(sig: string): { key: string; payload: string } | null {
  return frankingKeys.get(sig) ?? null;
}

// ─── Chat engine glue ─────────────────────────────────────────────────────────

const MENTION_RE = /<@!?([0-9a-fA-F-]{36})>/g;

type RawRef = Record<string, unknown> & { id?: unknown; content?: unknown; encrypted?: unknown; quotedBySender?: unknown };
type RawChat = Record<string, unknown> & RawMessageLike & { referencedMessage?: RawRef | null; attachments?: unknown };

function attachmentView(a: PayloadAttachment) {
  return {
    id: a.id,
    url: a.url,
    filename: a.name,
    contentType: a.type || "application/octet-stream",
    size: a.size,
    ...(a.spoiler ? { spoiler: true } : {}),
    ...(a.durationSecs !== undefined ? { durationSecs: a.durationSecs } : {}),
    ...(a.waveform !== undefined ? { waveform: a.waveform } : {}),
    e2ee: { key: a.key, iv: a.iv, sha256: a.sha256 },
  };
}

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
}

/**
 * Turn raw API / SSE messages carrying envelopes into renderable ones:
 * content, attachments (with their decryption keys), sticker, reply preview
 * and mentions come from the decrypted payload; `e2ee` becomes a status.
 * Messages without an envelope are returned untouched (the glue flags
 * plaintext rows of encrypted conversations).
 */
export async function decryptRawMessages<T extends Record<string, unknown>>(raw: T[], ctx: DecryptContext): Promise<T[]> {
  const expected = ctx.channelId ? lower(ctx.channelId) : null;
  // Which conversation this is: a 1:1 DM's channel must be exactly us + the URL's person.
  let conversationError: DecryptFailure | null = null;
  if (!expected) conversationError = "keys_unavailable";
  else if (ctx.dmPeer) {
    await whenE2eeSettled();
    if (!userId) conversationError = "not_ready";
    else {
      const keys = await getChannelKeys(expected).catch(() => null);
      if (!keys) conversationError = "keys_unavailable";
      else if (!isExactDmMembers(keys.members.map((m) => m.userId), userId, ctx.dmPeer)) conversationError = "wrong_conversation";
    }
  }

  const plainById = new Map<string, string>();
  const failed = (item: T, m: RawChat, reason: DecryptFailure) => ({
    ...item,
    content: "",
    attachments: [],
    sticker: undefined,
    e2ee: { status: "error", reason, envelope: m.e2ee },
  }) as unknown as T;

  const results = await Promise.all(raw.map(async (item) => {
    const m = item as unknown as RawChat;
    if (!m || !m.e2ee || typeof m.e2ee !== "object" || "status" in (m.e2ee as object)) return item;
    if (conversationError) return failed(item, m, conversationError);
    if (typeof m.channelId === "string" && m.channelId && lower(m.channelId) !== expected) return failed(item, m, "wrong_conversation");
    const result = await decryptMessage(m, expected!);
    if (!result.ok) return failed(item, m, result.reason);
    const p = result.payload;
    // Files and stickers only from our CDN, and only the blobs stored on this message.
    if (!payloadUrlsAllowed(p, { cdnUrl: clientCdnUrl(), storedAttachmentUrls: storedUrlsOf(m.attachments) })) {
      return failed(item, m, "foreign_url");
    }
    const id = lower(String(m.id));
    plainById.set(id, p.content);
    if (decryptedText.size > 5000) decryptedText.delete(decryptedText.keys().next().value!);
    decryptedText.set(id, p.content);
    const mentions = [...new Set([...p.content.matchAll(MENTION_RE)].map((x) => x[1].toLowerCase()))];
    let referencedMessage: RawRef | null | undefined = m.referencedMessage;
    const ref = m.referencedMessage;
    if (ref && ref.encrypted && ref.id !== undefined) {
      // A quote of an encrypted message: our own decryption of it if we have
      // one, otherwise the sender's snippet, labelled as the sender's quote
      // (the sender chose it; it may not be what the other person wrote).
      const refId = lower(String(ref.id));
      const local = decryptedText.get(refId);
      if (local !== undefined) referencedMessage = { ...ref, content: local, quotedBySender: false };
      else if (p.replyPreview && p.replyPreview.id === refId) referencedMessage = { ...ref, content: p.replyPreview.content, quotedBySender: true };
    }
    return {
      ...item,
      content: p.content,
      attachments: (p.attachments ?? []).map(attachmentView),
      sticker: p.sticker,
      mentionedUserIds: mentions,
      ...(referencedMessage !== m.referencedMessage ? { referencedMessage } : {}),
      e2ee: { status: "ok", verified: result.verified, envelope: m.e2ee },
    } as unknown as T;
  }));
  // Replies to encrypted messages decrypted in the same batch: our own text wins.
  return results.map((item) => {
    const m = item as unknown as RawChat;
    const ref = m.referencedMessage;
    if (!ref?.encrypted || ref.id === undefined) return item;
    const own = plainById.get(lower(String(ref.id)));
    if (own === undefined || (ref.content === own && !ref.quotedBySender)) return item;
    return { ...item, referencedMessage: { ...ref, content: own, quotedBySender: false } } as T;
  });
}

// ─── Attachments (display) ────────────────────────────────────────────────────

const objectUrls = new Map<string, Promise<string>>();
const MAX_OBJECT_URLS = 64;

async function fetchCiphertext(url: string): Promise<ArrayBuffer> {
  // Never fetch anything but our CDN's attachment blobs (payload URLs are checked too).
  if (!isCdnUrl(url, clientCdnUrl(), "/attachments/")) throw new E2eeFormatError("Not an attachment on our CDN");
  try {
    const res = await fetch(url, { mode: "cors", credentials: "omit" });
    if (res.ok) return await res.arrayBuffer();
  } catch {
    /* CDN without CORS: use the same-origin relay */
  }
  const res = await fetch(`/api/e2ee/blob?url=${encodeURIComponent(url)}`, { credentials: "include" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.arrayBuffer();
}

/** A `blob:` URL of the decrypted file (cached; the oldest are revoked). */
export function decryptedObjectUrl(att: { url: string; contentType?: string; e2ee: { key: string; iv: string; sha256: string } }): Promise<string> {
  const cacheKey = `${att.url}|${att.e2ee.sha256}`;
  const hit = objectUrls.get(cacheKey);
  if (hit) return hit;
  const p = (async () => {
    const plain = await decryptAttachment(await fetchCiphertext(att.url), att.e2ee);
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
export async function signCallSdp(roomId: string, sdp: string): Promise<{ d: string; s: string } | null> {
  await whenE2eeSettled();
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
  const member = await getUserKeys(peerUserId).catch(() => null);
  let signer = member?.signers.get(p.d);
  if (!signer) signer = (await getUserKeys(peerUserId, true).catch(() => null))?.signers.get(p.d);
  if (!signer || !signer.trusted || signer.revokedAt) return false;
  return verifyDtlsFingerprints(signer.signPub, p.s, roomId, peerUserId, sdp);
}

export { E2eeUnavailableError };

"use client";

// The client E2EE session (lazy-loaded): device setup, passphrase backup,
// restore / reset, contact key trust (TOFU + safety numbers), and encrypting /
// decrypting messages and attachments for the chat engine. Plaintext lives in
// memory only; nothing decrypted is ever persisted.
import {
  ATTACHMENT_BLOB_TYPE,
  E2eeFormatError,
  E2eeVerifyError,
  backupRecipientId,
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
  importBackupPrivateJwk,
  importIdentityPrivateJwk,
  isE2eeCryptoAvailable,
  openBackup,
  openEnvelope,
  parseEnvelope,
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
let encryptedChannels: Record<string, true> = {};
let initPromise: Promise<void> | null = null;

const lower = (s: string) => s.toLowerCase();

export class E2eeApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "E2eeApiError";
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
  encryptedChannels = {};
  initPromise = null;
  channelKeyCache.clear();
  decryptCache.clear();
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
    encryptedChannels = (await store!.get("channels")) ?? {};
    const status = await api<StatusResponse>(`/status${device ? `?device=${encodeURIComponent(device.id)}` : ""}`);
    const server = status.identity;

    // Keys on this device belong to an identity that was reset elsewhere.
    if (identity && server && server.identityPub !== identity.pub) {
      await store!.clearKeys();
      identity = backupKey = device = null;
    }

    if (identity && backupKey) {
      if (!server) {
        // Server lost our keys (or never got them): publish again.
        if (!status.enabled) return publishPhase("disabled", status);
        await publishIdentity(false);
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
  });
}

async function publishIdentity(reset: boolean): Promise<void> {
  const backupSig = await signBackupKey(identity!.priv, userId!, backupKey!.pub);
  await api("/identity", {
    method: "PUT",
    body: JSON.stringify({ identityPub: identity!.pub, backupPub: backupKey!.pub, backupSig, ...(reset ? { reset: true } : {}) }),
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

async function generateFreshKeys(reset: boolean): Promise<void> {
  const [idPair, bkPair] = await Promise.all([generateIdentityKeyPair(true), generateBackupKeyPair(true)]);
  const [idPub, bkPub] = await Promise.all([exportPublicKey(idPair.publicKey), exportPublicKey(bkPair.publicKey)]);
  identity = { priv: idPair.privateKey, pub: idPub };
  backupKey = { priv: bkPair.privateKey, pub: bkPub };
  await publishIdentity(reset);
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

export async function setRecoveryPassphrase(passphrase: string): Promise<void> {
  const s = requireStore();
  if (!identity || !backupKey) throw new E2eeUnavailableError("Encryption isn't set up on this device");
  const record = await sealBackup(passphrase, userId!, {
    identity: await exportPrivateJwk(identity.priv),
    backup: await exportPrivateJwk(backupKey.priv),
  });
  await api("/backup", { method: "PUT", body: JSON.stringify({ ...record, identityPub: identity.pub }) });
  await s.put("backupState", { hasPassphrase: true, remindAfter: 0 });
  setE2eeSnapshot({ hasPassphrase: true, serverHasBackup: true, remindPassphrase: false });
}

/** "Not now": remind again in three days. */
export async function snoozePassphraseReminder(): Promise<void> {
  const s = requireStore();
  const current = await s.get("backupState");
  await s.put("backupState", { hasPassphrase: current?.hasPassphrase ?? false, remindAfter: Date.now() + 3 * 86_400_000 });
  setE2eeSnapshot({ remindPassphrase: false });
}

/** Restore identity + backup keys on this device from the passphrase backup. */
export async function restoreFromPassphrase(passphrase: string): Promise<void> {
  const s = requireStore();
  const data = await api<{ backup: { blob: string; salt: string; iters: number }; identityPub: string; backupPub: string }>("/backup");
  const secrets = await openBackup(passphrase, userId!, data.backup);
  if (publicKeyFromJwk(secrets.identity) !== data.identityPub || publicKeyFromJwk(secrets.backup) !== data.backupPub) {
    throw new E2eeFormatError("This backup doesn't match your current keys. Reset encryption to start over.");
  }
  await withSetupLock(async () => {
    identity = { priv: await importIdentityPrivateJwk(secrets.identity, true), pub: data.identityPub };
    backupKey = { priv: await importBackupPrivateJwk(secrets.backup, true), pub: data.backupPub };
    await s.put("identity", identity);
    await s.put("backup", backupKey);
    await s.put("backupState", { hasPassphrase: true, remindAfter: 0 });
    await createAndPublishDevice();
  });
  decryptCache.clear();
  channelKeyCache.clear();
  await refreshStatus();
}

/**
 * Forgotten passphrase / lost devices: new identity + backup keys. Contacts
 * see a security-code change; history encrypted to the old keys is lost.
 */
export async function resetEncryption(): Promise<void> {
  const s = requireStore();
  await withSetupLock(async () => {
    await s.clearKeys();
    identity = backupKey = device = null;
    await generateFreshKeys(true);
  });
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

async function processBundle(b: Bundle): Promise<MemberKeys> {
  const uid = lower(b.userId);
  const isSelf = Boolean(userId && uid === lower(userId));
  let trust: MemberTrust;
  let currentKey: string | null;
  let historyKeys: string[];
  let pendingKey: string | null = null;
  if (isSelf) {
    trust = "self";
    currentKey = identity?.pub ?? null;
    historyKeys = currentKey ? [currentKey] : [];
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
  const all = [...b.devices, ...b.revokedDevices];
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
    const members = await Promise.all(data.members.map(processBundle));
    if (data.e2ee) await rememberEncryptedChannel(channelId);
    return { channelId: key, e2ee: data.e2ee, members, at: Date.now() };
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
  const p = api<{ keys: Bundle }>(`/users/${encodeURIComponent(uid)}/keys`).then((d) => processBundle(d.keys));
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
}

/** Mark a contact's current key as verified in person (safety number matched). */
export async function markVerified(uid: string, verified = true): Promise<void> {
  const key = lower(uid);
  const pin = pins[key];
  if (!pin) return;
  pins[key] = { ...pin, verified, updatedAt: Date.now() };
  await savePins();
  channelKeyCache.clear();
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

/** Conversations seen encrypted stay encrypted on this device, whatever the server says later. */
export async function rememberEncryptedChannel(channelId: string): Promise<void> {
  const key = lower(channelId);
  if (encryptedChannels[key]) return;
  encryptedChannels[key] = true;
  if (store) await store.put("channels", encryptedChannels).catch(() => {});
}

export function isRememberedEncrypted(channelId: string): boolean {
  return Boolean(encryptedChannels[lower(channelId)]);
}

export async function enableChannelEncryption(channelId: string): Promise<void> {
  await api(`/channels/${encodeURIComponent(channelId)}/enable`, { method: "POST" });
  await rememberEncryptedChannel(channelId);
  channelKeyCache.delete(lower(channelId));
}

// ─── Sending ──────────────────────────────────────────────────────────────────

export class E2eeSendBlockedError extends Error {
  constructor(readonly reason: "not_ready" | "identity_changed" | "no_recipients", readonly userIds: string[] = []) {
    super(
      reason === "identity_changed"
        ? "Someone's security code changed. Review it before sending."
        : reason === "no_recipients"
          ? "Nobody in this conversation can receive encrypted messages yet."
          : "Encryption isn't set up on this device.",
    );
    this.name = "E2eeSendBlockedError";
  }
}

/** Plaintext of messages we encrypted, keyed by envelope signature (the echo decrypts instantly). */
const sentPlaintext = new Map<string, { payload: MessagePayload; payloadText: string; key: string }>();

export async function encryptForChannel(channelId: string, payload: MessagePayload): Promise<Envelope> {
  await whenE2eeSettled();
  if (!identity || !device || !userId) throw new E2eeSendBlockedError("not_ready");
  const keys = await getChannelKeys(channelId);
  const changed = keys.members.filter((m) => m.trust === "changed").map((m) => m.userId);
  if (changed.length > 0) throw new E2eeSendBlockedError("identity_changed", changed);
  const recipients = keys.members.flatMap((m) => m.recipients);
  const others = keys.members.filter((m) => m.trust !== "self");
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
  | "malformed";

export type DecryptResult =
  | { ok: true; payload: MessagePayload; verified: boolean }
  | { ok: false; reason: DecryptFailure };

const decryptCache = new Map<string, Promise<DecryptResult>>();
/** messageId → disclosure material for franking reports (memory only). */
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
  const fromChannel = await getChannelKeys(channelId).catch(() => null);
  let member = fromChannel?.members.find((m) => m.userId === lower(senderId));
  let signer = member?.signers.get(deviceId);
  if (!signer) {
    member = await getUserKeys(senderId, true).catch(() => undefined);
    signer = member?.signers.get(deviceId);
  }
  return { member, signer };
}

async function decryptOne(msg: RawMessageLike, channelId: string): Promise<DecryptResult> {
  const envelope = parseEnvelope(msg.e2ee);
  if (!envelope) return { ok: false, reason: "malformed" };
  const senderId = msg.authorId || msg.author?.id || "";
  if (!senderId) return { ok: false, reason: "malformed" };
  await whenE2eeSettled();
  const phase = getE2eeSnapshot().phase;
  if (!identity && !device) return { ok: false, reason: phase === "needs-restore" ? "restore" : "not_ready" };
  const context = { channelId, senderUserId: senderId, senderDeviceId: envelope.sd };

  let opened: Awaited<ReturnType<typeof openEnvelope>> | null = null;
  const sent = sentPlaintext.get(envelope.sig);
  try {
    if (device && envelope.keys.some((k) => k.r === device!.id)) {
      opened = await openEnvelope(envelope, context, { id: device.id, privateKey: device.ecdhPriv });
    } else if (backupKey && userId && envelope.keys.some((k) => k.r === backupRecipientId(userId!))) {
      opened = await openEnvelope(envelope, context, { id: backupRecipientId(userId), privateKey: backupKey.priv });
    } else if (sent) {
      opened = null;
    } else {
      return { ok: false, reason: "no_key" };
    }
  } catch (err) {
    const code = err instanceof E2eeVerifyError ? err.code : "decrypt";
    return { ok: false, reason: (["no_key", "unwrap", "decrypt", "commitment", "payload"].includes(code) ? code : "decrypt") as DecryptFailure };
  }
  const payload = opened?.payload ?? sent!.payload;
  // An edit's envelope names the message it replaces; a replayed or swapped
  // envelope from another message is rejected.
  if (payload.mid && payload.mid !== lower(msg.id)) return { ok: false, reason: "edit_mismatch" };

  // Sender device signature, under a key we trust for the sender.
  const { member, signer } = await signerFor(channelId, senderId, envelope.sd);
  if (!signer) return { ok: false, reason: "unknown_device" };
  if (!(await verifyEnvelopeSignature(envelope, channelId, signer.signPub))) return { ok: false, reason: "signature" };
  const sentAt = msg.createdAt ? new Date(msg.createdAt).getTime() : Date.now();
  if (signer.revokedAt && sentAt > signer.revokedAt + 60_000) return { ok: false, reason: "revoked_device" };

  frankingKeys.set(msg.id, {
    key: opened ? toB64(opened.key) : sent!.key,
    payload: opened ? opened.payloadText : sent!.payloadText,
  });
  if (frankingKeys.size > 5000) frankingKeys.delete(frankingKeys.keys().next().value!);
  const verified = signer.trusted && member?.trust !== "changed" && member?.trust !== "missing";
  return { ok: true, payload, verified };
}

/** Decrypt (cached by message id + envelope signature). */
export function decryptMessage(msg: RawMessageLike, channelId: string): Promise<DecryptResult> {
  const envelope = parseEnvelope(msg.e2ee);
  const cacheKey = `${msg.id}|${envelope?.sig ?? "?"}`;
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

/** Franking disclosure for a message we decrypted (report flow). */
export function frankingDisclosure(messageId: string): { key: string; payload: string } | null {
  return frankingKeys.get(messageId) ?? null;
}

// ─── Chat engine glue ─────────────────────────────────────────────────────────

const MENTION_RE = /<@!?([0-9a-fA-F-]{36})>/g;

type RawChat = Record<string, unknown> & RawMessageLike & { referencedMessage?: Record<string, unknown> | null };

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

/**
 * Turn raw API / SSE messages carrying envelopes into renderable ones:
 * content, attachments (with their decryption keys), sticker, reply preview
 * and mentions come from the decrypted payload; `e2ee` becomes a status.
 * Messages without an envelope are returned untouched.
 */
export async function decryptRawMessages<T extends Record<string, unknown>>(raw: T[], channelIdHint?: string | null): Promise<T[]> {
  const plainById = new Map<string, string>();
  const results = await Promise.all(raw.map(async (item) => {
    const m = item as unknown as RawChat;
    if (!m || !m.e2ee || typeof m.e2ee !== "object" || "status" in (m.e2ee as object)) return item;
    const channelId = (m.channelId as string | undefined) || channelIdHint || "";
    const result = await decryptMessage(m, channelId);
    if (!result.ok) {
      return {
        ...item,
        content: "",
        attachments: [],
        sticker: undefined,
        e2ee: { status: "error", reason: result.reason, envelope: m.e2ee },
      } as unknown as T;
    }
    const p = result.payload;
    plainById.set(m.id, p.content);
    const mentions = [...new Set([...p.content.matchAll(MENTION_RE)].map((x) => x[1].toLowerCase()))];
    return {
      ...item,
      content: p.content,
      attachments: (p.attachments ?? []).map(attachmentView),
      sticker: p.sticker,
      mentionedUserIds: mentions,
      ...(m.referencedMessage && p.replyPreview && p.replyPreview.id === String(m.referencedMessage.id).toLowerCase()
        ? { referencedMessage: { ...m.referencedMessage, content: p.replyPreview.content } }
        : {}),
      e2ee: { status: "ok", verified: result.verified, envelope: m.e2ee },
    } as unknown as T;
  }));
  // Replies to encrypted messages in the same batch without a preview.
  return results.map((item) => {
    const m = item as unknown as RawChat;
    const ref = m.referencedMessage as { id?: string; content?: string; encrypted?: boolean } | undefined;
    if (ref?.encrypted && !ref.content && ref.id && plainById.has(ref.id)) {
      return { ...item, referencedMessage: { ...ref, content: plainById.get(ref.id) } } as T;
    }
    return item;
  });
}

// ─── Attachments (display) ────────────────────────────────────────────────────

const objectUrls = new Map<string, Promise<string>>();
const MAX_OBJECT_URLS = 64;

async function fetchCiphertext(url: string): Promise<ArrayBuffer> {
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

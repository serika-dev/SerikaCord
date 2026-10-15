"use client";

// Android push previews of end-to-end encrypted messages (stage 2,
// docs/architecture/e2ee.md "Push notifications"). Only runs inside an APK
// whose native side says it can decrypt pushes (pushProtocol >= 3):
//
//  - this phone's notification key: an ECDH P-256 pair made here once, the
//    private half handed to native code (stored under an Android Keystore
//    key) and dropped from JS, the public half signed by this device's
//    signing key and registered with the server, linked to the push token;
//  - the senders this device trusts (vouched-for, active devices of pinned
//    identities), kept in sync with native code, which only shows a sender's
//    text when the push's signature verifies under one of them;
//  - the conversations this device knows are encrypted (and whether each is
//    a 1:1 DM with whom, or a group): native code never shows the server's
//    text or offers Reply for them.
import { callNative, hasNativePlugin, isNativeApp, nativePlatform } from "@/lib/native/bridge";
import { NOTIFY_KEY_ID_KEY, readPushToken } from "@/lib/native/push";
import { exportPublicKey, newDeviceId } from "@/lib/e2ee/keys";
import { toB64 } from "@/lib/e2ee/encoding";
import { getE2eeSnapshot, loadE2eeSession } from "./state";

/** Push protocol of APKs that decrypt encrypted previews (lib/push/fcm.ts E2EE_PUSH_PROTOCOL). */
const E2EE_PUSH_PROTOCOL = 3;
/** `<notify id>|<device id>|<push token>` last registered with the server (skips repeat POSTs). */
const REGISTERED_KEY = "serika:notifyKeyRegistered";

let supported: Promise<boolean> | null = null;

/** This APK can decrypt encrypted push previews. */
export function nativeSupportsEncryptedPush(): Promise<boolean> {
  if (supported) return supported;
  supported = (async () => {
    if (!isNativeApp() || nativePlatform() !== "android") return false;
    if (!hasNativePlugin("SerikaNative", "setNotificationKey")) return false;
    const caps = await callNative<{ pushProtocol?: number }>("SerikaNative", "getCapabilities");
    return typeof caps?.pushProtocol === "number" && caps.pushProtocol >= E2EE_PUSH_PROTOCOL;
  })().catch(() => false);
  return supported;
}

function readLocal(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocal(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* storage blocked: registered again next start */
  }
}

interface NativeKeyInfo {
  id?: string;
  userId?: string;
  deviceId?: string;
  publicKey?: string;
}

/** A new key pair; the private half goes to native code and is never kept here. */
async function createNativeKey(userId: string, deviceId: string): Promise<{ id: string; publicKey: string } | null> {
  const pair = (await globalThis.crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
  const publicKey = await exportPublicKey(pair.publicKey);
  const pkcs8 = new Uint8Array(await globalThis.crypto.subtle.exportKey("pkcs8", pair.privateKey));
  const id = newDeviceId();
  try {
    const saved = await callNative<{ ok?: boolean }>("SerikaNative", "setNotificationKey", {
      id,
      userId,
      deviceId,
      privateKey: toB64(pkcs8),
      publicKey,
    });
    return saved?.ok === true ? { id, publicKey } : null;
  } finally {
    pkcs8.fill(0);
  }
}

let ensuring: Promise<void> | null = null;

/**
 * Make sure this phone has a notification key for the signed-in account and
 * this E2EE device, registered with the server and linked to the push token.
 * Safe to call repeatedly (single-flight; a registration that is already
 * known is not sent again). Never throws.
 */
export function ensureNotificationKey(selfId: string): Promise<void> {
  if (ensuring) return ensuring;
  ensuring = run(selfId, false)
    .catch(() => {})
    .finally(() => {
      ensuring = null;
    });
  return ensuring;
}

async function run(selfId: string, forceNew: boolean): Promise<void> {
  if (!(await nativeSupportsEncryptedPush())) return;
  const snap = getE2eeSnapshot();
  if (snap.phase !== "ready" || !snap.deviceId || !snap.userId) return;
  const userId = selfId.toLowerCase();
  if (snap.userId.toLowerCase() !== userId) return;
  const deviceId = snap.deviceId;

  const info = await callNative<NativeKeyInfo>("SerikaNative", "getNotificationKey");
  let key: { id: string; publicKey: string } | null =
    !forceNew && info?.id && info.publicKey && info.userId === userId && info.deviceId === deviceId ? { id: info.id, publicKey: info.publicKey } : null;
  if (!key) {
    writeLocal(REGISTERED_KEY, null);
    key = await createNativeKey(userId, deviceId);
    if (!key) return;
    // Native storage changed: hand it the whole trust state again.
    void resyncNative();
  }

  const pushToken = readPushToken();
  const marker = `${key.id}|${deviceId}|${pushToken ?? ""}`;
  if (readLocal(REGISTERED_KEY) === marker && readLocal(NOTIFY_KEY_ID_KEY) === key.id) return;

  const session = await loadE2eeSession();
  const signed = await session.signNotificationKey(key.id, key.publicKey, selfId);
  if (!signed || signed.deviceId !== deviceId || signed.userId !== userId) return;
  const res = await fetch("/api/e2ee/notify-keys", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: key.id, deviceId, ecdhPub: key.publicKey, sig: signed.sig, ...(pushToken ? { pushToken } : {}) }),
  });
  if (res.status === 409 && !forceNew) {
    // The server dropped this key (signed out / device removed elsewhere):
    // make a new one (replacing it keeps the trusted senders).
    writeLocal(NOTIFY_KEY_ID_KEY, null);
    return run(selfId, true);
  }
  if (!res.ok) return;
  writeLocal(NOTIFY_KEY_ID_KEY, key.id);
  writeLocal(REGISTERED_KEY, marker);
}

/**
 * This device can't decrypt any more (encryption reset elsewhere, keys
 * missing): drop the native key and trusted senders. The server already
 * stopped wrapping to it (its device is no longer active).
 */
export async function clearNativeNotificationKey(): Promise<void> {
  if (!(await nativeSupportsEncryptedPush())) return;
  writeLocal(REGISTERED_KEY, null);
  writeLocal(NOTIFY_KEY_ID_KEY, null);
  await callNative("SerikaNative", "clearNotificationKey");
}

let stopSync: (() => void) | null = null;

/** Hand native code everything known now (after its storage was set or replaced). */
async function resyncNative(): Promise<void> {
  if (!stopSync) return;
  const session = await loadE2eeSession();
  await callNative("SerikaNative", "setTrustedSigners", { users: session.trustedSignersSnapshot(), replace: true });
  await callNative("SerikaNative", "setEncryptedConversations", { conversations: session.encryptedConversationsSnapshot(), replace: false });
}

/**
 * Keep native code's trusted-sender list and encrypted-conversation list in
 * step with this device (changes are pushed as key sets load and
 * conversations are checked), and once per session replace the sender list
 * with everything known from cached key sets.
 */
export async function startTrustedSignerSync(selfId: string): Promise<void> {
  if (stopSync || !(await nativeSupportsEncryptedPush())) return;
  const session = await loadE2eeSession();
  if (stopSync) return;
  const offSigners = session.onTrustedSignersChanged((users) => {
    void callNative("SerikaNative", "setTrustedSigners", { users, replace: false });
  });
  const offConversations = session.onEncryptedConversationsChanged((conversations) => {
    void callNative("SerikaNative", "setEncryptedConversations", { conversations, replace: false });
  });
  stopSync = () => {
    offSigners();
    offConversations();
  };
  await session.noteRememberedGroups().catch(() => {});
  await session.primeTrustedSigners(selfId).catch(() => {});
  await resyncNative();
}

export function stopTrustedSignerSync(): void {
  stopSync?.();
  stopSync = null;
}

"use client";

// IndexedDB storage for this device's E2EE keys, per signed-in account.
// CryptoKey objects are stored as-is (structured clone): device private keys
// are non-extractable and never leave IndexedDB. Plaintext messages are never
// written here (the decrypted-message cache is a separate, encrypted database:
// plainCache.ts).

const DB_NAME = "serika-e2ee";
const DB_VERSION = 1;
const STORE = "kv";

export class E2eeUnavailableError extends Error {
  constructor(message = "Encrypted messaging isn't available in this browser (storage is blocked).") {
    super(message);
    this.name = "E2eeUnavailableError";
  }
}

export interface StoredIdentity {
  priv: CryptoKey;
  pub: string;
}

export interface StoredDevice {
  id: string;
  ecdhPriv: CryptoKey;
  signPriv: CryptoKey;
  ecdhPub: string;
  signPub: string;
  sig: string;
  /** The identity key that signed `sig`. */
  identityPub: string;
}

/** Trust-on-first-use record of a contact's identity key. */
export interface IdentityPin {
  /** The identity key we currently trust. */
  key: string;
  /** Every key ever acknowledged for this user (verifies their older devices). */
  seen: string[];
  /** Safety number compared in person. Reset when the key changes. */
  verified: boolean;
  /** A different key the server now announces, waiting for the user to acknowledge. */
  pending?: string | null;
  updatedAt: number;
}

export interface BackupState {
  /** A passphrase backup exists for the current identity. */
  hasPassphrase: boolean;
  /** Don't nag about setting a passphrase before this time (ms). */
  remindAfter: number;
}

/**
 * Keys this device used before an encryption reset (here or on another
 * device). Kept so history encrypted to them stays readable here; never used
 * to encrypt or sign anything new.
 */
export interface ArchivedKeys {
  identity: StoredIdentity | null;
  backup: StoredIdentity | null;
  device: StoredDevice | null;
  archivedAt: number;
}

/**
 * The identity + backup private keys as JWK, AES-GCM sealed under a
 * non-extractable key stored next to it: lets this device hand them to a
 * new device it links, for a few minutes after the passphrase was proven
 * here or this device was linked (docs/architecture/e2ee.md "Linking a device").
 */
export interface LinkEscrow {
  key: CryptoKey;
  iv: Uint8Array;
  ct: ArrayBuffer;
  /** The identity public key the sealed keys belong to. */
  identityPub: string;
  /** Unusable (and deleted) after this time, ms. Missing: from before expiries existed → expired. */
  expiresAt?: number;
}

/**
 * What this device knows about one conversation's on / off switches
 * (lib/e2ee/conversationState.ts), keyed like `conversations`.
 */
export interface ConversationStateMemory {
  /** Last time (local clock, ms) this device saw the conversation encrypted. */
  seenEncryptedAt?: number;
  /**
   * A member-signed "turned off" record this device verified and accepted:
   * plaintext is allowed there until the conversation is seen encrypted again.
   */
  off?: { ts: number; by: string; deviceId: string; channelId: string } | null;
  /** The newest "turned off" record ever accepted here (an older one never wins). */
  lastOffTs?: number;
  /** Accepted "turned off" records up to this time were superseded (seen encrypted again): never accepted again. */
  consumedOffTs?: number;
}

interface Records {
  identity: StoredIdentity;
  backup: StoredIdentity;
  device: StoredDevice;
  pins: Record<string, IdentityPin>;
  /**
   * Conversations seen encrypted, keyed by what the user opened (`dm:<user>`,
   * `gdm:<channel>`; lib/e2ee/conversation): downgrade protection, one-way,
   * local. Never keyed by a server-supplied channel id.
   */
  conversations: Record<string, true>;
  /** On / off switches seen per conversation (same keys as `conversations`). */
  conversationStates: Record<string, ConversationStateMemory>;
  backupState: BackupState;
  archive: ArchivedKeys[];
  linkEscrow: LinkEscrow;
}

export type RecordName = keyof Records;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try {
      if (typeof indexedDB === "undefined") throw new Error("no indexedDB");
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      reject(new E2eeUnavailableError());
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => {
      const db = request.result;
      // Another tab upgrading the database, or the browser dropping the
      // connection (storage pressure, Safari): reopen on the next access.
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      (db as IDBDatabase & { onclose?: (() => void) | null }).onclose = () => {
        dbPromise = null;
      };
      resolve(db);
    };
    request.onerror = () => reject(new E2eeUnavailableError());
    request.onblocked = () => reject(new E2eeUnavailableError("Encrypted messaging is busy in another tab. Reload this page."));
  });
  dbPromise.catch(() => {
    dbPromise = null;
  });
  return dbPromise;
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  return openDb().then(
    (db) =>
      new Promise<T | undefined>((resolve, reject) => {
        let result: T | undefined;
        const t = db.transaction(STORE, mode);
        const store = t.objectStore(STORE);
        const req = run(store);
        if (req) req.onsuccess = () => {
          result = req.result;
        };
        t.oncomplete = () => resolve(result);
        t.onerror = () => reject(t.error ?? new E2eeUnavailableError());
        t.onabort = () => reject(t.error ?? new E2eeUnavailableError());
      }),
  );
}

/** Key-value access scoped to one account (account switches never mix keys). */
export class KeyStore {
  constructor(readonly userId: string) {}

  private key(name: RecordName) {
    return `${this.userId.toLowerCase()}:${name}`;
  }

  async get<N extends RecordName>(name: N): Promise<Records[N] | null> {
    const value = await tx<Records[N]>("readonly", (s) => s.get(this.key(name)) as IDBRequest<Records[N]>);
    return value ?? null;
  }

  /** Several records in one read transaction (startup). */
  async getMany<N extends RecordName>(names: N[]): Promise<{ [K in N]: Records[K] | null }> {
    const out = {} as { [K in N]: Records[K] | null };
    await tx("readonly", (s) => {
      for (const name of names) {
        const req = s.get(this.key(name)) as IDBRequest<Records[N] | undefined>;
        req.onsuccess = () => {
          out[name] = (req.result ?? null) as Records[N] | null;
        };
      }
    });
    for (const name of names) if (!(name in out)) out[name] = null;
    return out;
  }

  async put<N extends RecordName>(name: N, value: Records[N]): Promise<void> {
    await tx("readwrite", (s) => {
      s.put(value, this.key(name));
    });
  }

  /** Read-modify-write one record in a single transaction (tabs can't lose each other's writes). */
  async update<N extends RecordName>(name: N, fn: (current: Records[N] | null) => Records[N]): Promise<void> {
    const key = this.key(name);
    await tx("readwrite", (s) => {
      const req = s.get(key) as IDBRequest<Records[N] | undefined>;
      req.onsuccess = () => {
        s.put(fn(req.result ?? null), key);
      };
    });
  }

  async delete(name: RecordName): Promise<void> {
    await tx("readwrite", (s) => {
      s.delete(this.key(name));
    });
  }

  /** Drop this account's identity, backup and device keys (reset / restore). */
  async clearKeys(): Promise<void> {
    await tx("readwrite", (s) => {
      s.delete(this.key("identity"));
      s.delete(this.key("backup"));
      s.delete(this.key("device"));
      s.delete(this.key("backupState"));
      s.delete(this.key("linkEscrow"));
    });
  }
}

/** Whether IndexedDB works here (private windows and some WebViews block it). */
export async function isKeyStoreAvailable(): Promise<boolean> {
  try {
    await openDb();
    return true;
  } catch {
    return false;
  }
}

/**
 * "Seen encrypted" answers already known in this tab. Only positives are
 * kept; a negative is always re-read, since another tab may have remembered
 * the conversation meanwhile. Accepting a verified "turned off" record drops
 * the positive (lib/e2ee/conversationState.ts).
 */
const rememberedHere = new Set<string>();
/** When this tab last wrote `seenEncryptedAt` per conversation (writes are throttled). */
const seenWrittenAt = new Map<string, number>();
// Short: an older sighting widens the window in which a replayed "turned off" record passes.
const SEEN_WRITE_INTERVAL_MS = 60_000;

function memoryId(userId: string, key: string) {
  return `${userId.toLowerCase()}|${key.toLowerCase()}`;
}

/**
 * Whether this device has seen the conversation `key` encrypted and hasn't
 * since accepted a verified "turned off" record for it (false when storage is
 * unavailable).
 */
export async function isConversationRememberedEncrypted(userId: string, key: string): Promise<boolean> {
  if (!userId || !key) return false;
  const id = memoryId(userId, key);
  if (rememberedHere.has(id)) return true;
  if (!(await isKeyStoreAvailable())) return false;
  const { conversations, conversationStates } = await new KeyStore(userId).getMany(["conversations", "conversationStates"]);
  const k = key.toLowerCase();
  if (!conversations?.[k] || conversationStates?.[k]?.off) return false;
  rememberedHere.add(id);
  return true;
}

/**
 * Remember that the conversation `key` is encrypted (seen now): clears an
 * accepted "turned off" state (it was turned on again) and moves
 * `seenEncryptedAt` forward, so an older "turned off" record can't be
 * replayed later.
 */
export async function rememberConversationEncrypted(userId: string, key: string): Promise<void> {
  if (!userId || !key) return;
  const id = memoryId(userId, key);
  const now = Date.now();
  if (rememberedHere.has(id) && now - (seenWrittenAt.get(id) ?? 0) < SEEN_WRITE_INTERVAL_MS) return;
  if (!(await isKeyStoreAvailable())) return;
  const k = key.toLowerCase();
  const store = new KeyStore(userId);
  await store.update("conversations", (current) => ({ ...(current ?? {}), [k]: true }));
  await store.update("conversationStates", (current) => {
    const prev = current?.[k] ?? {};
    const consumed = Math.max(prev.consumedOffTs ?? 0, prev.lastOffTs ?? 0);
    return {
      ...(current ?? {}),
      [k]: { ...prev, seenEncryptedAt: Math.max(prev.seenEncryptedAt ?? 0, now), off: null, ...(consumed ? { consumedOffTs: consumed } : {}) },
    };
  });
  seenWrittenAt.set(id, now);
  rememberedHere.add(id);
}

/** This device's memory of a conversation's switches (null when none / storage unavailable). */
export async function getConversationStateMemory(userId: string, key: string): Promise<ConversationStateMemory | null> {
  if (!userId || !key || !(await isKeyStoreAvailable())) return null;
  const states = await new KeyStore(userId).get("conversationStates");
  return states?.[key.toLowerCase()] ?? null;
}

/** Accept a verified "turned off" record: plaintext is allowed in `key` until it is seen encrypted again. */
export async function acceptConversationOff(userId: string, key: string, off: NonNullable<ConversationStateMemory["off"]>): Promise<void> {
  if (!userId || !key) return;
  const id = memoryId(userId, key);
  rememberedHere.delete(id);
  seenWrittenAt.delete(id);
  if (!(await isKeyStoreAvailable())) return;
  const k = key.toLowerCase();
  await new KeyStore(userId).update("conversationStates", (current) => {
    const prev = current?.[k] ?? {};
    return { ...(current ?? {}), [k]: { ...prev, off, lastOffTs: Math.max(prev.lastOffTs ?? 0, off.ts) } };
  });
}

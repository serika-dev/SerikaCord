"use client";

// IndexedDB storage for this device's E2EE keys, per signed-in account.
// CryptoKey objects are stored as-is (structured clone): device private keys
// are non-extractable and never leave IndexedDB. Plaintext messages are never
// written here.

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
  backupState: BackupState;
  archive: ArchivedKeys[];
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
    request.onsuccess = () => resolve(request.result);
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

/** Whether this device has seen the conversation `key` encrypted (false when storage is unavailable). */
export async function isConversationRememberedEncrypted(userId: string, key: string): Promise<boolean> {
  if (!userId || !key || !(await isKeyStoreAvailable())) return false;
  const list = await new KeyStore(userId).get("conversations");
  return Boolean(list?.[key.toLowerCase()]);
}

/** Remember that the conversation `key` is encrypted (one-way). */
export async function rememberConversationEncrypted(userId: string, key: string): Promise<void> {
  if (!userId || !key || !(await isKeyStoreAvailable())) return;
  await new KeyStore(userId).update("conversations", (current) => ({ ...(current ?? {}), [key.toLowerCase()]: true }));
}

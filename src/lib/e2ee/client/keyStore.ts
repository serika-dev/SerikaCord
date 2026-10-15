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
 * kept (the memory is one-way); a negative is always re-read, since another
 * tab may have remembered the conversation meanwhile.
 */
const rememberedHere = new Set<string>();

/** Whether this device has seen the conversation `key` encrypted (false when storage is unavailable). */
export async function isConversationRememberedEncrypted(userId: string, key: string): Promise<boolean> {
  if (!userId || !key) return false;
  const id = `${userId.toLowerCase()}|${key.toLowerCase()}`;
  if (rememberedHere.has(id)) return true;
  if (!(await isKeyStoreAvailable())) return false;
  const list = await new KeyStore(userId).get("conversations");
  for (const k of Object.keys(list ?? {})) rememberedHere.add(`${userId.toLowerCase()}|${k}`);
  return rememberedHere.has(id);
}

/** Remember that the conversation `key` is encrypted (one-way). */
export async function rememberConversationEncrypted(userId: string, key: string): Promise<void> {
  if (!userId || !key) return;
  const id = `${userId.toLowerCase()}|${key.toLowerCase()}`;
  if (rememberedHere.has(id)) return;
  if (!(await isKeyStoreAvailable())) return;
  await new KeyStore(userId).update("conversations", (current) => ({ ...(current ?? {}), [key.toLowerCase()]: true }));
  rememberedHere.add(id);
}

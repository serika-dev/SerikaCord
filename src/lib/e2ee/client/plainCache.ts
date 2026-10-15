"use client";

// Decrypted-message cache (so reopening an encrypted conversation renders at
// once instead of decrypting again) and cached public key bundles. Two layers:
//
//  - memory: an LRU of decrypted payloads, read synchronously by the chat
//    engine's first paint;
//  - IndexedDB ("serika-e2ee-cache", separate from the key database so a
//    cache problem never touches keys): every record is AES-256-GCM encrypted
//    under a per-account, non-extractable key that lives in the same database,
//    with the record's own key as associated data (records can't be swapped).
//    Plaintext is never written to disk. Public key bundles are stored as-is
//    (public data; trust is re-derived from the local pins on every use).
//
// Keys: `<channel>|<message id>|<envelope signature>|<sender>`, so an edit (a
// new envelope) or a row claiming another sender never hits an old entry.
// Deletes and edits drop the message's entries. Everything here is best
// effort: a failure is a cache miss, never an error the user sees.
// docs/architecture/e2ee.md "Caches".
import type { MessagePayload } from "@/lib/e2ee/payload";
import { utf8, fromUtf8 } from "@/lib/e2ee/encoding";

const DB_NAME = "serika-e2ee-cache";
const DB_VERSION = 1;
const PLAIN = "plain";
const BUNDLES = "bundles";
const META = "meta";

/** Decrypted payloads kept in memory (per tab). */
const MEMORY_MAX = 3000;
/** Encrypted records kept in IndexedDB (all accounts). */
const PERSIST_MAX = 10_000;

/** What a successful decryption leaves behind. */
export interface PlainEntry {
  payload: MessagePayload;
  /** Sender device id (re-checked against the current key bundles on every hit). */
  sd: string;
  /** Sender user id. */
  sender: string;
}

/** Memory entries also remember how trusted the sender was when last checked. */
export interface MemoryEntry extends PlainEntry {
  verified: boolean;
}

const lower = (s: string) => s.toLowerCase();

/** Cache key of a decrypted message (pure; unit-tested). */
export function plainCacheKey(channelId: string, messageId: string, sig: string, senderId: string): string {
  return `${lower(channelId)}|${lower(messageId)}|${sig}|${lower(senderId)}`;
}

/** Prefix of every entry of one message (all versions / senders). */
export function plainMessagePrefix(channelId: string, messageId: string): string {
  return `${lower(channelId)}|${lower(messageId)}|`;
}

// ─── Memory ───────────────────────────────────────────────────────────────────

const memory = new Map<string, MemoryEntry>();
/** `<channel>|<message id>` → plaintext we decrypted (reply quotes prefer our own decryption). */
const texts = new Map<string, string>();
/**
 * Conversation (`dm:<user>` / `gdm:<channel>`) → the channel id its rows were
 * last checked to belong to (a 1:1 DM's members exactly us + them). The
 * synchronous first paint only fills placeholders of that channel.
 */
const validatedChannels = new Map<string, string>();

export function rememberValidatedChannel(conversation: string, channelId: string): void {
  validatedChannels.set(lower(conversation), lower(channelId));
}

export function validatedChannelOf(conversation: string): string | undefined {
  return validatedChannels.get(lower(conversation));
}

function memKey(uid: string, key: string) {
  return `${lower(uid)}#${key}`;
}

/** A memory entry; `touch` refreshes its LRU position (false during React render: no side effects). */
export function peekPlain(uid: string | null | undefined, key: string, touch = true): MemoryEntry | undefined {
  if (!uid) return undefined;
  const k = memKey(uid, key);
  const hit = memory.get(k);
  if (hit && touch) {
    memory.delete(k);
    memory.set(k, hit);
  }
  return hit;
}

export function rememberPlain(uid: string, key: string, entry: MemoryEntry): void {
  const k = memKey(uid, key);
  memory.delete(k);
  memory.set(k, entry);
  while (memory.size > MEMORY_MAX) memory.delete(memory.keys().next().value!);
}

export function rememberText(channelId: string, messageId: string, content: string): void {
  const id = `${lower(channelId)}|${lower(messageId)}`;
  texts.delete(id);
  texts.set(id, content);
  while (texts.size > MEMORY_MAX) texts.delete(texts.keys().next().value!);
}

/** Our own decryption of a message of this conversation (never another conversation's). */
export function decryptedTextOf(channelId: string, messageId: string): string | undefined {
  return texts.get(`${lower(channelId)}|${lower(messageId)}`);
}

/** Drop the in-memory layer only (the IndexedDB copy stays): a fresh tab, as far as the cache is concerned. */
export function forgetPlainMemory(): void {
  memory.clear();
  texts.clear();
}

function forgetMemory(uid: string, prefix: string, channelId: string, messageId: string) {
  const start = memKey(uid, prefix);
  for (const k of [...memory.keys()]) if (k.startsWith(start)) memory.delete(k);
  texts.delete(`${lower(channelId)}|${lower(messageId)}`);
}

// ─── IndexedDB ────────────────────────────────────────────────────────────────

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try {
      if (typeof indexedDB === "undefined") throw new Error("no indexedDB");
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (err) {
      reject(err);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PLAIN)) db.createObjectStore(PLAIN).createIndex("at", "at");
      if (!db.objectStoreNames.contains(BUNDLES)) db.createObjectStore(BUNDLES);
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META);
    };
    request.onsuccess = () => {
      const db = request.result;
      // Another tab upgrading, or the browser closing the connection: reopen next time.
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      (db as IDBDatabase & { onclose?: (() => void) | null }).onclose = () => {
        dbPromise = null;
      };
      resolve(db);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("blocked"));
  });
  dbPromise.catch(() => {
    dbPromise = null;
  });
  return dbPromise;
}

function done(t: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

function request<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

/** Per-account record key (non-extractable AES-256-GCM, created on first use). */
const recordKeys = new Map<string, Promise<CryptoKey>>();

function recordKey(uid: string): Promise<CryptoKey> {
  const id = lower(uid);
  let p = recordKeys.get(id);
  if (p) return p;
  p = (async () => {
    const db = await openDb();
    const existing = await request(db.transaction(META, "readonly").objectStore(META).get(`${id}:plain`)) as CryptoKey | undefined;
    if (existing) return existing;
    const fresh = await globalThis.crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    // Two tabs may race: the first key written wins, the other re-reads it.
    const t = db.transaction(META, "readwrite");
    const store = t.objectStore(META);
    const current = await request(store.get(`${id}:plain`)) as CryptoKey | undefined;
    if (current) return current;
    store.put(fresh, `${id}:plain`);
    await done(t);
    return fresh;
  })();
  recordKeys.set(id, p);
  p.catch(() => recordKeys.delete(id));
  return p;
}

interface StoredRecord {
  at: number;
  iv: Uint8Array;
  ct: ArrayBuffer;
}

function aadFor(uid: string, key: string) {
  return utf8(`serika-e2ee-cache-v1|${lower(uid)}|${key}`);
}

function storeKey(uid: string, key: string) {
  return `${lower(uid)}#${key}`;
}

function isEntry(value: unknown): value is PlainEntry {
  const v = value as PlainEntry | null;
  return Boolean(v && typeof v === "object" && v.payload && typeof v.payload === "object" && typeof v.sd === "string" && typeof v.sender === "string");
}

/** Look several keys up (memory first, then one IndexedDB transaction). Never throws. */
export async function getPlainMany(uid: string | null | undefined, keys: string[]): Promise<Map<string, PlainEntry>> {
  const out = new Map<string, PlainEntry>();
  if (!uid || keys.length === 0) return out;
  const missing: string[] = [];
  for (const key of keys) {
    const hit = peekPlain(uid, key);
    if (hit) out.set(key, hit);
    else missing.push(key);
  }
  if (missing.length === 0) return out;
  try {
    const db = await openDb();
    const t = db.transaction(PLAIN, "readonly");
    const store = t.objectStore(PLAIN);
    const rows = await Promise.all(missing.map((key) => request(store.get(storeKey(uid, key))) as Promise<StoredRecord | undefined>));
    const found = rows.map((row, i) => [missing[i], row] as const).filter((x): x is readonly [string, StoredRecord] => Boolean(x[1]));
    if (found.length === 0) return out;
    const aes = await recordKey(uid);
    await Promise.all(found.map(async ([key, row]) => {
      try {
        const plain = await globalThis.crypto.subtle.decrypt({ name: "AES-GCM", iv: new Uint8Array(row.iv), additionalData: aadFor(uid, key) }, aes, row.ct);
        const entry = JSON.parse(fromUtf8(new Uint8Array(plain)));
        if (isEntry(entry)) out.set(key, entry);
      } catch {
        /* unreadable record: a miss */
      }
    }));
  } catch {
    /* cache unavailable: misses */
  }
  return out;
}

let putsSinceTrim = 0;

/** Store decrypted results (encrypted at rest). Never throws. */
export async function putPlainMany(uid: string | null | undefined, entries: Array<{ key: string; entry: PlainEntry }>): Promise<void> {
  if (!uid || entries.length === 0) return;
  try {
    const aes = await recordKey(uid);
    const at = Date.now();
    const sealed = await Promise.all(entries.map(async ({ key, entry }) => {
      const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
      const body: PlainEntry = { payload: entry.payload, sd: entry.sd, sender: entry.sender };
      const ct = await globalThis.crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aadFor(uid, key) }, aes, utf8(JSON.stringify(body)));
      return { key, record: { at, iv, ct } satisfies StoredRecord };
    }));
    const db = await openDb();
    const t = db.transaction(PLAIN, "readwrite");
    const store = t.objectStore(PLAIN);
    for (const { key, record } of sealed) store.put(record, storeKey(uid, key));
    await done(t);
    putsSinceTrim += sealed.length;
    if (putsSinceTrim >= 200) {
      putsSinceTrim = 0;
      void trim();
    }
  } catch {
    /* best effort */
  }
}

/** Keep at most PERSIST_MAX records: drop the oldest. */
async function trim(): Promise<void> {
  try {
    const db = await openDb();
    const count = await request(db.transaction(PLAIN, "readonly").objectStore(PLAIN).count());
    let excess = count - PERSIST_MAX;
    if (excess <= 0) return;
    const t = db.transaction(PLAIN, "readwrite");
    const cursorReq = t.objectStore(PLAIN).index("at").openCursor();
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (!cursor || excess <= 0) return;
      cursor.delete();
      excess -= 1;
      cursor.continue();
    };
    await done(t);
  } catch {
    /* best effort */
  }
}

/** Drop every cached version of a message (deleted or edited). Never throws. */
export async function forgetPlainMessage(uid: string | null | undefined, channelId: string, messageId: string): Promise<void> {
  if (!uid || !channelId || !messageId) return;
  const prefix = plainMessagePrefix(channelId, messageId);
  forgetMemory(uid, prefix, channelId, messageId);
  try {
    const db = await openDb();
    const t = db.transaction(PLAIN, "readwrite");
    const start = storeKey(uid, prefix);
    t.objectStore(PLAIN).delete(IDBKeyRange.bound(start, `${start}￿`));
    await done(t);
  } catch {
    /* best effort */
  }
}

/** Sign-in / sign-out: forget every decrypted message and cached bundle (all accounts). */
export async function clearAllDecrypted(): Promise<void> {
  memory.clear();
  texts.clear();
  validatedChannels.clear();
  try {
    const db = await openDb();
    const t = db.transaction([PLAIN, BUNDLES], "readwrite");
    t.objectStore(PLAIN).clear();
    t.objectStore(BUNDLES).clear();
    await done(t);
  } catch {
    /* best effort */
  }
}

// ─── Key bundles ──────────────────────────────────────────────────────────────

export interface CachedBundles<T> {
  at: number;
  data: T;
}

export async function getCachedBundles<T>(uid: string | null | undefined, channelId: string): Promise<CachedBundles<T> | null> {
  if (!uid) return null;
  try {
    const db = await openDb();
    const row = await request(db.transaction(BUNDLES, "readonly").objectStore(BUNDLES).get(storeKey(uid, lower(channelId)))) as CachedBundles<T> | undefined;
    return row && typeof row.at === "number" && row.data ? row : null;
  } catch {
    return null;
  }
}

export async function putCachedBundles<T>(uid: string | null | undefined, channelId: string, data: T): Promise<void> {
  if (!uid) return;
  try {
    const db = await openDb();
    const t = db.transaction(BUNDLES, "readwrite");
    t.objectStore(BUNDLES).put({ at: Date.now(), data } satisfies CachedBundles<T>, storeKey(uid, lower(channelId)));
    await done(t);
  } catch {
    /* best effort */
  }
}

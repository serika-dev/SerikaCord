// A small in-memory IndexedDB for unit tests of browser-only modules (the
// E2EE key store and decrypted-message cache). Implements just what those use:
// open / upgrade, object stores with string keys, get / put / delete (key or
// bound range) / clear / count, an index with a cursor, and transaction
// completion. Values are kept by reference (CryptoKey objects included).

type Listener = (() => void) | null;

class FakeRequest<T = unknown> {
  result: T | undefined = undefined;
  error: unknown = null;
  onsuccess: Listener = null;
  onerror: Listener = null;
  onupgradeneeded: Listener = null;
  onblocked: Listener = null;
}

class FakeKeyRange {
  constructor(readonly lower: string, readonly upper: string) {}
  includes(key: string) {
    return key >= this.lower && key <= this.upper;
  }
  static bound(lower: string, upper: string) {
    return new FakeKeyRange(lower, upper);
  }
}

class FakeTransaction {
  oncomplete: Listener = null;
  onerror: Listener = null;
  onabort: Listener = null;
  error: unknown = null;
  private pending = 0;
  private scheduled = false;
  constructor(private readonly db: FakeDb) {}

  objectStore(name: string) {
    const data = this.db.stores.get(name);
    if (!data) throw new Error(`No store ${name}`);
    return new FakeStore(this, data);
  }

  /** Run a request callback asynchronously (like IDB), then maybe complete. */
  run<T>(fn: () => T): FakeRequest<T> {
    const req = new FakeRequest<T>();
    this.pending++;
    queueMicrotask(() => {
      try {
        req.result = fn();
        req.onsuccess?.();
      } catch (err) {
        req.error = err;
        req.onerror?.();
      }
      this.pending--;
      this.maybeComplete();
    });
    return req;
  }

  maybeComplete() {
    if (this.scheduled) return;
    this.scheduled = true;
    // Let callbacks queue more requests before the transaction finishes.
    setTimeout(() => {
      this.scheduled = false;
      if (this.pending === 0) this.oncomplete?.();
      else this.maybeComplete();
    }, 0);
  }
}

interface StoreData {
  rows: Map<string, unknown>;
  indexes: Map<string, string>;
}

class FakeStore {
  constructor(private readonly t: FakeTransaction, private readonly data: StoreData) {
    t.maybeComplete();
  }
  get(key: string) {
    return this.t.run(() => this.data.rows.get(key));
  }
  put(value: unknown, key: string) {
    return this.t.run(() => {
      this.data.rows.set(key, value);
      return key;
    });
  }
  delete(key: string | FakeKeyRange) {
    return this.t.run(() => {
      if (key instanceof FakeKeyRange) {
        for (const k of [...this.data.rows.keys()]) if (key.includes(k)) this.data.rows.delete(k);
      } else this.data.rows.delete(key);
      return undefined;
    });
  }
  clear() {
    return this.t.run(() => {
      this.data.rows.clear();
      return undefined;
    });
  }
  count() {
    return this.t.run(() => this.data.rows.size);
  }
  createIndex(name: string, path: string) {
    this.data.indexes.set(name, path);
  }
  index(name: string) {
    const path = this.data.indexes.get(name)!;
    const t = this.t;
    const rows = this.data.rows;
    return {
      openCursor: () => {
        const req = new FakeRequest<unknown>();
        const sorted = [...rows.entries()].sort(
          (a, b) => Number((a[1] as Record<string, unknown>)[path]) - Number((b[1] as Record<string, unknown>)[path]),
        );
        let i = 0;
        const emit = () =>
          t.run(() => {
            const entry = sorted[i];
            const cursor = entry
              ? {
                  value: entry[1],
                  delete: () => {
                    rows.delete(entry[0]);
                  },
                  continue: () => {
                    i++;
                    emit();
                  },
                }
              : null;
            req.result = cursor;
            req.onsuccess?.();
            return cursor;
          });
        emit();
        return req;
      },
    };
  }
}

class FakeDb {
  stores = new Map<string, StoreData>();
  version = 0;
  onversionchange: Listener = null;
  onclose: Listener = null;
  objectStoreNames = { contains: (name: string) => this.stores.has(name) };
  createObjectStore(name: string) {
    const data: StoreData = { rows: new Map(), indexes: new Map() };
    this.stores.set(name, data);
    return {
      createIndex: (index: string, path: string) => {
        data.indexes.set(index, path);
      },
    };
  }
  transaction() {
    return new FakeTransaction(this);
  }
  close() {}
}

export function installFakeIndexedDb() {
  const dbs = new Map<string, FakeDb>();
  const g = globalThis as unknown as { indexedDB?: unknown; IDBKeyRange?: unknown };
  g.IDBKeyRange = FakeKeyRange;
  g.indexedDB = {
    open(name: string, version = 1) {
      const req = new FakeRequest<FakeDb>();
      queueMicrotask(() => {
        let db = dbs.get(name);
        const upgrade = !db || db.version < version;
        if (!db) {
          db = new FakeDb();
          dbs.set(name, db);
        }
        req.result = db;
        if (upgrade) {
          db.version = version;
          req.onupgradeneeded?.();
        }
        req.onsuccess?.();
      });
      return req;
    },
  };
  return {
    reset: () => dbs.clear(),
    /** Every value stored in one object store (tests inspect what reached "disk"). */
    peek: (dbName: string, store: string) => [...(dbs.get(dbName)?.stores.get(store)?.rows.values() ?? [])],
    uninstall: () => {
      delete g.indexedDB;
      delete g.IDBKeyRange;
    },
  };
}

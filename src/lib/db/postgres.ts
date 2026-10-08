import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool, type PoolClient } from 'pg';
import { config } from '../config';
import * as schema from './schema';

export type DB = ReturnType<typeof drizzle<typeof schema>>;

// ── Global singleton ────────────────────────────────────────────────────────
// Next.js dev mode hot-reloads modules, which creates new Pool instances on
// every reload. Each Pool opens up to `max` TCP connections to PostgreSQL.
// With 3–4 reloads that's 30–40 connections, easily exhausting a small
// `max_connections` setting on the server. Storing the pool on `globalThis`
// survives HMR, so only one pool ever exists.
interface PgGlobal {
  __pgPool?: Pool;
  __pgDb?: DB;
  __pgConnected?: boolean;
}

const g = globalThis as unknown as PgGlobal;

function createPool(): Pool {
  const p = new Pool({
    connectionString: config.POSTGRES_URI,
    max: config.POSTGRES_MAX_POOL_SIZE ?? 20,
    // Keep a few warm connections: the app's startup burst used to pay for
    // new TCP + auth handshakes after every 10s of quiet.
    min: 4,
    idleTimeoutMillis: 5 * 60_000,
    connectionTimeoutMillis: 5_000,
  });

  p.on('connect', () => {
    g.__pgConnected = true;
  });

  p.on('error', (err) => {
    console.error('❌ PostgreSQL pool error:', err.message);
    g.__pgConnected = false;
  });

  console.log('✅ PostgreSQL pool created (max=' + (config.POSTGRES_MAX_POOL_SIZE ?? 20) + ')');
  return p;
}

export function getDb(): DB {
  if (!g.__pgDb || !g.__pgPool) {
    g.__pgPool = createPool();
    g.__pgDb = drizzle(g.__pgPool, { schema });
  }
  return g.__pgDb;
}

// Lazy proxy so `import { db } from './postgres'` works without calling getDb() first
export const db = new Proxy({} as DB, {
  get(_target, prop) {
    return Reflect.get(getDb(), prop);
  },
});

export async function connectDB(): Promise<DB> {
  if (g.__pgConnected && g.__pgDb) {
    return g.__pgDb;
  }

  const database = getDb();

  try {
    const client = await g.__pgPool!.connect();
    await client.query('SELECT 1');
    client.release();
    g.__pgConnected = true;
    console.log('✅ PostgreSQL connected');
    return database;
  } catch (error) {
    console.error('❌ PostgreSQL connection error:', error);
    g.__pgConnected = false;
    throw error;
  }
}

export async function disconnectDB(): Promise<void> {
  if (g.__pgPool) {
    await g.__pgPool.end();
    g.__pgPool = undefined;
    g.__pgDb = undefined;
    g.__pgConnected = false;
    console.log('🔌 PostgreSQL disconnected');
  }
}

export async function getClient(): Promise<PoolClient> {
  if (!g.__pgPool) getDb();
  return g.__pgPool!.connect();
}

// Expose active connection count for diagnostics
export function getPoolStats() {
  if (!g.__pgPool) return { total: 0, idle: 0, waiting: 0 };
  return {
    total: g.__pgPool.totalCount,
    idle: g.__pgPool.idleCount,
    waiting: g.__pgPool.waitingCount,
  };
}

export { schema };

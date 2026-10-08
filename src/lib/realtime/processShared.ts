import { randomUUID } from 'crypto';

/**
 * Process-wide singletons for realtime state.
 *
 * server.ts imports the API modules through Bun, while every REST request is
 * handled by Next's own bundled copy of the same modules. Module-level state is
 * therefore duplicated: SSE streams register in server.ts's copy, but messages
 * are published from Next's copy. Keeping the connection maps on globalThis
 * gives both copies the same registry, so a publish reaches local streams
 * directly instead of depending on a Redis round-trip (which silently dropped
 * events whenever the publisher wasn't connected).
 */
const g = globalThis as unknown as { __serikaRealtime?: Map<string, unknown> };

export function processShared<T>(key: string, init: () => T): T {
  if (!g.__serikaRealtime) g.__serikaRealtime = new Map();
  if (!g.__serikaRealtime.has(key)) g.__serikaRealtime.set(key, init());
  return g.__serikaRealtime.get(key) as T;
}

/** One id per process, shared by every module copy, for Redis bridge de-duplication. */
export const PROCESS_INSTANCE_ID = processShared('instanceId', () => randomUUID());

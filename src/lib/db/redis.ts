import Redis from 'ioredis';
import { config } from '../config';

// ── Global singleton ────────────────────────────────────────────────────────
// Same pattern as postgres.ts: Next.js HMR creates new module instances on
// every reload, which would create duplicate Redis connections (3 per reload:
// main, publisher, subscriber). Storing on globalThis survives HMR.
interface RedisGlobal {
  __redis?: Redis;
  __redisSubscriber?: Redis;
  __redisPublisher?: Redis;
  __redisAvailable?: boolean;
}

const g = globalThis as unknown as RedisGlobal;

// Check if Redis is available
export function isRedisAvailable(): boolean {
  return g.__redisAvailable ?? false;
}

// Track whether we've logged the Redis-down warning to avoid spamming.
let redisDownWarned = false;

export function getRedis(): Redis | null {
  if (!config.REDIS_URL) {
    if (!redisDownWarned) {
      console.warn('⚠️ Redis URL not configured — caching, sessions, rate limiting, and SSE fan-out are ALL disabled. This will cause severe performance degradation.');
      redisDownWarned = true;
    }
    return null;
  }
  // Reset warning flag once Redis is configured so future disconnects can warn again.
  redisDownWarned = false;

  if (!g.__redis) {
    g.__redis = new Redis(config.REDIS_URL, {
      enableOfflineQueue: true,
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => {
        const delay = Math.min(times * 200, 2000);
        return delay;
      },
      lazyConnect: true,
      enableReadyCheck: true,
      connectTimeout: 5000,
      reconnectOnError: (err) => {
        const targetErrors = ['READONLY', 'ECONNRESET', 'ECONNREFUSED'];
        return targetErrors.some(e => err.message.includes(e));
      },
    });

    g.__redis.on('connect', () => {
      console.log('✅ Redis connected');
      g.__redisAvailable = true;
    });

    g.__redis.on('error', (err) => {
      console.error('❌ Redis error:', err.message);
      g.__redisAvailable = false;
    });

    g.__redis.on('close', () => {
      console.log('⚠️ Redis connection closed — will retry automatically');
      g.__redisAvailable = false;
    });

    g.__redis.connect().catch((err) => {
      console.warn('⚠️ Redis initial connection failed:', err.message);
      g.__redisAvailable = false;
    });
  }
  
  return g.__redis;
}

// For pub/sub - need separate connections
export function getPublisher(): Redis | null {
  if (!config.REDIS_URL || !g.__redisAvailable) return null;

  if (!g.__redisPublisher) {
    g.__redisPublisher = new Redis(config.REDIS_URL, {
      enableOfflineQueue: true,
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => Math.min(times * 200, 2000),
      lazyConnect: true,
      connectTimeout: 5000,
    });
    g.__redisPublisher.on('error', (err) => console.error('❌ Redis publisher error:', err.message));
    g.__redisPublisher.connect().catch(() => {});
  }
  return g.__redisPublisher;
}

export function getSubscriber(): Redis | null {
  if (!config.REDIS_URL || !g.__redisAvailable) return null;

  if (!g.__redisSubscriber) {
    g.__redisSubscriber = new Redis(config.REDIS_URL, {
      enableOfflineQueue: true,
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => Math.min(times * 200, 2000),
      lazyConnect: true,
      connectTimeout: 5000,
    });
    g.__redisSubscriber.on('error', (err) => console.error('❌ Redis subscriber error:', err.message));
    g.__redisSubscriber.connect().catch(() => {});
  }
  return g.__redisSubscriber;
}

// Cache utilities
export class CacheService {
  private defaultTTL: number = 300; // 5 minutes

  private get redis(): Redis | null {
    return getRedis();
  }

  async get<T>(key: string): Promise<T | null> {
    if (!this.redis) return null;
    try {
      const data = await this.redis.get(key);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      console.error('Cache get error:', error);
      return null;
    }
  }

  async set(key: string, value: unknown, ttl?: number): Promise<void> {
    if (!this.redis) return;
    try {
      const serialized = JSON.stringify(value);
      if (ttl) {
        await this.redis.setex(key, ttl, serialized);
      } else {
        await this.redis.setex(key, this.defaultTTL, serialized);
      }
    } catch (error) {
      console.error('Cache set error:', error);
    }
  }

  async del(key: string): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.del(key);
    } catch (error) {
      console.error('Cache delete error:', error);
    }
  }

  async delPattern(pattern: string): Promise<void> {
    if (!this.redis) return;
    try {
      // SCAN (cursor-based, non-blocking) instead of KEYS, which blocks the
      // single-threaded Redis server for the whole keyspace scan and can stall
      // every other command under load. Delete in batches as we go.
      let cursor = '0';
      do {
        const [next, keys] = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
        cursor = next;
        if (keys.length > 0) {
          await this.redis.del(...keys);
        }
      } while (cursor !== '0');
    } catch (error) {
      console.error('Cache delete pattern error:', error);
    }
  }

  // Session tracking — lets us revoke every session a user holds (e.g. on
  // suspension) without scanning the whole keyspace. Sessions are keyed by a
  // random id, so we keep a per-user index set of their live session ids.
  async trackUserSession(userId: string, sessionId: string, ttl: number): Promise<void> {
    if (!this.redis) return;
    try {
      const key = `user:sessions:${userId}`;
      await this.redis.sadd(key, sessionId);
      // Keep the index alive at least as long as the longest session.
      await this.redis.expire(key, ttl);
    } catch (error) {
      console.error('Cache trackUserSession error:', error);
    }
  }

  async untrackUserSession(userId: string, sessionId: string): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.srem(`user:sessions:${userId}`, sessionId);
    } catch (error) {
      console.error('Cache untrackUserSession error:', error);
    }
  }

  /** Delete every session for a user + their cached record. Returns count killed. */
  async revokeUserSessions(userId: string): Promise<number> {
    if (!this.redis) return 0;
    try {
      const key = `user:sessions:${userId}`;
      const sessionIds = await this.redis.smembers(key);
      if (sessionIds.length > 0) {
        await this.redis.del(...sessionIds.map((id) => `session:${id}`));
      }
      await this.redis.del(key);
      // Force the next request to re-read the (now banned) user from the DB.
      await this.redis.del(`user:${userId}`);
      return sessionIds.length;
    } catch (error) {
      console.error('Cache revokeUserSessions error:', error);
      return 0;
    }
  }

  // User presence
  async setUserOnline(userId: string, socketId: string): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.hset('user:presence', userId, JSON.stringify({
        status: 'online',
        socketId,
        lastSeen: Date.now(),
      }));
      await this.redis.sadd('online:users', userId);
    } catch (error) {
      console.error('Cache setUserOnline error:', error);
    }
  }

  async setUserOffline(userId: string): Promise<void> {
    if (!this.redis) return;
    try {
      const presence = await this.redis.hget('user:presence', userId);
      if (presence) {
        const data = JSON.parse(presence);
        await this.redis.hset('user:presence', userId, JSON.stringify({
          ...data,
          status: 'offline',
          lastSeen: Date.now(),
        }));
      }
      await this.redis.srem('online:users', userId);
    } catch (error) {
      console.error('Cache setUserOffline error:', error);
    }
  }

  async getUserPresence(userId: string): Promise<{ status: string; lastSeen: number } | null> {
    if (!this.redis) return null;
    try {
      const presence = await this.redis.hget('user:presence', userId);
      return presence ? JSON.parse(presence) : null;
    } catch (error) {
      console.error('Cache getUserPresence error:', error);
      return null;
    }
  }

  async getOnlineUsers(): Promise<string[]> {
    if (!this.redis) return [];
    try {
      return await this.redis.smembers('online:users');
    } catch (error) {
      console.error('Cache getOnlineUsers error:', error);
      return [];
    }
  }

  // Typing indicators
  async setTyping(channelId: string, userId: string): Promise<void> {
    if (!this.redis) return;
    try {
      const key = `typing:${channelId}`;
      await this.redis.hset(key, userId, Date.now().toString());
      await this.redis.expire(key, 10); // Expire after 10 seconds
    } catch (error) {
      console.error('Cache setTyping error:', error);
    }
  }

  async getTypingUsers(channelId: string): Promise<string[]> {
    if (!this.redis) return [];
    try {
      const key = `typing:${channelId}`;
      const typing = await this.redis.hgetall(key);
      const now = Date.now();
      const threshold = 8000; // 8 seconds
      
      return Object.entries(typing)
        .filter(([, timestamp]) => now - parseInt(timestamp) < threshold)
        .map(([userId]) => userId);
    } catch (error) {
      console.error('Cache getTypingUsers error:', error);
      return [];
    }
  }
}

export const cache = new CacheService();

export async function disconnectRedis(): Promise<void> {
  if (g.__redis) await g.__redis.quit();
  if (g.__redisSubscriber) await g.__redisSubscriber.quit();
  if (g.__redisPublisher) await g.__redisPublisher.quit();
  console.log('🔌 Redis connections closed');
}

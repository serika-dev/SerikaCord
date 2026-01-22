import Redis from 'ioredis';
import { config } from '../config';

let redis: Redis | null = null;
let subscriber: Redis | null = null;
let publisher: Redis | null = null;
let redisAvailable = false;

// Check if Redis is available
export function isRedisAvailable(): boolean {
  return redisAvailable;
}

export function getRedis(): Redis | null {
  if (!config.REDIS_URL) {
    console.warn('⚠️ Redis URL not configured - caching disabled');
    return null;
  }

  if (!redis) {
    redis = new Redis(config.REDIS_URL, {
      maxRetriesPerRequest: 1,
      retryStrategy: (times) => {
        if (times > 3) {
          console.warn('⚠️ Redis connection failed - caching disabled');
          redisAvailable = false;
          return null; // Stop retrying
        }
        return Math.min(times * 200, 1000);
      },
      lazyConnect: true,
      enableReadyCheck: true,
      connectTimeout: 5000,
      reconnectOnError: (err) => {
        const targetErrors = ['READONLY', 'ECONNRESET', 'ECONNREFUSED'];
        return targetErrors.some(e => err.message.includes(e));
      },
    });

    redis.on('connect', () => {
      console.log('✅ Redis connected');
      redisAvailable = true;
    });

    redis.on('error', (err) => {
      console.error('❌ Redis error:', err.message);
      redisAvailable = false;
    });

    redis.on('close', () => {
      console.log('⚠️ Redis connection closed');
      redisAvailable = false;
    });

    // Try to connect but don't block
    redis.connect().catch((err) => {
      console.warn('⚠️ Redis initial connection failed:', err.message);
      redisAvailable = false;
    });
  }
  
  return redisAvailable ? redis : null;
}

// For pub/sub - need separate connections
export function getPublisher(): Redis | null {
  if (!config.REDIS_URL || !redisAvailable) return null;

  if (!publisher) {
    publisher = new Redis(config.REDIS_URL, {
      maxRetriesPerRequest: 1,
      lazyConnect: true,
      connectTimeout: 5000,
    });
    publisher.on('error', (err) => console.error('❌ Redis publisher error:', err.message));
    publisher.connect().catch(() => {});
  }
  return publisher;
}

export function getSubscriber(): Redis | null {
  if (!config.REDIS_URL || !redisAvailable) return null;

  if (!subscriber) {
    subscriber = new Redis(config.REDIS_URL, {
      maxRetriesPerRequest: 1,
      lazyConnect: true,
      connectTimeout: 5000,
    });
    subscriber.on('error', (err) => console.error('❌ Redis subscriber error:', err.message));
    subscriber.connect().catch(() => {});
  }
  return subscriber;
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
      const keys = await this.redis.keys(pattern);
      if (keys.length > 0) {
        await this.redis.del(...keys);
      }
    } catch (error) {
      console.error('Cache delete pattern error:', error);
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
  if (redis) await redis.quit();
  if (subscriber) await subscriber.quit();
  if (publisher) await publisher.quit();
  console.log('🔌 Redis connections closed');
}

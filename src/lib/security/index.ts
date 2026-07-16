import { RateLimiterRedis, RateLimiterMemory, RateLimiterRes } from 'rate-limiter-flexible';
import sanitizeHtml from 'sanitize-html';
import xss from 'xss';
import crypto from 'crypto';
import { getRedis } from '../db/redis';
import { config } from '../config';

// Rate limiter configurations
const rateLimiters: Map<string, RateLimiterRedis | RateLimiterMemory> = new Map();

export function getRateLimiter(
  key: string,
  options: { points: number; duration: number; blockDuration?: number }
): RateLimiterRedis | RateLimiterMemory {
  const redisClient = getRedis();
  
  if (redisClient) {
    const existing = rateLimiters.get(key);
    if (!existing || existing instanceof RateLimiterMemory) {
      rateLimiters.set(key, new RateLimiterRedis({
        storeClient: redisClient,
        keyPrefix: `rl:${key}`,
        points: options.points,
        duration: options.duration,
        blockDuration: options.blockDuration || 0,
      }));
    }
  } else {
    const existing = rateLimiters.get(key);
    if (!existing || existing instanceof RateLimiterRedis) {
      rateLimiters.set(key, new RateLimiterMemory({
        keyPrefix: `rl:${key}`,
        points: options.points,
        duration: options.duration,
        blockDuration: options.blockDuration || 0,
      }));
    }
  }
  return rateLimiters.get(key)!;
}

// Pre-configured rate limiters
export const rateLimiters_config = {
  // General API rate limit
  api: { points: 100, duration: 60 }, // 100 requests per minute
  
  // Authentication rate limits
  login: { points: 5, duration: 300, blockDuration: 900 }, // 5 attempts per 5 min, block 15 min
  register: { points: 3, duration: 3600 }, // 3 registrations per hour
  
  // Message rate limits
  message: { points: 10, duration: 10 }, // 10 messages per 10 seconds
  messageGlobal: { points: 50, duration: 60 }, // 50 messages per minute globally
  
  // Upload rate limits
  upload: { points: 10, duration: 60 }, // 10 uploads per minute
  
  // Invite rate limits
  invite: { points: 5, duration: 60 }, // 5 invite creations per minute
  
  // Server creation
  serverCreate: { points: 10, duration: 86400 }, // 10 servers per day
  
  // Friend requests
  friendRequest: { points: 20, duration: 86400 }, // 20 friend requests per day

  // Admin API (stricter)
  admin: { points: 60, duration: 60 }, // 60 admin requests per minute

  // Bug reports
  bugReport: { points: 5, duration: 600 }, // 5 bug reports / feedback every 10 minutes
} as const;

export async function checkRateLimit(
  limiterKey: keyof typeof rateLimiters_config,
  identifier: string
): Promise<{ success: boolean; retryAfter?: number; remaining?: number }> {
  const limiterConfig = rateLimiters_config[limiterKey];
  
  try {
    const limiter = getRateLimiter(limiterKey, limiterConfig);
    const result = await limiter.consume(identifier);
    return { 
      success: true, 
      remaining: result.remainingPoints 
    };
  } catch (error) {
    if (error instanceof RateLimiterRes) {
      return { 
        success: false, 
        retryAfter: Math.ceil(error.msBeforeNext / 1000),
        remaining: 0 
      };
    }
    
    // Redis connection error or general Redis command timeout - failover to memory rate limiting
    console.warn(`⚠️ Rate limiter Redis error, falling back to memory: ${error instanceof Error ? error.message : error}`);
    try {
      const fallbackLimiter = new RateLimiterMemory({
        keyPrefix: `rl-fallback:${limiterKey}`,
        points: limiterConfig.points,
        duration: limiterConfig.duration,
        blockDuration: (limiterConfig as { blockDuration?: number }).blockDuration || 0,
      });
      const result = await fallbackLimiter.consume(identifier);
      return {
        success: true,
        remaining: result.remainingPoints
      };
    } catch (memError) {
      if (memError instanceof RateLimiterRes) {
        return {
          success: false,
          retryAfter: Math.ceil(memError.msBeforeNext / 1000),
          remaining: 0
        };
      }
      // If memory rate limiting fails, default to allowing the action
      return { success: true, remaining: 1 };
    }
  }
}

// Input sanitization
const sanitizeOptions: sanitizeHtml.IOptions = {
  allowedTags: [], // No HTML tags allowed in messages
  allowedAttributes: {},
  disallowedTagsMode: 'recursiveEscape',
};

export function sanitizeInput(input: string): string {
  if (typeof input !== 'string') return '';
  
  // First, use xss to escape XSS vectors
  let sanitized = xss(input, {
    whiteList: {}, // No allowed tags
    stripIgnoreTag: true,
    stripIgnoreTagBody: ['script', 'style'],
  });
  
  // Then use sanitize-html for additional safety
  sanitized = sanitizeHtml(sanitized, sanitizeOptions);
  
  // Remove null bytes and other control characters (except newlines and tabs)
  sanitized = sanitized.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  
  // Normalize unicode to prevent homograph attacks
  sanitized = sanitized.normalize('NFC');
  
  return sanitized.trim();
}

// Validate and sanitize username
export function sanitizeUsername(username: string): string {
  // Remove any characters that aren't alphanumeric, underscore, or dash
  let sanitized = username.replace(/[^a-zA-Z0-9_-]/g, '');
  
  // Ensure it starts with a letter
  if (!/^[a-zA-Z]/.test(sanitized)) {
    sanitized = 'u' + sanitized;
  }
  
  // Truncate to max length
  return sanitized.slice(0, 32);
}

// Content validation
export function validateMessageContent(content: string): { valid: boolean; error?: string } {
  if (!content || content.length === 0 || content.trim().length === 0) {
    return { valid: false, error: 'Message content cannot be empty' };
  }
  
  if (content.length > config.MAX_MESSAGE_LENGTH) {
    return { valid: false, error: `Message too long (max ${config.MAX_MESSAGE_LENGTH} characters)` };
  }
  
  // Preserve Discord-style tokens (mentions, custom emojis, timestamps) before
  // running spam heuristics, so valid tokens like the system user ID don't
  // trigger the repeated-character check.
  const TOKEN_REGEX = /<@!?[0-9a-fA-F]{24}>|<@&[0-9a-fA-F]{24}>|<#[0-9a-fA-F]{24}>|<a?:[a-zA-Z0-9_]+:[0-9a-fA-F]{24}>|<t:[^>]+>/g;
  const contentWithoutTokens = content.replace(TOKEN_REGEX, ' ');

  // Check for spam patterns
  const spamPatterns = [
    /(.)\1{20,}/, // Repeated characters
    /(\s*\n){10,}/, // Many newlines
  ];
  
  for (const pattern of spamPatterns) {
    if (pattern.test(contentWithoutTokens)) {
      return { valid: false, error: 'Message contains spam-like content' };
    }
  }

  // Check for excessive URLs on the original content
  if (/(https?:\/\/[^\s]+\s*){10,}/.test(content)) {
    return { valid: false, error: 'Message contains spam-like content' };
  }

  return { valid: true };
}

// CSRF token generation and validation
const csrfTokens = new Map<string, { token: string; expires: number }>();

export function generateCSRFToken(sessionId: string): string {
  const token = crypto.randomBytes(32).toString('hex');
  csrfTokens.set(sessionId, {
    token,
    expires: Date.now() + 3600000, // 1 hour
  });
  return token;
}

export function validateCSRFToken(sessionId: string, token: string): boolean {
  const stored = csrfTokens.get(sessionId);
  if (!stored) return false;
  
  if (Date.now() > stored.expires) {
    csrfTokens.delete(sessionId);
    return false;
  }
  
  // Use timing-safe comparison
  const valid = crypto.timingSafeEqual(
    Buffer.from(stored.token),
    Buffer.from(token)
  );
  
  // Delete after use (one-time use tokens)
  if (valid) {
    csrfTokens.delete(sessionId);
  }
  
  return valid;
}

// Clean up expired CSRF tokens periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of csrfTokens.entries()) {
    if (now > value.expires) {
      csrfTokens.delete(key);
    }
  }
}, 60000); // Every minute

// Password validation
export function validatePassword(password: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  if (password.length < 8) {
    errors.push('Password must be at least 8 characters long');
  }
  
  if (password.length > 128) {
    errors.push('Password must be at most 128 characters long');
  }
  
  if (!/[a-z]/.test(password)) {
    errors.push('Password must contain at least one lowercase letter');
  }
  
  if (!/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter');
  }
  
  if (!/[0-9]/.test(password)) {
    errors.push('Password must contain at least one number');
  }
  
  // Check for common passwords (simplified list)
  const commonPasswords = [
    'password', '12345678', 'qwerty', 'admin', 'letmein',
    'welcome', 'monkey', 'dragon', 'master', 'abc123',
  ];
  
  if (commonPasswords.some(p => password.toLowerCase().includes(p))) {
    errors.push('Password is too common');
  }
  
  return { valid: errors.length === 0, errors };
}

// IP validation and extraction
export function getClientIP(request: Request): string {
  const headers = request.headers;
  
  // Cloudflare
  const cfConnectingIP = headers.get('cf-connecting-ip');
  if (cfConnectingIP) return cfConnectingIP;
  
  // Standard proxy headers
  const xForwardedFor = headers.get('x-forwarded-for');
  if (xForwardedFor) {
    // Take the first IP in the chain (original client)
    return xForwardedFor.split(',')[0].trim();
  }
  
  const xRealIP = headers.get('x-real-ip');
  if (xRealIP) return xRealIP;
  
  return 'unknown';
}

// Validate UUID format (PostgreSQL primary keys)
export function isValidObjectId(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

// Generate secure random tokens
export function generateSecureToken(length: number = 32): string {
  return crypto.randomBytes(length).toString('hex');
}

// Hash sensitive data
export function hashData(data: string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

// Timing-safe string comparison
export function secureCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

// Re-export encryption utilities
export { encryptMessage, decryptMessage, encryptForStorage, decryptFromStorage, isEncrypted } from './encryption';

// Route param names that must always be UUIDs. Composite ids like
// voice roomIds ("channel-<id>", "dm:<id>") are intentionally excluded.
const OBJECT_ID_PARAM_NAMES = new Set([
  'serverId', 'channelId', 'messageId', 'recipientId', 'userId',
  'roleId', 'stickerId', 'memberUserId', 'emojiId', 'soundId', 'experimentId',
]);

/**
 * Elysia beforeHandle guard: rejects requests whose UUID-typed route
 * params are malformed, so handlers never pass garbage to the database.
 */
export function rejectInvalidObjectIdParams({
  params,
  set,
}: {
  params?: Record<string, string | undefined>;
  set: { status?: number | string };
}): { error: string } | undefined {
  if (!params) return undefined;
  for (const [key, value] of Object.entries(params)) {
    if (OBJECT_ID_PARAM_NAMES.has(key) && typeof value === 'string' && !isValidObjectId(value)) {
      set.status = 400;
      return { error: 'Invalid ID format' };
    }
  }
  return undefined;
}

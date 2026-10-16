import { BOT_LIMITS, GATEWAY_LIMITS } from './botRateLimit';
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
  // General per-IP API budget (applied globally by rateLimitPlugin). Generous on
  // purpose: a busy client plus several users behind one NAT must never hit it.
  api: { points: 1200, duration: 60 },

  // Authentication rate limits
  login: { points: 10, duration: 300, blockDuration: 600 }, // per IP+email: 10 attempts / 5 min, then 10 min block
  loginIp: { points: 60, duration: 600 }, // per IP across all emails
  register: { points: 10, duration: 3600 }, // 10 registrations per IP per hour
  authEmail: { points: 5, duration: 900 }, // forgot-password / resend-verification, per IP and per email
  passwordReset: { points: 10, duration: 900 }, // reset-password submissions per IP
  qrCreate: { points: 60, duration: 600 }, // QR login codes per IP (the login page refreshes them every 2 min)
  // Serika Accounts sign-in hand-off ("Sign in with passkey"), per IP
  handoffStart: { points: 30, duration: 600 },
  handoffCallback: { points: 30, duration: 600 },

  // Incoming channel webhooks, per webhook
  webhookExecute: { points: 30, duration: 10 },
  // Interactions a user starts (slash commands, button clicks, select menus,
  // modal submits) and autocomplete requests while typing an option, per user.
  interactionCreate: { points: 20, duration: 10 },
  interactionAutocomplete: { points: 30, duration: 10 },
  // Interaction-token routes (callback, followups, @original), per interaction
  // and per application (they carry no bot token, so bot limits don't apply).
  interactionToken: { points: 5, duration: 2 },
  // Token routes of a channel webhook other than execute (GET / PATCH / DELETE,
  // message edit / delete), per webhook.
  webhookToken: { points: 30, duration: 10 },
  interactionApp: { points: 50, duration: 1 },
  // Saving an interactions endpoint sends a signed PING, per user.
  interactionsEndpointVerify: { points: 10, duration: 600 },
  // OAuth2 token + revoke endpoints, per IP (client secrets are guessed here).
  oauthToken: { points: 30, duration: 60 },
  // Bot profile edits (PATCH /users/@me): Discord allows 2 username changes
  // per hour; avatar / banner changes get a slightly larger budget.
  botUsernameChange: { points: 2, duration: 3600 },
  botProfileImage: { points: 10, duration: 3600 },
  // /cdn-compat lookups that miss the hash cache (DB reads), per IP.
  cdnCompat: { points: 300, duration: 60 },

  // Bot API (/api/v10), per bot: see src/lib/security/botRateLimit.ts
  ...BOT_LIMITS,
  // Bot gateway IDENTIFY, per bot
  ...GATEWAY_LIMITS,

  // Fish Audio TTS proxy (paid API), per user
  ttsFish: { points: 30, duration: 60 },
  
  // Message rate limits
  message: { points: 10, duration: 10 }, // 10 messages per 10 seconds
  messageGlobal: { points: 50, duration: 60 }, // 50 messages per minute globally
  typing: { points: 30, duration: 10 }, // typing pings: generous, just stops loops

  // Message search (server / DM / channel), per user. Each query decrypts a page.
  search: { points: 40, duration: 60 },
  reactionManage: { points: 30, duration: 60 }, // moderators removing others' reactions
  
  // Upload rate limits
  upload: { points: 10, duration: 60 }, // 10 uploads per minute
  
  // Invite rate limits
  invite: { points: 5, duration: 60 }, // 5 invite creations per minute
  
  // Server creation
  serverCreate: { points: 10, duration: 86400 }, // 10 servers per day
  
  // Friend requests
  friendRequest: { points: 20, duration: 86400 }, // 20 friend requests per day

  // Group DMs
  groupDmCreate: { points: 10, duration: 3600 }, // 10 new groups per hour
  groupDmManage: { points: 30, duration: 60 }, // renames / member changes per minute

  // Admin API (stricter)
  admin: { points: 60, duration: 60 }, // 60 admin requests per minute

  // Bug reports
  bugReport: { points: 5, duration: 600 }, // 5 bug reports / feedback every 10 minutes

  // Mobile push device registration / app foreground-background state, per user
  pushDevice: { points: 30, duration: 600 },
  pushState: { points: 120, duration: 600 },

  // Voice moderation (server mute/deafen, move, disconnect), per moderator
  voiceModeration: { points: 60, duration: 60 },
  // Private user notes (autosaved while typing), per user
  userNote: { points: 60, duration: 60 },
  // Message request accept / ignore, per user
  messageRequest: { points: 60, duration: 60 },
  // Changing another member's nickname, per user
  memberNickname: { points: 30, duration: 60 },
  // Scheduled events: create / edit / cancel / interested, per user
  scheduledEvent: { points: 30, duration: 60 },
  // Announcement channels: publishing to followers, per channel (Discord: 10/hour)
  crosspost: { points: 10, duration: 3600 },
  // Following / unfollowing announcement channels, per user
  channelFollow: { points: 20, duration: 600 },
  // Domain connections: DNS TXT lookups per user
  domainVerify: { points: 10, duration: 300 },
  // Server-owned connections: adding domains / starting OAuth links, per owner
  serverConnection: { points: 20, duration: 600 },
  // Website favicons fetched from the linked site (cache misses only), per IP
  faviconFetch: { points: 30, duration: 60 },
  // Rules screening submissions with manual approval, per member per server
  screeningSubmit: { points: 5, duration: 600 },
  // Onboarding picks (each rewrite touches roles + the audit log)
  onboardingResponse: { points: 10, duration: 600 },
  // Account Standing appeals, per user
  appeal: { points: 5, duration: 86400 },
  // End-to-end encryption (per user): public key lookups (opening DMs, calls),
  // key/device/backup writes, and enabling encryption on a conversation
  e2eeRead: { points: 240, duration: 60 },
  e2eeWrite: { points: 20, duration: 600 },
  e2eeEnable: { points: 10, duration: 600 },
  e2eeBlob: { points: 600, duration: 60 }, // encrypted attachment relay (viewing media)
  // Device linking sessions (create / join / reveal / send / finish), per user
  e2eeLink: { points: 60, duration: 600 },
  // PIN unlock attempts (per user and per IP; the server also destroys the PIN
  // backup after 10 wrong PINs in total)
  e2eePin: { points: 5, duration: 60 },
} as const;

export async function checkRateLimit(
  limiterKey: keyof typeof rateLimiters_config,
  identifier: string
): Promise<{ success: boolean; retryAfter?: number; remaining?: number; resetAfterMs?: number }> {
  const limiterConfig = rateLimiters_config[limiterKey];
  
  try {
    const limiter = getRateLimiter(limiterKey, limiterConfig);
    const result = await limiter.consume(identifier);
    return { 
      success: true, 
      remaining: result.remainingPoints,
      resetAfterMs: result.msBeforeNext,
    };
  } catch (error) {
    if (error instanceof RateLimiterRes) {
      return { 
        success: false, 
        retryAfter: Math.ceil(error.msBeforeNext / 1000),
        remaining: 0,
        resetAfterMs: error.msBeforeNext,
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
  
  return pickClientIpFromHeaders(
    headers.get('x-forwarded-for'),
    headers.get('x-real-ip'),
  );
}

/**
 * X-Forwarded-For entries left of our own proxy's hop are client-supplied and
 * trivially spoofed, so only the right-most entry (appended by the reverse
 * proxy in front of us) is trusted. Exported for tests.
 */
export function pickClientIpFromHeaders(xForwardedFor: string | null, xRealIP: string | null): string {
  if (xForwardedFor) {
    const hops = xForwardedFor.split(',').map((h) => h.trim()).filter(Boolean);
    const last = hops[hops.length - 1];
    if (last) return last;
  }
  if (xRealIP && xRealIP.trim()) return xRealIP.trim();
  return 'unknown';
}

/**
 * Paths the global per-IP API budget skips: long-lived streams, health and
 * presence/voice polling (heavy but cheap), admin tooling, and bot-token
 * traffic (bots are many requests from one host and authenticate per call).
 * `path` is the request pathname, with or without the `/api` prefix.
 */
export function isGlobalRateLimitExempt(path: string, authorization?: string | null): boolean {
  const p = path.startsWith('/api/') ? path.slice(4) : path === '/api' ? '/' : path;
  if (p.endsWith('/stream')) return true;
  if (
    p === '/health' ||
    p === '/version' ||
    p === '/users/@me/activity' ||
    p === '/users/activity/batch' ||
    p === '/voice/states'
  ) return true;
  if (p === '/admin' || p.startsWith('/admin/')) return true;
  if (p.startsWith('/internal/')) return true;
  // Bot-token requests are NOT exempt here: the API's rate-limit plugin skips
  // the per-IP budget only for /api/v10 (v9) requests whose bot token is valid
  // (botApiTokenFromRequest + a token lookup), and the bot API applies its own
  // per-bot limits. A made-up "Bot x" header no longer bypasses anything.
  void authorization;
  return false;
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
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  // Byte lengths: equal-length strings with multi-byte characters must not throw.
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
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

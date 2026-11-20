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

  // Client mod reports (src/lib/api/clientIntegrity.ts), per user.
  clientIntegrity: { points: 10, duration: 3600 },
  // CSP violation reports (src/lib/api/cspReport.ts), per IP.
  cspReport: { points: 60, duration: 60 },

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
  // Linking a Discord bot to an application (each attempt calls Discord), per application.
  discordBotLink: { points: 5, duration: 3600 },
  // OAuth2 token + revoke endpoints, per IP (client secrets are guessed here).
  oauthToken: { points: 30, duration: 60 },
  // OAuth2 consent approvals (each issues a code / token), per user.
  oauthAuthorize: { points: 30, duration: 600 },
  // Public App Directory reads (/api/apps/directory*), per IP.
  appDirectory: { points: 120, duration: 60 },
  // Server integrations (YouTube / Twitch): latest-item previews and test
  // notifications, per user (each one may call YouTube / Twitch).
  integrationPreview: { points: 30, duration: 60 },
  integrationTest: { points: 5, duration: 60 },
  // Owner App Directory edits, cover uploads and verification applications, per user.
  appDirectoryEdit: { points: 30, duration: 600 },
  // Developer portal Activities settings saves (CORD-92), per user.
  activitySettingsEdit: { points: 30, duration: 600 },
  // Activities proxy (<client_id>.<ACTIVITIES_DOMAIN>), per client IP + app: page
  // loads, assets and API calls through URL mappings.
  activityProxy: { points: 1200, duration: 60 },
  // Launching / joining Activities, per user.
  activityLaunch: { points: 20, duration: 60 },
  // SDK commands that reach the server (authorize, participants, setActivity...), per user.
  activityRpc: { points: 300, duration: 60 },
  // Frame heartbeats, per user (one per open frame every 20 s, with headroom).
  activityHeartbeat: { points: 60, duration: 60 },
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
  reactionAdd: { points: 30, duration: 10 }, // adding reactions (channels, DMs, group DMs), per user
  messageEdit: { points: 20, duration: 10 }, // editing messages, per user
  // Profile writes (PUT / POST /users/me): each one fans presence out to friends and bots.
  profileUpdate: { points: 30, duration: 60 },
  richPresence: { points: 30, duration: 60 }, // rich presence (game activity) updates, per user
  soundboard: { points: 5, duration: 10 }, // soundboard plays in a call, per user
  voiceState: { points: 60, duration: 10 }, // voice join / state / speaking updates, per user
  voiceSfu: { points: 120, duration: 10 }, // SFU session / publish / pull / renegotiate calls, per user
  voiceToken: { points: 20, duration: 60 }, // TURN credential mints, per user
  voiceSpeaking: { points: 120, duration: 10 }, // speaking indicator broadcasts, per user
  callRing: { points: 1, duration: 10 }, // DM call rings, per caller+callee pair
  dmPin: { points: 20, duration: 60 }, // pinning / unpinning DM messages, per user
  oembed: { points: 60, duration: 60 }, // link-preview fetches, per user
  oembedMedia: { points: 120, duration: 60 }, // twimg media proxy, per IP
  instanceRegister: { points: 3, duration: 3600 }, // federated instance registrations, per IP
  audioUpload: { points: 10, duration: 60 }, // voice message / audio uploads, per user
  
  // Upload rate limits
  upload: { points: 10, duration: 60 }, // 10 uploads per minute
  // Fetching a GIF / the linked Discord avatar server-side for the image
  // picker (the bytes then go through a normal upload), per user
  mediaImport: { points: 20, duration: 60 },
  // Reusing / removing a recent avatar or banner, per user
  recentMedia: { points: 30, duration: 60 },
  
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
  // Saving your own server profile (PATCH /servers/:id/members/@me), per user
  memberProfile: { points: 30, duration: 60 },
  // Linked roles edits (each may update every holder of the role), per user
  roleLinks: { points: 20, duration: 60 },
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
  // Discord bridge settings (link, channel mapping, repair, test), per user
  discordBridge: { points: 60, duration: 60 },
  // Discord bridge calls that fan out to Discord with the shared bot (guild
  // list, fresh channel list, webhook check, bulk mapping, sync); each is
  // checked per user AND per server
  discordBridgeHeavy: { points: 5, duration: 60 },
  // Website favicons fetched from the linked site (cache misses only), per IP
  faviconFetch: { points: 30, duration: 60 },
  // Rules screening submissions with manual approval, per member per server
  screeningSubmit: { points: 5, duration: 600 },
  // Onboarding picks (each rewrite touches roles + the audit log). Channels &
  // Roles saves on click (debounced client-side), so allow a few dozen.
  onboardingResponse: { points: 30, duration: 600 },
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
  const TOKEN_REGEX = /<@[!&]?[0-9a-fA-F-]{24,36}>|<#[0-9a-fA-F-]{24,36}>|<a?:[A-Za-z0-9_-]{1,32}:(?:[0-9a-fA-F-]{24,36}|\d{15,21})>|<t:[^>]+>/g;
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
  return pickClientIpFromRequestHeaders(
    headers.get('cf-connecting-ip'),
    headers.get('x-forwarded-for'),
    headers.get('x-real-ip'),
  );
}

/**
 * Cloudflare → Traefik → Bun. CF-Connecting-IP is only trusted when the hop
 * that connected to our proxy (the right-most X-Forwarded-For entry, or
 * X-Real-IP when there is no XFF) is a Cloudflare edge; anyone hitting the
 * origin directly could otherwise pick their own IP. Exported for tests.
 */
export function pickClientIpFromRequestHeaders(
  cfConnectingIP: string | null,
  xForwardedFor: string | null,
  xRealIP: string | null,
): string {
  const peer = pickClientIpFromHeaders(xForwardedFor, xRealIP);
  const cf = cfConnectingIP?.trim();
  if (cf && peer !== 'unknown' && isCloudflareIP(peer) && parseIP(cf)) return cf;
  return peer;
}

// https://www.cloudflare.com/ips/ (ips-v4 / ips-v6).
export const CLOUDFLARE_IP_RANGES: readonly string[] = [
  '173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22',
  '141.101.64.0/18', '108.162.192.0/18', '190.93.240.0/20', '188.114.96.0/20',
  '197.234.240.0/22', '198.41.128.0/17', '162.158.0.0/15', '104.16.0.0/13',
  '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22',
  '2400:cb00::/32', '2606:4700::/32', '2803:f800::/32', '2405:b500::/32',
  '2405:8100::/32', '2a06:98c0::/29', '2c0f:f248::/32',
];

type ParsedIP = { v: 4 | 6; n: bigint };

function parseIPv4(s: string): bigint | null {
  const parts = s.split('.');
  if (parts.length !== 4) return null;
  let n = BigInt(0);
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const o = Number(p);
    if (o > 255) return null;
    n = (n << BigInt(8)) | BigInt(o);
  }
  return n;
}

function parseIPv6(s: string): bigint | null {
  let str = s;
  // Embedded IPv4 tail (::ffff:1.2.3.4) → two hextets.
  const lastColon = str.lastIndexOf(':');
  if (str.includes('.', lastColon)) {
    const v4 = parseIPv4(str.slice(lastColon + 1));
    if (v4 === null) return null;
    str = `${str.slice(0, lastColon + 1)}${(v4 >> BigInt(16)).toString(16)}:${(v4 & BigInt(0xffff)).toString(16)}`;
  }
  const halves = str.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...tail];
  let n = BigInt(0);
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/i.test(g)) return null;
    n = (n << BigInt(16)) | BigInt(parseInt(g, 16));
  }
  return n;
}

/** Parses an IPv4 or IPv6 address (brackets and zone ids allowed); IPv4-mapped IPv6 becomes IPv4. */
export function parseIP(raw: string): ParsedIP | null {
  let s = raw.trim();
  if (s.startsWith('[') && s.endsWith(']')) s = s.slice(1, -1);
  const zone = s.indexOf('%');
  if (zone !== -1) s = s.slice(0, zone);
  if (!s) return null;
  if (!s.includes(':')) {
    const n = parseIPv4(s);
    return n === null ? null : { v: 4, n };
  }
  const n = parseIPv6(s);
  if (n === null) return null;
  if (n >> BigInt(32) === BigInt(0xffff)) return { v: 4, n: n & BigInt(0xffffffff) };
  return { v: 6, n };
}

/** Whether `ip` falls inside `cidr` (e.g. "10.0.0.0/8", "2606:4700::/32"). */
export function ipInCidr(ip: string, cidr: string): boolean {
  const slash = cidr.indexOf('/');
  if (slash === -1) return false;
  const net = parseIP(cidr.slice(0, slash));
  const addr = parseIP(ip);
  const bits = Number(cidr.slice(slash + 1));
  if (!net || !addr || net.v !== addr.v || !Number.isInteger(bits)) return false;
  const width = net.v === 4 ? 32 : 128;
  if (bits < 0 || bits > width) return false;
  const shift = BigInt(width - bits);
  return (addr.n >> shift) === (net.n >> shift);
}

// Extra peers allowed to vouch for CF-Connecting-IP (e.g. a cloudflared tunnel
// container), comma-separated CIDRs. Empty by default.
const EXTRA_CF_PEER_RANGES: readonly string[] = (process.env.TRUSTED_CF_PEER_CIDRS || '')
  .split(',').map((c) => c.trim()).filter(Boolean);

export function isCloudflareIP(ip: string): boolean {
  return CLOUDFLARE_IP_RANGES.some((cidr) => ipInCidr(ip, cidr))
    || EXTRA_CF_PEER_RANGES.some((cidr) => ipInCidr(ip, cidr));
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

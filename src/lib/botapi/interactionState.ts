/**
 * Interaction token state machine (Discord API v10).
 *
 *   created ──(initial callback within 3 s)──▶ acknowledged ──▶ followups / @original
 *      │                                            │             edits for 15 min
 *      └── no callback in 3 s: 10062 Unknown interaction
 *   second callback: 40060 Interaction has already been acknowledged
 *   token older than 15 min: 10015 Unknown Webhook (followups, @original)
 *
 * The state lives in Redis (`ix:t:<sha256(token)>`, TTL 15 min) so a bot can
 * answer on any instance and after a restart; the acknowledgement is claimed
 * with SET NX so two concurrent callbacks can't both win. Without Redis (local
 * dev, tests) an in-process map with the same semantics is used. Tokens are
 * stored hashed only. The pure checks below are unit-tested.
 */
import { createHash, randomBytes, timingSafeEqual } from 'crypto';

export const InteractionType = {
  PING: 1,
  APPLICATION_COMMAND: 2,
  MESSAGE_COMPONENT: 3,
  APPLICATION_COMMAND_AUTOCOMPLETE: 4,
  MODAL_SUBMIT: 5,
} as const;

export const CallbackType = {
  PONG: 1,
  CHANNEL_MESSAGE_WITH_SOURCE: 4,
  DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE: 5,
  DEFERRED_UPDATE_MESSAGE: 6,
  UPDATE_MESSAGE: 7,
  APPLICATION_COMMAND_AUTOCOMPLETE_RESULT: 8,
  MODAL: 9,
  PREMIUM_REQUIRED: 10,
  LAUNCH_ACTIVITY: 12,
} as const;

export const INTERACTION_TTL_MS = 15 * 60 * 1000;
/** Discord gives 3 s; a little slack for clock jitter between instances. */
export const ACK_DEADLINE_MS = 3000;
export const ACK_GRACE_MS = 500;

export interface InteractionState {
  id: string;
  type: number;
  applicationId: string;
  botId: string;
  channelId: string;
  guildId: string | null;
  invokerId: string;
  invokerName: string;
  /** Command name ("ping", or "group sub") for the "used /cmd" header. */
  commandName?: string;
  commandId?: string;
  commandType?: number;
  /** Message a component lives on (component interactions, modal submits from one). */
  sourceMessageId?: string | null;
  sourceEphemeral?: boolean;
  /** Autocomplete: type of the focused option (for the choice check). */
  focusedType?: number;
  createdAt: number;
}

/** What the initial callback set up, stored next to the state. */
export interface InteractionResponseState {
  type: number;
  /** The message the response created (4/5) or the source message (6/7). */
  messageId?: string | null;
  ephemeral?: boolean;
  /** Type 5 still shows "thinking…" until @original is edited. */
  loading?: boolean;
}

export type CheckResult = { ok: true } | { ok: false; status: number; code: number; message: string };

const UNKNOWN_INTERACTION: CheckResult = { ok: false, status: 404, code: 10062, message: 'Unknown interaction' };
const ALREADY_ACKED: CheckResult = { ok: false, status: 400, code: 40060, message: 'Interaction has already been acknowledged.' };

/** Callback types each interaction type accepts (Discord's table). */
const ALLOWED_CALLBACKS: Record<number, readonly number[]> = {
  [InteractionType.PING]: [CallbackType.PONG],
  [InteractionType.APPLICATION_COMMAND]: [CallbackType.CHANNEL_MESSAGE_WITH_SOURCE, CallbackType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE, CallbackType.MODAL],
  [InteractionType.MESSAGE_COMPONENT]: [
    CallbackType.CHANNEL_MESSAGE_WITH_SOURCE, CallbackType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
    CallbackType.DEFERRED_UPDATE_MESSAGE, CallbackType.UPDATE_MESSAGE, CallbackType.MODAL,
  ],
  [InteractionType.APPLICATION_COMMAND_AUTOCOMPLETE]: [CallbackType.APPLICATION_COMMAND_AUTOCOMPLETE_RESULT],
  [InteractionType.MODAL_SUBMIT]: [
    CallbackType.CHANNEL_MESSAGE_WITH_SOURCE, CallbackType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
    CallbackType.DEFERRED_UPDATE_MESSAGE, CallbackType.UPDATE_MESSAGE,
  ],
};

/**
 * May this callback be the initial response? (deadline, single ack, type
 * allowed for this interaction). `acked` = someone already claimed the ack.
 */
export function checkInitialCallback(state: InteractionState, callbackType: unknown, acked: boolean, now: number = Date.now()): CheckResult {
  if (now - state.createdAt > ACK_DEADLINE_MS + ACK_GRACE_MS) return UNKNOWN_INTERACTION;
  if (acked) return ALREADY_ACKED;
  if (callbackType === CallbackType.PREMIUM_REQUIRED) {
    return { ok: false, status: 400, code: 50035, message: 'Invalid Form Body (type: PREMIUM_REQUIRED is deprecated and not supported)' };
  }
  if (callbackType === CallbackType.LAUNCH_ACTIVITY) {
    return { ok: false, status: 400, code: 50035, message: 'Invalid Form Body (type: activities are not supported on SerikaCord)' };
  }
  if (typeof callbackType !== 'number' || !Number.isInteger(callbackType)) {
    return { ok: false, status: 400, code: 50035, message: 'Invalid Form Body (type: This field is required)' };
  }
  const allowed = ALLOWED_CALLBACKS[state.type] ?? [];
  if (!allowed.includes(callbackType)) {
    return { ok: false, status: 400, code: 50035, message: `Invalid Form Body (type: callback ${callbackType} is not valid for interaction type ${state.type})` };
  }
  // 6 / 7 only make sense when there is a message to update.
  if ((callbackType === CallbackType.DEFERRED_UPDATE_MESSAGE || callbackType === CallbackType.UPDATE_MESSAGE) && !state.sourceMessageId) {
    return { ok: false, status: 400, code: 50035, message: 'Invalid Form Body (type: there is no message to update)' };
  }
  return { ok: true };
}

/** May the token still be used for followups / @original (15 minutes)? */
export function checkTokenAlive(state: InteractionState | null, now: number = Date.now()): CheckResult {
  if (!state || now - state.createdAt > INTERACTION_TTL_MS) {
    return { ok: false, status: 404, code: 10015, message: 'Unknown Webhook' };
  }
  return { ok: true };
}

// ─── Tokens ─────────────────────────────────────────────────

/** A new interaction token: "aW50ZXJhY3Rpb246" (base64 "interaction:") + 64 random bytes. */
export function newInteractionToken(): string {
  return `aW50ZXJhY3Rpb246${randomBytes(64).toString('base64url')}`;
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Constant-time string compare (equal length check first leaks only length). */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** Plausible token shape: bounded length, URL-safe characters only. */
export function isTokenShaped(token: unknown): token is string {
  return typeof token === 'string' && token.length >= 16 && token.length <= 512 && /^[A-Za-z0-9._-]+$/.test(token);
}

// ─── Storage ────────────────────────────────────────────────

export interface InteractionKV {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlMs: number): Promise<void>;
  /** Set only when absent; true when this call set it. */
  setNX(key: string, value: string, ttlMs: number): Promise<boolean>;
  del(key: string): Promise<void>;
}

/** In-process KV with TTLs (tests, and the fallback without Redis). */
export function memoryKV(maxEntries = 20_000): InteractionKV {
  const map = new Map<string, { v: string; exp: number }>();
  const live = (key: string) => {
    const hit = map.get(key);
    if (!hit) return null;
    if (Date.now() > hit.exp) { map.delete(key); return null; }
    return hit;
  };
  const put = (key: string, v: string, ttlMs: number) => {
    map.delete(key);
    map.set(key, { v, exp: Date.now() + ttlMs });
    while (map.size > maxEntries) {
      const oldest = map.keys().next().value;
      if (oldest === undefined) break;
      map.delete(oldest);
    }
  };
  return {
    async get(key) { return live(key)?.v ?? null; },
    async set(key, value, ttlMs) { put(key, value, ttlMs); },
    async setNX(key, value, ttlMs) {
      if (live(key)) return false;
      put(key, value, ttlMs);
      return true;
    },
    async del(key) { map.delete(key); },
  };
}

const K = {
  state: (tokenHash: string) => `ix:t:${tokenHash}`,
  byId: (id: string) => `ix:id:${id}`,
  ack: (id: string) => `ix:ack:${id}`,
  response: (id: string) => `ix:r:${id}`,
  autocomplete: (id: string) => `ix:ac:${id}`,
};

/** Interaction state store over a KV (Redis in production). */
export class InteractionStore {
  constructor(private readonly kv: InteractionKV) {}

  async create(token: string, state: InteractionState): Promise<void> {
    const h = hashToken(token);
    await this.kv.set(K.state(h), JSON.stringify(state), INTERACTION_TTL_MS);
    await this.kv.set(K.byId(state.id), h, INTERACTION_TTL_MS);
  }

  async getByToken(token: string): Promise<InteractionState | null> {
    if (!isTokenShaped(token)) return null;
    const raw = await this.kv.get(K.state(hashToken(token)));
    if (!raw) return null;
    try {
      const state = JSON.parse(raw) as InteractionState;
      return checkTokenAlive(state).ok ? state : null;
    } catch {
      return null;
    }
  }

  /** Claim the single initial acknowledgement. False when it was already claimed. */
  async claimAck(id: string, callbackType: number): Promise<boolean> {
    return this.kv.setNX(K.ack(id), String(callbackType), INTERACTION_TTL_MS);
  }

  async isAcked(id: string): Promise<boolean> {
    return (await this.kv.get(K.ack(id))) !== null;
  }

  /** Undo a claim when applying the response failed before anything was shown. */
  async releaseAck(id: string): Promise<void> {
    await this.kv.del(K.ack(id));
  }

  async setResponse(id: string, response: InteractionResponseState): Promise<void> {
    await this.kv.set(K.response(id), JSON.stringify(response), INTERACTION_TTL_MS);
  }

  async getResponse(id: string): Promise<InteractionResponseState | null> {
    const raw = await this.kv.get(K.response(id));
    if (!raw) return null;
    try { return JSON.parse(raw) as InteractionResponseState; } catch { return null; }
  }

  /** Autocomplete results waiting for the user's request (short-lived). */
  async setAutocomplete(id: string, choices: unknown[]): Promise<void> {
    await this.kv.set(K.autocomplete(id), JSON.stringify(choices), 30_000);
  }

  async takeAutocomplete(id: string): Promise<unknown[] | null> {
    const raw = await this.kv.get(K.autocomplete(id));
    if (!raw) return null;
    await this.kv.del(K.autocomplete(id));
    try { return JSON.parse(raw) as unknown[]; } catch { return null; }
  }

  /** Generic JSON record under a namespaced key (ephemeral messages, open modals). */
  async putRecord<T>(kind: 'eph' | 'modal', id: string, value: T, ttlMs: number = INTERACTION_TTL_MS): Promise<void> {
    await this.kv.set(`ix:${kind}:${id}`, JSON.stringify(value), ttlMs);
  }

  async getRecord<T>(kind: 'eph' | 'modal', id: string): Promise<T | null> {
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) return null;
    const raw = await this.kv.get(`ix:${kind}:${id}`);
    if (!raw) return null;
    try { return JSON.parse(raw) as T; } catch { return null; }
  }

  async deleteRecord(kind: 'eph' | 'modal', id: string): Promise<void> {
    await this.kv.del(`ix:${kind}:${id}`);
  }

  /** Claim a one-shot record (a modal can be submitted once). */
  async claimOnce(kind: 'modal', id: string): Promise<boolean> {
    return this.kv.setNX(`ix:${kind}-used:${id}`, '1', INTERACTION_TTL_MS);
  }
}

// Retrying encrypted messages that couldn't be decrypted (pure, isomorphic,
// tested in tests/e2ee-decrypt-retry.test.ts). See docs/architecture/e2ee.md
// "Failures and retries".
//
// A decryption can fail for a moment and work a second later: the key set
// fetch hit a network blip / 401 during a token refresh / 429, the message
// arrived before the conversation's facts were loaded, a contact's new device
// wasn't in the cached key set yet, or the engine threw. Those are retried
// with a short backoff (the message shows "Decrypting…" meanwhile) and again
// whenever keys change, the tab comes back or the stream reconnects. Real
// failures (bad ciphertext, wrong signature, not encrypted for this device)
// are shown at once, with "Try again". No failure is ever remembered for
// good: only successes are cached; a permanent failure is kept for a minute
// at most.

/** Failures that may go away on their own (keys loading or unreachable, unknown sender device, an engine error). */
const TRANSIENT = new Set(["not_ready", "keys_unavailable", "unknown_device", "temporary"]);

export function isTransientDecryptFailure(reason: string | null | undefined): boolean {
  return typeof reason === "string" && TRANSIENT.has(reason);
}

/**
 * Whether a failure may be remembered for a while. Transient ones never are,
 * nor "restore" (keys can arrive any moment through a restore or a link).
 */
export function isMemoizableDecryptFailure(reason: string | null | undefined): boolean {
  return !isTransientDecryptFailure(reason) && reason !== "restore";
}

/** Waits before the 1st, 2nd and 3rd automatic retry: three tries over about 10 s. */
export const DECRYPT_RETRY_DELAYS_MS: readonly number[] = [1000, 3000, 6000];

/** How long a permanent failure is answered from memory before decrypting again. */
export const DECRYPT_FAILURE_TTL_MS = 60_000;

/** The wait before the next automatic retry after `attempts` retries, or null when they are used up. */
export function decryptRetryDelay(attempts: number): number | null {
  if (!Number.isFinite(attempts) || attempts < 0) return DECRYPT_RETRY_DELAYS_MS[0];
  return DECRYPT_RETRY_DELAYS_MS[Math.floor(attempts)] ?? null;
}

/** A message's e2ee state after a failed decryption (lib/chat/types MessageE2ee). */
export interface DecryptErrorState {
  status: "error";
  reason: string;
  /** The stored envelope (decrypt again from it). */
  envelope?: unknown;
  /** The attachment blobs stored on the row (payload files must be among them). */
  stored?: string[];
  /** Automatic retries done so far. */
  attempts: number;
  /** More automatic retries are coming: show "Decrypting…", not the error. */
  retrying: boolean;
}

/** The failure state for a message: transient failures keep retrying until the attempts run out. */
export function failureState(reason: string, envelope: unknown, stored?: string[] | null, attempts = 0): DecryptErrorState {
  const hasEnvelope = Boolean(envelope && typeof envelope === "object");
  return {
    status: "error",
    reason,
    ...(hasEnvelope ? { envelope } : {}),
    ...(stored && stored.length > 0 ? { stored: stored.slice() } : {}),
    attempts,
    retrying: hasEnvelope && isTransientDecryptFailure(reason) && decryptRetryDelay(attempts) !== null,
  };
}

type E2eeLike = { status?: unknown; reason?: unknown; envelope?: unknown; stored?: unknown; attempts?: unknown; retrying?: unknown } | null | undefined;

function storedOf(e2ee: E2eeLike): string[] | undefined {
  return Array.isArray(e2ee?.stored) ? (e2ee!.stored as unknown[]).filter((u): u is string => typeof u === "string") : undefined;
}

/**
 * The state after a retry. A success replaces the failure; another failure
 * counts one more attempt (or starts over when `reset`: keys changed, the
 * tab came back, "Try again").
 */
export function stateAfterRetry<S extends { status?: unknown }>(result: S, previous: E2eeLike, reset = false): S | DecryptErrorState {
  const r = result as E2eeLike;
  if (r?.status !== "error") return result;
  const before = typeof previous?.attempts === "number" ? previous.attempts : 0;
  return failureState(String(r.reason ?? "decrypt"), r.envelope ?? previous?.envelope, storedOf(r) ?? storedOf(previous), reset ? 0 : before + 1);
}

/** The envelope signature a state belongs to (an edit brings a new one). */
export function envelopeSigOf(e2ee: E2eeLike): string | null {
  const sig = (e2ee?.envelope as { sig?: unknown } | null | undefined)?.sig;
  return typeof sig === "string" ? sig : null;
}

type MessageLike = { id: string; e2ee?: E2eeLike; pending?: unknown };

export interface RetryFilter {
  /** Only failures that may go away on their own (tab back, reconnect, online). */
  transientOnly?: boolean;
  /** Only these message ids. */
  ids?: ReadonlySet<string> | null;
}

/** Whether a shown message is a failed decryption that can be tried again (it still has its envelope). */
export function isRetryableFailure(m: MessageLike, filter: RetryFilter = {}): boolean {
  const e = m.e2ee;
  if (!e || e.status !== "error" || !envelopeSigOf(e) || m.pending) return false;
  if (filter.ids && !filter.ids.has(m.id)) return false;
  if (filter.transientOnly && !isTransientDecryptFailure(typeof e.reason === "string" ? e.reason : null)) return false;
  return true;
}

/**
 * The raw row to decrypt a failed message again: its envelope back in
 * `e2ee` and the blobs stored on it as `attachments`.
 */
export function rawRowForRetry<M extends MessageLike>(m: M): Record<string, unknown> | null {
  const e = m.e2ee;
  if (!e || e.status !== "error" || !envelopeSigOf(e)) return null;
  return { ...(m as unknown as Record<string, unknown>), e2ee: e.envelope, attachments: (storedOf(e) ?? []).map((url) => ({ url })) };
}

/** Fields a decryption sets on a message (everything else may have changed meanwhile: reactions, pins…). */
const DECRYPTED_FIELDS = ["content", "attachments", "sticker", "mentionedUserIds", "referencedMessage", "e2ee"] as const;

type RefLike = { id?: unknown; content?: unknown; encrypted?: unknown; quotedBySender?: unknown } | null | undefined;

/**
 * Put retried messages into the shown list. A result only replaces a message
 * that still shows the same failed envelope (an edit or a fetch that arrived
 * meanwhile wins), and only the decrypted fields are taken. Replies quoting a
 * message that now decrypted get our own text. Returns `prev` when nothing
 * changed.
 */
export function applyRetriedMessages<M extends MessageLike & { content?: unknown; referencedMessage?: RefLike }>(prev: M[], results: M[]): M[] {
  if (results.length === 0) return prev;
  const byId = new Map(results.map((r) => [r.id, r]));
  const texts = new Map<string, string>();
  let changed = false;
  let next = prev.map((m) => {
    const r = byId.get(m.id);
    if (!r || m.e2ee?.status !== "error" || envelopeSigOf(m.e2ee) !== envelopeSigOf(r.e2ee)) return m;
    if (r.e2ee?.status === "ok" && typeof r.content === "string") texts.set(m.id.toLowerCase(), r.content);
    if (JSON.stringify(m.e2ee) === JSON.stringify(r.e2ee) && r.e2ee?.status !== "ok") return m;
    const merged = { ...m } as Record<string, unknown>;
    const src = r as unknown as Record<string, unknown>;
    for (const f of DECRYPTED_FIELDS) {
      if (f in src) merged[f] = src[f];
      else if (f !== "referencedMessage") delete merged[f];
    }
    changed = true;
    return merged as unknown as M;
  });
  if (texts.size > 0) {
    next = next.map((m) => {
      const ref = m.referencedMessage;
      if (!ref?.encrypted || ref.id === undefined) return m;
      const own = texts.get(String(ref.id).toLowerCase());
      if (own === undefined || (ref.content === own && !ref.quotedBySender)) return m;
      changed = true;
      return { ...m, referencedMessage: { ...ref, content: own, quotedBySender: false } };
    });
  }
  return changed ? next : prev;
}

/**
 * Decryption results by key: successes are kept (bounded, oldest first out),
 * a permanent failure for `failureTtlMs`, a transient one not at all (only
 * while it is in flight, so concurrent callers share it).
 */
export class DecryptMemo<R extends { ok: boolean; reason?: string }> {
  private readonly entries = new Map<string, { value: Promise<R>; expires: number }>();
  private readonly max: number;
  private readonly failureTtlMs: number;
  private readonly now: () => number;

  constructor(opts: { max?: number; failureTtlMs?: number; now?: () => number } = {}) {
    this.max = opts.max ?? 5000;
    this.failureTtlMs = opts.failureTtlMs ?? DECRYPT_FAILURE_TTL_MS;
    this.now = opts.now ?? Date.now;
  }

  get size(): number {
    return this.entries.size;
  }

  get(key: string): Promise<R> | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expires <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: Promise<R>): Promise<R> {
    this.entries.delete(key);
    while (this.entries.size >= this.max) this.entries.delete(this.entries.keys().next().value!);
    const entry = { value, expires: Number.POSITIVE_INFINITY };
    this.entries.set(key, entry);
    value.then(
      (r) => {
        if (this.entries.get(key) !== entry || r.ok) return;
        if (isMemoizableDecryptFailure(r.reason)) entry.expires = this.now() + this.failureTtlMs;
        else this.entries.delete(key);
      },
      () => {
        if (this.entries.get(key) === entry) this.entries.delete(key);
      },
    );
    return value;
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  /** Drop every entry whose key matches (a conversation's, a message's). */
  deleteWhere(match: (key: string) => boolean): void {
    for (const key of [...this.entries.keys()]) if (match(key)) this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }
}

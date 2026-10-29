"use client";

// Retries for end-to-end encrypted messages that couldn't be decrypted, in
// the shared chat engine (useChatSession: DMs and group DMs). Rules and
// state transitions are pure (lib/e2ee/decryptRetry.ts):
//
// - a transient failure (keys loading or unreachable, unknown sender device,
//   an engine error) is retried 3 times over ~10 s while the message shows
//   "Decrypting…"; only then does the error show;
// - every failure is tried again when keys change (`retryFailed`), when the
//   tab becomes visible, when the browser comes back online and when the
//   stream reconnects (transient ones only, with a fresh set of attempts);
// - "Try again" on a message (retryBus) reloads the keys it needs and
//   decrypts it again.
//
// Results only replace a message still showing the same failed envelope, and
// only its decrypted fields, so a retry never undoes an edit or a reaction
// that arrived meanwhile.
import { useCallback, useEffect, useRef, type Dispatch, type RefObject, type SetStateAction } from "react";
import { normalizeIncomingMessage, type RawMessagePayload } from "@/lib/chat/messages";
import type { ChatMessage } from "@/lib/chat/types";
import {
  applyRetriedMessages,
  decryptRetryDelay,
  envelopeSigOf,
  isRetryableFailure,
  stateAfterRetry,
  type RetryFilter,
} from "@/lib/e2ee/decryptRetry";
import { onDecryptRetryRequest } from "@/lib/e2ee/client/retryBus";

export interface RetryRun extends RetryFilter {
  /** Reload the keys first and ignore anything remembered ("Try again"). */
  fresh?: boolean;
  /** Start counting attempts again (keys changed, tab back, online, reconnect). */
  reset?: boolean;
}

interface Options<M extends ChatMessage> {
  enabled: boolean;
  messages: M[];
  messagesRef: RefObject<M[]>;
  setMessages: Dispatch<SetStateAction<M[]>>;
  /** Decrypt failed rows again for the open conversation (chatGlue.retryDecryptRows). */
  redecrypt: (rows: M[], fresh: boolean) => Promise<Array<Record<string, unknown>>>;
  /** The open conversation: results for another one are dropped. */
  contextKey: string | null;
}

export function useE2eeDecryptRetry<M extends ChatMessage>({ enabled, messages, messagesRef, setMessages, redecrypt, contextKey }: Options<M>) {
  const contextRef = useRef(contextKey);
  useEffect(() => { contextRef.current = contextKey; }, [contextKey]);
  const redecryptRef = useRef(redecrypt);
  useEffect(() => { redecryptRef.current = redecrypt; }, [redecrypt]);
  /** Messages being decrypted again right now (never twice at once). */
  const runningRef = useRef(new Set<string>());
  /** Automatic retries waiting, by message id. */
  const dueRef = useRef(new Map<string, { at: number; sig: string; attempts: number }>());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const run = useCallback(async (opts: RetryRun): Promise<void> => {
    const context = contextRef.current;
    const running = runningRef.current;
    const rows = (messagesRef.current ?? []).filter((m) => isRetryableFailure(m, opts) && !running.has(m.id));
    if (rows.length === 0) return;
    for (const m of rows) running.add(m.id);
    const before = new Map(rows.map((m) => [m.id, m.e2ee]));
    const reset = Boolean(opts.reset || opts.fresh);
    if (opts.fresh) {
      // "Try again" pressed: "Decrypting…" while it runs.
      setMessages((prev) => prev.map((m) => (before.has(m.id) && m.e2ee?.status === "error" && !m.e2ee.retrying ? { ...m, e2ee: { ...m.e2ee, retrying: true } } : m)));
    }
    let results: M[];
    try {
      const raw = await redecryptRef.current(rows, Boolean(opts.fresh));
      results = raw.map((r) => {
        const m = normalizeIncomingMessage<M>(r as RawMessagePayload);
        return { ...m, e2ee: m.e2ee ? stateAfterRetry(m.e2ee, before.get(m.id), reset) : m.e2ee } as M;
      });
    } catch {
      // The crypto module didn't load, …: one more attempt used.
      results = rows.map((m) => ({ ...m, e2ee: stateAfterRetry({ status: "error", reason: "temporary", envelope: m.e2ee?.envelope }, m.e2ee, reset) } as M));
    } finally {
      for (const m of rows) running.delete(m.id);
    }
    if (contextRef.current !== context) return;
    setMessages((prev) => applyRetriedMessages(prev, results));
  }, [messagesRef, setMessages]);

  const arm = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    const due = dueRef.current;
    if (due.size === 0) return;
    let first = Number.POSITIVE_INFINITY;
    for (const d of due.values()) first = Math.min(first, d.at);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      const now = Date.now();
      const ids = new Set<string>();
      for (const [id, d] of due) {
        if (d.at > now + 50) continue;
        ids.add(id);
        due.delete(id);
      }
      if (ids.size > 0) void run({ ids });
      arm();
    }, Math.max(0, first - Date.now()));
  }, [run]);

  // Schedule the next automatic retry of every message still "retrying".
  useEffect(() => {
    if (!enabled) return;
    const due = dueRef.current;
    const now = Date.now();
    const shown = new Set<string>();
    for (const m of messages) {
      const e = m.e2ee;
      const sig = envelopeSigOf(e);
      if (!e || e.status !== "error" || !e.retrying || !sig || runningRef.current.has(m.id)) continue;
      const attempts = e.attempts ?? 0;
      const delay = decryptRetryDelay(attempts);
      if (delay === null) continue;
      shown.add(m.id);
      const known = due.get(m.id);
      if (known && known.sig === sig && known.attempts === attempts) continue;
      due.set(m.id, { at: now + delay, sig, attempts });
    }
    for (const id of [...due.keys()]) if (!shown.has(id)) due.delete(id);
    arm();
  }, [enabled, messages, arm]);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  // "Try again" on a message of this chat.
  useEffect(() => {
    if (!enabled) return;
    return onDecryptRetryRequest((messageId) => {
      if (!(messagesRef.current ?? []).some((m) => m.id === messageId)) return;
      void run({ ids: new Set([messageId]), fresh: true });
    });
  }, [enabled, messagesRef, run]);

  // Back to the tab / back online: transient failures get a fresh set of tries.
  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    const again = () => {
      if (document.visibilityState === "hidden") return;
      void run({ transientOnly: true, reset: true });
    };
    document.addEventListener("visibilitychange", again);
    window.addEventListener("online", again);
    return () => {
      document.removeEventListener("visibilitychange", again);
      window.removeEventListener("online", again);
    };
  }, [enabled, run]);

  /** Decrypt failed messages again now (keys changed: everything; reconnect: `transientOnly`). */
  const retryFailed = useCallback((opts: RetryRun = {}) => {
    if (!enabled) return;
    void run({ reset: true, ...opts });
  }, [enabled, run]);

  return { retryFailed };
}

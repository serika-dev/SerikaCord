"use client";

/**
 * Resilient EventSource for the app-wide streams (activity, DM list).
 *
 * Mobile browsers freeze background tabs and often kill the TCP connection
 * underneath an EventSource without the page noticing: `readyState` stays
 * OPEN while nothing arrives, so messages, badges and notifications silently
 * stop until the OS finally reports the socket dead. This helper:
 *
 * - reconnects itself with exponential backoff after any error (the browser
 *   gives up for good after an HTTP error such as a 401 or 502);
 * - treats a stream that has been silent for `STREAM_STALE_MS` as dead (the
 *   servers send a ping every 15s) and replaces it;
 * - checks the stream the moment the page comes back (visibilitychange,
 *   pageshow, focus, online, Page Lifecycle `resume`) and reconnects at once
 *   instead of waiting out the backoff;
 * - tells the caller when it reopened after a drop (`onOpen({ reconnect })`)
 *   and when the page came back (`onResume`), so it can refetch what it
 *   missed.
 *
 * Mirrors `useChatStream` (the per-conversation streams).
 */

import { useEffect, useRef } from "react";

/** Server keepalive pings arrive every 15s; this much silence means dead. */
export const STREAM_STALE_MS = 45_000;
const WATCHDOG_INTERVAL_MS = 15_000;
const MAX_BACKOFF_MS = 30_000;

export interface StreamResumeInfo {
  /** The stream was dead or stale and is reconnecting (`onOpen` follows). */
  reconnecting: boolean;
  /** How long the page was hidden before this resume (0 if it wasn't). */
  hiddenForMs: number;
}

export interface ResilientStreamHandlers {
  /** Every parsed event except `connected` / `ping`. */
  // Event payloads vary by stream; consumers narrow what they use.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onMessage: (data: any) => void;
  /** The stream opened. `reconnect` is true for every open after the first. */
  onOpen?: (info: { reconnect: boolean }) => void;
  /** The page came back to the foreground or the network returned. */
  onResume?: (info: StreamResumeInfo) => void;
}

/**
 * Open `url` as a self-healing EventSource. Returns a dispose function; call
 * it from the effect cleanup.
 */
export function openResilientStream(
  url: string,
  handlers: ResilientStreamHandlers,
  options: { staleMs?: number } = {},
): () => void {
  const staleMs = options.staleMs ?? STREAM_STALE_MS;
  let source: EventSource | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let attempts = 0;
  let disposed = false;
  let hasConnected = false;
  let lastEventAt = Date.now();
  let hiddenAt = typeof document !== "undefined" && document.visibilityState === "hidden" ? Date.now() : 0;

  const connect = () => {
    if (disposed) return;
    source?.close();
    lastEventAt = Date.now();
    const es = new EventSource(url, { withCredentials: true });
    source = es;
    es.onopen = () => {
      if (source !== es) return;
      attempts = 0;
      lastEventAt = Date.now();
      const reconnect = hasConnected;
      hasConnected = true;
      handlers.onOpen?.({ reconnect });
    };
    es.onmessage = (event) => {
      if (source !== es) return;
      lastEventAt = Date.now();
      let data: { type?: unknown } | null = null;
      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }
      if (!data || typeof data !== "object") return;
      if (data.type === "connected" || data.type === "ping") return;
      handlers.onMessage(data);
    };
    es.onerror = () => {
      if (source !== es) return;
      // Retry ourselves: the browser's own retry stops after HTTP errors and
      // waits its own (long, on some phones) delay otherwise.
      es.close();
      if (disposed) return;
      const delay = Math.min(1000 * 2 ** attempts, MAX_BACKOFF_MS);
      attempts += 1;
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = setTimeout(connect, delay);
    };
  };

  const reconnectNow = () => {
    if (disposed) return;
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
    attempts = 0;
    connect();
  };

  const isDeadOrStale = () =>
    !source || source.readyState === EventSource.CLOSED || Date.now() - lastEventAt > staleMs;

  const revive = (fromNetwork = false) => {
    if (disposed) return;
    if (document.visibilityState !== "visible") {
      if (!hiddenAt) hiddenAt = Date.now();
      return;
    }
    const hiddenForMs = hiddenAt ? Date.now() - hiddenAt : 0;
    hiddenAt = 0;
    const reconnecting = isDeadOrStale();
    if (reconnecting) reconnectNow();
    // A plain window focus (alt-tab) with a healthy stream is not a resume.
    if (reconnecting || hiddenForMs > 0 || fromNetwork) handlers.onResume?.({ reconnecting, hiddenForMs });
  };
  const onVisible = () => revive();
  const onOnline = () => revive(true);

  // A half-open connection never errors: replace it once it goes silent.
  // Runs in background tabs too (desktop notifications depend on it).
  const watchdog = setInterval(() => {
    if (disposed || !source) return;
    if (source.readyState !== EventSource.CLOSED && Date.now() - lastEventAt > staleMs) reconnectNow();
  }, WATCHDOG_INTERVAL_MS);

  const onPageShow = (e: PageTransitionEvent) => {
    // Restored from the back/forward cache: the old connection is gone.
    if (e.persisted) reconnectNow();
    revive();
  };

  connect();
  document.addEventListener("visibilitychange", onVisible);
  document.addEventListener("resume", onVisible);
  window.addEventListener("pageshow", onPageShow);
  window.addEventListener("online", onOnline);
  window.addEventListener("focus", onVisible);

  return () => {
    disposed = true;
    clearInterval(watchdog);
    if (retryTimer) clearTimeout(retryTimer);
    document.removeEventListener("visibilitychange", onVisible);
    document.removeEventListener("resume", onVisible);
    window.removeEventListener("pageshow", onPageShow);
    window.removeEventListener("online", onOnline);
    window.removeEventListener("focus", onVisible);
    source?.close();
    source = null;
  };
}

/**
 * Hook form of `openResilientStream`: connected while `url` is non-null.
 * Handlers may change every render; the connection only restarts when the
 * URL does.
 */
export function useResilientStream(url: string | null, handlers: ResilientStreamHandlers): void {
  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  });
  useEffect(() => {
    if (!url) return;
    return openResilientStream(url, {
      onMessage: (data) => handlersRef.current.onMessage(data),
      onOpen: (info) => handlersRef.current.onOpen?.(info),
      onResume: (info) => handlersRef.current.onResume?.(info),
    });
  }, [url]);
}

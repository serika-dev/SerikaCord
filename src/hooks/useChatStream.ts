"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useGT } from "gt-next";

export interface ChatStreamEvent {
  type: string;
  // Event payloads vary by type; consumers narrow the fields they use.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

interface UseChatStreamOptions {
  /** SSE endpoint, e.g. `/api/channels/{id}/stream`. Pass null to disconnect. */
  url: string | null;
  /** Called for every event except connected/ping/typing (those are handled here). */
  onEvent: (event: ChatStreamEvent) => void;
  /** Username of the current user, filtered out of the typing list. */
  currentUsername?: string;
  /** Called when the stream comes back after a drop — refetch what was missed. */
  onReconnect?: () => void;
}

const TYPING_TIMEOUT_MS = 3500;
const MAX_BACKOFF_MS = 30000;
// The server pings every 15s. A stream that has been silent much longer than
// that is dead even if the browser hasn't noticed (sleep, proxy, NAT timeout).
const STALE_STREAM_MS = 45000;

/**
 * Shared SSE subscription for chat channels and DMs: manages the EventSource
 * lifecycle, exponential-backoff reconnection, and the typing indicator list.
 */
export function useChatStream({ url, onEvent, currentUsername, onReconnect }: UseChatStreamOptions) {
  const gt = useGT();
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const typingTimeoutsRef = useRef<Record<string, NodeJS.Timeout>>({});
  const onEventRef = useRef(onEvent);
  const onReconnectRef = useRef(onReconnect);
  const currentUsernameRef = useRef(currentUsername);
  useEffect(() => {
    onEventRef.current = onEvent;
    onReconnectRef.current = onReconnect;
    currentUsernameRef.current = currentUsername;
  });

  const addTypingUser = useCallback((username: string) => {
    if (!username || username === currentUsernameRef.current) return;
    setTypingUsers((prev) => (prev.includes(username) ? prev : [...prev, username]));

    if (typingTimeoutsRef.current[username]) {
      clearTimeout(typingTimeoutsRef.current[username]);
    }
    typingTimeoutsRef.current[username] = setTimeout(() => {
      setTypingUsers((prev) => prev.filter((u) => u !== username));
      delete typingTimeoutsRef.current[username];
    }, TYPING_TIMEOUT_MS);
  }, []);

  useEffect(() => {
    if (!url) return;

    let eventSource: EventSource | null = null;
    let reconnectTimeout: NodeJS.Timeout | null = null;
    let reconnectAttempts = 0;
    let disposed = false;
    // Set when the server revoked this stream (kicked/banned/lost access):
    // reconnecting would only be refused, so stay closed.
    let revoked = false;
    let hasConnected = false;
    let lastEventAt = Date.now();

    const connect = () => {
      if (disposed || revoked) return;
      eventSource?.close();
      lastEventAt = Date.now();

      eventSource = new EventSource(url, { withCredentials: true });

      eventSource.onopen = () => {
        reconnectAttempts = 0;
        lastEventAt = Date.now();
        // Anything sent while we were disconnected never reached this stream.
        if (hasConnected) onReconnectRef.current?.();
        hasConnected = true;
      };

      eventSource.onmessage = (event) => {
        lastEventAt = Date.now();
        try {
          const data = JSON.parse(event.data) as ChatStreamEvent;
          if (data.type === "connected" || data.type === "ping") return;
          if (data.type === "removed") {
            revoked = true;
            if (reconnectTimeout) clearTimeout(reconnectTimeout);
            eventSource?.close();
            onEventRef.current(data);
            return;
          }
          if (data.type === "typing") {
            addTypingUser(String(data.username ?? ""));
            return;
          }
          onEventRef.current(data);
        } catch (error) {
          console.error("Failed to parse SSE data:", error);
        }
      };

      eventSource.onerror = () => {
        eventSource?.close();
        if (revoked) return;
        const backoffMs = Math.min(1000 * Math.pow(2, reconnectAttempts), MAX_BACKOFF_MS);
        reconnectAttempts += 1;
        if (reconnectTimeout) clearTimeout(reconnectTimeout);
        reconnectTimeout = setTimeout(connect, backoffMs);
      };
    };

    connect();

    const reconnectNow = () => {
      if (disposed || revoked) return;
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      reconnectAttempts = 0;
      connect();
    };
    // Back from a background tab, sleep or a network change: reconnect right
    // away instead of waiting out the backoff, and replace silent streams.
    const revive = () => {
      if (document.visibilityState !== "visible") return;
      const dead = !eventSource || eventSource.readyState === EventSource.CLOSED;
      if (dead || Date.now() - lastEventAt > STALE_STREAM_MS) reconnectNow();
    };
    const watchdog = setInterval(() => {
      if (eventSource?.readyState === EventSource.OPEN && Date.now() - lastEventAt > STALE_STREAM_MS) {
        reconnectNow();
      }
    }, 15000);
    document.addEventListener("visibilitychange", revive);
    window.addEventListener("online", revive);
    window.addEventListener("focus", revive);

    const timeouts = typingTimeoutsRef.current;
    return () => {
      disposed = true;
      clearInterval(watchdog);
      document.removeEventListener("visibilitychange", revive);
      window.removeEventListener("online", revive);
      window.removeEventListener("focus", revive);
      eventSource?.close();
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      Object.values(timeouts).forEach((timeout) => clearTimeout(timeout));
      typingTimeoutsRef.current = {};
      setTypingUsers([]);
    };
  }, [url, addTypingUser]);

  const typingStatusText = useMemo(() => {
    if (typingUsers.length === 0) return "";
    if (typingUsers.length === 1) return gt("{user} is typing...", { user: typingUsers[0] });
    if (typingUsers.length === 2) return gt("{user1} and {user2} are typing...", { user1: typingUsers[0], user2: typingUsers[1] });
    if (typingUsers.length === 3)
      return gt("{user1}, {user2} and {user3} are typing...", { user1: typingUsers[0], user2: typingUsers[1], user3: typingUsers[2] });
    return gt("{user1}, {user2} and {count} others are typing...", { user1: typingUsers[0], user2: typingUsers[1], count: typingUsers.length - 2 });
  }, [typingUsers, gt]);

  const clearTypingUser = useCallback((username: string) => {
    if (typingTimeoutsRef.current[username]) {
      clearTimeout(typingTimeoutsRef.current[username]);
      delete typingTimeoutsRef.current[username];
    }
    setTypingUsers((prev) => (prev.includes(username) ? prev.filter((u) => u !== username) : prev));
  }, []);

  return { typingUsers, typingStatusText, clearTypingUser };
}

/**
 * Throttled "I'm typing" signal shared by channel and DM composers.
 * Returns a callback to invoke on draft changes and a reset for after send.
 */
export function useTypingSignal(typingUrl: string | null, throttleMs = 2000) {
  const lastSentAtRef = useRef(0);

  const signalTyping = useCallback(
    (draft: string) => {
      if (!typingUrl || !draft.trim()) return;
      const now = Date.now();
      if (now - lastSentAtRef.current < throttleMs) return;
      lastSentAtRef.current = now;
      fetch(typingUrl, { method: "POST", keepalive: true }).catch(() => {
        // Best-effort signal only.
      });
    },
    [typingUrl, throttleMs]
  );

  const resetTyping = useCallback(() => {
    lastSentAtRef.current = 0;
  }, []);

  return { signalTyping, resetTyping };
}

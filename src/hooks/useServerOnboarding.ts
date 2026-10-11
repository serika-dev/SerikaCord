"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";

/** GET /api/servers/:id/onboarding (src/lib/api/community.ts). */
export interface WelcomeChannelView {
  channelId: string;
  description: string;
  emojiName: string | null;
  emojiId: string | null;
}

export interface ServerOnboarding {
  server: { id: string; name: string; icon: string | null; description: string | null };
  welcomeScreen: { enabled: boolean; description: string; welcomeChannels: WelcomeChannelView[] } | null;
  screening: { description: string; rules: string[] } | null;
  member: { pending: boolean; screeningBlocked: boolean; joinedAt: string | null };
}

// One shared entry per server so the composer gate and the welcome modal read
// the same state, and accepting the rules updates both at once.
const store = new Map<string, ServerOnboarding | null>();
const inflight = new Map<string, Promise<void>>();
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function load(serverId: string, force = false): Promise<void> {
  if (!force && (store.has(serverId) || inflight.has(serverId))) return inflight.get(serverId) ?? Promise.resolve();
  const p = fetch(`/api/servers/${serverId}/onboarding`, { credentials: "include" })
    .then((res) => (res.ok ? res.json() : null))
    .then((data: ServerOnboarding | null) => {
      store.set(serverId, data && data.member ? data : null);
    })
    .catch(() => {
      store.set(serverId, null);
    })
    .finally(() => {
      inflight.delete(serverId);
      emit();
    });
  inflight.set(serverId, p);
  return p;
}

/** Drop the cached state so the next reader refetches (e.g. after settings change). */
export function invalidateServerOnboarding(serverId: string) {
  store.delete(serverId);
  void load(serverId, true);
}

/**
 * Welcome screen + rules screening state of the current member in a server.
 * `blocked` is true while they must still accept the rules before talking.
 */
export function useServerOnboarding(serverId: string | null | undefined) {
  const data = useSyncExternalStore(
    subscribe,
    () => (serverId ? store.get(serverId) ?? null : null),
    () => null,
  );

  useEffect(() => {
    if (serverId) void load(serverId);
  }, [serverId]);

  const accept = useCallback(async () => {
    if (!serverId) return false;
    const res = await fetch(`/api/servers/${serverId}/screening/accept`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accepted: true }),
    }).catch(() => null);
    if (!res || !res.ok) return false;
    const current = store.get(serverId);
    if (current) {
      store.set(serverId, { ...current, member: { ...current.member, pending: false, screeningBlocked: false } });
      emit();
    }
    return true;
  }, [serverId]);

  return {
    data,
    blocked: Boolean(data?.member.screeningBlocked && data.screening),
    accept,
  };
}

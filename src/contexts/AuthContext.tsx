"use client";

import { sharedGet } from "@/lib/bootFetch";
import { createContext, useContext, useEffect, useState, ReactNode, useCallback, useRef, useMemo } from "react";
import { upsertSavedAccount } from "@/lib/services/savedAccounts";
import { clearMessageCache } from "@/hooks/useChatSession";
import { unregisterPush } from "@/lib/native/push";
import { shouldPromoteToOnline, toClientStatus, toServerStatus } from "@/lib/presenceChoice";
import type { BuiltinBadgeId } from "@/lib/constants/badges";
import { isDesktopShell } from "@/lib/desktop/bridge";

// Built-in ids keep autocomplete; badges created in the DB are plain strings.
export type BadgeId = BuiltinBadgeId | (string & {});

interface User {
  id: string;
  username: string;
  displayName: string;
  email: string;
  avatar?: string;
  banner?: string;
  bio?: string;
  pronouns?: string;
  timezone?: string;
  showTimezone?: boolean;
  status: "online" | "idle" | "dnd" | "offline";
  customStatus?: string;
  isPremium?: boolean;
  premiumSince?: string;
  premiumTier?: 'monthly' | 'yearly' | 'lifetime';
  badges?: BadgeId[];
  createdAt?: string;
  settings?: Record<string, any>;
  customization?: {
    profileColor?: string;
    profileAccentColor?: string;
    profileGradient?: string[];
    displayNameStyle?: {
      font?: 'default' | 'serif' | 'mono' | 'rounded' | 'cursive' | 'bold';
      effect?: 'solid' | 'gradient' | 'neon' | 'toon' | 'pop';
      color?: string;
      gradient?: string[];
    };
    nameplate?: {
      type?: 'none' | 'color' | 'gradient' | 'preset';
      color?: string;
      gradient?: string[];
      presetId?: string;
    };
    [key: string]: any;
  };
  gifFavorites?: Array<{ url: string; title?: string; source?: string; addedAt: number }>;
  emojiFavorites?: Array<{ emoji: string; name?: string; customEmojiId?: string | null; url?: string | null; addedAt: number }>;
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (data: { email: string; username: string; password: string; displayName?: string }) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  updateUser: (updates: Partial<User>) => void;
  setOnlineStatus: (status: "online" | "idle" | "dnd" | "offline") => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const statusUpdatePending = useRef(false);
  const refreshInFlight = useRef(false);

  const sendPresenceHeartbeat = useCallback(async () => {
    // The desktop app keeps you online while it sits in the tray (like
    // Discord); a hidden browser tab stops beating.
    if (typeof document !== "undefined" && document.visibilityState !== "visible" && !isDesktopShell()) return;

    try {
      await fetch("/api/users/me/presence/heartbeat", {
        method: "POST",
        keepalive: true,
      });
    } catch {
      // Heartbeats are best-effort.
    }
  }, []);

  const setOnlineStatus = useCallback(async (status: "online" | "idle" | "dnd" | "offline") => {
    if (statusUpdatePending.current) return;
    statusUpdatePending.current = true;
    
    try {
      // "offline" here is the Invisible choice; it's stored as "invisible"
      // so a reload doesn't mistake it for a stale offline and go online.
      await fetch("/api/users/me", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: toServerStatus(status) }),
        keepalive: true, // Ensures request completes even on page close
      });
      
      setUser(prev => prev ? { ...prev, status } : null);
    } catch (error) {
      console.error("Failed to update status:", error);
    } finally {
      statusUpdatePending.current = false;
    }
  }, []);

  const refresh = useCallback(async () => {
    // Prevent concurrent refresh calls — if a refresh is already in flight,
    // wait for it instead of firing a duplicate request.
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    setIsLoading(true);
    try {
      let response = await sharedGet("/api/users/@me");

      // If the access token expired, try refreshing it once before giving up.
      if (response.status === 401) {
        const refreshRes = await fetch("/api/auth/refresh", { method: "POST" });
        if (refreshRes.ok) {
          response = await fetch("/api/users/@me");
        }
      }

      if (response.ok) {
        const data = await response.json();
        const rawStatus = data?.status as string | undefined;
        // The UI models Invisible as "offline" (the server stores "invisible").
        setUser(data ? { ...data, status: toClientStatus(rawStatus) } : data);
        upsertSavedAccount(data);

        // Set user online when refreshing auth. Fire-and-forget so the app shell
        // paints as soon as we know who the user is, rather than blocking first
        // render on a second serial round-trip. Explicit DND / Invisible stick.
        if (data && shouldPromoteToOnline(rawStatus)) {
          setUser(prev => prev ? { ...prev, status: "online" } : null);
          void fetch("/api/users/me", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: "online" }),
          }).catch(() => {
            // Presence update is best-effort.
          });
        }
      } else {
        setUser(null);
      }
    } catch {
      setUser(null);
    } finally {
      setIsLoading(false);
      refreshInFlight.current = false;
    }
  }, []);

  // Set up visibility change and beforeunload handlers
  useEffect(() => {
    if (!user) return;

    // Handle visibility change (tab switch, minimize). The desktop app goes
    // idle from real system inactivity instead (DesktopIntegration), so hiding
    // its window to the tray doesn't make you idle.
    const desktop = isDesktopShell();
    const handleVisibilityChange = () => {
      if (desktop) {
        if (document.visibilityState === 'visible') void sendPresenceHeartbeat();
        return;
      }
      if (document.visibilityState === 'hidden') {
        // Only set idle, not offline, when tab is hidden
        if (user.status === "online") {
          setOnlineStatus("idle");
        }
      } else if (document.visibilityState === 'visible') {
        // Set back to online when user returns
        if (user.status === "idle") {
          void setOnlineStatus("online");
        }
        void sendPresenceHeartbeat();
      }
    };

    // Handle page close/navigation away
    // Tell the server this tab is going away. It only ends the heartbeat (and
    // only if no other tab/device is still connected) — never writes "offline"
    // as the status, which used to stick after a reload or with a second tab.
    const sendDisconnect = () => {
      if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
        navigator.sendBeacon('/api/users/me/presence/disconnect');
      }
    };
    const handleBeforeUnload = () => {
      sendDisconnect();
    };

    // Handle page hide (mobile background)
    const handlePageHide = (e: PageTransitionEvent) => {
      if (e.persisted) {
        if (desktop) return;
        // Page is going into bfcache: only an online user goes idle (same rule
        // as hiding the tab). DND / Invisible / idle are left untouched.
        if (user.status === "online") {
          void setOnlineStatus("idle");
        }
      } else {
        // Page is being unloaded
        sendDisconnect();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('beforeunload', handleBeforeUnload);
    window.addEventListener('pagehide', handlePageHide);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('pagehide', handlePageHide);
    };
  }, [user, setOnlineStatus, sendPresenceHeartbeat]);

  useEffect(() => {
    if (!user) return;

    void sendPresenceHeartbeat();
    // Keep beating in background tabs too: an open app is online (or idle),
    // not offline. Browsers throttle hidden-tab timers to about once a minute,
    // which still beats the server's 90s presence timeout.
    const interval = window.setInterval(() => {
      void sendPresenceHeartbeat();
    }, 30000);

    return () => {
      window.clearInterval(interval);
    };
  }, [user, sendPresenceHeartbeat]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const login = useCallback(async (email: string, password: string) => {
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || "Failed to login");
    }

    // Wait for the context to pick up the new auth cookie before returning.
    await refresh();
    // Clear any cached messages from a previous session to prevent
    // cross-account message leakage via localStorage SWR cache.
    clearMessageCache();
  }, [refresh]);

  const register = useCallback(async (data: { email: string; username: string; password: string; displayName?: string }) => {
    const response = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      const resData = await response.json().catch(() => ({}));
      throw new Error(resData.error || "Failed to register");
    }

    // Registration requires email verification — no auth cookie is set,
    // so we don't call refresh() here. The caller should show a success
    // message and redirect to login.
  }, []);

  const logout = useCallback(async () => {
    // End this device's presence (the server only goes offline when no other
    // tab/device is connected) without overwriting the chosen status, so
    // DND / Invisible survive a logout and the next login.
    try {
      await fetch("/api/users/me/presence/disconnect", { method: "POST", keepalive: true });
    } catch {}
    // Mobile app: stop pushes to this phone for the account signing out.
    try { await unregisterPush(); } catch {}
    try { await fetch("/api/auth/logout", { method: "POST" }); } catch {}
    clearMessageCache();
    setUser(null);
  }, []);

  const updateUser = useCallback((updates: Partial<User>) => {
    setUser(prev => prev ? { ...prev, ...updates } : null);
  }, []);

  const value = useMemo(
    () => ({ user, isLoading, login, register, logout, refresh, updateUser, setOnlineStatus }),
    [user, isLoading, login, register, logout, refresh, updateUser, setOnlineStatus]
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}

"use client";

import { clearMessageCache } from "@/hooks/useChatSession";
import { upsertSavedAccount } from "@/lib/services/savedAccounts";
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

export type BadgeId = 
  | 'staff' | 'admin' | 'moderator' 
  | 'partner' | 'serika_plus' | 'early_supporter'
  | 'verified_bot_developer' | 'bug_hunter' | 'bug_hunter_gold'
  | 'server_owner' | 'active_developer'
  | 'serikacord_developer' | 'serikacord_contributor' | 'serikacord_tester';

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
  displayedTagServerId?: string | null;
  displayedTag?: {
    serverId: string;
    serverName: string;
    serverIcon?: string | null;
    tagText: string;
    tagIcon?: string | null;
  } | null;
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
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return;

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
      // Use sendBeacon for offline status to ensure it completes even on page close
      if (status === "offline" && typeof navigator !== 'undefined' && navigator.sendBeacon) {
        navigator.sendBeacon('/api/users/me', JSON.stringify({ status }));
      } else {
        await fetch("/api/users/me", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
          keepalive: true, // Ensures request completes even on page close
        });
      }
      
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
      let response = await fetch("/api/users/@me");

      // If the access token expired, try refreshing it once before giving up.
      if (response.status === 401) {
        const refreshRes = await fetch("/api/auth/refresh", { method: "POST" });
        if (refreshRes.ok) {
          response = await fetch("/api/users/@me");
        }
      }

      if (response.ok) {
        const data = await response.json();
        setUser(data);
        upsertSavedAccount(data);

        // Set user online when refreshing auth. Fire-and-forget so the app shell
        // paints as soon as we know who the user is, rather than blocking first
        // render on a second serial round-trip.
        if (data && data.status !== "dnd" && data.status !== "invisible") {
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

    // Handle visibility change (tab switch, minimize)
    const handleVisibilityChange = () => {
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
    const handleBeforeUnload = () => {
      // Use sendBeacon for reliable offline status update on close
      if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
        const blob = new Blob([JSON.stringify({ status: "offline" })], { type: 'application/json' });
        navigator.sendBeacon('/api/users/me', blob);
      }
    };

    // Handle page hide (mobile background)
    const handlePageHide = (e: PageTransitionEvent) => {
      if (e.persisted) {
        // Page is going into bfcache, set idle
        void setOnlineStatus("idle");
      } else {
        // Page is being unloaded, set offline
        if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
          const blob = new Blob([JSON.stringify({ status: "offline" })], { type: 'application/json' });
          navigator.sendBeacon('/api/users/me', blob);
        }
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
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void sendPresenceHeartbeat();
      }
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
    // Set offline before logging out
    try { await setOnlineStatus("offline"); } catch {}
    try { await fetch("/api/auth/logout", { method: "POST" }); } catch {}
    clearMessageCache();
    setUser(null);
  }, [setOnlineStatus]);

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

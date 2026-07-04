"use client";

import { createContext, useContext, useEffect, useState, ReactNode, useCallback, useRef } from "react";

export type BadgeId = 
  | 'staff' | 'admin' | 'moderator' 
  | 'partner' | 'serika_plus' | 'early_supporter'
  | 'verified_bot_developer' | 'bug_hunter' | 'bug_hunter_gold'
  | 'server_owner' | 'active_developer'
  | 'hypesquad_bravery' | 'hypesquad_brilliance' | 'hypesquad_balance'
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
  status: "online" | "idle" | "dnd" | "offline";
  customStatus?: string;
  isPremium?: boolean;
  premiumSince?: string;
  premiumTier?: 'monthly' | 'yearly' | 'lifetime';
  badges?: BadgeId[];
  createdAt?: string;
  settings?: Record<string, any>;
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
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
    try {
      const response = await fetch("/api/users/@me");
      if (response.ok) {
        const data = await response.json();
        setUser(data);
        
        // Set user online when refreshing auth
        if (data && data.status !== "dnd" && data.status !== "invisible") {
          await fetch("/api/users/me", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: "online" }),
          });
          setUser(prev => prev ? { ...prev, status: "online" } : null);
        }
      } else {
        setUser(null);
      }
    } catch {
      setUser(null);
    } finally {
      setIsLoading(false);
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

  const login = async (email: string, password: string) => {
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || "Failed to login");
    }

    await refresh();
  };

  const logout = async () => {
    // Set offline before logging out
    await setOnlineStatus("offline");
    await fetch("/api/auth/logout", { method: "POST" });
    setUser(null);
  };

  const updateUser = (updates: Partial<User>) => {
    setUser(prev => prev ? { ...prev, ...updates } : null);
  };

  return (
    <AuthContext.Provider value={{ user, isLoading, login, logout, refresh, updateUser, setOnlineStatus }}>
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

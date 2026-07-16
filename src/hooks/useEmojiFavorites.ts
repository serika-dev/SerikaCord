"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";

const STORAGE_KEY = "serika-emoji-favorites";
const API_BASE = "/api/gifs";

export interface EmojiFavorite {
  emoji: string;
  name?: string;
  customEmojiId?: string | null;
  url?: string | null;
  addedAt: number;
}

export interface UseEmojiFavoritesReturn {
  favorites: EmojiFavorite[];
  isFavorite: (emoji: string, customEmojiId?: string) => boolean;
  addFavorite: (item: { emoji: string; name?: string; customEmojiId?: string; url?: string }) => void;
  removeFavorite: (emoji: string, customEmojiId?: string) => void;
  toggleFavorite: (item: { emoji: string; name?: string; customEmojiId?: string; url?: string }) => void;
  isReady: boolean;
}

function readLocalFavorites(): EmojiFavorite[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown[];
      if (Array.isArray(parsed)) {
        return parsed.filter(
          (item): item is EmojiFavorite =>
            typeof item === "object" &&
            item !== null &&
            typeof (item as EmojiFavorite).emoji === "string"
        );
      }
    }
  } catch {
    // ignore
  }
  return [];
}

function writeLocalFavorites(favs: EmojiFavorite[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(favs));
  } catch {
    // ignore
  }
}

export function useEmojiFavorites(): UseEmojiFavoritesReturn {
  const { user } = useAuth();
  const [favorites, setFavorites] = useState<EmojiFavorite[]>([]);
  const [isReady, setIsReady] = useState(false);
  const isAuthenticated = !!user;
  const isAuthenticatedRef = useRef(isAuthenticated);
  useEffect(() => {
    isAuthenticatedRef.current = isAuthenticated;
  }, [isAuthenticated]);

  useEffect(() => {
    let cancelled = false;

    async function loadFromApi() {
      try {
        const res = await fetch(`${API_BASE}/emoji-favorites`, { credentials: "include" });
        if (!res.ok) return null;
        const data = await res.json();
        const apiFavs = data.favorites as Array<Record<string, unknown>>;
        if (!Array.isArray(apiFavs)) return [];
        return apiFavs
          .filter((f) => f && typeof f.emoji === "string")
          .map((f) => ({
            emoji: String(f.emoji),
            name: f.name ? String(f.name) : undefined,
            customEmojiId: f.customEmojiId ? String(f.customEmojiId) : null,
            url: f.url ? String(f.url) : null,
            addedAt: Number(f.addedAt) || 0,
          })) as EmojiFavorite[];
      } catch {
        return null;
      }
    }

    if (isAuthenticated) {
      loadFromApi().then((apiFavs) => {
        if (cancelled) return;
        if (apiFavs === null) {
          setFavorites(readLocalFavorites());
        } else {
          setFavorites(apiFavs);
          const local = readLocalFavorites();
          const apiKeys = new Set(apiFavs.map((f) => f.customEmojiId || f.emoji));
          const toSync = local.filter((f) => !apiKeys.has(f.customEmojiId || f.emoji));
          if (toSync.length > 0) {
            Promise.all(
              toSync.map((f) =>
                fetch(`${API_BASE}/emoji-favorites`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  credentials: "include",
                  body: JSON.stringify({ emoji: f.emoji, name: f.name, customEmojiId: f.customEmojiId, url: f.url }),
                }).catch(() => null)
              )
            ).then(() => {
              if (cancelled) return;
              loadFromApi().then((merged) => {
                if (!cancelled && merged) setFavorites(merged);
              });
            });
            writeLocalFavorites([]);
          }
        }
        if (!cancelled) setIsReady(true);
      });
    } else {
      Promise.resolve().then(() => {
        if (cancelled) return;
        setFavorites(readLocalFavorites());
        setIsReady(true);
      });
    }

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isReady || isAuthenticatedRef.current) return;
    writeLocalFavorites(favorites);
  }, [favorites, isReady]);

  const isFavorite = useCallback(
    (emoji: string, customEmojiId?: string) => {
      const key = customEmojiId || emoji;
      return favorites.some((f) => (f.customEmojiId || f.emoji) === key);
    },
    [favorites]
  );

  const addFavorite = useCallback(
    (item: { emoji: string; name?: string; customEmojiId?: string; url?: string }) => {
      if (!item.emoji) return;
      setFavorites((prev) => {
        const key = item.customEmojiId || item.emoji;
        if (prev.some((f) => (f.customEmojiId || f.emoji) === key)) return prev;
        return [{ ...item, addedAt: Date.now() }, ...prev];
      });
      if (isAuthenticatedRef.current) {
        fetch(`${API_BASE}/emoji-favorites`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ emoji: item.emoji, name: item.name, customEmojiId: item.customEmojiId, url: item.url }),
        }).catch(() => {
          setFavorites((prev) => prev.filter((f) => (f.customEmojiId || f.emoji) !== (item.customEmojiId || item.emoji)));
        });
      }
    },
    []
  );

  const removeFavorite = useCallback(
    (emoji: string, customEmojiId?: string) => {
      const key = customEmojiId || emoji;
      const removed = favorites.find((f) => (f.customEmojiId || f.emoji) === key);
      setFavorites((prev) => prev.filter((f) => (f.customEmojiId || f.emoji) !== key));
      if (isAuthenticatedRef.current) {
        fetch(`${API_BASE}/emoji-favorites`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ emoji, customEmojiId }),
        }).catch(() => {
          if (removed) {
            setFavorites((prev) => {
              if (prev.some((f) => (f.customEmojiId || f.emoji) === key)) return prev;
              return [removed, ...prev];
            });
          }
        });
      }
    },
    [favorites]
  );

  const toggleFavorite = useCallback(
    (item: { emoji: string; name?: string; customEmojiId?: string; url?: string }) => {
      if (isFavorite(item.emoji, item.customEmojiId)) {
        removeFavorite(item.emoji, item.customEmojiId);
      } else {
        addFavorite(item);
      }
    },
    [isFavorite, addFavorite, removeFavorite]
  );

  return useMemo(
    () => ({ favorites, isFavorite, addFavorite, removeFavorite, toggleFavorite, isReady }),
    [favorites, isFavorite, addFavorite, removeFavorite, toggleFavorite, isReady]
  );
}

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";

const STORAGE_KEY = "serika-gif-favorites";
const API_BASE = "/api/gifs";

export interface GifFavorite {
  url: string;
  title?: string;
  source?: string;
  addedAt: number;
}

export interface UseGifFavoritesReturn {
  favorites: GifFavorite[];
  isFavorite: (url: string) => boolean;
  addFavorite: (gif: { url: string; title?: string; source?: string }) => void;
  removeFavorite: (url: string) => void;
  toggleFavorite: (gif: { url: string; title?: string; source?: string }) => void;
  isReady: boolean;
}

function readLocalFavorites(): GifFavorite[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown[];
      if (Array.isArray(parsed)) {
        return parsed.filter(
          (item): item is GifFavorite =>
            typeof item === "object" &&
            item !== null &&
            typeof (item as GifFavorite).url === "string"
        );
      }
    }
  } catch {
    // ignore
  }
  return [];
}

function writeLocalFavorites(favs: GifFavorite[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(favs));
  } catch {
    // ignore
  }
}

export function useGifFavorites(): UseGifFavoritesReturn {
  const { user } = useAuth();
  const [favorites, setFavorites] = useState<GifFavorite[]>([]);
  const [isReady, setIsReady] = useState(false);
  const isAuthenticated = !!user;
  const isAuthenticatedRef = useRef(isAuthenticated);
  useEffect(() => {
    isAuthenticatedRef.current = isAuthenticated;
  }, [isAuthenticated]);

  // Load favorites from backend (if authenticated) or localStorage.
  useEffect(() => {
    let cancelled = false;

    async function loadFromApi() {
      try {
        const res = await fetch(`${API_BASE}/favorites`, { credentials: "include" });
        if (!res.ok) return [];
        const data = await res.json();
        const apiFavs = data.favorites as Array<Record<string, unknown>>;
        if (!Array.isArray(apiFavs)) return [];
        return apiFavs
          .filter((f) => f && typeof f.url === "string")
          .map((f) => ({
            url: String(f.url),
            title: f.title ? String(f.title) : undefined,
            source: f.source ? String(f.source) : undefined,
            addedAt: Number(f.addedAt) || 0,
          })) as GifFavorite[];
      } catch {
        return null;
      }
    }

    if (isAuthenticated) {
      loadFromApi().then((apiFavs) => {
        if (cancelled || apiFavs === null) {
          // API failed — fall back to localStorage
          setFavorites(readLocalFavorites());
        } else {
          setFavorites(apiFavs);
          // Merge any localStorage favorites that aren't in the API into the backend
          const local = readLocalFavorites();
          const apiUrls = new Set(apiFavs.map((f) => f.url));
          const toSync = local.filter((f) => !apiUrls.has(f.url));
          if (toSync.length > 0) {
            Promise.all(
              toSync.map((f) =>
                fetch(`${API_BASE}/favorites`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  credentials: "include",
                  body: JSON.stringify({ url: f.url, title: f.title, source: f.source }),
                }).catch(() => null)
              )
            ).then(() => {
              if (cancelled) return;
              // Re-fetch to get the merged list with proper addedAt ordering
              loadFromApi().then((merged) => {
                if (!cancelled && merged) setFavorites(merged);
              });
            });
            // Clear localStorage after sync
            writeLocalFavorites([]);
          }
        }
        if (!cancelled) setIsReady(true);
      });
    } else {
      // Defer to avoid synchronous setState in effect
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

  // Persist to localStorage when not authenticated.
  useEffect(() => {
    if (!isReady || isAuthenticatedRef.current) return;
    writeLocalFavorites(favorites);
  }, [favorites, isReady]);

  const isFavorite = useCallback(
    (url: string) => favorites.some((f) => f.url === url),
    [favorites]
  );

  const addFavorite = useCallback(
    (gif: { url: string; title?: string; source?: string }) => {
      if (!gif.url) return;
      // Optimistic update
      setFavorites((prev) => {
        if (prev.some((f) => f.url === gif.url)) return prev;
        return [{ ...gif, addedAt: Date.now() }, ...prev];
      });
      // Persist to backend if authenticated
      if (isAuthenticatedRef.current) {
        fetch(`${API_BASE}/favorites`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ url: gif.url, title: gif.title, source: gif.source }),
        }).catch(() => {
          // Revert on failure
          setFavorites((prev) => prev.filter((f) => f.url !== gif.url));
        });
      }
    },
    []
  );

  const removeFavorite = useCallback(
    (url: string) => {
      // Optimistic update
      const removed = favorites.find((f) => f.url === url);
      setFavorites((prev) => prev.filter((f) => f.url !== url));
      // Persist to backend if authenticated
      if (isAuthenticatedRef.current) {
        fetch(`${API_BASE}/favorites`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ url }),
        }).catch(() => {
          // Revert on failure
          if (removed) {
            setFavorites((prev) => {
              if (prev.some((f) => f.url === url)) return prev;
              return [removed, ...prev];
            });
          }
        });
      }
    },
    [favorites]
  );

  const toggleFavorite = useCallback(
    (gif: { url: string; title?: string; source?: string }) => {
      if (isFavorite(gif.url)) {
        removeFavorite(gif.url);
      } else {
        addFavorite(gif);
      }
    },
    [isFavorite, addFavorite, removeFavorite]
  );

  return useMemo(
    () => ({ favorites, isFavorite, addFavorite, removeFavorite, toggleFavorite, isReady }),
    [favorites, isFavorite, addFavorite, removeFavorite, toggleFavorite, isReady]
  );
}

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

const STORAGE_KEY = "serika-gif-favorites";

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

export function useGifFavorites(): UseGifFavoritesReturn {
  const [favorites, setFavorites] = useState<GifFavorite[]>([]);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as unknown[];
        if (Array.isArray(parsed)) {
          setFavorites(parsed.filter((item): item is GifFavorite => typeof item === "object" && item !== null && typeof (item as GifFavorite).url === "string"));
        }
      }
    } catch {
      // ignore
    } finally {
      setIsReady(true);
    }
  }, []);

  useEffect(() => {
    if (!isReady) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(favorites));
    } catch {
      // ignore
    }
  }, [favorites, isReady]);

  const isFavorite = useCallback(
    (url: string) => favorites.some((f) => f.url === url),
    [favorites]
  );

  const addFavorite = useCallback((gif: { url: string; title?: string; source?: string }) => {
    if (!gif.url) return;
    setFavorites((prev) => {
      if (prev.some((f) => f.url === gif.url)) return prev;
      return [{ ...gif, addedAt: Date.now() }, ...prev];
    });
  }, []);

  const removeFavorite = useCallback((url: string) => {
    setFavorites((prev) => prev.filter((f) => f.url !== url));
  }, []);

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

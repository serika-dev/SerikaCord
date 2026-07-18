"use client";

import { useEffect, useState } from "react";

export interface IgdbSearchResult {
  id: number;
  name: string;
  coverUrl: string | null;
}

/**
 * Debounced IGDB game lookup against the existing `/api/igdb/game` proxy
 * ("GameDB"). Shared by the profile game-widget dialog and the widget editor.
 */
export function useIgdbSearch(minLength = 2, delayMs = 400) {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<IgdbSearchResult | null>(null);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (q.length < minLength) {
      setResult(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    const handle = setTimeout(async () => {
      try {
        const res = await fetch(`/api/igdb/game?name=${encodeURIComponent(q)}`);
        const data = await res.json();
        setResult(data.game || null);
      } catch {
        setResult(null);
      } finally {
        setSearching(false);
      }
    }, delayMs);
    return () => clearTimeout(handle);
  }, [query, minLength, delayMs]);

  return { query, setQuery, result, searching, reset: () => { setQuery(""); setResult(null); } };
}

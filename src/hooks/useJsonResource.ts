"use client";

import { useCallback, useEffect, useState } from "react";

interface ResourceState<T> {
  /** The request this state answers (url + reload counter). */
  key: string | null;
  url: string | null;
  data: T | null;
  /** HTTP status for a failed request, 0 for a network error, null when ok. */
  error: number | null;
}

/**
 * Small GET-JSON hook for widgets. `url = null` disables it. While a reload is
 * in flight the previous data for the *same* URL stays visible (no flashing
 * skeletons); data for a different URL is never shown. No setState runs
 * synchronously inside the effect (React Compiler friendly).
 */
export function useJsonResource<T>(url: string | null) {
  const [nonce, setNonce] = useState(0);
  const key = url ? `${url}#${nonce}` : null;
  const [state, setState] = useState<ResourceState<T>>({ key: null, url: null, data: null, error: null });

  useEffect(() => {
    if (!url || !key) return;
    let active = true;
    fetch(url)
      .then(async (res) => {
        const body = (await res.json().catch(() => null)) as T | null;
        if (!active) return;
        setState({ key, url, data: res.ok ? body : null, error: res.ok ? null : res.status });
      })
      .catch(() => {
        if (active) setState({ key, url, data: null, error: 0 });
      });
    return () => {
      active = false;
    };
  }, [url, key]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  const sameUrl = !!url && state.url === url;

  return {
    data: sameUrl ? state.data : null,
    error: sameUrl && state.key === key ? state.error : null,
    /** True until the first response for this URL arrives. */
    loading: !!url && !sameUrl,
    /** True while any request (first load or reload) is pending. */
    refreshing: !!key && state.key !== key,
    reload,
  };
}

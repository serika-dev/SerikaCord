"use client";

import { useEffect, useState } from "react";

/**
 * Small GET helper for the Trust & Safety screens: fetches `url` whenever it
 * or `reloadKey` changes, keeps the previous data while a reload is in flight
 * and never sets state synchronously inside the effect (React Compiler).
 * Pass `null` to skip.
 */
export function useJsonQuery<T>(url: string | null, reloadKey = 0): {
  data: T | null;
  error: string | null;
  loading: boolean;
} {
  const key = url ? `${url}#${reloadKey}` : null;
  const [state, setState] = useState<{ key: string; data: T | null; error: string | null } | null>(null);

  useEffect(() => {
    if (!url || !key) return;
    const controller = new AbortController();
    fetch(url, { credentials: "include", cache: "no-store", signal: controller.signal })
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        if (!res.ok) throw new Error((body && typeof body.error === "string" && body.error) || `HTTP ${res.status}`);
        if (!controller.signal.aborted) setState({ key, data: body as T, error: null });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setState((prev) => ({ key, data: prev?.data ?? null, error: err instanceof Error ? err.message : String(err) }));
      });
    return () => controller.abort();
  }, [url, key]);

  return {
    data: state?.data ?? null,
    error: state && state.key === key ? state.error : null,
    loading: Boolean(key) && state?.key !== key,
  };
}

/** JSON request that throws the server's `error` message on failure. */
export async function sendJson<T = unknown>(url: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, headers, ...rest } = init;
  const res = await fetch(url, {
    credentials: "include",
    ...rest,
    headers: json !== undefined ? { "Content-Type": "application/json", ...(headers || {}) } : headers,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error((body && typeof body.error === "string" && body.error) || `HTTP ${res.status}`);
  return body as T;
}

/**
 * Sanitize a post-login `?redirect=` target so it can only point at a path on
 * this site. Anything else (absolute URLs, protocol-relative `//host`,
 * `/\host`, `javascript:` and other schemes) falls back to `fallback`.
 *
 * Pure: pass `origin` explicitly in tests; in the browser it defaults to
 * `window.location.origin`.
 */
export function safeRedirect(
  target: string | null | undefined,
  fallback = "/channels/me",
  origin?: string,
): string {
  if (!target || typeof target !== "string") return fallback;
  // Only same-site absolute paths. Reject `//evil.com` and `/\evil.com`
  // (browsers normalise the backslash to a slash), and control characters
  // that URL parsing strips (e.g. "/\t/evil.com").
  if (!target.startsWith("/") || target.startsWith("//") || target.startsWith("/\\")) return fallback;
  if (/[\u0000-\u001f\u007f]/.test(target)) return fallback;
  const base = origin ?? (typeof window !== "undefined" ? window.location.origin : "http://localhost");
  try {
    const url = new URL(target, base);
    if (url.origin !== new URL(base).origin) return fallback;
    return url.pathname + url.search + url.hash;
  } catch {
    return fallback;
  }
}

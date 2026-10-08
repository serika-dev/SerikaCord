/**
 * Shared GETs for the app's startup data.
 *
 * `BootPrefetch` starts the core requests from an inline script while the HTML
 * is still parsing, long before React hydrates and before /@me resolves. The
 * contexts then pick those responses up here instead of starting their own.
 * Concurrent identical GETs (several components asking for /api/dms at mount)
 * share one request.
 */

type BootEntry = { p: Promise<Response>; t: number };
declare global {
  interface Window {
    __serikaBoot?: Record<string, BootEntry>;
  }
}

/** How long a prefetched startup response may be reused. */
const BOOT_TTL_MS = 4000;

const inflight = new Map<string, Promise<Response>>();

function takeBoot(url: string): Promise<Response> | null {
  if (typeof window === "undefined") return null;
  const entry = window.__serikaBoot?.[url];
  if (!entry) return null;
  if (performance.now() - entry.t > BOOT_TTL_MS) {
    delete window.__serikaBoot![url];
    return null;
  }
  return entry.p;
}

/**
 * GET `url` (same-origin, with cookies), reusing a startup prefetch or an
 * identical in-flight request. Each caller gets its own readable Response.
 */
export async function sharedGet(url: string): Promise<Response> {
  const boot = takeBoot(url);
  if (boot) {
    try {
      const res = await boot;
      // Only reuse successes; a 401 here usually means the token is about to
      // be refreshed, so the caller must get a fresh answer.
      if (res.ok) return res.clone();
    } catch {
      /* fall through to a fresh request */
    }
    delete window.__serikaBoot![url];
  }
  let pending = inflight.get(url);
  if (!pending) {
    pending = fetch(url, { credentials: "include" });
    inflight.set(url, pending);
    const clear = () => {
      if (inflight.get(url) === pending) inflight.delete(url);
    };
    pending.then(clear, clear);
  }
  const res = await pending;
  return res.clone();
}

/** Drop prefetched startup data (e.g. after logout / account switch). */
export function clearBootData(): void {
  if (typeof window !== "undefined") window.__serikaBoot = {};
}

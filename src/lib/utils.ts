import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Our CDN (cdn.serika.chat) proxies through wsrv.nl, which can transcode on the
// fly via query params. We serve WebP by default for smaller, faster images.
const CDN_IMAGE_HOST = "cdn.serika.chat";

/**
 * Rewrite a CDN media URL to request WebP by default.
 *
 * Only touches `cdn.serika.chat` URLs; anything else (Discord CDN, Tenor,
 * data URIs, blob URLs, relative paths, …) is returned unchanged. Idempotent —
 * if the caller already set a `format`/`output`/`fm` param (or `n=-1` to keep
 * animation), or requested a flip/resize, those are respected and we only add
 * `format=webp` when no explicit format is present. Existing params (w/h/flip/
 * quality/etc.) are preserved untouched.
 */
export function cdnImage(url?: string | null, opts?: { still?: boolean; animated?: boolean }): string {
  if (!url) return url ?? "";
  // Fast bail-out for non-CDN / non-http strings without constructing a URL.
  if (!url.includes(CDN_IMAGE_HOST)) return url;
  try {
    const u = new URL(url);
    if (u.hostname !== CDN_IMAGE_HOST) return url;
    if (opts?.still) {
      // `still`: first frame only (wsrv n=1), so GIFs/animated WebP don't play.
      u.searchParams.set("n", "1");
      if (!u.searchParams.has("format") && !u.searchParams.has("output") && !u.searchParams.has("fm")) {
        u.searchParams.set("format", "webp");
      }
      return u.toString();
    }
    // Respect a caller-specified output format (wsrv accepts format/output/fm).
    if (u.searchParams.has("format") || u.searchParams.has("output") || u.searchParams.has("fm")) {
      return url;
    }
    // wsrv keeps only the first frame unless asked for all of them (n=-1), so
    // animated stickers and emoji would otherwise arrive as a still WebP.
    if (opts?.animated) u.searchParams.set("n", "-1");
    u.searchParams.set("format", "webp");
    return u.toString();
  } catch {
    return url;
  }
}

/**
 * Retry a failed CDN image without format conversion. Keep the requested
 * frame, crop and size so a still avatar never starts animating on retry.
 * Other hosts and URLs without a conversion have no alternate source.
 */
/**
 * onError handler for images built with cdnImage: if wsrv fails to convert
 * (it can on very large animated files), retry once with the original file
 * from the CDN instead of leaving a broken image.
 */
export function retryWithOriginalImage(originalUrl?: string | null) {
  return (event: { currentTarget: HTMLImageElement }) => {
    const img = event.currentTarget;
    if (!originalUrl || img.dataset.retried === "1") return;
    img.dataset.retried = "1";
    img.src = originalUrl;
  };
}

export function cdnImageFallback(url?: string | null): string | undefined {
  if (!url?.includes(CDN_IMAGE_HOST)) return undefined;
  try {
    const u = new URL(url);
    if (u.hostname !== CDN_IMAGE_HOST || !["http:", "https:"].includes(u.protocol)) return undefined;
    const formatParams = ["format", "output", "fm"];
    if (!formatParams.some((param) => u.searchParams.has(param))) return undefined;
    for (const param of formatParams) u.searchParams.delete(param);
    return u.toString();
  } catch {
    return undefined;
  }
}

/**
 * Format a millisecond duration as a short human string, e.g. "2d 3h", "5m", "45s".
 */
export function formatDuration(ms: number): string {
  if (ms <= 0) return "0s";
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${seconds}s`;
}

/**
 * Given a server member's `communicationDisabledUntil` timestamp, report whether
 * they are currently timed out and a human-readable remaining-time label.
 * Server-only concept; returns inactive for null/past values.
 */
export function getTimeoutRemaining(until?: string | Date | null): { active: boolean; label: string } {
  if (!until) return { active: false, label: "" };
  const untilMs = typeof until === "string" ? Date.parse(until) : until.getTime();
  if (Number.isNaN(untilMs)) return { active: false, label: "" };
  const remaining = untilMs - Date.now();
  if (remaining <= 0) return { active: false, label: "" };
  return { active: true, label: formatDuration(remaining) };
}

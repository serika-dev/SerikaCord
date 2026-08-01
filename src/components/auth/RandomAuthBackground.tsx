"use client";

import { useEffect, useRef, useState } from "react";
import { Brush } from "lucide-react";

/**
 * Full-bleed random artwork background for the auth split-screen, sourced from
 * serika.art via the SerikaCord `/api/auth/random-bg` proxy (which forwards to
 * accounts.serika.dev so the art API key never leaves that service).
 *
 * Fast-loading strategy:
 *   • A tiny blurred placeholder (~a few KB) is shown almost instantly, then the
 *     full-resolution image fades in over it — no black flash on cold loads.
 *   • The NEXT image is prefetched into the browser cache at the EXACT size this
 *     viewport will request, and its raw URL is stored in localStorage. On the
 *     next visit we recompute the same URL, so it's a cache hit → instant.
 */

interface BgPost {
  rawUrl: string;
  artist: string;
  id?: number | string;
  origW?: number;
  origH?: number;
}

const STORAGE_KEY = "next_serika_bg_post";

function buildUrl(rawUrl: string, params: string): string {
  return rawUrl + (rawUrl.includes("?") ? "&" : "?") + params;
}

function getWsrvParams(origW?: number, origH?: number): string {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const winWidth = window.innerWidth || 1200;
  const winHeight = window.innerHeight || 900;
  // Right pane is 500px on desktop, 400px on medium, 0 on mobile.
  const paneWidth = winWidth > 900 ? 500 : winWidth > 700 ? 400 : 0;
  const containerWidth = winWidth > 700 ? Math.max(winWidth - paneWidth, 300) : winWidth;
  const containerHeight = winHeight;

  const w = Math.round(containerWidth * dpr);
  const h = Math.round(containerHeight * dpr);

  let align = "entropy";
  if (origW && origH) {
    const containerRatio = containerWidth / containerHeight;
    const imageRatio = origW / origH;
    if (imageRatio < containerRatio) align = "focal&fpx=0.5&fpy=0.25";
  }
  return `output=webp&w=${w}&h=${h}&fit=cover&a=${align}`;
}

// Tiny, heavily-compressed placeholder for an instant blur-up.
const PLACEHOLDER_PARAMS = "output=webp&w=48&q=30&fit=cover&a=entropy";

function isAspectMismatch(origW?: number, origH?: number): boolean {
  if (!origW || !origH) return false;
  const winWidth = window.innerWidth || 1200;
  const winHeight = window.innerHeight || 900;
  const paneWidth = winWidth > 900 ? 500 : winWidth > 700 ? 400 : 0;
  const containerWidth = winWidth > 700 ? Math.max(winWidth - paneWidth, 300) : winWidth;
  const containerRatio = containerWidth / winHeight;
  const imageRatio = origW / origH;
  return Math.abs(containerRatio - imageRatio) > 0.35;
}

interface RandomBg {
  data?: {
    url?: string;
    post_id?: number | string;
    width?: number;
    height?: number;
    tags?: { type: string; name: string }[];
    user?: { username?: string };
  };
}

export function RandomAuthBackground() {
  const [placeholderSrc, setPlaceholderSrc] = useState("");
  const [fullSrc, setFullSrc] = useState("");
  const [fullLoaded, setFullLoaded] = useState(false);
  const [mismatch, setMismatch] = useState(false);
  const [artist, setArtist] = useState("");
  const [postId, setPostId] = useState<number | string | undefined>();
  const dims = useRef<{ w?: number; h?: number }>({});

  useEffect(() => {
    let cancelled = false;

    // Warm the TLS connection to the image origin so the full download starts
    // without a fresh DNS/TLS handshake on cold loads.
    const preconnect = (url: string) => {
      try {
        const origin = new URL(url).origin;
        if (document.querySelector(`link[data-bg-preconnect="${origin}"]`)) return;
        const link = document.createElement("link");
        link.rel = "preconnect";
        link.href = origin;
        link.crossOrigin = "anonymous";
        link.dataset.bgPreconnect = origin;
        document.head.appendChild(link);
      } catch {
        /* ignore */
      }
    };

    const apply = (post: BgPost) => {
      if (cancelled) return;
      dims.current = { w: post.origW, h: post.origH };
      preconnect(post.rawUrl);
      setMismatch(isAspectMismatch(post.origW, post.origH));
      setArtist(post.artist);
      setPostId(post.id);
      setFullLoaded(false);
      // Show the placeholder immediately, then let the full image fade in.
      setPlaceholderSrc(buildUrl(post.rawUrl, PLACEHOLDER_PARAMS));
      setFullSrc(buildUrl(post.rawUrl, getWsrvParams(post.origW, post.origH)));
    };

    const toPost = (res: RandomBg | null): BgPost | null => {
      if (!res?.data?.url) return null;
      const d = res.data;
      const artistTag = d.tags?.find((t) => t.type === "artist");
      const name = artistTag ? artistTag.name : d.user?.username || "Unknown Artist";
      return { rawUrl: d.url!, artist: name, id: d.post_id, origW: d.width, origH: d.height };
    };

    // Prefetch the NEXT background: store its raw URL and warm the browser cache
    // with BOTH the placeholder and the exact full-size URL this viewport uses,
    // so the next visit is a pure cache hit.
    const prefetchNext = async () => {
      try {
        const res = (await fetch("/api/auth/random-bg").then((r) =>
          r.ok ? r.json() : null
        )) as RandomBg | null;
        const post = toPost(res);
        if (!post) return;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(post));
        new Image().src = buildUrl(post.rawUrl, PLACEHOLDER_PARAMS);
        new Image().src = buildUrl(post.rawUrl, getWsrvParams(post.origW, post.origH));
      } catch {
        /* best-effort */
      }
    };

    const run = async () => {
      // 1. Instantly show whatever we prefetched last time (cache-warmed).
      let stored: BgPost | null = null;
      try {
        stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      } catch {
        stored = null;
      }
      if (stored?.rawUrl) {
        apply(stored);
        prefetchNext();
        return;
      }

      // 2. First ever load: fetch live, then prefetch the next.
      const res = (await fetch("/api/auth/random-bg").then((r) =>
        r.ok ? r.json() : null
      )) as RandomBg | null;
      const post = toPost(res);
      if (post) {
        apply(post);
        prefetchNext();
      }
    };

    run();

    // Re-evaluate aspect fit on resize / orientation change.
    let timer: ReturnType<typeof setTimeout>;
    const onResize = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        setMismatch(isAspectMismatch(dims.current.w, dims.current.h));
      }, 150);
    };
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
    };
  }, []);

  return (
    <div className="overflow-hidden bg-black max-md:pointer-events-none max-md:fixed max-md:inset-0 max-md:z-0 md:relative md:flex-1">
      {/* Blurred glow layer behind the image (uses the cheap placeholder). */}
      {placeholderSrc && (
        <div
          className="absolute -inset-5 z-[1]"
          style={{
            backgroundImage: `url("${placeholderSrc}")`,
            backgroundSize: "cover",
            backgroundPosition: "center",
            filter: "blur(40px) brightness(0.45)",
          }}
        />
      )}

      {/* Instant blurred placeholder. */}
      {placeholderSrc && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={placeholderSrc}
          alt=""
          aria-hidden
          className={`absolute inset-0 z-[2] h-full w-full scale-110 object-cover blur-xl ${
            mismatch ? "opacity-60" : ""
          }`}
        />
      )}

      {/* Full-resolution image, fades in on load. */}
      {fullSrc && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={fullSrc}
          alt=""
          onLoad={() => setFullLoaded(true)}
          className={`absolute inset-0 z-[3] h-full w-full transition-opacity duration-700 ${
            mismatch ? "object-contain" : "object-cover"
          }`}
          style={{ opacity: fullLoaded ? 1 : 0 }}
        />
      )}

      {/* Artist attribution chip */}
      {fullLoaded && artist && (
        <div className="z-[4] inline-flex items-center gap-2 rounded-full border border-white/[0.12] bg-[#121215]/75 px-4 py-[0.45rem] text-sm font-semibold text-white shadow-[0_8px_20px_rgba(0,0,0,0.4)] backdrop-blur-md max-md:fixed max-md:top-4 max-md:left-1/2 max-md:z-20 max-md:-translate-x-1/2 max-md:whitespace-nowrap max-md:px-[0.85rem] max-md:py-[0.35rem] max-md:text-xs md:absolute md:bottom-5 md:left-6">
          {postId ? (
            <a
              href={`https://serika.art/image/${postId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 transition-opacity hover:opacity-80"
            >
              <Brush className="h-4 w-4 text-[#8b5cf6]" />
              Art by {artist}
            </a>
          ) : (
            <>
              <Brush className="h-4 w-4 text-[#8b5cf6]" />
              Art by {artist}
            </>
          )}
        </div>
      )}
    </div>
  );
}

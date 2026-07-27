"use client";

import { useEffect, useRef, useState } from "react";
import { Brush } from "lucide-react";

/**
 * Full-bleed random artwork background for the auth split-screen, sourced from
 * serika.art via the SerikaCord `/api/auth/random-bg` proxy (which forwards to
 * accounts.serika.dev so the art API key never leaves that service).
 *
 * Mirrors the accounts.serika.dev prefetch pipeline: on load it instantly shows
 * the image prefetched into localStorage last time, then quietly fetches the
 * NEXT one and warms the browser cache so the following visit is instant.
 */

interface BgPost {
  url: string;
  artist: string;
  id?: number | string;
  origW?: number;
  origH?: number;
}

const STORAGE_KEY = "next_serika_bg_post";

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
  const [src, setSrc] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [mismatch, setMismatch] = useState(false);
  const [artist, setArtist] = useState("");
  const [postId, setPostId] = useState<number | string | undefined>();
  const dims = useRef<{ w?: number; h?: number }>({});

  useEffect(() => {
    let cancelled = false;

    const apply = (post: BgPost) => {
      if (cancelled) return;
      dims.current = { w: post.origW, h: post.origH };
      setMismatch(isAspectMismatch(post.origW, post.origH));
      setArtist(post.artist);
      setPostId(post.id);
      setSrc(post.url);
    };

    const toPost = (res: RandomBg | null): BgPost | null => {
      if (!res?.data?.url) return null;
      const d = res.data;
      const artistTag = d.tags?.find((t) => t.type === "artist");
      const name = artistTag ? artistTag.name : d.user?.username || "Unknown Artist";
      const wsrv = getWsrvParams(d.width, d.height);
      const url = d.url + (d.url.includes("?") ? "&" : "?") + wsrv;
      return { url, artist: name, id: d.post_id, origW: d.width, origH: d.height };
    };

    // Prefetch the NEXT background and warm the browser cache.
    const prefetchNext = async () => {
      try {
        const res = (await fetch("/api/auth/random-bg").then((r) =>
          r.ok ? r.json() : null
        )) as RandomBg | null;
        const post = toPost(res);
        if (!post) return;
        // Store a wide, generic variant; dimensions get corrected on next load.
        const wide =
          res!.data!.url! +
          (res!.data!.url!.includes("?") ? "&" : "?") +
          "output=webp&w=1200&fit=cover&a=attention";
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ ...post, url: wide })
        );
        new Image().src = wide;
      } catch {
        /* best-effort */
      }
    };

    const run = async () => {
      // 1. Instantly show whatever we prefetched last time.
      let stored: BgPost | null = null;
      try {
        stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      } catch {
        stored = null;
      }
      if (stored?.url) {
        // Re-derive sizing for this viewport.
        try {
          const u = new URL(stored.url);
          const params = new URLSearchParams(getWsrvParams(stored.origW, stored.origH));
          params.forEach((v, k) => u.searchParams.set(k, v));
          stored.url = u.toString();
        } catch {
          /* keep as-is */
        }
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
    <div
      className="overflow-hidden bg-black max-md:pointer-events-none max-md:fixed max-md:inset-0 max-md:z-0 md:relative md:flex-1"
      style={
        loaded
          ? { backgroundImage: `url("${src}")`, backgroundSize: "cover", backgroundPosition: "center" }
          : undefined
      }
    >
      {/* Blurred glow layer behind the image, matches accounts. */}
      {src && (
        <div
          className="absolute -inset-5 z-[1] transition-opacity duration-1000"
          style={{
            backgroundImage: `url("${src}")`,
            backgroundSize: "cover",
            backgroundPosition: "center",
            filter: "blur(40px) brightness(0.45)",
            opacity: loaded ? 1 : 0,
          }}
        />
      )}
      {src && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          onLoad={() => setLoaded(true)}
          className={`absolute inset-0 z-[2] h-full w-full transition-opacity duration-1000 ${
            mismatch ? "object-contain" : "object-cover"
          }`}
          style={{ opacity: loaded ? 1 : 0 }}
        />
      )}

      {/* Artist attribution chip */}
      {loaded && artist && (
        <div className="z-[3] inline-flex items-center gap-2 rounded-full border border-white/[0.12] bg-[#121215]/75 px-4 py-[0.45rem] text-sm font-semibold text-white shadow-[0_8px_20px_rgba(0,0,0,0.4)] backdrop-blur-md max-md:fixed max-md:top-4 max-md:left-1/2 max-md:z-20 max-md:-translate-x-1/2 max-md:whitespace-nowrap max-md:px-[0.85rem] max-md:py-[0.35rem] max-md:text-xs md:absolute md:bottom-5 md:left-6">
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

"use client";

import { useEffect, useState, memo } from "react";
import { ExternalLink, Play, X } from "lucide-react";
import { InviteEmbed, parseInviteCode } from "@/components/chat/InviteEmbed";
import { decodeHtmlEntities } from "@/lib/chat/messages";

interface LinkEmbedProps {
  content: string;
}

const FIRST_PARTY_DOMAINS = [
  "serika.dev",
  "serika.chat",
  "serika.cc",
  "waifu.ws",
  "gifs.serika.dev",
  "accounts.serika.dev",
  "cdn.ado.wtf",
];

function extractUrls(text: string): string[] {
  const urlRegex = /(https?:\/\/[^\s<]+[^<.,:;"')\]\s])/g;
  return text.match(urlRegex) || [];
}

function parseYouTubeUrl(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

function getUrlType(url: string): "youtube" | "twitter" | "spotify" | "giphy" | "tenor" | "klipy" | "generic" {
  if (/youtube\.com|youtu\.be/.test(url)) return "youtube";
  if (/twitter\.com|x\.com/.test(url)) return "twitter";
  if (/open\.spotify\.com/.test(url)) return "spotify";
  if (/giphy\.com/.test(url)) return "giphy";
  if (/tenor\.com/.test(url)) return "tenor";
  if (/klipy\.com|klipy\.dev/.test(url)) return "klipy";
  return "generic";
}

function isImageUrl(url: string): boolean {
  return /\.(gif|jpg|jpeg|png|webp|svg|bmp)(\?.*)?$/i.test(url) || /^https?:\/\/gifs\.serika\.dev/i.test(url);
}

function isFirstPartyUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return FIRST_PARTY_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

function shouldSkipOEmbed(url: string): boolean {
  // Giphy URLs are rendered directly from the ID, no need for oEmbed
  if (/giphy\.com/.test(url)) return true;
  return isImageUrl(url) || isFirstPartyUrl(url);
}

function parseSpotifyUrl(url: string): { type: string; id: string } | null {
  const match = url.match(/open\.spotify\.com\/(track|album|artist|playlist|episode|show)\/([a-zA-Z0-9]+)/);
  if (match) return { type: match[1], id: match[2] };
  return null;
}

function parseGiphyUrl(url: string): string | null {
  // https://giphy.com/gifs/{slug}-{id} or https://giphy.com/embed/{id}
  const embedMatch = url.match(/giphy\.com\/embed\/([a-zA-Z0-9]+)/);
  if (embedMatch) return embedMatch[1];
  const gifsMatch = url.match(/giphy\.com\/gifs\/(?:.*-)?([a-zA-Z0-9]+)(?:\/|$)/);
  if (gifsMatch) return gifsMatch[1];
  return null;
}

function parseTenorUrl(url: string): string | null {
  // https://tenor.com/view/{slug}-{numeric_id} or https://tenor.com/i/{id}
  const viewMatch = url.match(/tenor\.com\/view\/(?:.*-)?(\d+)(?:\/|$)/);
  if (viewMatch) return viewMatch[1];
  const iMatch = url.match(/tenor\.com\/i\/(\d+)/);
  if (iMatch) return iMatch[1];
  return null;
}

function YouTubeEmbed({ videoId, url }: { videoId: string; url: string }) {
  const [showPlayer, setShowPlayer] = useState(false);
  const thumbnailUrl = `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;
  const fallbackThumbnail = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
  const [imgSrc, setImgSrc] = useState(thumbnailUrl);

  if (showPlayer) {
    return (
      <div className="mt-2 relative max-w-[480px] rounded-lg overflow-hidden bg-black">
        <button
          onClick={() => setShowPlayer(false)}
          className="absolute top-2 right-2 z-10 p-1 bg-black/70 hover:bg-black/90 rounded-full text-white transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
        <div className="aspect-video">
          <iframe
            src={`https://www.youtube.com/embed/${videoId}?autoplay=1`}
            title="YouTube video player"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            className="w-full h-full border-0"
          />
        </div>
      </div>
    );
  }

  return (
    <div
      className="mt-2 relative max-w-[480px] rounded-lg overflow-hidden cursor-pointer group"
      onClick={() => setShowPlayer(true)}
    >
      <img
        src={imgSrc}
        alt="YouTube thumbnail"
        loading="lazy"
        decoding="async"
        className="w-full aspect-video object-cover"
        onError={() => setImgSrc(fallbackThumbnail)}
      />
      <div className="absolute inset-0 flex items-center justify-center bg-black/30 group-hover:bg-black/50 transition-colors">
        <div className="w-16 h-16 rounded-full bg-red-600 flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform">
          <Play className="w-8 h-8 text-white ml-1" fill="white" />
        </div>
      </div>
      <div className="absolute bottom-0 left-0 right-0 p-3 bg-gradient-to-t from-black/80 to-transparent">
        <div className="flex items-center gap-2 text-white text-sm">
          <span className="font-medium">YouTube</span>
          <ExternalLink className="w-3 h-3 opacity-70" />
        </div>
      </div>
    </div>
  );
}

function GenericEmbed({
  url,
  preview,
}: {
  url: string;
  preview?: { title?: string; description?: string; thumbnail?: string; siteName?: string };
}) {
  let hostname = "link";
  let pathname = "";

  try {
    const parsed = new URL(url);
    hostname = parsed.hostname.replace(/^www\./, "");
    pathname = parsed.pathname === "/" ? "" : parsed.pathname;
  } catch {
    return null;
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-2 block max-w-[400px] border-l-4 border-[#8B5CF6] bg-[#1a1a1a] rounded-r-lg overflow-hidden hover:bg-[#222222] transition-colors"
    >
      {preview?.thumbnail && (
        <img
          src={preview.thumbnail}
          alt={preview.title || "Link preview"}
          className="w-full max-h-52 object-cover"
          loading="lazy"
        />
      )}
      <div className="p-3">
        <div className="flex items-center gap-2 text-xs text-[#8B5CF6] font-medium mb-1">
          <span>{preview?.siteName || hostname}</span>
          <ExternalLink className="w-3 h-3 opacity-70" />
        </div>
        {preview?.title ? (
          <div className="text-white text-sm font-medium line-clamp-2">{preview.title}</div>
        ) : (
          pathname && <div className="text-[#888888] text-xs line-clamp-2 break-all">{pathname}</div>
        )}
        {preview?.description && (
          <div className="text-[#888888] text-xs mt-1 line-clamp-3">{preview.description}</div>
        )}
      </div>
    </a>
  );
}

function SpotifyEmbed({ type, id, url }: { type: string; id: string; url: string }) {
  const height = type === "track" || type === "episode" ? 152 : 380;
  return (
    <div className="mt-2 max-w-[400px] rounded-lg overflow-hidden bg-[#1ed760]/10 border border-[#1ed760]/30">
      <iframe
        src={`https://open.spotify.com/embed/${type}/${id}`}
        width="100%"
        height={height}
        frameBorder="0"
        allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
        loading="lazy"
        className="border-0"
        title="Spotify player"
      />
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-2 px-3 py-1.5 text-xs text-[#1ed760] hover:text-[#1ed760]/80 transition-colors"
      >
        <span className="font-medium">Spotify</span>
        <ExternalLink className="w-3 h-3 opacity-70" />
      </a>
    </div>
  );
}

function GiphyEmbed({ gifId, url }: { gifId: string; url: string }) {
  const gifUrl = `https://media.giphy.com/media/${gifId}/giphy.gif`;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-2 inline-block relative group rounded-lg overflow-hidden max-w-[400px]"
    >
      <img
        src={gifUrl}
        alt="Giphy GIF"
        className="rounded-lg max-h-[300px] w-auto"
        loading="lazy"
      />
      <div className="absolute bottom-1 right-1 px-2 py-0.5 bg-black/70 rounded text-[10px] text-white font-medium opacity-0 group-hover:opacity-100 transition-opacity">
        GIPHY
      </div>
    </a>
  );
}

function TenorEmbed({ gifId, url, preview }: { gifId: string; url: string; preview?: { title?: string; description?: string; thumbnail?: string; siteName?: string } }) {
  const [gifSrc, setGifSrc] = useState<string | null>(preview?.thumbnail || null);

  useEffect(() => {
    if (preview?.thumbnail) {
      setGifSrc(preview.thumbnail);
      return;
    }
    // Try to fetch oEmbed from Tenor
    let active = true;
    fetch(`/api/oembed?url=${encodeURIComponent(url)}`)
      .then(async (res) => {
        if (!res.ok) return null;
        return res.json();
      })
      .then((data) => {
        if (!active || !data) return;
        if (data.thumbnail) setGifSrc(data.thumbnail);
      })
      .catch(() => {});
    return () => { active = false; };
  }, [url, preview]);

  if (!gifSrc) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-2 inline-block max-w-[400px] border-l-4 border-[#8B5CF6] bg-[#1a1a1a] rounded-r-lg p-3 hover:bg-[#222222] transition-colors"
      >
        <div className="flex items-center gap-2 text-xs text-[#8B5CF6] font-medium mb-1">
          <span>tenor.com</span>
          <ExternalLink className="w-3 h-3 opacity-70" />
        </div>
        <div className="text-white text-sm">View GIF on Tenor</div>
      </a>
    );
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-2 inline-block relative group rounded-lg overflow-hidden max-w-[400px]"
    >
      <img
        src={gifSrc}
        alt={preview?.title || "Tenor GIF"}
        className="rounded-lg max-h-[300px] w-auto"
        loading="lazy"
      />
      <div className="absolute bottom-1 right-1 px-2 py-0.5 bg-black/70 rounded text-[10px] text-white font-medium opacity-0 group-hover:opacity-100 transition-opacity">
        Tenor
      </div>
    </a>
  );
}

function KlipyEmbed({ url, preview }: { url: string; preview?: { title?: string; description?: string; thumbnail?: string; siteName?: string } }) {
  const [gifSrc, setGifSrc] = useState<string | null>(preview?.thumbnail || null);

  useEffect(() => {
    if (preview?.thumbnail) {
      setGifSrc(preview.thumbnail);
      return;
    }
    let active = true;
    fetch(`/api/oembed?url=${encodeURIComponent(url)}`)
      .then(async (res) => {
        if (!res.ok) return null;
        return res.json();
      })
      .then((data) => {
        if (!active || !data) return;
        if (data.thumbnail) setGifSrc(data.thumbnail);
      })
      .catch(() => {});
    return () => { active = false; };
  }, [url, preview]);

  if (!gifSrc) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-2 inline-block max-w-[400px] border-l-4 border-[#8B5CF6] bg-[#1a1a1a] rounded-r-lg p-3 hover:bg-[#222222] transition-colors"
      >
        <div className="flex items-center gap-2 text-xs text-[#8B5CF6] font-medium mb-1">
          <span>klipy.com</span>
          <ExternalLink className="w-3 h-3 opacity-70" />
        </div>
        <div className="text-white text-sm">View GIF on Klipy</div>
      </a>
    );
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-2 inline-block relative group rounded-lg overflow-hidden max-w-[400px]"
    >
      <img
        src={gifSrc}
        alt={preview?.title || "Klipy GIF"}
        className="rounded-lg max-h-[300px] w-auto"
        loading="lazy"
      />
      <div className="absolute bottom-1 right-1 px-2 py-0.5 bg-black/70 rounded text-[10px] text-white font-medium opacity-0 group-hover:opacity-100 transition-opacity">
        Klipy
      </div>
    </a>
  );
}

// Memoized: embeds fetch previews and must not re-run while unrelated chat
// state (composer text, typing indicators) changes.
export const LinkEmbed = memo(function LinkEmbed({ content }: LinkEmbedProps) {
  // Decode entities (e.g. `&amp;` in query strings) so URLs resolve correctly.
  const urls = extractUrls(decodeHtmlEntities(content));
  const url = urls[0] || "";
  const [preview, setPreview] = useState<{ title?: string; description?: string; thumbnail?: string; siteName?: string } | null>(null);

  useEffect(() => {
    if (!url || shouldSkipOEmbed(url)) {
      setPreview(null);
      return;
    }

    let active = true;
    setPreview(null);

    fetch(`/api/oembed?url=${encodeURIComponent(url)}`)
      .then(async (res) => {
        if (!res.ok) return null;
        return res.json();
      })
      .then((data) => {
        if (!active || !data) return;
        setPreview({
          title: data.title,
          description: data.description,
          thumbnail: data.thumbnail,
          siteName: data.siteName,
        });
      })
      .catch(() => {
        // best-effort preview only
      });

    return () => {
      active = false;
    };
  }, [url]);

  if (!url) return null;

  // Server invites get a rich join card instead of a generic link preview.
  const inviteCode = parseInviteCode(url);
  if (inviteCode) {
    return <InviteEmbed code={inviteCode} />;
  }

  // MessageContent already handles direct image/GIF URLs.
  if (isImageUrl(url)) {
    return null;
  }

  const urlType = getUrlType(url);

  if (urlType === "youtube") {
    const videoId = parseYouTubeUrl(url);
    if (videoId) {
      return <YouTubeEmbed videoId={videoId} url={url} />;
    }
  }

  if (urlType === "spotify") {
    const spotifyData = parseSpotifyUrl(url);
    if (spotifyData) {
      return <SpotifyEmbed type={spotifyData.type} id={spotifyData.id} url={url} />;
    }
  }

  if (urlType === "giphy") {
    const gifId = parseGiphyUrl(url);
    if (gifId) {
      return <GiphyEmbed gifId={gifId} url={url} />;
    }
  }

  if (urlType === "tenor") {
    const gifId = parseTenorUrl(url);
    if (gifId) {
      return <TenorEmbed gifId={gifId} url={url} preview={preview || undefined} />;
    }
  }

  if (urlType === "klipy") {
    return <KlipyEmbed url={url} preview={preview || undefined} />;
  }

  return <GenericEmbed url={url} preview={preview || undefined} />;
});

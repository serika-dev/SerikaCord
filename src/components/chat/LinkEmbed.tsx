"use client";

import { useEffect, useState, memo } from "react";
import { ExternalLink, Play } from "lucide-react";
import { useInView } from "@/hooks/useInView";
import { InviteEmbed, parseInviteCode } from "@/components/chat/InviteEmbed";
import { decodeHtmlEntities } from "@/lib/chat/messages";
import { GifFavoriteButton } from "@/components/chat/GifFavoriteButton";
import { useChatGt } from "./ChatGtContext";

// `referrerPolicy` isn't in React's <video> typings, but the DOM honors it —
// needed so hotlink-protected media (e.g. video.twimg.com) doesn't 403 on our
// referer. Spread as a cast to satisfy the type checker.
const NO_REFERRER = { referrerPolicy: "no-referrer" } as unknown as React.VideoHTMLAttributes<HTMLVideoElement>;

interface LinkEmbedProps {
  content: string;
  /** Opens a GIF in the in-app image viewer instead of the provider website. */
  onMediaClick?: (src: string, alt?: string) => void;
}

/** Shared media/badge layout for provider GIF embeds (Giphy/Tenor/Klipy). */
function GifEmbedFrame({
  gifSrc,
  alt,
  url,
  source,
  label,
  onMediaClick,
}: {
  gifSrc: string;
  alt: string;
  url: string;
  source: string;
  label: string;
  onMediaClick?: (src: string, alt?: string) => void;
}) {
  return (
    <div className="mt-2 inline-flex relative group rounded-lg overflow-hidden max-w-[400px] chat-gif-wrap">
      {onMediaClick ? (
        <button type="button" className="inline-flex" onClick={() => onMediaClick(gifSrc, alt)}>
          <img src={gifSrc} alt={alt} className="rounded-lg max-h-[300px] w-auto block cursor-pointer" loading="lazy" />
        </button>
      ) : (
        <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex">
          <img src={gifSrc} alt={alt} className="rounded-lg max-h-[300px] w-auto block" loading="lazy" />
        </a>
      )}
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="absolute bottom-1 right-1 px-2 py-0.5 bg-black/70 rounded text-[10px] text-white font-medium opacity-0 group-hover:opacity-100 transition-opacity hover:underline"
      >
        {label}
      </a>
      <div className="absolute top-2 right-2 z-10 opacity-0 group-hover:opacity-100 transition-opacity">
        <GifFavoriteButton url={gifSrc} title={alt} source={source} />
      </div>
    </div>
  );
}

const FIRST_PARTY_DOMAINS = [
  "serika.dev",
  "serika.chat",
  "serika.cc",
  "serika.video",
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

function getUrlType(url: string): "youtube" | "twitter" | "spotify" | "giphy" | "tenor" | "klipy" | "niconico" | "bilibili" | "serikavideo" | "vimeo" | "dailymotion" | "twitch" | "streamable" | "generic" {
  if (/youtube\.com|youtu\.be/.test(url)) return "youtube";
  if (/twitter\.com|x\.com|fixvx\.com|fixupx\.com|vxtwitter\.com|fxtwitter\.com|twittpr\.com/.test(url)) return "twitter";
  if (/open\.spotify\.com/.test(url)) return "spotify";
  if (/giphy\.com/.test(url)) return "giphy";
  if (/tenor\.com/.test(url)) return "tenor";
  if (/klipy\.com|klipy\.dev/.test(url)) return "klipy";
  if (/nicovideo\.jp|nico\.ms/.test(url)) return "niconico";
  if (/bilibili\.com|b23\.tv/.test(url)) return "bilibili";
  if (/serika\.video/.test(url)) return "serikavideo";
  if (/vimeo\.com/.test(url)) return "vimeo";
  if (/dailymotion\.com|dai\.ly/.test(url)) return "dailymotion";
  if (/twitch\.tv/.test(url)) return "twitch";
  if (/streamable\.com/.test(url)) return "streamable";
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

function parseNiconicoUrl(url: string): string | null {
  // https://www.nicovideo.jp/watch/sm12345678 or https://nico.ms/sm12345678
  const match = url.match(/(?:nicovideo\.jp\/watch\/|nico\.ms\/)([a-z]{0,2}\d+)/);
  return match ? match[1] : null;
}

function parseBilibiliUrl(url: string): { bvid: string | null; aid: string | null } {
  // https://www.bilibili.com/video/BV1xx411c7mD or https://b23.tv/shortlink
  const bvMatch = url.match(/bilibili\.com\/video\/(BV[a-zA-Z0-9]+)/);
  if (bvMatch) return { bvid: bvMatch[1], aid: null };
  const avMatch = url.match(/bilibili\.com\/video\/av(\d+)/);
  if (avMatch) return { bvid: null, aid: avMatch[1] };
  return { bvid: null, aid: null };
}

function YouTubeIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
    </svg>
  );
}

function YouTubeEmbed({ videoId, url }: { videoId: string; url: string }) {
  const [showPlayer, setShowPlayer] = useState(false);
  const thumbnailUrl = `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;
  const fallbackThumbnail = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
  const [imgSrc, setImgSrc] = useState(thumbnailUrl);
  const [title, setTitle] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch(`/api/oembed?url=${encodeURIComponent(url)}`)
      .then(async (res) => {
        if (!res.ok) return null;
        return res.json();
      })
      .then((data) => {
        if (!active || !data) return;
        if (data.title) setTitle(data.title);
      })
      .catch(() => {});
    return () => { active = false; };
  }, [url]);

  if (showPlayer) {
    return (
      <div className="mt-2 relative max-w-[480px] rounded-xl overflow-hidden bg-black shadow-xl">
        <div className="aspect-video">
          <iframe
            src={`https://www.youtube.com/embed/${videoId}?autoplay=1`}
            title={title || "YouTube video player"}
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
      className="mt-2 relative max-w-[480px] rounded-xl overflow-hidden cursor-pointer group bg-black shadow-lg"
      onClick={() => setShowPlayer(true)}
    >
      <img
        src={imgSrc}
        alt={title || "YouTube thumbnail"}
        loading="lazy"
        decoding="async"
        className="w-full aspect-video object-cover transition-transform group-hover:scale-[1.02] duration-300"
        onError={() => setImgSrc(fallbackThumbnail)}
      />
      <div className="absolute inset-0 flex items-center justify-center bg-black/20 group-hover:bg-black/40 transition-colors">
        <div className="w-16 h-16 rounded-full bg-[#FF0000] flex items-center justify-center shadow-2xl group-hover:scale-110 group-hover:bg-[#CC0000] transition-all duration-300">
          <Play className="w-7 h-7 text-white ml-1" fill="white" />
        </div>
      </div>
      {/* YouTube branded bottom bar */}
      <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between gap-2 px-3 py-2 bg-gradient-to-t from-black/90 via-black/60 to-transparent">
        <div className="flex items-center gap-2 min-w-0">
          <YouTubeIcon className="w-5 h-3.5 text-[#FF0000] shrink-0" />
          {title && (
            <span className="text-white text-xs font-medium truncate">{title}</span>
          )}
        </div>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="text-white/70 hover:text-white transition-colors shrink-0"
        >
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </div>
    </div>
  );
}

function NiconicoEmbed({ videoId, url }: { videoId: string; url: string }) {
  const [showPlayer, setShowPlayer] = useState(false);
  const [thumbSrc, setThumbSrc] = useState<string | null>(null);
  const [title, setTitle] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch(`/api/oembed?url=${encodeURIComponent(url)}`)
      .then(async (res) => {
        if (!res.ok) return null;
        return res.json();
      })
      .then((data) => {
        if (!active || !data) return;
        if (data.thumbnail) setThumbSrc(data.thumbnail);
        if (data.title) setTitle(data.title);
      })
      .catch(() => {});
    return () => { active = false; };
  }, [url]);

  if (showPlayer) {
    return (
      <div className="mt-2 relative max-w-[480px] rounded-xl overflow-hidden bg-black shadow-xl">
        <div className="aspect-video">
          <iframe
            src={`https://embed.nicovideo.jp/watch/${videoId}`}
            title="Niconico video player"
            allow="autoplay; fullscreen; encrypted-media"
            allowFullScreen
            referrerPolicy="no-referrer"
            className="w-full h-full border-0"
          />
        </div>
      </div>
    );
  }

  return (
    <div
      className="mt-2 relative max-w-[480px] rounded-xl overflow-hidden cursor-pointer group bg-black shadow-lg"
      onClick={() => setShowPlayer(true)}
    >
      {thumbSrc ? (
        <img
          src={thumbSrc}
          alt="Niconico thumbnail"
          loading="lazy"
          decoding="async"
          className="w-full aspect-video object-cover transition-transform group-hover:scale-[1.02] duration-300"
        />
      ) : (
        <div className="w-full aspect-video bg-gradient-to-br from-[#252525] to-[#0d0d0d] flex items-center justify-center">
          <div className="text-white/40 text-sm font-medium">niconico</div>
        </div>
      )}
      <div className="absolute inset-0 flex items-center justify-center bg-black/20 group-hover:bg-black/40 transition-colors">
        <div className="w-16 h-16 rounded-full bg-[#252525] border-2 border-white/80 flex items-center justify-center shadow-2xl group-hover:scale-110 transition-all duration-300">
          <Play className="w-7 h-7 text-white ml-1" fill="white" />
        </div>
      </div>
      {/* Niconico branded bottom bar */}
      <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between gap-2 px-3 py-2 bg-gradient-to-t from-black/90 via-black/60 to-transparent">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-white text-sm font-bold tracking-tight shrink-0">niconico</span>
          {title && (
            <span className="text-white/80 text-xs truncate">{title}</span>
          )}
        </div>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="text-white/70 hover:text-white transition-colors shrink-0"
        >
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </div>
    </div>
  );
}

function BilibiliEmbed({ bvid, aid, url }: { bvid: string | null; aid: string | null; url: string }) {
  const [showPlayer, setShowPlayer] = useState(false);
  // Bilibili embed URL — danmaku=0 disables bullet comments to reduce script overhead
  const embedUrl = bvid
    ? `https://player.bilibili.com/player.html?bvid=${bvid}&autoplay=1&high_quality=1&danmaku=0`
    : `https://player.bilibili.com/player.html?aid=${aid}&autoplay=1&high_quality=1&danmaku=0`;
  const [coverSrc, setCoverSrc] = useState<string | null>(null);
  const [title, setTitle] = useState<string | null>(null);

  useEffect(() => {
    if (!bvid && !aid) return;
    let active = true;
    fetch(`/api/oembed?url=${encodeURIComponent(url)}`)
      .then(async (res) => {
        if (!res.ok) return null;
        return res.json();
      })
      .then((data) => {
        if (!active || !data) return;
        if (data.thumbnail) setCoverSrc(data.thumbnail);
        if (data.title) setTitle(data.title);
      })
      .catch(() => {});
    return () => { active = false; };
  }, [url, bvid, aid]);

  if (showPlayer) {
    return (
      <div className="mt-2 relative max-w-[480px] rounded-xl overflow-hidden bg-black shadow-xl">
        <div className="aspect-video">
          <iframe
            src={embedUrl}
            title="Bilibili video player"
            allow="autoplay; fullscreen; encrypted-media"
            allowFullScreen
            referrerPolicy="no-referrer"
            className="w-full h-full border-0"
          />
        </div>
      </div>
    );
  }

  return (
    <div
      className="mt-2 relative max-w-[480px] rounded-xl overflow-hidden cursor-pointer group bg-black shadow-lg"
      onClick={() => setShowPlayer(true)}
    >
      {coverSrc ? (
        <img
          src={coverSrc}
          alt={title || "Bilibili thumbnail"}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          className="w-full aspect-video object-cover transition-transform group-hover:scale-[1.02] duration-300"
        />
      ) : (
        <div className="w-full aspect-video bg-gradient-to-br from-[#00A1D6]/20 to-[#FB7299]/20 flex items-center justify-center">
          <div className="text-[#00A1D6] text-sm font-medium">bilibili</div>
        </div>
      )}
      <div className="absolute inset-0 flex items-center justify-center bg-black/20 group-hover:bg-black/40 transition-colors">
        <div className="w-16 h-16 rounded-full bg-[#00A1D6] flex items-center justify-center shadow-2xl group-hover:scale-110 group-hover:bg-[#0091C2] transition-all duration-300">
          <Play className="w-7 h-7 text-white ml-1" fill="white" />
        </div>
      </div>
      {/* Bilibili branded bottom bar */}
      <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between gap-2 px-3 py-2 bg-gradient-to-t from-black/90 via-black/60 to-transparent">
        <div className="flex items-center gap-2 min-w-0">
          {/* Bilibili TV icon */}
          <div className="w-5 h-5 rounded bg-[#00A1D6] flex items-center justify-center shrink-0">
            <Play className="w-2.5 h-2.5 text-white ml-0.5" fill="white" />
          </div>
          <span className="text-white text-sm font-semibold tracking-tight shrink-0">bilibili</span>
          {title && (
            <span className="text-white/80 text-xs truncate">{title}</span>
          )}
        </div>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="text-white/70 hover:text-white transition-colors shrink-0"
        >
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </div>
    </div>
  );
}

function parseSerikaVideoUrl(url: string): string | null {
  // https://serika.video/watch/{id} or https://serika.video/embed/{id}
  const watchMatch = url.match(/serika\.video\/watch\/([a-zA-Z0-9]+)/);
  if (watchMatch) return watchMatch[1];
  const embedMatch = url.match(/serika\.video\/embed\/([a-zA-Z0-9]+)/);
  if (embedMatch) return embedMatch[1];
  return null;
}

function parseVimeoUrl(url: string): string | null {
  // https://vimeo.com/{id} or https://player.vimeo.com/video/{id}
  const match = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  return match ? match[1] : null;
}

function parseDailymotionUrl(url: string): string | null {
  // https://www.dailymotion.com/video/{id} or https://dai.ly/{id}
  const videoMatch = url.match(/dailymotion\.com\/video\/([a-zA-Z0-9]+)/);
  if (videoMatch) return videoMatch[1];
  const shortMatch = url.match(/dai\.ly\/([a-zA-Z0-9]+)/);
  if (shortMatch) return shortMatch[1];
  return null;
}

function parseTwitchUrl(url: string): { type: "clip" | "vod"; id: string; parent: string } | null {
  // Clips: https://clips.twitch.tv/{slug} or https://www.twitch.tv/{channel}/clip/{slug}
  const clipMatch = url.match(/clips\.twitch\.tv\/([a-zA-Z0-9_-]+)/);
  if (clipMatch) return { type: "clip", id: clipMatch[1], parent: "localhost" };
  const channelClipMatch = url.match(/twitch\.tv\/[^/]+\/clip\/([a-zA-Z0-9_-]+)/);
  if (channelClipMatch) return { type: "clip", id: channelClipMatch[1], parent: "localhost" };
  // VODs: https://www.twitch.tv/videos/{id}
  const vodMatch = url.match(/twitch\.tv\/videos\/(\d+)/);
  if (vodMatch) return { type: "vod", id: vodMatch[1], parent: "localhost" };
  return null;
}

function parseStreamableUrl(url: string): string | null {
  // https://streamable.com/{id}
  const match = url.match(/streamable\.com\/([a-zA-Z0-9]+)/);
  return match ? match[1] : null;
}

function SerikaVideoEmbed({ videoId, url }: { videoId: string; url: string }) {
  const [showPlayer, setShowPlayer] = useState(false);
  const [thumbSrc, setThumbSrc] = useState<string | null>(null);
  const [title, setTitle] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch(`/api/oembed?url=${encodeURIComponent(url)}`)
      .then(async (res) => {
        if (!res.ok) return null;
        return res.json();
      })
      .then((data) => {
        if (!active || !data) return;
        if (data.thumbnail) setThumbSrc(data.thumbnail);
        if (data.title) setTitle(data.title);
      })
      .catch(() => {});
    return () => { active = false; };
  }, [url]);

  if (showPlayer) {
    return (
      <div className="mt-2 relative max-w-[480px] rounded-xl overflow-hidden bg-black shadow-xl">
        <div className="aspect-video">
          <iframe
            src={`https://serika.video/embed/${videoId}`}
            title={title || "Serika Video player"}
            allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
            allowFullScreen
            className="w-full h-full border-0"
          />
        </div>
      </div>
    );
  }

  return (
    <div
      className="mt-2 relative max-w-[480px] rounded-xl overflow-hidden cursor-pointer group bg-black shadow-lg"
      onClick={() => setShowPlayer(true)}
    >
      {thumbSrc ? (
        <img
          src={thumbSrc}
          alt={title || "Serika Video thumbnail"}
          loading="lazy"
          decoding="async"
          className="w-full aspect-video object-cover transition-transform group-hover:scale-[1.02] duration-300"
        />
      ) : (
        <div className="w-full aspect-video bg-gradient-to-br from-[#8B5CF6]/20 to-[#6366f1]/20 flex items-center justify-center">
          <div className="text-[#a78bfa] text-sm font-medium">Serika Video</div>
        </div>
      )}
      <div className="absolute inset-0 flex items-center justify-center bg-black/20 group-hover:bg-black/40 transition-colors">
        <div className="w-16 h-16 rounded-full bg-[#8B5CF6] flex items-center justify-center shadow-2xl group-hover:scale-110 group-hover:bg-[#7C3AED] transition-all duration-300">
          <Play className="w-7 h-7 text-white ml-1" fill="white" />
        </div>
      </div>
      <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between gap-2 px-3 py-2 bg-gradient-to-t from-black/90 via-black/60 to-transparent">
        <div className="flex items-center gap-2 min-w-0">
          <img
            src="https://serika.moe/favicon.ico"
            alt="Serika"
            width={18}
            height={18}
            className="shrink-0 object-contain"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
              const parent = (e.target as HTMLImageElement).parentElement;
              if (parent) {
                parent.innerHTML = `<span style="font-size:16px;line-height:1;color:#8B5CF6">✦</span>`;
              }
            }}
          />
          <span className="text-white text-sm font-semibold tracking-tight shrink-0">Serika Video</span>
          {title && (
            <span className="text-white/80 text-xs truncate">{title}</span>
          )}
        </div>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="text-white/70 hover:text-white transition-colors shrink-0"
        >
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </div>
    </div>
  );
}

function VimeoEmbed({ videoId, url }: { videoId: string; url: string }) {
  const [showPlayer, setShowPlayer] = useState(false);
  const [thumbSrc, setThumbSrc] = useState<string | null>(null);
  const [title, setTitle] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch(`/api/oembed?url=${encodeURIComponent(url)}`)
      .then(async (res) => {
        if (!res.ok) return null;
        return res.json();
      })
      .then((data) => {
        if (!active || !data) return;
        if (data.thumbnail) setThumbSrc(data.thumbnail);
        if (data.title) setTitle(data.title);
      })
      .catch(() => {});
    return () => { active = false; };
  }, [url]);

  if (showPlayer) {
    return (
      <div className="mt-2 relative max-w-[480px] rounded-xl overflow-hidden bg-black shadow-xl">
        <div className="aspect-video">
          <iframe
            src={`https://player.vimeo.com/video/${videoId}?autoplay=1`}
            title={title || "Vimeo video player"}
            allow="autoplay; fullscreen; picture-in-picture"
            allowFullScreen
            className="w-full h-full border-0"
          />
        </div>
      </div>
    );
  }

  return (
    <div
      className="mt-2 relative max-w-[480px] rounded-xl overflow-hidden cursor-pointer group bg-black shadow-lg"
      onClick={() => setShowPlayer(true)}
    >
      {thumbSrc ? (
        <img
          src={thumbSrc}
          alt={title || "Vimeo thumbnail"}
          loading="lazy"
          decoding="async"
          className="w-full aspect-video object-cover transition-transform group-hover:scale-[1.02] duration-300"
        />
      ) : (
        <div className="w-full aspect-video bg-gradient-to-br from-[#1AB7EA]/20 to-[#0d0d0d] flex items-center justify-center">
          <div className="text-[#1AB7EA] text-sm font-medium">Vimeo</div>
        </div>
      )}
      <div className="absolute inset-0 flex items-center justify-center bg-black/20 group-hover:bg-black/40 transition-colors">
        <div className="w-16 h-16 rounded-full bg-[#1AB7EA] flex items-center justify-center shadow-2xl group-hover:scale-110 transition-all duration-300">
          <Play className="w-7 h-7 text-white ml-1" fill="white" />
        </div>
      </div>
      <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between gap-2 px-3 py-2 bg-gradient-to-t from-black/90 via-black/60 to-transparent">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[#1AB7EA] text-sm font-bold tracking-tight shrink-0">Vimeo</span>
          {title && (
            <span className="text-white/80 text-xs truncate">{title}</span>
          )}
        </div>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="text-white/70 hover:text-white transition-colors shrink-0"
        >
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </div>
    </div>
  );
}

function DailymotionEmbed({ videoId, url }: { videoId: string; url: string }) {
  const [showPlayer, setShowPlayer] = useState(false);
  const [thumbSrc, setThumbSrc] = useState<string | null>(null);
  const [title, setTitle] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch(`/api/oembed?url=${encodeURIComponent(url)}`)
      .then(async (res) => {
        if (!res.ok) return null;
        return res.json();
      })
      .then((data) => {
        if (!active || !data) return;
        if (data.thumbnail) setThumbSrc(data.thumbnail);
        if (data.title) setTitle(data.title);
      })
      .catch(() => {});
    return () => { active = false; };
  }, [url]);

  if (showPlayer) {
    return (
      <div className="mt-2 relative max-w-[480px] rounded-xl overflow-hidden bg-black shadow-xl">
        <div className="aspect-video">
          <iframe
            src={`https://www.dailymotion.com/embed/video/${videoId}?autoplay=1`}
            title={title || "Dailymotion video player"}
            allow="autoplay; fullscreen; encrypted-media"
            allowFullScreen
            className="w-full h-full border-0"
          />
        </div>
      </div>
    );
  }

  return (
    <div
      className="mt-2 relative max-w-[480px] rounded-xl overflow-hidden cursor-pointer group bg-black shadow-lg"
      onClick={() => setShowPlayer(true)}
    >
      {thumbSrc ? (
        <img
          src={thumbSrc}
          alt={title || "Dailymotion thumbnail"}
          loading="lazy"
          decoding="async"
          className="w-full aspect-video object-cover transition-transform group-hover:scale-[1.02] duration-300"
        />
      ) : (
        <div className="w-full aspect-video bg-gradient-to-br from-[#0066DC]/20 to-[#0d0d0d] flex items-center justify-center">
          <div className="text-[#0066DC] text-sm font-medium">Dailymotion</div>
        </div>
      )}
      <div className="absolute inset-0 flex items-center justify-center bg-black/20 group-hover:bg-black/40 transition-colors">
        <div className="w-16 h-16 rounded-full bg-[#0066DC] flex items-center justify-center shadow-2xl group-hover:scale-110 transition-all duration-300">
          <Play className="w-7 h-7 text-white ml-1" fill="white" />
        </div>
      </div>
      <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between gap-2 px-3 py-2 bg-gradient-to-t from-black/90 via-black/60 to-transparent">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[#0066DC] text-sm font-bold tracking-tight shrink-0">Dailymotion</span>
          {title && (
            <span className="text-white/80 text-xs truncate">{title}</span>
          )}
        </div>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="text-white/70 hover:text-white transition-colors shrink-0"
        >
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </div>
    </div>
  );
}

function TwitchEmbed({ clipId, vodId, url }: { clipId: string | null; vodId: string | null; url: string }) {
  const [showPlayer, setShowPlayer] = useState(false);
  const [thumbSrc, setThumbSrc] = useState<string | null>(null);
  const [title, setTitle] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch(`/api/oembed?url=${encodeURIComponent(url)}`)
      .then(async (res) => {
        if (!res.ok) return null;
        return res.json();
      })
      .then((data) => {
        if (!active || !data) return;
        if (data.thumbnail) setThumbSrc(data.thumbnail);
        if (data.title) setTitle(data.title);
      })
      .catch(() => {});
    return () => { active = false; };
  }, [url]);

  const embedSrc = clipId
    ? `https://clips.twitch.tv/embed?clip=${clipId}&parent=localhost`
    : `https://player.twitch.tv/?video=${vodId}&parent=localhost&autoplay=true`;

  if (showPlayer) {
    return (
      <div className="mt-2 relative max-w-[480px] rounded-xl overflow-hidden bg-black shadow-xl">
        <div className="aspect-video">
          <iframe
            src={embedSrc}
            title={title || "Twitch video player"}
            allow="autoplay; fullscreen"
            allowFullScreen
            className="w-full h-full border-0"
          />
        </div>
      </div>
    );
  }

  return (
    <div
      className="mt-2 relative max-w-[480px] rounded-xl overflow-hidden cursor-pointer group bg-black shadow-lg"
      onClick={() => setShowPlayer(true)}
    >
      {thumbSrc ? (
        <img
          src={thumbSrc}
          alt={title || "Twitch thumbnail"}
          loading="lazy"
          decoding="async"
          className="w-full aspect-video object-cover transition-transform group-hover:scale-[1.02] duration-300"
        />
      ) : (
        <div className="w-full aspect-video bg-gradient-to-br from-[#9146FF]/20 to-[#0d0d0d] flex items-center justify-center">
          <div className="text-[#9146FF] text-sm font-medium">Twitch</div>
        </div>
      )}
      <div className="absolute inset-0 flex items-center justify-center bg-black/20 group-hover:bg-black/40 transition-colors">
        <div className="w-16 h-16 rounded-full bg-[#9146FF] flex items-center justify-center shadow-2xl group-hover:scale-110 transition-all duration-300">
          <Play className="w-7 h-7 text-white ml-1" fill="white" />
        </div>
      </div>
      <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between gap-2 px-3 py-2 bg-gradient-to-t from-black/90 via-black/60 to-transparent">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[#9146FF] text-sm font-bold tracking-tight shrink-0">Twitch</span>
          {title && (
            <span className="text-white/80 text-xs truncate">{title}</span>
          )}
        </div>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="text-white/70 hover:text-white transition-colors shrink-0"
        >
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </div>
    </div>
  );
}

function StreamableEmbed({ videoId, url }: { videoId: string; url: string }) {
  const [showPlayer, setShowPlayer] = useState(false);
  const [thumbSrc, setThumbSrc] = useState<string | null>(null);
  const [title, setTitle] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch(`/api/oembed?url=${encodeURIComponent(url)}`)
      .then(async (res) => {
        if (!res.ok) return null;
        return res.json();
      })
      .then((data) => {
        if (!active || !data) return;
        if (data.thumbnail) setThumbSrc(data.thumbnail);
        if (data.title) setTitle(data.title);
      })
      .catch(() => {});
    return () => { active = false; };
  }, [url]);

  if (showPlayer) {
    return (
      <div className="mt-2 relative max-w-[480px] rounded-xl overflow-hidden bg-black shadow-xl">
        <div className="aspect-video">
          <iframe
            src={`https://streamable.com/e/${videoId}?autoplay=1`}
            title={title || "Streamable video player"}
            allow="autoplay; fullscreen"
            allowFullScreen
            className="w-full h-full border-0"
          />
        </div>
      </div>
    );
  }

  return (
    <div
      className="mt-2 relative max-w-[480px] rounded-xl overflow-hidden cursor-pointer group bg-black shadow-lg"
      onClick={() => setShowPlayer(true)}
    >
      {thumbSrc ? (
        <img
          src={thumbSrc}
          alt={title || "Streamable thumbnail"}
          loading="lazy"
          decoding="async"
          className="w-full aspect-video object-cover transition-transform group-hover:scale-[1.02] duration-300"
        />
      ) : (
        <div className="w-full aspect-video bg-gradient-to-br from-[#0f9d58]/20 to-[#0d0d0d] flex items-center justify-center">
          <div className="text-[#0f9d58] text-sm font-medium">Streamable</div>
        </div>
      )}
      <div className="absolute inset-0 flex items-center justify-center bg-black/20 group-hover:bg-black/40 transition-colors">
        <div className="w-16 h-16 rounded-full bg-[#0f9d58] flex items-center justify-center shadow-2xl group-hover:scale-110 transition-all duration-300">
          <Play className="w-7 h-7 text-white ml-1" fill="white" />
        </div>
      </div>
      <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between gap-2 px-3 py-2 bg-gradient-to-t from-black/90 via-black/60 to-transparent">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[#0f9d58] text-sm font-bold tracking-tight shrink-0">Streamable</span>
          {title && (
            <span className="text-white/80 text-xs truncate">{title}</span>
          )}
        </div>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="text-white/70 hover:text-white transition-colors shrink-0"
        >
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </div>
    </div>
  );
}

interface OEmbedData {
  title?: string;
  description?: string;
  thumbnail?: string;
  thumbnailWidth?: number;
  thumbnailHeight?: number;
  siteName?: string;
  type?: string;
  video?: string;
  videoWidth?: number;
  videoHeight?: number;
  author?: string;
  authorUrl?: string;
  provider?: string;
}

function XLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

/**
 * Rich Twitter/X card. Loads tweet media (photos + a direct mp4 for videos)
 * from the oEmbed endpoint, which resolves via the fxtwitter API — so videos
 * play inline instead of linking out. Works for x.com/twitter.com and the
 * fixvx / fixupx / vxtwitter proxy links.
 */
function TwitterEmbed({ url }: { url: string }) {
  const [data, setData] = useState<OEmbedData | null>(null);
  const [failed, setFailed] = useState(false);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    let active = true;
    setData(null);
    setFailed(false);
    setPlaying(false);
    fetch(`/api/oembed?url=${encodeURIComponent(url)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((d: OEmbedData | null) => {
        if (!active) return;
        if (!d || (!d.title && !d.description && !d.thumbnail)) { setFailed(true); return; }
        setData(d);
      })
      .catch(() => active && setFailed(true));
    return () => { active = false; };
  }, [url]);

  if (failed) return <GenericEmbed url={url} />;

  if (!data) {
    return (
      <div className="mt-2 max-w-[520px] rounded-xl border border-white/10 bg-[#16181c] p-4 animate-pulse">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-full bg-white/10" />
          <div className="flex-1 space-y-1.5">
            <div className="h-2.5 w-32 bg-white/10 rounded" />
            <div className="h-2 w-20 bg-white/5 rounded" />
          </div>
        </div>
        <div className="mt-3 h-3 w-3/4 bg-white/10 rounded" />
      </div>
    );
  }

  // title is "Display Name (@handle)" — split it back apart for layout.
  const nameMatch = data.title?.match(/^(.*?)\s*\((@[^)]+)\)\s*$/);
  const displayName = nameMatch?.[1] || data.author || data.title || "Twitter";
  const handle = nameMatch?.[2];
  const hasVideo = !!data.video;

  return (
    <div className="mt-2 max-w-[520px] rounded-xl border border-white/10 bg-[#16181c] overflow-hidden">
      <div className="p-3.5">
        {/* Author row */}
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="flex items-center gap-2.5 min-w-0">
            {data.thumbnail && !hasVideo && data.type === "article" ? null : null}
            <div className="min-w-0">
              <div className="text-white text-sm font-bold leading-tight truncate">{displayName}</div>
              {handle && <div className="text-[#71767b] text-xs leading-tight truncate">{handle}</div>}
            </div>
          </div>
          <XLogo className="w-5 h-5 text-white shrink-0" />
        </div>

        {/* Tweet text */}
        {data.description && (
          <div className="text-[#e7e9ea] text-[15px] leading-normal whitespace-pre-wrap break-words">
            {data.description}
          </div>
        )}
      </div>

      {/* Media */}
      {hasVideo ? (
        <div className="px-3.5 pb-3">
          {playing ? (
            <video
              src={data.video}
              controls
              autoPlay
              playsInline
              poster={data.thumbnail}
              {...NO_REFERRER}
              className="w-full max-h-[420px] rounded-xl bg-black block"
            />
          ) : (
            <button
              type="button"
              onClick={() => setPlaying(true)}
              className="relative block w-full rounded-xl overflow-hidden bg-black group"
            >
              {data.thumbnail ? (
                <img src={data.thumbnail} alt="" referrerPolicy="no-referrer" className="w-full max-h-[420px] object-cover" loading="lazy" />
              ) : (
                <div className="w-full aspect-video" />
              )}
              <div className="absolute inset-0 flex items-center justify-center bg-black/20 group-hover:bg-black/30 transition-colors">
                <div className="w-16 h-16 rounded-full bg-black/70 border border-white/30 flex items-center justify-center group-hover:scale-110 transition-transform">
                  <Play className="w-7 h-7 text-white ml-1" fill="white" />
                </div>
              </div>
            </button>
          )}
        </div>
      ) : (
        data.thumbnail && (
          <div className="px-3.5 pb-3">
            <img src={data.thumbnail} alt="" referrerPolicy="no-referrer" className="w-full max-h-[420px] object-cover rounded-xl" loading="lazy" />
          </div>
        )
      )}

      {/* Footer: engagement + link */}
      <div className="flex items-center justify-between gap-2 px-3.5 py-2.5 border-t border-white/5">
        <span className="text-[#71767b] text-xs truncate">{data.provider || (data.siteName || "X")}</span>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[#71767b] hover:text-white transition-colors shrink-0 inline-flex items-center gap-1 text-xs"
        >
          {data.siteName || "X"}
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </div>
    </div>
  );
}

function GenericEmbed({
  url,
  preview,
}: {
  url: string;
  preview?: OEmbedData;
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
      {preview?.video ? (
        <video
          src={preview.video}
          controls
          playsInline
          poster={preview.thumbnail}
          {...NO_REFERRER}
          className="w-full max-h-72 bg-black block"
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        preview?.thumbnail && (
          <img
            src={preview.thumbnail}
            alt={preview.title || "Link preview"}
            className="w-full max-h-52 object-cover"
            loading="lazy"
          />
        )
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

function GiphyEmbed({ gifId, url, onMediaClick }: { gifId: string; url: string; onMediaClick?: (src: string, alt?: string) => void }) {
  const gifUrl = `https://media.giphy.com/media/${gifId}/giphy.gif`;
  return (
    <GifEmbedFrame gifSrc={gifUrl} alt="Giphy GIF" url={url} source="giphy" label="GIPHY" onMediaClick={onMediaClick} />
  );
}

function TenorEmbed({ gifId, url, preview, onMediaClick }: { gifId: string; url: string; preview?: { title?: string; description?: string; thumbnail?: string; siteName?: string }; onMediaClick?: (src: string, alt?: string) => void }) {
  const gt = useChatGt();
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
        <div className="text-white text-sm">{gt("View GIF on Tenor")}</div>
      </a>
    );
  }

  return (
    <GifEmbedFrame gifSrc={gifSrc} alt={preview?.title || "Tenor GIF"} url={url} source="tenor" label="Tenor" onMediaClick={onMediaClick} />
  );
}

function KlipyEmbed({ url, preview, onMediaClick }: { url: string; preview?: { title?: string; description?: string; thumbnail?: string; siteName?: string }; onMediaClick?: (src: string, alt?: string) => void }) {
  const gt = useChatGt();
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
        <div className="text-white text-sm">{gt("View GIF on Klipy")}</div>
      </a>
    );
  }

  return (
    <GifEmbedFrame gifSrc={gifSrc} alt={preview?.title || "Klipy GIF"} url={url} source="klipy" label="Klipy" onMediaClick={onMediaClick} />
  );
}

// Memoized: embeds fetch previews and must not re-run while unrelated chat
// state (composer text, typing indicators) changes.
export const LinkEmbed = memo(function LinkEmbed({ content, onMediaClick }: LinkEmbedProps) {
  // Decode entities (e.g. `&amp;` in query strings) so URLs resolve correctly.
  const urls = extractUrls(decodeHtmlEntities(content));
  const url = urls[0] || "";
  const [preview, setPreview] = useState<OEmbedData | null>(null);
  // Defer the link-preview fetch until the embed is near the viewport, so a
  // link-heavy channel doesn't fire every oembed request at once on open.
  const [genericRef, inView] = useInView<HTMLDivElement>();

  useEffect(() => {
    // Twitter/X is rendered by TwitterEmbed, which fetches its own richer data.
    if (!url || shouldSkipOEmbed(url) || getUrlType(url) === "twitter") {
      setPreview(null);
      return;
    }
    if (!inView) return;

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
          thumbnailWidth: data.thumbnailWidth,
          thumbnailHeight: data.thumbnailHeight,
          siteName: data.siteName,
          type: data.type,
          video: data.video,
          videoWidth: data.videoWidth,
          videoHeight: data.videoHeight,
          author: data.author,
          authorUrl: data.authorUrl,
          provider: data.provider,
        });
      })
      .catch(() => {
        // best-effort preview only
      });

    return () => {
      active = false;
    };
  }, [url, inView]);

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

  if (urlType === "niconico") {
    const videoId = parseNiconicoUrl(url);
    if (videoId) {
      return <NiconicoEmbed videoId={videoId} url={url} />;
    }
  }

  if (urlType === "bilibili") {
    const { bvid, aid } = parseBilibiliUrl(url);
    if (bvid || aid) {
      return <BilibiliEmbed bvid={bvid} aid={aid} url={url} />;
    }
  }

  if (urlType === "serikavideo") {
    const videoId = parseSerikaVideoUrl(url);
    if (videoId) {
      return <SerikaVideoEmbed videoId={videoId} url={url} />;
    }
  }

  if (urlType === "vimeo") {
    const videoId = parseVimeoUrl(url);
    if (videoId) {
      return <VimeoEmbed videoId={videoId} url={url} />;
    }
  }

  if (urlType === "dailymotion") {
    const videoId = parseDailymotionUrl(url);
    if (videoId) {
      return <DailymotionEmbed videoId={videoId} url={url} />;
    }
  }

  if (urlType === "twitch") {
    const twitchData = parseTwitchUrl(url);
    if (twitchData) {
      return <TwitchEmbed clipId={twitchData.type === "clip" ? twitchData.id : null} vodId={twitchData.type === "vod" ? twitchData.id : null} url={url} />;
    }
  }

  if (urlType === "streamable") {
    const videoId = parseStreamableUrl(url);
    if (videoId) {
      return <StreamableEmbed videoId={videoId} url={url} />;
    }
  }

  if (urlType === "twitter") {
    return <TwitterEmbed url={url} />;
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
      return <GiphyEmbed gifId={gifId} url={url} onMediaClick={onMediaClick} />;
    }
  }

  if (urlType === "tenor") {
    const gifId = parseTenorUrl(url);
    if (gifId) {
      return <TenorEmbed gifId={gifId} url={url} preview={preview || undefined} onMediaClick={onMediaClick} />;
    }
  }

  if (urlType === "klipy") {
    return <KlipyEmbed url={url} preview={preview || undefined} onMediaClick={onMediaClick} />;
  }

  // Wrapper carries the visibility sensor so the oembed fetch above only fires
  // once this generic card nears the viewport.
  return (
    <div ref={genericRef}>
      <GenericEmbed url={url} preview={preview || undefined} />
    </div>
  );
});

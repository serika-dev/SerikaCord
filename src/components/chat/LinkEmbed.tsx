"use client";

import { useState } from "react";
import { ExternalLink, Play, X } from "lucide-react";

interface LinkEmbedProps {
  content: string;
}

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

function getUrlType(url: string): "youtube" | "twitter" | "generic" {
  if (/youtube\.com|youtu\.be/.test(url)) return "youtube";
  if (/twitter\.com|x\.com/.test(url)) return "twitter";
  return "generic";
}

function isImageUrl(url: string): boolean {
  return /\.(gif|jpg|jpeg|png|webp|svg|bmp)(\?.*)?$/i.test(url);
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

function GenericEmbed({ url }: { url: string }) {
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
      <div className="p-3">
        <div className="flex items-center gap-2 text-xs text-[#8B5CF6] font-medium mb-1">
          <span>{hostname}</span>
          <ExternalLink className="w-3 h-3 opacity-70" />
        </div>
        {pathname && <div className="text-[#888888] text-xs line-clamp-2 break-all">{pathname}</div>}
      </div>
    </a>
  );
}

export function LinkEmbed({ content }: LinkEmbedProps) {
  const urls = extractUrls(content);

  if (urls.length === 0) return null;

  const url = urls[0];

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

  return <GenericEmbed url={url} />;
}

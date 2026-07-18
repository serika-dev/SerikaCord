"use client";

import { memo } from "react";
import { ExternalLink } from "lucide-react";
import type { MessageEmbed } from "@/lib/chat/types";
import { decodeHtmlEntities } from "@/lib/chat/messages";

interface RichEmbedProps {
  embeds?: MessageEmbed[];
  onMediaClick?: (src: string, alt?: string) => void;
}

const DEFAULT_ACCENT = "#8B5CF6";

// `referrerPolicy` isn't in React's <video> typings but the DOM honors it —
// stops hotlink-protected media (e.g. video.twimg.com) 403ing on our referer.
const NO_REFERRER = { referrerPolicy: "no-referrer" } as unknown as React.VideoHTMLAttributes<HTMLVideoElement>;

/** Convert an integer Discord color (0xRRGGBB) into a CSS hex string. */
function colorToHex(color?: number): string {
  if (typeof color !== "number" || !Number.isFinite(color)) return DEFAULT_ACCENT;
  const clamped = Math.max(0, Math.min(0xffffff, Math.floor(color)));
  return `#${clamped.toString(16).padStart(6, "0")}`;
}

/** Very small, safe markdown-ish renderer for embed text (links + bold/italics). */
function EmbedText({ text, className }: { text: string; className?: string }) {
  const decoded = decodeHtmlEntities(text);
  // Split on markdown links [label](url) and autolink bare URLs.
  const parts: React.ReactNode[] = [];
  const linkRegex = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s]+)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = linkRegex.exec(decoded)) !== null) {
    if (match.index > last) parts.push(decoded.slice(last, match.index));
    if (match[1] && match[2]) {
      parts.push(
        <a key={key++} href={match[2]} target="_blank" rel="noopener noreferrer" className="text-[#8B5CF6] hover:underline">
          {match[1]}
        </a>,
      );
    } else if (match[3]) {
      parts.push(
        <a key={key++} href={match[3]} target="_blank" rel="noopener noreferrer" className="text-[#8B5CF6] hover:underline break-all">
          {match[3]}
        </a>,
      );
    }
    last = linkRegex.lastIndex;
  }
  if (last < decoded.length) parts.push(decoded.slice(last));
  return <div className={className} style={{ whiteSpace: "pre-wrap" }}>{parts}</div>;
}

function SingleEmbed({ embed, onMediaClick }: { embed: MessageEmbed; onMediaClick?: (src: string, alt?: string) => void }) {
  const accent = colorToHex(embed.color);
  const footerIcon = embed.footer?.icon_url || embed.footer?.iconUrl;
  const authorIcon = embed.author?.icon_url || embed.author?.iconUrl;
  const imageUrl = embed.image?.url;
  const thumbUrl = embed.thumbnail?.url;
  const videoUrl = embed.video?.url;
  const hasBody = embed.title || embed.description || embed.author?.name || (embed.fields && embed.fields.length > 0) || embed.footer?.text;

  // "image"-only embeds (e.g. attachment image embeds) render as a bare media card.
  if (!hasBody && (imageUrl || videoUrl)) {
    return (
      <div className="mt-2 inline-block max-w-[432px] rounded-lg overflow-hidden bg-black">
        {videoUrl ? (
          <video src={videoUrl} controls playsInline {...NO_REFERRER} className="block max-h-[360px] w-auto rounded-lg" />
        ) : (
          <button type="button" onClick={() => imageUrl && onMediaClick?.(imageUrl, embed.title)} className="block">
            <img src={imageUrl} alt={embed.title || "Embed image"} className="block max-h-[360px] w-auto rounded-lg cursor-pointer" loading="lazy" />
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      className="mt-2 max-w-[520px] rounded-md overflow-hidden grid"
      style={{ background: "var(--app-embed-bg, #1a1a1a)", borderLeft: `4px solid ${accent}` }}
    >
      <div className="grid gap-2 p-3" style={{ gridTemplateColumns: thumbUrl ? "minmax(0,1fr) auto" : "minmax(0,1fr)" }}>
        <div className="min-w-0">
          {embed.author?.name && (
            <div className="flex items-center gap-2 mb-1.5">
              {authorIcon && <img src={authorIcon} alt="" className="w-5 h-5 rounded-full object-cover" loading="lazy" />}
              {embed.author.url ? (
                <a href={embed.author.url} target="_blank" rel="noopener noreferrer" className="text-white text-xs font-semibold hover:underline">
                  {embed.author.name}
                </a>
              ) : (
                <span className="text-white text-xs font-semibold">{embed.author.name}</span>
              )}
            </div>
          )}

          {embed.title && (
            <div className="mb-1">
              {embed.url ? (
                <a href={embed.url} target="_blank" rel="noopener noreferrer" className="text-[#8B5CF6] hover:underline font-semibold text-[15px] inline-flex items-center gap-1">
                  {decodeHtmlEntities(embed.title)}
                  <ExternalLink className="w-3 h-3 opacity-60" />
                </a>
              ) : (
                <span className="text-white font-semibold text-[15px]">{decodeHtmlEntities(embed.title)}</span>
              )}
            </div>
          )}

          {embed.description && (
            <EmbedText text={embed.description} className="text-[#c8c8c8] text-sm leading-snug" />
          )}

          {embed.fields && embed.fields.length > 0 && (
            <div className="mt-2 grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(0, 1fr))" }}>
              {(() => {
                // Group inline fields into rows of up to 3; block fields span full width.
                const rows: MessageEmbed["fields"][] = [];
                let current: NonNullable<MessageEmbed["fields"]> = [];
                for (const f of embed.fields!) {
                  if (f.inline) {
                    current.push(f);
                    if (current.length === 3) { rows.push(current); current = []; }
                  } else {
                    if (current.length) { rows.push(current); current = []; }
                    rows.push([f]);
                  }
                }
                if (current.length) rows.push(current);
                return rows.map((row, ri) => (
                  <div key={ri} className="grid gap-2" style={{ gridTemplateColumns: `repeat(${row!.length}, minmax(0, 1fr))` }}>
                    {row!.map((f, fi) => (
                      <div key={fi} className="min-w-0">
                        <div className="text-white text-xs font-semibold mb-0.5">{decodeHtmlEntities(f.name)}</div>
                        <EmbedText text={f.value} className="text-[#c8c8c8] text-xs leading-snug" />
                      </div>
                    ))}
                  </div>
                ));
              })()}
            </div>
          )}
        </div>

        {thumbUrl && (
          <button type="button" onClick={() => onMediaClick?.(thumbUrl, embed.title)} className="shrink-0 self-start">
            <img src={thumbUrl} alt="" className="w-20 h-20 rounded-md object-cover cursor-pointer" loading="lazy" />
          </button>
        )}
      </div>

      {videoUrl && (
        <div className="px-3 pb-3">
          <video src={videoUrl} controls playsInline {...NO_REFERRER} className="block max-h-[300px] w-full rounded-md bg-black" poster={imageUrl} />
        </div>
      )}

      {!videoUrl && imageUrl && (
        <div className="px-3 pb-3">
          <button type="button" onClick={() => onMediaClick?.(imageUrl, embed.title)} className="block w-full">
            <img src={imageUrl} alt={embed.title || "Embed image"} className="block max-h-[300px] w-full object-cover rounded-md cursor-pointer" loading="lazy" />
          </button>
        </div>
      )}

      {(embed.footer?.text || embed.timestamp) && (
        <div className="flex items-center gap-2 px-3 pb-3 -mt-1">
          {footerIcon && <img src={footerIcon} alt="" className="w-4 h-4 rounded-full object-cover" loading="lazy" />}
          <span className="text-[#888] text-[11px]">
            {embed.footer?.text}
            {embed.footer?.text && embed.timestamp ? " • " : ""}
            {embed.timestamp ? new Date(embed.timestamp).toLocaleString() : ""}
          </span>
        </div>
      )}
    </div>
  );
}

/** Renders bot-authored rich embeds (Discord embed format) below a message. */
export const RichEmbed = memo(function RichEmbed({ embeds, onMediaClick }: RichEmbedProps) {
  if (!embeds || embeds.length === 0) return null;
  // Cap the number of rendered embeds to match Discord (max 10).
  return (
    <div className="flex flex-col">
      {embeds.slice(0, 10).map((embed, i) => (
        <SingleEmbed key={i} embed={embed} onMediaClick={onMediaClick} />
      ))}
    </div>
  );
});

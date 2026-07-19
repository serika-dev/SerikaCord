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

/**
 * Inline markdown renderer for embed text. Supports the subset Discord allows
 * in embeds: bold (**), italics (* or _), strikethrough (~~), inline code (`),
 * and markdown links [label](url) plus bare URL autolinking.
 */
function renderInlineMarkdown(text: string, keyPrefix: string): React.ReactNode[] {
  // Token regex: captures all supported inline formats in one pass.
  // Order matters: code first (so ** inside `` isn't parsed), then links,
  // then bold, strikethrough, italics.
  const tokenRegex = /(`[^`]+`)|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s]+)|(\*\*[^*]+\*\*)|(~~[^~]+~~)|(\*[^*]+\*|_[^_]+_)/g;
  const parts: React.ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = tokenRegex.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    const [full, code, linkLabel, linkUrl, bareUrl, bold, strike, italic] = match;
    if (code) {
      parts.push(
        <code key={`${keyPrefix}-${key++}`} className="px-1 py-0.5 rounded bg-black/30 text-[#e0e0e0] text-[0.85em] font-mono">
          {code.slice(1, -1)}
        </code>,
      );
    } else if (linkLabel && linkUrl) {
      parts.push(
        <a key={`${keyPrefix}-${key++}`} href={linkUrl} target="_blank" rel="noopener noreferrer" className="text-[#8B5CF6] hover:underline">
          {linkLabel}
        </a>,
      );
    } else if (bareUrl) {
      parts.push(
        <a key={`${keyPrefix}-${key++}`} href={bareUrl} target="_blank" rel="noopener noreferrer" className="text-[#8B5CF6] hover:underline break-all">
          {bareUrl}
        </a>,
      );
    } else if (bold) {
      parts.push(
        <strong key={`${keyPrefix}-${key++}`} className="font-bold text-white">
          {bold.slice(2, -2)}
        </strong>,
      );
    } else if (strike) {
      parts.push(
        <s key={`${keyPrefix}-${key++}`} className="opacity-70">
          {strike.slice(2, -2)}
        </s>,
      );
    } else if (italic) {
      parts.push(
        <em key={`${keyPrefix}-${key++}`} className="italic">
          {italic.slice(1, -1)}
        </em>,
      );
    }
    last = tokenRegex.lastIndex;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

function EmbedText({ text, className }: { text: string; className?: string }) {
  const decoded = decodeHtmlEntities(text);
  // Split into lines to preserve line breaks, render each with inline markdown.
  const lines = decoded.split("\n");
  return (
    <div className={className} style={{ whiteSpace: "pre-wrap" }}>
      {lines.map((line, i) => (
        <span key={i}>
          {i > 0 && "\n"}
          {renderInlineMarkdown(line, `el-${i}`)}
        </span>
      ))}
    </div>
  );
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
      className="mt-2 max-w-[520px] rounded-md overflow-hidden flex flex-col"
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
            <div className="mt-2 flex flex-col gap-2">
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
        <div className="flex items-center gap-2 px-3 pb-3 mt-1">
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

const GIF_PROVIDER_RE = /(?:^|\b)(tenor\.com|giphy\.com|klipy\.com|klipy\.dev)(?:$|\b)/i;

/** True if the embed is a GIF-provider auto-unfurl that LinkEmbed will render
 *  as an inline GIF — skip it to avoid showing both a video embed and the GIF. */
function isGifProviderEmbed(embed: MessageEmbed): boolean {
  const url = embed.url || embed.video?.url || embed.image?.url || '';
  if (GIF_PROVIDER_RE.test(url)) return true;
  const provider = embed.provider?.name || '';
  return /tenor|giphy|klipy/i.test(provider);
}

/** Renders bot-authored rich embeds (Discord embed format) below a message. */
export const RichEmbed = memo(function RichEmbed({ embeds, onMediaClick }: RichEmbedProps) {
  if (!embeds || embeds.length === 0) return null;
  // Filter out GIF-provider embeds — LinkEmbed renders those URLs as inline
  // GIFs, so showing the raw video embed too would duplicate the media.
  const filtered = embeds.filter((e) => !isGifProviderEmbed(e));
  if (filtered.length === 0) return null;
  // Cap the number of rendered embeds to match Discord (max 10).
  return (
    <div className="flex flex-col">
      {filtered.slice(0, 10).map((embed, i) => (
        <SingleEmbed key={i} embed={embed} onMediaClick={onMediaClick} />
      ))}
    </div>
  );
});

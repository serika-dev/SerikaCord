"use client";

import { useState } from "react";
import { FileText, Eye } from "lucide-react";
import { VideoMediaPlayer, AudioMediaPlayer } from "@/components/chat/MediaPlayer";
import { formatFileSize } from "@/lib/chat/messages";
import { useChatGt } from "./ChatGtContext";
import type { MessageAttachment } from "@/lib/chat/types";

interface MessageAttachmentsProps {
  attachments?: MessageAttachment[];
  messageId: string;
  onMediaClick: (src: string, alt: string | undefined, messageId: string) => void;
}

/** Appends ?blur=25 to a CDN URL for spoilered image previews. */
function blurUrl(url: string): string {
  if (!url) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}blur=25`;
}

/** Renders a message's attachments: images, video/audio players, and file cards. */
export function MessageAttachments({ attachments, messageId, onMediaClick }: MessageAttachmentsProps) {
  const gt = useChatGt();
  const [revealedSpoilers, setRevealedSpoilers] = useState<Set<string>>(new Set());
  if (!attachments?.length) return null;

  const imageAttachments = attachments.filter((a) => a.contentType.startsWith("image/"));
  const videoAttachments = attachments.filter((a) => a.contentType.startsWith("video/"));
  const otherAttachments = attachments.filter(
    (a) => !a.contentType.startsWith("image/") && !a.contentType.startsWith("video/")
  );

  const toggleReveal = (id: string) => {
    setRevealedSpoilers((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <>
      {/* Image collection: grid layout for multiple images, single for one */}
      {imageAttachments.length > 0 && (
        <div
          className={
            imageAttachments.length === 1
              ? "mt-2"
              : "mt-2 grid gap-1 max-w-md" +
                (imageAttachments.length === 2
                  ? " grid-cols-2"
                  : imageAttachments.length === 3
                    ? " grid-cols-3"
                    : " grid-cols-2")
          }
        >
          {imageAttachments.map((attachment) => {
            const isSpoiler = attachment.spoiler && !revealedSpoilers.has(attachment.id);
            if (isSpoiler) {
              return (
                <div
                  key={attachment.id}
                  className={
                    imageAttachments.length === 1
                      ? "relative mt-2 cursor-pointer inline-block group"
                      : "relative cursor-pointer group"
                  }
                  onClick={() => toggleReveal(attachment.id)}
                >
                  <img
                    src={blurUrl(attachment.url)}
                    alt={attachment.filename}
                    loading="lazy"
                    decoding="async"
                    className={
                      imageAttachments.length === 1
                        ? "chat-media max-w-[280px] max-h-[240px] object-contain rounded-md blur-[6px]"
                        : "w-full h-24 object-cover rounded-md blur-[6px]"
                    }
                  />
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 rounded-md bg-black/40">
                    <Eye className="w-5 h-5 text-white/80" />
                    <span className="text-xs font-medium text-white/80">{gt("Spoiler")}</span>
                    <span className="text-[10px] text-white/50">{gt("Click to reveal")}</span>
                  </div>
                </div>
              );
            }
            return (
              <img
                key={attachment.id}
                src={attachment.url}
                alt={attachment.filename}
                loading="lazy"
                decoding="async"
                className={
                  imageAttachments.length === 1
                    ? "chat-media cursor-pointer hover:opacity-90 max-w-[280px] max-h-[240px] object-contain rounded-md"
                    : "cursor-pointer hover:opacity-90 w-full h-24 object-cover rounded-md"
                }
                onClick={() => onMediaClick(attachment.url, attachment.filename, messageId)}
              />
            );
          })}
        </div>
      )}

      {/* Video collection: grid layout for multiple videos, single for one */}
      {videoAttachments.length > 0 && (
        <div
          className={
            videoAttachments.length === 1
              ? "mt-2"
              : "mt-2 grid gap-1 max-w-md" +
                (videoAttachments.length === 2
                  ? " grid-cols-2"
                  : videoAttachments.length === 3
                    ? " grid-cols-3"
                    : " grid-cols-2")
          }
        >
          {videoAttachments.map((attachment) => (
            <VideoMediaPlayer
              key={attachment.id}
              src={attachment.url}
              filename={attachment.filename}
              contentType={attachment.contentType}
              className={
                videoAttachments.length === 1
                  ? "max-w-[280px] rounded-lg overflow-hidden"
                  : "w-full h-24 rounded-lg overflow-hidden"
              }
            />
          ))}
        </div>
      )}

      {/* Other attachments (audio, files) */}
      {otherAttachments.map((attachment) => (
        <div key={attachment.id} className="mt-2">
          {attachment.contentType.startsWith("audio/") ? (
            <AudioMediaPlayer
              src={attachment.url}
              filename={attachment.filename}
              contentType={attachment.contentType}
              className="w-full max-w-sm"
            />
          ) : (
            <a
              href={attachment.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 p-3 bg-[var(--app-surface-alt)] rounded-md hover:brightness-110 max-w-sm transition"
            >
              <FileText className="w-8 h-8 text-[#8B5CF6] flex-shrink-0" />
              <div className="min-w-0">
                <div className="text-[#8B5CF6] hover:underline truncate">{attachment.filename}</div>
                <div className="text-xs text-[var(--app-muted)]">
                  {formatFileSize(attachment.size) || gt("? KB")}
                </div>
              </div>
            </a>
          )}
        </div>
      ))}
    </>
  );
}

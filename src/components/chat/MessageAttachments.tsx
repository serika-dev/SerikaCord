"use client";

import { FileText } from "lucide-react";
import { VideoMediaPlayer, AudioMediaPlayer } from "@/components/chat/MediaPlayer";
import { formatFileSize } from "@/lib/chat/messages";
import type { MessageAttachment } from "@/lib/chat/types";

interface MessageAttachmentsProps {
  attachments?: MessageAttachment[];
  messageId: string;
  onMediaClick: (src: string, alt: string | undefined, messageId: string) => void;
}

/** Renders a message's attachments: images, video/audio players, and file cards. */
export function MessageAttachments({ attachments, messageId, onMediaClick }: MessageAttachmentsProps) {
  if (!attachments?.length) return null;

  return (
    <>
      {attachments.map((attachment) => (
        <div key={attachment.id} className="mt-2">
          {attachment.contentType.startsWith("image/") ? (
            <img
              src={attachment.url}
              alt={attachment.filename}
              loading="lazy"
              decoding="async"
              className="chat-media cursor-pointer hover:opacity-90 max-w-sm max-h-[350px] object-contain rounded-md"
              onClick={() => onMediaClick(attachment.url, attachment.filename, messageId)}
            />
          ) : attachment.contentType.startsWith("video/") ? (
            <VideoMediaPlayer
              src={attachment.url}
              filename={attachment.filename}
              contentType={attachment.contentType}
              className="max-w-sm rounded-lg overflow-hidden"
            />
          ) : attachment.contentType.startsWith("audio/") ? (
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
                  {formatFileSize(attachment.size) || "? KB"}
                </div>
              </div>
            </a>
          )}
        </div>
      ))}
    </>
  );
}

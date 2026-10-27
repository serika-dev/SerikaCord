"use client";

import { isInlineVideo } from "@/lib/chat/uploadPolicy";
import { useEffect, useMemo, useState } from "react";
import { FileText, Lock } from "lucide-react";
import { loadE2eeSession } from "@/lib/e2ee/client/state";
import { VideoMediaPlayer, AudioMediaPlayer } from "@/components/chat/MediaPlayer";
import { VoiceMessagePlayer } from "@/components/chat/VoiceMessagePlayer";
import { isVoiceAttachment } from "@/lib/chat/voiceMessage";
import { formatFileSize } from "@/lib/chat/messages";
import { useChatGt } from "./ChatGtContext";
import { SpoilerVeil } from "./SpoilerVeil";
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

const isMediaType = (t: string) => t.startsWith("image/") || t.startsWith("audio/") || isInlineVideo(t);

/**
 * End-to-end encrypted media: download the ciphertext, decrypt it in the
 * browser and show a `blob:` URL. Plain attachments pass through untouched;
 * encrypted non-media files are decrypted on click (EncryptedFileCard).
 */
function useDecryptedMedia(attachments: MessageAttachment[] | undefined) {
  const encryptedMedia = useMemo(
    () => (attachments ?? []).filter((a) => a.e2ee && isMediaType(a.contentType)),
    [attachments],
  );
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [progress, setProgress] = useState<Record<string, number>>({});
  useEffect(() => {
    if (encryptedMedia.length === 0) return;
    let cancelled = false;
    void loadE2eeSession().then((session) => {
      for (const a of encryptedMedia) {
        // Download progress in whole percent steps (big videos / pictures).
        let shown = -1;
        const onProgress = (fraction: number) => {
          const percent = Math.floor(fraction * 100);
          if (cancelled || percent === shown) return;
          shown = percent;
          setProgress((prev) => ({ ...prev, [a.id]: percent }));
        };
        session
          .decryptedObjectUrl({ url: a.url, contentType: a.contentType, e2ee: a.e2ee! }, onProgress)
          .then((u) => {
            if (!cancelled) setUrls((prev) => (prev[a.id] === u ? prev : { ...prev, [a.id]: u }));
          })
          .catch(() => {
            if (!cancelled) setUrls((prev) => ({ ...prev, [a.id]: "error" }));
          });
      }
    }).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [encryptedMedia]);
  const view = useMemo(
    () => (attachments ?? []).map((a) => (a.e2ee && urls[a.id] && urls[a.id] !== "error" ? { ...a, url: urls[a.id] } : a)),
    [attachments, urls],
  );
  // Only the attachments still shown (an edit can drop files).
  const shownProgress = useMemo(() => {
    const ids = new Set(encryptedMedia.map((a) => a.id));
    return Object.fromEntries(Object.entries(progress).filter(([id]) => ids.has(id)));
  }, [progress, encryptedMedia]);
  return { view, urls, progress: shownProgress };
}

/** Placeholder while an encrypted picture / video is being downloaded and decrypted (or failed). */
function EncryptedMediaPlaceholder({ failed, compact, progress }: { failed: boolean; compact: boolean; progress?: number }) {
  const gt = useChatGt();
  return (
    <div
      className={
        (compact ? "w-full h-24" : "w-[280px] max-w-full h-[160px]") +
        " rounded-md flex flex-col items-center justify-center gap-1 bg-[var(--app-surface-alt)] text-[var(--app-muted)] px-2 text-center"
      }
    >
      <Lock className={failed ? "w-5 h-5 text-red-400" : "w-5 h-5 animate-pulse"} />
      <span className="text-xs">
        {failed
          ? gt("Couldn't decrypt this file")
          : progress !== undefined && progress < 100
            ? gt("Downloading… {percent}%", { percent: progress })
            : gt("Decrypting…")}
      </span>
    </div>
  );
}

/** An encrypted file: decrypted and saved only when clicked. */
function EncryptedFileCard({ attachment }: { attachment: MessageAttachment }) {
  const gt = useChatGt();
  const [state, setState] = useState<"idle" | "working" | "error">("idle");
  const save = async () => {
    if (!attachment.e2ee || state === "working") return;
    setState("working");
    try {
      const session = await loadE2eeSession();
      const url = await session.decryptedObjectUrl({ url: attachment.url, contentType: attachment.contentType, e2ee: attachment.e2ee });
      const a = document.createElement("a");
      a.href = url;
      a.download = attachment.filename || "file";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setState("idle");
    } catch {
      setState("error");
    }
  };
  return (
    <button
      type="button"
      onClick={() => void save()}
      className="flex items-center gap-2 p-3 bg-[var(--app-surface-alt)] rounded-md hover:brightness-110 max-w-sm transition text-left w-full"
    >
      <FileText className="w-8 h-8 text-[#8B5CF6] flex-shrink-0" />
      <div className="min-w-0">
        <div className="text-[#8B5CF6] hover:underline truncate">{attachment.filename}</div>
        <div className="text-xs text-[var(--app-muted)] flex items-center gap-1">
          <Lock className="w-3 h-3" />
          {state === "working"
            ? gt("Decrypting…")
            : state === "error"
              ? gt("Couldn't decrypt this file")
              : formatFileSize(attachment.size) || gt("? KB")}
        </div>
      </div>
    </button>
  );
}

/** Renders a message's attachments: images, video/audio players, and file cards. */
export function MessageAttachments({ attachments: rawAttachments, messageId, onMediaClick }: MessageAttachmentsProps) {
  const gt = useChatGt();
  const [revealedSpoilers, setRevealedSpoilers] = useState<Set<string>>(new Set());
  const { view: attachments, urls: decryptedUrls, progress: decryptProgress } = useDecryptedMedia(rawAttachments);
  if (!attachments?.length) return null;
  /** Encrypted media not decrypted yet (or failed): placeholder instead of a broken player. */
  const lockedMedia = (a: MessageAttachment) => Boolean(a.e2ee) && (!decryptedUrls[a.id] || decryptedUrls[a.id] === "error");

  const imageAttachments = attachments.filter((a) => a.contentType.startsWith("image/"));
  const videoAttachments = attachments.filter((a) => isInlineVideo(a.contentType, a.filename));
  const otherAttachments = attachments.filter(
    (a) => !a.contentType.startsWith("image/") && !isInlineVideo(a.contentType, a.filename)
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
            if (lockedMedia(attachment)) {
              return (
                <EncryptedMediaPlaceholder
                  key={attachment.id}
                  failed={decryptedUrls[attachment.id] === "error"}
                  compact={imageAttachments.length > 1}
                  progress={decryptProgress[attachment.id]}
                />
              );
            }
            // Spoilers and media flagged by the server's explicit content
            // filter stay blurred until clicked.
            const isSpoiler = (attachment.spoiler || attachment.sensitive) && !revealedSpoilers.has(attachment.id);
            if (isSpoiler) {
              const single = imageAttachments.length === 1;
              return (
                <div
                  key={attachment.id}
                  className={single ? "relative mt-2 inline-block overflow-hidden rounded-md" : "relative overflow-hidden rounded-md"}
                >
                  <img
                    src={attachment.e2ee ? attachment.url : blurUrl(attachment.url)}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className={
                      single
                        ? "chat-media max-w-[280px] max-h-[240px] object-contain rounded-md blur-2xl scale-110 brightness-90"
                        : "w-full h-24 object-cover rounded-md blur-2xl scale-110 brightness-90"
                    }
                  />
                  <SpoilerVeil
                    onReveal={() => toggleReveal(attachment.id)}
                    kind={attachment.sensitive && !attachment.spoiler ? "sensitive" : "spoiler"}
                    compact={!single}
                  />
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
          {videoAttachments.map((attachment) =>
            lockedMedia(attachment) ? (
              <EncryptedMediaPlaceholder
                key={attachment.id}
                failed={decryptedUrls[attachment.id] === "error"}
                compact={videoAttachments.length > 1}
                progress={decryptProgress[attachment.id]}
              />
            ) : (attachment.spoiler || attachment.sensitive) && !revealedSpoilers.has(attachment.id) ? (
              <div
                key={attachment.id}
                className={
                  (videoAttachments.length === 1 ? "max-w-[280px] w-full aspect-video" : "w-full h-24") +
                  " relative overflow-hidden rounded-lg bg-[var(--app-surface-alt)]"
                }
              >
                <SpoilerVeil
                  onReveal={() => toggleReveal(attachment.id)}
                  kind={attachment.sensitive && !attachment.spoiler ? "sensitive" : "spoiler"}
                  compact={videoAttachments.length > 1}
                />
              </div>
            ) : (
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
            ),
          )}
        </div>
      )}

      {/* Other attachments (audio, files) */}
      {otherAttachments.map((attachment) => (
        <div key={attachment.id} className="mt-2">
          {attachment.e2ee && !attachment.contentType.startsWith("audio/") ? (
            <EncryptedFileCard attachment={attachment} />
          ) : lockedMedia(attachment) ? (
            <EncryptedMediaPlaceholder failed={decryptedUrls[attachment.id] === "error"} compact progress={decryptProgress[attachment.id]} />
          ) : isVoiceAttachment(attachment) ? (
            <VoiceMessagePlayer
              src={attachment.url}
              durationSecs={attachment.durationSecs ?? 0}
              waveform={attachment.waveform}
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

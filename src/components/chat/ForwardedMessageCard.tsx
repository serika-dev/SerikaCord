"use client";

import { memo, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "gt-next";
import { ChevronRight, CornerUpRight, Hash, Users, AtSign } from "lucide-react";
import { toast } from "sonner";
import { cdnImage, cn } from "@/lib/utils";
import { MessageContent } from "@/components/chat/MessageContent";
import { MessageAttachments } from "@/components/chat/MessageAttachments";
import { RichEmbed } from "@/components/chat/RichEmbed";
import { useChatGt } from "./ChatGtContext";
import { formatMessageTimestamp } from "@/lib/chat/messages";
import { navigateToMessage } from "@/lib/notifications/events";
import type { ForwardOrigin, ForwardView } from "@/lib/chat/forward";
import type { MessageCustomEmoji } from "@/lib/chat/types";

interface ForwardedMessageCardProps {
  /** Id of the forward message itself (gallery + origin lookups). */
  messageId: string;
  forward: ForwardView;
  serverEmojis?: MessageCustomEmoji[];
  mentionUsers?: Array<{ id: string; username?: string; displayName?: string; avatar?: string }>;
  mentionRoles?: Array<{ id: string; name: string; color?: string }>;
  currentUserId?: string;
  serverId?: string;
  showMedia?: boolean;
  onMediaClick: (src: string, alt: string | undefined, messageId: string) => void;
}

/**
 * A forwarded message, Discord-style: a quoted card with a "Forwarded" label,
 * the original author, content, attachments and embeds, and a footer that
 * jumps to the original when the viewer can still open it.
 */
function ForwardedMessageCardInner({
  messageId,
  forward,
  serverEmojis,
  mentionUsers,
  mentionRoles,
  currentUserId,
  serverId,
  showMedia = true,
  onMediaClick,
}: ForwardedMessageCardProps) {
  const gt = useChatGt();
  const locale = useLocale();
  const router = useRouter();
  // Live-broadcast forwards arrive without an origin; look it up on click.
  const [fetched, setFetched] = useState<{ origin: ForwardOrigin | null } | null>(null);
  const [resolving, setResolving] = useState(false);
  const origin = forward.origin !== undefined ? forward.origin : fetched ? fetched.origin : undefined;
  const timestamp = formatMessageTimestamp(forward.createdAt, gt, locale);

  const jump = async () => {
    if (origin) {
      navigateToMessage((url) => router.push(url), origin.href);
      return;
    }
    if (origin === null || resolving) {
      if (origin === null) toast.error(gt("You don't have access to the original message."));
      return;
    }
    setResolving(true);
    try {
      const res = await fetch(`/api/messages/${messageId}/forward-origin`);
      const data = res.ok ? await res.json().catch(() => null) : null;
      const next = (data?.origin ?? null) as ForwardOrigin | null;
      setFetched({ origin: next });
      if (next) navigateToMessage((url) => router.push(url), next.href);
      else toast.error(gt("You don't have access to the original message."));
    } catch {
      toast.error(gt("You don't have access to the original message."));
    } finally {
      setResolving(false);
    }
  };

  const author = forward.author;
  const emojis = forward.customEmojis?.length ? forward.customEmojis : serverEmojis;
  const clickable = origin !== null;

  return (
    <div className="mt-1 max-w-full">
      <div className="flex max-w-[min(100%,560px)] flex-col gap-1 border-l-4 border-[var(--app-border)] pl-3">
        <div className="flex items-center gap-1 text-xs italic text-[var(--app-muted)]">
          <CornerUpRight className="h-3.5 w-3.5 flex-shrink-0" aria-hidden />
          <span>{gt("Forwarded")}</span>
        </div>
        {author && (
          <div className="flex min-w-0 items-center gap-1.5 text-sm">
            {author.avatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={cdnImage(author.avatar)}
                alt=""
                className="h-4 w-4 flex-shrink-0 rounded-full object-cover"
                loading="lazy"
              />
            ) : (
              <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full bg-[var(--app-accent)] text-[9px] font-bold text-[var(--text-on-accent,#fff)]">
                {(author.displayName || author.username || "?").charAt(0).toUpperCase()}
              </span>
            )}
            <span className="truncate font-semibold text-[var(--text-primary)]">{author.displayName || author.username}</span>
          </div>
        )}
        {forward.content ? (
          <MessageContent
            content={forward.content}
            serverEmojis={emojis}
            mentionUsers={mentionUsers}
            mentionRoles={mentionRoles}
            currentUserId={currentUserId}
            serverId={serverId}
            edited={forward.edited}
            sticker={forward.sticker ?? undefined}
            className="chat-message-body text-[var(--app-text)]"
            onMediaClick={({ src, alt }) => onMediaClick(src, alt, messageId)}
            messageId={messageId}
          />
        ) : forward.sticker ? (
          <MessageContent content="" sticker={forward.sticker} messageId={messageId} />
        ) : null}
        {forward.embeds.length > 0 && (
          <RichEmbed
            embeds={forward.embeds}
            serverEmojis={emojis}
            mentionUsers={mentionUsers}
            mentionRoles={mentionRoles}
            currentUserId={currentUserId}
            serverId={serverId}
            onMediaClick={(src, alt) => onMediaClick(src, alt, messageId)}
          />
        )}
        {showMedia && (
          <MessageAttachments attachments={forward.attachments} messageId={messageId} onMediaClick={onMediaClick} />
        )}
        <button
          type="button"
          onClick={() => void jump()}
          disabled={!clickable}
          className={cn(
            "flex max-w-full items-center gap-1 self-start text-xs text-[var(--app-muted)]",
            clickable && "cursor-pointer hover:text-[var(--text-primary)]",
          )}
          title={clickable ? gt("Jump to message") : undefined}
        >
          {origin?.kind === "channel" && (
            <>
              <Hash className="h-3 w-3 flex-shrink-0" aria-hidden />
              <span className="truncate font-medium">{origin.channelName}</span>
              {origin.serverName && <span className="truncate opacity-80">· {origin.serverName}</span>}
              <span aria-hidden>·</span>
            </>
          )}
          {origin?.kind === "dm" && origin.name && (
            <>
              <AtSign className="h-3 w-3 flex-shrink-0" aria-hidden />
              <span className="truncate font-medium">{origin.name}</span>
              <span aria-hidden>·</span>
            </>
          )}
          {origin?.kind === "group_dm" && (
            <>
              <Users className="h-3 w-3 flex-shrink-0" aria-hidden />
              {origin.name && <span className="truncate font-medium">{origin.name}</span>}
              <span aria-hidden>·</span>
            </>
          )}
          <time dateTime={forward.createdAt} className="flex-shrink-0">{timestamp}</time>
          {clickable && <ChevronRight className="h-3 w-3 flex-shrink-0" aria-hidden />}
        </button>
      </div>
    </div>
  );
}

export const ForwardedMessageCard = memo(ForwardedMessageCardInner);

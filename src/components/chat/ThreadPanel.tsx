"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MessagesSquare, X } from "lucide-react";
import { toast } from "sonner";
import { useGT } from "gt-next";
import { useServer, type ServerChannel } from "@/contexts/ServerContext";
import { ChatArea } from "@/components/chat/ChatArea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useBackHandler } from "@/hooks/useBackHandler";
import { usePermissions } from "@/hooks/usePermissions";
import { cdnImage, cn } from "@/lib/utils";
import { decodeHtmlEntities } from "@/lib/chat/messages";
import { renderMentionText } from "@/lib/chat/mentionText";
import {
  AUTO_ARCHIVE_DURATIONS,
  MAX_THREAD_NAME_LENGTH,
  clampThreadPanelWidth,
  defaultThreadName,
  normalizeAutoArchiveDuration,
} from "@/lib/chat/threads";
import {
  closeThreadPanel,
  emitThreadsChanged,
  openThreadPanel,
  type ThreadPanelState,
  type ThreadStarterDraft,
} from "@/lib/chat/threadPanelStore";

const WIDTH_KEY = "sc:thread-panel-width";

function readWidth(): number {
  try {
    const n = Number(localStorage.getItem(WIDTH_KEY));
    return Number.isFinite(n) && n > 0 ? n : 440;
  } catch {
    return 440;
  }
}

interface ThreadPanelProps {
  parentChannel: ServerChannel;
  state: Exclude<ThreadPanelState, { mode: "closed" }>;
  serverId: string;
}

/**
 * Discord's thread side panel: the thread's chat (the same ChatArea engine as
 * the channel, in its "panel" variant) or the "New Thread" form, next to the
 * channel. Resizable from its left edge (width remembered), closable, and
 * expandable to the thread's full view. Full screen on phones.
 */
export function ThreadPanel({ parentChannel, state, serverId }: ThreadPanelProps) {
  const gt = useGT();
  const isMobile = useIsMobile();
  const [width, setWidth] = useState<number>(() => (typeof window === "undefined" ? 440 : readWidth()));
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const viewport = typeof window === "undefined" ? 1280 : window.innerWidth;
  const shownWidth = clampThreadPanelWidth(width, viewport);

  useBackHandler(isMobile, closeThreadPanel);

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    dragRef.current = { startX: e.clientX, startWidth: shownWidth };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    setWidth(clampThreadPanelWidth(d.startWidth + (d.startX - e.clientX), window.innerWidth));
  };
  const onPointerUp = () => {
    if (!dragRef.current) return;
    dragRef.current = null;
    try {
      localStorage.setItem(WIDTH_KEY, String(shownWidth));
    } catch {
      /* per-device convenience only */
    }
  };

  return (
    <aside
      className={cn(
        "thread-panel relative flex min-h-0 flex-col border-l border-[var(--app-border)] bg-[var(--app-bg)]",
        isMobile ? "fixed inset-0 z-50" : "shrink-0",
      )}
      style={isMobile ? undefined : { width: shownWidth }}
      aria-label={gt("Thread")}
    >
      {!isMobile && (
        <div
          role="separator"
          aria-orientation="vertical"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          className="absolute -left-1 top-0 z-20 h-full w-2 cursor-col-resize hover:bg-[var(--app-accent)]/30"
        />
      )}
      {state.mode === "create" ? (
        <ThreadCreateForm parentChannel={parentChannel} starter={state.starter} serverId={serverId} />
      ) : (
        <ThreadPanelChat parentChannel={parentChannel} threadId={state.threadId} serverId={serverId} />
      )}
    </aside>
  );
}

function ThreadPanelChat({ parentChannel, threadId, serverId }: { parentChannel: ServerChannel; threadId: string; serverId: string }) {
  const { channels } = useServer();
  const joined = channels.find((c) => c.id === threadId);
  const joinedName = joined?.name ?? "";
  const joinedType = joined?.type ?? "public_thread";
  const { id: parentId, name: parentName, type: parentType, permissionOverwrites: parentOverwrites } = parentChannel;
  // A stable channel object per thread (ChatArea keys effects on it). Threads
  // have no overwrites of their own: the parent's apply.
  const channel = useMemo<ServerChannel>(
    () => ({
      id: threadId,
      name: joinedName,
      type: joinedType,
      serverId,
      position: 0,
      parentId,
      parentName,
      parentType,
      permissionOverwrites: parentOverwrites,
    }),
    [threadId, joinedName, joinedType, serverId, parentId, parentName, parentType, parentOverwrites],
  );
  return <ChatArea channelOverride={channel} variant="panel" onClosePanel={closeThreadPanel} />;
}

function preview(raw: string): string {
  return renderMentionText(decodeHtmlEntities(raw || "")).replace(/\s+/g, " ").trim();
}

function ThreadCreateForm({
  parentChannel,
  starter,
  serverId,
}: {
  parentChannel: ServerChannel;
  starter: ThreadStarterDraft | null;
  serverId: string;
}) {
  const gt = useGT();
  const perms = usePermissions(serverId);
  const canPrivate = !starter && (perms.isOwner || perms.can("CREATE_PRIVATE_THREADS"));
  const [name, setName] = useState(() => (starter ? defaultThreadName(decodeHtmlEntities(starter.content), "") : ""));
  const [isPrivate, setIsPrivate] = useState(false);
  const [duration, setDuration] = useState<number>(1440);
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const messageRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    (starter ? messageRef : nameRef).current?.focus();
  }, [starter]);

  const durationLabel = (m: number) =>
    m === 60 ? gt("1 Hour") : m === 1440 ? gt("24 Hours") : m === 4320 ? gt("3 Days") : gt("1 Week");

  const submit = useCallback(async () => {
    const threadName = name.trim() || (starter ? defaultThreadName(decodeHtmlEntities(starter.content), gt("New Thread")) : "");
    if (!threadName) {
      toast.error(gt("Give your thread a name"));
      nameRef.current?.focus();
      return;
    }
    if (!starter && !content.trim()) {
      toast.error(gt("Write a message to start the thread"));
      messageRef.current?.focus();
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/channels/${parentChannel.id}/threads`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: threadName.slice(0, MAX_THREAD_NAME_LENGTH),
          content: content.trim() ? content : undefined,
          messageId: starter?.id,
          type: isPrivate ? "private" : "public",
          autoArchiveDuration: normalizeAutoArchiveDuration(duration),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409 && data?.threadId) {
        openThreadPanel(parentChannel.id, data.threadId as string);
        return;
      }
      if (!res.ok || !data?.thread?.id) {
        toast.error((data?.error as string | undefined) || gt("Couldn't create the thread"));
        return;
      }
      emitThreadsChanged(serverId);
      openThreadPanel(parentChannel.id, data.thread.id as string);
    } catch {
      toast.error(gt("Couldn't create the thread"));
    } finally {
      setSubmitting(false);
    }
  }, [name, starter, content, isPrivate, duration, parentChannel.id, serverId, gt]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-[var(--app-border)] bg-[var(--app-surface)] px-4">
        <MessagesSquare className="h-5 w-5 shrink-0 text-[var(--app-muted-2)]" />
        <span className="font-semibold text-[var(--text-primary)]">{gt("New Thread")}</span>
        <button
          type="button"
          onClick={closeThreadPanel}
          className="ml-auto rounded-md p-1 text-[var(--app-muted)] transition-colors hover:text-[var(--text-primary)]"
          title={gt("Close")}
          aria-label={gt("Close")}
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <form
        className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[var(--app-surface-alt)]">
          <MessagesSquare className="h-8 w-8 text-[var(--text-primary)]" />
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-bold uppercase tracking-wide text-[var(--app-muted)]">{gt("Thread Name")}</span>
          <input
            ref={nameRef}
            value={name}
            maxLength={MAX_THREAD_NAME_LENGTH}
            onChange={(e) => setName(e.target.value)}
            placeholder={gt("New Thread")}
            className="h-10 rounded-md border border-[var(--app-border)] bg-[var(--app-surface-alt)] px-3 text-[var(--text-primary)] placeholder:text-[var(--app-muted)] focus:border-[var(--app-accent)] focus:outline-none"
          />
        </label>

        {starter && (
          <div className="rounded-lg border border-[var(--app-border)] bg-[var(--app-surface)] p-3">
            <div className="mb-1 flex items-center gap-2">
              <Avatar className="h-6 w-6">
                <AvatarImage src={cdnImage(starter.author?.avatar)} alt="" />
                <AvatarFallback className="bg-[var(--app-accent)] text-[10px] text-[var(--text-on-accent)]">
                  {(starter.author?.displayName || starter.author?.username || "?").charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <span className="text-sm font-semibold text-[var(--text-primary)]">
                {starter.author?.displayName || starter.author?.username || gt("Unknown")}
              </span>
            </div>
            <p className="line-clamp-4 break-words text-sm text-[var(--app-text)]">
              {preview(starter.content) || gt("(attachment)")}
            </p>
          </div>
        )}

        {canPrivate && (
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-[var(--text-primary)]">{gt("Private Thread")}</p>
              <p className="text-xs text-[var(--app-muted)]">{gt("Only people you invite and moderators can see this thread.")}</p>
            </div>
            <ToggleSwitch checked={isPrivate} onCheckedChange={setIsPrivate} aria-label={gt("Private Thread")} />
          </div>
        )}

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-bold uppercase tracking-wide text-[var(--app-muted)]">{gt("Hide After Inactivity")}</span>
          <select
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value))}
            className="h-10 rounded-md border border-[var(--app-border)] bg-[var(--app-surface-alt)] px-3 text-[var(--text-primary)] focus:border-[var(--app-accent)] focus:outline-none"
          >
            {AUTO_ARCHIVE_DURATIONS.map((m) => (
              <option key={m} value={m}>
                {durationLabel(m)}
              </option>
            ))}
          </select>
        </label>

        <div className="mt-auto flex flex-col gap-2">
          <textarea
            ref={messageRef}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void submit();
              } else if (e.key === "Escape") {
                e.preventDefault();
                closeThreadPanel();
              }
            }}
            rows={3}
            maxLength={4000}
            placeholder={starter ? gt("Send a message to start the thread (optional)") : gt("Enter a message to start the conversation!")}
            aria-label={gt("First message")}
            className="min-h-[44px] resize-none rounded-lg bg-[var(--app-surface-alt)] px-3 py-2.5 text-[var(--text-primary)] placeholder:text-[var(--app-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--app-accent)]"
          />
          <button
            type="submit"
            disabled={submitting}
            className="h-10 rounded-md bg-[var(--app-accent)] font-semibold text-[var(--text-on-accent)] transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {gt("Create Thread")}
          </button>
        </div>
      </form>
    </div>
  );
}

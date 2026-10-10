"use client";

import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { toast } from "sonner";
import { useGT } from "gt-next";
import { cdnImage, cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Loader } from "@/components/ui/Loader";
import { reactionEmojiIdentifier, type ChatMessage, type MessageReaction } from "@/lib/chat/types";

interface ReactionUser {
  id: string;
  username: string | null;
  displayName: string | null;
  avatar: string | null;
}

interface ReactionEntry {
  emoji: { name: string; id: string | null; animated: boolean; url: string | null };
  count: number;
  users: ReactionUser[];
}

interface ReactionsDialogProps {
  /** The message whose reactions are shown; null closes the dialog. */
  message: ChatMessage | null;
  /** Emoji tab to open on (reaction identifier), else the first one. */
  initialEmoji?: string;
  currentUserId?: string;
  /** Owner / MANAGE_MESSAGES: may remove anyone's reaction (server channels). */
  canManage?: boolean;
  onClose: () => void;
  /** Remove your own reaction (optimistic, through the chat engine). */
  onRemoveOwn: (messageId: string, emoji: string) => void;
}

function entryKey(e: ReactionEntry["emoji"]): string {
  return reactionEmojiIdentifier({ name: e.name, id: e.id ?? undefined, animated: e.animated } as MessageReaction["emoji"]);
}

/** Discord's "Reactions" viewer: a tab per emoji and who reacted with it. */
export function ReactionsDialog({ message, initialEmoji, currentUserId, canManage = false, onClose, onRemoveOwn }: ReactionsDialogProps) {
  const gt = useGT();
  const messageId = message?.id ?? null;
  const channelId = message?.channelId ?? null;
  const [loaded, setLoaded] = useState<{ messageId: string; reactions: ReactionEntry[] } | null>(null);
  const [failedFor, setFailedFor] = useState<string | null>(null);
  const [picked, setPicked] = useState<{ messageId: string; key: string } | null>(null);

  useEffect(() => {
    if (!messageId || !channelId) return;
    let alive = true;
    void fetch(`/api/channels/${channelId}/messages/${messageId}/reactions/users`)
      .then(async (res) => {
        const data = res.ok ? ((await res.json()) as { reactions?: ReactionEntry[] }) : null;
        if (!alive) return;
        if (!data?.reactions) {
          setFailedFor(messageId);
          return;
        }
        setLoaded({ messageId, reactions: data.reactions });
      })
      .catch(() => {
        if (alive) setFailedFor(messageId);
      });
    return () => {
      alive = false;
    };
  }, [messageId, channelId]);

  const reactions = useMemo(
    () => (loaded && loaded.messageId === messageId ? loaded.reactions.filter((r) => r.users.length > 0) : null),
    [loaded, messageId],
  );
  const selectedKey =
    (picked && picked.messageId === messageId ? picked.key : null) ??
    (initialEmoji && reactions?.some((r) => entryKey(r.emoji) === initialEmoji) ? initialEmoji : null) ??
    (reactions?.[0] ? entryKey(reactions[0].emoji) : null);
  const selected = reactions?.find((r) => entryKey(r.emoji) === selectedKey) ?? null;
  const failed = failedFor !== null && failedFor === messageId && !reactions;

  const removeUser = async (user: ReactionUser) => {
    if (!messageId || !channelId || !selected) return;
    const emoji = entryKey(selected.emoji);
    const dropLocally = () =>
      setLoaded((prev) =>
        prev && prev.messageId === messageId
          ? {
              ...prev,
              reactions: prev.reactions.map((r) =>
                entryKey(r.emoji) === emoji ? { ...r, count: Math.max(0, r.count - 1), users: r.users.filter((u) => u.id !== user.id) } : r,
              ),
            }
          : prev,
      );
    if (user.id === currentUserId) {
      onRemoveOwn(messageId, emoji);
      dropLocally();
      return;
    }
    try {
      const res = await fetch(
        `/api/channels/${channelId}/messages/${messageId}/reactions/users/${encodeURIComponent(user.id)}?emoji=${encodeURIComponent(emoji)}`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error(String(res.status));
      dropLocally();
    } catch {
      toast.error(gt("Failed to remove reaction"));
    }
  };

  return (
    <Dialog open={Boolean(message)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="bg-[var(--bg-card)] border-[var(--border-subtle)] text-[var(--text-primary)] max-w-lg p-0 gap-0 overflow-hidden">
        <DialogTitle className="sr-only">{gt("Reactions")}</DialogTitle>
        <DialogDescription className="sr-only">{gt("Who reacted to this message")}</DialogDescription>
        <div className="flex h-[min(440px,70dvh)]">
          {/* Emoji tabs */}
          <div className="w-[96px] shrink-0 overflow-y-auto border-r border-[var(--border-subtle)] bg-[var(--app-surface-alt)] p-2 scrollbar-thin">
            {!reactions && !failed && (
              <div className="flex justify-center py-4">
                <Loader size={16} />
              </div>
            )}
            {reactions?.map((r) => {
              const key = entryKey(r.emoji);
              const active = key === selectedKey;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => messageId && setPicked({ messageId, key })}
                  className={cn(
                    "mb-1 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
                    active
                      ? "bg-[color-mix(in_srgb,var(--app-accent)_22%,transparent)] text-[var(--text-primary)]"
                      : "text-[var(--app-muted)] hover:bg-[var(--bg-hover)]",
                  )}
                  title={r.emoji.id ? `:${r.emoji.name}:` : r.emoji.name}
                >
                  {r.emoji.url ? (
                    <img src={cdnImage(r.emoji.url)} alt={`:${r.emoji.name}:`} className="h-5 w-5 object-contain" />
                  ) : (
                    <span className="text-lg leading-none">{r.emoji.name}</span>
                  )}
                  <span className="font-semibold tabular-nums">{r.count}</span>
                </button>
              );
            })}
          </div>

          {/* People */}
          <div className="min-w-0 flex-1 overflow-y-auto p-2 scrollbar-thin">
            {failed && <p className="p-3 text-sm text-[var(--app-muted)]">{gt("Couldn't load reactions.")}</p>}
            {reactions && reactions.length === 0 && (
              <p className="p-3 text-sm text-[var(--app-muted)]">{gt("No reactions yet.")}</p>
            )}
            {selected?.users.map((u) => {
              const name = u.displayName || u.username || gt("Unknown User");
              const canRemove = u.id === currentUserId || canManage;
              return (
                <div key={u.id} className="group/reactor flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-[var(--bg-hover)]">
                  <Avatar className="h-8 w-8">
                    <AvatarImage src={cdnImage(u.avatar ?? undefined)} alt="" loading="lazy" />
                    <AvatarFallback className="bg-[var(--app-accent)] text-xs text-[var(--text-on-accent)]">
                      {name.charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{name}</div>
                    {u.username && u.username !== name && (
                      <div className="truncate text-xs text-[var(--app-muted)]">{u.username}</div>
                    )}
                  </div>
                  {canRemove && (
                    <button
                      type="button"
                      onClick={() => void removeUser(u)}
                      className="rounded p-1 text-[var(--app-muted)] opacity-0 transition-opacity hover:text-[var(--text-primary)] focus-visible:opacity-100 group-hover/reactor:opacity-100"
                      title={gt("Remove Reaction")}
                      aria-label={gt("Remove Reaction")}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
              );
            })}
            {selected && selected.count > selected.users.length && (
              <p className="px-2 py-1 text-xs text-[var(--app-muted)]">
                {gt("and {count} more", { count: selected.count - selected.users.length })}
              </p>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

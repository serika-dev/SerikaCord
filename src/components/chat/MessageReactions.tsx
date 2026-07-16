"use client";

import { Plus } from "lucide-react";
import { useChatGt } from "./ChatGtContext";
import { cn, cdnImage } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { reactionEmojiIdentifier, type MessageReaction } from "@/lib/chat/types";

interface ReactionUser {
  id: string;
  username?: string;
  displayName?: string;
  avatar?: string;
}

interface MessageReactionsProps {
  reactions?: MessageReaction[];
  messageId: string;
  currentUserId?: string;
  onToggle: (messageId: string, emoji: string, hasReacted: boolean) => void;
  /** When provided, shows a trailing "+" button that opens the reaction picker. */
  onOpenPicker?: (messageId: string) => void;
  /** User lookup map for showing who reacted (userId -> user info with avatar). */
  reactionUsers?: Record<string, ReactionUser>;
}

/** Reaction chips under a message, with optimistic toggle on click. */
export function MessageReactions({
  reactions,
  messageId,
  currentUserId,
  onToggle,
  onOpenPicker,
  reactionUsers,
}: MessageReactionsProps) {
  const gt = useChatGt();
  if (!reactions?.length) return null;

  const getUserName = (userId: string): string => {
    const u = reactionUsers?.[userId];
    return u?.displayName || u?.username || gt("Unknown");
  };

  const getUserAvatar = (userId: string): string | undefined => {
    return reactionUsers?.[userId]?.avatar;
  };

  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {reactions.map((reaction) => {
        const hasReacted = currentUserId ? reaction.userIds.includes(currentUserId) : false;
        const emojiIdentifier = reactionEmojiIdentifier(reaction.emoji);
        const names = reaction.userIds.map(getUserName);
        const tooltipText = names.length <= 3
          ? names.join(", ")
          : gt("{names} and {count} more", { names: names.slice(0, 3).join(", "), count: names.length - 3 });

        return (
          <Tooltip key={reaction.emoji.id || reaction.emoji.name}>
            <TooltipTrigger asChild>
              <button
                onClick={() => onToggle(messageId, emojiIdentifier, hasReacted)}
                className={cn(
                  "flex items-center gap-1 px-2 py-0.5 rounded-full text-sm transition-colors border",
                  hasReacted
                    ? "bg-[#8B5CF6]/20 border-[#8B5CF6] text-[var(--text-primary)]"
                    : "bg-[var(--app-surface-alt)] border-[var(--app-border)] text-[var(--app-muted)] hover:brightness-110"
                )}
              >
                {reaction.emoji.url ? (
                  <img src={cdnImage(reaction.emoji.url)} alt={reaction.emoji.name} className="w-4 h-4 object-contain" />
                ) : (
                  <span className="leading-none">{reaction.emoji.name}</span>
                )}
                <span className={hasReacted ? "text-[var(--text-primary)]" : "text-[var(--app-muted)]"}>
                  {reaction.count}
                </span>
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="bg-[var(--bg-card)] border border-[var(--border-subtle)] text-[var(--text-primary)] p-2 max-w-[220px]">
              <div className="flex flex-col gap-1">
                {reaction.userIds.slice(0, 8).map((userId) => {
                  const name = getUserName(userId);
                  const avatar = getUserAvatar(userId);
                  const initial = name.charAt(0).toUpperCase();
                  return (
                    <div key={userId} className="flex items-center gap-1.5">
                      <Avatar className="w-4 h-4">
                        <AvatarImage src={cdnImage(avatar)} loading="lazy" alt="" />
                        <AvatarFallback className="text-[8px] bg-[var(--app-accent)] text-[var(--text-on-accent)]">{initial}</AvatarFallback>
                      </Avatar>
                      <span className="text-xs truncate">{name}</span>
                    </div>
                  );
                })}
                {reaction.userIds.length > 8 && (
                  <span className="text-[10px] text-[var(--text-muted)]">+{reaction.userIds.length - 8} {gt("more")}</span>
                )}
              </div>
            </TooltipContent>
          </Tooltip>
        );
      })}
      {onOpenPicker && (
        <button
          onClick={() => onOpenPicker(messageId)}
          className="flex items-center justify-center w-7 h-7 rounded-full bg-[var(--app-surface-alt)] border border-[var(--app-border)] text-[var(--app-muted)] hover:brightness-110 hover:text-[var(--text-primary)] transition-colors"
          title={gt("Add Reaction")}
        >
          <Plus className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}

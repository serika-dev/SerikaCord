"use client";

import { Fragment, memo, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, ImageIcon, Pencil } from "lucide-react";
import { useChatGt } from "./ChatGtContext";
import type { ChatMessage } from "@/lib/chat/types";

/** Fill "{actor} added {target} to the group." with React nodes (bold names). */
function fill(template: string, values: Record<string, ReactNode>): ReactNode[] {
  return template.split(/(\{\w+\})/g).map((part, i) => {
    const key = /^\{(\w+)\}$/.exec(part)?.[1];
    return <Fragment key={i}>{key && key in values ? values[key] : part}</Fragment>;
  });
}

interface GroupSystemRowProps {
  message: ChatMessage;
  formattedTimestamp?: string;
}

/**
 * A group DM system row, Discord-style: an icon and one line of text instead
 * of a message bubble. "X added Y to the group.", "X left the group.",
 * "X removed Y from the group.", "X changed the group name: Z", "X changed the
 * group icon."
 */
function GroupSystemRowInner({ message, formattedTimestamp }: GroupSystemRowProps) {
  const gt = useChatGt();
  const event = message.groupEvent;
  const kind = event?.kind ?? message.type;
  const strong = (name: string) => <span className="font-semibold text-[var(--text-primary)]">{name}</span>;
  const actor = strong(message.author?.displayName || message.author?.username || gt("Unknown"));
  const targetName = event?.target?.displayName || event?.target?.username || gt("Unknown");
  const target = strong(targetName);

  let icon: ReactNode;
  let text: ReactNode[];
  if (kind === "recipient_add") {
    icon = <ArrowRight className="h-4 w-4 text-green-500" aria-hidden />;
    text = fill(gt("{actor} added {target} to the group."), { actor, target });
  } else if (kind === "recipient_remove") {
    icon = <ArrowLeft className="h-4 w-4 text-red-500" aria-hidden />;
    const left = !event?.target || event.target.id === message.authorId;
    text = left
      ? fill(gt("{actor} left the group."), { actor })
      : fill(gt("{actor} removed {target} from the group."), { actor, target });
  } else if (kind === "channel_name_change") {
    icon = <Pencil className="h-4 w-4 text-[var(--app-muted)]" aria-hidden />;
    text = event?.name
      ? fill(gt("{actor} changed the group name: {name}"), { actor, name: strong(event.name) })
      : fill(gt("{actor} removed the group name."), { actor });
  } else {
    icon = <ImageIcon className="h-4 w-4 text-[var(--app-muted)]" aria-hidden />;
    text = fill(gt("{actor} changed the group icon."), { actor });
  }

  return (
    <div className="chat-message-row py-0.5">
      <div
        id={`message-${message.id}`}
        role="note"
        className="flex items-center gap-4 rounded -mx-1 px-1 py-1 hover:bg-[var(--app-surface-alt)]/80 transition-colors"
      >
        <div className="flex w-10 flex-shrink-0 justify-center">{icon}</div>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm text-[var(--app-muted)] break-words">{text}</span>
          {formattedTimestamp && (
            <time dateTime={message.createdAt} className="text-xs text-[var(--app-muted)] opacity-80">
              {formattedTimestamp}
            </time>
          )}
        </div>
      </div>
    </div>
  );
}

export const GroupSystemRow = memo(GroupSystemRowInner);

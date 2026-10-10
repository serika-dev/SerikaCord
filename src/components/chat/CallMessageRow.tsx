"use client";

import { Fragment, memo, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { useLocale } from "gt-next";
import { Phone, PhoneMissed } from "lucide-react";
import { cn } from "@/lib/utils";
import { useChatGt } from "./ChatGtContext";
import { voiceService } from "@/lib/services/voiceService";
import { startDmCall, startGroupCall } from "@/lib/services/dmCallController";
import { dmCallRoomId, type CallGroup } from "@/lib/chat/dmCall";
import { groupCallRoomId } from "@/lib/voice/rooms";
import { describeCallMessage, formatCallLength, parseCallData } from "@/lib/voice/callMessage";
import type { ChatMessage } from "@/lib/chat/types";

/** The other person in the DM (the call rows need their name and id). */
export interface CallRowPeer {
  id: string;
  name?: string;
  avatar?: string | null;
}

const subscribeRoom = (onChange: () => void) => voiceService.subscribe((e) => {
  if (e.type === "connected" || e.type === "disconnected") onChange();
});
const getRoom = () => voiceService.currentRoomId ?? voiceService.joiningRoomId ?? "";
const getServerRoom = () => "";

/** Fill "{caller} started a call." with React nodes (bold names). */
function fill(template: string, values: Record<string, ReactNode>): ReactNode[] {
  return template.split(/(\{\w+\})/g).map((part, i) => {
    const key = /^\{(\w+)\}$/.exec(part)?.[1];
    return <Fragment key={i}>{key && key in values ? values[key] : part}</Fragment>;
  });
}

/**
 * Whether an unfinished call is really still going. A call message that never
 * got closed (server restart mid-call) would otherwise offer "Join call"
 * forever, so ongoing rows check the room once.
 */
function useRoomOccupied(roomId: string | null, ongoing: boolean): boolean | null {
  const [state, setState] = useState<{ roomId: string; occupied: boolean } | null>(null);
  useEffect(() => {
    if (!roomId || !ongoing) return;
    let cancelled = false;
    fetch(`/api/voice/state/${roomId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { participants?: unknown[] } | null) => {
        if (cancelled || !data) return;
        setState({ roomId, occupied: Array.isArray(data.participants) && data.participants.length > 0 });
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [roomId, ongoing]);
  if (!roomId || !ongoing) return null;
  return state?.roomId === roomId ? state.occupied : null;
}

interface CallMessageRowProps {
  message: ChatMessage;
  currentUserId?: string;
  peer?: CallRowPeer;
  /** Group DM calls: the group (its call room is gdm:<channelId>). */
  group?: CallGroup;
  formattedTimestamp?: string;
}

/**
 * A DM call's log row, Discord-style: a phone icon and one line of text
 * instead of a message bubble. "X started a call." (+ Join call while it's
 * going), "X started a call that lasted 5 minutes.", "You missed a call from X."
 */
function CallMessageRowInner({ message, currentUserId, peer, group, formattedTimestamp }: CallMessageRowProps) {
  const gt = useChatGt();
  const locale = useLocale();
  const call = parseCallData(message.call);
  const view = call ? describeCallMessage(call, currentUserId) : null;
  const roomId = group
    ? groupCallRoomId(group.channelId)
    : currentUserId && peer?.id ? dmCallRoomId(currentUserId, peer.id) : null;
  const voiceRoom = useSyncExternalStore(subscribeRoom, getRoom, getServerRoom);
  const occupied = useRoomOccupied(roomId, view?.kind === "ongoing");

  const callerName = message.author?.displayName || message.author?.username || gt("Unknown");
  const peerName = peer?.name || gt("Unknown");
  const strong = (name: string) => (
    <span className="font-semibold text-[var(--text-primary)]">{name}</span>
  );

  let text: ReactNode[];
  let missed = false;
  const kind = view?.kind ?? "ongoing";
  const mine = view?.viewerIsCaller ?? message.authorId === currentUserId;
  if (kind === "ended") {
    const duration = formatCallLength(view?.durationMs ?? 0, locale);
    text = mine
      ? fill(gt("You started a call that lasted {duration}."), { duration })
      : fill(gt("{caller} started a call that lasted {duration}."), { caller: strong(callerName), duration });
  } else if (kind === "missed") {
    missed = true;
    text = fill(gt("You missed a call from {caller}."), { caller: strong(callerName) });
  } else if (kind === "declined") {
    missed = true;
    text = fill(gt("You declined a call from {caller}."), { caller: strong(callerName) });
  } else if (kind === "unanswered") {
    text = peer?.name
      ? fill(gt("{callee} missed your call."), { callee: strong(peerName) })
      : fill(gt("Nobody answered your call."), {});
  } else {
    text = mine
      ? fill(gt("You started a call."), {})
      : fill(gt("{caller} started a call."), { caller: strong(callerName) });
  }

  // Still going, not already in it here, and the room isn't known to be empty.
  const canJoin = kind === "ongoing" && !!roomId && (!!peer || !!group) && !!currentUserId
    && voiceRoom !== roomId && occupied !== false;
  const live = kind === "ongoing" && occupied !== false;

  const join = () => {
    if (!currentUserId) return;
    voiceService.setUserId(currentUserId);
    if (group) {
      void startGroupCall({ group });
      return;
    }
    if (!peer) return;
    void startDmCall({ myId: currentUserId, peer: { id: peer.id, name: peer.name, avatar: peer.avatar ?? null } });
  };

  return (
    <div className="chat-message-row py-0.5">
      <div
        id={`message-${message.id}`}
        role="note"
        aria-label={gt("Call")}
        className="flex items-center gap-4 rounded -mx-1 px-1 py-1 hover:bg-[var(--app-surface-alt)]/80 transition-colors"
      >
        <div className="flex w-10 flex-shrink-0 justify-center">
          {missed ? (
            <PhoneMissed className="h-4 w-4 text-red-500" aria-hidden />
          ) : (
            <Phone className={cn("h-4 w-4", live ? "text-green-500" : "text-[var(--app-muted)]")} aria-hidden />
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm text-[var(--app-muted)]">{text}</span>
          {formattedTimestamp && (
            <time
              dateTime={message.createdAt}
              className="text-xs text-[var(--app-muted)] opacity-80"
            >
              {formattedTimestamp}
            </time>
          )}
          {canJoin && (
            <button
              type="button"
              onClick={join}
              className="ml-1 inline-flex items-center gap-1.5 rounded-md bg-green-600 px-2.5 py-1 text-xs font-semibold text-white transition-colors hover:bg-green-700 active:scale-95"
            >
              <Phone className="h-3.5 w-3.5" aria-hidden />
              {gt("Join call")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export const CallMessageRow = memo(CallMessageRowInner);

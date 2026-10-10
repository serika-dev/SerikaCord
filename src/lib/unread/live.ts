/**
 * What one live message (activity stream / DM list stream) does to the unread
 * state and whether it may alert — pure, so the rules are tested with the
 * engine (tests/unread-engine.test.ts).
 */

import { isMessageRead, toMs, type TimeInput, type UnreadEvent, type UnreadState } from "./engine";

export interface LiveMessageInput {
  channelId: string;
  messageId?: string | null;
  at: TimeInput;
  authorId?: string | null;
  /** The signed-in user. */
  selfId: string;
  isDM: boolean;
  /** Per-conversation settings outcome (`decideMessageAlert`): badges / may alert. */
  mention: boolean;
  notify: boolean;
  /** The conversation is the one on screen. */
  active: boolean;
  /** …and the user is reading it live (attending, list at the newest message). */
  readingLive: boolean;
}

export interface LiveMessageOutcome {
  event: UnreadEvent | null;
  /** Fire the sound / desktop notification / toast path for it. */
  alert: boolean;
  /** Passed to the alert as "on screen" (suppresses it while being read). */
  viewing: boolean;
}

export function decideLiveMessage(state: UnreadState, input: LiveMessageInput, now = Date.now()): LiveMessageOutcome {
  const at = toMs(input.at);
  if (!input.channelId || !at) return { event: null, alert: false, viewing: false };
  // Your own message (sent from another device): it reads the conversation.
  if (input.authorId && input.authorId === input.selfId) {
    return {
      event: { type: "message", channelId: input.channelId, messageId: input.messageId ?? null, at, own: true, now },
      alert: false,
      viewing: false,
    };
  }
  const viewing = input.active && input.readingLive;
  const alreadyRead = isMessageRead(state, input.channelId, input.messageId, at);
  const event: UnreadEvent = {
    type: "message",
    channelId: input.channelId,
    messageId: input.messageId ?? null,
    at,
    counts: input.mention && !alreadyRead,
    viewing,
    now,
  };
  // A server channel on screen alerts through its own chat view instead.
  const alert = input.notify && !alreadyRead && (input.isDM || !input.active);
  return { event, alert, viewing };
}

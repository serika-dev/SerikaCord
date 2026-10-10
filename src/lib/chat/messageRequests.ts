/**
 * Message Requests (Discord): a 1:1 DM that a non-friend starts lands in the
 * recipient's "Message Requests" list instead of their DM list, without
 * notifications, until they Accept (or reply). Ignore hides it for good.
 *
 * One row per (DM channel, recipient) in `dm_message_requests`. This module is
 * the pure policy shared by the server routes and the tests.
 */

export type MessageRequestStatus = "pending" | "accepted" | "ignored";

export interface MessageRequestSendContext {
  /** Sender and recipient are friends. */
  areFriends: boolean;
  /** Recipient has "Enable message requests" on (default). */
  recipientRequestsEnabled: boolean;
  /** Recipient (or sender) is a bot / system account: never a request. */
  involvesBotOrSystem: boolean;
  /** Existing row for (channel, recipient), if any. */
  existing: MessageRequestStatus | null;
  /** The recipient already wrote in this DM (an established conversation). */
  recipientHasPosted: boolean;
}

/**
 * What a send from `sender` does to the recipient's side of the DM:
 *  - "request": the DM is (still) a pending/ignored request for the recipient
 *  - "accept": record that the conversation is established (no request)
 *  - "none": nothing to record (already accepted, or requests don't apply)
 */
export function decideOnSend(ctx: MessageRequestSendContext): "request" | "accept" | "none" {
  if (ctx.existing === "accepted") return "none";
  if (ctx.existing === "pending" || ctx.existing === "ignored") {
    // Becoming friends (or the feature being switched off) settles it.
    if (ctx.areFriends || !ctx.recipientRequestsEnabled || ctx.involvesBotOrSystem) return "accept";
    return "request";
  }
  if (ctx.areFriends || ctx.involvesBotOrSystem || !ctx.recipientRequestsEnabled) return "none";
  // Older DMs that already have a conversation in them never turn into requests.
  if (ctx.recipientHasPosted) return "accept";
  return "request";
}

/** Whether a DM is hidden from the viewer's DM list (it lives in Message Requests or was ignored). */
export function isHiddenRequest(status: MessageRequestStatus | null | undefined, areFriends: boolean): boolean {
  if (areFriends) return false;
  return status === "pending" || status === "ignored";
}

/** Whether a DM shows in the viewer's Message Requests list. */
export function isPendingRequest(status: MessageRequestStatus | null | undefined, areFriends: boolean): boolean {
  return !areFriends && status === "pending";
}

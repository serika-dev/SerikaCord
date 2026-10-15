/**
 * What a bot needs in a channel for each bot REST action (src/lib/api/botApi.ts).
 *
 * The bitfield itself comes from the same resolution users get
 * (getMemberChannelPermissions in src/lib/api/channels.ts: @everyone + role
 * permissions, then @everyone / role / member overwrites, owner and
 * ADMINISTRATOR short-circuit). This module only maps actions to the bits they
 * need, the DM permission set, and timeouts. Pure, so it is unit tested.
 */
import { PERMISSION_BITS as P, hasPermission } from './bits';

/**
 * A bot in a DM or group DM it belongs to. No moderation bits: like Discord,
 * a bot cannot delete other people's messages or remove their reactions in a DM.
 */
export const DM_BOT_PERMISSIONS: bigint =
  P.VIEW_CHANNEL |
  P.SEND_MESSAGES |
  P.READ_MESSAGE_HISTORY |
  P.ADD_REACTIONS |
  P.EMBED_LINKS |
  P.ATTACH_FILES |
  P.USE_EXTERNAL_EMOJIS |
  P.USE_EXTERNAL_STICKERS |
  P.SEND_VOICE_MESSAGES |
  P.SEND_POLLS |
  P.PIN_MESSAGES;

/** A timed-out member keeps only VIEW_CHANNEL and READ_MESSAGE_HISTORY (Discord). */
export function applyTimeout(perms: bigint, communicationDisabledUntil: Date | string | null | undefined, now = Date.now()): bigint {
  if (!communicationDisabledUntil) return perms;
  const until = new Date(communicationDisabledUntil).getTime();
  if (!Number.isFinite(until) || until <= now) return perms;
  if (hasPermission(perms, P.ADMINISTRATOR)) return perms; // admins cannot be timed out
  return perms & (P.VIEW_CHANNEL | P.READ_MESSAGE_HISTORY);
}

export type BotChannelAction =
  | 'read_history'
  | 'send'
  | 'attach'
  | 'react_existing'
  | 'react_new'
  | 'manage_messages'
  | 'pin'
  | 'typing'
  | 'manage_channel'
  | 'manage_webhooks';

/** Every bit `action` needs (all of them). `pin` is special-cased in botCan. */
export function requiredBits(action: BotChannelAction, opts: { isThread?: boolean } = {}): bigint {
  const send = opts.isThread ? P.SEND_MESSAGES_IN_THREADS : P.SEND_MESSAGES;
  switch (action) {
    case 'read_history': return P.VIEW_CHANNEL | P.READ_MESSAGE_HISTORY;
    case 'send': return P.VIEW_CHANNEL | send;
    case 'attach': return P.VIEW_CHANNEL | send | P.ATTACH_FILES;
    case 'react_existing': return P.VIEW_CHANNEL | P.READ_MESSAGE_HISTORY;
    case 'react_new': return P.VIEW_CHANNEL | P.READ_MESSAGE_HISTORY | P.ADD_REACTIONS;
    case 'manage_messages': return P.VIEW_CHANNEL | P.MANAGE_MESSAGES;
    case 'pin': return P.VIEW_CHANNEL | P.PIN_MESSAGES;
    case 'typing': return P.VIEW_CHANNEL | send;
    case 'manage_channel': return P.VIEW_CHANNEL | P.MANAGE_CHANNELS;
    case 'manage_webhooks': return P.VIEW_CHANNEL | P.MANAGE_WEBHOOKS;
  }
}

/** True when `perms` (a resolved channel bitfield) allows `action`. ADMINISTRATOR allows everything. */
export function botCan(perms: bigint, action: BotChannelAction, opts: { isThread?: boolean } = {}): boolean {
  if (hasPermission(perms, P.ADMINISTRATOR)) return true;
  if (action === 'pin') {
    // PIN_MESSAGES split off MANAGE_MESSAGES; either one still pins (Discord's transition rule).
    return hasPermission(perms, P.VIEW_CHANNEL) && (hasPermission(perms, P.PIN_MESSAGES) || hasPermission(perms, P.MANAGE_MESSAGES));
  }
  return hasPermission(perms, requiredBits(action, opts));
}

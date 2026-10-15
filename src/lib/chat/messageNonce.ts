/**
 * `nonce` + `enforce_nonce` on bot message creates (pure parts).
 *
 * Discord: `nonce` is an integer or a string of at most 25 characters and is
 * echoed back on the message object (and MESSAGE_CREATE). With
 * `enforce_nonce: true`, a second create by the same author with the same
 * nonce within a few minutes returns the first message instead of posting a
 * duplicate. The dedupe slot lives in Redis (see claimNonce in
 * src/lib/services/botMessages.ts): `pending` while the first create runs,
 * then the created message id.
 */
import { addFormError, type FormErrorTree } from './discordFormErrors';

export const MAX_NONCE_LENGTH = 25;
/** How long a nonce is remembered for enforce_nonce (Discord: "a few minutes"). */
export const NONCE_TTL_SECONDS = 300;
export const NONCE_PENDING = 'pending';

export type NonceResult =
  | { ok: true; nonce: string | number | null }
  | { ok: false; errors: FormErrorTree };

export function normalizeNonce(raw: unknown): NonceResult {
  if (raw === undefined || raw === null) return { ok: true, nonce: null };
  if (typeof raw === 'number') {
    if (!Number.isSafeInteger(raw)) {
      return { ok: false, errors: addFormError({}, ['nonce'], 'BASE_TYPE_BAD_INT', 'Must be a valid integer.') };
    }
    return { ok: true, nonce: raw };
  }
  if (typeof raw === 'string') {
    if (raw.length > MAX_NONCE_LENGTH) {
      return { ok: false, errors: addFormError({}, ['nonce'], 'BASE_TYPE_MAX_LENGTH', `Must be ${MAX_NONCE_LENGTH} or fewer in length.`) };
    }
    return { ok: true, nonce: raw };
  }
  return { ok: false, errors: addFormError({}, ['nonce'], 'BASE_TYPE_STRING', 'Must be a string or an integer.') };
}

/** Redis key of an author's nonce in a channel. */
export function nonceKey(authorId: string, channelId: string, nonce: string | number): string {
  return `botnonce:${authorId.toLowerCase()}:${channelId.toLowerCase()}:${String(nonce)}`;
}

/** What the stored slot value means for a new create with the same nonce. */
export function interpretNonceSlot(value: string | null | undefined):
  | { action: 'create' }
  | { action: 'wait' }
  | { action: 'existing'; messageId: string } {
  if (!value) return { action: 'create' };
  if (value === NONCE_PENDING) return { action: 'wait' };
  return { action: 'existing', messageId: value };
}

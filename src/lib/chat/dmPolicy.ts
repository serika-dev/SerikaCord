import { acceptsDmsFromNonFriends } from '@/lib/settings/privacy';
import { normalizeId } from '@/lib/db/normalizeId';

/**
 * Who may write into a 1:1 DM. Shared by `POST /dms/:recipientId/messages`
 * and the generic `/channels/:dmChannelId/...` routes so that neither path
 * can skip blocks or the recipient's DM privacy setting.
 */

export interface DmPolicyUser {
  id: string;
  friends?: string[] | null;
  blockedUsers?: string[] | null;
  isSystem?: boolean | null;
  settings?: unknown;
}

const same = (a: string, b: string) => normalizeId(a) === normalizeId(b);

/** Returns an error message, or null when `sender` may DM `recipient`. */
export function dmSendDenyReason(
  sender: DmPolicyUser,
  recipient: DmPolicyUser,
  opts: { recipientIsSystem?: boolean } = {},
): string | null {
  if ((sender.blockedUsers || []).some((b) => same(b, recipient.id))) {
    return 'You have blocked this user';
  }
  if ((recipient.blockedUsers || []).some((b) => same(b, sender.id))) {
    return 'You cannot message this user';
  }
  const recipientIsSystem = Boolean(opts.recipientIsSystem || recipient.isSystem);
  if (recipientIsSystem) return null;
  const isFriend = (sender.friends || []).some((f) => same(f, recipient.id));
  if (!isFriend && !acceptsDmsFromNonFriends(recipient.settings as Parameters<typeof acceptsDmsFromNonFriends>[0])) {
    return 'You cannot message this user';
  }
  return null;
}

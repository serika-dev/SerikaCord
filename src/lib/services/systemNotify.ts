/**
 * Centralized "Serika System" notifications.
 *
 * One place to send a DM to a user from a system account (bug-report status
 * updates, badge unlocks, suspensions, etc). Handles channel resolution,
 * encryption, persistence and real-time delivery (DM list + open-DM stream)
 * so callers don't re-implement the broadcast plumbing each time.
 */
import { User } from '@/lib/models/User';
import {
  SYSTEM_USERS,
  ensureSystemUsers,
  getSystemUserConfig,
} from './systemUsers';

export type SystemNotifyKind =
  | 'bug_report'
  | 'badge'
  | 'suspension'
  | 'unsuspension'
  | 'system';

interface SendSystemDMOptions {
  /** Which system account sends the DM. Defaults to the Serika System user. */
  fromSystemUserId?: string;
  /** Tag used for logging / future routing. */
  kind?: SystemNotifyKind;
}

/**
 * Send a DM to `recipientId` from a Serika system account. Returns the created
 * message id, or null if it couldn't be delivered (never throws — callers treat
 * notifications as best-effort side effects).
 */
export async function sendSystemDM(
  recipientId: string,
  content: string,
  options: SendSystemDMOptions = {}
): Promise<string | null> {
  const fromId = options.fromSystemUserId || SYSTEM_USERS.SERIKA_SYSTEM;
  const trimmed = content.trim();
  if (!recipientId || !trimmed) return null;

  try {
    // Never DM system accounts or non-existent users.
    const recipient = await User.findById(recipientId);
    if (!recipient || recipient.isSystem) return null;

    await ensureSystemUsers();

    const [{ getOrCreateDMChannel, emitDmListUpdate, publishToDm }, { Message }, { Channel }, { encryptForStorage }] =
      await Promise.all([
        import('@/lib/api/dms'),
        import('@/lib/models/Message'),
        import('@/lib/models/Channel'),
        import('@/lib/security/encryption'),
      ]);

    const channel = await getOrCreateDMChannel(fromId, recipientId);

    const encryptedContent = await encryptForStorage(trimmed);
    const message = await Message.create({
      channelId: channel.id,
      authorId: fromId,
      content: encryptedContent,
      type: 'default',
    });

    await Channel.updateById(channel.id, { lastMessageId: message.id, updatedAt: new Date() });

    const config = getSystemUserConfig(fromId);
    const author = {
      id: fromId,
      username: config?.username || 'system',
      displayName: config?.displayName || 'SerikaCord System',
      avatar: config?.avatar || '/logo-icon.svg',
      status: 'online',
      customStatus: null,
      isPremium: false,
      badges: config?.badges || [],
      isSystem: true,
      isBot: true,
      isVerified: true,
      customization: null,
    };

    const messageData = {
      id: message.id,
      content: trimmed,
      authorId: fromId,
      author,
      channelId: channel.id,
      createdAt: message.createdAt,
    };

    // Real-time: bump the recipient's DM list + push into an open DM window.
    emitDmListUpdate([recipientId, fromId], {
      type: 'dm:list:update',
      channelId: channel.id,
      recipientId: fromId,
      message: {
        id: message.id,
        content: trimmed.slice(0, 180),
        authorId: fromId,
        createdAt: message.createdAt,
      },
    });
    publishToDm(channel.id, { type: 'message', message: messageData });

    return message.id;
  } catch (err) {
    console.error(`[systemNotify] Failed to send ${options.kind || 'system'} DM to ${recipientId}:`, err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Message builders — kept here so copy stays consistent across the app.
// ---------------------------------------------------------------------------

const BUG_REPORT_STATUS_COPY: Record<
  string,
  { title: string; body: (kind: string) => string }
> = {
  acknowledged: {
    title: '👀 We\'re looking into it',
    body: (kind) => `Thanks — your ${kind} has been **acknowledged** and is now on our radar. We'll follow up here as it progresses.`,
  },
  resolved: {
    title: '✅ Resolved',
    body: (kind) => `Good news! Your ${kind} has been marked as **resolved**. Thank you for helping make SerikaCord better.`,
  },
  wont_fix: {
    title: '📋 Closed',
    body: (kind) => `Your ${kind} has been reviewed and marked as **won't fix** for now. We appreciate you taking the time to report it.`,
  },
  open: {
    title: '🔄 Reopened',
    body: (kind) => `Your ${kind} has been **reopened** and is being looked at again.`,
  },
};

/** Notify a reporter that the status of their bug report / feedback changed. */
export async function notifyBugReportStatus(params: {
  reporterId: string;
  kind: string; // 'bug' | 'feedback'
  title: string;
  newStatus: string;
  adminNote?: string | null;
}): Promise<void> {
  const kindLabel = params.kind === 'feedback' ? 'feedback' : 'bug report';
  const copy = BUG_REPORT_STATUS_COPY[params.newStatus];
  if (!copy) return; // no user-facing message for this status

  const lines = [
    `**${copy.title}**`,
    '',
    copy.body(kindLabel),
    '',
    `> ${params.title}`,
  ];
  if (params.adminNote && params.adminNote.trim()) {
    lines.push('', `**Note from the team:** ${params.adminNote.trim()}`);
  }

  await sendSystemDM(params.reporterId, lines.join('\n'), { kind: 'bug_report' });
}

/** Notify a user that they unlocked one or more badges. */
export async function notifyBadgesUnlocked(
  userId: string,
  badgeNames: string[]
): Promise<void> {
  if (badgeNames.length === 0) return;
  const list = badgeNames.map((n) => `🏅 **${n}**`).join('\n');
  const heading =
    badgeNames.length === 1
      ? 'You unlocked a new badge!'
      : `You unlocked ${badgeNames.length} new badges!`;
  const body = [
    `**🎉 ${heading}**`,
    '',
    list,
    '',
    'It now shows on your profile. Nice work!',
  ].join('\n');
  await sendSystemDM(userId, body, { kind: 'badge' });
}

/** Notify a user that their account was suspended (sent before deauth). */
export async function notifySuspension(
  userId: string,
  reason?: string | null
): Promise<void> {
  const body = [
    '**🚫 Your account has been suspended**',
    '',
    'Your access to SerikaCord has been suspended by the moderation team. You have been signed out of all sessions.',
    '',
    `**Reason:** ${reason?.trim() || 'No reason provided'}`,
    '',
    'If you believe this is a mistake, you can appeal by contacting support.',
  ].join('\n');
  await sendSystemDM(userId, body, { kind: 'suspension' });
}

/** Notify a user that their suspension was lifted. */
export async function notifyUnsuspension(userId: string): Promise<void> {
  const body = [
    '**✅ Your suspension has been lifted**',
    '',
    'Welcome back — your account is active again and you can sign in as normal.',
  ].join('\n');
  await sendSystemDM(userId, body, { kind: 'unsuspension' });
}

/**
 * Send an app invite ("X invited you to SerikaTrack") on behalf of another
 * Serika app: a system row in the inviter ↔ invitee DM, authored by the
 * inviter, and an email to the invitee. See src/lib/social/appInvite.ts.
 *
 * One-time: a Redis guard per (app, inviter, invitee) refuses repeats, and
 * the invite email goes out at most once per invitee whoever invites them.
 * The calling app keeps its own durable record too.
 */
import nodemailer from 'nodemailer';
import { config } from '@/lib/config';
import { normalizeId } from '@/lib/db/normalizeId';
import { getRedis } from '@/lib/db/redis';
import { User, type IUser } from '@/lib/models';
import { accountsInternalGetUser } from '@/lib/services/accountsClient';
import { hasId } from '@/lib/social/friendLists';
import { userIdFromAccountsId } from '@/lib/social/friendGraphSync';
import {
  APP_INVITE_APPS,
  APP_INVITE_GUARD_TTL_SECONDS,
  appInviteEmail,
  appInviteEmailKey,
  appInviteMarker,
  appInvitePairKey,
  appInvitePreview,
  appInviteText,
  type AppInviteApp,
} from '@/lib/social/appInvite';

export interface AppInviteResult {
  status: 'sent' | 'already_invited' | 'invalid' | 'unavailable';
  /** The DM row was posted. */
  dm: boolean;
  /** The invite email was sent. */
  email: boolean;
}

let transporter: nodemailer.Transporter | null = null;
function mailer(): nodemailer.Transporter | null {
  if (!config.EMAIL_USER || !config.EMAIL_PASS) return null;
  transporter ??= nodemailer.createTransport({
    host: config.EMAIL_HOST,
    port: config.EMAIL_PORT,
    secure: config.EMAIL_PORT === 465,
    auth: { user: config.EMAIL_USER, pass: config.EMAIL_PASS },
  });
  return transporter;
}

/** Placeholder addresses minted for accounts without an email: never mail them. */
function mailable(email: unknown): email is string {
  return typeof email === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) && !email.toLowerCase().endsWith('@serika.dev');
}

async function postInviteRow(app: AppInviteApp, inviter: IUser, invitee: IUser): Promise<boolean> {
  const [{ getOrCreateDMChannel, publishToDm }, { Message }, { Channel }, { encryptForStorage }, { signalDmMessage }] = await Promise.all([
    import('@/lib/api/dms'),
    import('@/lib/models/Message'),
    import('@/lib/models/Channel'),
    import('@/lib/security/encryption'),
    import('@/lib/services/messageSignals'),
  ]);
  const preview = appInvitePreview(app);
  const text = appInviteText(app, inviter.displayName || inviter.username);
  const channel = await getOrCreateDMChannel(inviter.id, invitee.id);
  // content carries the full sentence for older clients and DM-list reads; current clients draw the card.
  const message = await Message.create({
    channelId: channel.id,
    authorId: inviter.id,
    content: await encryptForStorage(text),
    type: 'system',
    interaction: appInviteMarker(app),
  });
  await Channel.updateById(channel.id, { lastMessageId: message.id, updatedAt: new Date() });

  const { name, url, tagline } = APP_INVITE_APPS[app];
  publishToDm(channel.id, {
    type: 'message',
    message: {
      id: message.id,
      type: 'app_invite',
      content: text,
      appInvite: { app, name, url, tagline },
      authorId: inviter.id,
      author: {
        id: inviter.id,
        username: inviter.username,
        displayName: inviter.displayName || inviter.username,
        avatar: inviter.avatar,
      },
      channelId: channel.id,
      createdAt: message.createdAt,
    },
  });
  await signalDmMessage({
    channelId: channel.id,
    recipientIds: [invitee.id],
    messageId: message.id,
    authorId: inviter.id,
    authorName: inviter.displayName || inviter.username,
    authorAvatar: inviter.avatar,
    content: preview,
    createdAt: message.createdAt,
  });
  return true;
}

/**
 * Invite `inviteeAccountsId` to `app` from `inviterAccountsId` (accounts ids).
 * Never throws.
 */
export async function sendAppInvite(app: AppInviteApp, inviterAccountsId: string, inviteeAccountsId: string): Promise<AppInviteResult> {
  const none = (status: AppInviteResult['status']): AppInviteResult => ({ status, dm: false, email: false });
  const inviterId = userIdFromAccountsId(inviterAccountsId);
  const inviteeId = userIdFromAccountsId(inviteeAccountsId);
  if (!inviterId || !inviteeId || inviterId === inviteeId) return none('invalid');
  const redis = getRedis();
  if (!redis) return none('unavailable');

  const pairKey = appInvitePairKey(app, normalizeId(inviterId), normalizeId(inviteeId));
  const claimed = await redis.set(pairKey, String(Date.now()), 'EX', APP_INVITE_GUARD_TTL_SECONDS, 'NX').catch(() => null);
  if (claimed !== 'OK') return none('already_invited');

  try {
    const [inviter, invitee, accountsInvitee] = await Promise.all([
      User.findById(inviterId),
      User.findById(inviteeId),
      accountsInternalGetUser(inviteeAccountsId).catch(() => null),
    ]);
    const blocked = !!inviter && !!invitee && (hasId(inviter.blockedUsers, invitee.id) || hasId(invitee.blockedUsers, inviter.id));
    const inviteeAccount = accountsInvitee?.ok ? accountsInvitee.data.user : undefined;
    // The inviter must be a SerikaCord user (the DM comes from them); the invitee needs at least an account.
    if (!inviter || (!invitee && !inviteeAccount) || inviteeAccount?.isBanned || invitee?.isBanned || inviter.isBanned) {
      await redis.del(pairKey).catch(() => {});
      return none('invalid');
    }

    let dm = false;
    // Blocks hide the invite entirely (and the inviter isn't told why).
    if (invitee && !blocked && !inviter.isBot && !invitee.isBot && !inviter.isSystem && !invitee.isSystem) {
      dm = await postInviteRow(app, inviter, invitee).catch((error) => {
        console.warn('[AppInvite] DM row failed:', error instanceof Error ? error.message : error);
        return false;
      });
    }

    let email = false;
    let alreadyEmailed = false;
    const address = inviteeAccount?.email;
    const transport = mailer();
    if (!blocked && transport && mailable(address)) {
      const emailKey = appInviteEmailKey(app, normalizeId(inviteeId));
      const first = await redis.set(emailKey, String(Date.now()), 'EX', APP_INVITE_GUARD_TTL_SECONDS, 'NX').catch(() => null);
      if (first !== 'OK') alreadyEmailed = true;
      else {
        const inviterName = inviter.displayName || inviter.username || 'A friend';
        const inviteeName = inviteeAccount?.displayName || inviteeAccount?.username || invitee?.username || 'there';
        const { subject, text, html } = appInviteEmail(app, inviterName, inviteeName);
        try {
          await transport.sendMail({ from: config.EMAIL_FROM, to: address, subject, text, html });
          email = true;
        } catch (error) {
          await redis.del(emailKey).catch(() => {});
          console.warn('[AppInvite] email failed:', error instanceof Error ? error.message : error);
        }
      }
    } else if (!transport) {
      console.warn('[AppInvite] email not configured (AWS_EMAIL_SMTP_USERNAME / AWS_EMAIL_PASS): DM only');
    }

    // Nothing delivered for a reason that may pass (e.g. mail down): report it so the
    // calling app frees its one-time invite, and let them retry. A block stays silent.
    if (!dm && !email && !blocked && !alreadyEmailed) {
      await redis.del(pairKey).catch(() => {});
      return none('unavailable');
    }
    return { status: 'sent', dm, email };
  } catch (error) {
    await redis.del(pairKey).catch(() => {});
    console.warn('[AppInvite] failed:', error instanceof Error ? error.message : error);
    return none('unavailable');
  }
}

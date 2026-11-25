/**
 * "X invited you to SerikaTrack": invites another Serika app sends through
 * SerikaCord (POST /api/internal/app-invite).
 *
 * The invite lands in the inviter ↔ invitee DM as a one-line system row
 * authored by the inviter (like call rows), not as a text message: the server
 * can't write into an end-to-end encrypted DM on someone's behalf, and the
 * row's text is fixed, so nothing the user didn't write is shown as theirs.
 * The row is stored as `type: 'system'` with `interaction: { kind:
 * 'app_invite', app }` and reaches clients as `type: 'app_invite'`.
 *
 * Apps and their links are fixed here: callers name an app, never a URL.
 *
 * No db / redis here: shared by the service, the DM DTOs and unit tests.
 */

export const APP_INVITE_APPS = {
  serikatrack: {
    name: 'SerikaTrack',
    url: 'https://track.serika.moe',
    tagline: 'Track the anime and manga you watch and read, and see what your friends are into.',
  },
} as const;

export type AppInviteApp = keyof typeof APP_INVITE_APPS;

export function isAppInviteApp(app: unknown): app is AppInviteApp {
  return typeof app === 'string' && Object.prototype.hasOwnProperty.call(APP_INVITE_APPS, app);
}

/** What the client gets on an app_invite row. */
export interface AppInvitePayload {
  app: AppInviteApp;
  name: string;
  url: string;
  tagline: string;
}

/** The `interaction` jsonb stored on the row. */
export function appInviteMarker(app: AppInviteApp): { kind: 'app_invite'; app: AppInviteApp } {
  return { kind: 'app_invite', app };
}

/** The invite on a stored message, or null when it isn't an app invite row. */
export function appInviteFromMessage(msg: { type?: string | null; interaction?: unknown }): AppInvitePayload | null {
  if (msg.type !== 'system') return null;
  const marker = msg.interaction as { kind?: unknown; app?: unknown } | null | undefined;
  if (!marker || marker.kind !== 'app_invite' || !isAppInviteApp(marker.app)) return null;
  const { name, url, tagline } = APP_INVITE_APPS[marker.app];
  return { app: marker.app, name, url, tagline };
}

/**
 * DTO fields for an app invite row (spread last over the message DTO), or {}.
 * `content` keeps the stored sentence (appInviteText), so clients that don't
 * know the row type yet still show who invited them, to what, and the link.
 */
export function appInviteDtoFields(msg: { type?: string | null; interaction?: unknown }) {
  const invite = appInviteFromMessage(msg);
  return invite ? { type: 'app_invite' as const, interaction: undefined, appInvite: invite } : {};
}

/** Redis key that makes an inviter → invitee invite one-time. */
export const appInvitePairKey = (app: AppInviteApp, inviterId: string, inviteeId: string) =>
  `appinvite:${app}:pair:${inviterId}:${inviteeId}`;
/** Redis key that caps invite emails at one per invitee, whoever invites them. */
export const appInviteEmailKey = (app: AppInviteApp, inviteeId: string) => `appinvite:${app}:email:${inviteeId}`;
/** How long those guards last (the inviting app also records invites for good). */
export const APP_INVITE_GUARD_TTL_SECONDS = 400 * 24 * 60 * 60;

/**
 * The sentence stored as the row's content: who invited them, what the app is,
 * and the link. Older clients and anything that only reads `content` (DM list,
 * search, replies) show this; current clients draw the card instead.
 */
export function appInviteText(app: AppInviteApp, inviterName: string): string {
  const { name, url, tagline } = APP_INVITE_APPS[app];
  return `${inviterName} invited you to ${name}! ${tagline} Sign in with your Serika account: ${url}`;
}

/** Short plain preview for notifications. */
export function appInvitePreview(app: AppInviteApp): string {
  return `Invited you to ${APP_INVITE_APPS[app].name}`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** Banner on Serika's brand emails (same as serika-accounts src/services/email.ts). */
const SERIKA_EMAIL_BANNER = 'https://pbs.twimg.com/profile_banners/2035306328575668225/1774090527/600x200';
const SERIKA_ACCOUNTS_URL = 'https://accounts.serika.dev';

/** A highlighted line in a brand email ("Sign in with: ..."). Values must already be escaped. */
function brandNote(label: string, valueHtml: string): string {
  return `<div style="margin: 8px 0px; padding: 10px 14px; border-left: 3px solid rgb(168, 85, 247); background: rgba(168, 85, 247, 0.08);"><span style="font-weight: 600; color: rgb(192, 132, 252);">${label}</span> <span style="color: rgb(248, 242, 255);">${valueHtml}</span><br></div>`;
}

/**
 * Serika's brand email layout, ported from serika-accounts' emailLayout so
 * invites look like every other Serika email. All inputs must already be escaped.
 */
function serikaEmailLayout(opts: { eyebrow: string; heading: string; bodyHtml: string; button: { label: string; url: string }; footerNote: string }): string {
  const year = new Date().getFullYear();
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="dark"></head><body style="margin: 0px; padding: 0px; background: rgb(7, 4, 13);">
<div style="margin: 0px; padding: 0px; background: rgb(7, 4, 13); font-family: Aptos, Aptos_EmbeddedFont, Aptos_MSFontService, Calibri, Arial, Helvetica, sans-serif; color: rgb(243, 236, 255);">
  <div style="width: 100%; line-height: 0; font-size: 0px;"><span style="overflow: hidden;"><img src="${SERIKA_EMAIL_BANNER}" alt="Serika banner" style="display: block; width: 100%; max-width: 100%; height: auto; border: 0px;"></span></div>
  <div style="min-height: 3px; width: 100%; background: linear-gradient(90deg, rgb(91, 33, 182) 0%, rgb(168, 85, 247) 50%, rgb(124, 58, 237) 100%);"><br></div>
  <div style="padding: 34px 30px 24px;">
    <div style="font-size: 12px; line-height: 18px; letter-spacing: 2px; text-transform: uppercase; margin-bottom: 12px; color: rgb(192, 132, 252);">${opts.eyebrow}<br></div>
    <div style="font-size: 28px; line-height: 34px; font-weight: 700; margin-bottom: 18px; color: rgb(255, 255, 255);">${opts.heading}<br></div>
    <div style="font-size: 15px; line-height: 25px; color: rgb(239, 231, 255);">
      ${opts.bodyHtml}
      <div style="margin: 24px 0px;"><a href="${opts.button.url}" style="display: inline-block; padding: 12px 20px; background: linear-gradient(90deg, rgb(91, 33, 182) 0%, rgb(124, 58, 237) 100%); color: rgb(255, 255, 255); text-decoration: none; font-weight: 700; border-radius: 6px; font-size: 14px;" target="_blank">${opts.button.label}</a></div>
      <br>${opts.footerNote}<br><br>Kind regards,<br><span style="color: rgb(216, 180, 254);"><b>Serika</b></span>
    </div>
    <div style="margin-top: 30px; padding-top: 18px; border-top: 1px solid rgba(192, 132, 252, 0.16); text-align: center;">
      <div style="font-size: 20px; font-weight: 800; background: linear-gradient(135deg, #c084fc, #a855f7); -webkit-background-clip: text; -webkit-text-fill-color: transparent; letter-spacing: -1px; margin-bottom: 14px;">Serika</div>
      <div style="margin-top: 14px; font-size: 12px; line-height: 18px; color: rgb(139, 127, 163);">
        <a href="${SERIKA_ACCOUNTS_URL}" style="text-decoration: underline; color: rgb(167, 139, 250);" target="_blank">Manage your account</a><br>
        &copy; ${year} Serika. All rights reserved.
      </div>
    </div>
  </div>
</div>
</body></html>`;
}

/** Subject, text and HTML (Serika brand layout) of the invite email. */
export function appInviteEmail(app: AppInviteApp, inviterName: string, inviteeName: string) {
  const { name, url, tagline } = APP_INVITE_APPS[app];
  const subject = `${inviterName} invited you to ${name}`;
  const text = [
    `Hey ${inviteeName},`,
    '',
    `${inviterName} invited you to ${name}! ${tagline}`,
    '',
    `Sign in with your Serika account: ${url}`,
    '',
    `You're friends with ${inviterName} on Serika, so they'll be your friend on ${name} too.`,
    'You only get this email once, even if more friends invite you.',
    '',
    'Kind regards,',
    'Serika',
  ].join('\n');
  const i = escapeHtml(inviterName);
  const n = escapeHtml(name);
  const u = escapeHtml(url);
  const accent = (v: string) => `<span style="color: rgb(192, 132, 252);"><b>${v}</b></span>`;
  const html = serikaEmailLayout({
    eyebrow: `${n} — Friend Invite`,
    heading: `${i} invited you to ${n}`,
    bodyHtml: `Hey ${accent(escapeHtml(inviteeName))},<br><br>${accent(i)} wants you on ${n}. ${escapeHtml(tagline)}`
      + brandNote('Sign in with:', 'Your Serika account (the one you use on SerikaCord)')
      + brandNote('Or paste this URL:', `<span style="font-size: 13px; word-break: break-all;">${u}</span>`),
    button: { label: `Open ${n}`, url: u },
    footerNote: `You're friends with ${i} on Serika, so they'll be your friend on ${n} too. You only get this email once, even if more friends invite you.`,
  });
  return { subject, text, html };
}

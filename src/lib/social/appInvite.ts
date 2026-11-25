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
  const { name, url } = APP_INVITE_APPS[marker.app];
  return { app: marker.app, name, url };
}

/** DTO fields for an app invite row (spread last over the message DTO), or {}. */
export function appInviteDtoFields(msg: { type?: string | null; interaction?: unknown }) {
  const invite = appInviteFromMessage(msg);
  return invite ? { type: 'app_invite' as const, content: '', interaction: undefined, appInvite: invite } : {};
}

/** Redis key that makes an inviter → invitee invite one-time. */
export const appInvitePairKey = (app: AppInviteApp, inviterId: string, inviteeId: string) =>
  `appinvite:${app}:pair:${inviterId}:${inviteeId}`;
/** Redis key that caps invite emails at one per invitee, whoever invites them. */
export const appInviteEmailKey = (app: AppInviteApp, inviteeId: string) => `appinvite:${app}:email:${inviteeId}`;
/** How long those guards last (the inviting app also records invites for good). */
export const APP_INVITE_GUARD_TTL_SECONDS = 400 * 24 * 60 * 60;

/** Short plain preview for the DM list and notifications. */
export function appInvitePreview(app: AppInviteApp): string {
  return `Invited you to ${APP_INVITE_APPS[app].name}`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** Subject, text and HTML of the invite email. */
export function appInviteEmail(app: AppInviteApp, inviterName: string, inviteeName: string) {
  const { name, url, tagline } = APP_INVITE_APPS[app];
  const subject = `${inviterName} invited you to ${name}`;
  const text = [
    `Hi ${inviteeName},`,
    '',
    `${inviterName} invited you to ${name}. ${tagline}`,
    '',
    `Sign in with your Serika account: ${url}`,
    '',
    `You're friends with ${inviterName} on Serika, so they'll be your friend on ${name} too.`,
    'You only get this email once.',
  ].join('\n');
  const i = escapeHtml(inviterName);
  const html = `<!doctype html><html><body style="margin:0;background:#f4f4f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1f2933">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:12px;padding:32px">
<tr><td>
<p style="margin:0 0 8px;font-size:14px;color:#6b7280">Hi ${escapeHtml(inviteeName)},</p>
<h1 style="margin:0 0 12px;font-size:20px;line-height:1.3">${i} invited you to ${escapeHtml(name)}</h1>
<p style="margin:0 0 24px;font-size:15px;line-height:1.5">${escapeHtml(tagline)}</p>
<a href="${escapeHtml(url)}" style="display:inline-block;background:#7c3aed;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:8px">Open ${escapeHtml(name)}</a>
<p style="margin:24px 0 0;font-size:13px;line-height:1.5;color:#6b7280">Sign in with your Serika account. You're friends with ${i} on Serika, so they'll be your friend on ${escapeHtml(name)} too. You only get this email once.</p>
</td></tr></table></td></tr></table></body></html>`;
  return { subject, text, html };
}

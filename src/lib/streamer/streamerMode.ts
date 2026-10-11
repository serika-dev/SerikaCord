// Streamer Mode (Discord-style), pure part: preference shape + parsing,
// streaming-software detection from the desktop app's process scan, and the
// masking helpers. The live per-device store and React hook live in
// src/hooks/useStreamerMode.ts; the settings UI in
// src/components/settings/StreamerModeSettings.tsx.

export interface StreamerModePrefs {
  /** Turned on by hand. */
  enabled: boolean;
  /** Turn on by itself while OBS / Streamlabs / XSplit runs (desktop app). */
  autoEnable: boolean;
  /** Email, connected accounts and other personal details. */
  hidePersonalInfo: boolean;
  /** Invite codes / links in invite dialogs. */
  hideInviteLinks: boolean;
  /** Message text in notifications and DM list previews. */
  hideNotificationContent: boolean;
}

export type StreamerHideKind = 'personal' | 'invites' | 'notifications';

export const STREAMER_MODE_STORAGE_KEY = 'sc:streamer-mode';

export const DEFAULT_STREAMER_PREFS: StreamerModePrefs = Object.freeze({
  enabled: false,
  autoEnable: true,
  hidePersonalInfo: true,
  hideInviteLinks: true,
  hideNotificationContent: true,
});

export function parseStreamerPrefs(raw: unknown): StreamerModePrefs {
  let v: unknown = raw;
  if (typeof v === 'string') {
    try {
      v = JSON.parse(v);
    } catch {
      v = null;
    }
  }
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const bool = (k: keyof StreamerModePrefs) => (typeof o[k] === 'boolean' ? (o[k] as boolean) : DEFAULT_STREAMER_PREFS[k]);
  return {
    enabled: bool('enabled'),
    autoEnable: bool('autoEnable'),
    hidePersonalInfo: bool('hidePersonalInfo'),
    hideInviteLinks: bool('hideInviteLinks'),
    hideNotificationContent: bool('hideNotificationContent'),
  };
}

const STREAMING_EXES = new Set(['obs', 'obs64', 'obs32', 'obs-studio', 'streamlabs obs', 'streamlabs', 'xsplit.core', 'xsplit']);

/** Whether the desktop app's detected processes include streaming software. */
export function isStreamingSoftwareRunning(activities: unknown): boolean {
  if (!Array.isArray(activities)) return false;
  return activities.some((a) => {
    if (!a || typeof a !== 'object') return false;
    const exe = String((a as { exe?: unknown }).exe ?? '').toLowerCase().replace(/\.exe$/, '');
    const name = String((a as { name?: unknown }).name ?? '').toLowerCase();
    return STREAMING_EXES.has(exe) || name === 'obs studio' || name.startsWith('streamlabs');
  });
}

/** Streamer Mode is on when enabled by hand, or auto-enabled by streaming software. */
export function isStreamerModeActive(prefs: StreamerModePrefs, streamingDetected: boolean): boolean {
  return prefs.enabled || (prefs.autoEnable && streamingDetected);
}

export function streamerHides(prefs: StreamerModePrefs, active: boolean, kind: StreamerHideKind): boolean {
  if (!active) return false;
  if (kind === 'personal') return prefs.hidePersonalInfo;
  if (kind === 'invites') return prefs.hideInviteLinks;
  return prefs.hideNotificationContent;
}

/** "alice@example.com" -> "•••••@•••••••.com" (keeps only the TLD). */
export function maskEmail(email: string | null | undefined): string {
  if (!email) return '';
  const at = email.lastIndexOf('@');
  const dots = (n: number) => '•'.repeat(Math.max(3, Math.min(10, n)));
  if (at < 0) return dots(email.length);
  const domain = email.slice(at + 1);
  const dot = domain.lastIndexOf('.');
  const tld = dot > 0 ? domain.slice(dot) : '';
  return `${dots(at)}@${dots(dot > 0 ? dot : domain.length)}${tld}`;
}

/** "serika.cc/AbC123" -> "serika.cc/••••••" (host kept, code hidden). */
export function maskInviteLink(link: string): string {
  const slash = link.lastIndexOf('/');
  const code = slash >= 0 ? link.slice(slash + 1) : link;
  const dots = '•'.repeat(Math.max(6, Math.min(12, code.length)));
  return slash >= 0 ? `${link.slice(0, slash + 1)}${dots}` : dots;
}

/**
 * Guild incident actions (Discord's "pause invites / DMs" during a raid),
 * stored in `servers.settings.incidents` as ISO timestamps. Pure; tested in
 * tests/guildparity-incidents.test.ts.
 *
 *   invitesDisabledUntil   joining through an invite is refused until then
 *                          (src/lib/api/servers.ts POST /invites/:code)
 *   dmsDisabledUntil       stored and reported only (Serika's DM rules don't
 *                          depend on shared servers)
 *
 * Discord allows at most 24 hours ahead; a time already past disables the
 * action, null disables it, a missing field keeps the current value.
 */
import type { FieldError } from './guildSearchRules';

export const INCIDENT_MAX_MS = 24 * 60 * 60 * 1000;
/** Clock skew tolerated on the 24 hour limit. */
const SKEW_MS = 60_000;

export interface StoredIncidents {
  invitesDisabledUntil?: string | null;
  dmsDisabledUntil?: string | null;
}

function incidentsOf(settings: unknown): StoredIncidents {
  const raw = settings && typeof settings === 'object' ? (settings as { incidents?: unknown }).incidents : undefined;
  return raw && typeof raw === 'object' ? (raw as StoredIncidents) : {};
}

const active = (v: unknown, now: number): string | null => {
  if (typeof v !== 'string') return null;
  const t = new Date(v).getTime();
  return Number.isFinite(t) && t > now ? new Date(t).toISOString() : null;
};

/** Discord's incidents data (expired actions read as null). */
export function readIncidents(settings: unknown, now = Date.now()) {
  const s = incidentsOf(settings);
  return { invites_disabled_until: active(s.invitesDisabledUntil, now), dms_disabled_until: active(s.dmsDisabledUntil, now) };
}

/** The guild object's `incidents_data`: null when no action is active. */
export function incidentsDataOf(settings: unknown, now = Date.now()) {
  const d = readIncidents(settings, now);
  return d.invites_disabled_until || d.dms_disabled_until ? d : null;
}

/** Whether joining through invites is paused right now. */
export function invitesPaused(settings: unknown, now = Date.now()): boolean {
  return readIncidents(settings, now).invites_disabled_until !== null;
}

/** PUT /guilds/{id}/incident-actions body -> the stored value. */
export function parseIncidentActions(body: unknown, settings: unknown, now = Date.now()):
  { ok: true; value: { invitesDisabledUntil: string | null; dmsDisabledUntil: string | null } } | { ok: false; errors: FieldError[] } {
  const b = (body && typeof body === 'object' && !Array.isArray(body) ? body : {}) as Record<string, unknown>;
  const current = readIncidents(settings, now);
  const errors: FieldError[] = [];
  const field = (key: 'invites_disabled_until' | 'dms_disabled_until'): string | null => {
    const v = b[key];
    if (v === undefined) return current[key];
    if (v === null) return null;
    const t = typeof v === 'string' ? new Date(v).getTime() : NaN;
    if (!Number.isFinite(t)) { errors.push({ path: key, code: 'DATE_TYPE_PARSE', message: 'Could not parse date.' }); return null; }
    if (t > now + INCIDENT_MAX_MS + SKEW_MS) { errors.push({ path: key, code: 'BASE_TYPE_BAD_TIME', message: 'Must be at most 24 hours in the future.' }); return null; }
    return t > now ? new Date(t).toISOString() : null;
  };
  const invitesDisabledUntil = field('invites_disabled_until');
  const dmsDisabledUntil = field('dms_disabled_until');
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: { invitesDisabledUntil, dmsDisabledUntil } };
}

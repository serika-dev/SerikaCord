/**
 * Privileged gateway intents (GUILD_MEMBERS, GUILD_PRESENCES, MESSAGE_CONTENT):
 * which ones an application may use, and how that is stored.
 *
 * Pure (no DB) so it can be unit tested and shared by the gateway
 * (src/lib/gateway/core.ts), the bot REST API (src/lib/api/botApi.ts) and the
 * developer portal API (src/lib/api/developers.ts).
 *
 * Storage: `applications.gateway_intents` holds the privileged bits the owner
 * switched on in the portal (Bot tab), plus INTENTS_CONFIGURED_MARKER once the
 * owner has saved that setting at least once.
 *
 * Grandfathering: privileged intents used to be unenforced, so every existing
 * bot received message content and member events. Apps created before
 * PRIVILEGED_INTENTS_CUTOFF that never saved the setting keep all three
 * privileged intents (the portal shows them switched on). As soon as the owner
 * saves the intent toggles, the stored value governs. Apps created after the
 * cutoff start with none, like Discord.
 */

export const INTENT = {
  GUILDS: 1 << 0,
  GUILD_MEMBERS: 1 << 1,
  GUILD_PRESENCES: 1 << 8,
  GUILD_MESSAGES: 1 << 9,
  DIRECT_MESSAGES: 1 << 12,
  MESSAGE_CONTENT: 1 << 15,
} as const;

/** Intents an app must enable in the portal before it may IDENTIFY with them. */
export const PRIVILEGED_INTENTS = INTENT.GUILD_MEMBERS | INTENT.GUILD_PRESENCES | INTENT.MESSAGE_CONTENT;

/** Internal marker in `gateway_intents`: the owner has saved the intent toggles. Never sent to bots. */
export const INTENTS_CONFIGURED_MARKER = 1 << 30;

/** Apps created before this instant keep all privileged intents until their owner saves the setting. */
export const PRIVILEGED_INTENTS_CUTOFF = Date.parse('2026-10-16T00:00:00Z');

/** Discord application flags that advertise approved privileged intents (READY `application.flags`). */
export const APPLICATION_FLAGS = {
  GATEWAY_PRESENCE: 1 << 12,
  GATEWAY_GUILD_MEMBERS: 1 << 14,
  GATEWAY_MESSAGE_CONTENT: 1 << 18,
} as const;

/** Gateway close code for requesting a privileged intent the app has not enabled. */
export const CLOSE_DISALLOWED_INTENTS = 4014;

export interface IntentApp {
  gatewayIntents?: number | null;
  createdAt?: Date | string | null;
}

function createdBeforeCutoff(createdAt: IntentApp['createdAt']): boolean {
  if (!createdAt) return true; // legacy rows without a timestamp predate the cutoff
  const t = createdAt instanceof Date ? createdAt.getTime() : Date.parse(String(createdAt));
  return Number.isFinite(t) ? t < PRIVILEGED_INTENTS_CUTOFF : true;
}

/** The privileged intent bits this application may use right now. */
export function allowedPrivilegedIntents(app: IntentApp | null | undefined): number {
  if (!app) return 0;
  const stored = Number(app.gatewayIntents) || 0;
  const configured = (stored & INTENTS_CONFIGURED_MARKER) !== 0;
  if (!configured && createdBeforeCutoff(app.createdAt)) return PRIVILEGED_INTENTS;
  return stored & PRIVILEGED_INTENTS;
}

/** True when the app may read message content (gateway and REST). */
export function appHasMessageContent(app: IntentApp | null | undefined): boolean {
  return (allowedPrivilegedIntents(app) & INTENT.MESSAGE_CONTENT) !== 0;
}

/** Privileged bits in `requested` that the app has not enabled (non-zero means close 4014). */
export function disallowedIntents(requested: number, allowedPrivileged: number): number {
  return (requested & PRIVILEGED_INTENTS) & ~allowedPrivileged;
}

/** Value to store when the owner saves the portal toggles. */
export function toStoredIntents(requested: unknown): number | null {
  const n = typeof requested === 'number' ? requested : Number(requested);
  if (!Number.isInteger(n) || n < 0) return null;
  return (n & PRIVILEGED_INTENTS) | INTENTS_CONFIGURED_MARKER;
}

/** Application flags advertising the enabled privileged intents (merged into `flags`). */
export function intentApplicationFlags(allowedPrivileged: number): number {
  let flags = 0;
  if (allowedPrivileged & INTENT.GUILD_PRESENCES) flags |= APPLICATION_FLAGS.GATEWAY_PRESENCE;
  if (allowedPrivileged & INTENT.GUILD_MEMBERS) flags |= APPLICATION_FLAGS.GATEWAY_GUILD_MEMBERS;
  if (allowedPrivileged & INTENT.MESSAGE_CONTENT) flags |= APPLICATION_FLAGS.GATEWAY_MESSAGE_CONTENT;
  return flags;
}

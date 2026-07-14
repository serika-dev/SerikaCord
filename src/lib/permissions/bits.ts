/**
 * Canonical permission bit definitions for SerikaCord.
 *
 * This is the single source of truth for every permission flag in the app.
 * Bit numbers mirror Discord's system so bitfields are interchangeable with
 * Discord tooling. Both the client-side UI gating (`@/lib/roles/permissions`)
 * and the server-side role editor metadata (`@/lib/constants/rolePermissions`)
 * derive from this map, and server enforcement (channels/bot API) imports the
 * individual bits directly.
 *
 * Keep this in sync with the developer docs permission table
 * (`app/developers/docs/topics/permissions`).
 */
export const PERMISSION_BITS = {
  CREATE_INVITE: 1n << 0n,
  KICK_MEMBERS: 1n << 1n,
  BAN_MEMBERS: 1n << 2n,
  ADMINISTRATOR: 1n << 3n,
  MANAGE_CHANNELS: 1n << 4n,
  MANAGE_SERVER: 1n << 5n,
  ADD_REACTIONS: 1n << 6n,
  VIEW_AUDIT_LOG: 1n << 7n,
  PRIORITY_SPEAKER: 1n << 8n,
  VIDEO: 1n << 9n,
  VIEW_CHANNEL: 1n << 10n,
  SEND_MESSAGES: 1n << 11n,
  SEND_TTS_MESSAGES: 1n << 12n,
  MANAGE_MESSAGES: 1n << 13n,
  EMBED_LINKS: 1n << 14n,
  ATTACH_FILES: 1n << 15n,
  READ_MESSAGE_HISTORY: 1n << 16n,
  MENTION_EVERYONE: 1n << 17n,
  USE_EXTERNAL_EMOJIS: 1n << 18n,
  VIEW_SERVER_INSIGHTS: 1n << 19n,
  CONNECT: 1n << 20n,
  SPEAK: 1n << 21n,
  MUTE_MEMBERS: 1n << 22n,
  DEAFEN_MEMBERS: 1n << 23n,
  MOVE_MEMBERS: 1n << 24n,
  USE_VOICE_ACTIVITY: 1n << 25n,
  CHANGE_NICKNAME: 1n << 26n,
  MANAGE_NICKNAMES: 1n << 27n,
  MANAGE_ROLES: 1n << 28n,
  MANAGE_WEBHOOKS: 1n << 29n,
  MANAGE_EMOJIS_AND_STICKERS: 1n << 30n,
  USE_APPLICATION_COMMANDS: 1n << 31n,
  REQUEST_TO_SPEAK: 1n << 32n,
  MANAGE_EVENTS: 1n << 33n,
  MANAGE_THREADS: 1n << 34n,
  CREATE_PUBLIC_THREADS: 1n << 35n,
  CREATE_PRIVATE_THREADS: 1n << 36n,
  USE_EXTERNAL_STICKERS: 1n << 37n,
  SEND_MESSAGES_IN_THREADS: 1n << 38n,
  USE_EMBEDDED_ACTIVITIES: 1n << 39n,
  MODERATE_MEMBERS: 1n << 40n,
  USE_EXTERNAL_SOUNDS: 1n << 42n,
  SEND_VOICE_MESSAGES: 1n << 43n,
  USE_SOUNDBOARD: 1n << 44n,
  CREATE_EXPRESSIONS: 1n << 45n,
  CREATE_EVENTS: 1n << 46n,
  SET_VOICE_CHANNEL_STATUS: 1n << 48n,
  SEND_POLLS: 1n << 49n,
  USE_EXTERNAL_APPS: 1n << 50n,
  PIN_MESSAGES: 1n << 51n,
} as const;

export type PermissionName = keyof typeof PERMISSION_BITS;

/** All permission bits OR'd together (used to represent "grants everything"). */
export const ALL_PERMISSIONS: bigint = Object.values(PERMISSION_BITS).reduce(
  (acc, bit) => acc | bit,
  0n,
);

/**
 * True if `bitfield` includes `permission`. ADMINISTRATOR implies every
 * permission, matching how the client and server both resolve grants.
 */
export function hasPermission(bitfield: bigint, permission: bigint): boolean {
  if ((bitfield & PERMISSION_BITS.ADMINISTRATOR) === PERMISSION_BITS.ADMINISTRATOR) return true;
  return (bitfield & permission) === permission;
}

/** True if `bitfield` includes at least one of the supplied permission bits (ADMINISTRATOR implies all). */
export function hasAnyPermission(bitfield: bigint, permissions: bigint[]): boolean {
  if ((bitfield & PERMISSION_BITS.ADMINISTRATOR) === PERMISSION_BITS.ADMINISTRATOR) return true;
  return permissions.some((p) => (bitfield & p) === p);
}

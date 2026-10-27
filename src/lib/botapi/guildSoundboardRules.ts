/**
 * Discord soundboard sounds <-> Serika's server soundboard
 * (`servers.soundboard_sounds`: `{ id, name, url, emoji, volume, uploadedBy }`).
 * Pure; tested in tests/guildparity-soundboard.test.ts.
 *
 * The sound id is the entry's UUID (the snowflake boundary mints a snowflake
 * for `sound_id`). `emoji` is a unicode emoji or the guild's custom emoji
 * token `<:name:id>`; Discord splits it into emoji_id / emoji_name.
 */
import { parseCommunityEmoji } from '@/lib/servers/communityEmoji';
import { parseSoundVolume, soundVolume } from '@/lib/servers/soundboardVolume';
import type { FieldError } from './guildSearchRules';

export const SOUND_NAME_MIN = 2;
export const SOUND_NAME_MAX = 32;
/** Discord: mp3 or ogg, at most 512 KiB. */
export const SOUND_MAX_BYTES = 512 * 1024;
/** Serika's per-server cap (same as the web upload). */
export const MAX_SOUNDS_PER_GUILD = 500;
export const DEFAULT_SOUND_EMOJI = '🔊';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface StoredSound {
  id?: unknown;
  name?: unknown;
  url?: unknown;
  emoji?: unknown;
  volume?: unknown;
  uploadedBy?: unknown;
}

/** emoji_id / emoji_name for a stored emoji value. */
export function soundEmoji(raw: unknown): { emoji_id: string | null; emoji_name: string | null } {
  const parsed = parseCommunityEmoji(raw);
  if (!parsed) return { emoji_id: null, emoji_name: null };
  if (parsed.kind === 'custom') return { emoji_id: parsed.id, emoji_name: null };
  return { emoji_id: null, emoji_name: parsed.value };
}

/** Discord soundboard sound object. `user` only for callers that may manage expressions. */
export function toDiscordSound(s: StoredSound, guildId: string, opts: { available: boolean; user?: unknown }) {
  return {
    name: typeof s.name === 'string' ? s.name : '',
    sound_id: String(s.id ?? ''),
    volume: soundVolume(s),
    ...soundEmoji(s.emoji),
    guild_id: guildId,
    available: opts.available,
    ...(opts.user !== undefined ? { user: opts.user } : {}),
  };
}

/** The server row's sounds with a usable id (entries without one are skipped). */
export function storedSounds(raw: unknown): Array<StoredSound & { id: string }> {
  if (!Array.isArray(raw)) return [];
  return raw.filter((s): s is StoredSound & { id: string } => !!s && typeof s === 'object' && typeof (s as StoredSound).id === 'string' && UUID_RE.test((s as { id: string }).id));
}

/** Whether the server's soundboard is on (settings.soundboard.enabled defaults to true). */
export function soundboardEnabled(settings: unknown): boolean {
  const sb = settings && typeof settings === 'object' ? (settings as { soundboard?: { enabled?: unknown } }).soundboard : undefined;
  return sb?.enabled !== false;
}

/** GUILD_CREATE `soundboard_sounds` / op 31 SOUNDBOARD_SOUNDS for a server row. */
export function guildSoundboardSounds(server: { id: string; soundboardSounds?: unknown; settings?: unknown }) {
  const available = soundboardEnabled(server.settings);
  return storedSounds(server.soundboardSounds).map((s) => toDiscordSound(s, server.id, { available }));
}

export type ParsedSound = { ok: true; contentType: 'audio/mpeg' | 'audio/ogg'; ext: 'mp3' | 'ogg'; bytes: Buffer } | { ok: false; code: string; message: string };

/** What the bytes are: an Ogg stream, or MP3 (ID3 tag or an MPEG audio frame sync). */
export function sniffSound(bytes: Uint8Array): 'audio/ogg' | 'audio/mpeg' | null {
  if (bytes.length >= 4 && bytes[0] === 0x4f && bytes[1] === 0x67 && bytes[2] === 0x67 && bytes[3] === 0x53) return 'audio/ogg';
  if (bytes.length >= 3 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) return 'audio/mpeg';
  if (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) return 'audio/mpeg';
  return null;
}

/** Discord's `sound`: a data URI of mp3 / ogg audio (base64), at most `maxBytes`. */
export function parseSoundData(value: unknown, maxBytes = SOUND_MAX_BYTES): ParsedSound {
  const invalid = { ok: false as const, code: 'SOUND_INVALID', message: 'Invalid sound data. Must be an mp3 or ogg file.' };
  const tooBig = { ok: false as const, code: 'BINARY_TYPE_MAX_SIZE', message: `File cannot be larger than ${Math.floor(maxBytes / 1024)}.0 kb.` };
  if (typeof value !== 'string' || !value.startsWith('data:')) return invalid;
  if (value.length > Math.ceil(maxBytes / 3) * 4 + 4096) return tooBig;
  const m = /^data:(audio\/(?:mpeg|mp3|ogg|opus)|application\/ogg);base64,([A-Za-z0-9+/=\s]+)$/i.exec(value);
  if (!m) return invalid;
  const bytes = Buffer.from(m[2].replace(/\s+/g, ''), 'base64');
  if (bytes.length === 0) return invalid;
  if (bytes.length > maxBytes) return tooBig;
  const kind = sniffSound(bytes);
  if (!kind) return invalid;
  return { ok: true, contentType: kind, ext: kind === 'audio/ogg' ? 'ogg' : 'mp3', bytes };
}

export interface SoundFields {
  name?: string;
  /** 0..1; null in the body resets to full volume. */
  volume?: number;
  /** Raw emoji_id (resolved against the guild's emojis by the caller) / emoji_name, null = clear. */
  emojiId?: string | null;
  emojiName?: string | null;
}

/** POST / PATCH body fields (the `sound` data itself is parsed separately). */
export function parseSoundFields(body: unknown, opts: { create: boolean }): { ok: true; fields: SoundFields } | { ok: false; errors: FieldError[] } {
  const b = (body && typeof body === 'object' && !Array.isArray(body) ? body : {}) as Record<string, unknown>;
  const errors: FieldError[] = [];
  const fields: SoundFields = {};
  if (b.name !== undefined || opts.create) {
    if (typeof b.name !== 'string' || !b.name.trim()) errors.push({ path: 'name', code: 'BASE_TYPE_REQUIRED', message: 'This field is required' });
    else if (b.name.trim().length < SOUND_NAME_MIN || b.name.trim().length > SOUND_NAME_MAX) {
      errors.push({ path: 'name', code: 'BASE_TYPE_BAD_LENGTH', message: `Must be between ${SOUND_NAME_MIN} and ${SOUND_NAME_MAX} in length.` });
    } else fields.name = b.name.trim();
  }
  if (b.volume !== undefined) {
    if (b.volume === null) fields.volume = 1;
    else if (typeof b.volume !== 'number' || !Number.isFinite(b.volume)) errors.push({ path: 'volume', code: 'NUMBER_TYPE_COERCE', message: `Value "${String(b.volume)}" is not double.` });
    else if (b.volume < 0 || b.volume > 1) errors.push({ path: 'volume', code: b.volume < 0 ? 'NUMBER_TYPE_MIN' : 'NUMBER_TYPE_MAX', message: b.volume < 0 ? 'float value should be greater than or equal to 0.' : 'float value should be less than or equal to 1.' });
    else fields.volume = parseSoundVolume(b.volume) ?? 1;
  }
  if (b.emoji_id !== undefined) {
    if (b.emoji_id !== null && (typeof b.emoji_id !== 'string' || !b.emoji_id)) errors.push({ path: 'emoji_id', code: 'NUMBER_TYPE_COERCE', message: 'Value is not snowflake.' });
    else fields.emojiId = b.emoji_id as string | null;
  }
  if (b.emoji_name !== undefined) {
    if (b.emoji_name !== null && typeof b.emoji_name !== 'string') errors.push({ path: 'emoji_name', code: 'BASE_TYPE_STRING', message: 'Must be a string.' });
    else if (typeof b.emoji_name === 'string' && b.emoji_name && !parseCommunityEmoji(b.emoji_name)) {
      errors.push({ path: 'emoji_name', code: 'EMOJI_INVALID', message: 'Invalid emoji' });
    } else fields.emojiName = (b.emoji_name as string | null) || null;
  }
  if (fields.emojiId && fields.emojiName) {
    errors.push({ path: 'emoji_name', code: 'SOUNDBOARD_SOUND_EMOJI_CONFLICT', message: 'Only one of emoji_id and emoji_name may be set.' });
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, fields };
}

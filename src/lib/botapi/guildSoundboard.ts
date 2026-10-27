/**
 * Guild soundboard sounds for the Discord-compatible bot API, over the same
 * `servers.soundboard_sounds` list the web soundboard uses (shapes in
 * ./guildSoundboardRules.ts).
 *
 * Permissions (Discord): listing needs guild membership; `user` is included
 * for bots with CREATE_GUILD_EXPRESSIONS or MANAGE_GUILD_EXPRESSIONS.
 * Creating needs CREATE_GUILD_EXPRESSIONS (or MANAGE); editing / deleting
 * MANAGE_GUILD_EXPRESSIONS, or CREATE_GUILD_EXPRESSIONS for the bot's own
 * sounds. Changes are audit-logged (130-132) and emit
 * GUILD_SOUNDBOARD_SOUND_CREATE / _UPDATE / _DELETE.
 */
import { randomUUID } from 'crypto';
import { Server, ServerEmoji, ServerMember, User } from '@/lib/models';
import { PERMISSION_BITS as P, hasPermission } from '@/lib/permissions/bits';
import { applyTimeout } from '@/lib/permissions/botChannel';
import { isValidObjectId, sanitizeInput } from '@/lib/security';
import { audit } from '@/lib/services/auditLog';
import { AuditLogEvent, auditReason } from '@/lib/audit/auditLog';
import { formatCustomEmoji } from '@/lib/servers/communityEmoji';
import { ensureSoundboardIds } from '@/lib/servers/guards';
import { emitGuildSoundboardSound, toDiscordUserRow } from '@/lib/services/gatewayEvents';
import { invalidFormBody } from './errors';
import {
  DEFAULT_SOUND_EMOJI, guildSoundboardSounds, MAX_SOUNDS_PER_GUILD, parseSoundData, parseSoundFields, soundboardEnabled, storedSounds, toDiscordSound,
  type SoundFields, type StoredSound,
} from './guildSoundboardRules';

type Result = { status: number; body: unknown };
type Headers = Record<string, string | undefined>;

const MISSING_PERMISSIONS = { code: 50013, message: 'Missing Permissions' };
const UNKNOWN_SOUND = { code: 10097, message: 'Unknown sound' };
const UNKNOWN_GUILD = { code: 10004, message: 'Unknown Guild' };
const same = (a: unknown, b: unknown) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();

async function guildPerms(guildId: string, botId: string): Promise<bigint> {
  const member = await ServerMember.findOne({ serverId: guildId, userId: botId });
  const { getMemberChannelPermissions } = await import('@/lib/api/channels');
  return applyTimeout(await getMemberChannelPermissions(botId, { serverId: guildId }, member ?? null), member?.communicationDisabledUntil ?? null);
}
const has = (perms: bigint, bit: bigint) => hasPermission(perms, P.ADMINISTRATOR) || hasPermission(perms, bit);
const canCreate = (perms: bigint) => has(perms, P.CREATE_EXPRESSIONS) || has(perms, P.MANAGE_EMOJIS_AND_STICKERS);
const canManage = (perms: bigint, sound: StoredSound, botId: string) => has(perms, P.MANAGE_EMOJIS_AND_STICKERS) || (has(perms, P.CREATE_EXPRESSIONS) && same(sound.uploadedBy, botId));

/** Uploaders as Discord users, for callers allowed to see them. */
async function uploaders(sounds: StoredSound[]): Promise<Map<string, unknown>> {
  const ids = [...new Set(sounds.map((s) => s.uploadedBy).filter((id): id is string => typeof id === 'string' && isValidObjectId(id)))];
  if (ids.length === 0) return new Map();
  const users = await User.find({ id: { in: ids } }).catch(() => []);
  return new Map(users.map((u) => [u.id.toLowerCase(), toDiscordUserRow(u)]));
}

function view(s: StoredSound, guildId: string, available: boolean, users: Map<string, unknown> | null) {
  const user = users ? (typeof s.uploadedBy === 'string' ? users.get(s.uploadedBy.toLowerCase()) ?? null : null) : undefined;
  return toDiscordSound(s, guildId, { available, ...(users ? { user } : {}) });
}

/** Sound event to the guild's bots (also used by the web soundboard routes). */
export function emitSoundEvent(kind: 'CREATE' | 'UPDATE' | 'DELETE', guildId: string, sound: StoredSound, available = true) {
  if (kind === 'DELETE') return emitGuildSoundboardSound('GUILD_SOUNDBOARD_SOUND_DELETE', guildId, { sound_id: String(sound.id ?? ''), guild_id: guildId });
  return emitGuildSoundboardSound(kind === 'CREATE' ? 'GUILD_SOUNDBOARD_SOUND_CREATE' : 'GUILD_SOUNDBOARD_SOUND_UPDATE', guildId, toDiscordSound(sound, guildId, { available }));
}

/** GUILD_SOUNDBOARD_SOUNDS_UPDATE: every sound at once (the soundboard was turned on / off, so `available` changed). */
export function emitSoundsUpdate(server: { id: string; soundboardSounds?: unknown; settings?: unknown }) {
  return emitGuildSoundboardSound('GUILD_SOUNDBOARD_SOUNDS_UPDATE', server.id, { guild_id: server.id, soundboard_sounds: guildSoundboardSounds(server) });
}

export async function listSoundsForBot(guildId: string, botId: string): Promise<Result> {
  const server = await Server.findById(guildId);
  if (!server) return { status: 404, body: UNKNOWN_GUILD };
  const sounds = storedSounds(server.soundboardSounds);
  const perms = await guildPerms(guildId, botId);
  const users = canCreate(perms) ? await uploaders(sounds) : null;
  const available = soundboardEnabled(server.settings);
  return { status: 200, body: { items: sounds.map((s) => view(s, guildId, available, users)) } };
}

export async function getSoundForBot(guildId: string, soundId: string, botId: string): Promise<Result> {
  const server = await Server.findById(guildId);
  if (!server) return { status: 404, body: UNKNOWN_GUILD };
  const sound = storedSounds(server.soundboardSounds).find((s) => same(s.id, soundId));
  if (!sound) return { status: 404, body: UNKNOWN_SOUND };
  const perms = await guildPerms(guildId, botId);
  const users = canCreate(perms) ? await uploaders([sound]) : null;
  return { status: 200, body: view(sound, guildId, soundboardEnabled(server.settings), users) };
}

/** The stored emoji for emoji_id / emoji_name (a custom emoji must be the guild's own). */
async function storedEmoji(guildId: string, f: SoundFields): Promise<{ ok: true; emoji: string | undefined } | { ok: false; result: Result }> {
  if (f.emojiId) {
    const emoji = isValidObjectId(f.emojiId) ? await ServerEmoji.findById(f.emojiId).catch(() => null) : null;
    if (!emoji || !same(emoji.serverId, guildId)) return { ok: false, result: { status: 400, body: invalidFormBody([{ path: 'emoji_id', code: 'EMOJI_INVALID', message: 'Unknown emoji' }]) } };
    return { ok: true, emoji: formatCustomEmoji({ id: emoji.id, name: emoji.name, animated: emoji.animated }) };
  }
  if (f.emojiName) return { ok: true, emoji: f.emojiName };
  if (f.emojiId === null || f.emojiName === null) return { ok: true, emoji: DEFAULT_SOUND_EMOJI };
  return { ok: true, emoji: undefined };
}

export async function createSoundForBot(guildId: string, botId: string, body: Record<string, unknown>, headers: Headers): Promise<Result> {
  const perms = await guildPerms(guildId, botId);
  if (!canCreate(perms)) return { status: 403, body: MISSING_PERMISSIONS };
  const parsed = parseSoundFields(body, { create: true });
  const sound = parseSoundData(body.sound);
  if (!parsed.ok || !sound.ok) {
    const errors = [...(parsed.ok ? [] : parsed.errors), ...(sound.ok ? [] : [{ path: 'sound', code: sound.code, message: sound.message }])];
    return { status: 400, body: invalidFormBody(errors) };
  }
  const emoji = await storedEmoji(guildId, parsed.fields);
  if (!emoji.ok) return emoji.result;
  const server = await Server.findById(guildId);
  if (!server) return { status: 404, body: UNKNOWN_GUILD };
  if (storedSounds(server.soundboardSounds).length >= MAX_SOUNDS_PER_GUILD) {
    return { status: 400, body: { code: 30045, message: 'Maximum number of soundboard sounds reached' } };
  }
  let url: string;
  try {
    const { storage } = await import('@/lib/services/storage');
    const res = await storage.upload({
      category: 'audio',
      contentType: sound.contentType,
      data: sound.bytes,
      size: sound.bytes.length,
      filename: `sound.${sound.ext}`,
      serverId: guildId,
      scanUserId: botId,
    });
    url = res.url;
  } catch (err) {
    if ((err as { name?: string })?.name === 'ContentBlockedError') return { status: 403, body: { code: 20009, message: 'Explicit content cannot be sent to the desired recipient(s)' } };
    return { status: 400, body: invalidFormBody([{ path: 'sound', code: 'SOUND_INVALID', message: 'Invalid sound data.' }]) };
  }
  // Re-read right before writing: the web soundboard edits the same list.
  const fresh = (await Server.findById(guildId)) ?? server;
  const { sounds } = ensureSoundboardIds<Record<string, unknown>>(fresh.soundboardSounds, isValidObjectId, randomUUID);
  const added: StoredSound & { id: string } = {
    id: randomUUID(),
    name: sanitizeInput(parsed.fields.name ?? '').slice(0, 32),
    url,
    emoji: emoji.emoji ?? DEFAULT_SOUND_EMOJI,
    volume: parsed.fields.volume ?? 1,
    uploadedBy: botId,
  };
  sounds.push(added as Record<string, unknown> & { id: string });
  await Server.updateById(guildId, { soundboardSounds: sounds });
  audit({ serverId: guildId, userId: botId, actionType: AuditLogEvent.SOUNDBOARD_SOUND_CREATE, targetId: added.id, changes: [{ key: 'name', new: added.name }], reason: auditReason(headers['x-audit-log-reason']) });
  const available = soundboardEnabled(fresh.settings);
  void emitSoundEvent('CREATE', guildId, added, available);
  const users = await uploaders([added]);
  return { status: 200, body: view(added, guildId, available, users) };
}

export async function updateSoundForBot(guildId: string, soundId: string, botId: string, body: Record<string, unknown>, headers: Headers): Promise<Result> {
  const server = await Server.findById(guildId);
  if (!server) return { status: 404, body: UNKNOWN_GUILD };
  const { sounds } = ensureSoundboardIds<Record<string, unknown>>(server.soundboardSounds, isValidObjectId, randomUUID);
  const idx = sounds.findIndex((s) => same(s.id, soundId));
  if (idx === -1) return { status: 404, body: UNKNOWN_SOUND };
  const prev = sounds[idx] as StoredSound & Record<string, unknown> & { id: string };
  const perms = await guildPerms(guildId, botId);
  if (!canManage(perms, prev, botId)) return { status: 403, body: MISSING_PERMISSIONS };
  const parsed = parseSoundFields(body, { create: false });
  if (!parsed.ok) return { status: 400, body: invalidFormBody(parsed.errors) };
  const emoji = await storedEmoji(guildId, parsed.fields);
  if (!emoji.ok) return emoji.result;
  const next: Record<string, unknown> & { id: string } = { ...prev };
  if (parsed.fields.name !== undefined) next.name = sanitizeInput(parsed.fields.name).slice(0, 32);
  if (parsed.fields.volume !== undefined) next.volume = parsed.fields.volume;
  if (emoji.emoji !== undefined) next.emoji = emoji.emoji;
  sounds[idx] = next;
  const changes = (['name', 'emoji', 'volume'] as const)
    .filter((k) => prev[k] !== next[k])
    .map((k) => ({ key: k === 'emoji' ? 'emoji_name' : k, old: prev[k], new: next[k] }));
  const available = soundboardEnabled(server.settings);
  if (changes.length > 0) {
    await Server.updateById(guildId, { soundboardSounds: sounds });
    audit({ serverId: guildId, userId: botId, actionType: AuditLogEvent.SOUNDBOARD_SOUND_UPDATE, targetId: next.id, changes, reason: auditReason(headers['x-audit-log-reason']) });
    void emitSoundEvent('UPDATE', guildId, next, available);
  }
  const users = await uploaders([next]);
  return { status: 200, body: view(next, guildId, available, users) };
}

export async function deleteSoundForBot(guildId: string, soundId: string, botId: string, headers: Headers): Promise<Result> {
  const server = await Server.findById(guildId);
  if (!server) return { status: 404, body: UNKNOWN_GUILD };
  const { sounds } = ensureSoundboardIds<Record<string, unknown>>(server.soundboardSounds, isValidObjectId, randomUUID);
  const idx = sounds.findIndex((s) => same(s.id, soundId));
  if (idx === -1) return { status: 404, body: UNKNOWN_SOUND };
  const perms = await guildPerms(guildId, botId);
  if (!canManage(perms, sounds[idx] as StoredSound, botId)) return { status: 403, body: MISSING_PERMISSIONS };
  const [removed] = sounds.splice(idx, 1) as Array<StoredSound & { id: string }>;
  await Server.updateById(guildId, { soundboardSounds: sounds });
  audit({ serverId: guildId, userId: botId, actionType: AuditLogEvent.SOUNDBOARD_SOUND_DELETE, targetId: removed.id, changes: [{ key: 'name', old: removed.name }], reason: auditReason(headers['x-audit-log-reason']) });
  void emitSoundEvent('DELETE', guildId, removed);
  return { status: 204, body: '' };
}

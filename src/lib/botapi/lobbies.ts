/**
 * Discord Social SDK lobbies for the bot API (Discord's Lobby resource,
 * https://discord.com/developers/docs/resources/lobby): request validation,
 * limits and the Discord-shaped serializers. Pure, no I/O; storage lives in
 * src/lib/services/lobbies.ts and the routes in src/lib/api/botApi/social.ts.
 * Unit tested in tests/socialparity-lobbies.test.ts.
 *
 * Ids here are internal UUIDs: the bot API's id boundary
 * (src/lib/botapi/boundary.ts) turns snowflakes into UUIDs before a handler
 * runs and back afterwards for snowflake-format applications.
 */
import { createHash } from 'crypto';
import { FormErrors, FE, type FormErrorPath } from './formErrors';
import { isUuid } from './idTranslate';

export const LOBBY_LIMITS = {
  /** Total length (keys + values) of a metadata dictionary. */
  metadataTotal: 1000,
  /** Members in one create / modify / bulk request. */
  membersPerRequest: 25,
  /** Members of one lobby (Discord: 1,000). */
  maxMembers: 1000,
  /** Lobbies one user may be in per application (Discord: 100 per game). */
  lobbiesPerUserPerApp: 100,
  /** Live lobbies one application may hold (abuse guard; Discord does not document one). */
  lobbiesPerApp: 10_000,
  idleMinSeconds: 5,
  idleMaxSeconds: 604_800,
  /** Discord's default idle timeout (5 minutes). */
  idleDefaultSeconds: 300,
  secretMax: 250,
  additionalNameMin: 1,
  additionalNameMax: 80,
  messageMax: 2000,
  messageLimitDefault: 50,
  messageLimitMax: 200,
  /** Lobby message history kept and served (Discord: 72 hours). */
  historyMs: 72 * 3600 * 1000,
  moderationKeys: 5,
  moderationKeyMax: 1024,
  moderationValueMax: 2000,
} as const;

/** Lobby member flags (Discord: CanLinkLobby = 1 << 0). */
export const LOBBY_MEMBER_FLAGS = { CAN_LINK_LOBBY: 1 } as const;
const KNOWN_MEMBER_FLAGS = LOBBY_MEMBER_FLAGS.CAN_LINK_LOBBY;

/** Message flags a lobby message may be sent with (SUPPRESS_NOTIFICATIONS); the rest are server-set. */
export const LOBBY_MESSAGE_SENDABLE_FLAGS = 1 << 12;

export const UNKNOWN_LOBBY = { code: 10031, message: 'Unknown lobby' } as const;

export type Metadata = Record<string, string>;

/** `undefined` = field absent (keep), `null` = clear. */
export type MetadataInput = Metadata | null | undefined;

export interface MemberInput {
  id: string;
  metadata?: Metadata | null;
  flags?: number;
  /** `undefined` = keep the current value, `null` = clear it. */
  additionalName?: string | null;
  remove?: boolean;
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; errors: FormErrors };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Blob) && !(v instanceof Date);
}

const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/** A string/string dictionary of at most `LOBBY_LIMITS.metadataTotal` characters (keys + values). */
export function parseMetadata(raw: unknown, path: FormErrorPath, errors: FormErrors): MetadataInput {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  if (!isPlainObject(raw)) {
    errors.add(path, FE.BAD_TYPE, 'Only dictionaries may be used in a DictType');
    return undefined;
  }
  const out: Metadata = {};
  let total = 0;
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v !== 'string') {
      errors.add([...path, k], FE.BAD_TYPE, 'Could not interpret "{value}" as string.'.replace('{value}', String(v)));
      continue;
    }
    total += k.length + v.length;
    if (k === '__proto__') Object.defineProperty(out, k, { value: v, enumerable: true, writable: true, configurable: true });
    else out[k] = v;
  }
  if (total > LOBBY_LIMITS.metadataTotal) {
    errors.add(path, FE.MAX_LENGTH, `Must be ${LOBBY_LIMITS.metadataTotal} or fewer in length.`);
  }
  return out;
}

/** `idle_timeout_seconds`: an integer from 5 to 604800 (absent = undefined). */
export function parseIdleTimeout(raw: unknown, errors: FormErrors, path: FormErrorPath = ['idle_timeout_seconds']): number | undefined {
  if (raw === undefined || raw === null) return undefined;
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isInteger(n)) { errors.add(path, FE.COERCE, 'Value "' + String(raw) + '" is not int.'); return undefined; }
  if (n < LOBBY_LIMITS.idleMinSeconds) { errors.add(path, FE.MIN, `int value should be greater than or equal to ${LOBBY_LIMITS.idleMinSeconds}.`); return undefined; }
  if (n > LOBBY_LIMITS.idleMaxSeconds) { errors.add(path, FE.MAX, `int value should be less than or equal to ${LOBBY_LIMITS.idleMaxSeconds}.`); return undefined; }
  return n;
}

/** A non-negative integer bitfield limited to `known` bits. */
function parseFlags(raw: unknown, known: number, path: FormErrorPath, errors: FormErrors): number | undefined {
  if (raw === undefined || raw === null) return undefined;
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isSafeInteger(n) || n < 0) { errors.add(path, FE.COERCE, 'Value "' + String(raw) + '" is not int.'); return undefined; }
  if ((n & ~known) !== 0 || n > 0x7fffffff) { errors.add(path, FE.CHOICES, 'Invalid flags.'); return undefined; }
  return n;
}

/** `flags` on a lobby (no lobby flags are documented: only 0 is accepted). */
export function parseLobbyFlags(raw: unknown, errors: FormErrors): number | undefined {
  return parseFlags(raw, 0, ['flags'], errors);
}

function parseAdditionalName(raw: unknown, path: FormErrorPath, errors: FormErrors): string | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  if (typeof raw !== 'string') { errors.add(path, FE.BAD_TYPE, 'Could not interpret value as string.'); return undefined; }
  const v = raw.replace(CONTROL, '').trim();
  if (v.length < LOBBY_LIMITS.additionalNameMin || v.length > LOBBY_LIMITS.additionalNameMax) {
    errors.add(path, FE.BAD_LENGTH, `Must be between ${LOBBY_LIMITS.additionalNameMin} and ${LOBBY_LIMITS.additionalNameMax} in length.`);
    return undefined;
  }
  return v;
}

/** Fields of a lobby member body (PUT member, or one entry of a members list). */
export function parseMemberFields(
  raw: Record<string, unknown>,
  path: FormErrorPath,
  errors: FormErrors,
): Omit<MemberInput, 'id' | 'remove'> {
  const out: Omit<MemberInput, 'id' | 'remove'> = {};
  const metadata = parseMetadata(raw.metadata, [...path, 'metadata'], errors);
  if (metadata !== undefined) out.metadata = metadata;
  const flags = parseFlags(raw.flags, KNOWN_MEMBER_FLAGS, [...path, 'flags'], errors);
  if (flags !== undefined) out.flags = flags;
  const name = parseAdditionalName(raw.additional_name, [...path, 'additional_name'], errors);
  if (name !== undefined) out.additionalName = name;
  return out;
}

/**
 * A members array (create / modify / bulk): 1 to 25 entries, each with an id
 * (an internal UUID after the id boundary; anything else is kept as given so
 * the caller can answer Unknown User), no duplicates.
 */
export function parseMembersList(
  raw: unknown,
  errors: FormErrors,
  opts: { path?: FormErrorPath; allowRemove?: boolean; min?: number } = {},
): MemberInput[] {
  const path = opts.path ?? ['members'];
  if (!Array.isArray(raw)) { errors.add(path, FE.BAD_TYPE, 'Only iterables may be used in a ListType'); return []; }
  const min = opts.min ?? 0;
  if (raw.length < min) { errors.add(path, FE.MIN_LENGTH, `Must be ${min} or more in length.`); return []; }
  if (raw.length > LOBBY_LIMITS.membersPerRequest) {
    errors.add(path, FE.MAX_LENGTH, `Must be ${LOBBY_LIMITS.membersPerRequest} or fewer in length.`);
    return [];
  }
  const seen = new Set<string>();
  const out: MemberInput[] = [];
  raw.forEach((entry, i) => {
    if (!isPlainObject(entry)) { errors.add([...path, i], FE.BAD_TYPE, 'Only dictionaries may be used in a DictType'); return; }
    const idRaw = entry.id;
    const id = typeof idRaw === 'number' ? String(idRaw) : idRaw;
    if (typeof id !== 'string' || !id) { errors.add([...path, i, 'id'], FE.REQUIRED, 'This field is required'); return; }
    const key = id.toLowerCase();
    if (seen.has(key)) { errors.add([...path, i, 'id'], 'BASE_TYPE_DUPLICATE', 'Duplicate member id.'); return; }
    seen.add(key);
    const fields = parseMemberFields(entry, [...path, i], errors);
    const m: MemberInput = { id: isUuid(id) ? id.toLowerCase() : id, ...fields };
    if (opts.allowRemove && entry.remove_member !== undefined) {
      if (typeof entry.remove_member !== 'boolean') errors.add([...path, i, 'remove_member'], FE.BAD_TYPE, 'Must be either true or false.');
      else m.remove = entry.remove_member;
    }
    out.push(m);
  });
  return out;
}

export interface CreateLobbyInput {
  metadata: MetadataInput;
  members: MemberInput[];
  idleTimeoutSeconds: number | undefined;
  flags: number | undefined;
}

/** POST /lobbies body. */
export function parseCreateLobby(body: unknown): Parsed<CreateLobbyInput> {
  const errors = new FormErrors();
  const b = isPlainObject(body) ? body : {};
  const { metadata, members, idle_timeout_seconds, flags } = b;
  const value: CreateLobbyInput = {
    metadata: parseMetadata(metadata, ['metadata'], errors),
    members: members === undefined || members === null ? [] : parseMembersList(members, errors),
    idleTimeoutSeconds: parseIdleTimeout(idle_timeout_seconds, errors),
    flags: parseLobbyFlags(flags, errors),
  };
  return errors.ok ? { ok: true, value } : { ok: false, errors };
}

export interface ModifyLobbyInput {
  metadata: MetadataInput;
  /** `undefined` = keep the member list; otherwise the full replacement list. */
  members: MemberInput[] | undefined;
  idleTimeoutSeconds: number | undefined;
  flags: number | undefined;
}

/** PATCH /lobbies/{id} body. */
export function parseModifyLobby(body: unknown): Parsed<ModifyLobbyInput> {
  const errors = new FormErrors();
  const b = isPlainObject(body) ? body : {};
  const { metadata, members, idle_timeout_seconds, flags } = b;
  const value: ModifyLobbyInput = {
    metadata: parseMetadata(metadata, ['metadata'], errors),
    members: members === undefined ? undefined : members === null ? [] : parseMembersList(members, errors),
    idleTimeoutSeconds: parseIdleTimeout(idle_timeout_seconds, errors),
    flags: parseLobbyFlags(flags, errors),
  };
  return errors.ok ? { ok: true, value } : { ok: false, errors };
}

export interface CreateOrJoinInput {
  secret: string;
  lobbyMetadata: MetadataInput;
  memberMetadata: MetadataInput;
  idleTimeoutSeconds: number | undefined;
  flags: number | undefined;
}

/** PUT /lobbies body (create or join by secret). */
export function parseCreateOrJoin(body: unknown): Parsed<CreateOrJoinInput> {
  const errors = new FormErrors();
  const b = isPlainObject(body) ? body : {};
  const { secret, lobby_metadata, member_metadata, idle_timeout_seconds, flags } = b;
  let s = '';
  if (secret === undefined || secret === null || secret === '') errors.add(['secret'], FE.REQUIRED, 'This field is required');
  else if (typeof secret !== 'string') errors.add(['secret'], FE.BAD_TYPE, 'Could not interpret value as string.');
  else if (secret.length > LOBBY_LIMITS.secretMax) errors.add(['secret'], FE.MAX_LENGTH, `Must be ${LOBBY_LIMITS.secretMax} or fewer in length.`);
  else s = secret;
  const value: CreateOrJoinInput = {
    secret: s,
    lobbyMetadata: parseMetadata(lobby_metadata, ['lobby_metadata'], errors),
    memberMetadata: parseMetadata(member_metadata, ['member_metadata'], errors),
    idleTimeoutSeconds: parseIdleTimeout(idle_timeout_seconds, errors),
    flags: parseLobbyFlags(flags, errors),
  };
  return errors.ok ? { ok: true, value } : { ok: false, errors };
}

/** PUT /lobbies/{id}/members/{user_id} body. */
export function parseMemberUpsert(body: unknown): Parsed<Omit<MemberInput, 'id' | 'remove'>> {
  const errors = new FormErrors();
  const b = isPlainObject(body) ? body : {};
  const { metadata, flags, additional_name } = b;
  const value = parseMemberFields({ metadata, flags, additional_name }, [], errors);
  return errors.ok ? { ok: true, value } : { ok: false, errors };
}

/** POST /lobbies/{id}/members/bulk body: an array of 1-25 members (`remove_member` allowed). */
export function parseBulkMembers(body: unknown): Parsed<MemberInput[]> {
  const errors = new FormErrors();
  const value = parseMembersList(body, errors, { path: [], allowRemove: true, min: 1 });
  return errors.ok ? { ok: true, value } : { ok: false, errors };
}

export interface LobbyMessageInput {
  content: string;
  metadata: MetadataInput;
  flags: number;
  /** Echoed back; with `enforceNonce` a repeat send returns the first message (Discord's nonce rules). */
  nonce: string | number | null;
  enforceNonce: boolean;
}

/**
 * Message fields the shared create-message schema lists that lobby messages
 * don't carry (Discord's lobby docs: content, metadata and flags only). They
 * are rejected rather than silently dropped. `allowed_mentions` is accepted:
 * lobby messages never ping anyone, so any value is already honoured.
 */
export const LOBBY_MESSAGE_UNSUPPORTED_FIELDS = [
  'embeds', 'attachments', 'components', 'poll', 'sticker_ids', 'message_reference', 'tts', 'shared_client_theme',
] as const;

/** POST /lobbies/{id}/messages body (content is validated raw; the caller sanitizes it for storage). */
export function parseLobbyMessage(body: unknown): Parsed<LobbyMessageInput> {
  const errors = new FormErrors();
  const b = isPlainObject(body) ? body : {};
  const { content, metadata, flags, nonce, enforce_nonce, allowed_mentions } = b;
  let text = '';
  if (content === undefined || content === null) errors.add(['content'], FE.REQUIRED, 'This field is required');
  else if (typeof content !== 'string') errors.add(['content'], FE.BAD_TYPE, 'Could not interpret value as string.');
  else if (!content.trim()) errors.add(['content'], FE.MIN_LENGTH, 'Must be 1 or more in length.');
  else if (content.length > LOBBY_LIMITS.messageMax) errors.add(['content'], FE.MAX_LENGTH, `Must be ${LOBBY_LIMITS.messageMax} or fewer in length.`);
  else text = content;
  let n: string | number | null = null;
  if (nonce !== undefined && nonce !== null) {
    if (typeof nonce === 'number' && Number.isSafeInteger(nonce)) n = nonce;
    else if (typeof nonce === 'string' && nonce.length <= 25) n = nonce;
    else errors.add(['nonce'], FE.BAD_TYPE, 'Must be an integer or a string of 25 or fewer characters.');
  }
  if (enforce_nonce !== undefined && enforce_nonce !== null && typeof enforce_nonce !== 'boolean') {
    errors.add(['enforce_nonce'], FE.BAD_TYPE, 'Must be either true or false.');
  }
  if (allowed_mentions !== undefined && allowed_mentions !== null && !isPlainObject(allowed_mentions)) {
    errors.add(['allowed_mentions'], FE.BAD_TYPE, 'Only dictionaries may be used in a DictType');
  }
  for (const key of LOBBY_MESSAGE_UNSUPPORTED_FIELDS) {
    const v = b[key];
    if (v === undefined || v === null || v === false || (Array.isArray(v) && v.length === 0)) continue;
    errors.add([key], 'LOBBY_MESSAGE_FIELD_UNSUPPORTED', 'Lobby messages only support content, metadata and flags.');
  }
  const value: LobbyMessageInput = {
    content: text,
    metadata: parseMetadata(metadata, ['metadata'], errors),
    flags: parseFlags(flags, LOBBY_MESSAGE_SENDABLE_FLAGS, ['flags'], errors) ?? 0,
    nonce: n,
    enforceNonce: enforce_nonce === true,
  };
  return errors.ok ? { ok: true, value } : { ok: false, errors };
}

/**
 * Moderation metadata (lobby and partner DM messages): free-form string pairs,
 * at most 5 keys, keys 1-1024 and values up to 2000 characters.
 */
export function parseModerationMetadata(body: unknown): Parsed<Metadata> {
  const errors = new FormErrors();
  if (!isPlainObject(body)) {
    errors.add([], FE.BAD_TYPE, 'Only dictionaries may be used in a DictType');
    return { ok: false, errors };
  }
  const entries = Object.entries(body);
  if (entries.length > LOBBY_LIMITS.moderationKeys) {
    errors.add([], FE.MAX_LENGTH, `Must be ${LOBBY_LIMITS.moderationKeys} or fewer in length.`);
    return { ok: false, errors };
  }
  const out: Metadata = {};
  for (const [k, v] of entries) {
    if (k.length < 1 || k.length > LOBBY_LIMITS.moderationKeyMax) {
      errors.add([k.slice(0, 64) || '_key'], FE.BAD_LENGTH, `Key must be between 1 and ${LOBBY_LIMITS.moderationKeyMax} in length.`);
      continue;
    }
    if (typeof v !== 'string') { errors.add([k], FE.BAD_TYPE, 'Could not interpret value as string.'); continue; }
    if (v.length > LOBBY_LIMITS.moderationValueMax) { errors.add([k], FE.MAX_LENGTH, `Must be ${LOBBY_LIMITS.moderationValueMax} or fewer in length.`); continue; }
    if (k === '__proto__') Object.defineProperty(out, k, { value: v, enumerable: true, writable: true, configurable: true });
    else out[k] = v;
  }
  return errors.ok ? { ok: true, value: out } : { ok: false, errors };
}

/** `limit` of GET /lobbies/{id}/messages: 1-200, default 50. */
export function parseMessageLimit(raw: unknown): Parsed<number> {
  if (raw === undefined || raw === null || raw === '') return { ok: true, value: LOBBY_LIMITS.messageLimitDefault };
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : NaN;
  const errors = new FormErrors();
  if (!Number.isInteger(n)) errors.add(['limit'], FE.COERCE, 'Value "' + String(raw) + '" is not int.');
  else if (n < 1 || n > LOBBY_LIMITS.messageLimitMax) errors.add(['limit'], FE.MAX, `int value should be between 1 and ${LOBBY_LIMITS.messageLimitMax}.`);
  return errors.ok ? { ok: true, value: n } : { ok: false, errors };
}

/** Stored form of a lobby secret: unique per application, never kept in clear. */
export function hashLobbySecret(applicationId: string, secret: string): string {
  return createHash('sha256').update(`${applicationId.toLowerCase()}\u0000${secret}`).digest('hex');
}

export interface LobbyRowLike {
  id: string;
  applicationId: string;
  metadata?: unknown;
  flags?: number | null;
  idleTimeoutSeconds?: number | null;
  lastActivityAt?: Date | string | null;
  createdAt?: Date | string | null;
}

/** Idle past its timeout (Discord shuts such lobbies down; we delete them on the next access). */
export function isLobbyExpired(l: LobbyRowLike, now: number = Date.now()): boolean {
  const idle = l.idleTimeoutSeconds ?? LOBBY_LIMITS.idleDefaultSeconds;
  const last = l.lastActivityAt ?? l.createdAt;
  if (!last) return false;
  const t = new Date(last).getTime();
  return Number.isFinite(t) && now - t > idle * 1000;
}

export interface LobbyMemberRowLike {
  userId: string;
  metadata?: unknown;
  flags?: number | null;
  additionalName?: string | null;
}

function metadataOut(v: unknown): Metadata | null {
  return isPlainObject(v) ? (v as Metadata) : null;
}

/** Discord lobby member object. */
export function toDiscordLobbyMember(m: LobbyMemberRowLike) {
  return {
    id: m.userId,
    metadata: metadataOut(m.metadata),
    flags: Number(m.flags) || 0,
    ...(m.additionalName ? { additional_name: m.additionalName } : {}),
  };
}

/** Discord lobby object (`linked_channel` only when one is linked). */
export function toDiscordLobby(l: LobbyRowLike, members: LobbyMemberRowLike[], linkedChannel?: Record<string, unknown> | null) {
  return {
    id: l.id,
    application_id: l.applicationId,
    metadata: metadataOut(l.metadata),
    members: members.map(toDiscordLobbyMember),
    ...(linkedChannel ? { linked_channel: linkedChannel } : {}),
    flags: Number(l.flags) || 0,
  };
}

export interface LobbyMessageRowLike {
  id: string;
  lobbyId: string;
  applicationId: string;
  flags?: number | null;
  additionalName?: string | null;
  moderationMetadata?: unknown;
  createdAt?: Date | string | null;
}

/** Discord lobby message object (`content` already decrypted; `metadata` only on the send response). */
export function toDiscordLobbyMessage(
  m: LobbyMessageRowLike,
  content: string,
  author: Record<string, unknown>,
  extra: { metadata?: Metadata | null; nonce?: string | number | null } = {},
) {
  const moderation = metadataOut(m.moderationMetadata);
  return {
    id: m.id,
    type: 0,
    content,
    lobby_id: m.lobbyId,
    channel_id: m.lobbyId,
    author,
    ...(m.additionalName ? { lobby_member: { additional_name: m.additionalName } } : {}),
    ...(extra.metadata !== undefined ? { metadata: extra.metadata } : {}),
    ...(extra.nonce !== undefined && extra.nonce !== null ? { nonce: extra.nonce } : {}),
    ...(moderation ? { moderation_metadata: moderation } : {}),
    flags: Number(m.flags) || 0,
    application_id: m.applicationId,
  };
}

/** Plain text for a lobby message forwarded into its linked channel (no pings: @everyone/@here are defused). */
export function linkedChannelForwardText(authorName: string, content: string): string {
  const name = authorName.replace(/[*_~`|\\]/g, (c) => `\\${c}`).slice(0, 80) || 'Player';
  const body = content.replace(/@(everyone|here)/g, '@​$1');
  const text = `**${name}**: ${body}`;
  return text.length > 2000 ? `${text.slice(0, 1999)}…` : text;
}

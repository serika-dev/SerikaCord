/**
 * Emojis and stickers for the Discord-compatible bot API (WP4b): guild emoji
 * and sticker CRUD, GET /stickers/{id}, sticker packs, application emojis.
 * Images arrive as data URIs (emojis) or multipart files (stickers) and go
 * through the storage pipeline (type check, size cap, Trust & Safety scan)
 * like web uploads. Every guild change is audit-logged and sent to bots as
 * GUILD_EMOJIS_UPDATE / GUILD_STICKERS_UPDATE. Pure rules: ./expressionRules.ts.
 *
 * Permissions follow Discord: creating needs CREATE_GUILD_EXPRESSIONS or
 * MANAGE_GUILD_EXPRESSIONS (Serika: CREATE_EXPRESSIONS / MANAGE_EMOJIS_AND_STICKERS);
 * editing or deleting someone else's needs MANAGE_GUILD_EXPRESSIONS.
 */
import { AppEmoji, Role, ServerEmoji, ServerMember, ServerSticker, User } from '@/lib/models';
import { PERMISSION_BITS as P, hasPermission } from '@/lib/permissions/bits';
import { isValidObjectId, sanitizeInput } from '@/lib/security';
import { audit } from '@/lib/services/auditLog';
import { AuditLogEvent, auditReason, diffChanges } from '@/lib/audit/auditLog';
import { toDiscordEmoji, toDiscordSticker, toDiscordUserRow } from '@/lib/services/gatewayEvents';
import { applyTimeout } from '@/lib/permissions/botChannel';
import {
  MAX_APP_EMOJIS, MAX_EMOJI_BYTES, MAX_GUILD_EMOJIS, MAX_GUILD_STICKERS, MAX_STICKER_BYTES,
  emojiNameError, extensionFor, parseImageDataUri, parseStickerFields, stickerKind, stickerTagList, type ImageKind,
} from './expressionRules';

type Result = { status: number; body: unknown };
type Headers = Record<string, string | undefined>;

const MISSING_PERMISSIONS = { code: 50013, message: 'Missing Permissions' };
const UNKNOWN_EMOJI = { code: 10014, message: 'Unknown Emoji' };
const UNKNOWN_STICKER = { code: 10060, message: 'Unknown Sticker' };
const same = (a?: string | null, b?: string | null) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
const formError = (path: string, code: string, message: string) => ({ code: 50035, message: 'Invalid Form Body', errors: { [path]: { _errors: [{ code, message }] } } });

/** The bot's guild-wide permissions (0 when not a member), reduced while timed out. */
async function guildPerms(guildId: string, botId: string): Promise<bigint> {
  const member = await ServerMember.findOne({ serverId: guildId, userId: botId });
  const { getMemberChannelPermissions } = await import('@/lib/api/channels');
  const perms = await getMemberChannelPermissions(botId, { serverId: guildId }, member ?? null);
  return applyTimeout(perms, member?.communicationDisabledUntil ?? null);
}

const has = (perms: bigint, bit: bigint) => hasPermission(perms, P.ADMINISTRATOR) || hasPermission(perms, bit);
const canCreate = (perms: bigint) => has(perms, P.CREATE_EXPRESSIONS) || has(perms, P.MANAGE_EMOJIS_AND_STICKERS);
const canManageOne = (perms: bigint, uploadedBy: string | null | undefined, botId: string) =>
  has(perms, P.MANAGE_EMOJIS_AND_STICKERS) || (same(uploadedBy, botId) && has(perms, P.CREATE_EXPRESSIONS));

async function uploaders(ids: Array<string | null | undefined>) {
  const unique = [...new Set(ids.filter((id): id is string => !!id))];
  if (!unique.length) return new Map<string, ReturnType<typeof toDiscordUserRow>>();
  const users = await User.find({ id: { in: unique } }).catch(() => []);
  return new Map(users.map((u) => [u.id.toLowerCase(), toDiscordUserRow(u)]));
}

/** Discord includes `user` (the uploader) only for callers who may manage expressions. */
async function emojiViews(rows: Array<Parameters<typeof toDiscordEmoji>[0] & { uploadedBy?: string | null }>, perms: bigint) {
  const showUser = canCreate(perms);
  const users = showUser ? await uploaders(rows.map((r) => r.uploadedBy)) : new Map();
  return rows.map((r) => ({ ...toDiscordEmoji(r), ...(showUser && r.uploadedBy && users.get(r.uploadedBy.toLowerCase()) ? { user: users.get(r.uploadedBy.toLowerCase()) } : {}) }));
}

async function stickerViews(rows: Array<Parameters<typeof toDiscordSticker>[0] & { uploadedBy?: string | null }>, perms: bigint) {
  const showUser = canCreate(perms);
  const users = showUser ? await uploaders(rows.map((r) => r.uploadedBy)) : new Map();
  return rows.map((r) => ({ ...toDiscordSticker(r), ...(showUser && r.uploadedBy && users.get(r.uploadedBy.toLowerCase()) ? { user: users.get(r.uploadedBy.toLowerCase()) } : {}) }));
}

type StoredImage = { ok: true; url: string } | { ok: false; status: number; body: unknown; message: string };

/**
 * Store an emoji / sticker image through storage.upload (type and size check,
 * Trust & Safety scan attributed to `scanUserId` or `userId`). A blocked image
 * is a 403 (Discord body + the user-facing T&S message).
 */
async function storeImage(category: 'emojis' | 'stickers', bytes: Buffer, kind: ImageKind, ctx: { serverId?: string; userId: string; scanUserId?: string; ip?: string }): Promise<StoredImage> {
  try {
    const { storage } = await import('@/lib/services/storage');
    const contentType = kind === 'image/apng' ? 'image/png' : kind;
    const res = await storage.upload({
      category,
      contentType,
      data: bytes,
      size: bytes.length,
      filename: `${category === 'emojis' ? 'emoji' : 'sticker'}.${extensionFor(kind)}`,
      ...(ctx.serverId ? { serverId: ctx.serverId } : {}),
      userId: ctx.userId,
      scanUserId: ctx.scanUserId ?? ctx.userId,
      ...(ctx.ip ? { ip: ctx.ip } : {}),
    });
    return { ok: true, url: res.url };
  } catch (err) {
    const blocked = (err as { name?: string })?.name === 'ContentBlockedError';
    if (blocked) {
      return {
        ok: false, status: 403,
        body: { code: 20009, message: 'Explicit content cannot be sent to the desired recipient(s)' },
        message: (err as Error)?.message || 'This image cannot be used',
      };
    }
    console.error('[botapi] expression upload failed:', (err as Error)?.message ?? err);
    return { ok: false, status: 400, body: formError(category === 'emojis' ? 'image' : 'file', 'IMAGE_INVALID', 'Invalid image data'), message: 'Invalid image data' };
  }
}

function emitEmojis(guildId: string) {
  void import('@/lib/services/gatewayEvents').then(({ emitGuildEmojisUpdate }) => emitGuildEmojisUpdate(guildId)).catch(() => {});
}
function emitStickers(guildId: string) {
  void import('@/lib/services/gatewayEvents').then(({ emitGuildStickersUpdate }) => emitGuildStickersUpdate(guildId)).catch(() => {});
}

/** Only roles of this guild may restrict an emoji. */
async function cleanEmojiRoles(guildId: string, roles: unknown): Promise<string[] | { error: unknown }> {
  if (roles === undefined || roles === null) return [];
  if (!Array.isArray(roles)) return { error: formError('roles', 'BASE_TYPE_ARRAY', 'Must be an array.') };
  const own = new Map(((await Role.find({ serverId: guildId })) as Array<{ id: string; isDefault?: boolean | null }>)
    .filter((r) => !r.isDefault).map((r) => [r.id.toLowerCase(), r.id]));
  const out: string[] = [];
  for (const id of roles) {
    const hit = typeof id === 'string' ? own.get(id.toLowerCase()) : undefined;
    if (!hit) return { error: formError('roles', 'GUILD_ROLE_INVALID', 'Unknown role.') };
    if (!out.includes(hit)) out.push(hit);
  }
  return out;
}

// ─── Guild emojis ─────────────────────────────────────────────────────────────

export async function listGuildEmojis(guildId: string, botId: string): Promise<Result> {
  const [rows, perms] = await Promise.all([ServerEmoji.find({ serverId: guildId }), guildPerms(guildId, botId)]);
  return { status: 200, body: await emojiViews(rows, perms) };
}

export async function getGuildEmoji(guildId: string, emojiId: string, botId: string): Promise<Result> {
  const emoji = isValidObjectId(emojiId) ? await ServerEmoji.findById(emojiId) : null;
  if (!emoji || !same(emoji.serverId, guildId)) return { status: 404, body: UNKNOWN_EMOJI };
  const [view] = await emojiViews([emoji], await guildPerms(guildId, botId));
  return { status: 200, body: view };
}

export async function createGuildEmoji(guildId: string, botId: string, body: { name?: unknown; image?: unknown; roles?: unknown }, headers: Headers): Promise<Result> {
  const perms = await guildPerms(guildId, botId);
  if (!canCreate(perms)) return { status: 403, body: MISSING_PERMISSIONS };
  const nameErr = emojiNameError(body.name);
  if (nameErr) return { status: 400, body: formError('name', nameErr.code, nameErr.message) };
  const image = parseImageDataUri(body.image, MAX_EMOJI_BYTES);
  if (!image.ok) return { status: 400, body: formError('image', image.code, image.message) };
  const roles = await cleanEmojiRoles(guildId, body.roles);
  if (!Array.isArray(roles)) return { status: 400, body: roles.error };
  const existing = await ServerEmoji.find({ serverId: guildId });
  if (existing.length >= MAX_GUILD_EMOJIS) return { status: 400, body: { code: 30008, message: `Maximum number of emojis reached (${MAX_GUILD_EMOJIS})` } };
  if (existing.some((e) => e.name.toLowerCase() === String(body.name).toLowerCase())) {
    return { status: 400, body: formError('name', 'EMOJI_NAME_TAKEN', 'An emoji with this name already exists in this server.') };
  }
  const stored = await storeImage('emojis', image.bytes, image.kind, { serverId: guildId, userId: botId });
  if (!stored.ok) return { status: stored.status, body: stored.body };
  const emoji = await ServerEmoji.create({
    serverId: guildId,
    name: String(body.name),
    imageUrl: stored.url,
    animated: image.animated,
    available: true,
    managed: false,
    requireColons: true,
    roles,
    uploadedBy: botId,
  });
  audit({ serverId: guildId, userId: botId, actionType: AuditLogEvent.EMOJI_CREATE, targetId: emoji.id, changes: [{ key: 'name', new: emoji.name }], options: { emoji_url: emoji.imageUrl }, reason: auditReason(headers['x-audit-log-reason']) });
  emitEmojis(guildId);
  const [view] = await emojiViews([emoji], perms);
  return { status: 201, body: view };
}

export async function updateGuildEmoji(guildId: string, emojiId: string, botId: string, body: { name?: unknown; roles?: unknown }, headers: Headers): Promise<Result> {
  const emoji = isValidObjectId(emojiId) ? await ServerEmoji.findById(emojiId) : null;
  if (!emoji || !same(emoji.serverId, guildId)) return { status: 404, body: UNKNOWN_EMOJI };
  const perms = await guildPerms(guildId, botId);
  if (!canManageOne(perms, emoji.uploadedBy, botId)) return { status: 403, body: MISSING_PERMISSIONS };
  const updates: Record<string, unknown> = {};
  if (body.name !== undefined) {
    const nameErr = emojiNameError(body.name);
    if (nameErr) return { status: 400, body: formError('name', nameErr.code, nameErr.message) };
    if (String(body.name).toLowerCase() !== emoji.name.toLowerCase()) {
      const clash = (await ServerEmoji.find({ serverId: guildId })).some((e) => e.id !== emoji.id && e.name.toLowerCase() === String(body.name).toLowerCase());
      if (clash) return { status: 400, body: formError('name', 'EMOJI_NAME_TAKEN', 'An emoji with this name already exists in this server.') };
    }
    updates.name = String(body.name);
  }
  if (body.roles !== undefined) {
    const roles = await cleanEmojiRoles(guildId, body.roles);
    if (!Array.isArray(roles)) return { status: 400, body: roles.error };
    updates.roles = roles;
  }
  const updated = Object.keys(updates).length ? (await ServerEmoji.updateById(emoji.id, updates)) ?? emoji : emoji;
  const changes = diffChanges(emoji as Record<string, unknown>, updates, { name: 'name', roles: 'roles' });
  if (changes.length) {
    audit({ serverId: guildId, userId: botId, actionType: AuditLogEvent.EMOJI_UPDATE, targetId: emoji.id, changes, options: { emoji_url: emoji.imageUrl }, reason: auditReason(headers['x-audit-log-reason']) });
    emitEmojis(guildId);
  }
  const [view] = await emojiViews([updated], perms);
  return { status: 200, body: view };
}

export async function deleteGuildEmoji(guildId: string, emojiId: string, botId: string, headers: Headers): Promise<Result> {
  const emoji = isValidObjectId(emojiId) ? await ServerEmoji.findById(emojiId) : null;
  if (!emoji || !same(emoji.serverId, guildId)) return { status: 404, body: UNKNOWN_EMOJI };
  const perms = await guildPerms(guildId, botId);
  if (!canManageOne(perms, emoji.uploadedBy, botId)) return { status: 403, body: MISSING_PERMISSIONS };
  await ServerEmoji.deleteById(emoji.id);
  audit({ serverId: guildId, userId: botId, actionType: AuditLogEvent.EMOJI_DELETE, targetId: emoji.id, changes: [{ key: 'name', old: emoji.name }], options: { emoji_url: emoji.imageUrl }, reason: auditReason(headers['x-audit-log-reason']) });
  emitEmojis(guildId);
  return { status: 204, body: '' };
}

// ─── Guild stickers ───────────────────────────────────────────────────────────

export async function listGuildStickers(guildId: string, botId: string): Promise<Result> {
  const [rows, perms] = await Promise.all([ServerSticker.find({ serverId: guildId }), guildPerms(guildId, botId)]);
  return { status: 200, body: await stickerViews(rows, perms) };
}

export async function getGuildSticker(guildId: string, stickerId: string, botId: string): Promise<Result> {
  const sticker = isValidObjectId(stickerId) ? await ServerSticker.findById(stickerId) : null;
  if (!sticker || !same(sticker.serverId, guildId)) return { status: 404, body: UNKNOWN_STICKER };
  const [view] = await stickerViews([sticker], await guildPerms(guildId, botId));
  return { status: 200, body: view };
}

/** GET /stickers/{id}: a guild sticker, only from a guild the bot is in (Serika has no standard stickers). */
export async function getStickerById(stickerId: string, botId: string): Promise<Result> {
  const sticker = isValidObjectId(stickerId) ? await ServerSticker.findById(stickerId) : null;
  if (!sticker) return { status: 404, body: UNKNOWN_STICKER };
  const member = await ServerMember.findOne({ serverId: sticker.serverId, userId: botId });
  if (!member) return { status: 404, body: UNKNOWN_STICKER };
  return { status: 200, body: toDiscordSticker(sticker) };
}

export interface StickerFile { name?: string; type?: string; size: number; arrayBuffer(): Promise<ArrayBuffer> }

export async function createGuildSticker(guildId: string, botId: string, body: Record<string, unknown>, file: StickerFile | null, headers: Headers): Promise<Result> {
  const perms = await guildPerms(guildId, botId);
  if (!canCreate(perms)) return { status: 403, body: MISSING_PERMISSIONS };
  const fields = parseStickerFields(body, true);
  if (!fields.ok) return { status: 400, body: fields.error };
  if (!file) return { status: 400, body: formError('file', 'BASE_TYPE_REQUIRED', 'This field is required') };
  if (file.size > MAX_STICKER_BYTES) return { status: 400, body: formError('file', 'BINARY_TYPE_MAX_SIZE', `File cannot be larger than ${MAX_STICKER_BYTES / 1024}.0 kb.`) };
  const bytes = Buffer.from(await file.arrayBuffer());
  const kind = stickerKind(bytes, file.type);
  if (!kind) return { status: 400, body: { code: 50046, message: 'Invalid Asset' } };
  const existing = await ServerSticker.find({ serverId: guildId });
  if (existing.length >= MAX_GUILD_STICKERS) return { status: 400, body: { code: 30039, message: 'Maximum number of stickers reached' } };
  const name = sanitizeInput(fields.value.name ?? '');
  if (existing.some((s) => s.name.toLowerCase() === name.toLowerCase())) {
    return { status: 400, body: formError('name', 'STICKER_NAME_TAKEN', 'A sticker with this name already exists in this server.') };
  }
  const stored = await storeImage('stickers', bytes, kind, { serverId: guildId, userId: botId });
  if (!stored.ok) return { status: stored.status, body: stored.body };
  const sticker = await ServerSticker.create({
    serverId: guildId,
    name,
    description: fields.value.description ? sanitizeInput(fields.value.description) : null,
    imageUrl: stored.url,
    tags: stickerTagList(fields.value.tags ?? ''),
    available: true,
    uploadedBy: botId,
  });
  audit({ serverId: guildId, userId: botId, actionType: AuditLogEvent.STICKER_CREATE, targetId: sticker.id, changes: [{ key: 'name', new: sticker.name }], reason: auditReason(headers['x-audit-log-reason']) });
  emitStickers(guildId);
  const [view] = await stickerViews([sticker], perms);
  return { status: 201, body: view };
}

export async function updateGuildSticker(guildId: string, stickerId: string, botId: string, body: Record<string, unknown>, headers: Headers): Promise<Result> {
  const sticker = isValidObjectId(stickerId) ? await ServerSticker.findById(stickerId) : null;
  if (!sticker || !same(sticker.serverId, guildId)) return { status: 404, body: UNKNOWN_STICKER };
  const perms = await guildPerms(guildId, botId);
  if (!canManageOne(perms, sticker.uploadedBy, botId)) return { status: 403, body: MISSING_PERMISSIONS };
  const fields = parseStickerFields(body, false);
  if (!fields.ok) return { status: 400, body: fields.error };
  const updates: Record<string, unknown> = {};
  if (fields.value.name !== undefined) {
    const name = sanitizeInput(fields.value.name);
    if (name.toLowerCase() !== sticker.name.toLowerCase()) {
      const clash = (await ServerSticker.find({ serverId: guildId })).some((s) => s.id !== sticker.id && s.name.toLowerCase() === name.toLowerCase());
      if (clash) return { status: 400, body: formError('name', 'STICKER_NAME_TAKEN', 'A sticker with this name already exists in this server.') };
    }
    updates.name = name;
  }
  if (fields.value.description !== undefined) updates.description = fields.value.description ? sanitizeInput(fields.value.description) : null;
  if (fields.value.tags !== undefined) updates.tags = stickerTagList(fields.value.tags);
  const updated = Object.keys(updates).length ? (await ServerSticker.updateById(sticker.id, updates)) ?? sticker : sticker;
  const changes = diffChanges(sticker as Record<string, unknown>, updates, { name: 'name', description: 'description', tags: 'tags' });
  if (changes.length) {
    audit({ serverId: guildId, userId: botId, actionType: AuditLogEvent.STICKER_UPDATE, targetId: sticker.id, changes, reason: auditReason(headers['x-audit-log-reason']) });
    emitStickers(guildId);
  }
  const [view] = await stickerViews([updated], perms);
  return { status: 200, body: view };
}

export async function deleteGuildSticker(guildId: string, stickerId: string, botId: string, headers: Headers): Promise<Result> {
  const sticker = isValidObjectId(stickerId) ? await ServerSticker.findById(stickerId) : null;
  if (!sticker || !same(sticker.serverId, guildId)) return { status: 404, body: UNKNOWN_STICKER };
  const perms = await guildPerms(guildId, botId);
  if (!canManageOne(perms, sticker.uploadedBy, botId)) return { status: 403, body: MISSING_PERMISSIONS };
  await ServerSticker.deleteById(sticker.id);
  audit({ serverId: guildId, userId: botId, actionType: AuditLogEvent.STICKER_DELETE, targetId: sticker.id, changes: [{ key: 'name', old: sticker.name }], reason: auditReason(headers['x-audit-log-reason']) });
  emitStickers(guildId);
  return { status: 204, body: '' };
}

// ─── Application emojis ───────────────────────────────────────────────────────

type AppEmojiRow = { id: string; name: string; image: string; animated?: boolean | null; createdAt?: Date | null };

function appEmojiView(e: AppEmojiRow, owner: unknown) {
  return { id: e.id, name: e.name, roles: [], ...(owner ? { user: owner } : {}), require_colons: true, managed: false, animated: Boolean(e.animated), available: true };
}

async function appOwnerView(app: { ownerId?: string | null }) {
  const owner = app.ownerId ? await User.findById(app.ownerId).catch(() => null) : null;
  return owner ? toDiscordUserRow(owner) : null;
}

export async function listAppEmojis(app: { id: string; ownerId?: string | null }): Promise<Result> {
  const [rows, owner] = await Promise.all([AppEmoji.find({ applicationId: app.id }), appOwnerView(app)]);
  return { status: 200, body: { items: (rows as AppEmojiRow[]).map((e) => appEmojiView(e, owner)) } };
}

async function loadAppEmoji(app: { id: string }, emojiId: string): Promise<AppEmojiRow | null> {
  const e = isValidObjectId(emojiId) ? await AppEmoji.findById(emojiId) : null;
  return e && same(e.applicationId, app.id) ? (e as AppEmojiRow) : null;
}

export async function getAppEmoji(app: { id: string; ownerId?: string | null }, emojiId: string): Promise<Result> {
  const e = await loadAppEmoji(app, emojiId);
  if (!e) return { status: 404, body: UNKNOWN_EMOJI };
  return { status: 200, body: appEmojiView(e, await appOwnerView(app)) };
}

export type AppEmojiCreateResult =
  | { ok: true; emoji: AppEmojiRow }
  /** `body` is the Discord-shaped error (bot API), `message` a plain one (Developer Portal). */
  | { ok: false; status: number; body: unknown; message: string };

/**
 * Validate and store a new application emoji. Shared by the bot API and the
 * Developer Portal so both apply the same rules as guild emoji uploads: name
 * 2-32 of [A-Za-z0-9_], a PNG / JPEG / GIF / WebP data URI (type sniffed from
 * the bytes, at most MAX_EMOJI_BYTES), the per-app limit, unique names, and
 * the image stored on the CDN through storage.upload (Trust & Safety scan
 * attributed to `scanUserId`, a blocked image is a 403). `animated` comes
 * from the bytes, never from the caller.
 */
export async function createAppEmojiRecord(
  appId: string,
  body: { name?: unknown; image?: unknown },
  ctx: { userId: string; scanUserId?: string; ip?: string },
): Promise<AppEmojiCreateResult> {
  const nameErr = emojiNameError(body.name);
  if (nameErr) {
    return { ok: false, status: 400, body: formError('name', nameErr.code, nameErr.message), message: 'Emoji names must be 2-32 characters: letters, numbers and underscores.' };
  }
  const image = parseImageDataUri(body.image, MAX_EMOJI_BYTES);
  if (!image.ok) {
    const message = image.code === 'BINARY_TYPE_MAX_SIZE'
      ? `Emoji must be ${Math.floor(MAX_EMOJI_BYTES / 1024)} KB or smaller.`
      : 'Invalid image. Only PNG, JPEG, GIF and WebP images are allowed.';
    return { ok: false, status: 400, body: formError('image', image.code, image.message), message };
  }
  const existing = (await AppEmoji.find({ applicationId: appId })) as AppEmojiRow[];
  if (existing.length >= MAX_APP_EMOJIS) {
    const message = `Maximum number of emojis reached (${MAX_APP_EMOJIS})`;
    return { ok: false, status: 400, body: { code: 30008, message }, message };
  }
  const name = String(body.name);
  if (existing.some((e) => e.name.toLowerCase() === name.toLowerCase())) {
    return { ok: false, status: 400, body: formError('name', 'APPLICATION_EMOJI_NAME_ALREADY_TAKEN', 'An emoji with this name already exists.'), message: 'An emoji with this name already exists.' };
  }
  const stored = await storeImage('emojis', image.bytes, image.kind, ctx);
  if (!stored.ok) return stored;
  const e = await AppEmoji.create({ applicationId: appId, name, image: stored.url, animated: image.animated });
  return { ok: true, emoji: e as AppEmojiRow };
}

export async function createAppEmoji(app: { id: string; ownerId?: string | null }, botId: string, body: { name?: unknown; image?: unknown }): Promise<Result> {
  const created = await createAppEmojiRecord(app.id, body, { userId: botId });
  if (!created.ok) return { status: created.status, body: created.body };
  return { status: 201, body: appEmojiView(created.emoji, await appOwnerView(app)) };
}

export async function updateAppEmoji(app: { id: string; ownerId?: string | null }, emojiId: string, body: { name?: unknown }): Promise<Result> {
  const e = await loadAppEmoji(app, emojiId);
  if (!e) return { status: 404, body: UNKNOWN_EMOJI };
  const nameErr = emojiNameError(body.name);
  if (nameErr) return { status: 400, body: formError('name', nameErr.code, nameErr.message) };
  const name = String(body.name);
  if (name.toLowerCase() !== e.name.toLowerCase()) {
    const clash = ((await AppEmoji.find({ applicationId: app.id })) as AppEmojiRow[]).some((x) => x.id !== e.id && x.name.toLowerCase() === name.toLowerCase());
    if (clash) return { status: 400, body: formError('name', 'APPLICATION_EMOJI_NAME_ALREADY_TAKEN', 'An emoji with this name already exists.') };
  }
  const updated = ((await AppEmoji.updateById(e.id, { name })) ?? e) as AppEmojiRow;
  return { status: 200, body: appEmojiView(updated, await appOwnerView(app)) };
}

export async function deleteAppEmoji(app: { id: string }, emojiId: string): Promise<Result> {
  const e = await loadAppEmoji(app, emojiId);
  if (!e) return { status: 404, body: UNKNOWN_EMOJI };
  await AppEmoji.deleteById(e.id);
  return { status: 204, body: '' };
}


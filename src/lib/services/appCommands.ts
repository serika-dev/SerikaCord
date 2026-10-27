/**
 * Application commands: storage behind the bot API routes (create = upsert by
 * name + type, PATCH, DELETE, bulk overwrite with stable ids, permissions v2)
 * and what a user may use in a channel (the picker list and the dispatch
 * check share one rule set: bot present, scope, contexts, nsfw,
 * default_member_permissions and permission overrides).
 */
import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import { db, schema } from '@/lib/db/postgres';
import { Application, User, type IChannel } from '@/lib/models';
import { AppCommand, type IAppCommand } from '@/lib/models/AppCommand';
import { FormErrors, formError, FE, type DiscordFormError } from '@/lib/botapi/formErrors';
import {
  CommandType, InteractionContext, checkScopeLimits, commandContexts, commandFingerprint, memberMeetsDefaultPermissions,
  planBulkOverwrite, resolveCommandPermission, snowflakeNow, validateCommand, validateCommandPermissions,
  type CommandDefinition, type CommandOption, type CommandPermissionEntry,
} from '@/lib/botapi/commands';
import { PERMISSION_BITS, hasPermission } from '@/lib/permissions/bits';

/**
 * A single application command option, mirroring Discord's option schema with a
 * couple of SerikaCord extensions (choice `description`/`emoji`) so the composer
 * can render the rich pickers shown in the palette UI.
 */
export interface AppCommandOption {
  type: number;
  name: string;
  description?: string;
  required?: boolean;
  choices?: { name: string; value: string | number; description?: string; emoji?: string }[];
  /** Nested options for SUB_COMMAND (1) and SUB_COMMAND_GROUP (2) types. */
  options?: AppCommandOption[];
  min_value?: number;
  max_value?: number;
  min_length?: number;
  max_length?: number;
  autocomplete?: boolean;
  channel_types?: number[];
}

export interface ResolvedAppCommand {
  id: string;
  name: string;
  description: string;
  /** 1 chat input (slash), 2 user context menu, 3 message context menu. */
  type: number;
  guildId: string | null;
  options: AppCommandOption[];
}

export interface AppCommandGroup {
  application: {
    id: string;
    name: string;
    icon: string | null;
    botId: string | null;
    clientId: string;
  };
  commands: ResolvedAppCommand[];
}

/** Discord option type constants. */
export const OPTION_TYPES = {
  SUB_COMMAND: 1,
  SUB_COMMAND_GROUP: 2,
  STRING: 3,
  INTEGER: 4,
  BOOLEAN: 5,
  USER: 6,
  CHANNEL: 7,
  ROLE: 8,
  MENTIONABLE: 9,
  NUMBER: 10,
  ATTACHMENT: 11,
} as const;

type ApiResult<T> = { ok: true; status: number; body: T } | { ok: false; status: number; body: DiscordFormError | { code: number; message: string } };

const UNKNOWN_COMMAND = { code: 10063, message: 'Unknown application command' };
const same = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

// ─── Row ⇄ definition ───────────────────────────────────────

export function rowToDefinition(row: IAppCommand): CommandDefinition {
  return {
    name: row.name,
    type: row.type ?? 1,
    description: row.description ?? '',
    options: (Array.isArray(row.options) ? row.options : []) as CommandOption[],
    defaultMemberPermissions: row.defaultMemberPermissions ?? (row.defaultPermission === false ? '0' : null),
    dmPermission: row.dmPermission ?? null,
    contexts: row.contexts ?? null,
    integrationTypes: row.integrationTypes ?? null,
    nameLocalizations: (row.nameLocalizations as Record<string, string> | null) ?? null,
    descriptionLocalizations: (row.descriptionLocalizations as Record<string, string> | null) ?? null,
    nsfw: Boolean(row.nsfw),
    handler: row.handler ?? null,
  };
}

function definitionColumns(def: CommandDefinition) {
  return {
    name: def.name,
    type: def.type,
    description: def.description,
    options: def.options,
    defaultPermission: def.defaultMemberPermissions !== '0',
    defaultMemberPermissions: def.defaultMemberPermissions,
    dmPermission: def.dmPermission,
    contexts: def.contexts,
    integrationTypes: def.integrationTypes,
    nameLocalizations: def.nameLocalizations,
    descriptionLocalizations: def.descriptionLocalizations,
    nsfw: def.nsfw,
    handler: def.handler,
  };
}

/** Discord ApplicationCommand object. */
export function serializeCommand(row: IAppCommand, applicationId: string) {
  const def = rowToDefinition(row);
  const version = row.version && /^\d{10,20}$/.test(row.version) ? row.version : snowflakeNow(row.updatedAt ? new Date(row.updatedAt).getTime() : Date.now());
  return {
    id: row.id,
    application_id: applicationId,
    version,
    default_member_permissions: def.defaultMemberPermissions,
    type: def.type,
    name: def.name,
    name_localizations: def.nameLocalizations,
    description: def.description,
    description_localizations: def.descriptionLocalizations,
    ...(row.guildId ? { guild_id: row.guildId } : {}),
    dm_permission: def.dmPermission ?? true,
    contexts: row.guildId ? null : def.contexts,
    integration_types: def.integrationTypes ?? [0],
    options: def.options,
    nsfw: def.nsfw,
    ...(def.handler !== null ? { handler: def.handler } : {}),
  };
}

// ─── Storage ────────────────────────────────────────────────

export async function listCommands(applicationId: string, guildId: string | null): Promise<IAppCommand[]> {
  return AppCommand.find({ applicationId, guildId });
}

async function loadScoped(applicationId: string, guildId: string | null, commandId: string): Promise<IAppCommand | null> {
  const cmd = await AppCommand.findById(commandId).catch(() => null);
  if (!cmd || !same(cmd.applicationId, applicationId)) return null;
  if (guildId ? !same(cmd.guildId, guildId) : cmd.guildId != null) return null;
  return cmd;
}

function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string })?.code === '23505' || /duplicate key/i.test(String((err as Error)?.message ?? ''));
}

/** POST: create, or overwrite the command with the same name + type (200 vs 201, like Discord). */
export async function upsertCommand(applicationId: string, guildId: string | null, body: unknown): Promise<ApiResult<ReturnType<typeof serializeCommand>>> {
  const errors = new FormErrors();
  const def = validateCommand(body, { errors, guildScoped: Boolean(guildId) });
  if (!def) return { ok: false, status: 400, body: errors.toBody() };
  const existing = await listCommands(applicationId, guildId);
  const match = existing.find((c) => c.name === def.name && (c.type ?? 1) === def.type);
  if (!match) {
    checkScopeLimits([...existing.map((c) => ({ type: c.type ?? 1 })), { type: def.type }], errors);
    if (!errors.ok) return { ok: false, status: 400, body: errors.toBody() };
  }
  try {
    if (match) {
      const changed = commandFingerprint(rowToDefinition(match)) !== commandFingerprint(def);
      const row = changed ? await AppCommand.updateById(match.id, { ...definitionColumns(def), version: snowflakeNow() }) : match;
      return { ok: true, status: 200, body: serializeCommand(row ?? match, applicationId) };
    }
    const row = await AppCommand.create({ applicationId, guildId, ...definitionColumns(def), version: snowflakeNow() });
    return { ok: true, status: 201, body: serializeCommand(row, applicationId) };
  } catch (err) {
    if (isUniqueViolation(err)) return { ok: false, status: 400, body: formError(['name'], FE.APP_CMD_DUPLICATE, 'Application command names must be unique') };
    throw err;
  }
}

export async function getCommand(applicationId: string, guildId: string | null, commandId: string): Promise<ApiResult<ReturnType<typeof serializeCommand>>> {
  const cmd = await loadScoped(applicationId, guildId, commandId);
  if (!cmd) return { ok: false, status: 404, body: UNKNOWN_COMMAND };
  return { ok: true, status: 200, body: serializeCommand(cmd, applicationId) };
}

export async function patchCommand(applicationId: string, guildId: string | null, commandId: string, body: unknown): Promise<ApiResult<ReturnType<typeof serializeCommand>>> {
  const cmd = await loadScoped(applicationId, guildId, commandId);
  if (!cmd) return { ok: false, status: 404, body: UNKNOWN_COMMAND };
  const errors = new FormErrors();
  const def = validateCommand(body, { errors, partial: rowToDefinition(cmd), guildScoped: Boolean(guildId) });
  if (!def) return { ok: false, status: 400, body: errors.toBody() };
  if (commandFingerprint(def) === commandFingerprint(rowToDefinition(cmd))) return { ok: true, status: 200, body: serializeCommand(cmd, applicationId) };
  const clash = (await listCommands(applicationId, guildId)).find((c) => c.id !== cmd.id && c.name === def.name && (c.type ?? 1) === def.type);
  if (clash) return { ok: false, status: 400, body: formError(['name'], FE.APP_CMD_DUPLICATE, 'Application command names must be unique') };
  try {
    const row = await AppCommand.updateById(cmd.id, { ...definitionColumns(def), version: snowflakeNow() });
    return { ok: true, status: 200, body: serializeCommand(row ?? cmd, applicationId) };
  } catch (err) {
    if (isUniqueViolation(err)) return { ok: false, status: 400, body: formError(['name'], FE.APP_CMD_DUPLICATE, 'Application command names must be unique') };
    throw err;
  }
}

export async function deleteCommand(applicationId: string, guildId: string | null, commandId: string): Promise<ApiResult<''>> {
  const cmd = await loadScoped(applicationId, guildId, commandId);
  if (!cmd) return { ok: false, status: 404, body: UNKNOWN_COMMAND };
  await AppCommand.deleteById(cmd.id);
  if (guildId) await db.delete(schema.appCommandPermissions).where(and(eq(schema.appCommandPermissions.guildId, guildId), eq(schema.appCommandPermissions.commandId, cmd.id))).catch(() => {});
  return { ok: true, status: 204, body: '' };
}

/**
 * PUT (bulk overwrite): keeps ids of commands that still exist (matched by id,
 * else name + type), bumps versions only when something changed, deletes the
 * rest. All in one transaction.
 */
export async function bulkOverwriteCommands(applicationId: string, guildId: string | null, body: unknown): Promise<ApiResult<Array<ReturnType<typeof serializeCommand>>>> {
  if (!Array.isArray(body)) return { ok: false, status: 400, body: formError([], FE.BAD_TYPE, 'Must be an array.') };
  const errors = new FormErrors();
  const defs: CommandDefinition[] = [];
  body.slice(0, 250).forEach((entry, i) => {
    const def = validateCommand(entry, { errors, path: [i], guildScoped: Boolean(guildId) });
    if (def) defs.push(def);
  });
  if (body.length > 250) errors.add([], FE.MAX_LENGTH, 'Too many application commands.');
  checkScopeLimits(defs, errors);
  if (!errors.ok) return { ok: false, status: 400, body: errors.toBody() };
  const existing = await listCommands(applicationId, guildId);
  const plan = planBulkOverwrite(
    existing.map((c) => ({ id: c.id, name: c.name, type: c.type ?? 1, fingerprint: commandFingerprint(rowToDefinition(c)) })),
    defs,
    errors,
  );
  if (!errors.ok) return { ok: false, status: 400, body: errors.toBody() };
  const ids: string[] = [];
  try {
    await db.transaction(async (tx) => {
      if (plan.remove.length) await tx.delete(schema.appCommands).where(inArray(schema.appCommands.id, plan.remove));
      for (const u of plan.update) {
        if (u.changed) {
          await tx.update(schema.appCommands)
            .set({ ...definitionColumns(u.def), version: snowflakeNow(), updatedAt: new Date() })
            .where(eq(schema.appCommands.id, u.id));
        }
      }
      for (const def of plan.create) {
        const [row] = await tx.insert(schema.appCommands).values({ applicationId, guildId, ...definitionColumns(def), version: snowflakeNow() }).returning({ id: schema.appCommands.id });
        if (row) ids.push(row.id);
      }
    });
  } catch (err) {
    if (isUniqueViolation(err)) return { ok: false, status: 400, body: formError([], FE.APP_CMD_DUPLICATE, 'Application command names must be unique') };
    throw err;
  }
  if (guildId && plan.remove.length) {
    await db.delete(schema.appCommandPermissions).where(and(eq(schema.appCommandPermissions.guildId, guildId), inArray(schema.appCommandPermissions.commandId, plan.remove))).catch(() => {});
  }
  // Return in request order.
  const fresh = await listCommands(applicationId, guildId);
  const byKey = new Map(fresh.map((c) => [`${c.type ?? 1}:${c.name}`, c]));
  return {
    ok: true,
    status: 200,
    body: defs.map((d) => byKey.get(`${d.type}:${d.name}`)).filter((c): c is IAppCommand => !!c).map((c) => serializeCommand(c, applicationId)),
  };
}

// ─── Permissions v2 ─────────────────────────────────────────

type PermissionRow = typeof schema.appCommandPermissions.$inferSelect;

function serializePermissions(row: { commandId: string; applicationId: string; guildId: string; permissions: unknown }) {
  return {
    id: row.commandId,
    application_id: row.applicationId,
    guild_id: row.guildId,
    permissions: (Array.isArray(row.permissions) ? row.permissions : []) as CommandPermissionEntry[],
  };
}

export async function listGuildCommandPermissions(applicationId: string, guildId: string) {
  const rows = await db.select().from(schema.appCommandPermissions)
    .where(and(eq(schema.appCommandPermissions.applicationId, applicationId), eq(schema.appCommandPermissions.guildId, guildId)));
  return rows.filter((r) => (r.permissions as unknown[] | null)?.length).map(serializePermissions);
}

/** GET …/commands/{id}/permissions. The app id stands for app-wide permissions. */
export async function getCommandPermissions(applicationId: string, guildId: string, commandId: string): Promise<ApiResult<ReturnType<typeof serializePermissions>>> {
  if (!same(commandId, applicationId)) {
    const cmd = await AppCommand.findById(commandId).catch(() => null);
    if (!cmd || !same(cmd.applicationId, applicationId) || (cmd.guildId && !same(cmd.guildId, guildId))) return { ok: false, status: 404, body: UNKNOWN_COMMAND };
  }
  const [row] = await db.select().from(schema.appCommandPermissions)
    .where(and(eq(schema.appCommandPermissions.guildId, guildId), eq(schema.appCommandPermissions.commandId, commandId)));
  if (!row || !(row.permissions as unknown[] | null)?.length) return { ok: false, status: 404, body: { code: 10066, message: 'Unknown application command permissions' } };
  return { ok: true, status: 200, body: serializePermissions(row) };
}

/** PUT …/commands/{id}/permissions: replace the overrides (empty list clears them). */
export async function putCommandPermissions(
  app: { id: string; botId: string | null },
  guildId: string,
  commandId: string,
  body: unknown,
): Promise<ApiResult<ReturnType<typeof serializePermissions>>> {
  if (!same(commandId, app.id)) {
    const cmd = await AppCommand.findById(commandId).catch(() => null);
    if (!cmd || !same(cmd.applicationId, app.id) || (cmd.guildId && !same(cmd.guildId, guildId))) return { ok: false, status: 404, body: UNKNOWN_COMMAND };
  }
  const errors = new FormErrors();
  const entries = validateCommandPermissions(body, errors);
  if (!entries) return { ok: false, status: 400, body: errors.toBody() };
  const row = { guildId, commandId: commandId.toLowerCase(), applicationId: app.id, permissions: entries, updatedAt: new Date() };
  await db.insert(schema.appCommandPermissions).values(row)
    .onConflictDoUpdate({ target: [schema.appCommandPermissions.guildId, schema.appCommandPermissions.commandId], set: { permissions: entries, updatedAt: new Date() } });
  const out = serializePermissions(row);
  if (app.botId) {
    void import('@/lib/services/gatewayEvents')
      .then(({ emitApplicationCommandPermissionsUpdate }) => emitApplicationCommandPermissionsUpdate({ botId: app.botId!, guildId, permissions: out }))
      .catch(() => {});
  }
  return { ok: true, status: 200, body: out };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Copy every error of `from` into `to` under `prefix` (per-entry validation of a batch). */
function mergeFormErrors(to: FormErrors, from: FormErrors, prefix: Array<string | number>) {
  const walk = (node: Record<string, unknown>, path: Array<string | number>) => {
    for (const [k, v] of Object.entries(node)) {
      if (k === '_errors' && Array.isArray(v)) for (const leaf of v as Array<{ code: string; message: string }>) to.add(path, leaf.code, leaf.message);
      else if (v && typeof v === 'object') walk(v as Record<string, unknown>, [...path, k]);
    }
  };
  walk(from.tree as Record<string, unknown>, prefix);
}

/**
 * PUT …/guilds/{guild_id}/commands/permissions (the batch form): replaces
 * every permission override of this app in the guild with the given list of
 * `{ id, permissions }` (id = a command of this app, global or this guild's,
 * or the app id for app-wide overrides). Entries with an empty list clear
 * that command's overrides; commands not listed lose theirs.
 */
export async function putGuildCommandPermissionsBatch(
  app: { id: string; botId: string | null },
  guildId: string,
  body: unknown,
): Promise<ApiResult<Array<ReturnType<typeof serializePermissions>>>> {
  if (!Array.isArray(body)) return { ok: false, status: 400, body: formError([], FE.BAD_TYPE, 'Must be an array.') };
  if (body.length > 250) return { ok: false, status: 400, body: formError([], FE.MAX_LENGTH, 'Must be 250 or fewer in length.') };
  const errors = new FormErrors();
  const entries: Array<{ commandId: string; permissions: CommandPermissionEntry[] }> = [];
  const seen = new Set<string>();
  body.forEach((raw, i) => {
    const id = raw && typeof raw === 'object' ? (raw as { id?: unknown }).id : undefined;
    if (typeof id !== 'string' || !UUID_RE.test(id)) { errors.add([i, 'id'], FE.BAD_TYPE, 'Value is not snowflake.'); return; }
    const sub = new FormErrors();
    const perms = validateCommandPermissions(raw, sub);
    if (!perms) { mergeFormErrors(errors, sub, [i]); return; }
    const commandId = id.toLowerCase();
    if (seen.has(commandId)) { errors.add([i, 'id'], 'APPLICATION_COMMAND_PERMISSIONS_DUPLICATE_ID', 'Duplicate command id.'); return; }
    seen.add(commandId);
    entries.push({ commandId, permissions: perms });
  });
  if (!errors.ok) return { ok: false, status: 400, body: errors.toBody() };
  const commandIds = entries.map((e) => e.commandId).filter((id) => !same(id, app.id));
  if (commandIds.length) {
    const rows = await db.select({ id: schema.appCommands.id, applicationId: schema.appCommands.applicationId, guildId: schema.appCommands.guildId })
      .from(schema.appCommands).where(inArray(schema.appCommands.id, commandIds));
    const ok = new Set(rows.filter((r) => same(r.applicationId, app.id) && (!r.guildId || same(r.guildId, guildId))).map((r) => r.id.toLowerCase()));
    if (commandIds.some((id) => !ok.has(id))) return { ok: false, status: 404, body: UNKNOWN_COMMAND };
  }
  const now = new Date();
  const kept = entries.filter((e) => e.permissions.length > 0);
  await db.transaction(async (tx) => {
    await tx.delete(schema.appCommandPermissions)
      .where(and(eq(schema.appCommandPermissions.applicationId, app.id), eq(schema.appCommandPermissions.guildId, guildId)));
    if (kept.length) {
      await tx.insert(schema.appCommandPermissions).values(kept.map((e) => ({
        guildId, commandId: e.commandId, applicationId: app.id, permissions: e.permissions, updatedAt: now,
      })));
    }
  });
  const out = kept.map((e) => serializePermissions({ commandId: e.commandId, applicationId: app.id, guildId, permissions: e.permissions }));
  if (app.botId) {
    // One update per command whose overrides were set or cleared (Discord).
    const changed = entries.map((e) => serializePermissions({ commandId: e.commandId, applicationId: app.id, guildId, permissions: e.permissions }));
    void import('@/lib/services/gatewayEvents')
      .then(({ emitApplicationCommandPermissionsUpdate }) => {
        for (const permissions of changed) void emitApplicationCommandPermissionsUpdate({ botId: app.botId!, guildId, permissions });
      })
      .catch(() => {});
  }
  return { ok: true, status: 200, body: out };
}

// ─── What a user may use ────────────────────────────────────

export interface CommandViewer {
  userId: string;
  channel: IChannel;
  membership: { roles?: string[] | null } | null;
}

interface ViewerContext {
  userId: string;
  context: number;
  guildId: string | null;
  perms: bigint;
  isAdmin: boolean;
  roleIds: string[];
  everyoneIds: string[];
  permissionRows: PermissionRow[];
  nsfwOk: boolean;
}

/** The interaction context of a channel: 0 guild, 1 DM with a bot, 2 group DM. */
export function channelContext(channel: Pick<IChannel, 'serverId' | 'type'>): number {
  if (channel.serverId) return InteractionContext.GUILD;
  return channel.type === 'group_dm' ? InteractionContext.PRIVATE_CHANNEL : InteractionContext.BOT_DM;
}

/**
 * The viewer's permission context. `failClosed`: a failed overrides lookup
 * throws (dispatch must not run a command an override may deny); the picker
 * list falls back to no overrides.
 */
async function viewerContext(v: CommandViewer, opts: { failClosed?: boolean } = {}): Promise<ViewerContext> {
  const guildId = v.channel.serverId ?? null;
  if (!guildId) {
    return { userId: v.userId, context: channelContext(v.channel), guildId: null, perms: 0n, isAdmin: true, roleIds: [], everyoneIds: [], permissionRows: [], nsfwOk: true };
  }
  const { getMemberChannelPermissions, getEveryoneRoleId } = await import('@/lib/api/channels');
  const [perms, everyoneRoleId, permissionRows] = await Promise.all([
    getMemberChannelPermissions(v.userId, v.channel as IChannel & { serverId: string }, v.membership),
    getEveryoneRoleId(guildId),
    db.select().from(schema.appCommandPermissions).where(eq(schema.appCommandPermissions.guildId, guildId))
      .catch((err) => { if (opts.failClosed) throw err; return [] as PermissionRow[]; }),
  ]);
  return {
    userId: v.userId,
    context: InteractionContext.GUILD,
    guildId,
    perms,
    isAdmin: hasPermission(perms, PERMISSION_BITS.ADMINISTRATOR),
    roleIds: ((v.membership?.roles || []) as string[]).map(String),
    everyoneIds: [guildId, ...(everyoneRoleId ? [everyoneRoleId] : [])],
    permissionRows,
    nsfwOk: Boolean(v.channel.nsfw),
  };
}

function usableBy(cmd: IAppCommand, appId: string, channelId: string, ctx: ViewerContext): boolean {
  if (cmd.guildId && !same(cmd.guildId, ctx.guildId)) return false;
  if (!commandContexts(cmd).includes(ctx.context)) return false;
  if (cmd.nsfw && !ctx.nsfwOk) return false;
  if (!ctx.guildId || ctx.isAdmin) return true;
  const layerFor = (id: string) => ctx.permissionRows.find((r) => same(r.commandId, id) && same(r.applicationId, appId))?.permissions as CommandPermissionEntry[] | undefined;
  const decision = resolveCommandPermission([layerFor(cmd.id), layerFor(appId)], {
    userId: ctx.userId,
    roleIds: ctx.roleIds,
    channelId,
    everyoneIds: ctx.everyoneIds,
    // Discord's "all channels" id is guild_id - 1; with UUID ids the guild id stands in.
    allChannelsIds: ctx.guildId ? [ctx.guildId] : [],
  });
  if (decision.channel === false) return false;
  if (decision.user !== null) return decision.user;
  return memberMeetsDefaultPermissions(rowToDefinition(cmd).defaultMemberPermissions, ctx.perms, false);
}

/** Bot user ids that can receive interactions in a channel (guild bot members / DM bot recipients). */
async function channelBotIds(channel: { serverId?: string | null; recipientIds?: string[] | null }): Promise<string[]> {
  if (channel.serverId) {
    const rows = await db.select({ id: schema.users.id })
      .from(schema.serverMembers)
      .innerJoin(schema.users, eq(schema.users.id, schema.serverMembers.userId))
      .where(and(eq(schema.serverMembers.serverId, channel.serverId), eq(schema.users.isBot, true)))
      .limit(200);
    return rows.map((r) => r.id);
  }
  const recipientIds = channel.recipientIds ?? [];
  if (recipientIds.length === 0) return [];
  const bots = await User.find({ id: { in: recipientIds }, isBot: true });
  return bots.map((u: { id: string }) => u.id);
}

/**
 * Commands available to `viewer` in its channel, grouped by application:
 * for every bot present, its global commands plus this guild's commands
 * (a guild command shadows a global one of the same name + type), filtered by
 * contexts, nsfw and permissions. Without a viewer (legacy callers) only the
 * scope rules apply.
 */
export async function getChannelAppCommands(
  channel: { id?: string; serverId?: string | null; recipientIds?: string[] | null; type?: string | null; nsfw?: boolean | null },
  viewer?: CommandViewer,
): Promise<AppCommandGroup[]> {
  const botIds = await channelBotIds(channel);
  if (botIds.length === 0) return [];
  const guildId = channel.serverId ?? null;
  const ctx = viewer ? await viewerContext(viewer) : null;
  const groups: AppCommandGroup[] = [];

  for (const botId of botIds) {
    const app = await Application.findOne({ botId });
    if (!app) continue;
    const all = await AppCommand.find({ applicationId: app.id });
    const relevant = all.filter((c) => !c.guildId || (guildId && same(c.guildId, guildId)));
    const byKey = new Map<string, IAppCommand>();
    for (const c of relevant) {
      const key = `${c.type ?? 1}:${c.name}`;
      const existing = byKey.get(key);
      if (!existing || (c.guildId && !existing.guildId)) byKey.set(key, c);
    }
    const usable = [...byKey.values()].filter((c) => !ctx || usableBy(c, app.id, channel.id ?? '', ctx));
    if (usable.length === 0) continue;
    const botUser = await User.findById(botId);
    groups.push({
      application: {
        id: app.id,
        name: app.name,
        icon: app.icon ?? (botUser as { avatar?: string } | null)?.avatar ?? null,
        botId: app.botId ?? null,
        clientId: app.clientId,
      },
      commands: usable.map((c) => ({
        id: c.id,
        name: c.name,
        description: c.description,
        type: c.type ?? 1,
        guildId: c.guildId,
        options: (c.options as AppCommandOption[]) ?? [],
      })),
    });
  }
  return groups;
}

export type InvocableCommand =
  | { ok: true; command: IAppCommand; app: NonNullable<Awaited<ReturnType<typeof Application.findById>>> }
  | { ok: false; status: number; error: string; code: string };

/**
 * Re-check, at dispatch time, that `viewer` may run `commandId` here (the
 * picker hides the rest, but a crafted request must fail the same way).
 */
export async function resolveInvocableCommand(viewer: CommandViewer, commandId: string, expectType?: number): Promise<InvocableCommand> {
  const cmd = await AppCommand.findById(commandId).catch(() => null);
  if (!cmd) return { ok: false, status: 404, error: 'Unknown command', code: 'unknown_command' };
  if (expectType !== undefined && (cmd.type ?? 1) !== expectType) return { ok: false, status: 400, error: 'Wrong command type', code: 'unknown_command' };
  const app = await Application.findById(cmd.applicationId);
  if (!app || !app.botId) return { ok: false, status: 404, error: 'Unknown command', code: 'unknown_command' };
  const bots = await channelBotIds(viewer.channel);
  if (!bots.some((b) => same(b, app.botId))) return { ok: false, status: 404, error: 'Unknown command', code: 'unknown_command' };
  const ctx = await viewerContext(viewer, { failClosed: true }).catch(() => null);
  if (!ctx) return { ok: false, status: 503, error: 'Commands are unavailable right now', code: 'unavailable' };
  if (!usableBy(cmd, app.id, viewer.channel.id, ctx)) {
    return { ok: false, status: 403, error: 'You do not have permission to use this command here', code: 'command_forbidden' };
  }
  return { ok: true, command: cmd, app };
}

/**
 * Typed `/name args` (text fallback): the slash commands called `name` that
 * `viewer` may run here, one per application (a guild command shadows the
 * global one). Only apps whose bot is in this channel / guild are queried, and
 * the viewer's permission context is computed once.
 */
export async function findUsableCommandsByName(
  viewer: CommandViewer,
  name: string,
): Promise<Array<{ command: IAppCommand; app: NonNullable<Awaited<ReturnType<typeof Application.findById>>> }>> {
  const guildId = viewer.channel.serverId ?? null;
  const botIds = await channelBotIds(viewer.channel);
  if (botIds.length === 0) return [];
  const apps = await db.select({ id: schema.applications.id }).from(schema.applications)
    .where(inArray(schema.applications.botId, botIds)).limit(200);
  const appIds = apps.map((a) => a.id);
  if (appIds.length === 0) return [];
  const rows = await db.select().from(schema.appCommands)
    .where(and(
      eq(schema.appCommands.name, name),
      eq(schema.appCommands.type, CommandType.CHAT_INPUT),
      inArray(schema.appCommands.applicationId, appIds),
      guildId ? or(isNull(schema.appCommands.guildId), eq(schema.appCommands.guildId, guildId)) : isNull(schema.appCommands.guildId),
    ))
    .limit(100);
  const perApp = new Map<string, IAppCommand>();
  for (const c of rows) {
    const existing = perApp.get(c.applicationId);
    if (!existing || (c.guildId && !existing.guildId)) perApp.set(c.applicationId, c);
  }
  if (perApp.size === 0) return [];
  const ctx = await viewerContext(viewer, { failClosed: true }).catch(() => null);
  if (!ctx) return [];
  const out: Array<{ command: IAppCommand; app: NonNullable<Awaited<ReturnType<typeof Application.findById>>> }> = [];
  for (const command of perApp.values()) {
    const app = await Application.findById(command.applicationId);
    if (!app?.botId || !usableBy(command, app.id, viewer.channel.id, ctx)) continue;
    out.push({ command, app });
  }
  return out;
}

/**
 * Application commands (Discord API v10): definition validation with 50035
 * error trees, stable-id bulk overwrite planning, serialization, and the
 * checks a user's invocation (typed options from the picker, autocomplete) must
 * pass before it becomes an interaction. Pure, no I/O.
 */
import { FE, FormErrors, type FormErrorPath } from './formErrors';
import { cleanLabel, cleanText } from './components';

export const CommandType = { CHAT_INPUT: 1, USER: 2, MESSAGE: 3, PRIMARY_ENTRY_POINT: 4 } as const;

export const OptionType = {
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

/** Interaction context types (where a command can be used). */
export const InteractionContext = { GUILD: 0, BOT_DM: 1, PRIVATE_CHANNEL: 2 } as const;
/** Installation contexts. SerikaCord installs apps to servers only (0). */
export const IntegrationType = { GUILD_INSTALL: 0, USER_INSTALL: 1 } as const;

export const COMMAND_LIMITS = {
  NAME: 32,
  DESCRIPTION: 100,
  OPTIONS: 25,
  CHOICES: 25,
  CHOICE_NAME: 100,
  CHOICE_STRING_VALUE: 100,
  STRING_LENGTH: 6000,
  TOTAL_CHARS: 8000,
  CHAT_INPUT_PER_SCOPE: 100,
  USER_PER_SCOPE: 15,
  MESSAGE_PER_SCOPE: 15,
  AUTOCOMPLETE_CHOICES: 25,
} as const;

/** Locales Discord accepts in *_localizations. */
export const DISCORD_LOCALES: ReadonlySet<string> = new Set([
  'id', 'da', 'de', 'en-GB', 'en-US', 'es-ES', 'es-419', 'fr', 'hr', 'it', 'lt', 'hu', 'nl', 'no', 'pl',
  'pt-BR', 'ro', 'fi', 'sv-SE', 'vi', 'tr', 'cs', 'el', 'bg', 'ru', 'uk', 'hi', 'th', 'zh-CN', 'ja', 'zh-TW', 'ko',
]);

const NAME_RE = /^[-_'\p{L}\p{N}\p{sc=Deva}\p{sc=Thai}]{1,32}$/u;
const INT53_MAX = 2 ** 53 - 1;
const ID_RE = /^(?:\d{1,20}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

export interface CommandChoice {
  name: string;
  name_localizations?: Record<string, string> | null;
  value: string | number;
  /** SerikaCord extension: shown by the in-app picker, ignored by Discord clients. */
  description?: string;
  /** SerikaCord extension: an emoji shown next to the choice. */
  emoji?: string;
}

export interface CommandOption {
  type: number;
  name: string;
  name_localizations?: Record<string, string> | null;
  description: string;
  description_localizations?: Record<string, string> | null;
  required?: boolean;
  choices?: CommandChoice[];
  options?: CommandOption[];
  channel_types?: number[];
  min_value?: number;
  max_value?: number;
  min_length?: number;
  max_length?: number;
  autocomplete?: boolean;
}

/** A validated command definition, ready to store. */
export interface CommandDefinition {
  name: string;
  type: number;
  description: string;
  options: CommandOption[];
  defaultMemberPermissions: string | null;
  dmPermission: boolean | null;
  contexts: number[] | null;
  integrationTypes: number[] | null;
  nameLocalizations: Record<string, string> | null;
  descriptionLocalizations: Record<string, string> | null;
  nsfw: boolean;
  handler: number | null;
  /** `id` from a bulk overwrite entry (rename an existing command). */
  id?: string;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function validName(e: FormErrors, path: FormErrorPath, v: unknown, lowercase: boolean): string | undefined {
  if (typeof v !== 'string' || v.length === 0) { e.add(path, FE.REQUIRED, 'This field is required'); return undefined; }
  if (v.length > COMMAND_LIMITS.NAME) { e.add(path, FE.MAX_LENGTH, `Must be ${COMMAND_LIMITS.NAME} or fewer in length.`); return undefined; }
  if (!lowercase) {
    // USER / MESSAGE command names may contain spaces and mixed case.
    const clean = cleanLabel(v).trim();
    if (!clean) { e.add(path, FE.APP_CMD_NAME, 'Command name is invalid'); return undefined; }
    return clean;
  }
  if (!NAME_RE.test(v)) { e.add(path, FE.APP_CMD_NAME, 'Command name is invalid'); return undefined; }
  if (v !== v.toLowerCase()) { e.add(path, FE.APP_CMD_NAME, 'Command name is invalid (names must be lowercase)'); return undefined; }
  return v;
}

function text(e: FormErrors, path: FormErrorPath, v: unknown, o: { min: number; max: number }): string | undefined {
  if (v === undefined || v === null) {
    if (o.min > 0) e.add(path, FE.REQUIRED, 'This field is required');
    return o.min > 0 ? undefined : '';
  }
  if (typeof v !== 'string') { e.add(path, FE.BAD_TYPE, 'Must be a string.'); return undefined; }
  const s = cleanLabel(v);
  if (s.length < o.min) { e.add(path, o.min === 1 ? FE.REQUIRED : FE.MIN_LENGTH, o.min === 1 ? 'This field is required' : `Must be ${o.min} or more in length.`); return undefined; }
  if (s.length > o.max) { e.add(path, FE.MAX_LENGTH, `Must be ${o.max} or fewer in length.`); return undefined; }
  return s;
}

function localizations(e: FormErrors, path: FormErrorPath, v: unknown, max: number, nameRules: boolean): Record<string, string> | null {
  if (v === undefined || v === null) return null;
  if (!isObj(v)) { e.add(path, FE.BAD_TYPE, 'Must be an object.'); return null; }
  const out: Record<string, string> = {};
  for (const [locale, value] of Object.entries(v)) {
    if (!DISCORD_LOCALES.has(locale)) { e.add([...path, locale], 'LOCALE_INVALID', 'Invalid locale'); continue; }
    if (value === null) continue;
    if (typeof value !== 'string' || value.length === 0 || value.length > max) {
      e.add([...path, locale], FE.BAD_LENGTH, `Must be between 1 and ${max} in length.`);
      continue;
    }
    if (nameRules && (!NAME_RE.test(value) || value !== value.toLowerCase())) { e.add([...path, locale], FE.APP_CMD_NAME, 'Command name is invalid'); continue; }
    out[locale] = cleanLabel(value);
  }
  return Object.keys(out).length ? out : null;
}

function numberField(e: FormErrors, path: FormErrorPath, v: unknown, integer: boolean): number | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'number' || !Number.isFinite(v) || (integer && !Number.isInteger(v)) || Math.abs(v) > INT53_MAX) {
    e.add(path, FE.COERCE, integer ? 'Value is not int.' : 'Value is not a number.');
    return undefined;
  }
  return v;
}

function intRange(e: FormErrors, path: FormErrorPath, v: unknown, min: number, max: number): number | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'number' || !Number.isInteger(v)) { e.add(path, FE.COERCE, 'Value is not int.'); return undefined; }
  if (v < min || v > max) { e.add(path, v < min ? FE.MIN : FE.MAX, `int value should be between ${min} and ${max}.`); return undefined; }
  return v;
}

interface SizeCounter { chars: number }

function validateOption(e: FormErrors, path: FormErrorPath, v: unknown, depth: number, size: SizeCounter): CommandOption | null {
  if (!isObj(v)) { e.add(path, FE.BAD_TYPE, 'Must be an object.'); return null; }
  const type = v.type;
  if (typeof type !== 'number' || !Number.isInteger(type) || type < 1 || type > 11) {
    e.add([...path, 'type'], FE.CHOICES, 'Value must be one of (1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11).');
    return null;
  }
  const name = validName(e, [...path, 'name'], v.name, true);
  const description = text(e, [...path, 'description'], v.description, { min: 1, max: COMMAND_LIMITS.DESCRIPTION });
  if (name === undefined || description === undefined) return null;
  size.chars += name.length + description.length;
  const out: CommandOption = { type, name, description };
  const nl = localizations(e, [...path, 'name_localizations'], v.name_localizations, COMMAND_LIMITS.NAME, true);
  if (nl) out.name_localizations = nl;
  const dl = localizations(e, [...path, 'description_localizations'], v.description_localizations, COMMAND_LIMITS.DESCRIPTION, false);
  if (dl) out.description_localizations = dl;

  if (type === OptionType.SUB_COMMAND || type === OptionType.SUB_COMMAND_GROUP) {
    if (v.required !== undefined && v.required !== null && v.required !== false) e.add([...path, 'required'], FE.INVALID, 'Subcommands cannot be required.');
    if (type === OptionType.SUB_COMMAND_GROUP && depth > 0) e.add([...path, 'type'], FE.APP_CMD_OPTIONS_TYPE, 'Subcommand groups must be top-level options.');
    if (type === OptionType.SUB_COMMAND && depth > 1) e.add([...path, 'type'], FE.APP_CMD_OPTIONS_TYPE, 'Subcommands can only be nested in a subcommand group.');
    const children = validateOptionList(e, [...path, 'options'], v.options, depth + 1, size, type);
    out.options = children;
    return out;
  }

  if (v.required === true) out.required = true;
  const choiceTypes: number[] = [OptionType.STRING, OptionType.INTEGER, OptionType.NUMBER];
  if (v.autocomplete === true) {
    if (!choiceTypes.includes(type)) e.add([...path, 'autocomplete'], FE.INVALID, 'Autocomplete is only available for string, integer and number options.');
    else out.autocomplete = true;
  }
  if (Array.isArray(v.choices) && v.choices.length > 0) {
    if (!choiceTypes.includes(type)) e.add([...path, 'choices'], FE.INVALID, 'Choices are only available for string, integer and number options.');
    else if (out.autocomplete) e.add([...path, 'choices'], FE.INVALID, 'Autocomplete cannot be used with choices.');
    else if (v.choices.length > COMMAND_LIMITS.CHOICES) e.add([...path, 'choices'], FE.MAX_LENGTH, `Must be ${COMMAND_LIMITS.CHOICES} or fewer in length.`);
    else {
      const choices: CommandChoice[] = [];
      v.choices.forEach((c, i) => {
        const p = [...path, 'choices', i];
        if (!isObj(c)) { e.add(p, FE.BAD_TYPE, 'Must be an object.'); return; }
        const cname = text(e, [...p, 'name'], c.name, { min: 1, max: COMMAND_LIMITS.CHOICE_NAME });
        let value: string | number | undefined;
        if (type === OptionType.STRING) {
          if (typeof c.value !== 'string' || c.value.length > COMMAND_LIMITS.CHOICE_STRING_VALUE) e.add([...p, 'value'], FE.BAD_LENGTH, `Must be between 0 and ${COMMAND_LIMITS.CHOICE_STRING_VALUE} in length.`);
          else value = c.value;
        } else {
          value = numberField(e, [...p, 'value'], c.value, type === OptionType.INTEGER);
        }
        if (cname === undefined || value === undefined) return;
        size.chars += cname.length + String(value).length;
        const choice: CommandChoice = { name: cname, value };
        const cl = localizations(e, [...p, 'name_localizations'], c.name_localizations, COMMAND_LIMITS.CHOICE_NAME, false);
        if (cl) choice.name_localizations = cl;
        // Rich choices (SerikaCord extension, documented): kept, length-capped.
        if (typeof c.description === 'string' && c.description) choice.description = cleanLabel(c.description).slice(0, COMMAND_LIMITS.DESCRIPTION);
        if (typeof c.emoji === 'string' && c.emoji) choice.emoji = cleanLabel(c.emoji).slice(0, 64);
        choices.push(choice);
      });
      out.choices = choices;
    }
  }
  if (type === OptionType.INTEGER || type === OptionType.NUMBER) {
    const min = numberField(e, [...path, 'min_value'], v.min_value, type === OptionType.INTEGER);
    const max = numberField(e, [...path, 'max_value'], v.max_value, type === OptionType.INTEGER);
    if (min !== undefined) out.min_value = min;
    if (max !== undefined) out.max_value = max;
    if (min !== undefined && max !== undefined && min > max) e.add([...path, 'min_value'], FE.MAX, 'min_value must be less than or equal to max_value.');
  }
  if (type === OptionType.STRING) {
    const min = intRange(e, [...path, 'min_length'], v.min_length, 0, COMMAND_LIMITS.STRING_LENGTH);
    const max = intRange(e, [...path, 'max_length'], v.max_length, 1, COMMAND_LIMITS.STRING_LENGTH);
    if (min !== undefined) out.min_length = min;
    if (max !== undefined) out.max_length = max;
    if (min !== undefined && max !== undefined && min > max) e.add([...path, 'min_length'], FE.MAX, 'min_length must be less than or equal to max_length.');
  }
  if (type === OptionType.CHANNEL && Array.isArray(v.channel_types)) {
    const types = v.channel_types.filter((t): t is number => Number.isInteger(t) && (t as number) >= 0 && (t as number) <= 16);
    if (types.length) out.channel_types = [...new Set(types)];
  }
  return out;
}

function validateOptionList(
  e: FormErrors, path: FormErrorPath, v: unknown, depth: number, size: SizeCounter, parentType: number | null,
): CommandOption[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) { e.add(path, FE.BAD_TYPE, 'Must be an array.'); return []; }
  if (v.length > COMMAND_LIMITS.OPTIONS) { e.add(path, FE.MAX_LENGTH, `Must be ${COMMAND_LIMITS.OPTIONS} or fewer in length.`); return []; }
  const out: CommandOption[] = [];
  const names = new Set<string>();
  let seenOptional = false;
  v.forEach((raw, i) => {
    const opt = validateOption(e, [...path, i], raw, depth, size);
    if (!opt) return;
    if (names.has(opt.name)) { e.add([...path, i, 'name'], FE.APP_CMD_OPTIONS_DUPLICATE, 'Option names must be unique.'); return; }
    names.add(opt.name);
    const isSub = opt.type === OptionType.SUB_COMMAND || opt.type === OptionType.SUB_COMMAND_GROUP;
    if (parentType === OptionType.SUB_COMMAND_GROUP && opt.type !== OptionType.SUB_COMMAND) {
      e.add([...path, i, 'type'], FE.APP_CMD_OPTIONS_TYPE, 'Subcommand groups can only contain subcommands.');
    }
    if (parentType === OptionType.SUB_COMMAND && isSub) {
      e.add([...path, i, 'type'], FE.APP_CMD_OPTIONS_TYPE, 'Subcommands cannot contain subcommands.');
    }
    if (!isSub) {
      if (opt.required && seenOptional) e.add([...path, i, 'required'], FE.APP_CMD_OPTIONS_ORDER, 'Required options must be placed before non-required options.');
      if (!opt.required) seenOptional = true;
    }
    out.push(opt);
  });
  const subs = out.filter((o) => o.type === OptionType.SUB_COMMAND || o.type === OptionType.SUB_COMMAND_GROUP).length;
  if (subs > 0 && subs !== out.length) e.add(path, FE.APP_CMD_OPTIONS_TYPE, 'Subcommands and subcommand groups cannot be mixed with other options.');
  return out;
}

function permissionsString(e: FormErrors, path: FormErrorPath, v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  const s = typeof v === 'number' && Number.isInteger(v) && v >= 0 ? String(v) : typeof v === 'string' && /^\d{1,20}$/.test(v) ? v : null;
  if (s === null) { e.add(path, FE.COERCE, 'Value is not a valid permission bitfield.'); return undefined; }
  try {
    return BigInt(s).toString();
  } catch {
    e.add(path, FE.COERCE, 'Value is not a valid permission bitfield.');
    return undefined;
  }
}

function enumList(e: FormErrors, path: FormErrorPath, v: unknown, allowed: number[]): number[] | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (!Array.isArray(v) || v.length === 0) { e.add(path, FE.BAD_LENGTH, 'Must be between 1 and 3 in length.'); return undefined; }
  const out: number[] = [];
  for (let i = 0; i < v.length; i++) {
    if (!allowed.includes(v[i] as number)) { e.add([...path, i], FE.CHOICES, `Value must be one of (${allowed.join(', ')}).`); return undefined; }
    if (!out.includes(v[i] as number)) out.push(v[i] as number);
  }
  return out;
}

/**
 * Validate one command definition (POST / PATCH / bulk PUT entry). For PATCH,
 * pass `partial` with the stored definition: missing fields keep their value.
 */
export function validateCommand(
  input: unknown,
  opts: { errors: FormErrors; path?: FormErrorPath; partial?: CommandDefinition; guildScoped?: boolean },
): CommandDefinition | null {
  const e = opts.errors;
  const path = opts.path ?? [];
  const before = e.count;
  if (!isObj(input)) { e.add(path, FE.BAD_TYPE, 'Must be an object.'); return null; }
  const base = opts.partial;
  const rawType = input.type ?? base?.type ?? CommandType.CHAT_INPUT;
  if (typeof rawType !== 'number' || ![1, 2, 3, 4].includes(rawType)) {
    e.add([...path, 'type'], FE.CHOICES, 'Value must be one of (1, 2, 3, 4).');
    return null;
  }
  const type = rawType;
  if (base && input.type !== undefined && input.type !== base.type) {
    e.add([...path, 'type'], FE.INVALID, 'The command type cannot be changed.');
  }
  const isChat = type === CommandType.CHAT_INPUT;
  const name = input.name !== undefined || !base ? validName(e, [...path, 'name'], input.name, isChat) : base.name;
  let description: string | undefined = base?.description ?? '';
  if (input.description !== undefined || !base) {
    if (isChat) description = text(e, [...path, 'description'], input.description, { min: 1, max: COMMAND_LIMITS.DESCRIPTION });
    else if (input.description !== undefined && input.description !== null && input.description !== '') {
      e.add([...path, 'description'], FE.INVALID, 'User and message commands cannot have a description.');
    } else description = '';
  }
  const size: SizeCounter = { chars: (name?.length ?? 0) + (description?.length ?? 0) };
  let options: CommandOption[] = base?.options ?? [];
  if (input.options !== undefined || !base) {
    if (!isChat && Array.isArray(input.options) && input.options.length > 0) {
      e.add([...path, 'options'], FE.INVALID, 'Only chat input commands can have options.');
      options = [];
    } else {
      options = isChat ? validateOptionList(e, [...path, 'options'], input.options, 0, size, null) : [];
    }
  } else {
    // Count the kept options toward the size limit.
    const count = (list: CommandOption[]) => {
      for (const o of list) {
        size.chars += o.name.length + o.description.length;
        for (const c of o.choices ?? []) size.chars += c.name.length + String(c.value).length;
        if (o.options) count(o.options);
      }
    };
    count(options);
  }
  if (size.chars > COMMAND_LIMITS.TOTAL_CHARS) e.add(path, FE.APP_CMD_TOO_LARGE, `Command exceeds maximum size (${COMMAND_LIMITS.TOTAL_CHARS})`);

  const pick = <T>(key: string, fn: () => T | undefined, fallback: T): T => {
    if (input[key] === undefined) return fallback;
    const v = fn();
    return v === undefined ? fallback : v;
  };
  const defaultMemberPermissions = pick('default_member_permissions', () => permissionsString(e, [...path, 'default_member_permissions'], input.default_member_permissions), base?.defaultMemberPermissions ?? null);
  // Deprecated default_permission: false == only admins, like Discord maps it.
  const legacyDefault = input.default_permission === false && input.default_member_permissions === undefined ? '0' : null;
  const dmPermission = pick('dm_permission', () => (typeof input.dm_permission === 'boolean' ? input.dm_permission : null), base?.dmPermission ?? null);
  const contexts = pick('contexts', () => enumList(e, [...path, 'contexts'], input.contexts, [0, 1, 2]), base?.contexts ?? null);
  const integrationTypes = pick('integration_types', () => enumList(e, [...path, 'integration_types'], input.integration_types, [0, 1]), base?.integrationTypes ?? null);
  const nameLocalizations = pick('name_localizations', () => localizations(e, [...path, 'name_localizations'], input.name_localizations, COMMAND_LIMITS.NAME, isChat), base?.nameLocalizations ?? null);
  const descriptionLocalizations = pick('description_localizations', () => localizations(e, [...path, 'description_localizations'], input.description_localizations, COMMAND_LIMITS.DESCRIPTION, false), base?.descriptionLocalizations ?? null);
  const nsfw = pick('nsfw', () => (typeof input.nsfw === 'boolean' ? input.nsfw : false), base?.nsfw ?? false);
  const handler = pick('handler', () => (input.handler === 1 || input.handler === 2 ? input.handler : null), base?.handler ?? null);
  if (type === CommandType.PRIMARY_ENTRY_POINT) e.add([...path, 'type'], FE.CHOICES, 'Activity entry point commands are not supported on SerikaCord.');
  if (opts.guildScoped && input.contexts !== undefined && input.contexts !== null) {
    // Discord ignores contexts on guild commands; keep them but they never widen.
  }
  if (e.count > before || name === undefined || description === undefined) return null;
  const def: CommandDefinition = {
    name,
    type,
    description,
    options,
    defaultMemberPermissions: legacyDefault ?? defaultMemberPermissions,
    dmPermission,
    contexts,
    integrationTypes,
    nameLocalizations,
    descriptionLocalizations,
    nsfw,
    handler,
  };
  if (typeof input.id === 'string' && ID_RE.test(input.id)) def.id = input.id.toLowerCase();
  return def;
}

/** Key a command is matched on (Discord: name + type within a scope). */
export function commandKey(c: { name: string; type?: number | null }): string {
  return `${c.type ?? 1}:${c.name}`;
}

/** Canonical JSON of the fields that make up a command's version. */
export function commandFingerprint(c: Omit<CommandDefinition, 'id'>): string {
  return JSON.stringify([
    c.name, c.type, c.description, c.options, c.defaultMemberPermissions, c.dmPermission, c.contexts,
    c.integrationTypes, c.nameLocalizations, c.descriptionLocalizations, c.nsfw, c.handler,
  ]);
}

/** Count limits per command type for one scope (global, or one guild). */
export function checkScopeLimits(defs: Array<{ type: number }>, errors: FormErrors): void {
  const counts = { 1: 0, 2: 0, 3: 0 } as Record<number, number>;
  for (const d of defs) counts[d.type] = (counts[d.type] ?? 0) + 1;
  if (counts[1] > COMMAND_LIMITS.CHAT_INPUT_PER_SCOPE) errors.add([], 'APPLICATION_COMMANDS_TOO_MANY', `Maximum number of chat input commands reached (${COMMAND_LIMITS.CHAT_INPUT_PER_SCOPE}).`);
  if (counts[2] > COMMAND_LIMITS.USER_PER_SCOPE) errors.add([], 'APPLICATION_COMMANDS_TOO_MANY', `Maximum number of user commands reached (${COMMAND_LIMITS.USER_PER_SCOPE}).`);
  if (counts[3] > COMMAND_LIMITS.MESSAGE_PER_SCOPE) errors.add([], 'APPLICATION_COMMANDS_TOO_MANY', `Maximum number of message commands reached (${COMMAND_LIMITS.MESSAGE_PER_SCOPE}).`);
}

export interface StoredCommandLike {
  id: string;
  name: string;
  type: number | null;
  fingerprint: string;
}

export interface BulkPlan {
  create: CommandDefinition[];
  update: Array<{ id: string; def: CommandDefinition; changed: boolean }>;
  remove: string[];
}

/**
 * Diff a bulk overwrite against the stored commands so ids stay stable: an
 * entry with a known `id` updates that command (rename), otherwise it matches
 * by name + type; unmatched stored commands are deleted. Duplicate name + type
 * entries are reported on `errors`.
 */
export function planBulkOverwrite(
  existing: StoredCommandLike[],
  incoming: CommandDefinition[],
  errors: FormErrors,
): BulkPlan {
  const byKey = new Map(existing.map((c) => [commandKey(c), c]));
  const byId = new Map(existing.map((c) => [c.id.toLowerCase(), c]));
  const used = new Set<string>();
  const seen = new Set<string>();
  const plan: BulkPlan = { create: [], update: [], remove: [] };
  incoming.forEach((def, i) => {
    const key = commandKey(def);
    if (seen.has(key)) { errors.add([i, 'name'], FE.APP_CMD_DUPLICATE, 'Application command names must be unique'); return; }
    seen.add(key);
    let match = def.id ? byId.get(def.id) : undefined;
    if (match && (match.type ?? 1) !== def.type) match = undefined;
    match ??= byKey.get(key);
    if (match && !used.has(match.id)) {
      used.add(match.id);
      plan.update.push({ id: match.id, def, changed: commandFingerprint(def) !== match.fingerprint });
    } else {
      plan.create.push(def);
    }
  });
  for (const c of existing) if (!used.has(c.id)) plan.remove.push(c.id);
  return plan;
}

/** A Discord-style snowflake for `now` (command versions). */
export function snowflakeNow(now: number = Date.now()): string {
  const DISCORD_EPOCH = 1420070400000n;
  const seq = BigInt(Math.floor(Math.random() * 4096));
  return (((BigInt(now) - DISCORD_EPOCH) << 22n) | seq).toString();
}

// ─── Invocations (user → interaction data) ──────────────────

export interface InvocationOption {
  name: string;
  type: number;
  value?: string | number | boolean;
  options?: InvocationOption[];
  focused?: boolean;
}

export interface InvocationRefs {
  users: string[];
  roles: string[];
  channels: string[];
  mentionables: string[];
  attachments: string[];
}

export type InvocationCheck =
  | { ok: true; options: InvocationOption[]; refs: InvocationRefs; focused: InvocationOption | null; path: string[] }
  | { ok: false; reason: 'unknown_option' | 'missing_required' | 'bad_value' | 'bad_structure' | 'focus'; option?: string };

/** Mention token or bare id → id (users `<@id>` / `<@!id>`, roles `<@&id>`, channels `<#id>`). */
export function stripMention(raw: string, kind: 'user' | 'role' | 'channel' | 'mentionable'): string {
  const s = raw.trim();
  const m = kind === 'channel' ? /^<#([^>]+)>$/.exec(s) : /^<@[!&]?([^>]+)>$/.exec(s);
  return (m ? m[1] : s).toLowerCase();
}

function checkLeafValue(decl: CommandOption, raw: unknown, focused: boolean): { ok: true; value: string | number | boolean } | { ok: false } {
  // The focused option of an autocomplete carries whatever the user typed so far.
  if (focused) {
    if (typeof raw !== 'string' && typeof raw !== 'number') return { ok: false };
    const s = cleanText(String(raw)).slice(0, COMMAND_LIMITS.STRING_LENGTH);
    return { ok: true, value: s };
  }
  const inChoices = (v: string | number) => !decl.choices?.length || decl.choices.some((c) => c.value === v);
  switch (decl.type) {
    case OptionType.STRING: {
      if (typeof raw !== 'string') return { ok: false };
      const s = cleanText(raw);
      const max = decl.max_length ?? COMMAND_LIMITS.STRING_LENGTH;
      if (s.length > max || s.length < (decl.min_length ?? 0) || (decl.required && s.length === 0)) return { ok: false };
      if (!inChoices(s)) return { ok: false };
      return { ok: true, value: s };
    }
    case OptionType.INTEGER:
    case OptionType.NUMBER: {
      const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN;
      if (!Number.isFinite(n) || Math.abs(n) > INT53_MAX) return { ok: false };
      if (decl.type === OptionType.INTEGER && !Number.isInteger(n)) return { ok: false };
      if (decl.min_value !== undefined && n < decl.min_value) return { ok: false };
      if (decl.max_value !== undefined && n > decl.max_value) return { ok: false };
      if (!inChoices(n)) return { ok: false };
      return { ok: true, value: n };
    }
    case OptionType.BOOLEAN: {
      if (typeof raw === 'boolean') return { ok: true, value: raw };
      if (raw === 'true' || raw === 'false') return { ok: true, value: raw === 'true' };
      return { ok: false };
    }
    case OptionType.USER:
    case OptionType.ROLE:
    case OptionType.CHANNEL:
    case OptionType.MENTIONABLE:
    case OptionType.ATTACHMENT: {
      if (typeof raw !== 'string') return { ok: false };
      const kind = decl.type === OptionType.ROLE ? 'role' : decl.type === OptionType.CHANNEL ? 'channel' : 'user';
      if (decl.type === OptionType.ATTACHMENT) {
        const id = raw.trim();
        return /^[A-Za-z0-9_-]{1,64}$/.test(id) ? { ok: true, value: id } : { ok: false };
      }
      const id = stripMention(raw, kind);
      return ID_RE.test(id) ? { ok: true, value: id } : { ok: false };
    }
    default:
      return { ok: false };
  }
}

/**
 * Check typed options from the command picker (Discord's own `data.options`
 * shape) against the command's declared options. Walks subcommand groups and
 * subcommands, coerces and range-checks values, requires required options
 * (except for autocomplete, which must have exactly one `focused` option).
 * Entity ids are returned in `refs` for the caller to verify and resolve.
 */
export function checkInvocationOptions(
  declared: CommandOption[],
  submitted: unknown,
  opts: { autocomplete?: boolean } = {},
): InvocationCheck {
  const refs: InvocationRefs = { users: [], roles: [], channels: [], mentionables: [], attachments: [] };
  const list = submitted === undefined || submitted === null ? [] : submitted;
  if (!Array.isArray(list) || list.length > COMMAND_LIMITS.OPTIONS) return { ok: false, reason: 'bad_structure' };
  const path: string[] = [];
  let focused: InvocationOption | null = null;

  const leaves = (decls: CommandOption[], given: unknown[]): InvocationOption[] | InvocationCheck => {
    const out: InvocationOption[] = [];
    const seen = new Set<string>();
    for (const g of given) {
      if (!isObj(g) || typeof g.name !== 'string') return { ok: false, reason: 'bad_structure' };
      const decl = decls.find((d) => d.name === g.name);
      if (!decl || decl.type === OptionType.SUB_COMMAND || decl.type === OptionType.SUB_COMMAND_GROUP) return { ok: false, reason: 'unknown_option', option: g.name };
      if (seen.has(decl.name)) return { ok: false, reason: 'bad_structure', option: decl.name };
      seen.add(decl.name);
      const isFocused = Boolean(opts.autocomplete && g.focused === true);
      if (isFocused) {
        if (focused || !decl.autocomplete) return { ok: false, reason: 'focus', option: decl.name };
      }
      const checked = checkLeafValue(decl, g.value, isFocused);
      if (!checked.ok) {
        // Autocomplete sends the other options as typed so far; skip the bad ones.
        if (opts.autocomplete) continue;
        return { ok: false, reason: 'bad_value', option: decl.name };
      }
      const option: InvocationOption = { name: decl.name, type: decl.type, value: checked.value };
      if (isFocused) { option.focused = true; focused = option; }
      else if (typeof checked.value === 'string') {
        if (decl.type === OptionType.USER) refs.users.push(checked.value);
        else if (decl.type === OptionType.ROLE) refs.roles.push(checked.value);
        else if (decl.type === OptionType.CHANNEL) refs.channels.push(checked.value);
        else if (decl.type === OptionType.MENTIONABLE) refs.mentionables.push(checked.value);
        else if (decl.type === OptionType.ATTACHMENT) refs.attachments.push(checked.value);
      }
      out.push(option);
    }
    if (!opts.autocomplete) {
      for (const d of decls) {
        if (d.required && !seen.has(d.name)) return { ok: false, reason: 'missing_required', option: d.name };
      }
    }
    return out;
  };

  const hasSubs = declared.some((d) => d.type === OptionType.SUB_COMMAND || d.type === OptionType.SUB_COMMAND_GROUP);
  let result: InvocationOption[] | InvocationCheck;
  if (!hasSubs) {
    result = leaves(declared, list);
  } else {
    if (list.length !== 1 || !isObj(list[0]) || typeof list[0].name !== 'string') return { ok: false, reason: 'bad_structure' };
    const first = list[0];
    const decl = declared.find((d) => d.name === first.name);
    if (!decl || (decl.type !== OptionType.SUB_COMMAND && decl.type !== OptionType.SUB_COMMAND_GROUP)) return { ok: false, reason: 'unknown_option', option: String(first.name) };
    path.push(decl.name);
    const inner = Array.isArray(first.options) ? first.options : [];
    if (decl.type === OptionType.SUB_COMMAND) {
      const r = leaves(decl.options ?? [], inner);
      result = Array.isArray(r) ? [{ name: decl.name, type: decl.type, options: r }] : r;
    } else {
      if (inner.length !== 1 || !isObj(inner[0]) || typeof inner[0].name !== 'string') return { ok: false, reason: 'bad_structure' };
      const sub = (decl.options ?? []).find((d) => d.name === (inner[0] as Record<string, unknown>).name && d.type === OptionType.SUB_COMMAND);
      if (!sub) return { ok: false, reason: 'unknown_option', option: String(inner[0].name) };
      path.push(sub.name);
      const r = leaves(sub.options ?? [], Array.isArray(inner[0].options) ? inner[0].options : []);
      result = Array.isArray(r) ? [{ name: decl.name, type: decl.type, options: [{ name: sub.name, type: sub.type, options: r }] }] : r;
    }
  }
  if (!Array.isArray(result)) return result;
  if (opts.autocomplete && !focused) return { ok: false, reason: 'focus' };
  return { ok: true, options: result, refs, focused, path };
}

/** Find the declared option a focused autocomplete value belongs to (for choice coercion). */
export function findDeclaredOption(declared: CommandOption[], path: string[], name: string): CommandOption | null {
  let level = declared;
  for (const p of path) {
    const next = level.find((o) => o.name === p);
    if (!next) return null;
    level = next.options ?? [];
  }
  return level.find((o) => o.name === name) ?? null;
}

/**
 * Validate autocomplete choices a bot returned (callback type 8). Values must
 * match the focused option's type; at most 25.
 */
export function validateAutocompleteChoices(input: unknown, optionType: number): CommandChoice[] | null {
  if (!isObj(input)) return null;
  const list = input.choices;
  if (list === undefined || list === null) return [];
  if (!Array.isArray(list) || list.length > COMMAND_LIMITS.AUTOCOMPLETE_CHOICES) return null;
  const out: CommandChoice[] = [];
  for (const c of list) {
    if (!isObj(c) || typeof c.name !== 'string' || c.name.length === 0 || c.name.length > COMMAND_LIMITS.CHOICE_NAME) return null;
    if (optionType === OptionType.STRING) {
      if (typeof c.value !== 'string' || c.value.length > COMMAND_LIMITS.CHOICE_STRING_VALUE) return null;
    } else if (typeof c.value !== 'number' || !Number.isFinite(c.value) || (optionType === OptionType.INTEGER && !Number.isInteger(c.value))) {
      return null;
    }
    out.push({ name: cleanLabel(c.name), value: c.value });
  }
  return out;
}

/**
 * Whether a member with `memberPerms` may use a command that requires
 * `defaultMemberPermissions` (null: everyone; "0": only admins/owner).
 */
export function memberMeetsDefaultPermissions(defaultMemberPermissions: string | null | undefined, memberPerms: bigint, isAdmin: boolean): boolean {
  if (isAdmin) return true;
  if (defaultMemberPermissions === null || defaultMemberPermissions === undefined) return true;
  let required: bigint;
  try { required = BigInt(defaultMemberPermissions); } catch { return false; }
  if (required === 0n) return false;
  return (memberPerms & required) === required;
}

/** The contexts a command may run in (null = derive from dm_permission). */
export function commandContexts(c: { contexts?: number[] | null; dmPermission?: boolean | null; guildId?: string | null }): number[] {
  if (c.guildId) return [InteractionContext.GUILD];
  if (Array.isArray(c.contexts) && c.contexts.length) return c.contexts;
  return c.dmPermission === false ? [InteractionContext.GUILD] : [InteractionContext.GUILD, InteractionContext.BOT_DM, InteractionContext.PRIVATE_CHANNEL];
}

export interface CommandPermissionEntry { id: string; type: 1 | 2 | 3; permission: boolean }

/** Validate a permissions v2 PUT body ({ permissions: [...] }, at most 100). */
export function validateCommandPermissions(input: unknown, errors: FormErrors): CommandPermissionEntry[] | null {
  const before = errors.count;
  if (!isObj(input) || !Array.isArray(input.permissions)) { errors.add(['permissions'], FE.REQUIRED, 'This field is required'); return null; }
  if (input.permissions.length > 100) { errors.add(['permissions'], FE.MAX_LENGTH, 'Must be 100 or fewer in length.'); return null; }
  const out: CommandPermissionEntry[] = [];
  const seen = new Set<string>();
  input.permissions.forEach((p, i) => {
    if (!isObj(p) || typeof p.id !== 'string' || !ID_RE.test(p.id)) { errors.add(['permissions', i, 'id'], FE.BAD_TYPE, 'Value is not snowflake.'); return; }
    if (p.type !== 1 && p.type !== 2 && p.type !== 3) { errors.add(['permissions', i, 'type'], FE.CHOICES, 'Value must be one of (1, 2, 3).'); return; }
    if (typeof p.permission !== 'boolean') { errors.add(['permissions', i, 'permission'], FE.BAD_TYPE, 'Must be either true or false.'); return; }
    const key = `${p.type}:${p.id.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ id: p.id.toLowerCase(), type: p.type, permission: p.permission });
  });
  return errors.count > before ? null : out;
}

/**
 * Apply command permissions v2: command-level overrides win over app-level
 * ones. For users and roles, a user override beats role overrides, and any
 * allowed role beats denied roles (Discord). `everyoneId` is the @everyone
 * role id (on Discord the guild id; both are accepted); channel overrides with
 * `allChannelsId` apply to every channel. Returns null when nothing decides
 * (fall back to default_member_permissions).
 */
export function resolveCommandPermission(
  layers: Array<CommandPermissionEntry[] | null | undefined>,
  ctx: { userId: string; roleIds: string[]; channelId: string; everyoneIds: string[]; allChannelsIds: string[] },
): { user: boolean | null; channel: boolean | null } {
  const lower = (s: string) => s.toLowerCase();
  const userId = lower(ctx.userId);
  const roleIds = new Set(ctx.roleIds.map(lower));
  const everyone = new Set(ctx.everyoneIds.map(lower));
  const allChannels = new Set(ctx.allChannelsIds.map(lower));
  let user: boolean | null = null;
  let channel: boolean | null = null;
  for (const layer of layers) {
    if (!layer || layer.length === 0) continue;
    if (user === null) {
      const direct = layer.find((p) => p.type === 2 && lower(p.id) === userId);
      if (direct) user = direct.permission;
      else {
        const roles = layer.filter((p) => p.type === 1 && roleIds.has(lower(p.id)) && !everyone.has(lower(p.id)));
        if (roles.length) user = roles.some((p) => p.permission);
        else {
          const ev = layer.find((p) => p.type === 1 && everyone.has(lower(p.id)));
          if (ev) user = ev.permission;
        }
      }
    }
    if (channel === null) {
      const direct = layer.find((p) => p.type === 3 && lower(p.id) === lower(ctx.channelId));
      if (direct) channel = direct.permission;
      else {
        const all = layer.find((p) => p.type === 3 && allChannels.has(lower(p.id)));
        if (all) channel = all.permission;
      }
    }
  }
  return { user, channel };
}

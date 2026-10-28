/**
 * The slash-command composer's pure model, shared by every chat surface
 * (server channels, DMs, group DMs) through MessageBar.
 *
 * Built-in commands (lib/chat/slashCommands) and app (bot) commands
 * (lib/chat/appCommandContext) become one `CommandSpec` shape. The composer
 * keeps a `CommandDraft` (the option values the user filled in) and asks this
 * module whether the command is ready to send, what Enter should do, how the
 * palette ranks matches, and how a draft round-trips to text (history, typed
 * commands). No React, no network: covered by tests/command-composer.test.ts.
 */
import {
  BUILT_IN_COMMANDS,
  DURATION_PRESETS,
  parseDuration,
  parseSlashCommand,
  type SlashCommand,
} from "@/lib/chat/slashCommands";
import { OPT, tokenizeInput, type AppLeafCommand } from "@/lib/chat/appCommandContext";
import type { AppCommandOption } from "@/lib/services/appCommands";

export type CommandOptionKind =
  | "string"
  | "integer"
  | "number"
  | "boolean"
  | "user"
  | "channel"
  | "role"
  | "mentionable"
  | "attachment"
  | "duration";

export interface CommandChoice {
  name: string;
  value: string;
  description?: string;
  emoji?: string;
}

export interface CommandOptionSpec {
  name: string;
  description: string;
  required: boolean;
  kind: CommandOptionKind;
  choices?: CommandChoice[];
  /** Choices are suggestions; any valid value of `kind` is accepted too. */
  allowCustom?: boolean;
  /** App autocomplete (APPLICATION_COMMAND_AUTOCOMPLETE) supplies choices. */
  autocomplete?: boolean;
  minValue?: number;
  maxValue?: number;
  minLength?: number;
  maxLength?: number;
}

export interface CommandSpec {
  /** Unique across the catalog: `builtin:<name>` or `app:<appId>:<full name>`. */
  key: string;
  /** Full name without the slash (`roll`, `amq start`). */
  name: string;
  description: string;
  source: "builtin" | "app";
  app?: { id: string; name: string; icon: string | null };
  hint?: string;
  options: CommandOptionSpec[];
  /** App commands: the leaf to invoke. */
  leaf?: AppLeafCommand;
}

/** Option values the user filled in, by option name. */
export interface CommandDraft {
  /** Raw values: text, a choice value, "true"/"false", or a mention token (`<@id>`, `<@&id>`, `<#id>`). */
  values: Record<string, string>;
  /** Display labels for values that aren't readable on their own (choices, people, roles, channels). */
  labels: Record<string, string>;
  /** Options on screen. Required ones always; optional ones once the user adds them. */
  shown: string[];
}

// ---------------------------------------------------------------------------
// Specs
// ---------------------------------------------------------------------------

function appOptionKind(type: number): CommandOptionKind {
  switch (type) {
    case OPT.INTEGER: return "integer";
    case OPT.NUMBER: return "number";
    case OPT.BOOLEAN: return "boolean";
    case OPT.USER: return "user";
    case OPT.CHANNEL: return "channel";
    case OPT.ROLE: return "role";
    case OPT.MENTIONABLE: return "mentionable";
    case OPT.ATTACHMENT: return "attachment";
    default: return "string";
  }
}

function appOptionSpec(o: AppCommandOption): CommandOptionSpec {
  return {
    name: o.name,
    description: o.description || "",
    required: !!o.required,
    kind: appOptionKind(o.type),
    choices: o.choices?.length
      ? o.choices.map((c) => ({ name: c.name, value: String(c.value), description: c.description, emoji: c.emoji }))
      : undefined,
    autocomplete: !!o.autocomplete && !o.choices?.length,
    minValue: o.min_value,
    maxValue: o.max_value,
    minLength: o.min_length,
    maxLength: o.max_length,
  };
}

export function appLeafSpec(leaf: AppLeafCommand): CommandSpec {
  return {
    key: `app:${leaf.application.id}:${leaf.fullName}`,
    name: leaf.fullName,
    description: leaf.description,
    source: "app",
    app: { id: leaf.application.id, name: leaf.application.name, icon: leaf.application.icon },
    options: leaf.options
      .filter((o) => o.type !== OPT.SUB_COMMAND && o.type !== OPT.SUB_COMMAND_GROUP)
      .map(appOptionSpec),
    leaf,
  };
}

export function builtinSpec(cmd: SlashCommand): CommandSpec {
  return {
    key: `builtin:${cmd.name}`,
    name: cmd.name,
    description: cmd.description,
    source: "builtin",
    hint: cmd.hint,
    options: cmd.params.map((p) => {
      if (p.isUserTarget) return { name: p.name, description: p.description, required: !!p.required, kind: "user" as const };
      if (p.isDuration) {
        return {
          name: p.name,
          description: p.description,
          required: !!p.required,
          kind: "duration" as const,
          allowCustom: true,
          choices: DURATION_PRESETS.map((d) => ({ name: d.label, value: d.value, description: d.description })),
        };
      }
      if (p.choices?.length) {
        return {
          name: p.name,
          description: p.description,
          required: !!p.required,
          kind: "string" as const,
          choices: p.choices.map((c) => ({ name: c.label, value: c.value, description: c.description })),
        };
      }
      if (p.integer) {
        return { name: p.name, description: p.description, required: !!p.required, kind: "integer" as const, minValue: p.integer.min, maxValue: p.integer.max };
      }
      return { name: p.name, description: p.description, required: !!p.required, kind: "string" as const };
    }),
  };
}

/**
 * Every command available here: app commands first (Discord lists them above
 * the built-ins), then the built-ins this surface allows.
 */
export function buildCommandCatalog(leaves: AppLeafCommand[], isServer: boolean): CommandSpec[] {
  return [
    ...leaves.map(appLeafSpec),
    ...BUILT_IN_COMMANDS.filter((c) => isServer || !c.serverOnly).map(builtinSpec),
  ];
}

// ---------------------------------------------------------------------------
// Palette ranking
// ---------------------------------------------------------------------------

export interface RankedCommand {
  spec: CommandSpec;
  score: number;
  /** Indices into `spec.name` to highlight. */
  match: number[];
}

const range = (start: number, length: number) => Array.from({ length }, (_, i) => start + i);

/**
 * How well `name` matches `query` (both lowercase). Exact > prefix > word
 * prefix > substring > in-order letters (fuzzy). Null when it doesn't match.
 */
export function scoreCommandName(name: string, query: string): { score: number; match: number[] } | null {
  if (!query) return { score: 0, match: [] };
  if (name === query) return { score: 1000, match: range(0, query.length) };
  if (name.startsWith(query)) return { score: 900 - Math.min(99, name.length - query.length), match: range(0, query.length) };
  for (let i = 1; i < name.length; i++) {
    if (/[\s_-]/.test(name[i - 1]) && name.startsWith(query, i)) return { score: 700 - Math.min(99, i), match: range(i, query.length) };
  }
  const at = name.indexOf(query);
  if (at >= 0) return { score: 500 - Math.min(99, at), match: range(at, query.length) };
  // Letters in order, e.g. "lb" → "leaderboard". Spaces in the query are ignored.
  const letters = query.replace(/\s+/g, "");
  if (letters.length < 2) return null;
  const match: number[] = [];
  let gaps = 0;
  let from = 0;
  for (const ch of letters) {
    const idx = name.indexOf(ch, from);
    if (idx < 0) return null;
    if (match.length) gaps += idx - from;
    match.push(idx);
    from = idx + 1;
  }
  return { score: Math.max(101, 300 - gaps * 10 - match[0]), match };
}

/** Rank the catalog for a query; ties keep catalog order. Empty query → everything. */
export function rankCommands(specs: CommandSpec[], rawQuery: string): RankedCommand[] {
  const query = rawQuery.trim().toLowerCase().replace(/\s+/g, " ");
  const out: RankedCommand[] = [];
  for (const spec of specs) {
    const name = spec.name.toLowerCase();
    const hit = scoreCommandName(name, query);
    if (hit) {
      out.push({ spec, score: hit.score, match: hit.match });
      continue;
    }
    if (query.length >= 2 && spec.description.toLowerCase().includes(query)) out.push({ spec, score: 50, match: [] });
    else if (query.length >= 2 && spec.app?.name.toLowerCase().includes(query)) out.push({ spec, score: 40, match: [] });
  }
  // Array.prototype.sort is stable: equal scores stay in catalog order.
  return out.sort((a, b) => b.score - a.score);
}

export interface CommandGroup {
  /** `app:<id>` or `builtin`. */
  key: string;
  kind: "app" | "builtin";
  /** App name (built-ins get their label from the UI). */
  label: string;
  icon: string | null;
  items: RankedCommand[];
}

/** Group ranked commands by app (and one built-in group); groups appear in order of their best match. */
export function groupRankedCommands(ranked: RankedCommand[]): CommandGroup[] {
  const groups: CommandGroup[] = [];
  const byKey = new Map<string, CommandGroup>();
  for (const r of ranked) {
    const key = r.spec.source === "app" ? `app:${r.spec.app?.id ?? ""}` : "builtin";
    let g = byKey.get(key);
    if (!g) {
      g = {
        key,
        kind: r.spec.source === "app" ? "app" : "builtin",
        label: r.spec.app?.name ?? "",
        icon: r.spec.app?.icon ?? null,
        items: [],
      };
      byKey.set(key, g);
      groups.push(g);
    }
    g.items.push(r);
  }
  return groups;
}

/** The palette's rows in render order (keyboard navigation walks this). */
export function flattenGroups(groups: CommandGroup[]): RankedCommand[] {
  return groups.flatMap((g) => g.items);
}

/**
 * Keep the highlighted row stable while the list changes under it: the same
 * command stays highlighted when it is still listed, otherwise the first row.
 */
export function keepActiveKey(rows: { spec: CommandSpec }[], activeKey: string | null): string | null {
  if (rows.length === 0) return null;
  if (activeKey && rows.some((r) => r.spec.key === activeKey)) return activeKey;
  return rows[0].spec.key;
}

/** Move the highlight by `delta` rows, wrapping around. */
export function moveActiveKey(rows: { spec: CommandSpec }[], activeKey: string | null, delta: number): string | null {
  if (rows.length === 0) return null;
  const idx = Math.max(0, rows.findIndex((r) => r.spec.key === activeKey));
  return rows[(idx + delta + rows.length * 10) % rows.length].spec.key;
}

/**
 * The palette query when the composer holds only `/query` (caret at the end).
 * Spaces are allowed while they could still lead to a subcommand
 * (`/amq st`); anything else (`/roll 20`) is a typed command, not a query.
 */
export function paletteQuery(text: string, specs: CommandSpec[]): string | null {
  if (!text.startsWith("/") || /\n/.test(text)) return null;
  const query = text.slice(1);
  if (/^\s/.test(query)) return null;
  const q = query.toLowerCase().replace(/\s+/g, " ");
  const body = q.trimEnd();
  if (body === q) {
    if (!body.includes(" ")) return query;
    return specs.some((s) => s.name.toLowerCase().startsWith(body)) ? query : null;
  }
  // Trailing space: stay open while the name is ambiguous (a bot's /roll and
  // the built-in) or a longer command continues it (`/amq ` → `amq start`).
  const exact = specs.filter((s) => s.name.toLowerCase() === body).length;
  const continues = specs.some((s) => s.name.toLowerCase().startsWith(`${body} `));
  return exact > 1 || continues ? query : null;
}

/**
 * Typing `/name ` (space after a full name) picks that command, like
 * Discord. Only when exactly one command has that name and no longer
 * command continues it (`/amq ` waits for `start`).
 */
export function autoPickOnSpace(text: string, specs: CommandSpec[]): CommandSpec | null {
  if (!text.startsWith("/") || !/\s$/.test(text)) return null;
  const name = text.slice(1).trim().toLowerCase().replace(/\s+/g, " ");
  if (!name) return null;
  const exact = specs.filter((s) => s.name.toLowerCase() === name);
  if (exact.length !== 1) return null;
  if (specs.some((s) => s.name.toLowerCase().startsWith(`${name} `))) return null;
  return exact[0];
}

// ---------------------------------------------------------------------------
// Drafts
// ---------------------------------------------------------------------------

export function initialDraft(spec: CommandSpec): CommandDraft {
  return { values: {}, labels: {}, shown: spec.options.filter((o) => o.required).map((o) => o.name) };
}

/** Options on screen, in declaration order. */
export function shownOptions(spec: CommandSpec, draft: CommandDraft): CommandOptionSpec[] {
  return spec.options.filter((o) => o.required || draft.shown.includes(o.name));
}

/** Optional options the user hasn't added yet. */
export function hiddenOptionalOptions(spec: CommandSpec, draft: CommandDraft): CommandOptionSpec[] {
  return spec.options.filter((o) => !o.required && !draft.shown.includes(o.name));
}

export function addOptionToDraft(draft: CommandDraft, name: string): CommandDraft {
  return draft.shown.includes(name) ? draft : { ...draft, shown: [...draft.shown, name] };
}

/** Remove an optional option (and its value). Required options stay. */
export function removeOptionFromDraft(spec: CommandSpec, draft: CommandDraft, name: string): CommandDraft {
  const opt = spec.options.find((o) => o.name === name);
  if (!opt || opt.required) return draft;
  const values = { ...draft.values };
  const labels = { ...draft.labels };
  delete values[name];
  delete labels[name];
  return { values, labels, shown: draft.shown.filter((n) => n !== name) };
}

export function setDraftValue(draft: CommandDraft, name: string, value: string, label?: string): CommandDraft {
  const values = { ...draft.values, [name]: value };
  const labels = { ...draft.labels };
  if (label !== undefined) labels[name] = label;
  else delete labels[name];
  return { ...draft, values, labels };
}

// ---------------------------------------------------------------------------
// Validation & readiness
// ---------------------------------------------------------------------------

export type OptionErrorCode =
  | "integer"
  | "number"
  | "min"
  | "max"
  | "minLength"
  | "maxLength"
  | "choice"
  | "boolean"
  | "user"
  | "role"
  | "channel"
  | "mentionable"
  | "duration";

export interface OptionError {
  code: OptionErrorCode;
  limit?: number;
}

const ID = "(?:\\d{1,20}|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})";
const USER_RE = new RegExp(`^<@!?${ID}>$`);
const ROLE_RE = new RegExp(`^<@&${ID}>$`);
const CHANNEL_RE = new RegExp(`^<#${ID}>$`);
const RAW_ID_RE = new RegExp(`^${ID}$`);

/** The choice a typed value means (by value, then by name), if any. */
export function findChoice(opt: CommandOptionSpec, raw: string): CommandChoice | null {
  const lower = raw.trim().toLowerCase();
  if (!opt.choices?.length || !lower) return null;
  return opt.choices.find((c) => c.value.toLowerCase() === lower) ?? opt.choices.find((c) => c.name.toLowerCase() === lower) ?? null;
}

/** Why a (non-empty) value isn't valid for the option, or null when it is. */
export function optionValueError(opt: CommandOptionSpec, raw: string): OptionError | null {
  const value = raw.trim();
  if (!value) return null;
  if (opt.choices?.length && !opt.allowCustom) return findChoice(opt, value) ? null : { code: "choice" };
  switch (opt.kind) {
    case "integer":
    case "number": {
      const n = Number(value);
      if (!Number.isFinite(n)) return { code: "number" };
      if (opt.kind === "integer" && !Number.isInteger(n)) return { code: "integer" };
      if (opt.minValue !== undefined && n < opt.minValue) return { code: "min", limit: opt.minValue };
      if (opt.maxValue !== undefined && n > opt.maxValue) return { code: "max", limit: opt.maxValue };
      return null;
    }
    case "boolean":
      return ["true", "false", "yes", "no", "1", "0", "on", "off"].includes(value.toLowerCase()) ? null : { code: "boolean" };
    case "user":
      return USER_RE.test(value) || RAW_ID_RE.test(value) ? null : { code: "user" };
    case "role":
      return ROLE_RE.test(value) || RAW_ID_RE.test(value) ? null : { code: "role" };
    case "channel":
      return CHANNEL_RE.test(value) || RAW_ID_RE.test(value) ? null : { code: "channel" };
    case "mentionable":
      return USER_RE.test(value) || ROLE_RE.test(value) || RAW_ID_RE.test(value) ? null : { code: "mentionable" };
    case "duration":
      return findChoice(opt, value) || parseDuration(value) ? null : { code: "duration" };
    case "string":
      if (opt.minLength !== undefined && value.length < opt.minLength) return { code: "minLength", limit: opt.minLength };
      if (opt.maxLength !== undefined && value.length > opt.maxLength) return { code: "maxLength", limit: opt.maxLength };
      return null;
    default:
      return null;
  }
}

export interface CommandReadiness {
  ready: boolean;
  /** First required option without a value. */
  missing: string | null;
  /** First filled option with an invalid value. */
  invalid: { name: string; error: OptionError } | null;
}

/**
 * Whether the command can be sent: every REQUIRED option has a valid value.
 * Optional options never block sending (empty ones are simply left out).
 * `files` marks attachment options that have a file.
 */
export function commandReadiness(spec: CommandSpec, draft: CommandDraft, files: Record<string, unknown> = {}): CommandReadiness {
  let missing: string | null = null;
  let invalid: CommandReadiness["invalid"] = null;
  for (const opt of spec.options) {
    if (opt.kind === "attachment") {
      if (opt.required && !files[opt.name] && !missing) missing = opt.name;
      continue;
    }
    const raw = (draft.values[opt.name] ?? "").trim();
    if (!raw) {
      if (opt.required && !missing) missing = opt.name;
      continue;
    }
    if (!draft.shown.includes(opt.name) && !opt.required) continue;
    const error = optionValueError(opt, raw);
    if (error && !invalid) invalid = { name: opt.name, error };
  }
  return { ready: !missing && !invalid, missing, invalid };
}

export type CommandDropdown = "none" | "values" | "optional";

export type EnterAction = "select" | "submit" | "focus-missing" | "focus-invalid";

/**
 * What Enter does in command mode (Discord rules):
 *  - a value list (choices, people, autocomplete) with a highlighted row that
 *    isn't already the value → pick it;
 *  - the optional-options list → pick only when the user typed or arrowed in
 *    it, never just because it is showing;
 *  - otherwise send when every required option is filled, else point at the
 *    first missing (or invalid) one. Optional options never block Enter.
 */
export function decideCommandEnter(input: {
  readiness: CommandReadiness;
  dropdown: CommandDropdown;
  hasHighlight: boolean;
  /** The user typed or used the arrow keys in the open list. */
  interacted: boolean;
  /** The highlighted row is already the option's value. */
  highlightIsCurrent?: boolean;
}): EnterAction {
  const { readiness, dropdown, hasHighlight, interacted, highlightIsCurrent } = input;
  if (dropdown === "values" && hasHighlight && !highlightIsCurrent) return "select";
  if (dropdown === "optional" && hasHighlight && interacted) return "select";
  if (readiness.missing) return "focus-missing";
  if (readiness.invalid) return "focus-invalid";
  return "submit";
}

// ---------------------------------------------------------------------------
// Text round-trip (history, typed commands)
// ---------------------------------------------------------------------------

/** Built-in commands run on positional args; the last one may contain spaces. */
export function builtinArgs(spec: CommandSpec, draft: CommandDraft): string[] {
  const args: string[] = [];
  for (const opt of spec.options) {
    const v = (draft.values[opt.name] ?? "").trim();
    if (!v) continue;
    const choice = findChoice(opt, v);
    args.push(choice ? choice.value : v);
  }
  return args;
}

function quoteToken(value: string): string {
  return /\s/.test(value) ? `"${value.replace(/"/g, "'")}"` : value.replace(/"/g, "'");
}

/** `/name opt:value …` (apps) or `/name arg …` (built-ins), for display and history. */
export function serializeCommand(spec: CommandSpec, draft: CommandDraft): string {
  if (spec.source === "builtin") {
    const args = builtinArgs(spec, draft);
    const parts = args.map((a, i) => (i === args.length - 1 ? a : quoteToken(a)));
    return [`/${spec.name}`, ...parts].join(" ");
  }
  const parts = [`/${spec.name}`];
  for (const opt of shownOptions(spec, draft)) {
    if (opt.kind === "attachment") continue;
    const v = (draft.values[opt.name] ?? "").trim();
    if (v) parts.push(`${opt.name}:${quoteToken(v)}`);
  }
  return parts.join(" ");
}

/**
 * A typed command (`/roll 20`, `/mod warn user:<@id> reason:spam`) as a
 * spec + draft, so it can be recalled with ↑ like a palette one. Built-ins
 * win a name clash, matching how a typed command runs.
 */
export function parseCommandText(text: string, specs: CommandSpec[]): { spec: CommandSpec; draft: CommandDraft } | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) return null;
  const builtin = parseSlashCommand(trimmed);
  if (builtin) {
    const spec = specs.find((s) => s.key === `builtin:${builtin.name}`);
    if (!spec) return null;
    const draft = initialDraft(spec);
    const args = builtin.args;
    spec.options.forEach((opt, i) => {
      if (i >= args.length) return;
      const last = i === spec.options.length - 1;
      const value = last ? args.slice(i).join(" ") : args[i];
      draft.values[opt.name] = value;
      if (!draft.shown.includes(opt.name)) draft.shown.push(opt.name);
    });
    return { spec, draft };
  }
  const tokens = tokenizeInput(trimmed.slice(1));
  let best: CommandSpec | null = null;
  for (const spec of specs) {
    if (spec.source !== "app" || !spec.leaf) continue;
    const path = spec.leaf.path;
    if (tokens.length < path.length) continue;
    if (path.every((p, i) => p.toLowerCase() === tokens[i].toLowerCase()) && (!best || path.length > (best.leaf?.path.length ?? 0))) best = spec;
  }
  if (!best?.leaf) return null;
  const draft = initialDraft(best);
  const rest = tokens.slice(best.leaf.path.length);
  const byName = new Map(best.options.map((o) => [o.name.toLowerCase(), o]));
  const positional: string[] = [];
  for (const t of rest) {
    const sep = t.indexOf(":");
    const opt = sep > 0 ? byName.get(t.slice(0, sep).toLowerCase()) : undefined;
    if (opt && opt.kind !== "attachment") draft.values[opt.name] = t.slice(sep + 1);
    else positional.push(t);
  }
  const free = best.options.filter((o) => o.kind !== "attachment" && draft.values[o.name] === undefined);
  free.forEach((opt, i) => {
    if (i >= positional.length) return;
    const last = i === free.length - 1 && opt.kind === "string" && !opt.choices?.length;
    draft.values[opt.name] = last ? positional.slice(i).join(" ") : positional[i];
  });
  for (const opt of best.options) {
    if (draft.values[opt.name] && !draft.shown.includes(opt.name)) draft.shown.push(opt.name);
  }
  return { spec: best, draft };
}

/** Draft values with choice names resolved to their values (what gets sent). */
export function resolvedValues(spec: CommandSpec, draft: CommandDraft): Record<string, string> {
  const out: Record<string, string> = {};
  for (const opt of spec.options) {
    const v = (draft.values[opt.name] ?? "").trim();
    if (!v || opt.kind === "attachment") continue;
    if (!opt.required && !draft.shown.includes(opt.name)) continue;
    const choice = findChoice(opt, v);
    out[opt.name] = choice ? choice.value : v;
  }
  return out;
}

// ---------------------------------------------------------------------------
// People / role / channel pickers
// ---------------------------------------------------------------------------

/** What a conversation offers for user, role and channel options. */
export interface CommandPickerData {
  users: Array<{ id: string; username: string; displayName?: string | null; avatar?: string | null; color?: string }>;
  roles: Array<{ id: string; name: string; color?: string }>;
  channels: Array<{ id: string; name: string }>;
}

export interface PickerEntry {
  /** The option value: a mention token. */
  value: string;
  label: string;
  sub?: string;
  avatar?: string | null;
  color?: string;
  type: "user" | "role" | "channel";
}

function pickerRank(text: string, q: string): number {
  if (!q) return 1;
  const t = text.toLowerCase();
  if (t.startsWith(q)) return 3;
  if (t.split(/[\s_.-]+/).some((w) => w.startsWith(q))) return 2;
  return t.includes(q) ? 1 : 0;
}

/** Entries for a user / role / channel / mentionable option, best matches first. */
export function pickerEntries(kind: CommandOptionKind, data: CommandPickerData, query: string, limit = 25): PickerEntry[] {
  const q = query.trim().toLowerCase().replace(/^[@#]/, "");
  const scored: Array<{ e: PickerEntry; s: number }> = [];
  if (kind === "user" || kind === "mentionable") {
    for (const u of data.users) {
      const label = u.displayName || u.username;
      const s = Math.max(pickerRank(label, q), pickerRank(u.username, q));
      if (s > 0) scored.push({ e: { value: `<@${u.id}>`, label, sub: u.username, avatar: u.avatar ?? null, color: u.color, type: "user" }, s });
    }
  }
  if (kind === "role" || kind === "mentionable") {
    for (const r of data.roles) {
      const s = pickerRank(r.name, q);
      if (s > 0) scored.push({ e: { value: `<@&${r.id}>`, label: r.name, color: r.color, type: "role" }, s });
    }
  }
  if (kind === "channel") {
    for (const c of data.channels) {
      const s = pickerRank(c.name, q);
      if (s > 0) scored.push({ e: { value: `<#${c.id}>`, label: c.name, type: "channel" }, s });
    }
  }
  return scored
    .map((x, i) => ({ ...x, i }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.e);
}

/** A readable label for a stored mention value (`<@id>` → the member's name). */
export function labelForValue(kind: CommandOptionKind, value: string, data: CommandPickerData): string | null {
  const m = /^<(@&|@!?|#)([^>]+)>$/.exec(value.trim());
  if (!m) return null;
  const id = m[2].toLowerCase();
  if (m[1] === "#") return data.channels.find((c) => c.id.toLowerCase() === id)?.name ?? null;
  if (m[1] === "@&") return data.roles.find((r) => r.id.toLowerCase() === id)?.name ?? null;
  if (kind === "role") return null;
  const u = data.users.find((x) => x.id.toLowerCase() === id);
  return u ? u.displayName || u.username : null;
}

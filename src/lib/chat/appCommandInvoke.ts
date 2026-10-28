/**
 * Typed app-command invocations from the composer. The palette lets people
 * type `/cmd sub option:value …`; on send this turns the text into Discord's
 * typed `data.options` (numbers, booleans, choices, user / role / channel
 * ids, uploaded attachments), checks min / max / length / choices / required
 * locally for a quick error, then posts it to /api/interactions/commands,
 * where it is validated again. Pure parsing lives here (tested); the
 * composer calls invokeAppCommandText.
 */
import { OPT, tokenizeInput, type AppLeafCommand } from "@/lib/chat/appCommandContext";
import type { AppCommandOption } from "@/lib/services/appCommands";
import { postInteraction } from "@/lib/chat/interactionEvents";

export interface TypedOption {
  name: string;
  type: number;
  value?: string | number | boolean;
  options?: TypedOption[];
  focused?: boolean;
}

export type BuildResult =
  | { ok: true; leaf: AppLeafCommand; options: TypedOption[]; attachmentOptions: AppCommandOption[] }
  | { ok: false; reason: "not_command" | "missing" | "invalid"; option?: string; leaf?: AppLeafCommand };

const ID = /^(?:\d{1,20}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/** The longest command path the tokens start with. */
export function matchLeaf(tokens: string[], leaves: AppLeafCommand[]): AppLeafCommand | null {
  let best: AppLeafCommand | null = null;
  for (const leaf of leaves) {
    if (tokens.length < leaf.path.length) continue;
    if (leaf.path.every((p, i) => p.toLowerCase() === tokens[i].toLowerCase()) && (!best || leaf.path.length > best.path.length)) best = leaf;
  }
  return best;
}

function mentionId(raw: string, kind: "user" | "role" | "channel" | "mentionable"): string | null {
  const s = raw.trim();
  const m = kind === "channel" ? /^<#([^>]+)>$/.exec(s) : /^<@[!&]?([^>]+)>$/.exec(s);
  const id = (m ? m[1] : s).toLowerCase();
  return ID.test(id) ? id : null;
}

/** Coerce one typed value; null when it isn't valid for the option. */
export function coerceOptionValue(opt: AppCommandOption, raw: string): string | number | boolean | null {
  const choices = opt.choices ?? [];
  if (choices.length) {
    const lower = raw.toLowerCase();
    const hit = choices.find((c) => String(c.value).toLowerCase() === lower) ?? choices.find((c) => c.name.toLowerCase() === lower);
    return hit ? hit.value : null;
  }
  switch (opt.type) {
    case OPT.INTEGER:
    case OPT.NUMBER: {
      const n = Number(raw);
      if (!Number.isFinite(n) || (opt.type === OPT.INTEGER && !Number.isInteger(n))) return null;
      if (opt.min_value !== undefined && n < opt.min_value) return null;
      if (opt.max_value !== undefined && n > opt.max_value) return null;
      return n;
    }
    case OPT.BOOLEAN: {
      const l = raw.toLowerCase();
      if (["true", "yes", "1", "on"].includes(l)) return true;
      if (["false", "no", "0", "off"].includes(l)) return false;
      return null;
    }
    case OPT.USER: return mentionId(raw, "user");
    case OPT.ROLE: return mentionId(raw, "role");
    case OPT.CHANNEL: return mentionId(raw, "channel");
    case OPT.MENTIONABLE: return mentionId(raw, "mentionable");
    case OPT.STRING: {
      if (opt.max_length !== undefined && raw.length > opt.max_length) return null;
      if (opt.min_length !== undefined && raw.length < opt.min_length) return null;
      return raw;
    }
    default:
      return null;
  }
}

/** Assign `name:value` and positional tokens to a leaf's options (last string option takes the rest). */
export function assignOptionTokens(options: AppCommandOption[], tokens: string[]): Map<string, string> {
  const leaves = options.filter((o) => o.type !== OPT.SUB_COMMAND && o.type !== OPT.SUB_COMMAND_GROUP && o.type !== OPT.ATTACHMENT);
  const byName = new Map(leaves.map((o) => [o.name.toLowerCase(), o]));
  const named = new Map<string, string>();
  const positional: string[] = [];
  for (const t of tokens) {
    const sep = t.indexOf(":");
    if (sep > 0 && byName.has(t.slice(0, sep).toLowerCase())) named.set(byName.get(t.slice(0, sep).toLowerCase())!.name, t.slice(sep + 1));
    else positional.push(t);
  }
  const out = new Map<string, string>();
  let pos = 0;
  const unnamed = leaves.filter((o) => !named.has(o.name));
  for (const opt of leaves) {
    if (named.has(opt.name)) { out.set(opt.name, named.get(opt.name)!); continue; }
    if (pos >= positional.length) continue;
    const greedy = opt === unnamed[unnamed.length - 1] && opt.type === OPT.STRING && !opt.choices?.length;
    out.set(opt.name, greedy ? positional.slice(pos).join(" ") : positional[pos]);
    pos += greedy ? positional.length - pos : 1;
  }
  return out;
}

/** Wrap leaf options in their subcommand / group, Discord style. */
export function nestOptions(leaf: AppLeafCommand, options: TypedOption[]): TypedOption[] {
  if (leaf.path.length === 2) return [{ name: leaf.path[1], type: OPT.SUB_COMMAND, options }];
  if (leaf.path.length === 3) return [{ name: leaf.path[1], type: OPT.SUB_COMMAND_GROUP, options: [{ name: leaf.path[2], type: OPT.SUB_COMMAND, options }] }];
  return options;
}

/** Text after "/" → typed options for the matching app command. */
export function buildTypedInvocation(text: string, leaves: AppLeafCommand[]): BuildResult {
  if (!text.startsWith("/")) return { ok: false, reason: "not_command" };
  const tokens = tokenizeInput(text.slice(1));
  const leaf = matchLeaf(tokens, leaves);
  if (!leaf) return { ok: false, reason: "not_command" };
  const assigned = assignOptionTokens(leaf.options, tokens.slice(leaf.path.length));
  const options: TypedOption[] = [];
  for (const opt of leaf.options) {
    if (opt.type === OPT.SUB_COMMAND || opt.type === OPT.SUB_COMMAND_GROUP || opt.type === OPT.ATTACHMENT) continue;
    const raw = assigned.get(opt.name);
    if (raw === undefined || raw === "") {
      if (opt.required) return { ok: false, reason: "missing", option: opt.name, leaf };
      continue;
    }
    const value = coerceOptionValue(opt, raw);
    if (value === null) return { ok: false, reason: "invalid", option: opt.name, leaf };
    options.push({ name: opt.name, type: opt.type, value });
  }
  // Attachment options: required ones always, optional ones when typed as `name:`.
  const rest = tokens.slice(leaf.path.length).map((t) => t.toLowerCase());
  const attachmentOptions = leaf.options.filter((o) => o.type === OPT.ATTACHMENT && (o.required || rest.some((t) => t.startsWith(`${o.name.toLowerCase()}:`))));
  return { ok: true, leaf, options, attachmentOptions };
}

/** Upload one file like a chat attachment (for an attachment option). */
export async function uploadCommandFile(file: File, channelId: string): Promise<Record<string, unknown> | null> {
  const form = new FormData();
  form.append("file", file);
  form.append("channelId", channelId);
  try {
    const res = await fetch("/api/upload/attachment", { method: "POST", body: form, credentials: "include" });
    const data = await res.json().catch(() => null);
    return res.ok && data?.attachment ? (data.attachment as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Ask the user for one file and upload it like a chat attachment. */
export function pickAndUploadFile(channelId: string): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.style.display = "none";
    let settled = false;
    const done = (v: Record<string, unknown> | null) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(v);
    };
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) return done(null);
      done(await uploadCommandFile(file, channelId));
    });
    input.addEventListener("cancel", () => done(null));
    document.body.appendChild(input);
    input.click();
  });
}

export type InvokeOutcome =
  | { status: "not_command" }
  | { status: "sent"; interactionId?: string }
  | { status: "error"; reason: "missing" | "invalid" | "attachment" | "server"; option?: string; code?: string; message?: string };

/**
 * If `text` is one of the app commands in `leaves`, run it with typed options
 * (and ask for files for attachment options). Otherwise "not_command", and the
 * caller sends the text normally (the server's text fallback still applies).
 */
export async function invokeAppCommandText(text: string, channelId: string, leaves: AppLeafCommand[]): Promise<InvokeOutcome> {
  const built = buildTypedInvocation(text.trim(), leaves);
  if (!built.ok) {
    if (built.reason === "not_command") return { status: "not_command" };
    return { status: "error", reason: built.reason, option: built.option };
  }
  const options = [...built.options];
  const attachments: Record<string, unknown>[] = [];
  for (const opt of built.attachmentOptions) {
    const uploaded = await pickAndUploadFile(channelId);
    if (!uploaded) return { status: "error", reason: "attachment", option: opt.name };
    attachments.push(uploaded);
    options.push({ name: opt.name, type: OPT.ATTACHMENT, value: String(uploaded.id) });
  }
  const r = await postInteraction<{ interactionId?: string }>("commands", {
    channelId,
    commandId: built.leaf.commandId,
    options: nestOptions(built.leaf, options),
    ...(attachments.length ? { attachments } : {}),
  });
  if (!r.ok) return { status: "error", reason: "server", code: r.code, message: r.error };
  return { status: "sent", interactionId: r.data?.interactionId };
}

/**
 * Typed options from the command composer's values (by option name, choice
 * names already resolved). Empty values are left out; a missing required or
 * invalid value fails like the text path.
 */
export function typedOptionsFromValues(
  leaf: AppLeafCommand,
  values: Record<string, string>,
): { ok: true; options: TypedOption[] } | { ok: false; reason: "missing" | "invalid"; option: string } {
  const options: TypedOption[] = [];
  for (const opt of leaf.options) {
    if (opt.type === OPT.SUB_COMMAND || opt.type === OPT.SUB_COMMAND_GROUP || opt.type === OPT.ATTACHMENT) continue;
    const raw = (values[opt.name] ?? "").trim();
    if (!raw) {
      if (opt.required) return { ok: false, reason: "missing", option: opt.name };
      continue;
    }
    const value = coerceOptionValue(opt, raw);
    if (value === null) return { ok: false, reason: "invalid", option: opt.name };
    options.push({ name: opt.name, type: opt.type, value });
  }
  return { ok: true, options };
}

/**
 * Run an app command straight from the composer's values and picked files
 * (no text parsing, so quotes and spaces in values survive). Files are
 * uploaded first; the app's answer arrives over the normal streams.
 */
export async function invokeAppCommandValues(
  channelId: string,
  leaf: AppLeafCommand,
  values: Record<string, string>,
  files: Record<string, File>,
): Promise<InvokeOutcome> {
  const built = typedOptionsFromValues(leaf, values);
  if (!built.ok) return { status: "error", reason: built.reason, option: built.option };
  const options = [...built.options];
  const attachments: Record<string, unknown>[] = [];
  for (const opt of leaf.options) {
    if (opt.type !== OPT.ATTACHMENT) continue;
    const file = files[opt.name];
    if (!file) {
      if (opt.required) return { status: "error", reason: "attachment", option: opt.name };
      continue;
    }
    const uploaded = await uploadCommandFile(file, channelId);
    if (!uploaded) return { status: "error", reason: "attachment", option: opt.name, code: "upload_failed" };
    attachments.push(uploaded);
    options.push({ name: opt.name, type: OPT.ATTACHMENT, value: String(uploaded.id) });
  }
  const r = await postInteraction<{ interactionId?: string }>("commands", {
    channelId,
    commandId: leaf.commandId,
    options: nestOptions(leaf, options),
    ...(attachments.length ? { attachments } : {}),
  });
  if (!r.ok) return { status: "error", reason: "server", code: r.code, message: r.error };
  return { status: "sent", interactionId: r.data?.interactionId };
}

/** Run a user / message context-menu command on a target. */
export async function invokeContextCommand(channelId: string, commandId: string, targetId: string): Promise<{ ok: boolean; code?: string }> {
  const r = await postInteraction("commands", { channelId, commandId, targetId });
  return { ok: r.ok, code: r.code };
}

async function requestAutocomplete(channelId: string, leaf: AppLeafCommand, options: TypedOption[]): Promise<Array<{ name: string; value: string | number }>> {
  const r = await postInteraction<{ choices?: Array<{ name: string; value: string | number }> }>("autocomplete", {
    channelId,
    commandId: leaf.commandId,
    options: nestOptions(leaf, options),
  });
  return r.ok && Array.isArray(r.data?.choices) ? r.data!.choices! : [];
}

/** Autocomplete from the command composer's values (the focused option's partial text is sent as typed). */
export async function fetchAutocompleteValues(
  channelId: string,
  leaf: AppLeafCommand,
  values: Record<string, string>,
  focusedName: string,
  partial: string,
): Promise<Array<{ name: string; value: string | number }>> {
  const focused = leaf.options.find((o) => o.name === focusedName);
  if (!focused) return [];
  const options: TypedOption[] = [];
  for (const opt of leaf.options) {
    if (opt.name === focused.name || opt.type === OPT.ATTACHMENT) continue;
    const raw = (values[opt.name] ?? "").trim();
    if (!raw) continue;
    const value = coerceOptionValue(opt, raw);
    if (value !== null) options.push({ name: opt.name, type: opt.type, value });
  }
  options.push({ name: focused.name, type: focused.type, value: partial, focused: true });
  return requestAutocomplete(channelId, leaf, options);
}

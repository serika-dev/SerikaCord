/**
 * Per-conversation slash-command history for the composer's ↑ recall.
 *
 * Rule: in an empty composer, ↑ brings back your last command (with its option
 * values) when running it was your most recent action in this channel or DM,
 * newer than your last normal message. Pressing ↑ again walks back through
 * older commands (last 20), ↓ walks forward and finally back to an empty
 * composer. Otherwise ↑ keeps editing your last message.
 *
 * Entries live in memory and in sessionStorage (per tab, survives reloads);
 * storage failures are ignored. Pure helpers are covered by
 * tests/command-history.test.ts.
 */
import { BoundedMap } from "@/lib/utils/boundedMap";

export interface CommandHistoryEntry {
  /** CommandSpec key (`builtin:roll`, `app:<appId>:<name>`). */
  key: string;
  /** Command name, for display. */
  name: string;
  values: Record<string, string>;
  labels: Record<string, string>;
  shown: string[];
  /** When it was run (client clock, ms). */
  at: number;
}

export const COMMAND_HISTORY_LIMIT = 20;

function sameValues(a: Record<string, string>, b: Record<string, string>): boolean {
  const ka = Object.keys(a).filter((k) => a[k]);
  const kb = Object.keys(b).filter((k) => b[k]);
  return ka.length === kb.length && ka.every((k) => a[k] === b[k]);
}

/** Append (newest last). Re-running the same command moves it to the end instead of duplicating it. */
export function pushCommandHistory(list: CommandHistoryEntry[], entry: CommandHistoryEntry, limit = COMMAND_HISTORY_LIMIT): CommandHistoryEntry[] {
  const rest = list.filter((e) => !(e.key === entry.key && sameValues(e.values, entry.values)));
  rest.push(entry);
  return rest.length > limit ? rest.slice(rest.length - limit) : rest;
}

/**
 * Step through history. `cursor` is an index into the list (newest =
 * length - 1) or null for "not browsing". ↑ from null starts at the newest and
 * stops at the oldest; ↓ past the newest returns null (empty composer).
 */
export function stepCommandHistory(length: number, cursor: number | null, dir: "up" | "down"): number | null {
  if (length <= 0) return null;
  if (dir === "up") return cursor === null ? length - 1 : Math.max(0, Math.min(cursor, length) - 1);
  if (cursor === null) return null;
  return cursor + 1 >= length ? null : cursor + 1;
}

/**
 * Whether ↑ should recall the last command rather than edit the last message.
 * `lastPlainSendAt` is this tab's last normal send (same clock as the command);
 * `lastOwnMessageAt` is the newest own message in the conversation (server
 * time, covers other devices). A message within `toleranceMs` after the
 * command counts as its output (`/me`, `/shrug`, `/tts`).
 */
export function canRecallCommand(input: {
  lastCommandAt: number | null;
  lastPlainSendAt: number | null;
  lastOwnMessageAt: number | null;
  toleranceMs?: number;
}): boolean {
  const { lastCommandAt, lastPlainSendAt, lastOwnMessageAt, toleranceMs = 3000 } = input;
  if (lastCommandAt === null) return false;
  if (lastPlainSendAt !== null && lastPlainSendAt >= lastCommandAt) return false;
  if (lastOwnMessageAt !== null && lastOwnMessageAt > lastCommandAt + toleranceMs) return false;
  return true;
}

/** Newest own (persisted, non-ephemeral) message time in a conversation. */
export function lastOwnMessageAt(
  messages: ReadonlyArray<{ id: string; authorId?: string | null; author?: { id?: string } | null; createdAt?: string; pending?: boolean; ephemeral?: boolean }>,
  userId: string | null | undefined,
): number | null {
  if (!userId) return null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if ((m.author?.id ?? m.authorId) !== userId) continue;
    if (m.ephemeral || m.pending || m.id.startsWith("temp-") || m.id.startsWith("eph-")) continue;
    const t = m.createdAt ? Date.parse(m.createdAt) : NaN;
    if (Number.isFinite(t)) return t;
  }
  return null;
}

/** Entries whose command still exists here (a bot may have left). */
export function recallableHistory(list: CommandHistoryEntry[], availableKeys: ReadonlySet<string>): CommandHistoryEntry[] {
  return list.filter((e) => availableKeys.has(e.key));
}

// ---------------------------------------------------------------------------
// Store (memory + sessionStorage)
// ---------------------------------------------------------------------------

interface StoredHistory {
  entries: CommandHistoryEntry[];
  plainAt: number | null;
}

const PREFIX = "serika:cmdhist:";
const memory = new BoundedMap<string, StoredHistory>(200);

function load(ctx: string): StoredHistory {
  const hit = memory.get(ctx);
  if (hit) return hit;
  let stored: StoredHistory = { entries: [], plainAt: null };
  try {
    const raw = typeof sessionStorage !== "undefined" ? sessionStorage.getItem(PREFIX + ctx) : null;
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<StoredHistory>;
      stored = {
        entries: Array.isArray(parsed.entries) ? parsed.entries.slice(-COMMAND_HISTORY_LIMIT) : [],
        plainAt: typeof parsed.plainAt === "number" ? parsed.plainAt : null,
      };
    }
  } catch { /* storage unavailable or corrupt */ }
  memory.set(ctx, stored);
  return stored;
}

function save(ctx: string, next: StoredHistory) {
  memory.set(ctx, next);
  try {
    sessionStorage.setItem(PREFIX + ctx, JSON.stringify(next));
  } catch { /* storage unavailable or full */ }
}

export function readCommandHistory(ctx: string): CommandHistoryEntry[] {
  return load(ctx).entries;
}

export function readLastPlainSendAt(ctx: string): number | null {
  return load(ctx).plainAt;
}

export function recordCommand(ctx: string, entry: CommandHistoryEntry): void {
  const cur = load(ctx);
  save(ctx, { ...cur, entries: pushCommandHistory(cur.entries, entry) });
}

/** A normal (non-command) message was sent from this composer. */
export function notePlainSend(ctx: string, at = Date.now()): void {
  const cur = load(ctx);
  save(ctx, { ...cur, plainAt: at });
}

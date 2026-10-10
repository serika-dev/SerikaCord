/**
 * Pure helpers for Discord-style threads in text / announcement channels.
 * Shared by the API (src/lib/api/channels.ts, src/lib/services/threads.ts)
 * and the client (thread panel, thread chip, threads browser). No I/O.
 *
 * A thread is a Channel row (type public_thread / private_thread) whose
 * parentId is the channel it was started in. A thread started from a message
 * points back at it (channels.starter_message_id, and messages.thread_id on
 * the starter) so the starter shows the "N Messages ›" chip in the channel.
 */

export type ThreadType = "public_thread" | "private_thread";

/** Inactivity windows (minutes) a thread can auto-archive after, as in Discord. */
export const AUTO_ARCHIVE_DURATIONS = [60, 1440, 4320, 10080] as const;
export type AutoArchiveDuration = (typeof AUTO_ARCHIVE_DURATIONS)[number];
export const DEFAULT_AUTO_ARCHIVE_DURATION: AutoArchiveDuration = 1440;

/** Longest thread name (Discord: 100). */
export const MAX_THREAD_NAME_LENGTH = 100;

/** The chip and browser show at most "50+ Messages", like Discord. */
export const THREAD_COUNT_DISPLAY_CAP = 50;

export function isThreadType(type: unknown): type is ThreadType {
  return type === "public_thread" || type === "private_thread";
}

/** Channels you can start threads in from messages / the header. */
export function canHostThreads(type: unknown): boolean {
  return type === "text" || type === "announcement";
}

/** A valid duration, or `fallback` for anything else (bad input, legacy null). */
export function normalizeAutoArchiveDuration(
  value: unknown,
  fallback: AutoArchiveDuration = DEFAULT_AUTO_ARCHIVE_DURATION,
): AutoArchiveDuration {
  const n = typeof value === "string" ? Number(value) : value;
  return (AUTO_ARCHIVE_DURATIONS as readonly number[]).includes(n as number) ? (n as AutoArchiveDuration) : fallback;
}

/**
 * Default thread name from the starter message: its text with markup and
 * mention tokens flattened, collapsed whitespace, cut at the name limit.
 * Falls back to `fallback` (e.g. "New Thread") when nothing readable is left.
 */
export function defaultThreadName(content: string | null | undefined, fallback = "New Thread"): string {
  const text = String(content ?? "")
    // <@id>, <@&id>, <#id> mention tokens and <:emoji:id> custom emoji
    .replace(/<a?:([a-zA-Z0-9_]+):[^>]+>/g, ":$1:")
    .replace(/<[@#][!&]?[^>]*>/g, "")
    // code fences / inline code / emphasis / spoilers / headings / quotes
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[`*_~|]/g, "")
    .replace(/^\s*(#{1,3}|>+)\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return fallback;
  return text.length > MAX_THREAD_NAME_LENGTH ? text.slice(0, MAX_THREAD_NAME_LENGTH).trimEnd() : text;
}

/** A user-typed thread name, trimmed and length-limited; "" when blank. */
export function cleanThreadName(name: string | null | undefined): string {
  return String(name ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_THREAD_NAME_LENGTH).trim();
}

/** "7" / "50+" for the chip and browser. */
export function formatThreadCount(count: number | null | undefined): string {
  const n = Math.max(0, Math.floor(Number(count) || 0));
  return n > THREAD_COUNT_DISPLAY_CAP ? `${THREAD_COUNT_DISPLAY_CAP}+` : String(n);
}

/**
 * Whether a thread has been idle past its auto-archive window.
 * `lastActivityMs` is the newest message's time (or creation time when empty).
 */
export function isPastAutoArchive(
  lastActivityMs: number,
  durationMinutes: number | null | undefined,
  nowMs: number = Date.now(),
): boolean {
  if (!durationMinutes || !Number.isFinite(lastActivityMs)) return false;
  return nowMs - lastActivityMs >= durationMinutes * 60_000;
}

/** Last message summary carried on a thread for the chip preview. */
export interface ThreadLastMessage {
  id: string;
  content: string;
  createdAt: string;
  author: { id: string; username: string; displayName: string; avatar?: string | null } | null;
}

/** What the channel shows for a thread: on the starter message chip and in the browser. */
export interface ThreadSummary {
  id: string;
  name: string;
  type: ThreadType;
  parentId: string | null;
  ownerId: string | null;
  archived: boolean;
  locked: boolean;
  messageCount: number;
  memberCount: number;
  autoArchiveDuration: number | null;
  archiveTimestamp: string | null;
  createdAt: string | null;
  starterMessageId: string | null;
  lastMessage?: ThreadLastMessage | null;
}

/** Newest activity first: last message time, else creation. */
export function threadActivityMs(t: Pick<ThreadSummary, "createdAt" | "lastMessage">): number {
  const at = t.lastMessage?.createdAt ?? t.createdAt;
  const ms = at ? new Date(at).getTime() : 0;
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * Split threads for the browser: active (not archived) and archived, each
 * newest activity first; joined threads first among the active ones, like
 * Discord's "Joined Threads" / "Other Active Threads" sections.
 */
export function partitionThreads<T extends Pick<ThreadSummary, "archived" | "createdAt" | "lastMessage" | "archiveTimestamp">>(
  threads: readonly T[],
  isJoined: (t: T) => boolean,
): { joined: T[]; other: T[]; archived: T[] } {
  const byActivity = (a: T, b: T) => threadActivityMs(b) - threadActivityMs(a);
  const active = threads.filter((t) => !t.archived).sort(byActivity);
  const archived = threads
    .filter((t) => t.archived)
    .sort((a, b) => {
      const am = a.archiveTimestamp ? new Date(a.archiveTimestamp).getTime() : threadActivityMs(a);
      const bm = b.archiveTimestamp ? new Date(b.archiveTimestamp).getTime() : threadActivityMs(b);
      return bm - am;
    });
  return { joined: active.filter(isJoined), other: active.filter((t) => !isJoined(t)), archived };
}

/** Case-insensitive name filter for the browser search box. */
export function filterThreadsByName<T extends { name: string }>(threads: readonly T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...threads];
  return threads.filter((t) => t.name.toLowerCase().includes(q));
}

/** Clamp the thread side panel width to sensible bounds for the viewport. */
export function clampThreadPanelWidth(width: number, viewportWidth: number): number {
  const min = 360;
  const max = Math.max(min, Math.floor(viewportWidth * 0.6));
  if (!Number.isFinite(width)) return 440;
  return Math.min(max, Math.max(min, Math.round(width)));
}

/** Who is added to a thread when a message lands: the author and anyone @mentioned. */
export function threadMembersToAdd(
  current: readonly string[] | null | undefined,
  authorId: string,
  mentionedUserIds: readonly string[] | null | undefined,
): string[] {
  const have = new Set((current || []).map((id) => id.toLowerCase()));
  const out: string[] = [];
  for (const id of [authorId, ...(mentionedUserIds || [])]) {
    if (!id) continue;
    const key = id.toLowerCase();
    if (have.has(key)) continue;
    have.add(key);
    out.push(id);
  }
  return out;
}

/**
 * Polls (Discord-style), shared by the server and the client.
 *
 *   messages.poll (jsonb)      the poll itself on a poll message (StoredPoll),
 *                              or the closing summary on a `poll_result` row
 *                              (PollResultData)
 *   poll_votes (table)         one row per (message, user, answer)
 *
 * A poll has a question, 1..10 answers (text + optional emoji), an expiry
 * (1h, 4h, 8h, 24h, 3d, 1w) and optionally allows several answers. When it
 * expires (or its author ends it early) it is finalized once: votes freeze and
 * a "poll results" row is posted that links back to it.
 *
 * Everything here is pure so it can be unit tested and run in both places.
 */

export const MAX_POLL_ANSWERS = 10;
export const MAX_POLL_QUESTION_LENGTH = 300;
export const MAX_POLL_ANSWER_LENGTH = 55;

/** Allowed durations, in hours (Discord's set). */
export const POLL_DURATION_HOURS = [1, 4, 8, 24, 72, 168] as const;
export type PollDurationHours = (typeof POLL_DURATION_HOURS)[number];
export const DEFAULT_POLL_DURATION_HOURS: PollDurationHours = 24;

export interface PollEmoji {
  /** Custom emoji id; absent for a unicode emoji. */
  id?: string;
  /** Unicode character, or the custom emoji's name. */
  name: string;
  animated?: boolean;
  url?: string;
}

export interface PollAnswer {
  /** 1-based, stable for the poll's lifetime (Discord's answer_id). */
  id: number;
  text: string;
  emoji?: PollEmoji | null;
}

/** What is stored in messages.poll for a poll message. */
export interface StoredPoll {
  question: string;
  answers: PollAnswer[];
  allowMultiselect: boolean;
  /** ISO timestamp the poll closes at. */
  expiresAt: string;
  /** Set once the poll has been closed and its result row posted. */
  finalizedAt?: string | null;
}

/** A poll as one viewer sees it: the stored poll plus live tallies. */
export interface PollView extends StoredPoll {
  /** answerId -> vote count. */
  counts: Record<number, number>;
  /** Distinct people who voted. */
  totalVoters: number;
  /** The viewer's own answer ids. */
  myVotes: number[];
  /** Closed: expired or ended early. Votes are frozen and results shown. */
  closed: boolean;
}

/** messages.poll on a `poll_result` row: the frozen outcome. */
export interface PollResultData {
  kind: "result";
  pollMessageId: string;
  question: string;
  answers: Array<PollAnswer & { votes: number }>;
  totalVoters: number;
  totalVotes: number;
  /** Answer ids with the most votes (empty when nobody voted). */
  winnerIds: number[];
}

/** The realtime event published when votes change or the poll closes. */
export interface PollUpdateEvent {
  type: "poll_update";
  messageId: string;
  counts: Record<number, number>;
  totalVoters: number;
  /** Who changed their vote, and to what (votes are public, like Discord). */
  userId?: string;
  answerIds?: number[];
  closed?: boolean;
  finalizedAt?: string | null;
}

export type PollInput = {
  question?: unknown;
  answers?: unknown;
  durationHours?: unknown;
  allowMultiselect?: unknown;
};

function cleanText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  // Collapse newlines: questions and answers are single-line in Discord.
  return value.replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim().slice(0, max);
}

const CUSTOM_EMOJI_ID_RE = /^[0-9a-fA-F-]{8,64}$/;

function cleanEmoji(raw: unknown): PollEmoji | null {
  if (!raw || typeof raw !== "object") return null;
  const e = raw as Record<string, unknown>;
  const name = typeof e.name === "string" ? e.name.trim().slice(0, 64) : "";
  if (!name) return null;
  if (typeof e.id === "string" && e.id) {
    if (!CUSTOM_EMOJI_ID_RE.test(e.id)) return null;
    const out: PollEmoji = { id: e.id, name: name.replace(/[^\w-]/g, "").slice(0, 32) || "emoji" };
    if (e.animated === true) out.animated = true;
    if (typeof e.url === "string" && /^https:\/\//.test(e.url) && e.url.length <= 512) out.url = e.url;
    return out;
  }
  // Unicode: a short grapheme cluster, no markup.
  if (name.length > 16 || /[<>]/.test(name)) return null;
  return { name };
}

/**
 * Validate a create-poll request. Returns the poll to store (with an absolute
 * expiry computed from `now`) or a user-facing error.
 */
export function normalizePollInput(
  input: PollInput,
  now: number = Date.now(),
): { poll: StoredPoll } | { error: string } {
  const question = cleanText(input.question, MAX_POLL_QUESTION_LENGTH);
  if (!question) return { error: "The poll needs a question" };
  if (!Array.isArray(input.answers)) return { error: "The poll needs at least one answer" };
  if (input.answers.length > MAX_POLL_ANSWERS) return { error: `A poll can have at most ${MAX_POLL_ANSWERS} answers` };

  const answers: PollAnswer[] = [];
  for (const raw of input.answers) {
    const r = (raw && typeof raw === "object" ? raw : { text: raw }) as Record<string, unknown>;
    const text = cleanText(r.text, MAX_POLL_ANSWER_LENGTH);
    const emoji = cleanEmoji(r.emoji);
    // Blank rows in the composer are simply skipped.
    if (!text) continue;
    answers.push({ id: answers.length + 1, text, ...(emoji ? { emoji } : {}) });
  }
  if (answers.length === 0) return { error: "The poll needs at least one answer" };

  const hours = Number(input.durationHours ?? DEFAULT_POLL_DURATION_HOURS);
  if (!(POLL_DURATION_HOURS as readonly number[]).includes(hours)) return { error: "Invalid poll duration" };

  return {
    poll: {
      question,
      answers,
      allowMultiselect: input.allowMultiselect === true,
      expiresAt: new Date(now + hours * 3600_000).toISOString(),
      finalizedAt: null,
    },
  };
}

/** Read messages.poll of a poll message; null for anything else. */
export function parseStoredPoll(raw: unknown): StoredPoll | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  if (p.kind === "result") return null;
  if (typeof p.question !== "string" || !Array.isArray(p.answers) || typeof p.expiresAt !== "string") return null;
  const answers: PollAnswer[] = [];
  for (const a of p.answers as unknown[]) {
    if (!a || typeof a !== "object") continue;
    const r = a as Record<string, unknown>;
    if (typeof r.id !== "number" || typeof r.text !== "string") continue;
    const emoji = cleanEmoji(r.emoji);
    answers.push({ id: r.id, text: r.text, ...(emoji ? { emoji } : {}) });
  }
  return {
    question: p.question,
    answers,
    allowMultiselect: p.allowMultiselect === true,
    expiresAt: p.expiresAt,
    finalizedAt: typeof p.finalizedAt === "string" ? p.finalizedAt : null,
  };
}

/** Read messages.poll of a `poll_result` row; null for anything else. */
export function parsePollResult(raw: unknown): PollResultData | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  if (p.kind !== "result" || typeof p.pollMessageId !== "string" || typeof p.question !== "string") return null;
  const answers = Array.isArray(p.answers)
    ? (p.answers as Array<Record<string, unknown>>)
        .filter((a) => a && typeof a.id === "number" && typeof a.text === "string")
        .map((a) => {
          const emoji = cleanEmoji(a.emoji);
          return { id: a.id as number, text: a.text as string, votes: Number(a.votes) || 0, ...(emoji ? { emoji } : {}) };
        })
    : [];
  return {
    kind: "result",
    pollMessageId: p.pollMessageId,
    question: p.question,
    answers,
    totalVoters: Number(p.totalVoters) || 0,
    totalVotes: Number(p.totalVotes) || answers.reduce((s, a) => s + a.votes, 0),
    winnerIds: Array.isArray(p.winnerIds) ? (p.winnerIds as unknown[]).filter((n): n is number => typeof n === "number") : [],
  };
}

export function isPollExpired(poll: Pick<StoredPoll, "expiresAt">, now: number = Date.now()): boolean {
  const t = Date.parse(poll.expiresAt);
  return Number.isFinite(t) && t <= now;
}

export function isPollClosed(poll: Pick<StoredPoll, "expiresAt" | "finalizedAt">, now: number = Date.now()): boolean {
  return Boolean(poll.finalizedAt) || isPollExpired(poll, now);
}

/** Combine a stored poll with its tallies for one viewer. */
export function buildPollView(
  poll: StoredPoll,
  counts: Record<number, number>,
  totalVoters: number,
  myVotes: number[],
  now: number = Date.now(),
): PollView {
  const valid = new Set(poll.answers.map((a) => a.id));
  const clean: Record<number, number> = {};
  for (const a of poll.answers) clean[a.id] = Math.max(0, Number(counts[a.id]) || 0);
  return {
    ...poll,
    counts: clean,
    totalVoters: Math.max(0, totalVoters || 0),
    myVotes: myVotes.filter((id) => valid.has(id)),
    closed: isPollClosed(poll, now),
  };
}

/**
 * Validate a vote. An empty list removes the vote. A single-answer poll takes
 * at most one answer; ids must exist; duplicates are dropped.
 */
export function validateVote(
  poll: Pick<StoredPoll, "answers" | "allowMultiselect">,
  answerIds: unknown,
): { answerIds: number[] } | { error: string } {
  if (!Array.isArray(answerIds)) return { error: "Invalid answers" };
  const valid = new Set(poll.answers.map((a) => a.id));
  const ids: number[] = [];
  for (const raw of answerIds) {
    const id = typeof raw === "string" ? Number(raw) : raw;
    if (typeof id !== "number" || !Number.isInteger(id) || !valid.has(id)) return { error: "Invalid answer" };
    if (!ids.includes(id)) ids.push(id);
  }
  if (!poll.allowMultiselect && ids.length > 1) return { error: "This poll only allows one answer" };
  return { answerIds: ids.sort((a, b) => a - b) };
}

/** Total votes cast (a multi-answer voter counts once per answer). */
export function totalVotes(counts: Record<number, number>): number {
  let sum = 0;
  for (const v of Object.values(counts)) sum += Number(v) || 0;
  return sum;
}

/** Whole-number percentage of the votes, like Discord's results bars. */
export function pollPercent(count: number, total: number): number {
  if (!total || total <= 0 || !count) return 0;
  return Math.round((count / total) * 100);
}

/** Answer ids with the most votes; empty when nobody voted. */
export function pollWinners(answers: Pick<PollAnswer, "id">[], counts: Record<number, number>): number[] {
  let best = 0;
  for (const a of answers) best = Math.max(best, Number(counts[a.id]) || 0);
  if (best === 0) return [];
  return answers.filter((a) => (Number(counts[a.id]) || 0) === best).map((a) => a.id);
}

/** The frozen summary stored on the "poll results" row. */
export function buildPollResult(
  pollMessageId: string,
  poll: StoredPoll,
  counts: Record<number, number>,
  totalVoters: number,
): PollResultData {
  const answers = poll.answers.map((a) => ({ ...a, votes: Math.max(0, Number(counts[a.id]) || 0) }));
  return {
    kind: "result",
    pollMessageId,
    question: poll.question,
    answers,
    totalVoters: Math.max(0, totalVoters || 0),
    totalVotes: totalVotes(counts),
    winnerIds: pollWinners(poll.answers, counts),
  };
}

/**
 * Apply a realtime poll_update to a viewer's poll: counts and voter total come
 * from the server, the viewer's own selection only changes when the update is
 * about them (their vote from another tab/device).
 */
export function applyPollUpdate(view: PollView, update: PollUpdateEvent, currentUserId?: string | null): PollView {
  const finalizedAt = update.finalizedAt !== undefined ? update.finalizedAt : view.finalizedAt;
  const next: PollView = {
    ...view,
    counts: { ...update.counts },
    totalVoters: update.totalVoters,
    finalizedAt,
    closed: view.closed || Boolean(update.closed) || Boolean(finalizedAt),
  };
  if (currentUserId && update.userId === currentUserId && Array.isArray(update.answerIds)) {
    next.myVotes = [...update.answerIds];
  }
  return next;
}

/**
 * The local result of the viewer changing their vote (optimistic UI): their
 * old answers lose a vote, the new ones gain one, and the voter count follows.
 */
export function applyLocalVote(view: PollView, answerIds: number[]): PollView {
  const counts = { ...view.counts };
  for (const id of view.myVotes) counts[id] = Math.max(0, (counts[id] || 0) - 1);
  for (const id of answerIds) counts[id] = (counts[id] || 0) + 1;
  const hadVote = view.myVotes.length > 0;
  const hasVote = answerIds.length > 0;
  const totalVoters = Math.max(0, view.totalVoters + (hasVote ? 1 : 0) - (hadVote ? 1 : 0));
  return { ...view, counts, totalVoters, myVotes: [...answerIds] };
}

/** Time left before a poll closes, coarse like Discord ("3d left", "5h left", "12m left"). */
export function pollTimeLeft(
  expiresAt: string,
  now: number = Date.now(),
): { unit: "d" | "h" | "m"; value: number } | null {
  const ms = Date.parse(expiresAt) - now;
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const minutes = Math.ceil(ms / 60_000);
  if (minutes >= 48 * 60) return { unit: "d", value: Math.floor(minutes / (24 * 60)) };
  if (minutes >= 60) return { unit: "h", value: Math.floor(minutes / 60) };
  return { unit: "m", value: Math.max(1, minutes) };
}

/** One-line text for notifications, DM list previews and bot fallbacks. */
export function pollPreviewText(question: string): string {
  return `📊 ${question}`.slice(0, 180);
}

/** Discord v10 poll object, for bots (gateway MESSAGE_CREATE and the bot API). */
export function toDiscordPoll(poll: StoredPoll & Partial<Pick<PollView, "counts" | "myVotes">>) {
  const counts = poll.counts ?? {};
  const mine = new Set(poll.myVotes ?? []);
  return {
    question: { text: poll.question },
    answers: poll.answers.map((a) => ({
      answer_id: a.id,
      poll_media: {
        text: a.text,
        ...(a.emoji ? { emoji: a.emoji.id ? { id: a.emoji.id, name: a.emoji.name, animated: Boolean(a.emoji.animated) } : { id: null, name: a.emoji.name } } : {}),
      },
    })),
    expiry: poll.expiresAt,
    allow_multiselect: poll.allowMultiselect,
    layout_type: 1,
    results: {
      is_finalized: Boolean(poll.finalizedAt),
      answer_counts: poll.answers
        .filter((a) => (Number(counts[a.id]) || 0) > 0)
        .map((a) => ({ id: a.id, count: Number(counts[a.id]) || 0, me_voted: mine.has(a.id) })),
    },
  };
}

/** The allowed duration closest to `hours` (bots may ask for any 1..768h, like Discord). */
export function nearestPollDuration(hours: number): PollDurationHours {
  if (!Number.isFinite(hours)) return DEFAULT_POLL_DURATION_HOURS;
  let best: PollDurationHours = POLL_DURATION_HOURS[0];
  for (const h of POLL_DURATION_HOURS) if (Math.abs(h - hours) < Math.abs(best - hours)) best = h;
  return best;
}

/** A Discord v10 poll create request (bot API `poll` field) as our PollInput. */
export function fromDiscordPollRequest(raw: unknown): PollInput | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const q = r.question && typeof r.question === "object" ? (r.question as Record<string, unknown>).text : r.question;
  const answers = Array.isArray(r.answers)
    ? (r.answers as Array<Record<string, unknown>>).map((a) => {
        const media = (a?.poll_media && typeof a.poll_media === "object" ? a.poll_media : a) as Record<string, unknown>;
        const e = media.emoji && typeof media.emoji === "object" ? (media.emoji as Record<string, unknown>) : null;
        return {
          text: media.text,
          emoji: e ? { ...(typeof e.id === "string" && e.id ? { id: e.id } : {}), name: e.name, ...(e.animated ? { animated: true } : {}) } : null,
        };
      })
    : r.answers;
  return {
    question: q,
    answers,
    durationHours: nearestPollDuration(r.duration === undefined ? DEFAULT_POLL_DURATION_HOURS : Number(r.duration)),
    allowMultiselect: r.allow_multiselect === true,
  };
}

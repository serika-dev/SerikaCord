import { describe, expect, test } from "bun:test";
import {
  applyLocalVote,
  applyPollUpdate,
  buildPollResult,
  buildPollView,
  fromDiscordPollRequest,
  isPollClosed,
  nearestPollDuration,
  normalizePollInput,
  parsePollResult,
  parseStoredPoll,
  pollPercent,
  pollTimeLeft,
  pollWinners,
  toDiscordPoll,
  totalVotes,
  validateVote,
  type StoredPoll,
} from "@/lib/chat/polls";
import { groupMessages, isComposerlessMessage, isStandaloneRow } from "@/lib/chat/messages";
import type { ChatMessage } from "@/lib/chat/types";

const T0 = Date.parse("2026-01-01T12:00:00.000Z");
const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function poll(overrides: Partial<StoredPoll> = {}): StoredPoll {
  return {
    question: "Pizza or tacos?",
    answers: [
      { id: 1, text: "Pizza" },
      { id: 2, text: "Tacos", emoji: { name: "🌮" } },
      { id: 3, text: "Both" },
    ],
    allowMultiselect: false,
    expiresAt: new Date(T0 + 3600_000).toISOString(),
    finalizedAt: null,
    ...overrides,
  };
}

describe("creating a poll", () => {
  test("cleans the question and answers and computes the expiry", () => {
    const r = normalizePollInput(
      { question: "  Best\nfood?  ", answers: [{ text: " Pizza " }, { text: "" }, { text: "Tacos", emoji: { name: "🌮" } }], durationHours: 4, allowMultiselect: true },
      T0,
    );
    expect("poll" in r).toBe(true);
    if (!("poll" in r)) return;
    expect(r.poll.question).toBe("Best food?");
    // Blank rows are skipped and ids stay 1..n.
    expect(r.poll.answers).toEqual([
      { id: 1, text: "Pizza" },
      { id: 2, text: "Tacos", emoji: { name: "🌮" } },
    ]);
    expect(r.poll.allowMultiselect).toBe(true);
    expect(r.poll.expiresAt).toBe(new Date(T0 + 4 * 3600_000).toISOString());
  });

  test("rejects a missing question, no answers, too many answers and odd durations", () => {
    expect(normalizePollInput({ question: " ", answers: [{ text: "a" }] })).toEqual({ error: "The poll needs a question" });
    expect(normalizePollInput({ question: "q", answers: [{ text: " " }] })).toEqual({ error: "The poll needs at least one answer" });
    const eleven = Array.from({ length: 11 }, (_, i) => ({ text: String(i) }));
    expect("error" in normalizePollInput({ question: "q", answers: eleven })).toBe(true);
    expect(normalizePollInput({ question: "q", answers: [{ text: "a" }], durationHours: 5 })).toEqual({ error: "Invalid poll duration" });
  });

  test("defaults to 24 hours and single answer", () => {
    const r = normalizePollInput({ question: "q", answers: ["a"] }, T0);
    if (!("poll" in r)) throw new Error("expected a poll");
    expect(r.poll.allowMultiselect).toBe(false);
    expect(r.poll.expiresAt).toBe(new Date(T0 + 24 * 3600_000).toISOString());
  });

  test("drops unsafe emoji", () => {
    const r = normalizePollInput({ question: "q", answers: [{ text: "a", emoji: { name: "<script>" } }, { text: "b", emoji: { id: "not an id!", name: "x" } }] });
    if (!("poll" in r)) throw new Error("expected a poll");
    expect(r.poll.answers.every((a) => !a.emoji)).toBe(true);
  });
});

describe("parsing stored polls", () => {
  test("round-trips a stored poll and ignores result rows", () => {
    expect(parseStoredPoll(poll())).toEqual(poll());
    expect(parseStoredPoll({ kind: "result", pollMessageId: "x", question: "q" })).toBeNull();
    expect(parseStoredPoll(null)).toBeNull();
    expect(parseStoredPoll({ question: 1 })).toBeNull();
  });
});

describe("voting", () => {
  test("single-answer polls take one answer; ids must exist", () => {
    expect(validateVote(poll(), [2])).toEqual({ answerIds: [2] });
    expect(validateVote(poll(), [])).toEqual({ answerIds: [] });
    expect(validateVote(poll(), [1, 2])).toEqual({ error: "This poll only allows one answer" });
    expect(validateVote(poll(), [9])).toEqual({ error: "Invalid answer" });
    expect(validateVote(poll(), "1")).toEqual({ error: "Invalid answers" });
  });

  test("multi-answer polls take several, deduped and sorted", () => {
    expect(validateVote(poll({ allowMultiselect: true }), [3, 1, 3])).toEqual({ answerIds: [1, 3] });
  });

  test("a local vote moves counts and the voter total", () => {
    const view = buildPollView(poll(), { 1: 2, 2: 1 }, 3, [], T0);
    const voted = applyLocalVote(view, [2]);
    expect(voted.counts).toEqual({ 1: 2, 2: 2, 3: 0 });
    expect(voted.totalVoters).toBe(4);
    expect(voted.myVotes).toEqual([2]);
    const switched = applyLocalVote(voted, [1]);
    expect(switched.counts).toEqual({ 1: 3, 2: 1, 3: 0 });
    expect(switched.totalVoters).toBe(4);
    const removed = applyLocalVote(switched, []);
    expect(removed.counts).toEqual({ 1: 2, 2: 1, 3: 0 });
    expect(removed.totalVoters).toBe(3);
  });

  test("a stream update replaces tallies and only moves my selection when it's mine", () => {
    const view = buildPollView(poll(), {}, 0, [1], T0);
    const other = applyPollUpdate(view, { type: "poll_update", messageId: "m", counts: { 1: 1, 2: 1 }, totalVoters: 2, userId: "someone", answerIds: [2] }, ME);
    expect(other.counts).toEqual({ 1: 1, 2: 1 });
    expect(other.myVotes).toEqual([1]);
    const mine = applyPollUpdate(view, { type: "poll_update", messageId: "m", counts: { 2: 1 }, totalVoters: 1, userId: ME, answerIds: [2] }, ME);
    expect(mine.myVotes).toEqual([2]);
    const closed = applyPollUpdate(view, { type: "poll_update", messageId: "m", counts: {}, totalVoters: 0, closed: true, finalizedAt: "2026-01-01T13:00:00.000Z" }, ME);
    expect(closed.closed).toBe(true);
    expect(closed.finalizedAt).toBe("2026-01-01T13:00:00.000Z");
  });
});

describe("results", () => {
  test("percentages, totals and winners", () => {
    expect(pollPercent(1, 3)).toBe(33);
    expect(pollPercent(0, 0)).toBe(0);
    expect(totalVotes({ 1: 2, 2: 3 })).toBe(5);
    expect(pollWinners(poll().answers, { 1: 2, 2: 2, 3: 1 })).toEqual([1, 2]);
    expect(pollWinners(poll().answers, {})).toEqual([]);
  });

  test("the result row freezes the outcome and parses back", () => {
    const result = buildPollResult("msg-1", poll(), { 2: 3, 1: 1 }, 4);
    expect(result.winnerIds).toEqual([2]);
    expect(result.totalVotes).toBe(4);
    expect(result.answers.find((a) => a.id === 2)?.votes).toBe(3);
    expect(parsePollResult(JSON.parse(JSON.stringify(result)))).toEqual(result);
    expect(parsePollResult(poll())).toBeNull();
  });

  test("closed once expired or finalized", () => {
    expect(isPollClosed(poll(), T0)).toBe(false);
    expect(isPollClosed(poll(), T0 + 3600_000)).toBe(true);
    expect(isPollClosed(poll({ finalizedAt: new Date(T0).toISOString() }), T0)).toBe(true);
    expect(buildPollView(poll(), {}, 0, [], T0 + 7200_000).closed).toBe(true);
  });

  test("time left is coarse like Discord", () => {
    expect(pollTimeLeft(new Date(T0 + 3 * 86400_000).toISOString(), T0)).toEqual({ unit: "d", value: 3 });
    expect(pollTimeLeft(new Date(T0 + 5 * 3600_000 + 60_000).toISOString(), T0)).toEqual({ unit: "h", value: 5 });
    expect(pollTimeLeft(new Date(T0 + 90_000).toISOString(), T0)).toEqual({ unit: "m", value: 2 });
    expect(pollTimeLeft(new Date(T0 - 1).toISOString(), T0)).toBeNull();
  });

  test("a view drops votes for answers that don't exist", () => {
    const view = buildPollView(poll(), { 1: 1, 9: 4 }, 1, [1, 9], T0);
    expect(view.counts).toEqual({ 1: 1, 2: 0, 3: 0 });
    expect(view.myVotes).toEqual([1]);
  });
});

describe("bot API (Discord v10 shape)", () => {
  test("serializes a poll", () => {
    const d = toDiscordPoll({ ...poll(), counts: { 2: 3 }, myVotes: [2] });
    expect(d.question).toEqual({ text: "Pizza or tacos?" });
    expect(d.answers[1]).toEqual({ answer_id: 2, poll_media: { text: "Tacos", emoji: { id: null, name: "🌮" } } });
    expect(d.results.answer_counts).toEqual([{ id: 2, count: 3, me_voted: true }]);
    expect(d.results.is_finalized).toBe(false);
  });

  test("reads a create request and rounds the duration to an allowed one", () => {
    const input = fromDiscordPollRequest({
      question: { text: "Q" },
      answers: [{ poll_media: { text: "A", emoji: { name: "👍" } } }, { poll_media: { text: "B" } }],
      duration: 30,
      allow_multiselect: true,
    });
    const r = normalizePollInput(input!, T0);
    if (!("poll" in r)) throw new Error("expected a poll");
    expect(r.poll.answers.map((a) => a.text)).toEqual(["A", "B"]);
    expect(r.poll.answers[0].emoji).toEqual({ name: "👍" });
    expect(r.poll.allowMultiselect).toBe(true);
    expect(r.poll.expiresAt).toBe(new Date(T0 + 24 * 3600_000).toISOString());
    expect(nearestPollDuration(500)).toBe(168);
    expect(nearestPollDuration(2)).toBe(1);
  });
});

describe("poll rows in the message list", () => {
  const base = { authorId: ME, author: { id: ME, username: "me", displayName: "Me" }, channelId: "c", content: "" };
  test("a poll result row stands alone; a poll groups like a normal message", () => {
    const msgs = [
      { ...base, id: "1", createdAt: new Date(T0).toISOString() },
      { ...base, id: "2", createdAt: new Date(T0 + 1000).toISOString(), poll: buildPollView(poll(), {}, 0, [], T0) },
      { ...base, id: "3", createdAt: new Date(T0 + 2000).toISOString(), type: "poll_result" as const },
      { ...base, id: "4", createdAt: new Date(T0 + 3000).toISOString() },
    ] as ChatMessage[];
    expect(isStandaloneRow(msgs[2])).toBe(true);
    expect(groupMessages(msgs).map((g) => g.messages.map((m) => m.id))).toEqual([["1", "2"], ["3"], ["4"]]);
  });

  test("server-posted messages never replace a pending composer bubble", () => {
    expect(isComposerlessMessage({ type: "default", poll: buildPollView(poll(), {}, 0, [], T0) })).toBe(true);
    expect(isComposerlessMessage({ type: "poll_result" })).toBe(true);
    expect(isComposerlessMessage({ type: "default" })).toBe(false);
  });
});

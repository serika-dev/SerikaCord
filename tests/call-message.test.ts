import { describe, expect, test } from "bun:test";
import {
  callDataEnd,
  callDataJoin,
  callDurationParts,
  callPreviewText,
  describeCallMessage,
  formatCallLength,
  newCallData,
  parseCallData,
} from "@/lib/voice/callMessage";
import { isListenOnlyError, mediaAttempts, mediaOutcome, micIssue } from "@/lib/voice/media";
import { groupMessages } from "@/lib/chat/messages";
import type { ChatMessage } from "@/lib/chat/types";

const ALICE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BOB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const T0 = Date.parse("2026-01-01T12:00:00.000Z");

describe("call message state", () => {
  test("a new call has only the caller, unanswered, not ended", () => {
    const d = newCallData(ALICE, T0);
    expect(d).toEqual({
      callerId: ALICE,
      startedAt: new Date(T0).toISOString(),
      endedAt: null,
      participantIds: [ALICE],
      answered: false,
    });
  });

  test("the other person joining answers the call", () => {
    const d = callDataJoin(newCallData(ALICE, T0), BOB);
    expect(d.answered).toBeTrue();
    expect(d.participantIds).toEqual([ALICE, BOB]);
  });

  test("the caller re-joining (resume, second device) changes nothing", () => {
    const d = newCallData(ALICE, T0);
    expect(callDataJoin(d, ALICE)).toBe(d);
    expect(callDataJoin(d, ALICE.toUpperCase())).toBe(d);
    const answered = callDataJoin(d, BOB);
    expect(callDataJoin(answered, BOB)).toBe(answered);
  });

  test("ending sets endedAt once; joining an ended call is ignored", () => {
    const ended = callDataEnd(newCallData(ALICE, T0), T0 + 90_000);
    expect(ended.endedAt).toBe(new Date(T0 + 90_000).toISOString());
    expect(callDataEnd(ended, T0 + 999_000)).toBe(ended);
    expect(callDataJoin(ended, BOB)).toBe(ended);
  });

  test("endedAt never precedes startedAt (clock skew)", () => {
    const ended = callDataEnd(newCallData(ALICE, T0), T0 - 5_000);
    expect(ended.endedAt).toBe(new Date(T0).toISOString());
  });

  test("parseCallData validates and fills defaults", () => {
    expect(parseCallData(null)).toBeNull();
    expect(parseCallData({ callerId: ALICE })).toBeNull();
    expect(parseCallData({ callerId: ALICE, startedAt: "nope" })).toBeNull();
    expect(parseCallData({ callerId: ALICE, startedAt: new Date(T0).toISOString(), endedAt: "bad" })).toEqual({
      callerId: ALICE,
      startedAt: new Date(T0).toISOString(),
      endedAt: null,
      participantIds: [ALICE],
      answered: false,
    });
  });
});

describe("describeCallMessage", () => {
  const start = newCallData(ALICE, T0);
  const answered = callDataJoin(start, BOB);

  test("ongoing for both sides", () => {
    expect(describeCallMessage(start, ALICE)).toEqual({ kind: "ongoing", viewerIsCaller: true, durationMs: null });
    expect(describeCallMessage(start, BOB).kind).toBe("ongoing");
  });

  test("answered and ended shows the length", () => {
    const v = describeCallMessage(callDataEnd(answered, T0 + 5 * 60_000), BOB);
    expect(v).toEqual({ kind: "ended", viewerIsCaller: false, durationMs: 5 * 60_000 });
  });

  test("unanswered: missed for the callee, unanswered for the caller", () => {
    const ended = callDataEnd(start, T0 + 40_000);
    expect(describeCallMessage(ended, BOB).kind).toBe("missed");
    expect(describeCallMessage(ended, ALICE).kind).toBe("unanswered");
  });

  test("DM list preview text", () => {
    const ended = callDataEnd(start, T0 + 40_000);
    expect(callPreviewText(ended, BOB)).toBe("📞 Missed call");
    expect(callPreviewText(ended, ALICE)).toBe("📞 Call not answered");
    expect(callPreviewText(start, BOB)).toBe("📞 Call started");
    expect(callPreviewText(callDataEnd(answered, T0 + 1000), BOB)).toBe("📞 Call");
    expect(callPreviewText(null)).toBe("📞 Call");
  });
});

describe("call length", () => {
  test("picks the largest sensible unit", () => {
    expect(callDurationParts(0)).toEqual({ value: 1, unit: "second" });
    expect(callDurationParts(45_000)).toEqual({ value: 45, unit: "second" });
    expect(callDurationParts(60_000)).toEqual({ value: 1, unit: "minute" });
    expect(callDurationParts(5 * 60_000 + 20_000)).toEqual({ value: 5, unit: "minute" });
    expect(callDurationParts(59 * 60_000)).toEqual({ value: 59, unit: "minute" });
    expect(callDurationParts(2 * 3_600_000 + 10 * 60_000)).toEqual({ value: 2, unit: "hour" });
  });

  test("formats with Intl units", () => {
    expect(formatCallLength(5 * 60_000, "en")).toBe("5 minutes");
    expect(formatCallLength(1000, "en")).toBe("1 second");
    expect(formatCallLength(3_600_000, "en")).toBe("1 hour");
  });
});

describe("call rows never group", () => {
  const msg = (id: string, authorId: string, min: number, extra: Partial<ChatMessage> = {}): ChatMessage => ({
    id,
    content: "",
    authorId,
    author: { id: authorId, username: "u", displayName: "" },
    channelId: "c",
    createdAt: new Date(T0 + min * 60_000).toISOString(),
    ...extra,
  });

  test("a call row splits a same-author run", () => {
    const groups = groupMessages([
      msg("1", ALICE, 0),
      msg("2", ALICE, 1, { type: "call", call: newCallData(ALICE, T0) }),
      msg("3", ALICE, 2),
    ]);
    expect(groups.map((g) => g.messages.map((m) => m.id))).toEqual([["1"], ["2"], ["3"]]);
  });
});

describe("listen-only media decision", () => {
  test("tries mic+camera, then mic, then camera alone", () => {
    expect(mediaAttempts(true)).toEqual([
      { audio: true, video: true },
      { audio: true, video: false },
      { audio: false, video: true },
    ]);
    expect(mediaAttempts(false)).toEqual([{ audio: true, video: false }]);
  });

  test("device problems allow listen-only; other failures don't", () => {
    for (const name of ["NotFoundError", "NotAllowedError", "NotReadableError", "OverconstrainedError"]) {
      expect(isListenOnlyError({ name })).toBeTrue();
    }
    expect(isListenOnlyError({ name: "TypeError" })).toBeFalse();
    expect(isListenOnlyError({ name: "SecurityError" })).toBeFalse();
    expect(isListenOnlyError(null)).toBeFalse();
  });

  test("explains why there's no mic", () => {
    expect(micIssue({ name: "NotFoundError" })).toBe("mic-missing");
    expect(micIssue({ name: "NotReadableError" })).toBe("mic-busy");
    expect(micIssue({ name: "NotAllowedError" })).toBe("mic-denied");
  });

  test("outcome: listen-only without audio; camera notice only when the mic worked", () => {
    expect(mediaOutcome({ wantVideo: false, gotAudio: false, gotVideo: false })).toEqual({ listenOnly: true, cameraMissing: false });
    expect(mediaOutcome({ wantVideo: true, gotAudio: false, gotVideo: true })).toEqual({ listenOnly: true, cameraMissing: false });
    expect(mediaOutcome({ wantVideo: true, gotAudio: true, gotVideo: false })).toEqual({ listenOnly: false, cameraMissing: true });
    expect(mediaOutcome({ wantVideo: true, gotAudio: true, gotVideo: true })).toEqual({ listenOnly: false, cameraMissing: false });
  });
});

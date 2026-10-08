import { describe, expect, test } from "bun:test";
import {
  callAlertPlan,
  callPanelPeople,
  callReducer,
  IDLE,
  MIN_RING_VOLUME,
  ringVolume,
  RING_TIMEOUT_MS,
  shouldPlayRingback,
} from "@/lib/voice/callState";
import {
  callDataDecline,
  callDataEnd,
  callDataJoin,
  callPreviewText,
  describeCallMessage,
  isGroupCallData,
  missedCallRecipients,
  newCallData,
  parseCallData,
} from "@/lib/voice/callMessage";
import {
  groupCallChannelId,
  groupCallRingTargets,
  groupCallRoomId,
  isGroupCallMember,
  parseVoiceRoomId,
} from "@/lib/voice/rooms";
import { callConversationHref, dmCallRoomId, groupDisplayName, isGroupCallRoom } from "@/lib/chat/dmCall";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
const D = "44444444-4444-4444-8444-444444444444";
const G = "99999999-9999-4999-8999-999999999999";
const T0 = Date.parse("2026-01-01T12:00:00.000Z");

describe("ring volume", () => {
  test("follows the notification volume with a floor", () => {
    expect(ringVolume(1)).toBe(1);
    expect(ringVolume(0.8)).toBe(0.8);
    expect(ringVolume(0)).toBe(MIN_RING_VOLUME);
    expect(ringVolume(0.05)).toBe(MIN_RING_VOLUME);
    expect(ringVolume(5)).toBe(1);
    expect(ringVolume(Number.NaN)).toBe(0.5);
  });
});

describe("callAlertPlan", () => {
  const base = { dnd: false, desktopEnabled: true, toastsEnabled: true, focused: true };

  test("DND silences every alert", () => {
    expect(callAlertPlan({ ...base, dnd: true, focused: false })).toEqual({ desktop: false, toast: false, flashTitle: false });
  });

  test("background: desktop notification + flashing title, no toast", () => {
    expect(callAlertPlan({ ...base, focused: false })).toEqual({ desktop: true, toast: false, flashTitle: true });
  });

  test("foreground: toast only, unless the ring was blocked", () => {
    expect(callAlertPlan(base)).toEqual({ desktop: false, toast: true, flashTitle: false });
    expect(callAlertPlan({ ...base, soundBlocked: true }).desktop).toBeTrue();
  });

  test("the desktop and toast switches are respected", () => {
    expect(callAlertPlan({ ...base, focused: false, desktopEnabled: false }).desktop).toBeFalse();
    expect(callAlertPlan({ ...base, toastsEnabled: false }).toast).toBeFalse();
  });
});

describe("group call rooms", () => {
  test("ids round-trip and are lower-cased", () => {
    const room = groupCallRoomId(G.toUpperCase());
    expect(room).toBe(`gdm:${G}`);
    expect(parseVoiceRoomId(room)).toEqual({ kind: "group", channelId: G });
    expect(groupCallChannelId(room)).toBe(G);
    expect(isGroupCallRoom(room)).toBeTrue();
    expect(isGroupCallRoom(dmCallRoomId(A, B))).toBeFalse();
    expect(groupCallChannelId(dmCallRoomId(A, B))).toBeNull();
    expect(parseVoiceRoomId("gdm:not-a-uuid")).toBeNull();
    expect(parseVoiceRoomId(`gdm:${G}_${A}`)).toBeNull();
  });

  test("only current members of a group DM may use its call", () => {
    const group = { type: "group_dm", recipientIds: [A, B, C] };
    expect(isGroupCallMember(group, A)).toBeTrue();
    expect(isGroupCallMember(group, C.toUpperCase())).toBeTrue();
    expect(isGroupCallMember(group, D)).toBeFalse();
    expect(isGroupCallMember({ type: "dm", recipientIds: [A, B] }, A)).toBeFalse();
    expect(isGroupCallMember({ type: "text", recipientIds: [A] }, A)).toBeFalse();
    expect(isGroupCallMember(null, A)).toBeFalse();
    expect(isGroupCallMember(group, "")).toBeFalse();
  });

  test("everyone but the caller is rung, once", () => {
    expect(groupCallRingTargets([A, B, C, B.toUpperCase()], A)).toEqual([B, C]);
    expect(groupCallRingTargets([A], A)).toEqual([]);
    expect(groupCallRingTargets(null, A)).toEqual([]);
  });

  test("display name: own name, else the members", () => {
    expect(groupDisplayName("Raid night", ["Bob"])).toBe("Raid night");
    expect(groupDisplayName("Group DM", ["Bob", "Carol"])).toBe("Bob, Carol");
    expect(groupDisplayName(null, ["Bob", "Carol", "Dan", "Eve", "Fay"])).toBe("Bob, Carol, Dan +2");
    expect(groupDisplayName("", [])).toBe("Group");
  });

  test("calls open their conversation", () => {
    const caller = { id: B };
    expect(callConversationHref({ caller })).toBe(`/dm/${B}`);
    expect(callConversationHref({ caller, group: { channelId: G, name: "x", icon: null } })).toBe("/channels/me");
  });
});

describe("group call lifecycle", () => {
  const ROOM = groupCallRoomId(G);
  const start = (now = 1000) =>
    callReducer(IDLE, { type: "start", roomId: ROOM, peerId: G, direction: "outgoing", now, group: true });

  test("anyone joining connects it", () => {
    const s = callReducer(start(), { type: "participants", roomId: ROOM, others: [C], now: 2000 });
    expect(s.phase).toBe("connected");
    expect(shouldPlayRingback(s)).toBeFalse();
  });

  test("others leaving never ends it; only I can", () => {
    let s = callReducer(start(), { type: "participants", roomId: ROOM, others: [B, C], now: 2000 });
    s = callReducer(s, { type: "participants", roomId: ROOM, others: [], now: 3000 });
    expect(s.phase).toBe("connected");
    s = callReducer(s, { type: "hangup" });
    expect(s.phase !== "idle" && s.endReason).toBe("hangup");
  });

  test("one member declining doesn't end it for the caller", () => {
    const s0 = start();
    expect(callReducer(s0, { type: "declined", roomId: ROOM })).toBe(s0);
  });

  test("nobody answering still times out", () => {
    const s = callReducer(start(1000), { type: "tick", now: 1000 + RING_TIMEOUT_MS });
    expect(s.phase !== "idle" && s.endReason).toBe("no-answer");
  });

  test("the call panel lists me, the members, then late joiners, without repeats", () => {
    const people = callPanelPeople(
      { id: A, name: "Me" },
      [{ id: B, name: "Bob" }, { id: A, name: "Me again" }],
      [{ userId: B.toUpperCase(), displayName: "Bob" }, { userId: D, username: "dan" }],
    );
    expect(people.map((p) => p.id)).toEqual([A, B, D]);
    expect(people[2].name).toBe("dan");
  });
});

describe("missed calls", () => {
  test("1:1: the callee missed an unanswered call, not one they declined", () => {
    const ended = callDataEnd(newCallData(A, T0), T0 + 30_000);
    expect(missedCallRecipients(ended, [A, B])).toEqual([B]);
    const declined = callDataEnd(callDataDecline(newCallData(A, T0), B), T0 + 5_000);
    expect(missedCallRecipients(declined, [A, B])).toEqual([]);
    expect(describeCallMessage(declined, B).kind).toBe("declined");
    expect(describeCallMessage(declined, A).kind).toBe("unanswered");
    expect(callPreviewText(declined, B)).toBe("📞 Declined call");
  });

  test("1:1: an answered call, or one still going, was missed by nobody", () => {
    const answered = callDataEnd(callDataJoin(newCallData(A, T0), B), T0 + 60_000);
    expect(missedCallRecipients(answered, [A, B])).toEqual([]);
    expect(missedCallRecipients(newCallData(A, T0), [A, B])).toEqual([]);
  });

  test("decline is ignored for the caller, people already in the call, repeats, and ended calls", () => {
    const d = newCallData(A, T0);
    expect(callDataDecline(d, A)).toBe(d);
    const joined = callDataJoin(d, B);
    expect(callDataDecline(joined, B)).toBe(joined);
    const once = callDataDecline(d, C);
    expect(callDataDecline(once, C)).toBe(once);
    const ended = callDataEnd(d, T0);
    expect(callDataDecline(ended, B)).toBe(ended);
  });

  test("group: everyone who never joined or declined missed it, even if others talked", () => {
    let d = newCallData(A, T0, [A, B, C, D]);
    expect(isGroupCallData(d)).toBeTrue();
    d = callDataJoin(d, B);
    d = callDataDecline(d, C);
    d = callDataEnd(d, T0 + 120_000);
    expect(missedCallRecipients(d)).toEqual([D]);
    expect(describeCallMessage(d, A).kind).toBe("ended");
    expect(describeCallMessage(d, B).kind).toBe("ended");
    expect(describeCallMessage(d, C).kind).toBe("declined");
    expect(describeCallMessage(d, D).kind).toBe("missed");
    expect(callPreviewText(d, D)).toBe("📞 Missed call");
  });

  test("group: nobody answering means every member but the caller missed it", () => {
    const d = callDataEnd(newCallData(A, T0, [A, B, C]), T0 + 40_000);
    expect(missedCallRecipients(d)).toEqual([B, C]);
    expect(describeCallMessage(d, A).kind).toBe("unanswered");
    expect(describeCallMessage(d, B).kind).toBe("missed");
  });

  test("group data survives the database round trip; 1:1 data keeps its old shape", () => {
    const d = callDataDecline(newCallData(A, T0, [A, B, C]), C);
    expect(parseCallData(JSON.parse(JSON.stringify(d)))).toEqual(d);
    const plain = newCallData(A, T0);
    expect(Object.keys(plain).sort()).toEqual(["answered", "callerId", "endedAt", "participantIds", "startedAt"]);
    expect(parseCallData(plain)).toEqual(plain);
  });
});

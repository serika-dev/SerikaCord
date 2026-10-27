import { describe, expect, test } from "bun:test";
import {
  parseJoinRequestAction,
  parseJoinRequestListQuery,
  serikaStatusesFor,
  toDiscordJoinRequest,
  toFormResponses,
  toJoinRequestStatus,
} from "@/lib/botapi/guildJoinRequestRules";
import type { ApplicationQuestion } from "@/lib/servers/community";

const row = {
  id: "11111111-1111-4111-8111-111111111111",
  serverId: "22222222-2222-4222-8222-222222222222",
  userId: "33333333-3333-4333-8333-333333333333",
  status: "pending",
  answers: [],
  rejectionReason: null,
  processedAt: null,
  processedBy: null,
  createdAt: new Date("2026-10-01T10:00:00Z"),
};

describe("statuses", () => {
  test("map both ways", () => {
    expect(toJoinRequestStatus("pending")).toBe("SUBMITTED");
    expect(toJoinRequestStatus("interviewed")).toBe("SUBMITTED");
    expect(toJoinRequestStatus("approved")).toBe("APPROVED");
    expect(toJoinRequestStatus("rejected")).toBe("REJECTED");
    expect(serikaStatusesFor("SUBMITTED")).toEqual(["pending", "interviewed"]);
    expect(serikaStatusesFor("STARTED")).toEqual([]);
    expect(serikaStatusesFor(null)).toBeNull();
  });
});

describe("toDiscordJoinRequest", () => {
  test("pending request", () => {
    const r = toDiscordJoinRequest(row, { user: { id: row.userId } });
    expect(r.application_status).toBe("SUBMITTED");
    expect(r.reviewed_at).toBeNull();
    expect(r.rejection_reason).toBeNull();
    expect(r.actioned_by_user).toBeNull();
    expect(r.created_at).toBe("2026-10-01T10:00:00.000Z");
    expect(r.guild_id).toBe(row.serverId);
    expect(r.user_id).toBe(row.userId);
  });

  test("rejected request carries the reason and reviewer", () => {
    const r = toDiscordJoinRequest(
      { ...row, status: "rejected", rejectionReason: "spam", processedAt: "2026-10-02T00:00:00Z", processedBy: "x" },
      { actionedBy: { id: "x" } },
    );
    expect(r.application_status).toBe("REJECTED");
    expect(r.rejection_reason).toBe("spam");
    expect(r.reviewed_at).toBe("2026-10-02T00:00:00.000Z");
    expect(r.actioned_by_user).toEqual({ id: "x" });
  });
});

describe("toFormResponses", () => {
  const questions: ApplicationQuestion[] = [
    { id: "q1", type: "short", label: "Name", required: true, choices: [] },
    { id: "q2", type: "paragraph", label: "Why", required: false, choices: [] },
    { id: "q3", type: "choice", label: "Pick", required: true, choices: ["A &amp; B", "C"] },
  ];
  test("types fields from the screening questions", () => {
    const out = toFormResponses(
      [
        { questionId: "q1", question: "Name", answer: "Ann" },
        { questionId: "q2", question: "Why", answer: "fun &lt;3" },
        { questionId: "q3", question: "Pick", answer: "A &amp; B" },
        { question: "Legacy", answer: "free form" },
      ],
      { rules: ["Be nice"], questions, decode: (s) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<") },
    );
    expect(out[0]).toEqual({ field_type: "TERMS", label: "Read and agree to the server rules", required: true, values: ["Be nice"], response: true });
    expect(out[1]).toMatchObject({ field_type: "TEXT_INPUT", label: "Name", response: "Ann", required: true });
    expect(out[2]).toMatchObject({ field_type: "PARAGRAPH", response: "fun <3" });
    expect(out[3]).toMatchObject({ field_type: "MULTIPLE_CHOICE", choices: ["A & B", "C"], response: 0 });
    expect(out[4]).toMatchObject({ field_type: "TEXT_INPUT", label: "Legacy", response: "free form", required: false });
  });
  test("no rules, no answers", () => {
    expect(toFormResponses(null, { rules: [], questions: [] })).toEqual([]);
  });
});

describe("parsing", () => {
  test("list query", () => {
    const ok = parseJoinRequestListQuery({ status: "submitted", limit: "10", after: "abc" });
    expect(ok).toEqual({ ok: true, status: "SUBMITTED", limit: 10, before: null, after: "abc" });
    expect(parseJoinRequestListQuery({ limit: "0" }).ok).toBe(false);
    expect(parseJoinRequestListQuery({ limit: "101" }).ok).toBe(false);
    expect(parseJoinRequestListQuery({ status: "WAITING" }).ok).toBe(false);
    const d = parseJoinRequestListQuery({});
    expect(d.ok && d.limit).toBe(100);
  });

  test("action body", () => {
    expect(parseJoinRequestAction({ action: "APPROVED", rejection_reason: "ignored" })).toEqual({ ok: true, action: "APPROVED", rejectionReason: null });
    expect(parseJoinRequestAction({ action: "REJECTED", rejection_reason: " too new " })).toEqual({ ok: true, action: "REJECTED", rejectionReason: "too new" });
    expect(parseJoinRequestAction({}).ok).toBe(false);
    expect(parseJoinRequestAction({ action: "SUBMITTED" }).ok).toBe(false);
    expect(parseJoinRequestAction({ action: "REJECTED", rejection_reason: "x".repeat(161) }).ok).toBe(false);
  });
});

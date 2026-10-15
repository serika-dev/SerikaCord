import { describe, expect, test } from "bun:test";
import {
  REPORT_PAGE_SIZE,
  canTransitionReport,
  defaultActionReason,
  groupReportsByMessage,
  groupStatus,
  isAccountAction,
  isLegacyMessageReportRow,
  isEnforcementAction,
  legacyReportStatus,
  normalizeReportFilters,
  parseLegacyMessageReport,
  reportExcerpt,
  reportsToTransition,
  shouldBlurReportMedia,
  statusAfterAction,
  strikeCategoryForReport,
} from "@/lib/safety/messageReports";
import { STAFF_PERMISSIONS } from "@/lib/staff/permissions";

const M1 = "11111111-1111-4111-8111-111111111111";
const M2 = "22222222-2222-4222-8222-222222222222";
const row = (id: string, messageId: string, status: string, category: string, reporterId: string, createdAt: string) =>
  ({ id, messageId, status, category, reporterId, createdAt });

describe("report filters", () => {
  test("defaults to the open queue, newest first", () => {
    expect(normalizeReportFilters({})).toEqual({ status: "open", category: "all", scope: "all", encrypted: "any", sort: "newest", q: "", page: 1 });
  });

  test("keeps valid values and drops unknown ones", () => {
    const f = normalizeReportFilters({ status: "dismissed", category: "self_harm", scope: "dm", encrypted: "yes", sort: "oldest", q: "  alice ", page: "3" });
    expect(f).toEqual({ status: "dismissed", category: "self_harm", scope: "dm", encrypted: "yes", sort: "oldest", q: "alice", page: 3 });
    const bad = normalizeReportFilters({ status: "deleted", category: "sexual", scope: "guild", encrypted: "maybe", sort: "random", page: "-2" });
    expect(bad).toEqual({ status: "open", category: "all", scope: "all", encrypted: "any", sort: "newest", q: "", page: 1 });
  });

  test("clamps the page and the search length", () => {
    expect(normalizeReportFilters({ page: "abc" }).page).toBe(1);
    expect(normalizeReportFilters({ page: "99999999" }).page).toBe(10_000);
    expect(normalizeReportFilters({ q: "x".repeat(300) }).q.length).toBe(100);
    expect(REPORT_PAGE_SIZE).toBeGreaterThan(0);
  });
});

describe("status transitions", () => {
  test("open reports can be resolved or dismissed", () => {
    expect(canTransitionReport("open", "resolved")).toBe(true);
    expect(canTransitionReport("open", "dismissed")).toBe(true);
    expect(canTransitionReport("open", "open")).toBe(false);
  });

  test("a decision is changed by reopening first", () => {
    expect(canTransitionReport("resolved", "open")).toBe(true);
    expect(canTransitionReport("dismissed", "open")).toBe(true);
    expect(canTransitionReport("resolved", "dismissed")).toBe(false);
    expect(canTransitionReport("dismissed", "resolved")).toBe(false);
    expect(canTransitionReport("bogus", "open")).toBe(false);
  });

  test("actions map to statuses", () => {
    expect(statusAfterAction("dismiss")).toBe("dismissed");
    expect(statusAfterAction("resolve")).toBe("resolved");
    expect(statusAfterAction("reopen")).toBe("open");
    for (const a of ["delete_message", "strike", "restrict", "suspend"] as const) {
      expect(statusAfterAction(a)).toBe("resolved");
      expect(isEnforcementAction(a)).toBe(true);
    }
    expect(isEnforcementAction("resolve")).toBe(false);
    expect(isAccountAction("delete_message")).toBe(false);
    expect(isAccountAction("strike")).toBe(true);
  });

  test("only the reports that can move are moved", () => {
    const rows = [row("a", M1, "open", "spam", "u1", "2026-01-01"), row("b", M1, "dismissed", "spam", "u2", "2026-01-02")];
    expect(reportsToTransition(rows, "resolved").map((r) => r.id)).toEqual(["a"]);
    expect(reportsToTransition(rows, "open").map((r) => r.id)).toEqual(["b"]);
    expect(reportsToTransition(rows, null)).toEqual([]);
  });
});

describe("grouping duplicates", () => {
  const rows = [
    row("a", M1, "open", "spam", "u1", "2026-01-01T10:00:00Z"),
    row("b", M1.toUpperCase(), "open", "harassment", "u2", "2026-01-03T10:00:00Z"),
    row("c", M1, "dismissed", "harassment", "u2", "2026-01-02T10:00:00Z"),
    row("d", M2, "resolved", "nsfw", "u3", "2026-01-02T12:00:00Z"),
  ];

  test("one entry per message with counts and categories by frequency", () => {
    const groups = groupReportsByMessage(rows);
    expect(groups.length).toBe(2);
    const g1 = groups[0];
    expect(g1.reports.map((r) => r.id)).toEqual(["b", "c", "a"]);
    expect(g1.count).toBe(3);
    expect(g1.openCount).toBe(2);
    expect(g1.reporterCount).toBe(2);
    expect(g1.categories).toEqual(["harassment", "spam"]);
    expect(g1.status).toBe("open");
    expect(groups[1].status).toBe("resolved");
  });

  test("sorts by newest report or by oldest report", () => {
    expect(groupReportsByMessage(rows, "newest").map((g) => g.messageId.toLowerCase())).toEqual([M1, M2]);
    expect(groupReportsByMessage(rows, "oldest").map((g) => g.messageId.toLowerCase())).toEqual([M1, M2]);
    const later = [...rows, row("e", M2, "open", "nsfw", "u4", "2025-12-01T00:00:00Z")];
    expect(groupReportsByMessage(later, "oldest")[0].messageId).toBe(M2);
  });

  test("group status: open beats resolved beats dismissed", () => {
    expect(groupStatus([{ status: "dismissed" }, { status: "open" }])).toBe("open");
    expect(groupStatus([{ status: "dismissed" }, { status: "resolved" }])).toBe("resolved");
    expect(groupStatus([{ status: "dismissed" }])).toBe("dismissed");
    expect(groupStatus([])).toBe("open");
  });
});

describe("report → enforcement suggestions", () => {
  test("strike categories", () => {
    expect(strikeCategoryForReport("nsfw")).toBe("nsfw");
    expect(strikeCategoryForReport("spam")).toBe("spam");
    expect(strikeCategoryForReport("self_harm")).toBe("other");
    expect(strikeCategoryForReport("whatever")).toBe("other");
  });

  test("default reasons never mention the reporter", () => {
    for (const r of ["spam", "harassment", "hate", "nsfw", "self_harm", "illegal", "impersonation", "other"]) {
      const reason = defaultActionReason(r);
      expect(reason.length).toBeGreaterThan(10);
      expect(reason.toLowerCase()).not.toContain("report");
    }
  });

  test("sensitive categories blur media", () => {
    expect(shouldBlurReportMedia(["spam", "nsfw"])).toBe(true);
    expect(shouldBlurReportMedia(["self_harm"])).toBe(true);
    expect(shouldBlurReportMedia(["spam", "hate"])).toBe(false);
  });

  test("excerpts collapse whitespace and truncate", () => {
    expect(reportExcerpt("  hello\n\n world  ")).toBe("hello world");
    const long = reportExcerpt("a".repeat(500), 20);
    expect(long.length).toBe(20);
    expect(long.endsWith("…")).toBe(true);
    expect(reportExcerpt(null)).toBe("");
  });
});

describe("legacy bug-report message reports", () => {
  const description = [
    "Reason: harassment",
    "Details: they keep DMing me",
    `Message: ${M1}`,
    `Channel: ${M2} (#general [old]) [text]`,
    "Server: 33333333-3333-4333-8333-333333333333",
    "Author: 44444444-4444-4444-8444-444444444444 (@bob)",
    "Sent: 2026-01-01T10:00:00.000Z",
    "",
    "Content:",
    "first line",
    "Reason: not a field",
  ].join("\n");

  test("parses the fields the old route wrote", () => {
    const parsed = parseLegacyMessageReport("Message report: harassment", description);
    expect(parsed).not.toBeNull();
    expect(parsed!.reason).toBe("harassment");
    expect(parsed!.details).toBe("they keep DMing me");
    expect(parsed!.messageId).toBe(M1);
    expect(parsed!.channelId).toBe(M2);
    expect(parsed!.channelName).toBe("general [old]");
    expect(parsed!.channelType).toBe("text");
    expect(parsed!.serverId).toBe("33333333-3333-4333-8333-333333333333");
    expect(parsed!.authorId).toBe("44444444-4444-4444-8444-444444444444");
    expect(parsed!.encrypted).toBe(false);
    expect(parsed!.content).toBe("first line\nReason: not a field");
  });

  test("reads the franking lines of encrypted reports", () => {
    const enc = [
      "Reason: nsfw",
      `Message: ${M1}`,
      `Channel: ${M2} [dm]`,
      "Author: 44444444-4444-4444-8444-444444444444",
      "Sent: unknown",
      "End-to-end encrypted message: content verified by message franking (commitment, decryption and sender device signature).",
      "Encrypted attachment: a.png (image/png, 10 bytes): scanned, no match",
      "",
      "Content:",
      "(no text)",
    ].join("\n");
    const parsed = parseLegacyMessageReport("Message report: nsfw", enc)!;
    expect(parsed.encrypted).toBe(true);
    expect(parsed.channelName).toBeNull();
    expect(parsed.channelType).toBe("dm");
    expect(parsed.sentAt).toBeNull();
    expect(parsed.attachmentNotes).toEqual(["a.png (image/png, 10 bytes): scanned, no match"]);
    expect(parsed.content).toBe("");
  });

  test("ignores ordinary bug reports and malformed ones", () => {
    expect(parseLegacyMessageReport("Crash on login", description)).toBeNull();
    expect(parseLegacyMessageReport("Message report: spam", "Reason: spam\nMessage: nope")).toBeNull();
  });

  test("rejects multi-line details and details that forge the header", () => {
    const multi = description.replace("Details: they keep DMing me", "Details: line one\nline two");
    expect(parseLegacyMessageReport("Message report: harassment", multi)).toBeNull();
    const forged = [
      "Reason: harassment",
      `Details: hi`,
      "Message: 55555555-5555-4555-8555-555555555555",
      `Channel: ${M2} [text]`,
      "Author: 66666666-6666-4666-8666-666666666666",
      "Sent: unknown",
      "",
      "Content:",
      "fake evidence",
      `Message: ${M1}`,
      `Channel: ${M2} [text]`,
      "Author: 44444444-4444-4444-8444-444444444444",
      "Sent: unknown",
      "",
      "Content:",
      "real content",
    ].join("\n");
    expect(parseLegacyMessageReport("Message report: harassment", forged)).toBeNull();
  });

  test("only rows the old report route wrote count as message reports", () => {
    const base = { kind: "bug", category: "security", title: "Message report: spam" };
    expect(isLegacyMessageReportRow({ ...base, priority: "medium" })).toBe(true);
    expect(isLegacyMessageReportRow({ ...base, priority: "high" })).toBe(true);
    expect(isLegacyMessageReportRow({ ...base, priority: "low" })).toBe(false);
    expect(isLegacyMessageReportRow({ ...base, priority: "medium", kind: "feedback" })).toBe(false);
    expect(isLegacyMessageReportRow({ ...base, priority: "medium", category: "crash" })).toBe(false);
    expect(isLegacyMessageReportRow({ ...base, priority: "medium", title: "Crash" })).toBe(false);
  });

  test("maps old statuses", () => {
    expect(legacyReportStatus("open")).toBe("open");
    expect(legacyReportStatus("acknowledged")).toBe("open");
    expect(legacyReportStatus("resolved")).toBe("resolved");
    expect(legacyReportStatus("wont_fix")).toBe("dismissed");
  });
});

describe("staff permission", () => {
  test("reports.review exists", () => {
    expect(STAFF_PERMISSIONS).toContain("reports.review");
  });
});

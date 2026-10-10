import { describe, expect, test } from "bun:test";
import {
  AuditLogEvent,
  auditReason,
  auditTargetKind,
  auditVerb,
  diffChanges,
  diffMemberRoles,
  diffOverwrites,
  isAuditLogEventType,
  legacyAdminLogToAudit,
  mergeAuditEntries,
  snapshotChanges,
  type AuditEntryShape,
} from "@/lib/audit/auditLog";

describe("audit log event types", () => {
  test("use Discord's numbers", () => {
    expect(AuditLogEvent.GUILD_UPDATE).toBe(1);
    expect(AuditLogEvent.MEMBER_KICK).toBe(20);
    expect(AuditLogEvent.MEMBER_BAN_ADD).toBe(22);
    expect(AuditLogEvent.ROLE_UPDATE).toBe(31);
    expect(AuditLogEvent.MESSAGE_BULK_DELETE).toBe(73);
    expect(isAuditLogEventType(14)).toBe(true);
    expect(isAuditLogEventType(999)).toBe(false);
    expect(isAuditLogEventType("1")).toBe(false);
  });

  test("target kinds and verbs", () => {
    expect(auditTargetKind(AuditLogEvent.CHANNEL_UPDATE)).toBe("channel");
    expect(auditTargetKind(AuditLogEvent.MEMBER_BAN_ADD)).toBe("user");
    expect(auditTargetKind(AuditLogEvent.ROLE_DELETE)).toBe("role");
    expect(auditTargetKind(AuditLogEvent.MESSAGE_DELETE)).toBe("user");
    expect(auditTargetKind(AuditLogEvent.STICKER_CREATE)).toBe("sticker");
    expect(auditVerb(AuditLogEvent.ROLE_CREATE)).toBe("create");
    expect(auditVerb(AuditLogEvent.MEMBER_KICK)).toBe("delete");
    expect(auditVerb(AuditLogEvent.ROLE_UPDATE)).toBe("update");
  });
});

describe("diffChanges", () => {
  const keys = { name: "name", topic: "topic", nsfw: "nsfw", rateLimitPerUser: "rate_limit_per_user" };

  test("only changed keys present in the update", () => {
    const out = diffChanges({ name: "a", topic: "t", nsfw: false }, { name: "b", nsfw: false }, keys);
    expect(out).toEqual([{ key: "name", old: "a", new: "b" }]);
  });

  test("set and cleared values omit the missing side", () => {
    expect(diffChanges({ topic: null }, { topic: "hi" }, keys)).toEqual([{ key: "topic", new: "hi" }]);
    expect(diffChanges({ topic: "hi" }, { topic: "" }, keys)).toEqual([{ key: "topic", old: "hi" }]);
  });

  test("treats undefined, null and empty string alike, dates by value", () => {
    expect(diffChanges({ topic: null }, { topic: "" }, keys)).toEqual([]);
    const d = new Date("2026-01-01T00:00:00Z");
    expect(diffChanges({ name: d }, { name: new Date(d.getTime()) }, { name: "x" })).toEqual([]);
  });

  test("snapshotChanges skips empty values", () => {
    expect(snapshotChanges({ name: "general", nsfw: false, topic: "" }, keys)).toEqual([{ key: "name", new: "general" }]);
    expect(snapshotChanges({ name: "old" }, keys, "old")).toEqual([{ key: "name", old: "old" }]);
  });
});

describe("diffOverwrites", () => {
  test("create / update / delete entries", () => {
    const before = [
      { id: "r1", type: "role", allow: "1024", deny: "0" },
      { id: "r2", type: "role", allow: "0", deny: "2048" },
    ];
    const after = [
      { id: "R1", type: "role", allow: "1024", deny: "2048" },
      { id: "u1", type: "member", allow: "1024", deny: "0" },
    ];
    const ops = diffOverwrites(before, after);
    expect(ops.map((o) => [o.action, o.overwriteId])).toEqual([
      [AuditLogEvent.CHANNEL_OVERWRITE_UPDATE, "R1"],
      [AuditLogEvent.CHANNEL_OVERWRITE_CREATE, "u1"],
      [AuditLogEvent.CHANNEL_OVERWRITE_DELETE, "r2"],
    ]);
    expect(ops[0].changes).toEqual([{ key: "deny", old: "0", new: "2048" }]);
    expect(ops[1].overwriteType).toBe("member");
  });

  test("no ops when nothing changed", () => {
    const list = [{ id: "r1", type: "role", allow: "1", deny: "0" }];
    expect(diffOverwrites(list, [...list])).toEqual([]);
  });
});

describe("diffMemberRoles", () => {
  test("$add and $remove with names", () => {
    const out = diffMemberRoles(["a", "b"], ["b", "c"], { a: "Admin", c: "Mod" });
    expect(out).toEqual([
      { key: "$add", new: [{ id: "c", name: "Mod" }] },
      { key: "$remove", new: [{ id: "a", name: "Admin" }] },
    ]);
    expect(diffMemberRoles(["a"], ["A"], {})).toEqual([]);
  });
});

describe("legacy admin_logs rows", () => {
  const base = { id: "1", adminId: "admin", createdAt: "2026-01-02T00:00:00.000Z" };
  test("kicks stored as ban_user map to MEMBER_KICK", () => {
    expect(legacyAdminLogToAudit({ ...base, action: "ban_user", details: { userId: "u", kick: true } })?.actionType).toBe(AuditLogEvent.MEMBER_KICK);
    expect(legacyAdminLogToAudit({ ...base, action: "ban_user", details: { userId: "u" } })?.actionType).toBe(AuditLogEvent.MEMBER_BAN_ADD);
    expect(legacyAdminLogToAudit({ ...base, action: "unban_user", details: { userId: "u" } })?.targetId).toBe("u");
  });
  test("timeouts become MEMBER_UPDATE", () => {
    const e = legacyAdminLogToAudit({ ...base, action: "timeout_member", details: { userId: "u", until: "2026-02-01T00:00:00.000Z" } });
    expect(e?.actionType).toBe(AuditLogEvent.MEMBER_UPDATE);
    expect(e?.changes).toEqual([{ key: "communication_disabled_until", new: "2026-02-01T00:00:00.000Z" }]);
  });
  test("unknown actions are dropped", () => {
    expect(legacyAdminLogToAudit({ ...base, action: "grant_partner" })).toBeNull();
  });
});

describe("mergeAuditEntries + auditReason", () => {
  const e = (id: string, createdAt: string): AuditEntryShape => ({
    id, createdAt, actionType: 1, userId: null, targetId: null, changes: [], options: null, reason: null,
  });
  test("newest first, limited", () => {
    const out = mergeAuditEntries([e("a", "2026-01-03"), e("c", "2026-01-01")], [e("b", "2026-01-02")], 2);
    expect(out.map((x) => x.id)).toEqual(["a", "b"]);
  });
  test("body reason wins, header is URL-decoded", () => {
    expect(auditReason("spam%20bot", "  ")).toBe("spam bot");
    expect(auditReason("x", "rule 1")).toBe("rule 1");
    expect(auditReason(undefined)).toBeNull();
    expect(auditReason("%E0%A4%A")).toBe("%E0%A4%A");
  });
});

import { describe, expect, test } from "bun:test";
import {
  CSAM_PRESERVATION_DAYS,
  attachmentUrlsOf,
  deletedMoment,
  heldAuthorIdsFrom,
  holdReason,
  keysFromAttachmentLists,
  messagesBlockedByFailedFiles,
  parseRetentionConfig,
  partitionBatch,
  planFileDeletions,
  purgeableFileKey,
  retentionCutoff,
  urlVariants,
  type RetentionHolds,
} from "../src/lib/privacy/retention";

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-10-28T12:00:00.000Z");
const OPTS = { cdnUrl: "https://cdn.serika.chat", bucket: "serikacord-media" };
const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";
const noHolds = (): RetentionHolds => ({ reportedMessageIds: new Set(), heldAuthorIds: new Set() });
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY);

describe("retention config", () => {
  test("defaults are off and dry run, 30 days", () => {
    const cfg = parseRetentionConfig({});
    expect(cfg.enabled).toBe(false);
    expect(cfg.dryRun).toBe(true);
    expect(cfg.days).toBe(30);
    expect(cfg.batchSize).toBe(100);
    expect(cfg.maxRunMs).toBe(60_000);
    expect(cfg.intervalMs).toBe(60 * 60_000);
  });

  test("dry run only turns off with an explicit false value", () => {
    expect(parseRetentionConfig({ RETENTION_PURGE_ENABLED: "1", RETENTION_PURGE_DRY_RUN: "0" }).dryRun).toBe(false);
    expect(parseRetentionConfig({ RETENTION_PURGE_DRY_RUN: "false" }).dryRun).toBe(false);
    expect(parseRetentionConfig({ RETENTION_PURGE_DRY_RUN: "nope" }).dryRun).toBe(true);
    expect(parseRetentionConfig({ RETENTION_PURGE_DRY_RUN: "" }).dryRun).toBe(true);
    expect(parseRetentionConfig({ RETENTION_PURGE_ENABLED: "yes please" }).enabled).toBe(false);
    expect(parseRetentionConfig({ RETENTION_PURGE_ENABLED: "true" }).enabled).toBe(true);
  });

  test("numbers are clamped", () => {
    expect(parseRetentionConfig({ RETENTION_PURGE_DAYS: "0" }).days).toBe(1);
    expect(parseRetentionConfig({ RETENTION_PURGE_DAYS: "-5" }).days).toBe(1);
    expect(parseRetentionConfig({ RETENTION_PURGE_DAYS: "abc" }).days).toBe(30);
    expect(parseRetentionConfig({ RETENTION_PURGE_DAYS: "45.9" }).days).toBe(45);
    expect(parseRetentionConfig({ RETENTION_PURGE_BATCH_SIZE: "100000" }).batchSize).toBe(500);
    expect(parseRetentionConfig({ RETENTION_PURGE_MAX_SECONDS: "1" }).maxRunMs).toBe(5_000);
  });
});

describe("cutoff", () => {
  test("is N days before now", () => {
    expect(retentionCutoff(NOW, 30).toISOString()).toBe("2026-09-28T12:00:00.000Z");
    expect(retentionCutoff(NOW, 1).getTime()).toBe(NOW.getTime() - DAY);
  });

  test("never cuts off at or after now", () => {
    expect(retentionCutoff(NOW, 0).getTime()).toBe(NOW.getTime() - DAY);
    expect(retentionCutoff(NOW, Number.NaN).getTime()).toBe(NOW.getTime() - 30 * DAY);
  });

  test("deletion moment falls back to updated_at, then created_at", () => {
    expect(deletedMoment({ deletedAt: daysAgo(2), updatedAt: daysAgo(1) })?.getTime()).toBe(daysAgo(2).getTime());
    expect(deletedMoment({ deletedAt: null, updatedAt: daysAgo(40), createdAt: daysAgo(50) })?.getTime()).toBe(daysAgo(40).getTime());
    expect(deletedMoment({ deletedAt: null, updatedAt: null, createdAt: "2026-01-01T00:00:00Z" })?.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(deletedMoment({})).toBeNull();
  });
});

describe("holds", () => {
  test("reported messages and held authors are kept, case-insensitively", () => {
    const holds: RetentionHolds = { reportedMessageIds: new Set(["aaaa"]), heldAuthorIds: new Set([U1]) };
    expect(holdReason({ id: "AAAA", authorId: U2 }, holds)).toBe("report");
    expect(holdReason({ id: "bbbb", authorId: U1.toUpperCase() }, holds)).toBe("author");
    expect(holdReason({ id: "bbbb", authorId: U2 }, holds)).toBeNull();
  });

  test("held authors: open incidents, recent real CSAM incidents, open appeals", () => {
    const held = heldAuthorIdsFrom(
      [
        { userId: "A", kind: "scam_image", status: "open", isTest: false, createdAt: daysAgo(500) },
        { userId: "B", kind: "csam", status: "reviewed", isTest: false, createdAt: daysAgo(CSAM_PRESERVATION_DAYS - 1) },
        { userId: "C", kind: "csam", status: "reviewed", isTest: false, createdAt: daysAgo(CSAM_PRESERVATION_DAYS + 1) },
        { userId: "D", kind: "csam", status: "reviewed", isTest: true, createdAt: daysAgo(3) },
        { userId: "E", kind: "scam_image", status: "reviewed", isTest: false, createdAt: daysAgo(3) },
      ],
      [
        { userId: "F", status: "open" },
        { userId: "G", status: "deciding" },
        { userId: "H", status: "denied" },
      ],
      NOW,
    );
    expect([...held].sort()).toEqual(["a", "b", "f", "g"]);
  });
});

describe("batch selection", () => {
  const cutoff = retentionCutoff(NOW, 30);
  const row = (id: string, over: Record<string, unknown> = {}) => ({
    id, authorId: U2, isDeleted: true, deletedAt: daysAgo(31), updatedAt: daysAgo(31), createdAt: daysAgo(60), ...over,
  });

  test("purges only deleted rows past the cutoff and without a hold", () => {
    const holds: RetentionHolds = { reportedMessageIds: new Set(["r"]), heldAuthorIds: new Set([U1]) };
    const rows = [
      row("ok"),
      row("live", { isDeleted: false }),
      row("nullflag", { isDeleted: null }),
      row("recent", { deletedAt: daysAgo(29) }),
      row("exactly", { deletedAt: cutoff }),
      row("legacy", { deletedAt: null, updatedAt: daysAgo(90) }),
      row("legacy-recent", { deletedAt: null, updatedAt: daysAgo(3) }),
      row("r"),
      row("author", { authorId: U1 }),
    ];
    const { purge, held, skipped } = partitionBatch(rows, cutoff, holds);
    expect(purge.map((r) => r.id)).toEqual(["ok", "legacy"]);
    expect(held.map((h) => [h.row.id, h.reason])).toEqual([["r", "report"], ["author", "author"]]);
    expect(skipped.map((r) => r.id)).toEqual(["live", "nullflag", "recent", "exactly", "legacy-recent"]);
  });

  test("an empty batch purges nothing", () => {
    expect(partitionBatch([], cutoff, noHolds()).purge).toEqual([]);
  });
});

describe("files", () => {
  test("collects attachment and forward snapshot URLs once", () => {
    const urls = attachmentUrlsOf({
      attachments: [{ url: "https://cdn.serika.chat/attachments/u/a.png" }, "https://cdn.serika.chat/attachments/u/b.png", { name: "no url" }, null],
      messageSnapshot: { attachments: [{ url: "https://cdn.serika.chat/attachments/u/a.png" }, { url: "https://cdn.serika.chat/attachments/v/c.png" }] },
    });
    expect(urls).toEqual([
      "https://cdn.serika.chat/attachments/u/a.png",
      "https://cdn.serika.chat/attachments/u/b.png",
      "https://cdn.serika.chat/attachments/v/c.png",
    ]);
    expect(attachmentUrlsOf({ attachments: "nope", messageSnapshot: null })).toEqual([]);
  });

  test("only our own attachment keys are deletable", () => {
    expect(purgeableFileKey(`https://cdn.serika.chat/attachments/${U1}/abc.png`, OPTS)).toBe(`attachments/${U1}/abc.png`);
    expect(purgeableFileKey(`https://cdn.serika.chat/attachments/srv/chan/${U1}/abc.png?format=webp`, OPTS)).toBe(`attachments/srv/chan/${U1}/abc.png`);
    // Legacy Backblaze hosts of our bucket.
    expect(purgeableFileKey("https://serikacord-media.s3.eu-central-003.backblazeb2.com/attachments/u/x.bin", OPTS)).toBe("attachments/u/x.bin");
    expect(purgeableFileKey("https://s3.eu-central-003.backblazeb2.com/serikacord-media/attachments/u/x.bin", OPTS)).toBe("attachments/u/x.bin");
    expect(purgeableFileKey("https://f003.backblazeb2.com/file/serikacord-media/attachments/u/x.bin", OPTS)).toBe("attachments/u/x.bin");
    // Not ours, or not a message attachment.
    expect(purgeableFileKey("https://cdn.discordapp.com/attachments/1/2/x.png", OPTS)).toBeNull();
    expect(purgeableFileKey("https://cdn.serika.chat/avatars/u/x.png", OPTS)).toBeNull();
    expect(purgeableFileKey("https://cdn.serika.chat/emojis/x.png", OPTS)).toBeNull();
    expect(purgeableFileKey("https://s3.eu-central-003.backblazeb2.com/other-bucket/attachments/u/x.bin", OPTS)).toBeNull();
    expect(purgeableFileKey("https://cdn.serika.chat/attachments/", OPTS)).toBeNull();
    expect(purgeableFileKey("https://cdn.serika.chat/attachments/u/../../avatars/x.png", OPTS)).toBeNull();
    expect(purgeableFileKey("https://cdn.serika.chat/attachments/u/%2e%2e/x.png", OPTS)).toBeNull();
    expect(purgeableFileKey("https://user:pw@cdn.serika.chat/attachments/u/x.png", OPTS)).toBeNull();
    expect(purgeableFileKey("javascript:alert(1)", OPTS)).toBeNull();
    expect(purgeableFileKey("not a url", OPTS)).toBeNull();
  });

  test("a CDN with a path prefix only matches under that prefix", () => {
    const opts = { cdnUrl: "https://media.example.com/cdn", bucket: "b" };
    expect(purgeableFileKey("https://media.example.com/cdn/attachments/u/x.png", opts)).toBe("attachments/u/x.png");
    expect(purgeableFileKey("https://media.example.com/attachments/u/x.png", opts)).toBeNull();
  });

  test("files still used elsewhere are kept; shared keys are deleted once", () => {
    const a = "https://cdn.serika.chat/attachments/u/a.png";
    const b = "https://cdn.serika.chat/attachments/u/b.png";
    const c = "https://cdn.serika.chat/attachments/u/c.png";
    const plan = planFileDeletions(
      [
        { id: "m1", attachments: [{ url: a }, { url: b }] },
        { id: "m2", attachments: [{ url: a }], messageSnapshot: { attachments: [{ url: c }] } },
        { id: "m3", attachments: [{ url: "https://cdn.discordapp.com/attachments/1/2/x.png" }] },
      ],
      new Set(["attachments/u/b.png"]),
      OPTS,
    );
    expect([...plan.delete.entries()]).toEqual([
      ["attachments/u/a.png", ["m1", "m2"]],
      ["attachments/u/c.png", ["m2"]],
    ]);
    expect([...plan.keep]).toEqual(["attachments/u/b.png"]);
    expect(plan.foreign).toBe(1);
  });

  test("a failed file delete defers every message that held it", () => {
    const plan = planFileDeletions(
      [
        { id: "m1", attachments: [{ url: "https://cdn.serika.chat/attachments/u/a.png" }] },
        { id: "m2", attachments: [{ url: "https://cdn.serika.chat/attachments/u/a.png" }, { url: "https://cdn.serika.chat/attachments/u/b.png" }] },
        { id: "m3", attachments: [{ url: "https://cdn.serika.chat/attachments/u/c.png" }] },
      ],
      new Set(),
      OPTS,
    );
    expect([...messagesBlockedByFailedFiles(plan, ["attachments/u/a.png"])].sort()).toEqual(["m1", "m2"]);
    expect([...messagesBlockedByFailedFiles(plan, [])]).toEqual([]);
  });

  test("URL variants include the current CDN spelling", () => {
    expect(urlVariants("https://f003.backblazeb2.com/file/serikacord-media/attachments/u/x.bin", "attachments/u/x.bin", "https://cdn.serika.chat/"))
      .toEqual(["https://f003.backblazeb2.com/file/serikacord-media/attachments/u/x.bin", "https://cdn.serika.chat/attachments/u/x.bin"]);
    expect(urlVariants("https://cdn.serika.chat/attachments/u/x.bin", "attachments/u/x.bin", "https://cdn.serika.chat"))
      .toEqual(["https://cdn.serika.chat/attachments/u/x.bin"]);
  });

  test("bug report attachments protect their files", () => {
    const keys = keysFromAttachmentLists(
      [[{ url: "https://cdn.serika.chat/attachments/u/a.png", name: "a" }], ["https://cdn.serika.chat/attachments/u/b.png"], [{ name: "lost url" }], null],
      OPTS,
    );
    expect([...keys].sort()).toEqual(["attachments/u/a.png", "attachments/u/b.png"]);
  });
});

import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import {
  copyPermissionOverwrites,
  ensureSoundboardIds,
  exceedsMentionLimit,
  resolveServerSafety,
  sameId,
  validateChannelReorder,
} from "@/lib/servers/guards";

const CAT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TEXT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const THREAD = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const FOREIGN = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const OWN = [
  { id: CAT, type: "category" },
  { id: TEXT, type: "text" },
  { id: THREAD, type: "public_thread" },
];

describe("validateChannelReorder", () => {
  test("accepts moves inside the server", () => {
    expect(validateChannelReorder([{ id: TEXT, position: 0, parentId: CAT }, { id: CAT, position: 1, parentId: null }], OWN)).toBeNull();
    expect(validateChannelReorder([{ id: TEXT.toUpperCase(), position: 2 }], OWN)).toBeNull();
  });

  test("rejects channels of another server", () => {
    expect(validateChannelReorder([{ id: FOREIGN, position: 0 }], OWN)).toBe("Channel does not belong to this server");
  });

  test("rejects a parent that is not one of this server's categories", () => {
    expect(validateChannelReorder([{ id: TEXT, position: 0, parentId: FOREIGN }], OWN)).toBe("Invalid parent category");
    expect(validateChannelReorder([{ id: TEXT, position: 0, parentId: TEXT }], OWN)).toBe("Invalid parent category");
  });

  test("never moves threads or nests categories", () => {
    expect(validateChannelReorder([{ id: THREAD, position: 0, parentId: CAT }], OWN)).not.toBeNull();
    expect(validateChannelReorder([{ id: CAT, position: 0, parentId: CAT }], OWN)).toBe("A category cannot have a parent category");
  });
});

describe("copyPermissionOverwrites", () => {
  test("deep-copies valid entries and drops junk", () => {
    const source = [
      { id: CAT, type: "role", allow: "0", deny: "1024" },
      { id: "", type: "role", allow: "0", deny: "0" },
      { id: TEXT, type: "weird", allow: "0", deny: "0" },
      null,
    ];
    const copy = copyPermissionOverwrites(source);
    expect(copy).toEqual([{ id: CAT, type: "role", allow: "0", deny: "1024" }]);
    copy[0].deny = "0";
    expect((source[0] as { deny: string }).deny).toBe("1024");
    expect(copyPermissionOverwrites(undefined)).toEqual([]);
  });
});

describe("server safety", () => {
  test("defaults match the settings UI", () => {
    expect(resolveServerSafety(undefined)).toEqual({ antiSpam: true, mentionSpamLimit: 5 });
    expect(resolveServerSafety({ antiSpam: false, mentionSpamLimit: 3 })).toEqual({ antiSpam: false, mentionSpamLimit: 3 });
  });

  test("mention limit counts users, roles and @everyone, only with anti-spam on", () => {
    const safety = { antiSpam: true, mentionSpamLimit: 3 };
    expect(exceedsMentionLimit({ mentionedUserIds: ["a", "b", "c"] }, safety)).toBeFalse();
    expect(exceedsMentionLimit({ mentionedUserIds: ["a", "b"], mentionedRoleIds: ["r"], mentionEveryone: true }, safety)).toBeTrue();
    expect(exceedsMentionLimit({ mentionedUserIds: ["a", "b", "c", "d"] }, { ...safety, antiSpam: false })).toBeFalse();
  });
});

describe("ensureSoundboardIds", () => {
  const isUuid = (id: string) => /^[0-9a-f-]{36}$/i.test(id);
  let n = 0;
  const makeId = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;

  test("backfills missing, legacy and duplicate ids", () => {
    const { sounds, changed } = ensureSoundboardIds(
      [{ name: "a" }, { _id: "64f0c0ffee", name: "b" }, { id: TEXT, name: "c" }, { id: TEXT, name: "d" }],
      isUuid,
      makeId,
    );
    expect(changed).toBeTrue();
    expect(sounds.every((s) => isUuid(s.id))).toBeTrue();
    expect(new Set(sounds.map((s) => s.id)).size).toBe(4);
    expect(sounds[2].id).toBe(TEXT);
  });

  test("reports no change when every id is valid", () => {
    expect(ensureSoundboardIds([{ id: TEXT, name: "c" }], isUuid, makeId).changed).toBeFalse();
    expect(ensureSoundboardIds(null, isUuid, makeId)).toEqual({ sounds: [], changed: false });
  });
});

describe("sameId", () => {
  test("ignores case and handles null", () => {
    expect(sameId(TEXT, TEXT.toUpperCase())).toBeTrue();
    expect(sameId(TEXT, null)).toBeFalse();
  });
});

describe("upload routes", () => {
  test("no method + path is registered twice (Elysia silently keeps the last)", () => {
    const source = readFileSync(join(process.cwd(), "src/lib/api/uploads.ts"), "utf8");
    const routes = [...source.matchAll(/\.(get|post|put|patch|delete)\(\s*'([^']+)'/g)].map((m) => `${m[1]} ${m[2]}`);
    const dupes = routes.filter((r, i) => routes.indexOf(r) !== i);
    expect(dupes).toEqual([]);
  });
});

import { describe, expect, test } from "bun:test";
import { PERMISSION_BITS } from "@/lib/permissions/bits";
import {
  OVERWRITABLE_BITS,
  accessHolders,
  addOverwrite,
  childrenToResync,
  clearOverwrite,
  getOverwriteState,
  isPrivateChannel,
  normalizeOverwrites,
  overwritesInSync,
  permissionGroupsFor,
  removeOverwrite,
  setOverwriteState,
  setPrivateChannel,
} from "@/lib/permissions/overwriteEditor";

const VIEW = PERMISSION_BITS.VIEW_CHANNEL;
const SEND = PERMISSION_BITS.SEND_MESSAGES;
const CONNECT = PERMISSION_BITS.CONNECT;

describe("normalizeOverwrites", () => {
  test("drops junk and duplicates, coerces bits", () => {
    const out = normalizeOverwrites([
      { id: "a", type: "role", allow: 1024, deny: "x" },
      { id: "A", type: "role", allow: "1", deny: "0" },
      { id: "", type: "role" },
      { id: "b", type: "channel" },
      null,
    ]);
    expect(out).toEqual([{ id: "a", type: "role", allow: "1024", deny: "0" }]);
    expect(normalizeOverwrites("nope")).toEqual([]);
  });
});

describe("tri-state editing", () => {
  test("allow / deny / neutral round trip", () => {
    const target = { id: "r", type: "role" as const };
    let list = setOverwriteState([], target, SEND, "allow");
    expect(getOverwriteState(list[0], SEND)).toBe("allow");
    list = setOverwriteState(list, target, SEND, "deny");
    expect(getOverwriteState(list[0], SEND)).toBe("deny");
    expect(list[0].allow).toBe("0");
    list = setOverwriteState(list, target, SEND, "neutral");
    expect(getOverwriteState(list[0], SEND)).toBe("neutral");
    expect(setOverwriteState([], target, SEND, "neutral")).toEqual([]);
  });

  test("add / remove / clear", () => {
    const t = { id: "u", type: "member" as const };
    const added = addOverwrite([], t);
    expect(addOverwrite(added, t)).toHaveLength(1);
    expect(clearOverwrite(setOverwriteState(added, t, VIEW, "allow"), t)[0]).toEqual({ id: "u", type: "member", allow: "0", deny: "0" });
    expect(removeOverwrite(added, t)).toEqual([]);
  });
});

describe("private channels", () => {
  test("deny @everyone view and grant picks", () => {
    const list = setPrivateChannel([], "every", true, { grantTo: [{ id: "mods", type: "role" }, { id: "u1", type: "member" }] });
    expect(isPrivateChannel(list, "every")).toBe(true);
    expect(accessHolders(list, "every").map((o) => o.id)).toEqual(["mods", "u1"]);
    const back = setPrivateChannel(list, "every", false);
    expect(isPrivateChannel(back, "every")).toBe(false);
  });

  test("voice channels also gate Connect", () => {
    const list = setPrivateChannel([], "every", true, { voice: true, grantTo: [{ id: "r", type: "role" }] });
    const everyone = list.find((o) => o.id === "every")!;
    expect(getOverwriteState(everyone, CONNECT)).toBe("deny");
    expect(getOverwriteState(list.find((o) => o.id === "r"), CONNECT)).toBe("allow");
  });

  test("the server-id spelling of @everyone counts", () => {
    expect(isPrivateChannel([{ id: "srv", type: "role", allow: "0", deny: VIEW.toString() }], "every", "srv")).toBe(true);
  });
});

describe("category sync", () => {
  const cat = [{ id: "e", type: "role" as const, allow: "0", deny: VIEW.toString() }];
  test("order and empty overwrites don't matter", () => {
    expect(overwritesInSync([{ id: "x", type: "role", allow: "0", deny: "0" }, ...cat], cat)).toBe(true);
    expect(overwritesInSync([], [])).toBe(true);
    expect(overwritesInSync([], cat)).toBe(false);
    expect(overwritesInSync([{ id: "E", type: "role", allow: "0", deny: VIEW.toString() }], cat)).toBe(true);
  });

  test("only previously synced children re-sync", () => {
    const children = [
      { id: "synced", permissionOverwrites: cat },
      { id: "custom", permissionOverwrites: [{ id: "e", type: "role", allow: SEND.toString(), deny: "0" }] },
    ];
    expect(childrenToResync(cat, children)).toEqual(["synced"]);
  });
});

describe("permission groups", () => {
  test("voice channels get voice permissions, text channels don't", () => {
    const voice = permissionGroupsFor("voice").flatMap((g) => g.keys);
    const text = permissionGroupsFor("text").flatMap((g) => g.keys);
    expect(voice).toContain("CONNECT");
    expect(text).not.toContain("CONNECT");
    expect(text).toContain("SEND_MESSAGES");
    expect(permissionGroupsFor("category").map((g) => g.id)).toContain("voice");
  });
  test("administrator is never an overwrite", () => {
    expect((OVERWRITABLE_BITS & PERMISSION_BITS.ADMINISTRATOR) === 0n).toBe(true);
  });
});

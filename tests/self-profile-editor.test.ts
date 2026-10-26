import { describe, expect, test } from "bun:test";
import {
  applyProfilePatch,
  filterTaggedServers,
  normalizeInlineValue,
  overlaySelfProfile,
  resolveSelfTag,
  tagFromServer,
  type TaggedServerLike,
} from "../src/components/user/profileEditor/selfProfile";

const tagCfg = (tag: string) => ({ enabled: true, tag, icon: "star" as const, color: "#8B5CF6" });
const SERVERS: TaggedServerLike[] = [
  { id: "s1", name: "Serika Community", serverTag: tagCfg("SRKA") },
  { id: "s2", name: "Neuro-sama Headquarters", serverTag: tagCfg("NURO") },
  { id: "s3", name: "No Tag Place", serverTag: null },
  { id: "s4", name: "Disabled", serverTag: { ...tagCfg("OFF"), enabled: false } },
];

describe("normalizeInlineValue", () => {
  test("single-line fields are trimmed onto one line", () => {
    expect(normalizeInlineValue("pronouns", "  she/her \n")).toBe("she/her");
    expect(normalizeInlineValue("customStatus", "a\nb")).toBe("a b");
  });

  test("bio keeps inner newlines and drops trailing space", () => {
    expect(normalizeInlineValue("bio", "line one\r\nline two  \n\n")).toBe("line one\nline two");
  });

  test("clamps to the field limit by characters, not UTF-16 units", () => {
    expect(normalizeInlineValue("displayName", "x".repeat(40))).toHaveLength(32);
    const emoji = "😀".repeat(40);
    expect(Array.from(normalizeInlineValue("displayName", emoji))).toHaveLength(32);
  });

  test("empty stays empty (clears the field)", () => {
    expect(normalizeInlineValue("pronouns", "   ")).toBe("");
  });
});

describe("server tag helpers", () => {
  test("tagFromServer only resolves enabled tags", () => {
    expect(tagFromServer(SERVERS[0])).toMatchObject({ serverId: "s1", serverName: "Serika Community", tag: "SRKA" });
    expect(tagFromServer(SERVERS[2])).toBeNull();
    expect(tagFromServer(SERVERS[3])).toBeNull();
  });

  test("filterTaggedServers matches name or tag, case-insensitively", () => {
    expect(filterTaggedServers(SERVERS, "").map((s) => s.id)).toEqual(["s1", "s2"]);
    expect(filterTaggedServers(SERVERS, "neuro").map((s) => s.id)).toEqual(["s2"]);
    expect(filterTaggedServers(SERVERS, "srka").map((s) => s.id)).toEqual(["s1"]);
    expect(filterTaggedServers(SERVERS, "off")).toEqual([]);
  });

  test("resolveSelfTag follows your pointer, wherever the resolved data is", () => {
    const resolved = { serverId: "s2", serverName: "Neuro", tag: "NURO", icon: "star", color: "#8B5CF6" };
    // The resolved tag stored after picking it on the profile.
    expect(resolveSelfTag({ serverTag: resolved }, null)?.tag).toBe("NURO");
    // Pointer only: taken from the fetched profile when it matches...
    expect(resolveSelfTag({ serverTag: { serverId: "s2" } }, { serverTag: resolved })?.tag).toBe("NURO");
    // ...or from your server list.
    expect(resolveSelfTag({ serverTag: { serverId: "s1" } }, { serverTag: resolved }, SERVERS)?.tag).toBe("SRKA");
    // No pointer: no tag, even if the (stale) profile still has one.
    expect(resolveSelfTag({}, { serverTag: resolved }, SERVERS)).toBeNull();
  });
});

describe("overlaySelfProfile", () => {
  const profile = {
    id: "u1",
    username: "seika",
    displayName: "Old",
    bio: "old bio",
    banner: "https://cdn.serika.chat/banners/u1/a.webp",
    customization: { profileColor: "#000000", serverTag: { serverId: "s1", tag: "SRKA", icon: "star", color: "#8B5CF6" } },
  };

  test("live fields win, missing ones keep the fetched value", () => {
    const out = overlaySelfProfile(profile, { displayName: "New", bio: "", customization: { profileColor: "#ffffff", serverTag: { serverId: "s1" } } });
    expect(out.displayName).toBe("New");
    expect(out.bio).toBe("");
    expect(out.banner).toBe(profile.banner);
    expect(out.username).toBe("seika");
    expect(out.customization?.profileColor).toBe("#ffffff");
    expect((out.customization?.serverTag as { tag: string }).tag).toBe("SRKA");
  });

  test("dropping your tag removes it from the view", () => {
    const out = overlaySelfProfile(profile, { customization: { profileColor: "#000000" } });
    expect(out.customization?.serverTag).toBeUndefined();
  });
});

describe("applyProfilePatch", () => {
  const user = { displayName: "A", customStatus: "hi", customization: { customStatusEmoji: { name: "🔥" }, profileColor: "#111111" } };

  test("merges customization keys", () => {
    const out = applyProfilePatch(user, { customization: { profileGradient: ["#000000", "#ffffff"] } });
    expect(out.customization).toMatchObject({ profileColor: "#111111", profileGradient: ["#000000", "#ffffff"] });
  });

  test("clearing the status text also clears its emoji, like the server does", () => {
    const out = applyProfilePatch(user, { customStatus: "" });
    expect(out.customStatus).toBe("");
    expect(out.customization?.customStatusEmoji).toBeNull();
  });

  test("editing the status text keeps the emoji", () => {
    const out = applyProfilePatch(user, { customStatus: "new" });
    expect(out.customization?.customStatusEmoji).toEqual({ name: "🔥" });
  });
});

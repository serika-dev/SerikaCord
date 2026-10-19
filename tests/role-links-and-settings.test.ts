import { describe, expect, test } from "bun:test";
import {
  addedRoleLinkTargets,
  expandLinkedRoles,
  linkedRoleClosure,
  normalizeRoleLinks,
  readRoleLinks,
  MAX_LINKED_ROLES_PER_ROLE,
} from "../src/lib/roles/roleLinks";
import { moveRoleId } from "../src/lib/roles/reorder";
import { effectiveSoundPercent, parseSoundVolume, soundVolume } from "../src/lib/servers/soundboardVolume";
import { filterAndSortMembers } from "../src/lib/servers/memberView";

const roles = [
  { id: "everyone", isDefault: true },
  { id: "a" }, { id: "b" }, { id: "c" }, { id: "d" },
  { id: "bot", managed: true },
];

describe("role links: normalize", () => {
  test("drops self links, duplicates, unknown, default and managed roles", () => {
    const links = normalizeRoleLinks({ A: ["a", "B", "b", "x", "everyone", "bot"], everyone: ["a"], zzz: ["a"], c: [] }, roles);
    expect(links).toEqual({ a: ["b"] });
  });
  test("non-object input is empty", () => {
    expect(normalizeRoleLinks(null)).toEqual({});
    expect(normalizeRoleLinks(["a"])).toEqual({});
    expect(readRoleLinks({})).toEqual({});
    expect(readRoleLinks({ roleLinks: { a: ["b"] } })).toEqual({ a: ["b"] });
  });
  test("caps targets per role", () => {
    const many = Array.from({ length: 30 }, (_, i) => `r${i}`);
    expect(normalizeRoleLinks({ a: many }).a.length).toBe(MAX_LINKED_ROLES_PER_ROLE);
  });
});

describe("role links: expansion", () => {
  test("granting A also grants B, but not the other way around", () => {
    const links = { a: ["b"] };
    expect(expandLinkedRoles({ current: ["everyone"], next: ["everyone", "a"], links })).toEqual(["everyone", "a", "b"]);
    expect(expandLinkedRoles({ current: ["everyone"], next: ["everyone", "b"], links })).toEqual(["everyone", "b"]);
  });
  test("only newly granted roles fire links (removing B by hand sticks)", () => {
    expect(expandLinkedRoles({ current: ["a", "b"], next: ["a"], links: { a: ["b"] } })).toEqual(["a"]);
  });
  test("transitive with a cycle guard", () => {
    const links = { a: ["b"], b: ["c"], c: ["a", "d"] };
    expect(linkedRoleClosure(["a"], links).sort()).toEqual(["b", "c", "d"]);
    expect(expandLinkedRoles({ current: [], next: ["a"], links })).toEqual(["a", "b", "c", "d"]);
  });
  test("roles the actor can't grant are skipped and not followed", () => {
    const links = { a: ["b"], b: ["c"] };
    expect(expandLinkedRoles({ current: [], next: ["a"], links, canAdd: (id) => id !== "b" })).toEqual(["a"]);
  });
  test("links still flow through a role the member already holds", () => {
    const links = { a: ["b"], b: ["c"] };
    expect(expandLinkedRoles({ current: ["b"], next: ["b", "a"], links, canAdd: (id) => id !== "b" })).toEqual(["b", "a", "c"]);
  });
  test("added targets diff", () => {
    expect(addedRoleLinkTargets({ a: ["b"] }, { a: ["b", "c"], d: ["a"] })).toEqual({ a: ["c"], d: ["a"] });
  });
});

describe("role drag reorder", () => {
  const ids = ["r1", "r2", "r3", "r4"];
  test("moves before / after the target", () => {
    expect(moveRoleId(ids, "r4", "r1", "before")).toEqual(["r4", "r1", "r2", "r3"]);
    expect(moveRoleId(ids, "r1", "r3", "after")).toEqual(["r2", "r3", "r1", "r4"]);
  });
  test("no-op drops return null", () => {
    expect(moveRoleId(ids, "r2", "r3", "before")).toBeNull();
    expect(moveRoleId(ids, "r2", "r1", "after")).toBeNull();
    expect(moveRoleId(ids, "r2", "r2", "after")).toBeNull();
    expect(moveRoleId(ids, "x", "r2", "after")).toBeNull();
  });
});

describe("soundboard per-sound volume", () => {
  test("parses and clamps to 0..1", () => {
    expect(parseSoundVolume(0.5)).toBe(0.5);
    expect(parseSoundVolume(3)).toBe(1);
    expect(parseSoundVolume(-1)).toBe(0);
    expect(parseSoundVolume("1")).toBeNull();
    expect(soundVolume({})).toBe(1);
  });
  test("combines with the server volume", () => {
    expect(effectiveSoundPercent(100, { volume: 0.5 })).toBe(50);
    expect(effectiveSoundPercent(150, {})).toBe(150);
    expect(effectiveSoundPercent(undefined, { volume: 0.25 })).toBe(25);
  });
});

describe("member view", () => {
  const members = [
    { id: "1", username: "zed", joinedAt: "2026-01-02T00:00:00Z", createdAt: "2020-01-01T00:00:00Z", roles: [{ id: "a" }] },
    { id: "2", username: "amy", displayName: "Amy", joinedAt: "2026-03-01T00:00:00Z", createdAt: "2024-01-01T00:00:00Z", roles: [] },
    { id: "3", username: "bob", nickname: "Bobby", joinedAt: "2025-01-01T00:00:00Z", createdAt: "2022-01-01T00:00:00Z", roles: [{ id: "A" }] },
  ];
  test("sorts by join date, name and account age", () => {
    expect(filterAndSortMembers(members, {}).map((m) => m.id)).toEqual(["2", "1", "3"]);
    expect(filterAndSortMembers(members, { sort: "joined_asc" }).map((m) => m.id)).toEqual(["3", "1", "2"]);
    expect(filterAndSortMembers(members, { sort: "name_asc" }).map((m) => m.id)).toEqual(["2", "3", "1"]);
    expect(filterAndSortMembers(members, { sort: "created_asc" }).map((m) => m.id)).toEqual(["1", "3", "2"]);
  });
  test("filters by role and search", () => {
    expect(filterAndSortMembers(members, { roleId: "a" }).map((m) => m.id)).toEqual(["1", "3"]);
    expect(filterAndSortMembers(members, { search: "bobby" }).map((m) => m.id)).toEqual(["3"]);
  });
});

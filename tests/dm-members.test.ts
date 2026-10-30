import { describe, expect, test } from "bun:test";
import { directMessageMembers, normalizeStatus, toMemberListMember } from "@/lib/chat/dmMembers";

const aiko = { id: "A1", username: "aiko", displayName: "Aiko", status: "online" };
const me = { id: "M1", username: "mika", displayName: null, status: "idle" };

describe("DM people as member-list rows", () => {
  test("presence is normalized; unknown reads offline", () => {
    expect(normalizeStatus("dnd")).toBe("dnd");
    expect(normalizeStatus("invisible")).toBe("offline");
    expect(normalizeStatus(undefined)).toBe("offline");
  });

  test("a row keeps identity and falls back to the username", () => {
    const row = toMemberListMember(me);
    expect(row).toMatchObject({ id: "M1", username: "mika", displayName: "mika", status: "idle", isOwner: false, roles: [] });
  });

  test("the group owner gets a hoisted 'Group Owner' role and the crown", () => {
    const row = toMemberListMember(aiko, { ownerId: "a1", ownerLabel: "Group Owner" });
    expect(row.isOwner).toBe(true);
    expect(row.roles?.[0]).toMatchObject({ name: "Group Owner", hoist: true });
    expect(toMemberListMember(me, { ownerId: "A1" }).roles).toEqual([]);
  });

  test("a 1:1 DM lists them first, then you, never twice", () => {
    expect(directMessageMembers(aiko, me).map((m) => m.id)).toEqual(["A1", "M1"]);
    expect(directMessageMembers(null, me).map((m) => m.id)).toEqual(["M1"]);
    expect(directMessageMembers(aiko, { ...aiko }).map((m) => m.id)).toEqual(["A1"]);
  });
});

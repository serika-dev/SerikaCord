import { describe, expect, test } from "bun:test";
import { PERMISSION_BITS as P } from "@/lib/permissions/bits";
import { DEFAULT_EVERYONE_PERMISSIONS } from "@/lib/permissions/channelOverwrites";
import { channelViewerFromRoles, visibleServerChannels, type VisibilityChannel } from "@/lib/permissions/channelVisibility";

const SERVER = "server-1";
const EVERYONE = "role-everyone";
const MOD = "role-mod";
const ME = "user-me";

const hide = (allowRole?: string) => [
  { id: EVERYONE, type: "role", allow: "0", deny: P.VIEW_CHANNEL.toString() },
  ...(allowRole ? [{ id: allowRole, type: "role", allow: P.VIEW_CHANNEL.toString(), deny: "0" }] : []),
];

const roles = (everyonePerms: bigint, modPerms = 0n) => [
  { id: EVERYONE, isDefault: true, permissions: everyonePerms.toString() },
  { id: MOD, isDefault: false, permissions: modPerms.toString() },
];

function viewer(opts: { everyone?: bigint; mod?: bigint; memberRoles?: string[]; owner?: boolean } = {}) {
  return channelViewerFromRoles({
    userId: ME,
    serverId: SERVER,
    ownerId: opts.owner ? ME : "someone-else",
    roles: roles(opts.everyone ?? DEFAULT_EVERYONE_PERMISSIONS, opts.mod ?? 0n),
    memberRoleIds: opts.memberRoles ?? [],
  });
}

const ids = (list: VisibilityChannel[]) => list.map((c) => c.id).sort();

const CHANNELS: VisibilityChannel[] = [
  { id: "cat-public", type: "category" },
  { id: "general", type: "text", parentId: "cat-public" },
  { id: "cat-staff", type: "category", permissionOverwrites: hide(MOD) },
  { id: "staff-chat", type: "text", parentId: "cat-staff", permissionOverwrites: hide(MOD) },
  { id: "staff-voice", type: "voice", parentId: "cat-staff", permissionOverwrites: hide(MOD) },
  { id: "thread-joined", type: "public_thread", parentId: "general", threadMemberIds: [ME] },
  { id: "thread-other", type: "public_thread", parentId: "general", threadMemberIds: ["x"] },
  { id: "thread-staff", type: "private_thread", parentId: "staff-chat", threadMemberIds: [ME] },
  { id: "thread-archived", type: "public_thread", parentId: "general", threadMemberIds: [ME], archived: true },
];

describe("visibleServerChannels", () => {
  test("a plain member doesn't get hidden channels, their category or threads under them", () => {
    expect(ids(visibleServerChannels(CHANNELS, viewer()))).toEqual(["cat-public", "general", "thread-joined"]);
  });

  test("a role allowed by the overwrite sees the private category and channels", () => {
    expect(ids(visibleServerChannels(CHANNELS, viewer({ memberRoles: [MOD] })))).toEqual([
      "cat-public", "cat-staff", "general", "staff-chat", "staff-voice", "thread-joined", "thread-staff",
    ]);
  });

  test("MANAGE_CHANNELS alone does not reveal hidden channels", () => {
    const list = ids(visibleServerChannels(CHANNELS, viewer({ mod: P.MANAGE_CHANNELS, memberRoles: ["role-manager"] })));
    expect(list).not.toContain("staff-chat");
    const manager = channelViewerFromRoles({
      userId: ME, serverId: SERVER, ownerId: null,
      roles: [...roles(DEFAULT_EVERYONE_PERMISSIONS), { id: "role-manager", permissions: P.MANAGE_CHANNELS.toString() }],
      memberRoleIds: ["role-manager"],
    });
    expect(ids(visibleServerChannels(CHANNELS, manager))).not.toContain("staff-chat");
    expect(ids(visibleServerChannels(CHANNELS, manager))).not.toContain("cat-staff");
  });

  test("owner and ADMINISTRATOR see every channel but only joined, open threads", () => {
    const expected = ["cat-public", "cat-staff", "general", "staff-chat", "staff-voice", "thread-joined", "thread-staff"];
    expect(ids(visibleServerChannels(CHANNELS, viewer({ owner: true })))).toEqual(expected);
    expect(ids(visibleServerChannels(CHANNELS, viewer({ mod: P.ADMINISTRATOR, memberRoles: [MOD] })))).toEqual(expected);
  });

  test("@everyone without VIEW_CHANNEL hides channels that have no overwrites", () => {
    const noView = DEFAULT_EVERYONE_PERMISSIONS & ~P.VIEW_CHANNEL;
    expect(visibleServerChannels(CHANNELS, viewer({ everyone: noView }))).toEqual([]);
    // ...unless one of the member's roles grants it.
    expect(ids(visibleServerChannels(CHANNELS, viewer({ everyone: noView, mod: P.VIEW_CHANNEL, memberRoles: [MOD] })))).toContain("general");
  });

  test("a member overwrite beats a role allow", () => {
    const channels: VisibilityChannel[] = [{
      id: "secret", type: "text",
      permissionOverwrites: [...hide(MOD), { id: ME, type: "member", allow: "0", deny: P.VIEW_CHANNEL.toString() }],
    }];
    expect(visibleServerChannels(channels, viewer({ memberRoles: [MOD] }))).toEqual([]);
  });

  test("an empty category shows only to members who manage channels", () => {
    const channels: VisibilityChannel[] = [{ id: "empty", type: "category" }];
    expect(visibleServerChannels(channels, viewer())).toEqual([]);
    expect(ids(visibleServerChannels(channels, viewer({ mod: P.MANAGE_CHANNELS, memberRoles: [MOD] })))).toEqual(["empty"]);
  });

  test("a visible channel keeps a hidden category's row so it still has a heading", () => {
    const channels: VisibilityChannel[] = [
      { id: "cat", type: "category", permissionOverwrites: hide() },
      { id: "open", type: "text", parentId: "cat" },
    ];
    expect(ids(visibleServerChannels(channels, viewer()))).toEqual(["cat", "open"]);
  });

  test("the allow filter (rules screening) applies to channels and categories", () => {
    const list = visibleServerChannels(CHANNELS, viewer({ memberRoles: [MOD] }), (c) => c.id === "general" || c.id === "cat-public");
    expect(ids(list)).toEqual(["cat-public", "general", "thread-joined"]);
  });

  test("malformed role bitfields count as no permissions", () => {
    const v = channelViewerFromRoles({
      userId: ME, serverId: SERVER, ownerId: null,
      roles: [{ id: EVERYONE, isDefault: true, permissions: "not-a-number" }],
      memberRoleIds: [],
    });
    expect(visibleServerChannels(CHANNELS, v)).toEqual([]);
  });
});

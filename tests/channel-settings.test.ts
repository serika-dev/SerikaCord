import { describe, expect, test } from "bun:test";
import {
  REQUIRE_TAG_FLAG,
  SLOWMODE_STEPS,
  buildChannelPatch,
  channelCapabilities,
  channelDraftFrom,
  channelErrorField,
  channelSettingsKind,
  clampUserLimit,
  forumTagNameError,
  overwritesSignature,
  slowmodeStepIndex,
  splitDuration,
  validateChannelDraft,
} from "@/lib/servers/channelSettings";

const base = channelDraftFrom({
  name: "general",
  type: "text",
  topic: "hi",
  isNsfw: false,
  rateLimitPerUser: 0,
  parentId: null,
  permissionOverwrites: [{ id: "r1", type: "role", allow: "1024", deny: "0" }],
});

describe("channel kinds and capabilities", () => {
  test("maps channel types", () => {
    expect(channelSettingsKind("public_thread")).toBe("thread");
    expect(channelSettingsKind("private_thread")).toBe("thread");
    expect(channelSettingsKind("weird")).toBe("text");
    expect(channelSettingsKind("stage")).toBe("stage");
  });

  test("only shows what each kind supports", () => {
    expect(channelCapabilities("voice").userLimit).toBe(true);
    expect(channelCapabilities("voice").topic).toBe(false);
    expect(channelCapabilities("category").parent).toBe(false);
    expect(channelCapabilities("category").invites).toBe(false);
    expect(channelCapabilities("forum").forum).toBe(true);
    expect(channelCapabilities("forum").defaultThreadArchive).toBe(false);
    expect(channelCapabilities("announcement").announcementToggle).toBe(true);
    expect(channelCapabilities("public_thread").permissions).toBe(false);
    expect(channelCapabilities("public_thread").threadArchive).toBe(true);
  });
});

describe("slowmode steps", () => {
  test("Off to 6 hours", () => {
    expect(SLOWMODE_STEPS[0]).toBe(0);
    expect(SLOWMODE_STEPS[SLOWMODE_STEPS.length - 1]).toBe(21600);
  });

  test("snaps in-between values to the closest stop", () => {
    expect(slowmodeStepIndex(0)).toBe(0);
    expect(slowmodeStepIndex(60)).toBe(SLOWMODE_STEPS.indexOf(60));
    expect(slowmodeStepIndex(50)).toBe(SLOWMODE_STEPS.indexOf(60));
    expect(slowmodeStepIndex(-4)).toBe(0);
    expect(slowmodeStepIndex(999999)).toBe(SLOWMODE_STEPS.length - 1);
    expect(slowmodeStepIndex(Number.NaN)).toBe(0);
  });

  test("splits durations into the largest whole unit", () => {
    expect(splitDuration(5)).toEqual({ amount: 5, unit: "s" });
    expect(splitDuration(120)).toEqual({ amount: 2, unit: "m" });
    expect(splitDuration(21600)).toEqual({ amount: 6, unit: "h" });
    expect(splitDuration(90)).toEqual({ amount: 90, unit: "s" });
  });

  test("user limit clamps to 0-99", () => {
    expect(clampUserLimit(-3)).toBe(0);
    expect(clampUserLimit(150)).toBe(99);
    expect(clampUserLimit(12.4)).toBe(12);
  });
});

describe("channelDraftFrom", () => {
  test("reads both the context and the raw row spelling of nsfw", () => {
    expect(channelDraftFrom({ isNsfw: true }).nsfw).toBe(true);
    expect(channelDraftFrom({ nsfw: true, isNsfw: false }).nsfw).toBe(true);
  });

  test("decodes the HTML-escaped name and topic", () => {
    const d = channelDraftFrom({ name: "Memes &amp; Stuff", topic: "a &lt;b&gt;" });
    expect(d.name).toBe("Memes & Stuff");
    expect(d.topic).toBe("a <b>");
  });

  test("forum columns", () => {
    const d = channelDraftFrom({
      type: "forum",
      flags: REQUIRE_TAG_FLAG,
      defaultSortOrder: "creation_date",
      defaultForumLayout: "not_set",
      availableTags: [{ id: "t1", name: "Help", moderated: true, emojiName: "❓" }, { name: "" }, null],
      forumMode: "tickets",
    });
    expect(d.requireTag).toBe(true);
    expect(d.defaultSortOrder).toBe("creation_date");
    expect(d.defaultForumLayout).toBe("list_view");
    expect(d.availableTags).toEqual([{ id: "t1", name: "Help", moderated: true, emojiName: "❓" }]);
    expect(d.forumMode).toBe("tickets");
  });
});

describe("buildChannelPatch", () => {
  test("nothing changed → empty patch", () => {
    expect(buildChannelPatch("text", base, { ...base })).toEqual({});
  });

  test("sends only changed fields, with the name cleaned up", () => {
    const patch = buildChannelPatch("text", base, { ...base, name: "  Off   Topic ", rateLimitPerUser: 30 });
    expect(patch).toEqual({ name: "Off Topic", rateLimitPerUser: 30 });
  });

  test("announcement toggle becomes a type change", () => {
    expect(buildChannelPatch("text", base, { ...base, announcement: true })).toEqual({ type: "announcement" });
  });

  test("ignores fields the channel kind doesn't have", () => {
    const patch = buildChannelPatch("voice", base, { ...base, topic: "nope", userLimit: 5, announcement: true });
    expect(patch).toEqual({ userLimit: 5 });
    expect(buildChannelPatch("category", base, { ...base, parentId: "c1" })).toEqual({});
  });

  test("overwrite order doesn't count as a change, content does", () => {
    const two = [
      { id: "r1", type: "role" as const, allow: "1024", deny: "0" },
      { id: "m1", type: "member" as const, allow: "0", deny: "2048" },
    ];
    const a = { ...base, permissionOverwrites: two };
    const b = { ...base, permissionOverwrites: [...two].reverse() };
    expect(buildChannelPatch("text", a, b)).toEqual({});
    expect(overwritesSignature(two)).toBe(overwritesSignature([...two].reverse()));
    const changed = buildChannelPatch("text", a, { ...a, permissionOverwrites: [two[0]] });
    expect(changed.permissionOverwrites).toEqual([two[0]]);
  });

  test("forum settings", () => {
    const forum = channelDraftFrom({ type: "forum", name: "help", availableTags: [{ id: "t1", name: "Bug" }] });
    const patch = buildChannelPatch("forum", forum, {
      ...forum,
      availableTags: [...forum.availableTags, { name: " New ", moderated: true }],
      requireTag: true,
      defaultForumLayout: "gallery_view",
      ticketAccessRoleIds: [],
    });
    expect(patch).toEqual({
      availableTags: [{ id: "t1", name: "Bug", moderated: false }, { name: "New", moderated: true }],
      requireTag: true,
      defaultForumLayout: "gallery_view",
    });
  });

  test("support roles compare as a set", () => {
    const forum = channelDraftFrom({ type: "forum", ticketAccessRoleIds: ["A", "b"] });
    expect(buildChannelPatch("forum", forum, { ...forum, ticketAccessRoleIds: ["B", "a"] })).toEqual({});
  });

  test("thread archive duration", () => {
    const thread = channelDraftFrom({ type: "public_thread", autoArchiveDuration: 60 });
    expect(buildChannelPatch("public_thread", thread, { ...thread, autoArchiveDuration: 4320 })).toEqual({ autoArchiveDuration: 4320 });
  });
});

describe("validation and errors", () => {
  test("empty names are rejected before saving", () => {
    expect(validateChannelDraft("text", { ...base, name: "   " })).toEqual({ name: "required" });
    expect(validateChannelDraft("text", base)).toEqual({});
  });

  test("forum tag names", () => {
    const tags = [{ name: "Bug", moderated: false }];
    expect(forumTagNameError("", tags)).toBe("empty");
    expect(forumTagNameError("bug", tags)).toBe("duplicate");
    expect(forumTagNameError("bug", tags, 0)).toBeNull();
    expect(forumTagNameError("x".repeat(21), tags)).toBe("too_long");
  });

  test("maps server errors to fields", () => {
    expect(channelErrorField("Channel name cannot be empty")).toBe("name");
    expect(channelErrorField("Invalid parent category")).toBe("parentId");
    expect(channelErrorField("Channels in an age-restricted category are always age-restricted")).toBe("nsfw");
    expect(channelErrorField("You need Manage Roles permission to edit channel permissions")).toBe("permissionOverwrites");
    expect(channelErrorField("Validation error", '{"type":"validation","property":"/topic","message":"too long"}')).toBe("topic");
    expect(channelErrorField("Validation error", '{"property":"/type"}')).toBe("announcement");
    expect(channelErrorField("Something else")).toBeNull();
  });
});

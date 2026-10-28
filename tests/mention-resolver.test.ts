import { describe, expect, test } from "bun:test";
import {
  collectMessageUsers,
  indexById,
  mentionUserLabel,
  mergeMentionUsers,
  referenceMentions,
  resolveMentionNames,
  resolveMentionUser,
  unresolvedMentionUserIds,
} from "@/lib/chat/mentionResolver";
import { renderMentionText } from "@/lib/chat/mentionText";

const OWNER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BOT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const LEFT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const GHOST = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const ROLE = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const CHANNEL = "ffffffff-ffff-4fff-8fff-ffffffffffff";

describe("collectMessageUsers", () => {
  test("takes authors, reply authors and the reply's mentioned users", () => {
    const users = collectMessageUsers([
      {
        author: { id: BOT, username: "serika", displayName: "Serika" },
        referencedMessage: {
          author: { id: OWNER, username: "pikachubolk", displayName: "Pikachubolk" },
          mentions: [{ id: LEFT, username: "gone", displayName: "Gone" }],
        },
      },
    ]);
    expect(users.map((u) => u.id).sort()).toEqual([BOT, OWNER, LEFT].sort());
  });

  test("skips missing ids and falls back to the username for the label", () => {
    const users = collectMessageUsers([
      { author: { id: "", username: "x" } },
      { author: null, referencedMessage: { author: { id: OWNER, username: "pika" } } },
    ]);
    expect(users).toEqual([{ id: OWNER, username: "pika", displayName: "pika", avatar: undefined }]);
  });
});

describe("mergeMentionUsers", () => {
  test("earlier lists win (member nicknames beat embedded names)", () => {
    const merged = mergeMentionUsers(
      [{ id: BOT, username: "serika", displayName: "Serika (nick)" }],
      [{ id: BOT, username: "serika", displayName: "Serika" }, { id: OWNER, displayName: "Pika" }],
    );
    expect(merged).toEqual([
      { id: BOT, username: "serika", displayName: "Serika (nick)" },
      { id: OWNER, displayName: "Pika" },
    ]);
  });

  test("a later entry fills a nameless earlier one", () => {
    const merged = mergeMentionUsers([{ id: BOT }], [{ id: BOT, username: "serika", displayName: "Serika" }]);
    expect(mentionUserLabel(merged[0])).toBe("Serika");
  });

  test("tolerates undefined lists", () => {
    expect(mergeMentionUsers(undefined, null, [])).toEqual([]);
  });
});

describe("resolveMentionUser", () => {
  test("tries sources in order, then the lookup", () => {
    const members = indexById([{ id: BOT, displayName: "Serika" }]);
    const lookup = (id: string) => (id === LEFT ? { id: LEFT, username: "gone" } : undefined);
    expect(resolveMentionUser(BOT, { users: [members], lookupUser: lookup })?.displayName).toBe("Serika");
    expect(resolveMentionUser(LEFT, { users: [members], lookupUser: lookup })?.username).toBe("gone");
    expect(resolveMentionUser(GHOST, { users: [members], lookupUser: lookup })).toBeUndefined();
  });

  test("ignores entries with no name", () => {
    expect(resolveMentionUser(BOT, { users: [[{ id: BOT }], [{ id: BOT, username: "serika" }]] })?.username).toBe("serika");
  });
});

describe("resolveMentionNames", () => {
  test("names the bot in a reply snippet like the full message", () => {
    const text = `<@${BOT}> Yo`;
    const names = resolveMentionNames(text, { users: [[{ id: BOT, username: "serika", displayName: "Serika" }]] });
    expect(renderMentionText(text, names)).toBe("@Serika Yo");
  });

  test("roles, channels and only the ids in the text", () => {
    const text = `<@&${ROLE}> see <#${CHANNEL}> and <@${OWNER}>`;
    const names = resolveMentionNames(text, {
      users: [[{ id: OWNER, displayName: "Pika" }, { id: BOT, displayName: "Serika" }]],
      roles: [{ id: ROLE, name: "Mods" }],
      channels: new Map([[CHANNEL, { id: CHANNEL, name: "general" }]]),
    });
    expect(names.users).toEqual({ [OWNER]: "Pika" });
    expect(renderMentionText(text, names)).toBe("@Mods see #general and @Pika");
  });

  test("unknown ids keep the generic labels", () => {
    const text = `<@${GHOST}> <@&${ROLE}> <#${CHANNEL}>`;
    expect(renderMentionText(text, resolveMentionNames(text, {}))).toBe("@user @role #channel");
  });

  test("uses the lookup cache as the last resort", () => {
    const text = `hi <@${LEFT}>`;
    const names = resolveMentionNames(text, { users: [], lookupUser: () => ({ id: LEFT, displayName: "Gone" }) });
    expect(renderMentionText(text, names)).toBe("hi @Gone");
  });
});

describe("unresolvedMentionUserIds", () => {
  test("lists only ids nobody can name", () => {
    const text = `<@${BOT}> <@${LEFT}> <@!${GHOST}>`;
    expect(unresolvedMentionUserIds(text, { users: [[{ id: BOT, displayName: "Serika" }]] })).toEqual([LEFT, GHOST]);
    expect(unresolvedMentionUserIds("no mentions", {})).toEqual([]);
  });
});

describe("referenceMentions (server)", () => {
  const rows = new Map([
    [BOT, { id: BOT, username: "serika", displayName: "Serika", avatar: null, isBot: true }],
    [OWNER, { id: OWNER, username: "pikachubolk", displayName: null, avatar: "a.png" }],
  ]);
  const lookup = (id: string) => rows.get(id);

  test("embeds the users named in the text, HTML-escaped or not", () => {
    expect(referenceMentions(`&lt;@${BOT}&gt; Yo`, lookup)).toEqual([
      { id: BOT, username: "serika", displayName: "Serika", avatar: undefined, isBot: true },
    ]);
    expect(referenceMentions(`<@${OWNER}>`, lookup, (id) => (id === OWNER ? "Pika" : null))).toEqual([
      { id: OWNER, username: "pikachubolk", displayName: "Pika", avatar: "a.png", isBot: false },
    ]);
  });

  test("matches upper-case ids and skips unknown ones", () => {
    expect(referenceMentions(`<@${BOT.toUpperCase()}> <@${GHOST}>`, lookup)?.map((u) => u.id)).toEqual([BOT]);
  });

  test("undefined when nothing is mentioned", () => {
    expect(referenceMentions("", lookup)).toBeUndefined();
    expect(referenceMentions(`<@${GHOST}>`, lookup)).toBeUndefined();
    expect(referenceMentions(null, lookup)).toBeUndefined();
  });
});

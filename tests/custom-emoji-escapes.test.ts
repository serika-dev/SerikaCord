import { describe, expect, test } from "bun:test";
import {
  customEmojiTokenRegex,
  customEmojiTokensToNames,
  mergeEmojiLookups,
  normalizeCustomEmojiName,
  parseCustomEmojiToken,
} from "@/lib/chat/customEmoji";
import { findEscapedMentions, resolveEscapedMentions, stripEscapedMentions } from "@/lib/chat/escapes";
import { protectEmojiTokens, splitEmojiSegments } from "@/lib/chat/emojiSegments";
import { parseInlineMarkdown } from "@/lib/chat/markdown";
import { renderMentionText } from "@/lib/chat/mentionText";
import { stripMessageTokens } from "@/lib/chat/searchTokens";
import { defaultThreadName } from "@/lib/chat/threads";
import { applyShortcodeMatches, emojiQueryAt, findClosingShortcode, findShortcodesForSend } from "@/lib/chat/emojiShortcodes";
import { createShortcodeResolver, getEmojiIndex } from "@/lib/chat/emojiIndex";
import { extractUserMentionIds } from "@/lib/services/messageSignals";

const UUID = "d1dde007-060d-4d12-9037-4c6d3b4bd8e3";
const HYPHEN_TOKEN = `<:soncresity-industries:${UUID}>`;
const USER = "11111111-1111-1111-1111-111111111111";
const ROLE = "22222222-2222-2222-2222-222222222222";
const CHANNEL = "33333333-3333-3333-3333-333333333333";

describe("custom emoji tokens (CORD-75 / CORD-76)", () => {
  test("hyphenated names and UUID or snowflake ids parse", () => {
    expect(parseCustomEmojiToken(HYPHEN_TOKEN)).toEqual({ animated: false, name: "soncresity-industries", id: UUID });
    expect(parseCustomEmojiToken("<a:party_blob:123456789012345678>")).toEqual({ animated: true, name: "party_blob", id: "123456789012345678" });
    expect(parseCustomEmojiToken("<:x:1>")).toBeNull(); // not an id
    expect(parseCustomEmojiToken("<:has space:" + UUID + ">")).toBeNull();
    expect([...`a ${HYPHEN_TOKEN} b <a:k:${UUID}>`.matchAll(customEmojiTokenRegex())].length).toBe(2);
  });

  test("names are made token-safe on save", () => {
    expect(normalizeCustomEmojiName("soncresity-industries")).toBe("soncresity-industries");
    expect(normalizeCustomEmojiName("my emoji!")).toBe("my_emoji_");
    expect(normalizeCustomEmojiName("   ")).toBe("");
    expect(normalizeCustomEmojiName("a".repeat(40)).length).toBe(32);
  });

  test("plain-text paths reduce hyphenated tokens to :name:", () => {
    expect(customEmojiTokensToNames(`hi ${HYPHEN_TOKEN}`)).toBe("hi :soncresity-industries:");
    expect(renderMentionText(`hi ${HYPHEN_TOKEN}`)).toBe("hi :soncresity-industries:");
    expect(stripMessageTokens(`hi ${HYPHEN_TOKEN}`)).toContain("soncresity-industries");
    expect(defaultThreadName(HYPHEN_TOKEN)).toBe(":soncresity-industries:");
  });

  test("the server stores hyphenated tokens exactly", async () => {
    const { sanitizeMessageContent } = await import("@/lib/api/channels");
    expect(sanitizeMessageContent(`look ${HYPHEN_TOKEN} <a:a-b:${UUID}>`)).toBe(`look ${HYPHEN_TOKEN} <a:a-b:${UUID}>`);
    expect(sanitizeMessageContent(`\\${HYPHEN_TOKEN}`)).toBe(`\\${HYPHEN_TOKEN}`);
  });

  test("shorthand :name:id is wrapped, full and escaped tokens are left alone", async () => {
    const { normalizeEmojiFormat } = await import("@/lib/services/emoji");
    expect(normalizeEmojiFormat(`:soncresity-industries:${UUID}`)).toBe(HYPHEN_TOKEN);
    expect(normalizeEmojiFormat(HYPHEN_TOKEN)).toBe(HYPHEN_TOKEN);
    expect(normalizeEmojiFormat(`<a:soncresity-industries:${UUID}>`)).toBe(`<a:soncresity-industries:${UUID}>`);
  });

  test("message emoji lookups merge (own first, stable identity)", () => {
    const own = [{ id: "a", url: "1" }];
    const viewer = [{ id: "a", url: "2" }, { id: "b", url: "3" }];
    const merged = mergeEmojiLookups(own, viewer);
    expect(merged).toEqual([{ id: "a", url: "1" }, { id: "b", url: "3" }]);
    expect(mergeEmojiLookups(own, viewer)).toBe(merged);
    expect(mergeEmojiLookups(undefined, viewer)).toBe(viewer);
    expect(mergeEmojiLookups(own, [])).toBe(own);
  });
});

describe("backslash escape: composer", () => {
  const index = getEmojiIndex();
  const opts = {
    resolve: createShortcodeResolver(index, { customEmojis: [{ id: UUID, name: "soncresity-industries", url: "u" }] }),
  };

  test("\\:sob: is not converted or autocompleted while typing", () => {
    expect(findClosingShortcode("\\:sob:", 6, opts)).toBeNull();
    expect(emojiQueryAt("\\:so", 4)).toBeNull();
  });

  test("on send the backslash stays in front of the emoji / token", () => {
    const send = (t: string) => applyShortcodeMatches(t, findShortcodesForSend(t, opts));
    expect(send("\\:sob:")).toBe("\\😭");
    expect(send("\\:soncresity-industries:")).toBe(`\\${HYPHEN_TOKEN}`);
    expect(send(":sob: \\:sob:")).toBe("😭 \\😭");
  });

  const lookup = {
    users: [{ id: USER, username: "serika", displayName: "Serika Chan" }],
    roles: [{ id: ROLE, name: "Mods" }],
    channels: [{ id: CHANNEL, name: "general" }],
  };

  test("\\@user, \\@role and \\#channel become raw markup", () => {
    expect(resolveEscapedMentions("hi \\@serika!", lookup)).toBe(`hi \\<@${USER}>!`);
    expect(resolveEscapedMentions("\\@Serika Chan yo", lookup)).toBe(`\\<@${USER}> yo`);
    expect(resolveEscapedMentions("\\@mods", lookup)).toBe(`\\<@&${ROLE}>`);
    expect(resolveEscapedMentions("see \\#general.", lookup)).toBe(`see \\<#${CHANNEL}>.`);
  });

  test("unknown names, partial names, @everyone, code and plain mentions stay", () => {
    expect(resolveEscapedMentions("\\@nobody", lookup)).toBe("\\@nobody");
    expect(resolveEscapedMentions("\\@serikachan", lookup)).toBe("\\@serikachan");
    expect(resolveEscapedMentions("\\@everyone \\@here", lookup)).toBe("\\@everyone \\@here");
    expect(resolveEscapedMentions("`\\@serika`", lookup)).toBe("`\\@serika`");
    expect(resolveEscapedMentions("@serika", lookup)).toBe("@serika");
    expect(findEscapedMentions("a \\@serika b \\#general", lookup).map((m) => [m.start, m.end])).toEqual([[2, 10], [13, 22]]);
  });
});

describe("backslash escape: rendering", () => {
  test("escaped tokens and emoji become literal nodes", () => {
    expect(parseInlineMarkdown(`a \\<@${USER}> b`)).toEqual([
      { type: "text", content: "a " },
      { type: "escaped", content: `<@${USER}>` },
      { type: "text", content: " b" },
    ]);
    expect(parseInlineMarkdown(`\\${HYPHEN_TOKEN}`)).toEqual([{ type: "escaped", content: HYPHEN_TOKEN }]);
    expect(parseInlineMarkdown(`\\<@&${ROLE}>`)[0]).toEqual({ type: "escaped", content: `<@&${ROLE}>` });
    expect(parseInlineMarkdown(`\\<#${CHANNEL}>`)[0]).toEqual({ type: "escaped", content: `<#${CHANNEL}>` });
    expect(parseInlineMarkdown("\\😭 hi")[0]).toEqual({ type: "escaped", content: "😭" });
    expect(parseInlineMarkdown("\\👍🏽")[0]).toEqual({ type: "escaped", content: "👍🏽" });
  });

  test("ordinary markdown escapes still work", () => {
    expect(parseInlineMarkdown("\\*not italic\\*")).toEqual([{ type: "text", content: "*not italic*" }]);
    expect(parseInlineMarkdown("\\_x\\_ \\`y\\`")).toEqual([{ type: "text", content: "_x_ `y`" }]);
  });

  test("previews show escaped mentions literally", () => {
    expect(renderMentionText(`\\<@${USER}> and <@${USER}>`, { users: { [USER]: "Serika" } })).toBe(`<@${USER}> and @Serika`);
  });
});

describe("backslash escape: no pings", () => {
  test("escaped mentions are dropped before mention extraction", () => {
    expect(stripEscapedMentions(`\\<@${USER}> <@${ROLE}> \\<@&${ROLE}> \\<#${CHANNEL}>`)).toBe(` <@${ROLE}>  `);
    expect(extractUserMentionIds(`\\<@${USER}>`)).toEqual([]);
    expect(extractUserMentionIds(`\\<@${USER}> <@${USER}>`)).toEqual([USER]);
  });

  test("channel mention extraction ignores escaped mentions", async () => {
    const { extractMentionsFromContent } = await import("@/lib/api/channels");
    const res = await extractMentionsFromContent(`\\<@${USER}> \\<@&${ROLE}> \\<#${CHANNEL}> \\@everyone`, null);
    expect(res).toEqual({ mentionEveryone: false, mentionedUserIds: [], mentionedRoleIds: [], mentionedChannelIds: [] });
  });
});

describe("emoji in one-line previews", () => {
  test("custom and Unicode emoji split out of the text", () => {
    expect(splitEmojiSegments(`hi ${HYPHEN_TOKEN} 😭 👍🏽 🇺🇸`)).toEqual([
      { kind: "text", text: "hi " },
      { kind: "custom", name: "soncresity-industries", id: UUID, animated: false },
      { kind: "text", text: " " },
      { kind: "unicode", char: "😭" },
      { kind: "text", text: " " },
      { kind: "unicode", char: "👍🏽" },
      { kind: "text", text: " " },
      { kind: "unicode", char: "🇺🇸" },
    ]);
  });

  test("tokens survive a formatter that strips underscores and spaces", () => {
    const p = protectEmojiTokens(`a  <:my_emoji:${UUID}>  _b_`);
    const formatted = p.text.replace(/[_*]/g, "").replace(/\s+/g, " ");
    expect(splitEmojiSegments(formatted, p.tokens)).toEqual([
      { kind: "text", text: "a " },
      { kind: "custom", name: "my_emoji", id: UUID, animated: false },
      { kind: "text", text: " b" },
    ]);
  });

  test("escaped emoji stay text", () => {
    expect(splitEmojiSegments("\\😭")).toEqual([{ kind: "text", text: "😭" }]);
  });
});

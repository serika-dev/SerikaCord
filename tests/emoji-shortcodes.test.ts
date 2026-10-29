import { describe, expect, test } from "bun:test";
import {
  applyShortcodeMatches,
  codeRanges,
  emojiQueryAt,
  findClosingShortcode,
  findShortcodesForSend,
  inUrl,
  skinToneFromName,
  type ShortcodeOptions,
} from "@/lib/chat/emojiShortcodes";
import {
  applySkinTone,
  buildEmojiIndex,
  canonicalName,
  createEmojiSearch,
  createRetone,
  createShortcodeResolver,
  getEmojiIndex,
  lookupShortcode,
  nameMatchScore,
  primaryName,
  rankEmojiSuggestions,
  MATCH_CONTAINS,
  MATCH_EXACT,
  MATCH_PREFIX,
  MATCH_WORD,
} from "@/lib/chat/emojiIndex";
import { EMOJI_ALIAS_LINES } from "@/lib/chat/emojiAliases";
import { EMOJI_NAMES } from "@/lib/constants/emojis";

const index = getEmojiIndex();
const KEKW = { id: "11111111-1111-1111-1111-111111111111", name: "KEKW", url: "https://cdn.serika.chat/e/kekw.png" };
const PARTY = { id: "22222222-2222-2222-2222-222222222222", name: "partyblob", url: "https://cdn.serika.chat/e/p.gif", animated: true };
const opts: ShortcodeOptions = {
  resolve: createShortcodeResolver(index, { customEmojis: [KEKW, PARTY] }),
  retone: createRetone(index),
};

/** Type `text` and check what the closing colon at the end does. */
function close(text: string, o: ShortcodeOptions = opts) {
  return findClosingShortcode(text, text.length, o);
}

describe("alias resolution", () => {
  const cases: Array<[string, string]> = [
    ["sob", "😭"], ["puke", "🤮"], ["vomit", "🤮"], ["throw_up", "🤮"], ["face_vomiting", "🤮"],
    ["joy", "😂"], ["skull", "💀"], ["heart", "❤️"], ["+1", "👍"], ["thumbsup", "👍"], ["-1", "👎"],
    ["thumbsdown", "👎"], ["fire", "🔥"], ["pleading_face", "🥺"], ["pleading", "🥺"], ["sweat_smile", "😅"],
    ["eyes", "👀"], ["pray", "🙏"], ["100", "💯"], ["clown", "🤡"], ["nerd", "🤓"], ["moyai", "🗿"],
    ["sus", "🤨"], ["amogus", "📮"], ["salute", "🫡"], ["melting", "🫠"], ["shrug", "🤷"], ["facepalm", "🤦"],
    ["ok", "🆗"], ["tada", "🎉"], ["sparkles", "✨"], ["star", "⭐"], ["crying", "😢"], ["rofl", "🤣"],
    ["thinking", "🤔"], ["smirk", "😏"], ["angry", "😠"], ["mad", "😠"], ["sleepy", "😪"], ["yum", "😋"],
    ["heart_eyes", "😍"], ["kiss", "💋"], ["wink", "😉"], ["gun", "🔫"], ["pistol", "🔫"], ["cap", "🧢"],
    ["goat", "🐐"], ["flag_us", "🇺🇸"], ["cool", "🆒"], ["sparkle", "❇️"],
  ];
  test("Discord names and common aliases", () => {
    for (const [name, char] of cases) expect([name, lookupShortcode(index, name)]).toEqual([name, char]);
  });

  test("case-insensitive, - and _ interchangeable", () => {
    expect(lookupShortcode(index, "SOB")).toBe("😭");
    expect(lookupShortcode(index, "throw-up")).toBe("🤮");
    expect(lookupShortcode(index, "skin_tone_3")).toBe("🏽");
    expect(canonicalName("-1")).toBe("-1");
  });

  test("unknown names stay unknown", () => {
    expect(lookupShortcode(index, "definitely_not_an_emoji")).toBeNull();
    expect(lookupShortcode(index, "sob_tone3")).toBeNull(); // 😭 takes no skin tone
  });

  test("every alias line resolves to its own emoji, and legacy names still work", () => {
    for (const line of EMOJI_ALIAS_LINES) {
      const [char, first] = line.split(" ");
      expect(lookupShortcode(index, first)).toBe(char);
    }
    let legacyHits = 0;
    for (const name of Object.keys(EMOJI_NAMES)) if (lookupShortcode(index, name)) legacyHits++;
    expect(legacyHits).toBe(Object.keys(EMOJI_NAMES).length);
  });

  test("CLDR names cover emoji without a curated name", () => {
    expect(lookupShortcode(index, "woman_technologist")).toBe("👩‍💻");
    expect(lookupShortcode(index, "flag_united_states")).toBe("🇺🇸");
  });

  test("skin tones: _toneN suffix, default tone, apply/primary name", () => {
    expect(lookupShortcode(index, "thumbsup_tone3")).toBe("👍🏽");
    expect(lookupShortcode(index, "wave_tone2")).toBe("👋🏼");
    expect(lookupShortcode(index, "thumbsup", 5)).toBe("👍🏿");
    expect(lookupShortcode(index, "sob", 5)).toBe("😭");
    expect(applySkinTone("✌️", 1)).toBe("✌🏻");
    expect(applySkinTone("🧑‍💻", 4)).toBe("🧑🏾‍💻");
    expect(primaryName(index, "👍🏽")).toBe("thumbsup");
    expect(skinToneFromName("skin-tone-4")).toBe(4);
    expect(skinToneFromName("tone2")).toBe(2);
    expect(skinToneFromName("sob")).toBeNull();
  });

  test("the index builds fast enough to do once on demand", () => {
    const t = performance.now();
    buildEmojiIndex();
    expect(performance.now() - t).toBeLessThan(500);
  });
});

describe("closing-colon detection", () => {
  test("replaces :sob: when the second colon is typed", () => {
    expect(close("I'm so tired :sob:")).toEqual({ start: 13, end: 18, typed: ":sob:", emoji: { kind: "unicode", char: "😭" } });
  });

  test("start of message, after newline and after another emoji", () => {
    expect(close(":puke:")?.start).toBe(0);
    expect(close("hi\n:joy:")?.start).toBe(3);
    expect(close("😭:skull:")?.emoji).toEqual({ kind: "unicode", char: "💀" });
  });

  test("caret in the middle of the text", () => {
    const text = "a :fire: b";
    expect(findClosingShortcode(text, 8, opts)).toMatchObject({ start: 2, end: 8 });
    expect(findClosingShortcode(text, 9, opts)).toBeNull();
  });

  test("unknown names, a single colon and empty names are left alone", () => {
    expect(close("hello :notanemoji:")).toBeNull();
    expect(close("hello:")).toBeNull();
    expect(close("::")).toBeNull();
    expect(close("ratio: 2:")).toBeNull();
  });

  test("not glued to letters or digits (times, words)", () => {
    expect(close("meet at 12:30:")).toBeNull();
    expect(close("lol:sob:")).toBeNull();
    expect(close("1:100:")).toBeNull();
  });

  test("not inside code spans, code blocks or links", () => {
    expect(close("`:sob:")).toBeNull(); // open span being typed
    expect(close("`x` :sob:")).not.toBeNull(); // closed span before it
    expect(close("```\n:sob:")).toBeNull();
    expect(close("``a`b :sob:")).toBeNull(); // still inside the `` span
    expect(close("https://example.com/:sob:")).toBeNull();
    expect(close("www.example.com/a:b:sob:")).toBeNull();
  });

  test("not inside <…> tokens like timestamps", () => {
    expect(close("<t:1234:")).toBeNull();
    expect(close("<t:1700000000:R> :tada:")).not.toBeNull();
  });

  test("custom emoji: exact case first, case-insensitive fallback", () => {
    expect(close(":KEKW:")?.emoji).toEqual({ kind: "custom", emoji: { ...KEKW, animated: undefined } });
    expect(close(":kekw:")?.emoji).toMatchObject({ kind: "custom", emoji: { id: KEKW.id } });
    expect(close(":partyblob:")?.emoji).toMatchObject({ kind: "custom", emoji: { animated: true } });
  });

  test("Unicode wins over a custom emoji with the same name", () => {
    const o = { resolve: createShortcodeResolver(index, { customEmojis: [{ id: "x", name: "fire", url: "u" }] }) };
    expect(close(":fire:", o)?.emoji).toEqual({ kind: "unicode", char: "🔥" });
  });

  test(":skin-tone-N: right after an emoji re-tones it", () => {
    expect(close("hey 👍:skin-tone-3:")).toEqual({ start: 4, end: 19, typed: "👍:skin-tone-3:", emoji: { kind: "unicode", char: "👍🏽" } });
    expect(close("👋🏻:skin-tone-5:")?.emoji).toEqual({ kind: "unicode", char: "👋🏿" });
    // No tone-able emoji before it: the modifier on its own.
    expect(close("hi :skin-tone-2:")?.emoji).toEqual({ kind: "unicode", char: "🏼" });
    expect(close("😭:skin-tone-2:")?.emoji).toEqual({ kind: "unicode", char: "🏼" });
  });

  test("custom emoji tokens before the shortcode are not mistaken for one", () => {
    expect(close("<:KEKW:11111111-1111-1111-1111-111111111111> :sob:")?.start).toBe(45);
  });
});

describe("conversion on send", () => {
  const convert = (text: string) => applyShortcodeMatches(text, findShortcodesForSend(text, opts));

  test("several shortcodes, back to back", () => {
    expect(convert("hi :sob: and :joy:")).toBe("hi 😭 and 😂");
    expect(convert(":sob::joy::skull:")).toBe("😭😂💀");
  });

  test("positions are ascending and non-overlapping", () => {
    const m = findShortcodesForSend("a :fire: b :100:", opts);
    expect(m.map((x) => [x.start, x.end])).toEqual([[2, 8], [11, 16]]);
  });

  test("unknown names stay, and don't swallow the next shortcode", () => {
    expect(convert(":nope: :sob:")).toBe(":nope: 😭");
    expect(convert(":nope:sob:")).toBe(":nope:sob:");
  });

  test("skips code, links, tokens and times", () => {
    expect(convert("`:sob:` :sob:")).toBe("`:sob:` 😭");
    expect(convert("```\n:sob:\n``` :joy:")).toBe("```\n:sob:\n``` 😂");
    expect(convert("an unclosed ` :sob:")).toBe("an unclosed ` 😭");
    expect(convert("see https://x.y/:sob: ok")).toBe("see https://x.y/:sob: ok");
    expect(convert("<t:1700000000:R> at 10:100:")).toBe("<t:1700000000:R> at 10:100:");
  });

  test("skin tones: :thumbsup::skin-tone-3: and :wave_tone2:", () => {
    expect(convert(":thumbsup::skin-tone-3:")).toBe("👍🏽");
    expect(convert(":wave_tone2: :sob::skin-tone-1:")).toBe("👋🏼 😭🏻");
  });

  test("custom emoji become tokens", () => {
    expect(convert("gg :KEKW: :partyblob:")).toBe(`gg <:KEKW:${KEKW.id}> <a:partyblob:${PARTY.id}>`);
  });
});

describe("autocomplete trigger", () => {
  test("opens after a colon and two name characters", () => {
    expect(emojiQueryAt(":s", 2)).toBeNull();
    expect(emojiQueryAt(":so", 3)).toEqual({ start: 0, query: "so" });
    expect(emojiQueryAt("hi :pu", 6)).toEqual({ start: 3, query: "pu" });
    expect(emojiQueryAt("hi :+1", 6)).toEqual({ start: 3, query: "+1" });
  });

  test("closed after the closing colon, in code, links, words", () => {
    expect(emojiQueryAt(":sob:", 5)).toBeNull();
    expect(emojiQueryAt("`:sob", 5)).toBeNull();
    expect(emojiQueryAt("http://a:bc", 11)).toBeNull();
    expect(emojiQueryAt("word:sob", 8)).toBeNull();
    expect(emojiQueryAt("12:30", 5)).toBeNull();
  });

  test("uses the caret, not the end of the text", () => {
    expect(emojiQueryAt(":sob and more", 4)).toEqual({ start: 0, query: "sob" });
  });
});

describe("ranking", () => {
  test("match tiers: exact > prefix > word start > contains", () => {
    expect(nameMatchScore("sob", "sob")).toBe(MATCH_EXACT);
    expect(nameMatchScore("sobbing", "sob")).toBeGreaterThanOrEqual(MATCH_PREFIX);
    const word = nameMatchScore("pleading_face", "face");
    expect(word).toBeGreaterThanOrEqual(MATCH_WORD);
    expect(word).toBeLessThan(MATCH_PREFIX);
    const contains = nameMatchScore("unamused", "am");
    expect(contains).toBeGreaterThanOrEqual(MATCH_CONTAINS);
    expect(contains).toBeLessThan(MATCH_WORD);
    expect(nameMatchScore("sob", "x")).toBe(0);
    expect(nameMatchScore("relaxed", "x")).toBe(0); // one letter: no "contains"
  });

  test("exact name first, with aliases as the hint", () => {
    const [top] = rankEmojiSuggestions(index, "puke");
    expect(top).toMatchObject({ kind: "unicode", char: "🤮", name: "puke", aliases: ["face_vomiting"] });
    const [sob] = rankEmojiSuggestions(index, "sob");
    expect(sob).toMatchObject({ char: "😭", name: "sob" });
  });

  test("shows the Discord name when several names match equally", () => {
    const [top] = rankEmojiSuggestions(index, "thumb");
    expect(top).toMatchObject({ char: "👍", name: "thumbsup" });
  });

  test("favourites and frequently used float up within a tier", () => {
    const plain = rankEmojiSuggestions(index, "smi").map((s) => (s.kind === "unicode" ? s.char : s.name));
    const fav = rankEmojiSuggestions(index, "smi", { favorites: new Set(["😈"]) });
    expect(plain[0]).not.toBe("😈");
    expect(fav[0]).toMatchObject({ char: "😈", favorite: true });
    const frequent = rankEmojiSuggestions(index, "smi", { frecency: new Map([["😼", 800]]) });
    expect(frequent[0]).toMatchObject({ char: "😼" });
    // A boost never beats an exact match.
    const exact = rankEmojiSuggestions(index, "smile", { favorites: new Set(["😈"]), frecency: new Map([["😈", 10_000]]) });
    expect(exact[0]).toMatchObject({ char: "😄" });
  });

  test("custom emoji: current server above other servers", () => {
    const other = { id: "o", name: "blobwave", url: "u", serverName: "Other" };
    const local = { id: "l", name: "blobwave2", url: "u" };
    const ranked = rankEmojiSuggestions(index, "blobw", { customEmojis: [other, local], localEmojiIds: new Set(["l"]) });
    expect(ranked.map((r) => r.key)).toEqual(["c:l", "c:o"]);
  });

  test("limit and no results", () => {
    expect(rankEmojiSuggestions(index, "a", { limit: 10 }).length).toBe(10);
    expect(rankEmojiSuggestions(index, "zzzzqqq")).toEqual([]);
    expect(rankEmojiSuggestions(index, "")).toEqual([]);
  });
});

describe("picker search", () => {
  test("aliases and keywords match", () => {
    const puke = createEmojiSearch(index, "puke");
    expect(puke("🤮")).toBe(true);
    expect(puke("😀")).toBe(false);
    expect(createEmojiSearch(index, "sick")("🤮")).toBe(true); // keyword
    expect(createEmojiSearch(index, "face vomiting")("🤮")).toBe(true);
    expect(createEmojiSearch(index, "thumbs")("👍🏽")).toBe(true);
    expect(createEmojiSearch(index, "")("😀")).toBe(true);
  });
});

describe("code ranges", () => {
  test("inline spans, fences and open spans", () => {
    expect(codeRanges("a `b` c")).toEqual({ ranges: [[2, 5]], openFrom: null });
    expect(codeRanges("```js\nx\n``` `y")).toEqual({ ranges: [[0, 11]], openFrom: 12 });
    expect(codeRanges("``a`b``")).toEqual({ ranges: [[0, 7]], openFrom: null });
  });

  test("links", () => {
    expect(inUrl("go to https://a.b/c:d: now", 18)).toBe(true);
    expect(inUrl("go to :d: now", 6)).toBe(false);
  });
});

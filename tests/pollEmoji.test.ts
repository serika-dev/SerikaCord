import { describe, expect, test } from "bun:test";
import {
  cleanPollEmoji,
  isPollEmojiUrl,
  isPollUnicodeEmoji,
  normalizePollInput,
  parsePollResult,
  parseStoredPoll,
  pollCustomEmojiTokens,
  withResolvedPollEmojis,
  type StoredPoll,
} from "@/lib/chat/polls";

const CDN = "https://cdn.serika.chat";
const EMOJI_ID = "0f8b6c1e-2a3d-4b5c-8d9e-0123456789ab";
const OTHER_ID = "11111111-2222-4333-8444-555555555555";

function poll(answers: StoredPoll["answers"]): StoredPoll {
  return { question: "q", answers, allowMultiselect: false, expiresAt: "2026-01-01T00:00:00.000Z", finalizedAt: null };
}

describe("unicode poll emoji", () => {
  test("accepts single emoji, including ZWJ sequences, flags, keycaps and skin tones", () => {
    for (const e of ["🌮", "👍🏽", "👨‍👩‍👧‍👦", "🇯🇵", "1️⃣", "❤️", "🏴󠁧󠁢󠁥󠁮󠁧󠁿"]) {
      expect(isPollUnicodeEmoji(e)).toBe(true);
    }
  });

  test("rejects text, URLs, markup, several emoji and long strings", () => {
    for (const e of ["a", "hello", "https://evil.example/x.png", "<script>", "🌮🌮", "🌮a", "", "🌮".repeat(9)]) {
      expect(isPollUnicodeEmoji(e)).toBe(false);
    }
  });
});

describe("custom poll emoji URLs", () => {
  test("only our CDN over https", () => {
    expect(isPollEmojiUrl(`${CDN}/emojis/abc.webp`)).toBe(true);
    expect(isPollEmojiUrl("https://evil.example/track.png")).toBe(false);
    expect(isPollEmojiUrl("https://cdn.serika.chat.evil.example/x.png")).toBe(false);
    expect(isPollEmojiUrl("javascript:alert(1)")).toBe(false);
    expect(isPollEmojiUrl(`${CDN}/emojis/a b.png`)).toBe(false);
    expect(isPollEmojiUrl(undefined)).toBe(false);
    // A configured CDN other than the default.
    expect(isPollEmojiUrl("https://media.example/e.png", "https://media.example")).toBe(true);
  });
});

describe("cleanPollEmoji", () => {
  test("a create request never keeps a client-supplied URL", () => {
    const e = cleanPollEmoji({ id: EMOJI_ID, name: "party", animated: true, url: `${CDN}/emojis/x.gif` }, { trustUrl: false });
    expect(e).toEqual({ id: EMOJI_ID, name: "party", animated: true });
  });

  test("a stored URL is kept only on our CDN", () => {
    expect(cleanPollEmoji({ id: EMOJI_ID, name: "p", url: `${CDN}/emojis/x.png` }, { trustUrl: true })?.url).toBe(`${CDN}/emojis/x.png`);
    expect(cleanPollEmoji({ id: EMOJI_ID, name: "p", url: "https://evil.example/x.png" }, { trustUrl: true })).toEqual({ id: EMOJI_ID, name: "p" });
  });

  test("bad ids and non-emoji unicode names are dropped", () => {
    expect(cleanPollEmoji({ id: "not an id!", name: "x" })).toBeNull();
    expect(cleanPollEmoji({ name: "https://evil.example/x.png" })).toBeNull();
    expect(cleanPollEmoji({ name: "🌮" })).toEqual({ name: "🌮" });
  });

  test("normalizePollInput strips URLs; parseStoredPoll drops off-CDN ones from old rows", () => {
    const r = normalizePollInput({ question: "q", answers: [{ text: "a", emoji: { id: EMOJI_ID, name: "p", url: "https://evil.example/x.png" } }] });
    if (!("poll" in r)) throw new Error("expected a poll");
    expect(r.poll.answers[0].emoji).toEqual({ id: EMOJI_ID, name: "p" });

    const stored = parseStoredPoll(poll([{ id: 1, text: "a", emoji: { id: EMOJI_ID, name: "p", url: "https://evil.example/x.png" } }]));
    expect(stored?.answers[0].emoji).toEqual({ id: EMOJI_ID, name: "p" });

    const result = parsePollResult({
      kind: "result",
      pollMessageId: "m",
      question: "q",
      answers: [{ id: 1, text: "a", votes: 1, emoji: { id: EMOJI_ID, name: "p", url: "https://evil.example/x.png" } }],
    });
    expect(result?.answers[0].emoji).toEqual({ id: EMOJI_ID, name: "p" });
  });
});

describe("resolving custom poll emoji", () => {
  const p = poll([
    { id: 1, text: "a", emoji: { id: EMOJI_ID, name: "party" } },
    { id: 2, text: "b", emoji: { id: OTHER_ID, name: "nope", animated: true } },
    { id: 3, text: "c", emoji: { name: "🌮" } },
    { id: 4, text: "d" },
  ]);

  test("lists custom emoji as message tokens", () => {
    expect(pollCustomEmojiTokens(p)).toBe(`<:party:${EMOJI_ID}> <a:nope:${OTHER_ID}>`);
    expect(pollCustomEmojiTokens(poll([{ id: 1, text: "a", emoji: { name: "🌮" } }]))).toBe("");
  });

  test("takes name, animated and URL from the server's record and drops emoji the author can't use", () => {
    const out = withResolvedPollEmojis(p, [{ id: EMOJI_ID.toUpperCase(), name: "real_name", animated: true, url: `${CDN}/emojis/e.gif` }], CDN);
    expect(out.answers).toEqual([
      { id: 1, text: "a", emoji: { id: EMOJI_ID.toUpperCase(), name: "real_name", animated: true, url: `${CDN}/emojis/e.gif` } },
      { id: 2, text: "b" },
      { id: 3, text: "c", emoji: { name: "🌮" } },
      { id: 4, text: "d" },
    ]);
  });

  test("drops a resolved emoji whose stored image is off our CDN", () => {
    const out = withResolvedPollEmojis(p, [{ id: EMOJI_ID, name: "party", url: "https://elsewhere.example/e.png" }], CDN);
    expect(out.answers[0]).toEqual({ id: 1, text: "a" });
  });
});

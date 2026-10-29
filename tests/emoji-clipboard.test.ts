import { describe, expect, test } from "bun:test";
import {
  CLIPBOARD_EMOJI_ATTR,
  collectClipSegments,
  customEmojiAlt,
  emojiClipboardPayload,
  emojiFromElement,
  hasCustomEmoji,
  htmlHasEmojiTokens,
  isSingleUnicodeEmoji,
  messageCopyPayload,
  segmentsToHtml,
  segmentsToPlainText,
  segmentsToTokenText,
  splitPastedText,
  type ClipNode,
} from "@/lib/chat/emojiClipboard";

const UUID = "d1dde007-060d-4d12-9037-4c6d3b4bd8e3";
const TOKEN = `<:blob-wave:${UUID}>`;
const ANIMATED = "<a:party_blob:123456789012345678>";

// A tiny DOM: enough for the walker (nodeType, nodeName, attributes, children).
function text(value: string): ClipNode {
  return { nodeType: 3, nodeName: "#text", nodeValue: value, textContent: value, childNodes: [] };
}
function el(tag: string, attrs: Record<string, string> = {}, children: ClipNode[] = []): ClipNode {
  return {
    nodeType: 1,
    nodeName: tag.toUpperCase(),
    textContent: children.map((c) => c.textContent ?? "").join(""),
    childNodes: children,
    getAttribute: (name) => (name in attrs ? attrs[name] : null),
  };
}
const twemoji = (char: string) => el("img", { class: "emoji", alt: char, src: "https://cdn.example/1f600.svg" });
const customImg = (name: string, id: string, extra: Record<string, string> = {}) =>
  el("img", {
    class: "custom-emoji",
    alt: `:${name}:`,
    src: "https://cdn.serika.chat/emoji.webp",
    "data-emoji-id": id,
    "data-emoji-name": name,
    "data-emoji-url": "https://cdn.serika.chat/emoji.png",
    ...extra,
  });

describe("alt text", () => {
  test("custom emoji alt is :name:", () => {
    expect(customEmojiAlt("blob-wave")).toBe(":blob-wave:");
  });

  test("single Unicode emoji (tones, ZWJ, flags, keycaps)", () => {
    for (const e of ["😀", "👍🏽", "👩‍💻", "🏳️‍🌈", "🇳🇱", "1️⃣", "❤️"]) expect(isSingleUnicodeEmoji(e)).toBeTrue();
    for (const e of ["", "a", "😀😀", ":smile:", "Image", "😀 "]) expect(isSingleUnicodeEmoji(e)).toBeFalse();
  });

  test("an element → the emoji it shows", () => {
    expect(emojiFromElement(twemoji("😀"))).toEqual({ kind: "text", text: "😀" });
    expect(emojiFromElement(customImg("blob-wave", UUID))).toEqual({
      kind: "custom",
      id: UUID,
      name: "blob-wave",
      animated: false,
      url: "https://cdn.serika.chat/emoji.png",
    });
    // The composer's image carries the whole token.
    expect(emojiFromElement(el("img", { "data-emoji-token": ANIMATED, src: "https://x/a.gif", alt: ":party_blob:" }))).toEqual({
      kind: "custom",
      id: "123456789012345678",
      name: "party_blob",
      animated: true,
      url: "https://x/a.gif",
    });
    // Clipboard HTML span (no image URL).
    expect(emojiFromElement(el("span", { [CLIPBOARD_EMOJI_ATTR]: TOKEN }, [text(":blob-wave:")]))).toEqual({
      kind: "custom",
      id: UUID,
      name: "blob-wave",
      animated: false,
      url: undefined,
    });
    expect(emojiFromElement(customImg("weird name!", UUID, { "data-emoji-animated": "true" }))).toMatchObject({ name: "weird_name_", animated: true });
    // Not emoji: avatars, attachments, plain spans.
    expect(emojiFromElement(el("img", { alt: "Image", src: "https://x/y.png" }))).toBeNull();
    expect(emojiFromElement(el("img", { alt: "" }))).toBeNull();
    expect(emojiFromElement(el("span", {}, [text("hi")]))).toBeNull();
  });
});

describe("selection → clipboard text", () => {
  test("Unicode and custom emoji images become text", () => {
    const segs = collectClipSegments([
      el("span", { class: "twemoji" }, [
        el("span", { class: "twemoji-text" }, [text("gg "), twemoji("🎉"), text(" ")]),
        customImg("blob-wave", UUID),
        el("span", { class: "twemoji-text" }, [text(" bye")]),
      ]),
    ]);
    expect(segmentsToPlainText(segs)).toBe("gg 🎉 :blob-wave: bye");
    expect(segmentsToTokenText(segs)).toBe(`gg 🎉 ${TOKEN} bye`);
    expect(hasCustomEmoji(segs)).toBeTrue();
  });

  test("jumbo emoji-only message", () => {
    const segs = collectClipSegments([el("span", { class: "twemoji-large" }, [twemoji("😭"), twemoji("😭"), customImg("blob-wave", UUID)])]);
    expect(segmentsToPlainText(segs)).toBe("😭😭:blob-wave:");
  });

  test("blocks start new lines, <br> is a newline, nothing doubles up", () => {
    const segs = collectClipSegments([
      el("div", {}, [el("span", {}, [text("alice")]), el("div", {}, [text("hi "), twemoji("👋")])]),
      el("div", {}, [el("p", {}, [text("line 1"), el("br"), text("line 2")])]),
      el("div", {}, [el("div", {}, [customImg("blob-wave", UUID)])]),
    ]);
    expect(segmentsToPlainText(segs)).toBe("alice\nhi 👋\nline 1\nline 2\n:blob-wave:");
  });

  test("other images, icons, hidden and skipped parts are left out", () => {
    const segs = collectClipSegments([
      el("span", {}, [
        text("look "),
        el("img", { alt: "Image", src: "https://x/cat.png" }),
        el("svg", {}, [text("icon")]),
        el("span", { "aria-hidden": "true" }, [text("hidden")]),
        el("span", { "data-copy-skip": "" }, [text("skip")]),
        el("button", {}, [el("span", {}, [text("@bob")])]),
        twemoji("😺"),
      ]),
    ]);
    expect(segmentsToPlainText(segs)).toBe("look @bob😺");
  });

  test("text slices and a skip predicate (a live selection)", () => {
    const first = text("hello world ");
    const last = text(" tail end");
    const outside = el("span", {}, [text("not selected")]);
    const segs = collectClipSegments([first, twemoji("🔥"), last, outside], {
      textSlice: (node) => (node === first ? [6, 12] : node === last ? [0, 5] : null),
      skip: (node) => node === outside,
    });
    expect(segmentsToPlainText(segs)).toBe("world 🔥 tail");
  });

  test("HTML keeps custom emoji tokens and escapes text", () => {
    const html = segmentsToHtml([
      { kind: "text", text: "<b>hi</b> & \"x\"\nnext" },
      { kind: "custom", name: "blob-wave", id: UUID, animated: false, url: "https://cdn.serika.chat/e.png" },
      { kind: "custom", name: "party_blob", id: "123456789012345678", animated: true },
    ]);
    expect(html).toContain("&lt;b&gt;hi&lt;/b&gt; &amp; &quot;x&quot;<br>next");
    expect(html).toContain(`<img src="https://cdn.serika.chat/e.png" alt=":blob-wave:"`);
    expect(html).toContain(`${CLIPBOARD_EMOJI_ATTR}="&lt;:blob-wave:${UUID}&gt;"`);
    expect(html).toContain(`<span ${CLIPBOARD_EMOJI_ATTR}="&lt;a:party_blob:123456789012345678&gt;">:party_blob:</span>`);
    expect(htmlHasEmojiTokens(html)).toBeTrue();
    expect(htmlHasEmojiTokens("<b>plain</b>")).toBeFalse();
  });

  test("unsafe image URLs are not put in HTML", () => {
    const html = segmentsToHtml([{ kind: "custom", name: "x", id: UUID, animated: false, url: "javascript:alert(1)" }]);
    expect(html).not.toContain("javascript:");
    expect(html).toContain(`>:x:</span>`);
  });
});

describe("Copy Text and Copy Emoji", () => {
  test("message Copy Text: tokens → :name:, token kept in HTML, escapes untouched", () => {
    const payload = messageCopyPayload(`hi ${TOKEN} and ${ANIMATED} 😀 \\${TOKEN}`);
    expect(payload.text).toBe(`hi :blob-wave: and :party_blob: 😀 \\${TOKEN}`);
    expect(payload.html).toContain(`${CLIPBOARD_EMOJI_ATTR}="&lt;:blob-wave:${UUID}&gt;"`);
    expect(payload.html).toContain(`${CLIPBOARD_EMOJI_ATTR}="&lt;a:party_blob:123456789012345678&gt;"`);
    expect(messageCopyPayload("no emoji here").text).toBe("no emoji here");
  });

  test("single emoji payloads", () => {
    expect(emojiClipboardPayload({ kind: "unicode", char: "👍🏻" })).toEqual({ text: "👍🏻", html: "👍🏻" });
    const custom = emojiClipboardPayload({ kind: "custom", name: "blob-wave", id: UUID, url: "https://cdn.serika.chat/e.png" });
    expect(custom.text).toBe(":blob-wave:");
    expect(custom.html).toContain(`${CLIPBOARD_EMOJI_ATTR}="&lt;:blob-wave:${UUID}&gt;"`);
  });
});

describe("paste token parsing", () => {
  test("plain text tokens become custom emoji; escaped ones stay text", () => {
    expect(splitPastedText(`a ${TOKEN} b ${ANIMATED}`)).toEqual([
      { kind: "text", text: "a " },
      { kind: "custom", animated: false, name: "blob-wave", id: UUID },
      { kind: "text", text: " b " },
      { kind: "custom", animated: true, name: "party_blob", id: "123456789012345678" },
    ]);
    expect(splitPastedText(`\\${TOKEN}`)).toEqual([{ kind: "text", text: `\\${TOKEN}` }]);
    expect(splitPastedText("just text")).toEqual([{ kind: "text", text: "just text" }]);
    expect(splitPastedText("")).toEqual([]);
  });

  test("copied HTML (parsed) round-trips to the same token text", () => {
    // What a DOMParser gives back for segmentsToHtml output.
    const parsed = [
      el("span", { style: "white-space:pre-wrap" }, [
        text("hi "),
        el("img", { src: "https://cdn.serika.chat/e.png", alt: ":blob-wave:", [CLIPBOARD_EMOJI_ATTR]: TOKEN }),
        text(" x"),
        el("br"),
        el("span", { [CLIPBOARD_EMOJI_ATTR]: ANIMATED }, [text(":party_blob:")]),
      ]),
    ];
    const segs = collectClipSegments(parsed);
    expect(segmentsToTokenText(segs)).toBe(`hi ${TOKEN} x\n${ANIMATED}`);
    expect(segs[1]).toMatchObject({ kind: "custom", url: "https://cdn.serika.chat/e.png" });
  });
});

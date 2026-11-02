import { describe, expect, test } from "bun:test";
import {
  DUPLICATE_ENTER_MS,
  classifyComposerElement,
  classifyRichContent,
  clearEnterKey,
  createEnterTracker,
  decideLineBreak,
  firstImageSrc,
  firstUriListUrl,
  graphemeDeleteRange,
  imageFileName,
  imageSourceAction,
  isDuplicateKeyEnter,
  isImeKeyDown,
  isLineBreakInput,
  lineBreakCommand,
  noteEdit,
  noteEnterKey,
  noteReplay,
  type EnterTracker,
} from "../src/lib/chat/composerIme";

/**
 * A model of RichComposer's keyboard handling, driven by the same pure rules:
 * the editor text, an open composition, and what the key handler does with
 * Enter ("send" = desktop / S Pen devices, "newline" = touch-only keyboards).
 * Events mirror what Chrome dispatches for each keyboard.
 */
class SimComposer {
  committed = "";
  composition: string | null = null;
  composingLinger = false;
  tracker: EnterTracker = createEnterTracker();
  pending: "insertParagraph" | "insertLineBreak" | null = null;
  sends: string[] = [];
  now = 0;
  constructor(public mode: "send" | "newline") {}

  get text() {
    return this.committed + (this.composition ?? "");
  }
  tick(ms = 16) {
    this.now += ms;
  }

  /** The container's key handler (ChatArea / DM page): Enter sends unless touch-only. */
  private chain(): boolean {
    if (this.mode !== "send") return false;
    const t = this.text.trim();
    if (t) this.sends.push(t);
    this.committed = "";
    this.composition = null;
    return true;
  }
  private newline() {
    this.committed += "\n";
  }

  keydown(e: { key: string; keyCode: number; isComposing?: boolean }) {
    this.tick();
    if (isImeKeyDown({ key: e.key, keyCode: e.keyCode, isComposing: !!e.isComposing }) || this.composingLinger) return { prevented: false };
    if (e.key === "Enter" && isDuplicateKeyEnter(this.tracker, this.now)) return { prevented: true };
    const prevented = e.key === "Enter" ? this.chain() : false;
    this.tracker = e.key === "Enter" ? noteEnterKey(this.tracker, this.now, prevented) : clearEnterKey(this.tracker);
    return { prevented };
  }
  keyup(key: string) {
    if (key === "Enter") this.tracker = clearEnterKey(this.tracker);
  }
  compositionStart() {
    this.composition = "";
    this.composingLinger = true;
  }
  compositionUpdate(text: string) {
    this.tick();
    this.composition = text;
    this.tracker = noteEdit(this.tracker);
  }
  compositionEnd(commit?: string) {
    this.tick();
    this.committed += commit ?? this.composition ?? "";
    this.composition = null;
    // The component runs this a tick later.
    this.composingLinger = false;
    this.flush();
  }
  insertText(text: string) {
    this.tick();
    this.committed += text;
    this.tracker = noteEdit(this.tracker);
  }
  private flush() {
    const p = this.pending;
    if (!p) return;
    this.pending = null;
    if (this.composition !== null) this.compositionEnd();
    const prevented = this.chain();
    this.tracker = noteReplay(this.tracker, this.now);
    if (!prevented) this.newline();
  }
  /** A line-break beforeinput; when not prevented the browser inserts the newline. */
  lineBreak(inputType = "insertParagraph", keyPrevented = false) {
    this.tick();
    if (keyPrevented) return; // Chrome sends no beforeinput for a prevented keydown
    const composing = this.composition !== null;
    const { tracker, action } = decideLineBreak(this.tracker, { at: this.now, composing });
    this.tracker = tracker;
    if (action === "native") return this.newline();
    if (action === "suppress") return;
    if (action === "replay") {
      const prevented = this.chain();
      this.tracker = noteReplay(this.tracker, this.now);
      if (!prevented) this.newline();
      return;
    }
    if (!this.pending) this.pending = lineBreakCommand(inputType);
  }
  timeout() {
    this.flush();
  }
}

function typeSamsungWord(c: SimComposer, word: string) {
  c.compositionStart();
  for (let i = 1; i <= word.length; i++) {
    c.keydown({ key: "Unidentified", keyCode: 229, isComposing: true });
    c.compositionUpdate(word.slice(0, i));
  }
}

describe("Enter from Samsung Keyboard (keydown 229 + beforeinput)", () => {
  test("Enter mid-composition, insertParagraph before compositionend: sends the committed (autocorrected) word once", () => {
    const c = new SimComposer("send");
    c.insertText("see you ");
    typeSamsungWord(c, "tmrw");
    c.keydown({ key: "Unidentified", keyCode: 229, isComposing: true });
    c.lineBreak("insertParagraph");
    expect(c.sends).toEqual([]); // waits for the committed text
    c.compositionEnd("tomorrow");
    expect(c.sends).toEqual(["see you tomorrow"]);
    expect(c.text).toBe("");
  });

  test("compositionend first, then keydown 229 + insertParagraph: one send, no stray newline", () => {
    const c = new SimComposer("send");
    typeSamsungWord(c, "hello");
    c.compositionEnd();
    c.keydown({ key: "Unidentified", keyCode: 229 });
    c.lineBreak("insertParagraph");
    expect(c.sends).toEqual(["hello"]);
    expect(c.text).toBe("");
  });

  test("insertLineBreak (some Samsung versions) behaves the same", () => {
    const c = new SimComposer("send");
    typeSamsungWord(c, "ok");
    c.compositionEnd();
    c.keydown({ key: "Unidentified", keyCode: 229 });
    c.lineBreak("insertLineBreak");
    expect(c.sends).toEqual(["ok"]);
  });

  test("an Enter echoed as a real keydown right after the replay doesn't send twice", () => {
    const d = new SimComposer("send");
    typeSamsungWord(d, "hi");
    d.compositionEnd();
    d.keydown({ key: "Unidentified", keyCode: 229 });
    d.lineBreak();
    const echo = d.keydown({ key: "Enter", keyCode: 13 });
    expect(echo.prevented).toBe(true);
    d.lineBreak("insertParagraph", true);
    expect(d.sends).toEqual(["hi"]);
  });

  test("two line-break inputs for one press are one Enter", () => {
    const c = new SimComposer("newline");
    c.insertText("a");
    c.keydown({ key: "Unidentified", keyCode: 229 });
    c.lineBreak();
    c.lineBreak();
    expect(c.text).toBe("a\n");
  });

  test("two separate Enters with typing between are two newlines", () => {
    const c = new SimComposer("newline");
    c.insertText("a");
    c.keydown({ key: "Unidentified", keyCode: 229 });
    c.lineBreak();
    c.insertText("b");
    c.keydown({ key: "Unidentified", keyCode: 229 });
    c.lineBreak();
    expect(c.text).toBe("a\nb\n");
  });

  test("Enter after the duplicate window is a new press even without typing", () => {
    const c = new SimComposer("newline");
    c.insertText("a");
    c.keydown({ key: "Unidentified", keyCode: 229 });
    c.lineBreak();
    c.tick(DUPLICATE_ENTER_MS + 50);
    c.keydown({ key: "Unidentified", keyCode: 229 });
    c.lineBreak();
    expect(c.text).toBe("a\n\n");
  });

  test("touch-only (Enter = newline): Samsung Enter mid-word gives word + newline, no send", () => {
    const c = new SimComposer("newline");
    typeSamsungWord(c, "line");
    c.keydown({ key: "Unidentified", keyCode: 229, isComposing: true });
    c.lineBreak();
    c.compositionEnd();
    expect(c.sends).toEqual([]);
    expect(c.text).toBe("line\n");
  });

  test("compositionend never arrives: the timeout commits and sends", () => {
    const c = new SimComposer("send");
    typeSamsungWord(c, "stuck");
    c.keydown({ key: "Unidentified", keyCode: 229, isComposing: true });
    c.lineBreak();
    c.timeout();
    expect(c.sends).toEqual(["stuck"]);
    expect(c.text).toBe("");
  });

  test("some IMEs commit a newline as insertText '\\n'", () => {
    expect(isLineBreakInput("insertText", "\n")).toBe(true);
    expect(isLineBreakInput("insertText", "a")).toBe(false);
    expect(isLineBreakInput("insertParagraph", null)).toBe(true);
    expect(isLineBreakInput("insertLineBreak", null)).toBe(true);
    expect(isLineBreakInput("insertCompositionText", "\n")).toBe(false);
    expect(lineBreakCommand("insertLineBreak")).toBe("insertLineBreak");
    expect(lineBreakCommand("insertText")).toBe("insertParagraph");
  });
});

describe("Enter from hardware keyboards and Gboard (no regressions)", () => {
  test("desktop Enter sends through the key handler; no beforeinput follows a prevented keydown", () => {
    const c = new SimComposer("send");
    c.insertText("hey");
    const k = c.keydown({ key: "Enter", keyCode: 13 });
    expect(k.prevented).toBe(true);
    c.lineBreak("insertParagraph", true);
    c.keyup("Enter");
    expect(c.sends).toEqual(["hey"]);
  });

  test("a line break after a prevented keydown (some browsers still send it) is suppressed", () => {
    const c = new SimComposer("send");
    c.insertText("hey");
    c.keydown({ key: "Enter", keyCode: 13 });
    c.lineBreak("insertParagraph");
    expect(c.sends).toEqual(["hey"]);
    expect(c.text).toBe("");
  });

  test("touch-only Enter (Gboard keyCode 13) is a native newline", () => {
    const c = new SimComposer("newline");
    c.insertText("one");
    c.keydown({ key: "Enter", keyCode: 13 });
    c.lineBreak();
    c.keyup("Enter");
    c.insertText("two");
    expect(c.text).toBe("one\ntwo");
    expect(c.sends).toEqual([]);
  });

  test("Japanese IME: the confirming Enter (229, composing) commits and never sends", () => {
    const c = new SimComposer("send");
    c.compositionStart();
    c.compositionUpdate("にほんご");
    c.keydown({ key: "Process", keyCode: 229, isComposing: true });
    c.compositionEnd("日本語");
    expect(c.sends).toEqual([]);
    expect(c.text).toBe("日本語");
    // The next Enter sends.
    c.keydown({ key: "Enter", keyCode: 13 });
    expect(c.sends).toEqual(["日本語"]);
  });

  test("an Enter keydown long before a line break doesn't claim it", () => {
    let t = noteEnterKey(createEnterTracker(), 0, true);
    const r = decideLineBreak(t, { at: 5000, composing: false });
    expect(r.action).toBe("replay");
    t = clearEnterKey(noteEnterKey(createEnterTracker(), 0, false));
    expect(decideLineBreak(t, { at: 10, composing: true }).action).toBe("defer");
  });

  test("isImeKeyDown", () => {
    expect(isImeKeyDown({ key: "Unidentified", keyCode: 229, isComposing: false })).toBe(true);
    expect(isImeKeyDown({ key: "Enter", keyCode: 13, isComposing: true })).toBe(true);
    expect(isImeKeyDown({ key: "Enter", keyCode: 13, isComposing: false })).toBe(false);
    expect(isImeKeyDown({ key: "a", keyCode: 65, isComposing: false })).toBe(false);
  });
});

describe("grapheme-aware deletion", () => {
  test("half of a surrogate pair widens to the whole emoji", () => {
    const text = "hi 😀";
    expect(graphemeDeleteRange(text, text.length - 1, text.length)).toEqual({ start: 3, end: 5 });
  });

  test("a ZWJ sequence and a skin tone go as one", () => {
    const dev = "a👩‍💻";
    expect(graphemeDeleteRange(dev, dev.length - 1, dev.length)).toEqual({ start: 1, end: dev.length });
    const thumbs = "👍🏽!";
    expect(graphemeDeleteRange(thumbs, 2, 4)).toEqual({ start: 0, end: 4 });
    const flag = "🇯🇵";
    expect(graphemeDeleteRange(flag, 2, 4)).toEqual({ start: 0, end: 4 });
  });

  test("whole graphemes and plain text are left as they are", () => {
    expect(graphemeDeleteRange("hello", 4, 5)).toEqual({ start: 4, end: 5 });
    expect(graphemeDeleteRange("a😀b", 1, 3)).toEqual({ start: 1, end: 3 });
    expect(graphemeDeleteRange("word one", 5, 8)).toEqual({ start: 5, end: 8 });
    expect(graphemeDeleteRange("é", 0, 1)).toEqual({ start: 0, end: 1 });
  });

  test("combining marks stay with their letter", () => {
    const e = "éx"; // e + combining acute
    expect(graphemeDeleteRange(e, 1, 2)).toEqual({ start: 0, end: 2 });
  });
});

describe("rich content from keyboards, paste and drop", () => {
  test("files win (keyboard GIF / sticker panels deliver image files)", () => {
    expect(classifyRichContent({ files: [{ type: "image/gif", name: "g.gif" }], text: "x" })).toEqual({ kind: "files" });
    expect(classifyRichContent({ files: [{ type: "image/webp", name: "sticker.webp" }] })).toEqual({ kind: "files" });
  });

  test("plain text and text-bearing HTML are text (never markup)", () => {
    expect(classifyRichContent({ files: [], text: "hello", html: "<b>hello</b>" })).toEqual({ kind: "text" });
    expect(classifyRichContent({ files: [], html: "<p>only html</p>" })).toEqual({ kind: "text" });
  });

  test("a bare GIF link (uri-list or an <img> alone) is inserted as a link", () => {
    expect(classifyRichContent({ files: [], uriList: "# comment\nhttps://media.tenor.com/x.gif\n" })).toEqual({ kind: "url", url: "https://media.tenor.com/x.gif" });
    expect(classifyRichContent({ files: [], html: '<meta charset="utf-8"><img src="https://i.giphy.com/a.gif?x=1&amp;y=2">' })).toEqual({ kind: "url", url: "https://i.giphy.com/a.gif?x=1&y=2" });
  });

  test("an inline data: image becomes an upload; unsafe sources are dropped", () => {
    expect(classifyRichContent({ files: [], html: '<img src="data:image/png;base64,AAAA">' })).toEqual({ kind: "image-data", url: "data:image/png;base64,AAAA" });
    expect(classifyRichContent({ files: [], html: '<img src="content://com.samsung.android.honeyboard/x">' })).toEqual({ kind: "none" });
    expect(classifyRichContent({ files: [], html: '<img src="javascript:alert(1)">' })).toEqual({ kind: "none" });
    expect(classifyRichContent({ files: [] })).toEqual({ kind: "none" });
  });

  test("helpers", () => {
    expect(firstUriListUrl("javascript:x\nhttps://a.example/b")).toBe("https://a.example/b");
    expect(firstUriListUrl("")).toBeNull();
    expect(firstImageSrc("<img alt='x' src='https://a/b.png'>")).toBe("https://a/b.png");
    expect(firstImageSrc("<p>no image</p>")).toBeNull();
    expect(imageSourceAction("blob:https://serika.chat/123")).toBe("upload");
    expect(imageSourceAction("data:text/html,<b>")).toBe("drop");
    expect(imageSourceAction("https://cdn.serika.chat/a.webp")).toBe("link");
    expect(imageFileName("image/jpeg", 5)).toBe("keyboard-5.jpg");
    expect(imageFileName("image/svg+xml", 5)).toBe("keyboard-5.svg");
    expect(imageFileName("image/gif", 5)).toBe("keyboard-5.gif");
  });
});

describe("foreign markup in the editor", () => {
  test("the composer's own nodes stay", () => {
    expect(classifyComposerElement({ nodeName: "IMG", emojiToken: "<:a:1>" })).toBe("keep");
    expect(classifyComposerElement({ nodeName: "SPAN", mentionToken: "<@1>" })).toBe("keep");
    expect(classifyComposerElement({ nodeName: "BR" })).toBe("keep");
    expect(classifyComposerElement({ nodeName: "DIV" })).toBe("keep");
    expect(classifyComposerElement({ nodeName: "SPAN", caretMarker: true })).toBe("keep");
  });

  test("a keyboard's <img> is an image to upload or link; styling is unwrapped; scripts go", () => {
    expect(classifyComposerElement({ nodeName: "IMG" })).toBe("image");
    expect(classifyComposerElement({ nodeName: "B" })).toBe("unwrap");
    expect(classifyComposerElement({ nodeName: "SPAN" })).toBe("unwrap");
    expect(classifyComposerElement({ nodeName: "FONT" })).toBe("unwrap");
    expect(classifyComposerElement({ nodeName: "A" })).toBe("unwrap");
    expect(classifyComposerElement({ nodeName: "SCRIPT" })).toBe("remove");
    expect(classifyComposerElement({ nodeName: "svg" })).toBe("remove");
  });
});

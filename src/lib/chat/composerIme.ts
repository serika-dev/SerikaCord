/**
 * Pure rules behind the composer's on-screen keyboard handling (RichComposer).
 *
 * Samsung Keyboard (and to a lesser degree Gboard) keeps whole words, even
 * whole sentences, in an IME composition, reports Enter and Backspace as
 * keyCode 229 with no key information, and inserts GIFs / stickers through
 * the paste path. These helpers decide what the composer does with each of
 * those events; the DOM work stays in the component.
 *
 * Covered by tests/composer-ime.test.ts.
 */

// ---------------------------------------------------------------------------
// Enter: one action per Enter press, whichever way the keyboard reports it.
//
// A hardware keyboard (and Gboard outside a composition) sends keydown Enter
// (keyCode 13): the composer's key handler sends or inserts a newline, and
// the browser's own `insertParagraph` follows only when nothing prevented it.
// Samsung Keyboard sends keydown 229 ("Unidentified") and then a `beforeinput`
// insertParagraph / insertLineBreak, before or after `compositionend`. That
// beforeinput is the real Enter: it is replayed through the same key handler,
// once, with the committed text.
// ---------------------------------------------------------------------------

/** A key handler Enter this recent is the one a line-break input belongs to. */
export const ENTER_KEY_WINDOW_MS = 1000;
/** A second Enter this soon after a replayed one, with no edit between, is the same press. */
export const DUPLICATE_ENTER_MS = 250;
/** How long a replay waits for `compositionend` before committing the composition itself. */
export const PENDING_ENTER_TIMEOUT_MS = 300;

export interface EnterTracker {
  /** The last Enter keydown the key handler saw (real key info, not 229). */
  key: { at: number; prevented: boolean } | null;
  /** When an IME Enter was last replayed through the key handler (or -1). */
  replayAt: number;
  /** Something was typed since that replay, so the next Enter is a new press. */
  editedSinceReplay: boolean;
}

export function createEnterTracker(): EnterTracker {
  return { key: null, replayAt: -1, editedSinceReplay: true };
}

/** `beforeinput` types that mean "the Enter key" (Samsung sends either; some IMEs commit "\n"). */
export function isLineBreakInput(inputType: string, data: string | null | undefined): boolean {
  if (inputType === "insertParagraph" || inputType === "insertLineBreak") return true;
  return inputType === "insertText" && (data === "\n" || data === "\r" || data === "\r\n");
}

/** The editing command that inserts the newline a line-break input asked for. */
export function lineBreakCommand(inputType: string): "insertParagraph" | "insertLineBreak" {
  return inputType === "insertLineBreak" ? "insertLineBreak" : "insertParagraph";
}

/**
 * A keydown with no usable key: keyCode 229 / key "Unidentified" (Android
 * IMEs), or anything fired inside a composition.
 */
export function isImeKeyDown(e: { key: string; keyCode: number; isComposing: boolean }): boolean {
  return e.isComposing || e.keyCode === 229 || e.key === "Unidentified" || e.key === "Process";
}

/**
 * A real Enter keydown is about to reach the key handler. True when it is the
 * echo of an Enter that was just replayed from a line-break input (some
 * keyboards send both), so it must be swallowed instead of sending twice.
 */
export function isDuplicateKeyEnter(t: EnterTracker, at: number): boolean {
  return t.replayAt >= 0 && !t.editedSinceReplay && at - t.replayAt < DUPLICATE_ENTER_MS;
}

/** The key handler saw an Enter keydown (and did or didn't prevent it). */
export function noteEnterKey(t: EnterTracker, at: number, prevented: boolean): EnterTracker {
  return { ...t, key: { at, prevented } };
}

/** Any other key, or the Enter key coming back up: the Enter it belonged to is over. */
export function clearEnterKey(t: EnterTracker): EnterTracker {
  return t.key ? { ...t, key: null } : t;
}

/** Text changed (typing, deleting, pasting): the next Enter is a new press. */
export function noteEdit(t: EnterTracker): EnterTracker {
  return t.editedSinceReplay ? t : { ...t, editedSinceReplay: true };
}

/** An IME Enter was replayed through the key handler. */
export function noteReplay(t: EnterTracker, at: number): EnterTracker {
  return { ...t, key: null, replayAt: at, editedSinceReplay: false };
}

/**
 * What to do with a line-break `beforeinput`:
 * - "native": the key handler already saw this Enter and let it through
 *   (Shift+Enter, Enter = newline on touch keyboards): the browser inserts it.
 * - "suppress": the key handler already acted on this Enter (sent), or it is
 *   a duplicate of a replayed Enter: no newline, nothing else.
 * - "replay": an IME Enter outside a composition: run the key handler now
 *   with a synthetic Enter; prevent the newline only if the handler did.
 * - "defer": an IME Enter inside a composition: prevent the newline, wait for
 *   the committed text (compositionend), then replay (and insert the newline
 *   with `lineBreakCommand` if the handler doesn't act on it).
 */
export type LineBreakAction = "native" | "suppress" | "replay" | "defer";

export function decideLineBreak(
  t: EnterTracker,
  input: { at: number; composing: boolean },
): { tracker: EnterTracker; action: LineBreakAction } {
  if (t.key && input.at - t.key.at < ENTER_KEY_WINDOW_MS) {
    return { tracker: { ...t, key: null }, action: t.key.prevented ? "suppress" : "native" };
  }
  if (t.replayAt >= 0 && !t.editedSinceReplay && input.at - t.replayAt < DUPLICATE_ENTER_MS) {
    return { tracker: t, action: "suppress" };
  }
  return { tracker: { ...t, key: null }, action: input.composing ? "defer" : "replay" };
}

// ---------------------------------------------------------------------------
// Backspace / Delete: whole graphemes.
// ---------------------------------------------------------------------------

type Segmenter = { segment(input: string): Iterable<{ index: number; segment: string }> };
let segmenter: Segmenter | null | undefined;
function getSegmenter(): Segmenter | null {
  if (segmenter === undefined) {
    const Ctor = (Intl as unknown as { Segmenter?: new (l?: string, o?: { granularity: string }) => Segmenter }).Segmenter;
    segmenter = Ctor ? new Ctor(undefined, { granularity: "grapheme" }) : null;
  }
  return segmenter;
}

/** Offsets in `text` where a grapheme (user-perceived character) starts, plus text.length. */
export function graphemeBoundaries(text: string): number[] {
  const out: number[] = [];
  const seg = getSegmenter();
  if (seg) {
    for (const s of seg.segment(text)) out.push(s.index);
  } else {
    // No Intl.Segmenter: at least never split a surrogate pair.
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      if (c >= 0xdc00 && c <= 0xdfff && i > 0) {
        const p = text.charCodeAt(i - 1);
        if (p >= 0xd800 && p <= 0xdbff) continue;
      }
      out.push(i);
    }
  }
  out.push(text.length);
  return out;
}

/**
 * A deletion of [start, end) in `text`, widened so it never cuts a grapheme
 * in half: a keyboard that deletes one UTF-16 unit (or one code point) of 👍🏽
 * or 👩‍💻 removes the whole emoji instead of leaving a broken half.
 */
export function graphemeDeleteRange(text: string, start: number, end: number): { start: number; end: number } {
  const lo = Math.max(0, Math.min(start, end, text.length));
  const hi = Math.min(text.length, Math.max(start, end, 0));
  if (lo === hi) return { start: lo, end: hi };
  const bounds = graphemeBoundaries(text);
  let s = 0;
  let e = text.length;
  for (const b of bounds) {
    if (b <= lo) s = b;
    if (b >= hi) {
      e = b;
      break;
    }
  }
  return { start: s, end: e };
}

// ---------------------------------------------------------------------------
// Rich content from the keyboard (GIF / sticker panels), paste and drop.
// ---------------------------------------------------------------------------

export interface RichContentInput {
  /** Files on the DataTransfer (MIME type + name). */
  files: ReadonlyArray<{ type: string; name: string }>;
  uriList?: string;
  html?: string;
  text?: string;
}

/**
 * - "files": attach them (the upload flow), whatever else came with them.
 * - "text": plain text (and SerikaCord's own HTML with custom emoji): the
 *   composer inserts it as text, never as markup.
 * - "url": only a link to an image or page (a keyboard GIF without the file):
 *   inserted as a link, like the GIF picker's.
 * - "image-data": an inline image (data: / blob:) with no file: fetched and
 *   attached.
 * - "none": nothing usable.
 */
export type RichContent =
  | { kind: "files" }
  | { kind: "text" }
  | { kind: "url"; url: string }
  | { kind: "image-data"; url: string }
  | { kind: "none" };

const WEB_URL = /^https?:\/\/[^\s"'<>]+$/i;

export function isWebUrl(value: string): boolean {
  return WEB_URL.test(value.trim());
}

/** The first http(s) link of a text/uri-list (comments start with #). */
export function firstUriListUrl(uriList: string | undefined): string | null {
  if (!uriList) return null;
  for (const raw of uriList.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (isWebUrl(line)) return line;
  }
  return null;
}

function decodeAttr(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

/** The `src` of the first <img> in an HTML fragment (no DOM; nothing loads). */
export function firstImageSrc(html: string | undefined): string | null {
  if (!html) return null;
  const m = /<img\b[^>]*?\bsrc\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(html);
  if (!m) return null;
  return decodeAttr((m[2] ?? m[3] ?? m[4] ?? "").trim()) || null;
}

/** Whether an HTML fragment has visible text besides its tags. */
function htmlHasText(html: string): boolean {
  const stripped = html
    .replace(/<(script|style|head|template)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;|&#160;/g, " ");
  return decodeAttr(stripped).trim().length > 0;
}

export function classifyRichContent(input: RichContentInput): RichContent {
  if (input.files.length > 0) return { kind: "files" };
  const text = input.text ?? "";
  if (text.trim()) return { kind: "text" };
  const uri = firstUriListUrl(input.uriList);
  if (uri) return { kind: "url", url: uri };
  const html = input.html ?? "";
  if (html) {
    if (htmlHasText(html)) return { kind: "text" };
    const src = firstImageSrc(html);
    if (src) {
      const action = imageSourceAction(src);
      if (action === "link") return { kind: "url", url: src };
      if (action === "upload") return { kind: "image-data", url: src };
    }
  }
  return { kind: "none" };
}

/**
 * What to do with an image source that ended up in the composer or on the
 * clipboard without a file: inline data is uploaded, a web URL becomes a
 * link, anything else (content://, file://, javascript:) is dropped.
 */
export function imageSourceAction(src: string): "upload" | "link" | "drop" {
  const s = src.trim();
  if (/^data:image\/[a-z0-9.+-]+[;,]/i.test(s) || /^blob:/i.test(s)) return "upload";
  if (isWebUrl(s)) return "link";
  return "drop";
}

/** A file name for an image fetched from a data: / blob: URL. */
export function imageFileName(mime: string, now: number): string {
  const sub = (mime.split("/")[1] || "png").split(/[;+]/)[0].toLowerCase();
  const ext = sub === "jpeg" ? "jpg" : /^[a-z0-9]{1,5}$/.test(sub) ? sub : "png";
  return `keyboard-${now}.${ext}`;
}

// ---------------------------------------------------------------------------
// Foreign markup: anything the browser or a WebView put in the editor that
// the composer didn't (an <img> from a keyboard sticker, <b>/<span style>
// from a paste that skipped our handler).
// ---------------------------------------------------------------------------

export type ComposerNodeAction = "keep" | "unwrap" | "image" | "remove";

const BLOCK_KEEP = new Set(["BR", "DIV", "P"]);
const REMOVE_TAGS = new Set([
  "SCRIPT", "STYLE", "META", "LINK", "TEMPLATE", "IFRAME", "OBJECT", "EMBED",
  "VIDEO", "AUDIO", "SVG", "CANVAS", "INPUT", "TEXTAREA", "SELECT", "BUTTON", "HEAD", "TITLE",
]);

/** How the composer treats an element found inside the editor. */
export function classifyComposerElement(el: {
  nodeName: string;
  emojiToken?: string | null;
  mentionToken?: string | null;
  caretMarker?: boolean;
}): ComposerNodeAction {
  const tag = el.nodeName.toUpperCase();
  if (el.caretMarker) return "keep";
  if (tag === "IMG") return el.emojiToken ? "keep" : "image";
  if (el.mentionToken) return "keep";
  if (BLOCK_KEEP.has(tag)) return "keep";
  if (REMOVE_TAGS.has(tag)) return "remove";
  return "unwrap";
}

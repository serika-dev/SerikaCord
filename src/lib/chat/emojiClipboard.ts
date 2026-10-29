/**
 * Copy and paste of emoji that are shown as images (twemoji, custom emoji,
 * reply previews, reactions, the composer). Pure: it works on a tiny DOM-like
 * node shape, so the same walker runs on live DOM, on a parsed paste and in
 * unit tests.
 *
 * Clipboard formats:
 * - text/plain: Unicode emoji as their characters, custom emoji as `:name:`.
 * - text/html: custom emoji keep their token in `data-serika-emoji`
 *   (`<:name:id>` / `<a:name:id>`), so pasting into SerikaCord's composer
 *   recreates the emoji; other apps see the image (or `:name:` text).
 */
import {
  customEmojiTokenRegex,
  formatCustomEmojiToken,
  isValidCustomEmojiName,
  normalizeCustomEmojiName,
  parseCustomEmojiToken,
} from "./customEmoji";
import { splitEmojiSegments } from "./emojiSegments";

/** The bit of a DOM node the walker reads (a real Node satisfies it). */
export interface ClipNode {
  nodeType: number;
  nodeName: string;
  nodeValue?: string | null;
  textContent: string | null;
  childNodes: ArrayLike<ClipNode>;
  getAttribute?: (name: string) => string | null;
}

export type ClipSegment =
  | { kind: "text"; text: string }
  | { kind: "custom"; name: string; id: string; animated: boolean; url?: string };

/** Marks a custom emoji in clipboard HTML; the value is its token. */
export const CLIPBOARD_EMOJI_ATTR = "data-serika-emoji";

const TEXT_NODE = 3;
const ELEMENT_NODE = 1;

/** Alt / title text of a custom emoji image. */
export function customEmojiAlt(name: string): string {
  return `:${name}:`;
}

/** True when `text` is exactly one Unicode emoji (with its tone / ZWJ parts). */
export function isSingleUnicodeEmoji(text: string): boolean {
  if (!text) return false;
  const segs = splitEmojiSegments(text);
  return segs.length === 1 && segs[0].kind === "unicode" && segs[0].char === text;
}

function attr(node: ClipNode, name: string): string | null {
  return node.getAttribute?.(name) ?? null;
}

function safeName(name: string): string {
  return isValidCustomEmojiName(name) ? name : normalizeCustomEmojiName(name) || "emoji";
}

/**
 * What an emoji element stands for: a custom emoji (token in
 * `data-serika-emoji` / `data-emoji-token`, or `data-emoji-id` +
 * `data-emoji-name`), a Unicode emoji (an image whose alt is the character),
 * or null when it isn't an emoji.
 */
export function emojiFromElement(node: ClipNode): ClipSegment | null {
  const token = attr(node, CLIPBOARD_EMOJI_ATTR) || attr(node, "data-emoji-token");
  const url = attr(node, "data-emoji-url") || (node.nodeName === "IMG" ? attr(node, "src") : null) || undefined;
  if (token) {
    const parsed = parseCustomEmojiToken(token);
    if (parsed) return { kind: "custom", ...parsed, url };
  }
  const id = attr(node, "data-emoji-id");
  const name = attr(node, "data-emoji-name");
  if (id && name) {
    return { kind: "custom", id, name: safeName(name), animated: attr(node, "data-emoji-animated") === "true", url };
  }
  if (node.nodeName === "IMG") {
    const alt = attr(node, "alt") ?? "";
    if (isSingleUnicodeEmoji(alt)) return { kind: "text", text: alt };
  }
  return null;
}

const BLOCK_TAGS = new Set([
  "ADDRESS", "ARTICLE", "ASIDE", "BLOCKQUOTE", "DD", "DETAILS", "DIV", "DL", "DT", "FIELDSET",
  "FIGCAPTION", "FIGURE", "FOOTER", "FORM", "H1", "H2", "H3", "H4", "H5", "H6", "HEADER", "HR",
  "LI", "MAIN", "NAV", "OL", "P", "PRE", "SECTION", "SUMMARY", "TABLE", "TR", "UL",
]);
const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "TEMPLATE", "NOSCRIPT", "HEAD", "TITLE", "META", "LINK", "SVG", "svg"]);

export interface ClipWalkOptions {
  /** The selected [start, end) part of a text node, or null when it's outside the selection. */
  textSlice?: (node: ClipNode) => readonly [number, number] | null;
  /** Leave this element and everything in it out (not selected, hidden). */
  skip?: (node: ClipNode) => boolean;
  /** Starts a new line (block-level). Defaults to a tag list. */
  isBlock?: (node: ClipNode) => boolean;
}

/**
 * Walk nodes in document order into text and custom emoji segments. Block
 * elements start a new line, `<br>` is a newline, emoji images become their
 * character or a custom emoji, other images, icons, scripts and
 * `data-copy-skip` / `aria-hidden` elements are left out.
 */
export function collectClipSegments(nodes: ArrayLike<ClipNode>, options: ClipWalkOptions = {}): ClipSegment[] {
  const out: ClipSegment[] = [];
  const isBlock = options.isBlock ?? ((n: ClipNode) => BLOCK_TAGS.has(n.nodeName.toUpperCase()));
  // Newlines a block boundary wants; written only once more content follows.
  let pendingBreak = false;

  const lastText = (): string => {
    for (let i = out.length - 1; i >= 0; i--) {
      const s = out[i];
      if (s.kind === "custom") return "x";
      if (s.text) return s.text;
    }
    return "";
  };
  const push = (seg: ClipSegment) => {
    if (seg.kind === "text" && !seg.text) return;
    if (pendingBreak) {
      pendingBreak = false;
      const before = lastText();
      if (before && !before.endsWith("\n")) pushText("\n");
    }
    if (seg.kind === "text") pushText(seg.text);
    else out.push(seg);
  };
  const pushText = (text: string) => {
    const last = out[out.length - 1];
    if (last?.kind === "text") last.text += text;
    else out.push({ kind: "text", text });
  };

  const walk = (list: ArrayLike<ClipNode>) => {
    for (let i = 0; i < list.length; i++) {
      const node = list[i];
      if (node.nodeType === TEXT_NODE) {
        const text = node.nodeValue ?? node.textContent ?? "";
        const slice = options.textSlice ? options.textSlice(node) : ([0, text.length] as const);
        if (slice) push({ kind: "text", text: text.slice(slice[0], slice[1]) });
        continue;
      }
      if (node.nodeType !== ELEMENT_NODE) continue;
      const tag = node.nodeName.toUpperCase();
      if (options.skip?.(node)) continue;
      const emoji = emojiFromElement(node);
      if (emoji) {
        push(emoji);
        continue;
      }
      if (SKIP_TAGS.has(tag) || SKIP_TAGS.has(node.nodeName)) continue;
      if (attr(node, "data-copy-skip") !== null || attr(node, "aria-hidden") === "true" || attr(node, "hidden") !== null) continue;
      if (tag === "BR") {
        pushText("\n");
        pendingBreak = false;
        continue;
      }
      if (tag === "IMG") continue;
      const block = isBlock(node);
      if (block) pendingBreak = true;
      walk(node.childNodes);
      if (block) pendingBreak = true;
    }
  };
  walk(nodes);
  return out;
}

/** True when any segment is a custom emoji (worth a rich clipboard payload). */
export function hasCustomEmoji(segments: readonly ClipSegment[]): boolean {
  return segments.some((s) => s.kind === "custom");
}

/** Segments → text/plain: custom emoji as `:name:`. */
export function segmentsToPlainText(segments: readonly ClipSegment[]): string {
  return segments.map((s) => (s.kind === "text" ? s.text : customEmojiAlt(s.name))).join("");
}

/** Segments → message text: custom emoji as their `<:name:id>` token. */
export function segmentsToTokenText(segments: readonly ClipSegment[]): string {
  return segments.map((s) => (s.kind === "text" ? s.text : formatCustomEmojiToken(s))).join("");
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Only http(s) image URLs go into clipboard HTML. */
function safeUrl(url: string | undefined): string | null {
  if (!url) return null;
  return /^https?:\/\//i.test(url) || url.startsWith("/") ? url : null;
}

/**
 * Segments → text/html. Text keeps its line breaks and spaces; a custom
 * emoji is an image (or `:name:` text when there's no URL) carrying its
 * token in `data-serika-emoji`.
 */
export function segmentsToHtml(segments: readonly ClipSegment[]): string {
  const body = segments
    .map((s) => {
      if (s.kind === "text") return escapeHtml(s.text).replace(/\r?\n/g, "<br>");
      const token = escapeHtml(formatCustomEmojiToken(s));
      const alt = escapeHtml(customEmojiAlt(s.name));
      const url = safeUrl(s.url);
      return url
        ? `<img src="${escapeHtml(url)}" alt="${alt}" title="${alt}" ${CLIPBOARD_EMOJI_ATTR}="${token}" width="22" height="22" style="vertical-align:middle">`
        : `<span ${CLIPBOARD_EMOJI_ATTR}="${token}">${alt}</span>`;
    })
    .join("");
  return `<span style="white-space:pre-wrap">${body}</span>`;
}

export interface ClipboardPayload {
  text: string;
  html: string;
}

export function segmentsToClipboard(segments: readonly ClipSegment[]): ClipboardPayload {
  return { text: segmentsToPlainText(segments), html: segmentsToHtml(segments) };
}

/**
 * "Copy Text" on a message: the raw text with each custom emoji token as
 * `:name:` (plain) and as a token-carrying span (HTML, so pasting into the
 * composer brings the emoji back). Escaped tokens (`\<:name:id>`) are left
 * as typed. `content` is already entity-decoded.
 */
export function messageCopyPayload(content: string): ClipboardPayload {
  const segments: ClipSegment[] = [];
  const pushText = (text: string) => {
    if (!text) return;
    const last = segments[segments.length - 1];
    if (last?.kind === "text") last.text += text;
    else segments.push({ kind: "text", text });
  };
  let at = 0;
  for (const m of content.matchAll(customEmojiTokenRegex())) {
    const index = m.index ?? 0;
    if (index > 0 && content[index - 1] === "\\") continue;
    pushText(content.slice(at, index));
    segments.push({ kind: "custom", animated: m[1] === "a", name: m[2], id: m[3] });
    at = index + m[0].length;
  }
  pushText(content.slice(at));
  return segmentsToClipboard(segments);
}

/**
 * Plain pasted text → segments: each (unescaped) custom emoji token becomes
 * a custom emoji the composer can show as an image when it knows the URL.
 */
export function splitPastedText(text: string): ClipSegment[] {
  const segments: ClipSegment[] = [];
  let at = 0;
  for (const m of text.matchAll(customEmojiTokenRegex())) {
    const index = m.index ?? 0;
    if (index > 0 && text[index - 1] === "\\") continue;
    if (index > at) segments.push({ kind: "text", text: text.slice(at, index) });
    segments.push({ kind: "custom", animated: m[1] === "a", name: m[2], id: m[3] });
    at = index + m[0].length;
  }
  if (at < text.length) segments.push({ kind: "text", text: text.slice(at) });
  return segments;
}

/** Clipboard HTML that carries custom emoji SerikaCord can restore. */
export function htmlHasEmojiTokens(html: string): boolean {
  return /data-(?:serika-emoji|emoji-token|emoji-id)\s*=/.test(html);
}

/** Clipboard payload for one emoji (right-click → Copy Emoji). */
export function emojiClipboardPayload(
  emoji: { kind: "unicode"; char: string } | { kind: "custom"; name: string; id: string; animated?: boolean; url?: string },
): ClipboardPayload {
  if (emoji.kind === "unicode") return { text: emoji.char, html: escapeHtml(emoji.char) };
  return segmentsToClipboard([{ kind: "custom", name: safeName(emoji.name), id: emoji.id, animated: Boolean(emoji.animated), url: emoji.url }]);
}

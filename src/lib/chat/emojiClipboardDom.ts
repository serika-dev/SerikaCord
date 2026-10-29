/**
 * Browser side of emoji copy/paste (the pure rules are in emojiClipboard.ts):
 * read a selection with its CSS (hidden and unselectable parts left out,
 * block layout → line breaks), parse pasted HTML, write a rich clipboard
 * payload, and the document-level copy handler for message text.
 */
import {
  collectClipSegments,
  emojiFromElement,
  htmlHasEmojiTokens,
  segmentsToClipboard,
  type ClipboardPayload,
  type ClipNode,
  type ClipSegment,
  type ClipWalkOptions,
} from "./emojiClipboard";

/** Elements that are (or may be) emoji images. */
const EMOJI_SELECTOR = "img.emoji, img.custom-emoji, img[data-emoji-token], img[data-emoji-id], img[alt], [data-serika-emoji]";

const asClip = (node: Node) => node as unknown as ClipNode;
const asNode = (node: ClipNode) => node as unknown as Node;

/** Does the range cover at least one emoji image? */
export function rangeHasEmoji(range: Range): boolean {
  const root = range.commonAncestorContainer;
  if (root.nodeType !== Node.ELEMENT_NODE) return false;
  for (const el of Array.from((root as Element).querySelectorAll(EMOJI_SELECTOR))) {
    if (range.intersectsNode(el) && emojiFromElement(asClip(el))) return true;
  }
  return false;
}

/**
 * The selected part of the page as text + custom emoji segments. Uses the
 * computed style the way the browser's own copy does: display:none,
 * visibility:hidden and (outside editors) user-select:none are left out,
 * block-level boxes start a new line.
 */
export function rangeToClipSegments(range: Range, opts: { editable?: boolean } = {}): ClipSegment[] {
  const root = range.commonAncestorContainer;
  const view = root.ownerDocument?.defaultView ?? window;
  const styles = new Map<Element, CSSStyleDeclaration>();
  const styleOf = (el: Element) => {
    let s = styles.get(el);
    if (!s) {
      s = view.getComputedStyle(el);
      styles.set(el, s);
    }
    return s;
  };
  const options: ClipWalkOptions = {
    textSlice: (clip) => {
      const node = asNode(clip) as Text;
      if (!range.intersectsNode(node)) return null;
      const start = node === range.startContainer ? range.startOffset : 0;
      const end = node === range.endContainer ? range.endOffset : node.data.length;
      return end > start ? [start, end] : null;
    },
    skip: (clip) => {
      const el = asNode(clip) as Element;
      if (!range.intersectsNode(el)) return true;
      const s = styleOf(el);
      if (s.display === "none" || s.visibility === "hidden") return true;
      if (!opts.editable && (s.userSelect === "none" || s.getPropertyValue("-webkit-user-select") === "none")) {
        // Emoji images may be unselectable for dragging, they still count.
        return !emojiFromElement(clip);
      }
      return false;
    },
    isBlock: (clip) => {
      const display = styleOf(asNode(clip) as Element).display;
      return !display.startsWith("inline") && display !== "contents" && display !== "none" && !display.startsWith("ruby");
    },
  };
  if (root.nodeType === Node.TEXT_NODE) return collectClipSegments([asClip(root)], options);
  return collectClipSegments(root.childNodes as unknown as ArrayLike<ClipNode>, options);
}

/** Every range of a selection (Firefox can hold several), one line each. */
export function selectionToClipSegments(selection: Selection, opts: { editable?: boolean } = {}): ClipSegment[] {
  const out: ClipSegment[] = [];
  for (let i = 0; i < selection.rangeCount; i++) {
    const segs = rangeToClipSegments(selection.getRangeAt(i), opts);
    if (i > 0 && segs.length) out.push({ kind: "text", text: "\n" });
    out.push(...segs);
  }
  return out;
}

function selectionHasEmoji(selection: Selection): boolean {
  for (let i = 0; i < selection.rangeCount; i++) {
    if (rangeHasEmoji(selection.getRangeAt(i))) return true;
  }
  return false;
}

/**
 * Clipboard payload for the current selection inside `container`, or null
 * when there's nothing special to do (no emoji images selected: the
 * browser's own copy is right).
 */
export function selectionPayloadWithin(container: Element, opts: { editable?: boolean } = {}): ClipboardPayload | null {
  const selection = container.ownerDocument.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!container.contains(range.commonAncestorContainer)) return null;
  if (!selectionHasEmoji(selection)) return null;
  return segmentsToClipboard(selectionToClipSegments(selection, opts));
}

/** Pasted HTML → segments, when it carries SerikaCord custom emoji (else null). */
export function htmlToClipSegments(html: string): ClipSegment[] | null {
  if (!html || !htmlHasEmojiTokens(html) || typeof DOMParser === "undefined") return null;
  // An inert document: nothing loads or runs.
  const doc = new DOMParser().parseFromString(html, "text/html");
  const segments = collectClipSegments(doc.body.childNodes as unknown as ArrayLike<ClipNode>);
  // Chrome adds a trailing newline after a copied block: don't paste it.
  const last = segments[segments.length - 1];
  if (last?.kind === "text") last.text = last.text.replace(/\n+$/, "");
  return segments.some((s) => s.kind === "custom") ? segments : null;
}

/** Write text/plain + text/html (when given); plain text where rich writes aren't allowed. */
export async function writeClipboardPayload(payload: ClipboardPayload): Promise<void> {
  try {
    if (payload.html && typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/plain": new Blob([payload.text], { type: "text/plain" }),
          "text/html": new Blob([payload.html], { type: "text/html" }),
        }),
      ]);
      return;
    }
  } catch {
    // Not allowed (permissions, older WebViews): plain text below.
  }
  await navigator.clipboard?.writeText(payload.text);
}

function isEditableNode(node: Node | null): boolean {
  const el = node && (node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement);
  return Boolean(el?.closest("input, textarea, [contenteditable='true'], [contenteditable='']"));
}

function handleDocumentCopy(e: ClipboardEvent) {
  if (e.defaultPrevented || !e.clipboardData) return;
  const selection = document.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;
  // Text fields copy their own way (the composer has its own handler).
  if (isEditableNode(selection.anchorNode) || isEditableNode(selection.focusNode)) return;
  if (!selectionHasEmoji(selection)) return;
  const payload = segmentsToClipboard(selectionToClipSegments(selection));
  if (!payload.text) return;
  e.clipboardData.setData("text/plain", payload.text);
  e.clipboardData.setData("text/html", payload.html);
  e.preventDefault();
}

let installs = 0;

/**
 * Copying selected message text puts emoji on the clipboard as text
 * (Unicode / `:name:`) and keeps custom emoji tokens in the HTML. One
 * document listener however many lists mount; returns the uninstaller.
 */
export function installEmojiCopyHandler(): () => void {
  if (typeof document === "undefined") return () => {};
  if (installs++ === 0) document.addEventListener("copy", handleDocumentCopy);
  return () => {
    if (--installs === 0) document.removeEventListener("copy", handleDocumentCopy);
  };
}

"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { cn } from "@/lib/utils";
import { nativePlatform } from "@/lib/native/bridge";
import { useGT } from "gt-next";
import { isTouchOnlyInput, useTouchOnlyInput } from "@/hooks/useVisualViewport";
import { shouldInsertDoubleSpacePeriod } from "@/lib/chat/doubleSpacePeriod";
import { customEmojiTokenRegex, isValidCustomEmojiName, normalizeCustomEmojiName } from "@/lib/chat/customEmoji";
import { splitPastedText, type ClipSegment } from "@/lib/chat/emojiClipboard";
import { htmlToClipSegments, selectionPayloadWithin } from "@/lib/chat/emojiClipboardDom";
import {
  PENDING_ENTER_TIMEOUT_MS,
  classifyComposerElement,
  classifyRichContent,
  clearEnterKey,
  createEnterTracker,
  decideLineBreak,
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
  type RichContentInput,
} from "@/lib/chat/composerIme";

export interface ComposerEmoji {
  id: string;
  name: string;
  url: string;
  animated?: boolean;
}

export interface ComposerMention {
  id: string;
  label: string;
  /** "user" | "role" | "everyone" | "here" | "channel" */
  kind: "user" | "role" | "everyone" | "here" | "channel";
  color?: string;
}

export interface RichComposerHandle {
  focus: () => void;
  /** Focus without moving the caret: back where it was before focus left (e.g. to the emoji picker). */
  restoreFocus: () => void;
  clear: () => void;
  getText: () => string;
  getCaret: () => number;
  insertTextAtCaret: (text: string) => void;
  insertEmojiAtCaret: (emoji: ComposerEmoji) => void;
  /** Replace [start, end) in token-string coordinates with plain text */
  replaceRange: (start: number, end: number, replacement: string) => void;
  /** Replace [start, end) in token-string coordinates with an emoji image */
  replaceRangeWithEmoji: (start: number, end: number, emoji: ComposerEmoji) => void;
  /** Replace [start, end) in token-string coordinates with a mention pill */
  replaceRangeWithMention: (start: number, end: number, mention: ComposerMention) => void;
  /**
   * Replace everything with `text` (a token string), showing each custom
   * emoji token `resolveEmojiUrl` knows as its image (the token itself is
   * kept exactly). Caret goes to the end.
   */
  setContent: (text: string, resolveEmojiUrl?: (id: string) => string | undefined) => void;
  /**
   * Finish an open IME composition so `getText()` is final and the keyboard
   * forgets the word it was holding (Samsung Keyboard otherwise types it back
   * after a send). Keeps focus and the on-screen keyboard.
   */
  commitComposition: () => void;
  /** Put the caret at a token-string offset. */
  setCaret: (pos: number) => void;
}

/** Extra details about a change. */
export interface ComposerChangeInfo {
  /** An IME composition is still open: the text may still change, don't rewrite it now. */
  composing: boolean;
  /** This change reports the text a composition just committed (whole words at once). */
  committed?: boolean;
}

interface RichComposerProps {
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
  /** Fired after any content change with the serialized token string + caret */
  onChange: (text: string, caret: number, info: ComposerChangeInfo) => void;
  /** Fired when the caret moves without a content change (click / arrows) */
  onCaretMove?: (text: string, caret: number) => void;
  onKeyDown?: (e: React.KeyboardEvent) => void;
  /** Smaller box without the main composer's button gutters (message edit). */
  compact?: boolean;
  /** Image URL of a custom emoji by id: pasted `<:name:id>` tokens show as the emoji. */
  resolveEmojiUrl?: (id: string) => string | undefined;
  /** Images (and other files) pasted, dropped or inserted by a keyboard's GIF / sticker panel. */
  onFiles?: (files: File[]) => void;
}

function emojiToken(emoji: ComposerEmoji): string {
  // Old emoji can have names a token can't carry (spaces, symbols): the id
  // is what resolves it, so the name is made token-safe.
  const name = isValidCustomEmojiName(emoji.name) ? emoji.name : normalizeCustomEmojiName(emoji.name) || "emoji";
  return `<${emoji.animated ? "a" : ""}:${name}:${emoji.id}>`;
}

function mentionToken(mention: ComposerMention): string {
  if (mention.kind === "role") return `<@&${mention.id}>`;
  if (mention.kind === "everyone") return "@everyone";
  if (mention.kind === "here") return "@here";
  if (mention.kind === "channel") return `<#${mention.id}>`;
  return `<@${mention.id}>`;
}

function makeMentionSpan(mention: ComposerMention): HTMLSpanElement {
  const span = document.createElement("span");
  span.contentEditable = "false";
  span.dataset.mentionKind = mention.kind;
  span.dataset.mentionId = mention.id;
  span.dataset.mentionToken = mentionToken(mention);
  span.className =
    "inline-block px-1 py-0.5 rounded font-medium cursor-pointer select-none mx-px " +
    (mention.kind === "everyone" || mention.kind === "here"
      ? "bg-yellow-500/20 text-yellow-200"
      : mention.kind === "channel"
        ? "bg-[var(--app-accent)]/15 text-[var(--app-accent)]"
        : mention.color
          ? ""
          : "bg-[var(--app-accent)]/20 text-[var(--app-accent)]");
  if (mention.color && mention.kind !== "everyone" && mention.kind !== "here" && mention.kind !== "channel") {
    span.style.backgroundColor = mention.color + "22";
    span.style.color = mention.color;
  }
  // The label is drawn from an attribute (globals.css), not a text node:
  // keyboards that re-compose the word before the caret (Samsung Keyboard,
  // Gboard) would otherwise grab the chip's letters and type them back as
  // text or delete the chip with the word.
  const label = mention.kind === "channel" ? `#${mention.label}` : `@${mention.label}`;
  span.dataset.mentionLabel = label;
  span.setAttribute("role", "img");
  span.setAttribute("aria-label", label);
  return span;
}

function makeEmojiImg(emoji: ComposerEmoji): HTMLImageElement {
  const img = document.createElement("img");
  img.src = emoji.url;
  img.alt = `:${emoji.name}:`;
  img.title = `:${emoji.name}:`;
  img.draggable = false;
  img.contentEditable = "false";
  img.dataset.emojiToken = emojiToken(emoji);
  img.className = "inline-block w-[22px] h-[22px] object-contain align-text-bottom mx-px select-none";
  return img;
}

/** Android (Chrome, Samsung Internet, the app's WebView): where IME keyboards need the extra care. */
function isAndroid(): boolean {
  return typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);
}

/** A mention pill or custom emoji image: one unit for the caret and for deleting. */
function isChip(node: Node | null | undefined): node is HTMLElement {
  if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
  const el = node as HTMLElement;
  return (el.nodeName === "IMG" && !!el.dataset.emojiToken) || !!el.dataset.mentionToken;
}

/** The chip right before (or after) a collapsed caret, skipping empty text nodes. */
function chipNextToCaret(editor: HTMLElement, range: Range, backward: boolean): HTMLElement | null {
  let node: Node | null;
  const { startContainer: c, startOffset: o } = range;
  if (c.nodeType === Node.TEXT_NODE) {
    const len = (c as Text).data.length;
    if (backward ? o > 0 : o < len) return null;
    node = backward ? c.previousSibling : c.nextSibling;
  } else {
    node = backward ? c.childNodes[o - 1] ?? null : c.childNodes[o] ?? null;
  }
  while (node && node.nodeType === Node.TEXT_NODE && (node as Text).data.length === 0) {
    node = backward ? node.previousSibling : node.nextSibling;
  }
  return node && editor.contains(node) && isChip(node) ? node : null;
}

/** Stand-in for a keydown Enter, replayed through the key handlers for an IME Enter. */
function syntheticEnter(target: HTMLElement): React.KeyboardEvent {
  let prevented = false;
  const nativeEvent = new KeyboardEvent("keydown", { key: "Enter", code: "Enter", cancelable: true });
  const ev = {
    type: "keydown",
    key: "Enter",
    code: "Enter",
    keyCode: 13,
    which: 13,
    charCode: 0,
    location: 0,
    repeat: false,
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    target,
    currentTarget: target,
    nativeEvent,
    get defaultPrevented() { return prevented; },
    preventDefault() { prevented = true; },
    isDefaultPrevented: () => prevented,
    stopPropagation() {},
    isPropagationStopped: () => false,
    persist() {},
    getModifierState: () => false,
  };
  return ev as unknown as React.KeyboardEvent;
}

/** Files on a DataTransfer (some WebViews only list them as items). */
function dataTransferFiles(dt: DataTransfer | null): File[] {
  if (!dt) return [];
  const files: File[] = Array.from(dt.files || []);
  if (files.length === 0 && dt.items) {
    for (const item of Array.from(dt.items)) {
      if (item.kind === "file") {
        const f = item.getAsFile();
        if (f) files.push(f);
      }
    }
  }
  return files;
}

function richContentInput(dt: DataTransfer, files: File[]): RichContentInput {
  const get = (type: string) => {
    try { return dt.getData(type); } catch { return ""; }
  };
  return { files, uriList: get("text/uri-list"), html: get("text/html"), text: get("text/plain") };
}

/** An inline image (data: / blob:) as a File for the upload flow. */
async function imageUrlToFile(url: string): Promise<File | null> {
  try {
    const blob = await (await fetch(url)).blob();
    if (!blob.type.startsWith("image/")) return null;
    return new File([blob], imageFileName(blob.type, Date.now()), { type: blob.type });
  } catch {
    return null;
  }
}

/** Serialized length contributed by a single DOM node */
function nodeTokenLength(node: Node): number {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent?.length ?? 0;
  if (node.nodeName === "IMG") {
    return (node as HTMLElement).dataset.emojiToken?.length ?? 0;
  }
  if (node.nodeName === "SPAN" && (node as HTMLElement).dataset.mentionToken) {
    return (node as HTMLElement).dataset.mentionToken?.length ?? 0;
  }
  if (node.nodeName === "BR") return 1;
  return 0;
}

/**
 * Message composer that renders custom emojis as inline images while the
 * parent keeps working with the plain `<:name:id>` token string.
 *
 * The contentEditable DOM is the display source of truth (uncontrolled);
 * every mutation is serialized back to the token string and reported through
 * `onChange`. Caret positions are exchanged in token-string coordinates so
 * mention/emoji autocomplete keeps working unchanged.
 */
export const RichComposer = forwardRef<RichComposerHandle, RichComposerProps>(
  function RichComposer(
    { placeholder, disabled = false, className, "aria-label": ariaLabel, onChange, onCaretMove, onKeyDown, compact = false, resolveEmojiUrl, onFiles },
    ref
  ) {
    const gt = useGT();
    // On-screen keyboards show a return key (newline) instead of "send".
    const touchOnly = useTouchOnlyInput();
    const editorRef = useRef<HTMLDivElement>(null);
    const isEmptyRef = useRef(true);
    const [isEmpty, setIsEmpty] = useState(true);
    const [hasMarkdown, setHasMarkdown] = useState(false);

    // ----- Serialization ---------------------------------------------------

    const serialize = useCallback((): string => {
      const editor = editorRef.current;
      if (!editor) return "";
      let out = "";
      const walk = (node: Node) => {
        for (const child of Array.from(node.childNodes)) {
          if (child.nodeType === Node.TEXT_NODE) {
            out += child.textContent ?? "";
          } else if (child.nodeName === "IMG") {
            out += (child as HTMLElement).dataset.emojiToken ?? "";
          } else if (child.nodeName === "SPAN" && (child as HTMLElement).dataset.mentionToken) {
            out += (child as HTMLElement).dataset.mentionToken ?? "";
          } else if (child.nodeName === "BR") {
            out += "\n";
          } else if (child.nodeType === Node.ELEMENT_NODE) {
            // Block elements the browser may insert (div on Enter) act as
            // newline separators.
            if (out.length > 0 && (child.nodeName === "DIV" || child.nodeName === "P")) {
              out += "\n";
            }
            walk(child);
          }
        }
      };
      walk(editor);
      return out;
    }, []);

    /** Serialized offset of the current selection focus inside the editor. */
    const getCaret = useCallback((knownText?: string): number => {
      const editor = editorRef.current;
      const selection = window.getSelection();
      const fallback = knownText !== undefined ? knownText.length : serialize().length;
      if (!editor || !selection || selection.rangeCount === 0) return fallback;
      const range = selection.getRangeAt(0);
      if (!editor.contains(range.startContainer)) return fallback;

      let offset = 0;
      let found = false;
      const walk = (node: Node): boolean => {
        for (let i = 0; i < node.childNodes.length; i++) {
          const child = node.childNodes[i];
          if (child === range.startContainer) {
            if (child.nodeType === Node.TEXT_NODE) {
              offset += range.startOffset;
            } else {
              for (let j = 0; j < range.startOffset && j < child.childNodes.length; j++) {
                offset += nodeTokenLength(child.childNodes[j]);
              }
            }
            found = true;
            return true;
          }
          if (child.nodeType === Node.ELEMENT_NODE && child.contains(range.startContainer)) {
            if (node !== child && (child.nodeName === "DIV" || child.nodeName === "P") && offset > 0) {
              offset += 1;
            }
            if (walk(child)) return true;
          } else {
            if (child.nodeType === Node.ELEMENT_NODE && (child.nodeName === "DIV" || child.nodeName === "P") && offset > 0) {
              offset += 1;
              let inner = 0;
              const sum = (n: Node) => {
                for (const c of Array.from(n.childNodes)) {
                  inner += nodeTokenLength(c);
                  if (c.nodeType === Node.ELEMENT_NODE) sum(c);
                }
              };
              sum(child);
              offset += inner;
            } else {
              offset += nodeTokenLength(child);
            }
          }
        }
        return false;
      };
      if (range.startContainer === editor) {
        for (let j = 0; j < range.startOffset && j < editor.childNodes.length; j++) {
          offset += nodeTokenLength(editor.childNodes[j]);
        }
        found = true;
      } else {
        walk(editor);
      }
      return found ? offset : fallback;
    }, [serialize]);

    /** Map a token-string offset back to a DOM position. */
    const posToDom = useCallback((pos: number): { node: Node; offset: number } | null => {
      const editor = editorRef.current;
      if (!editor) return null;
      let remaining = pos;

      const walk = (node: Node): { node: Node; offset: number } | null => {
        for (let i = 0; i < node.childNodes.length; i++) {
          const child = node.childNodes[i];
          if (child.nodeType === Node.TEXT_NODE) {
            const len = child.textContent?.length ?? 0;
            if (remaining <= len) {
              return { node: child, offset: remaining };
            }
            remaining -= len;
          } else if (child.nodeName === "IMG" || child.nodeName === "BR" ||
            (child.nodeName === "SPAN" && (child as HTMLElement).dataset.mentionToken)) {
            const len = nodeTokenLength(child);
            if (remaining < len) {
              return { node, offset: i };
            }
            if (remaining === len) {
              return { node, offset: i + 1 };
            }
            remaining -= len;
          } else if (child.nodeType === Node.ELEMENT_NODE) {
            if ((child.nodeName === "DIV" || child.nodeName === "P") && i > 0) {
              if (remaining === 0) return { node, offset: i };
              remaining -= 1;
            }
            const result = walk(child);
            if (result) return result;
          }
        }
        return null;
      };

      const result = walk(editor);
      if (result) return result;
      return { node: editor, offset: editor.childNodes.length };
    }, []);

    // ----- Change propagation ----------------------------------------------

    // True from compositionstart to compositionend (exactly; composingRef
    // below lingers a tick for Safari's confirming Enter).
    const imeActiveRef = useRef(false);

    const emitChange = useCallback((committed = false) => {
      const text = serialize();
      const empty = text.trim().length === 0;
      if (empty !== isEmptyRef.current) {
        isEmptyRef.current = empty;
        setIsEmpty(empty);
      }
      setHasMarkdown(/[*_~`#\[\]]/.test(text));
      onChange(text, getCaret(text), { composing: imeActiveRef.current, committed });
    }, [serialize, getCaret, onChange]);

    // ----- IME (on-screen keyboard) state -----------------------------------

    /**
     * Android keyboards cache the field's text and the word they are
     * composing. After the composer changes its own text (a chip, an emoji,
     * a conversion, clearing after a send) Samsung Keyboard kept typing into
     * its stale copy: doubled or lost letters, the old word typed back,
     * suggestions replacing the wrong word. Moving focus out and straight
     * back restarts the keyboard's input session (Chrome finishes the
     * composition on blur and restarts input on focus) without hiding it.
     */
    const restartIme = useCallback((): boolean => {
      const editor = editorRef.current;
      if (!editor || !isAndroid() || document.activeElement !== editor) return false;
      const selection = window.getSelection();
      const saved =
        selection && selection.rangeCount > 0 && editor.contains(selection.getRangeAt(0).startContainer)
          ? selection.getRangeAt(0).cloneRange()
          : null;
      editor.blur();
      editor.focus({ preventScroll: true });
      if (saved && selection) {
        selection.removeAllRanges();
        selection.addRange(saved);
      }
      return true;
    }, []);

    // Several edits in one task (a chip + its trailing space) restart once.
    const restartQueuedRef = useRef(false);
    const scheduleImeRestart = useCallback(() => {
      if (restartQueuedRef.current || !isAndroid()) return;
      restartQueuedRef.current = true;
      queueMicrotask(() => {
        restartQueuedRef.current = false;
        restartIme();
      });
    }, [restartIme]);

    /** Close an open composition before the composer rewrites its own text. */
    const commitComposition = useCallback(() => {
      if (!imeActiveRef.current) return;
      // Blur makes the browser commit the composition (compositionend fires
      // synchronously). Elsewhere (desktop IMEs, iOS) the composition is left
      // alone, as before.
      restartIme();
    }, [restartIme]);

    // ----- Imperative editing helpers ---------------------------------------

    // The last caret / selection inside the editor, so a picker (which takes
    // focus) inserts where the caret was instead of at the start.
    const savedRangeRef = useRef<Range | null>(null);
    useEffect(() => {
      const onSelectionChange = () => {
        const editor = editorRef.current;
        const selection = window.getSelection();
        if (!editor || !selection || selection.rangeCount === 0) return;
        const range = selection.getRangeAt(0);
        if (editor.contains(range.startContainer) && editor.contains(range.endContainer)) {
          savedRangeRef.current = range.cloneRange();
        }
      };
      document.addEventListener("selectionchange", onSelectionChange);
      return () => document.removeEventListener("selectionchange", onSelectionChange);
    }, []);

    /** The live selection when it's in the editor, else the saved one, else the end. */
    const caretRange = useCallback((): Range | null => {
      const editor = editorRef.current;
      if (!editor) return null;
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0 && editor.contains(selection.getRangeAt(0).startContainer)) {
        return selection.getRangeAt(0);
      }
      const saved = savedRangeRef.current;
      if (saved && editor.contains(saved.startContainer) && editor.contains(saved.endContainer)) {
        return saved.cloneRange();
      }
      const range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
      return range;
    }, []);

    const insertNodeAtCaret = useCallback((node: Node) => {
      const editor = editorRef.current;
      commitComposition();
      // Read the caret before focusing: focus() can move it to the start.
      const range = caretRange();
      if (!editor || !range) return;
      editor.focus();
      const selection = window.getSelection();
      range.deleteContents();
      range.insertNode(node);
      range.setStartAfter(node);
      range.collapse(true);
      selection?.removeAllRanges();
      selection?.addRange(range);
      emitChange();
      scheduleImeRestart();
    }, [emitChange, caretRange, commitComposition, scheduleImeRestart]);

    /** Text and custom emoji (as images when their URL is known) → DOM nodes. */
    const segmentsToFragment = useCallback((segments: readonly ClipSegment[]): DocumentFragment => {
      const fragment = document.createDocumentFragment();
      for (const seg of segments) {
        if (seg.kind === "text") {
          if (seg.text) fragment.appendChild(document.createTextNode(seg.text));
          continue;
        }
        const url = resolveEmojiUrl?.(seg.id) || (seg.url && /^https?:\/\//i.test(seg.url) ? seg.url : undefined);
        fragment.appendChild(
          url
            ? makeEmojiImg({ id: seg.id, name: seg.name, animated: seg.animated, url })
            : document.createTextNode(emojiToken({ id: seg.id, name: seg.name, animated: seg.animated, url: "" })),
        );
      }
      return fragment;
    }, [resolveEmojiUrl]);

    const domReplaceRange = useCallback((start: number, end: number, node: Node) => {
      const editor = editorRef.current;
      if (!editor) return;
      commitComposition();
      editor.focus();
      const from = posToDom(start);
      const to = posToDom(end);
      if (!from || !to) return;
      const range = document.createRange();
      range.setStart(from.node, from.offset);
      range.setEnd(to.node, to.offset);
      range.deleteContents();
      range.insertNode(node);
      range.setStartAfter(node);
      range.collapse(true);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      emitChange();
      scheduleImeRestart();
    }, [posToDom, emitChange, commitComposition, scheduleImeRestart]);

    useImperativeHandle(ref, () => ({
      focus: () => {
        const editor = editorRef.current;
        if (!editor) return;
        editor.focus();
        const selection = window.getSelection();
        if (selection) {
          const range = document.createRange();
          range.selectNodeContents(editor);
          range.collapse(false);
          selection.removeAllRanges();
          selection.addRange(range);
        }
      },
      restoreFocus: () => {
        const editor = editorRef.current;
        if (!editor) return;
        const range = caretRange();
        editor.focus();
        const selection = window.getSelection();
        if (range && selection) {
          selection.removeAllRanges();
          selection.addRange(range);
        }
      },
      clear: () => {
        if (editorRef.current) {
          // A send while a word is still being composed: commit it first so
          // the keyboard doesn't type it back into the empty box.
          commitComposition();
          editorRef.current.innerHTML = "";
          isEmptyRef.current = true;
          setIsEmpty(true);
          setHasMarkdown(false);
          // Let the parent know (it mirrors the text for draft saving).
          onChange("", 0, { composing: false });
          scheduleImeRestart();
        }
      },
      getText: serialize,
      getCaret,
      insertTextAtCaret: (text: string) => {
        insertNodeAtCaret(document.createTextNode(text));
      },
      insertEmojiAtCaret: (emoji: ComposerEmoji) => {
        insertNodeAtCaret(makeEmojiImg(emoji));
      },
      replaceRange: (start: number, end: number, replacement: string) => {
        domReplaceRange(start, end, document.createTextNode(replacement));
      },
      replaceRangeWithEmoji: (start: number, end: number, emoji: ComposerEmoji) => {
        domReplaceRange(start, end, makeEmojiImg(emoji));
      },
      replaceRangeWithMention: (start: number, end: number, mention: ComposerMention) => {
        domReplaceRange(start, end, makeMentionSpan(mention));
      },
      setContent: (text: string, resolveEmojiUrl?: (id: string) => string | undefined) => {
        const editor = editorRef.current;
        if (!editor) return;
        commitComposition();
        const fragment = document.createDocumentFragment();
        let at = 0;
        for (const m of text.matchAll(customEmojiTokenRegex())) {
          const url = resolveEmojiUrl?.(m[3]);
          if (!url || m.index === undefined) continue;
          if (m.index > at) fragment.appendChild(document.createTextNode(text.slice(at, m.index)));
          // Name / id / animated come from the token, so saving writes it back unchanged.
          fragment.appendChild(makeEmojiImg({ id: m[3], name: m[2], animated: m[1] === "a", url }));
          at = m.index + m[0].length;
        }
        if (at < text.length) fragment.appendChild(document.createTextNode(text.slice(at)));
        editor.replaceChildren(fragment);
        editor.focus();
        const selection = window.getSelection();
        if (selection) {
          const range = document.createRange();
          range.selectNodeContents(editor);
          range.collapse(false);
          selection.removeAllRanges();
          selection.addRange(range);
        }
        emitChange();
        scheduleImeRestart();
      },
      commitComposition,
      setCaret: (pos: number) => {
        const at = posToDom(pos);
        const selection = window.getSelection();
        if (!at || !selection) return;
        const range = document.createRange();
        range.setStart(at.node, at.offset);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
      },
    }), [posToDom, serialize, getCaret, insertNodeAtCaret, domReplaceRange, onChange, emitChange, caretRange, commitComposition, scheduleImeRestart]);

    // ----- Event handlers ----------------------------------------------------

    /** Put a fragment where the selection is (replacing it) and move the caret after it. */
    const insertFragmentAtSelection = useCallback((fragment: DocumentFragment): boolean => {
      const editor = editorRef.current;
      const last = fragment.lastChild;
      if (!editor || !last) return false;
      const range = caretRange();
      if (!range) return false;
      range.deleteContents();
      range.insertNode(fragment);
      range.setStartAfter(last);
      range.collapse(true);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      emitChange();
      scheduleImeRestart();
      return true;
    }, [caretRange, emitChange, scheduleImeRestart]);

    /** Text (or SerikaCord's emoji HTML) from a clipboard / drop / keyboard, as plain text + emoji. */
    const insertTransferText = useCallback((html: string, text: string): boolean => {
      const segments = htmlToClipSegments(html) ?? splitPastedText(text);
      if (segments.length === 0) return false;
      return insertFragmentAtSelection(segmentsToFragment(segments));
    }, [insertFragmentAtSelection, segmentsToFragment]);

    /**
     * Rich content from a paste, a drop or a keyboard's GIF / sticker panel
     * (Android delivers those through the paste path). Files go to the
     * upload flow, a bare image link is inserted as a link, never markup.
     * Returns whether it was handled (the caller prevents the default).
     */
    const handleTransfer = useCallback((dt: DataTransfer, allowFiles: boolean): boolean => {
      const files = dataTransferFiles(dt);
      const input = richContentInput(dt, files);
      const content = classifyRichContent(input);
      switch (content.kind) {
        case "files":
          if (!allowFiles || !onFiles) return false;
          onFiles(files);
          return true;
        case "text":
          insertTransferText(input.html ?? "", input.text ?? "");
          return true;
        case "url":
          insertFragmentAtSelection(segmentsToFragment([{ kind: "text", text: content.url }]));
          return true;
        case "image-data":
          if (onFiles) void imageUrlToFile(content.url).then((f) => { if (f) onFiles([f]); });
          return true;
        default:
          return true; // nothing usable: still never let raw markup in
      }
    }, [onFiles, insertTransferText, insertFragmentAtSelection, segmentsToFragment]);

    const handlePaste = useCallback((e: React.ClipboardEvent) => {
      // Check for pasted files (screenshots, copied images, keyboard GIFs and
      // stickers) FIRST. In Electron webviews, calling preventDefault() before
      // the parent MessageBar's onPaste fires can consume clipboard items, so
      // we must bail out early and let the parent handler attach the files.
      const dt = e.clipboardData;
      if (!dt) return;
      if (dataTransferFiles(dt).length > 0) return; // MessageBar's onPaste handles the files
      // Plain text only — no pasted markup. Custom emoji come back as images:
      // from SerikaCord's own clipboard HTML (copied messages / emoji keep
      // their `<:name:id>` token) or from tokens in the plain text.
      e.preventDefault();
      commitComposition();
      handleTransfer(dt, false);
    }, [commitComposition, handleTransfer]);

    // Copy / cut with custom emoji selected: `:name:` as text, the token in
    // the HTML so pasting here brings the emoji back.
    const handleCopyOrCut = useCallback((e: React.ClipboardEvent, cut: boolean) => {
      const editor = editorRef.current;
      if (!editor) return;
      const payload = selectionPayloadWithin(editor, { editable: true });
      if (!payload) return; // nothing special: the browser's copy is right
      e.preventDefault();
      e.clipboardData.setData("text/plain", payload.text);
      e.clipboardData.setData("text/html", payload.html);
      if (cut && !disabled) {
        const selection = window.getSelection();
        if (selection && selection.rangeCount > 0) selection.getRangeAt(0).deleteContents();
        emitChange();
      }
    }, [disabled, emitChange]);
    const handleCopy = useCallback((e: React.ClipboardEvent) => handleCopyOrCut(e, false), [handleCopyOrCut]);
    const handleCut = useCallback((e: React.ClipboardEvent) => handleCopyOrCut(e, true), [handleCopyOrCut]);

    /**
     * Markup the composer didn't put there (a WebView inserting a keyboard
     * sticker as <img>, styled spans from a paste that skipped our handler):
     * images become uploads or links, other tags their plain text. Never
     * runs inside a composition.
     */
    const sanitizeForeignNodes = useCallback(() => {
      const editor = editorRef.current;
      if (!editor || imeActiveRef.current) return;
      const foreign: Element[] = [];
      for (const el of Array.from(editor.querySelectorAll("*"))) {
        const h = el as HTMLElement;
        if (classifyComposerElement({ nodeName: el.nodeName, emojiToken: h.dataset?.emojiToken, mentionToken: h.dataset?.mentionToken }) !== "keep") {
          foreign.push(el);
        }
      }
      if (foreign.length === 0) return;
      // Keep the caret where it was: a marker survives the node moves.
      const selection = window.getSelection();
      let marker: HTMLElement | null = null;
      if (selection && selection.rangeCount > 0 && editor.contains(selection.getRangeAt(0).startContainer)) {
        marker = document.createElement("span");
        const range = selection.getRangeAt(0).cloneRange();
        range.collapse(false);
        range.insertNode(marker);
      }
      const uploads: string[] = [];
      for (const el of foreign) {
        if (!el.isConnected) continue;
        const h = el as HTMLElement;
        const action = classifyComposerElement({ nodeName: el.nodeName, emojiToken: h.dataset?.emojiToken, mentionToken: h.dataset?.mentionToken, caretMarker: el === marker });
        if (action === "keep") continue;
        if (action === "image") {
          const src = el.getAttribute("src") ?? "";
          const what = imageSourceAction(src);
          if (what === "link") el.replaceWith(document.createTextNode(src.trim()));
          else {
            if (what === "upload") uploads.push(src);
            el.remove();
          }
        } else if (action === "remove") {
          el.remove();
        } else {
          el.replaceWith(...Array.from(el.childNodes));
        }
      }
      if (marker?.isConnected && selection) {
        const parent = marker.parentNode!;
        const index = Array.prototype.indexOf.call(parent.childNodes, marker);
        marker.remove();
        const range = document.createRange();
        range.setStart(parent, index);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
      } else {
        marker?.remove();
      }
      if (uploads.length && onFiles) {
        void Promise.all(uploads.map(imageUrlToFile)).then((files) => {
          const ok = files.filter((f): f is File => !!f);
          if (ok.length) onFiles(ok);
        });
      }
      emitChange();
      scheduleImeRestart();
    }, [emitChange, onFiles, scheduleImeRestart]);

    const lastKeyPreventedRef = useRef(false);
    // True while an IME composition (Japanese, Chinese, Korean, or a word
    // held by an Android keyboard) is open. Cleared a tick after
    // compositionend because Safari fires the confirming Enter keydown after it.
    const composingRef = useRef(false);
    const enterTrackerRef = useRef(createEnterTracker());
    // An IME Enter that arrived inside a composition, waiting for the
    // committed text (compositionend) before it runs.
    const pendingEnterRef = useRef<{ command: "insertParagraph" | "insertLineBreak"; timer: number } | null>(null);

    /** Run the key handlers for an Enter the keyboard reported without a usable keydown. */
    const replayEnter = useCallback((): boolean => {
      const editor = editorRef.current;
      if (!editor) return false;
      const ev = syntheticEnter(editor);
      onKeyDown?.(ev);
      enterTrackerRef.current = noteReplay(enterTrackerRef.current, performance.now());
      return ev.defaultPrevented;
    }, [onKeyDown]);

    const flushPendingEnter = useCallback(() => {
      const pending = pendingEnterRef.current;
      if (!pending) return;
      pendingEnterRef.current = null;
      window.clearTimeout(pending.timer);
      // The keyboard never ended the composition: end it ourselves so the
      // handler reads (and a send clears) the final text.
      commitComposition();
      const editor = editorRef.current;
      if (!editor || document.activeElement !== editor) return;
      if (!replayEnter()) {
        // Nothing took the Enter (newline mode on touch keyboards): the newline it meant.
        document.execCommand(pending.command);
      }
    }, [commitComposition, replayEnter]);

    // Focus leaving ends any composition (the browser commits it).
    const handleBlur = useCallback(() => {
      imeActiveRef.current = false;
    }, []);

    const handleCompositionStart = useCallback(() => {
      imeActiveRef.current = true;
      composingRef.current = true;
    }, []);
    const handleCompositionEnd = useCallback(() => {
      imeActiveRef.current = false;
      setTimeout(() => {
        composingRef.current = false;
        if (imeActiveRef.current) return; // a new composition already started
        // The committed text: conversions skipped while composing run now,
        // then an Enter that arrived during the composition.
        sanitizeForeignNodes();
        emitChange(true);
        flushPendingEnter();
      }, 0);
    }, [emitChange, sanitizeForeignNodes, flushPendingEnter]);

    const handleKeyDownInternal = useCallback((e: React.KeyboardEvent) => {
      // Keys that confirm or navigate an IME candidate belong to the IME: never
      // send, autocomplete or run shortcuts on them. (An Android keyboard's
      // Enter shows up here as 229 too; its beforeinput is handled below.)
      if (isImeKeyDown({ key: e.key, keyCode: e.keyCode, isComposing: e.nativeEvent.isComposing }) || composingRef.current) {
        lastKeyPreventedRef.current = false;
        return;
      }
      if (e.key === "Enter" && isDuplicateKeyEnter(enterTrackerRef.current, performance.now())) {
        // Some keyboards send a real Enter right after the one we replayed.
        e.preventDefault();
        lastKeyPreventedRef.current = true;
        return;
      }
      // Block rich-formatting shortcuts (bold/italic/underline)
      if ((e.metaKey || e.ctrlKey) && ["b", "i", "u"].includes(e.key.toLowerCase())) {
        e.preventDefault();
        lastKeyPreventedRef.current = true;
        return;
      }
      onKeyDown?.(e);
      lastKeyPreventedRef.current = e.defaultPrevented;
      enterTrackerRef.current =
        e.key === "Enter"
          ? noteEnterKey(enterTrackerRef.current, performance.now(), e.defaultPrevented)
          : clearEnterKey(enterTrackerRef.current);
    }, [onKeyDown]);

    const reportCaret = useCallback(() => {
      if (lastKeyPreventedRef.current) {
        lastKeyPreventedRef.current = false;
        return;
      }
      onCaretMove?.(serialize(), getCaret());
    }, [onCaretMove, serialize, getCaret]);

    const handleKeyUp = useCallback((e: React.KeyboardEvent) => {
      if (e.key === "Enter") enterTrackerRef.current = clearEnterKey(enterTrackerRef.current);
      reportCaret();
    }, [reportCaret]);

    const handleInput = useCallback((e: React.FormEvent) => {
      const native = e.nativeEvent as InputEvent;
      // A composition the browser dropped without a compositionend (its text
      // was rewritten under it): an input outside a composition means it's over.
      if (!native.isComposing && native.inputType !== "insertCompositionText") imeActiveRef.current = false;
      if (!isLineBreakInput(native.inputType ?? "", native.data)) enterTrackerRef.current = noteEdit(enterTrackerRef.current);
      if (!imeActiveRef.current && !native.isComposing) sanitizeForeignNodes();
      emitChange();
    }, [emitChange, sanitizeForeignNodes]);

    // Native beforeinput (React's synthetic one has no inputType): Enter from
    // IME keyboards, Backspace around chips and emoji, rich inserts, and
    // Android's "double space for period".
    useEffect(() => {
      const editor = editorRef.current;
      if (!editor) return;
      const android = isAndroid();
      let lastSpaceAt = 0;

      const onLineBreak = (e: InputEvent) => {
        const composing = imeActiveRef.current || e.isComposing;
        const { tracker, action } = decideLineBreak(enterTrackerRef.current, { at: performance.now(), composing });
        enterTrackerRef.current = tracker;
        if (action === "native") return;
        if (!e.cancelable) return; // can't hold it back: the browser inserts it
        if (action === "suppress") {
          e.preventDefault();
          return;
        }
        if (action === "replay") {
          if (replayEnter()) e.preventDefault();
          return;
        }
        // Inside a composition: wait for the committed text.
        e.preventDefault();
        if (pendingEnterRef.current) return; // the same press
        pendingEnterRef.current = {
          command: lineBreakCommand(e.inputType),
          timer: window.setTimeout(flushPendingEnter, PENDING_ENTER_TIMEOUT_MS),
        };
      };

      /** Backspace / Delete: a chip goes as one unit, an emoji as one grapheme. */
      const onDelete = (e: InputEvent): boolean => {
        if (e.isComposing || imeActiveRef.current || !e.cancelable) return false;
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) return false;
        const caret = selection.getRangeAt(0);
        if (!editor.contains(caret.startContainer)) return false;
        const backward = e.inputType === "deleteContentBackward";
        const chip = chipNextToCaret(editor, caret, backward);
        if (chip) {
          e.preventDefault();
          const parent = chip.parentNode!;
          const index = Array.prototype.indexOf.call(parent.childNodes, chip);
          chip.remove();
          const range = document.createRange();
          range.setStart(parent, index);
          range.collapse(true);
          selection.removeAllRanges();
          selection.addRange(range);
          emitChange();
          scheduleImeRestart();
          return true;
        }
        const targets = typeof e.getTargetRanges === "function" ? e.getTargetRanges() : [];
        if (targets.length !== 1) return false;
        const t = targets[0];
        if (t.startContainer !== t.endContainer || t.startContainer.nodeType !== Node.TEXT_NODE) return false;
        const node = t.startContainer as Text;
        const fixed = graphemeDeleteRange(node.data, t.startOffset, t.endOffset);
        if (fixed.start === t.startOffset && fixed.end === t.endOffset) return false;
        e.preventDefault();
        node.deleteData(fixed.start, fixed.end - fixed.start);
        const range = document.createRange();
        range.setStart(node, fixed.start);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
        emitChange();
        scheduleImeRestart();
        return true;
      };

      const onBeforeInput = (e: InputEvent) => {
        const type = e.inputType;
        if (isLineBreakInput(type, e.data)) {
          lastSpaceAt = 0;
          onLineBreak(e);
          return;
        }
        if (type === "deleteContentBackward" || type === "deleteContentForward") {
          lastSpaceAt = 0;
          onDelete(e);
          return;
        }
        if ((type === "insertFromPaste" || type === "insertFromDrop" || type === "insertFromPasteAsQuotation") && e.dataTransfer) {
          // Reached only when no paste / drop event handled it (Android
          // keyboards' GIF and sticker panels can insert this way).
          lastSpaceAt = 0;
          if (!e.cancelable) return;
          e.preventDefault();
          commitComposition();
          handleTransfer(e.dataTransfer, true);
          return;
        }
        // Android's "double space for period" (CORD-62): the keyboard can't do
        // it in a contentEditable, so replay it.
        if (!android || type !== "insertText" || e.data !== " " || e.isComposing) {
          lastSpaceAt = 0;
          return;
        }
        const now = performance.now();
        const sinceLast = lastSpaceAt ? now - lastSpaceAt : Infinity;
        lastSpaceAt = now;
        if (!e.cancelable || !isTouchOnlyInput()) return;
        const caret = getCaret();
        if (!shouldInsertDoubleSpacePeriod(serialize().slice(0, caret), sinceLast)) return;
        e.preventDefault();
        lastSpaceAt = 0;
        domReplaceRange(caret - 1, caret, document.createTextNode(". "));
      };
      editor.addEventListener("beforeinput", onBeforeInput);
      return () => editor.removeEventListener("beforeinput", onBeforeInput);
    }, [getCaret, serialize, domReplaceRange, replayEnter, flushPendingEnter, emitChange, scheduleImeRestart, commitComposition, handleTransfer]);

    // Android app builds with Capacitor's `captureInput` on: text a keyboard can't
    // send as a key press (Samsung Keyboard's second symbol page: ` ~ \ | < > { } [ ]
    // • ♥ ☆ ¡ ¿ …) arrives as `activeElement.value = activeElement.value + '…'`,
    // which does nothing on a contentEditable. A `value` that reads empty and
    // inserts what's assigned lets those characters through until every install
    // has a build with the option off (mobile/capacitor.config.json).
    useEffect(() => {
      const editor = editorRef.current;
      if (!editor || nativePlatform() !== "android") return;
      Object.defineProperty(editor, "value", {
        configurable: true,
        get: () => "",
        set: (v: unknown) => {
          if (typeof v === "string" && v) insertNodeAtCaret(document.createTextNode(v));
        },
      });
      return () => { delete (editor as { value?: unknown }).value; };
    }, [insertNodeAtCaret]);

    // A pending Enter never outlives the composer.
    useEffect(() => () => {
      if (pendingEnterRef.current) window.clearTimeout(pendingEnterRef.current.timer);
    }, []);

    // Drops: files bubble on to MessageBar (attachments); links and text are
    // inserted as plain text. The browser's own drop (markup, navigation) never runs.
    useEffect(() => {
      const editor = editorRef.current;
      if (!editor) return;
      // Text dragged inside the box stays put, as before.
      let internalDrag = false;
      const handleDragStart = () => { internalDrag = true; };
      const handleDragEnd = () => { internalDrag = false; };
      const handleDrop = (e: DragEvent) => {
        e.preventDefault();
        const dt = e.dataTransfer;
        if (!dt || disabled || internalDrag) return;
        if (dataTransferFiles(dt).length > 0) return; // MessageBar's onDrop attaches them
        // Insert where it was dropped.
        const at = document.caretRangeFromPoint?.(e.clientX, e.clientY);
        const selection = window.getSelection();
        if (at && selection && editor.contains(at.startContainer)) {
          selection.removeAllRanges();
          selection.addRange(at);
        }
        handleTransfer(dt, false);
      };
      editor.addEventListener("dragstart", handleDragStart);
      editor.addEventListener("dragend", handleDragEnd);
      editor.addEventListener("drop", handleDrop);
      return () => {
        editor.removeEventListener("dragstart", handleDragStart);
        editor.removeEventListener("dragend", handleDragEnd);
        editor.removeEventListener("drop", handleDrop);
      };
    }, [disabled, handleTransfer]);

    return (
      <div className={cn("relative flex-1 min-w-0 flex flex-col", disabled && "opacity-60")}>
        {isEmpty && placeholder && (
          <span
            aria-hidden="true"
            className={cn(
              "pointer-events-none absolute inset-0 flex items-start pt-2.5 pl-10 sm:pl-14 text-base text-[var(--app-muted-2)] truncate",
              compact && "pt-2 pl-3 sm:pl-3",
            )}
          >
            {placeholder}
          </span>
        )}
        <div
          ref={editorRef}
          role="textbox"
          // The edit box (compact) is not "the composer" for global shortcuts.
          data-message-composer={compact ? undefined : "true"}
          aria-multiline="true"
          aria-label={ariaLabel ?? placeholder}
          contentEditable={!disabled}
          suppressContentEditableWarning
          enterKeyHint={touchOnly ? "enter" : "send"}
          spellCheck
          onInput={handleInput}
          onPaste={handlePaste}
          onCopy={handleCopy}
          onCut={handleCut}
          onKeyDown={handleKeyDownInternal}
          onCompositionStart={handleCompositionStart}
          onCompositionEnd={handleCompositionEnd}
          onBlur={handleBlur}
          onKeyUp={handleKeyUp}
          onClick={reportCaret}
          className={cn(
            // 16px at every width: smaller text makes iOS zoom in on focus.
            // On phones the box stops at a third of the screen so the list stays visible.
            "w-full min-h-[44px] max-h-[35dvh] md:max-h-[300px] overflow-y-auto py-2.5 pl-10 sm:pl-14 pr-24 sm:pr-36 bg-transparent text-[var(--text-primary)] text-base outline-none whitespace-pre-wrap break-words",
            compact && "min-h-[40px] py-2 pl-3 sm:pl-3 pr-3 sm:pr-3",
            className
          )}
        />
        {/* Markdown supported indicator */}
        {hasMarkdown && !isEmpty && !compact && (
          <span className="absolute bottom-0.5 left-10 sm:left-14 text-[10px] text-[var(--app-muted)] pointer-events-none opacity-60">
            {gt("Markdown")}
          </span>
        )}
      </div>
    );
  }
);

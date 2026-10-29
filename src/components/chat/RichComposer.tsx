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
import { useGT } from "gt-next";
import { isTouchOnlyInput, useTouchOnlyInput } from "@/hooks/useVisualViewport";
import { shouldInsertDoubleSpacePeriod } from "@/lib/chat/doubleSpacePeriod";
import { customEmojiTokenRegex, isValidCustomEmojiName, normalizeCustomEmojiName } from "@/lib/chat/customEmoji";
import { splitPastedText, type ClipSegment } from "@/lib/chat/emojiClipboard";
import { htmlToClipSegments, selectionPayloadWithin } from "@/lib/chat/emojiClipboardDom";

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
}

interface RichComposerProps {
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
  /** Fired after any content change with the serialized token string + caret */
  onChange: (text: string, caret: number) => void;
  /** Fired when the caret moves without a content change (click / arrows) */
  onCaretMove?: (text: string, caret: number) => void;
  onKeyDown?: (e: React.KeyboardEvent) => void;
  /** Smaller box without the main composer's button gutters (message edit). */
  compact?: boolean;
  /** Image URL of a custom emoji by id: pasted `<:name:id>` tokens show as the emoji. */
  resolveEmojiUrl?: (id: string) => string | undefined;
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
  span.textContent = mention.kind === "channel" ? `#${mention.label}` : `@${mention.label}`;
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
    { placeholder, disabled = false, className, "aria-label": ariaLabel, onChange, onCaretMove, onKeyDown, compact = false, resolveEmojiUrl },
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

    const emitChange = useCallback(() => {
      const text = serialize();
      const empty = text.trim().length === 0;
      if (empty !== isEmptyRef.current) {
        isEmptyRef.current = empty;
        setIsEmpty(empty);
      }
      setHasMarkdown(/[*_~`#\[\]]/.test(text));
      onChange(text, getCaret(text));
    }, [serialize, getCaret, onChange]);

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
    }, [emitChange, caretRange]);

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
    }, [posToDom, emitChange]);

    // Android's "double space for period" (CORD-62): the keyboard can't do it
    // in a contentEditable, so replay it. Native beforeinput, because React's
    // synthetic onBeforeInput has no inputType.
    useEffect(() => {
      const editor = editorRef.current;
      if (!editor || !/Android/i.test(navigator.userAgent)) return;
      let lastSpaceAt = 0;
      const onBeforeInput = (e: InputEvent) => {
        if (e.inputType !== "insertText" || e.data !== " " || e.isComposing) {
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
    }, [getCaret, serialize, domReplaceRange]);

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
          editorRef.current.innerHTML = "";
          isEmptyRef.current = true;
          setIsEmpty(true);
          setHasMarkdown(false);
          // Let the parent know (it mirrors the text for draft saving).
          onChange("", 0);
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
      },
    }), [serialize, getCaret, insertNodeAtCaret, domReplaceRange, onChange, emitChange, caretRange]);

    // ----- Event handlers ----------------------------------------------------

    const handleInput = useCallback(() => {
      emitChange();
    }, [emitChange]);

    const handlePaste = useCallback((e: React.ClipboardEvent) => {
      // Check for pasted files (screenshots, copied images) FIRST. In Electron
      // webviews, calling preventDefault() before the parent MessageBar's
      // onPaste fires can consume clipboard items, so we must bail out early
      // and let the parent handler deal with file attachments.
      const dt = e.clipboardData;
      if (dt) {
        const hasFiles =
          (dt.files && dt.files.length > 0) ||
          (dt.items && Array.from(dt.items).some((item) => item.kind === "file"));
        if (hasFiles) return; // let MessageBar's onPaste handle the files
      }
      // Plain text only — no pasted markup. Custom emoji come back as images:
      // from SerikaCord's own clipboard HTML (copied messages / emoji keep
      // their `<:name:id>` token) or from tokens in the plain text.
      e.preventDefault();
      const segments =
        htmlToClipSegments(e.clipboardData.getData("text/html")) ??
        splitPastedText(e.clipboardData.getData("text/plain"));
      if (segments.length === 0) return;
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) return;
      const range = selection.getRangeAt(0);
      range.deleteContents();
      const fragment = segmentsToFragment(segments);
      const last = fragment.lastChild;
      if (!last) return;
      range.insertNode(fragment);
      range.setStartAfter(last);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
      emitChange();
    }, [emitChange, segmentsToFragment]);

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

    const lastKeyPreventedRef = useRef(false);
    // True while an IME composition (Japanese, Chinese, Korean...) is open.
    // Cleared a tick after compositionend because Safari fires the confirming
    // Enter keydown after it.
    const composingRef = useRef(false);
    const handleCompositionStart = useCallback(() => {
      composingRef.current = true;
    }, []);
    const handleCompositionEnd = useCallback(() => {
      setTimeout(() => {
        composingRef.current = false;
      }, 0);
    }, []);

    const handleKeyDownInternal = useCallback((e: React.KeyboardEvent) => {
      // Keys that confirm or navigate an IME candidate belong to the IME: never
      // send, autocomplete or run shortcuts on them.
      if (e.nativeEvent.isComposing || e.keyCode === 229 || composingRef.current) {
        lastKeyPreventedRef.current = false;
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
    }, [onKeyDown]);

    const reportCaret = useCallback(() => {
      if (lastKeyPreventedRef.current) {
        lastKeyPreventedRef.current = false;
        return;
      }
      onCaretMove?.(serialize(), getCaret());
    }, [onCaretMove, serialize, getCaret]);

    // Keep caret position handy for external insertions even after blur
    useEffect(() => {
      const editor = editorRef.current;
      if (!editor) return;
      const handleDrop = (e: DragEvent) => e.preventDefault();
      editor.addEventListener("drop", handleDrop);
      return () => editor.removeEventListener("drop", handleDrop);
    }, []);

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
          onKeyUp={reportCaret}
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

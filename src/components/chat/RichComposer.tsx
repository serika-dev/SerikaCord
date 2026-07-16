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
}

function emojiToken(emoji: ComposerEmoji): string {
  return `<${emoji.animated ? "a" : ""}:${emoji.name}:${emoji.id}>`;
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
    { placeholder, disabled = false, className, "aria-label": ariaLabel, onChange, onCaretMove, onKeyDown },
    ref
  ) {
    const gt = useGT();
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

    const insertNodeAtCaret = useCallback((node: Node) => {
      const editor = editorRef.current;
      if (!editor) return;
      editor.focus();
      const selection = window.getSelection();
      let range: Range;
      if (selection && selection.rangeCount > 0 && editor.contains(selection.getRangeAt(0).startContainer)) {
        range = selection.getRangeAt(0);
        range.deleteContents();
      } else {
        range = document.createRange();
        range.selectNodeContents(editor);
        range.collapse(false);
      }
      range.insertNode(node);
      range.setStartAfter(node);
      range.collapse(true);
      selection?.removeAllRanges();
      selection?.addRange(range);
      emitChange();
    }, [emitChange]);

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
      clear: () => {
        if (editorRef.current) {
          editorRef.current.innerHTML = "";
          isEmptyRef.current = true;
          setIsEmpty(true);
          setHasMarkdown(false);
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
    }), [serialize, getCaret, insertNodeAtCaret, domReplaceRange]);

    // ----- Event handlers ----------------------------------------------------

    const handleInput = useCallback(() => {
      emitChange();
    }, [emitChange]);

    const handlePaste = useCallback((e: React.ClipboardEvent) => {
      // Plain text only — no pasted markup
      e.preventDefault();
      const text = e.clipboardData.getData("text/plain");
      if (!text) return;
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) return;
      const range = selection.getRangeAt(0);
      range.deleteContents();
      const node = document.createTextNode(text);
      range.insertNode(node);
      range.setStartAfter(node);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
      emitChange();
    }, [emitChange]);

    const lastKeyPreventedRef = useRef(false);

    const handleKeyDownInternal = useCallback((e: React.KeyboardEvent) => {
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
            className="pointer-events-none absolute inset-0 flex items-start pt-2.5 pl-10 sm:pl-14 text-sm sm:text-base text-[var(--app-muted-2)] truncate"
          >
            {placeholder}
          </span>
        )}
        <div
          ref={editorRef}
          role="textbox"
          aria-multiline="true"
          aria-label={ariaLabel ?? placeholder}
          contentEditable={!disabled}
          suppressContentEditableWarning
          spellCheck
          onInput={handleInput}
          onPaste={handlePaste}
          onKeyDown={handleKeyDownInternal}
          onKeyUp={reportCaret}
          onClick={reportCaret}
          className={cn(
            "w-full min-h-[44px] max-h-[300px] overflow-y-auto py-2.5 pl-10 sm:pl-14 pr-24 sm:pr-36 bg-transparent text-[var(--text-primary)] text-sm sm:text-base outline-none whitespace-pre-wrap break-words",
            className
          )}
        />
        {/* Markdown supported indicator */}
        {hasMarkdown && !isEmpty && (
          <span className="absolute bottom-0.5 left-10 sm:left-14 text-[10px] text-[var(--app-muted)] pointer-events-none opacity-60">
            {gt("Markdown")}
          </span>
        )}
      </div>
    );
  }
);

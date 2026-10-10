/**
 * Discord-flavoured markdown, as a pure parser.
 *
 * Two layers:
 *  - `splitMarkdownBlocks` cuts a message into blocks by Discord's line rules
 *    (``` fences, `# `/`## `/`### ` headings, `-# ` subtext, `- `/`* `/`1. `
 *    lists nested by indentation, `> ` and `>>> ` quotes, paragraphs). Block
 *    text is left raw so callers (MessageContent) can tokenize mentions and
 *    emoji inside it.
 *  - `parseInlineMarkdown` turns one run of text into inline nodes (bold,
 *    italics, underline, strike, spoilers, inline code, masked links, bare
 *    URLs, timestamps, channel mentions, backslash escapes).
 *
 * `parseMarkdown` combines both for plain renderers (profiles, bios).
 */

export interface MarkdownNode {
  type:
    | "text"
    | "bold"
    | "italic"
    | "underline"
    | "strikethrough"
    | "code"
    | "codeblock"
    | "link"
    | "url"
    | "linebreak"
    | "timestamp"
    | "channel_mention"
    | "spoiler";
  content: string;
  href?: string;
  format?: string;
  options?: string;
  children?: MarkdownNode[];
}

const INLINE_CODE_RE = /``([^`]+?)``|`([^`]+)`/;
const BOLD_RE = /\*\*([^*]+(?:\*(?!\*)[^*]*)*)\*\*/;
const ITALIC_RE = /(?<!\*)\*(?![*\s])([^*]+?)\*(?!\*)/;
const UNDERSCORE_ITALIC_RE = /(?<![\w_])_(?!_)([^_\n]+?)_(?![\w_])/;
const UNDERLINE_RE = /__([^_]+)__/;
const STRIKE_RE = /~~([^~]+)~~/;
const SPOILER_RE = /\|\|([^|]+)\|\|/;
const LINK_RE = /\[([^\]\n]+)\]\((?:<([^>\s]+)>|([^)\s]+))(?:\s+"[^"]*")?\)/;
const ANGLE_URL_RE = /<(https?:\/\/[^\s<>]+)>/;
const URL_RE = /https?:\/\/[^\s<>]*[^\s<>.,:;"')\]!?*_~|]/;
const TIMESTAMP_RE = /<t:(-?\d+)(?::([tTdDfFRC])((?:\[[^\]]*\])*))?>/;
const CHANNEL_MENTION_RE = /<#([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})>/;
const ESCAPE_RE = /\\([*_~`|>#\-\\[\]()<:.!+])/;

/** Only these link targets may become clickable (no javascript:, data:, ...). */
export function isSafeLinkHref(href: string): boolean {
  const h = href.trim();
  return /^https?:\/\/[^\s]+$/i.test(h) || /^mailto:[^\s]+$/i.test(h) || /^\/(?!\/)/.test(h) || /^#/.test(h);
}

type Candidate = { regex: RegExp; build: (m: RegExpMatchArray) => MarkdownNode };

const NESTING = new Set<MarkdownNode["type"]>(["bold", "italic", "underline", "strikethrough", "spoiler"]);

/** Inline nodes for one run of text. */
export function parseInlineMarkdown(text: string): MarkdownNode[] {
  const nodes: MarkdownNode[] = [];
  let remaining = text;

  const candidates: Candidate[] = [
    { regex: ESCAPE_RE, build: (m) => ({ type: "text", content: m[1] }) },
    { regex: INLINE_CODE_RE, build: (m) => ({ type: "code", content: (m[1] ?? m[2] ?? "").replace(/^ (.*) $/, "$1") }) },
    {
      regex: LINK_RE,
      build: (m) => {
        const label = m[1];
        const href = (m[2] || m[3] || "").trim();
        // Discord: a masked link whose text is itself a URL is shown raw, so
        // a link can't pretend to go somewhere it doesn't.
        if (/serika\.cc/i.test(href)) return { type: "text", content: label };
        if (!isSafeLinkHref(href) || /https?:\/\//i.test(label)) {
          return { type: "text", content: m[0] };
        }
        return { type: "link", content: label, href };
      },
    },
    { regex: ANGLE_URL_RE, build: (m) => ({ type: "url", content: m[1], href: m[1] }) },
    { regex: URL_RE, build: (m) => ({ type: "url", content: m[0], href: m[0] }) },
    { regex: TIMESTAMP_RE, build: (m) => ({ type: "timestamp", content: m[1], format: m[2] || "f", options: m[3] }) },
    { regex: CHANNEL_MENTION_RE, build: (m) => ({ type: "channel_mention", content: m[1] }) },
    { regex: BOLD_RE, build: (m) => ({ type: "bold", content: m[1] }) },
    { regex: UNDERLINE_RE, build: (m) => ({ type: "underline", content: m[1] }) },
    { regex: STRIKE_RE, build: (m) => ({ type: "strikethrough", content: m[1] }) },
    { regex: SPOILER_RE, build: (m) => ({ type: "spoiler", content: m[1] }) },
    { regex: ITALIC_RE, build: (m) => ({ type: "italic", content: m[1] }) },
    { regex: UNDERSCORE_ITALIC_RE, build: (m) => ({ type: "italic", content: m[1] }) },
  ];

  const pushText = (content: string) => {
    if (!content) return;
    const last = nodes[nodes.length - 1];
    if (last && last.type === "text") last.content += content;
    else nodes.push({ type: "text", content });
  };

  while (remaining.length > 0) {
    let best: { index: number; length: number; node: MarkdownNode } | null = null;
    for (const candidate of candidates) {
      const match = remaining.match(candidate.regex);
      if (match && match.index !== undefined && (!best || match.index < best.index)) {
        best = { index: match.index, length: match[0].length, node: candidate.build(match) };
      }
    }
    if (!best) {
      pushText(remaining);
      break;
    }
    pushText(remaining.slice(0, best.index));
    if (NESTING.has(best.node.type)) {
      best.node.children = parseInlineMarkdown(best.node.content);
      best.node.content = "";
    }
    if (best.node.type === "text") pushText(best.node.content);
    else nodes.push(best.node);
    remaining = remaining.slice(best.index + best.length);
  }
  return nodes;
}

// ── Blocks ──────────────────────────────────────────────────────────────

export interface MarkdownListItem {
  text: string;
  /** Nested lists under this item. */
  children: MarkdownBlock[];
}

export type MarkdownBlock =
  | { type: "paragraph"; text: string }
  | { type: "heading"; level: 1 | 2 | 3; text: string }
  | { type: "small"; text: string }
  | { type: "codeblock"; code: string; lang: string }
  | { type: "blockquote"; children: MarkdownBlock[] }
  | { type: "list"; ordered: boolean; start: number; items: MarkdownListItem[] };

const HEADING_RE = /^(#{1,3})[ \t]+(?!#)(\S.*?)[ \t]*$/;
const SMALL_RE = /^-#[ \t]+(\S.*?)[ \t]*$/;
const LIST_ITEM_RE = /^([ \t]*)([-*]|\d{1,9}\.)[ \t]+(\S.*)$/;
const QUOTE_RE = /^> ?(.*)$/;
const QUOTE_START_RE = /^> |^>$/;
const MULTI_QUOTE_RE = /^>>> ?(.*)$/;
const FENCE_LANG_RE = /^[\w+#.-]{1,32}$/;

function indentWidth(ws: string): number {
  let n = 0;
  for (const ch of ws) n += ch === "\t" ? 4 : 1;
  return n;
}

interface FenceResult {
  block: MarkdownBlock;
  /** Index of the next line to read. */
  next: number;
  /** Text left on the closing line after the fence, to parse as a new line. */
  rest?: string;
}

/** A ``` fence starting at `lines[i]`, or null when it never closes (then it's plain text). */
function readFence(lines: string[], i: number): FenceResult | null {
  const first = lines[i].replace(/^\s*```/, "");
  // Opened and closed on one line: ```code```
  const sameLine = first.indexOf("```");
  if (sameLine !== -1) {
    const code = first.slice(0, sameLine);
    if (!code.trim()) return null;
    const rest = first.slice(sameLine + 3);
    return { block: { type: "codeblock", code, lang: "" }, next: i + 1, rest: rest.trim() ? rest : undefined };
  }
  let lang = "";
  const codeLines: string[] = [];
  const opener = first.trim();
  if (FENCE_LANG_RE.test(opener)) lang = opener;
  else if (opener) codeLines.push(first);
  for (let j = i + 1; j < lines.length; j++) {
    const line = lines[j];
    const close = line.indexOf("```");
    if (close === -1) {
      codeLines.push(line);
      continue;
    }
    const before = line.slice(0, close);
    if (before.trim()) codeLines.push(before);
    const rest = line.slice(close + 3);
    return {
      block: { type: "codeblock", code: codeLines.join("\n"), lang: lang.toLowerCase() },
      next: j + 1,
      rest: rest.trim() ? rest : undefined,
    };
  }
  return null;
}

function isFenceOpen(lines: string[], i: number): boolean {
  return /^\s*```/.test(lines[i]) && readFence(lines, i) !== null;
}

/** Lines that start a block other than a paragraph. */
function startsBlock(lines: string[], i: number, inQuote: boolean): boolean {
  const line = lines[i];
  if (isFenceOpen(lines, i)) return true;
  if (HEADING_RE.test(line) || SMALL_RE.test(line) || LIST_ITEM_RE.test(line)) return true;
  if (!inQuote && (MULTI_QUOTE_RE.test(line) || QUOTE_START_RE.test(line))) return true;
  return false;
}

/** Parse consecutive list lines starting at `i` into one (possibly nested) list. */
function readList(lines: string[], i: number): { block: MarkdownBlock; next: number } {
  type Frame = { indent: number; list: Extract<MarkdownBlock, { type: "list" }> };
  const first = lines[i].match(LIST_ITEM_RE)!;
  const makeList = (marker: string): Extract<MarkdownBlock, { type: "list" }> => {
    const ordered = marker !== "-" && marker !== "*";
    return { type: "list", ordered, start: ordered ? Math.min(parseInt(marker, 10) || 1, 999_999_999) : 1, items: [] };
  };
  const root = makeList(first[2]);
  const stack: Frame[] = [{ indent: indentWidth(first[1]), list: root }];
  let j = i;
  for (; j < lines.length; j++) {
    const line = lines[j];
    const m = line.match(LIST_ITEM_RE);
    if (!m) {
      // An indented line under an item continues it; anything else ends the list.
      const top = stack[stack.length - 1];
      const lastItem = top.list.items[top.list.items.length - 1];
      if (lastItem && line.trim() && /^[ \t]+\S/.test(line) && !isFenceOpen(lines, j)) {
        lastItem.text += `\n${line.trim()}`;
        continue;
      }
      break;
    }
    const indent = indentWidth(m[1]);
    while (stack.length > 1 && indent < stack[stack.length - 1].indent) stack.pop();
    let top = stack[stack.length - 1];
    // A bullet list followed by a numbered one (or the reverse) is two lists.
    const ordered = m[2] !== "-" && m[2] !== "*";
    if (stack.length === 1 && indent <= top.indent && ordered !== root.ordered) break;
    if (indent > top.indent && top.list.items.length > 0) {
      // Deeper: a nested list under the previous item (Discord caps nesting).
      if (stack.length < 11) {
        const parentItem = top.list.items[top.list.items.length - 1];
        const nested = makeList(m[2]);
        parentItem.children.push(nested);
        stack.push({ indent, list: nested });
        top = stack[stack.length - 1];
      }
    } else if (indent < top.indent && stack.length === 1) {
      top.indent = indent;
    }
    top.list.items.push({ text: m[3], children: [] });
  }
  return { block: root, next: j };
}

/** Split text into Discord markdown blocks (raw text, no inline parsing). */
export function splitMarkdownBlocks(text: string, opts: { inQuote?: boolean } = {}): MarkdownBlock[] {
  const inQuote = Boolean(opts.inQuote);
  // Normalize CRLF / lone-CR line endings first. A trailing "\r" used to make
  // block detection and the paragraph guard disagree, so neither consumed the
  // line and the loop spun forever (the "Partnerships channel" crash).
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (/^\s*```/.test(line)) {
      const fence = readFence(lines, i);
      if (fence) {
        blocks.push(fence.block);
        if (fence.rest !== undefined) {
          lines[fence.next - 1] = fence.rest;
          i = fence.next - 1;
        } else {
          i = fence.next;
        }
        continue;
      }
    }

    if (!inQuote) {
      const multi = line.match(MULTI_QUOTE_RE);
      if (multi) {
        // ">>> " quotes everything to the end of the message.
        const inner = [multi[1], ...lines.slice(i + 1)].join("\n");
        blocks.push({ type: "blockquote", children: splitMarkdownBlocks(inner, { inQuote: true }) });
        break;
      }
      if (QUOTE_START_RE.test(line)) {
        const quoteLines: string[] = [];
        while (i < lines.length && QUOTE_START_RE.test(lines[i]) && !MULTI_QUOTE_RE.test(lines[i])) {
          quoteLines.push(lines[i].match(QUOTE_RE)![1]);
          i++;
        }
        blocks.push({ type: "blockquote", children: splitMarkdownBlocks(quoteLines.join("\n"), { inQuote: true }) });
        continue;
      }
    }

    const heading = line.match(HEADING_RE);
    if (heading) {
      blocks.push({ type: "heading", level: heading[1].length as 1 | 2 | 3, text: heading[2] });
      i++;
      continue;
    }

    const small = line.match(SMALL_RE);
    if (small) {
      blocks.push({ type: "small", text: small[1] });
      i++;
      continue;
    }

    if (LIST_ITEM_RE.test(line)) {
      const list = readList(lines, i);
      blocks.push(list.block);
      i = list.next;
      continue;
    }

    // Paragraph: everything up to the next line that starts another block.
    const para: string[] = [line];
    i++;
    while (i < lines.length && !startsBlock(lines, i, inQuote)) {
      para.push(lines[i]);
      i++;
    }
    blocks.push({ type: "paragraph", text: para.join("\n") });
  }

  // A block followed by a newline swallows it (Discord): drop paragraphs that
  // are only that separating line break.
  return blocks.filter((b, idx) => !(b.type === "paragraph" && b.text === "" && idx > 0));
}

// ── Combined (plain renderers) ──────────────────────────────────────────

export interface ParsedListItem {
  inline: MarkdownNode[];
  children: ParsedMarkdown[];
}

export interface ParsedMarkdown {
  type: "paragraph" | "codeblock" | "heading" | "blockquote" | "small" | "list";
  level?: number;
  inline?: MarkdownNode[];
  code?: string;
  lang?: string;
  /** blockquote: the quoted blocks. */
  children?: ParsedMarkdown[];
  /** list */
  ordered?: boolean;
  start?: number;
  items?: ParsedListItem[];
}

function toParsed(block: MarkdownBlock): ParsedMarkdown {
  switch (block.type) {
    case "codeblock":
      return { type: "codeblock", code: block.code, lang: block.lang };
    case "heading":
      return { type: "heading", level: block.level, inline: parseInlineMarkdown(block.text) };
    case "small":
      return { type: "small", inline: parseInlineMarkdown(block.text) };
    case "blockquote":
      return { type: "blockquote", children: block.children.map(toParsed) };
    case "list":
      return {
        type: "list",
        ordered: block.ordered,
        start: block.start,
        items: block.items.map((it) => ({ inline: parseInlineMarkdown(it.text), children: it.children.map(toParsed) })),
      };
    default:
      return { type: "paragraph", inline: parseInlineMarkdown(block.text) };
  }
}

export function parseMarkdown(text: string): ParsedMarkdown[] {
  return splitMarkdownBlocks(text).map(toParsed);
}

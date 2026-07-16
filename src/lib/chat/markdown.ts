export interface MarkdownNode {
  type: "text" | "bold" | "italic" | "underline" | "strikethrough" | "code" | "codeblock" | "link" | "linebreak" | "timestamp" | "channel_mention" | "spoiler";
  content: string;
  href?: string;
  format?: string;
  options?: string;
  children?: MarkdownNode[];
}

const INLINE_CODE_RE = /`([^`]+)`/;
const BOLD_RE = /\*\*([^*]+)\*\*/;
const ITALIC_RE = /(?<!\*)\*([^*]+)\*(?!\*)/;
const UNDERLINE_RE = /__([^_]+)__/;
const STRIKE_RE = /~~([^~]+)~~/;
const SPOILER_RE = /\|\|([^|]+)\|\|/;
const LINK_RE = /\[([^\]]+)\]\(([^)]+)\)/;
const TIMESTAMP_RE = /<t:(-?\d+)(?::([tTdDfFRC])((?:\[[^\]]*\])*))?>/;
const CHANNEL_MENTION_RE = /<#([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})>/;

function parseInline(text: string): MarkdownNode[] {
  const nodes: MarkdownNode[] = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    let earliestMatch: { index: number; length: number; node: MarkdownNode } | null = null;

    const candidates: Array<{ regex: RegExp; type: MarkdownNode["type"]; build: (m: RegExpMatchArray) => MarkdownNode }> = [
      { regex: INLINE_CODE_RE, type: "code", build: (m) => ({ type: "code", content: m[1], key: `ic-${key++}` } as MarkdownNode) },
      { regex: BOLD_RE, type: "bold", build: (m) => ({ type: "bold", content: m[1], key: `b-${key++}` } as MarkdownNode) },
      { regex: UNDERLINE_RE, type: "underline", build: (m) => ({ type: "underline", content: m[1], key: `u-${key++}` } as MarkdownNode) },
      { regex: STRIKE_RE, type: "strikethrough", build: (m) => ({ type: "strikethrough", content: m[1], key: `s-${key++}` } as MarkdownNode) },
      { regex: SPOILER_RE, type: "spoiler", build: (m) => ({ type: "spoiler", content: m[1], key: `sp-${key++}` } as MarkdownNode) },
      { regex: ITALIC_RE, type: "italic", build: (m) => ({ type: "italic", content: m[1], key: `i-${key++}` } as MarkdownNode) },
      { regex: LINK_RE, type: "link", build: (m) => {
        const href = m[2];
        if (/serika\.cc/i.test(href)) {
          return { type: "text", content: m[1], key: `l-${key++}` } as MarkdownNode;
        }
        // Security: only allow safe URL schemes to prevent javascript: XSS
        const trimmedHref = href.trim().toLowerCase();
        const isSafeScheme = /^https?:\/\//i.test(trimmedHref) ||
          /^mailto:/i.test(trimmedHref) ||
          /^\/[^/]/i.test(trimmedHref) ||   // relative paths
          /^#/.test(trimmedHref);              // anchor links
        if (!isSafeScheme) {
          // Dangerous scheme (javascript:, data:, vbscript:, etc.) — render as plain text
          return { type: "text", content: `[${m[1]}](${href})`, key: `l-${key++}` } as MarkdownNode;
        }
        return { type: "link", content: m[1], href, key: `l-${key++}` } as MarkdownNode;
      } },
      { regex: TIMESTAMP_RE, type: "timestamp", build: (m) => ({ type: "timestamp", content: m[1], format: m[2] || "f", options: m[3], key: `ts-${key++}` } as MarkdownNode) },
      { regex: CHANNEL_MENTION_RE, type: "channel_mention", build: (m) => ({ type: "channel_mention", content: m[1], key: `ch-${key++}` } as MarkdownNode) },
    ];

    for (const candidate of candidates) {
      const match = remaining.match(candidate.regex);
      if (match && match.index !== undefined) {
        if (!earliestMatch || match.index < earliestMatch.index) {
          earliestMatch = { index: match.index, length: match[0].length, node: candidate.build(match) };
        }
      }
    }

    if (!earliestMatch) {
      if (remaining.length > 0) {
        nodes.push({ type: "text", content: remaining });
      }
      break;
    }

    if (earliestMatch.index > 0) {
      nodes.push({ type: "text", content: remaining.slice(0, earliestMatch.index) });
    }

    if (earliestMatch.node.type === "bold" || earliestMatch.node.type === "italic" || earliestMatch.node.type === "underline" || earliestMatch.node.type === "strikethrough" || earliestMatch.node.type === "spoiler") {
      earliestMatch.node.children = parseInline(earliestMatch.node.content);
      earliestMatch.node.content = "";
    }

    nodes.push(earliestMatch.node);
    remaining = remaining.slice(earliestMatch.index + earliestMatch.length);
  }

  return nodes;
}

export interface ParsedMarkdown {
  type: "paragraph" | "codeblock" | "heading" | "blockquote" | "small";
  level?: number;
  inline?: MarkdownNode[];
  code?: string;
  lang?: string;
}

export function parseMarkdown(text: string): ParsedMarkdown[] {
  const blocks: ParsedMarkdown[] = [];
  const lines = text.split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Code block
    if (line.trim().startsWith("```")) {
      const lang = line.trim().slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      blocks.push({ type: "codeblock", code: codeLines.join("\n"), lang });
      continue;
    }

    // Multi-line blockquote (>>>)
    if (line.trim().startsWith(">>>")) {
      const quoteLines: string[] = [];
      while (i < lines.length && (lines[i].trim().startsWith(">>>") || lines[i].trim().startsWith(">"))) {
        quoteLines.push(lines[i].replace(/^>>?>\s*/, ""));
        i++;
      }
      blocks.push({ type: "blockquote", inline: parseInline(quoteLines.join("\n")) });
      continue;
    }

    // Single-line blockquote (>)
    if (line.trim().startsWith(">") && !line.trim().startsWith(">>>")) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith(">") && !lines[i].trim().startsWith(">>>")) {
        quoteLines.push(lines[i].replace(/^>\s*/, ""));
        i++;
      }
      blocks.push({ type: "blockquote", inline: parseInline(quoteLines.join("\n")) });
      continue;
    }

    // Heading — space after # is optional (#Hello and # Hello both work)
    const headingMatch = line.match(/^(#{1,3})\s*(.+)$/);
    if (headingMatch) {
      blocks.push({
        type: "heading",
        level: headingMatch[1].length,
        inline: parseInline(headingMatch[2]),
      });
      i++;
      continue;
    }

    // Small text block (-# syntax)
    const smallMatch = line.match(/^-(#{1,3})\s*(.+)$/);
    if (smallMatch) {
      blocks.push({
        type: "small",
        inline: parseInline(smallMatch[2]),
      });
      i++;
      continue;
    }

    // Paragraph - collect consecutive lines (including empty ones for multiline support)
    const paraLines: string[] = [];
    while (i < lines.length && !lines[i].trim().startsWith("```") && !lines[i].match(/^#{1,3}\s*.+/) && !lines[i].match(/^-(#{1,3})\s*.+/) && !lines[i].trim().startsWith(">")) {
      paraLines.push(lines[i]);
      i++;
    }

    const paraText = paraLines.join("\n");
    blocks.push({ type: "paragraph", inline: parseInline(paraText) });
  }

  return blocks;
}

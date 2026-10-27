/**
 * Long-form blocks in an app's long description that the chat markdown
 * renderer doesn't handle: thematic breaks (`---`) and GitHub-style tables.
 * Everything else stays markdown text for the chat renderer. Pure; tested in
 * tests/app-directory-description.test.ts.
 */

export type DescriptionBlock =
  | { kind: "markdown"; text: string }
  | { kind: "rule" }
  | { kind: "table"; header: string[] | null; align: Array<"left" | "center" | "right" | null>; rows: string[][] };

const RULE_RE = /^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/;
const FENCE_RE = /^\s{0,3}(```|~~~)/;
const MAX_COLUMNS = 8;
const MAX_ROWS = 50;

/** `| a | b |` → ["a", "b"] (outer pipes optional, `\|` keeps a literal pipe). */
export function splitTableRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  const cells: string[] = [];
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "\\" && s[i + 1] === "|") { cur += "|"; i++; continue; }
    if (ch === "|") { cells.push(cur.trim()); cur = ""; continue; }
    cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}

function delimiterAlign(line: string): Array<"left" | "center" | "right" | null> | null {
  if (!line.includes("-") || !line.includes("|")) return null;
  const cells = splitTableRow(line);
  const out: Array<"left" | "center" | "right" | null> = [];
  for (const c of cells) {
    if (!/^:?-{1,}:?$/.test(c)) return null;
    out.push(c.startsWith(":") && c.endsWith(":") ? "center" : c.endsWith(":") ? "right" : c.startsWith(":") ? "left" : null);
  }
  return out.length > 0 ? out : null;
}

const isTableLine = (line: string) => line.trim().startsWith("|") || /\|/.test(line.trim());

export function parseDescriptionBlocks(content: string): DescriptionBlock[] {
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  const blocks: DescriptionBlock[] = [];
  let buf: string[] = [];
  let inFence = false;
  const flush = () => {
    const text = buf.join("\n");
    if (text.trim()) blocks.push({ kind: "markdown", text });
    buf = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (FENCE_RE.test(line)) inFence = !inFence;
    if (inFence) { buf.push(line); continue; }

    if (RULE_RE.test(line) && line.trim() !== "") {
      // `text\n---` is a setext heading in CommonMark; keep it simple and treat
      // a rule after a blank line (or at the start) as a rule, else text.
      const prev = buf.length ? buf[buf.length - 1] : "";
      if (!prev.trim()) { flush(); blocks.push({ kind: "rule" }); continue; }
    }

    // Table: a header row followed by a delimiter row.
    const next = lines[i + 1];
    if (next !== undefined && line.includes("|") && isTableLine(line)) {
      const align = delimiterAlign(next);
      const header = splitTableRow(line);
      if (align && align.length === header.length && header.length <= MAX_COLUMNS) {
        flush();
        const rows: string[][] = [];
        let j = i + 2;
        while (j < lines.length && lines[j].trim() && lines[j].includes("|") && rows.length < MAX_ROWS) {
          const cells = splitTableRow(lines[j]).slice(0, header.length);
          while (cells.length < header.length) cells.push("");
          rows.push(cells);
          j++;
        }
        blocks.push({ kind: "table", header: header.every((h) => !h) ? null : header, align, rows });
        i = j - 1;
        continue;
      }
    }
    buf.push(line);
  }
  flush();
  return blocks;
}

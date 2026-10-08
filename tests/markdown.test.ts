import { describe, expect, test } from "bun:test";
import { parseMarkdown, type MarkdownNode } from "@/lib/chat/markdown";

function inlineTypes(nodes: MarkdownNode[] | undefined): string[] {
  return (nodes ?? []).map((n) => n.type);
}

describe("parseMarkdown blocks", () => {
  test("headings, small text, quotes and paragraphs", () => {
    const blocks = parseMarkdown("# Title\n-# fine print\n> quoted\nplain text");
    expect(blocks.map((b) => b.type)).toEqual(["heading", "small", "blockquote", "paragraph"]);
    expect(blocks[0].level).toBe(1);
  });

  test("fenced code keeps its language and raw content", () => {
    const [block] = parseMarkdown("```ts\nconst a = 1;\n**not bold**\n```");
    expect(block).toEqual({ type: "codeblock", code: "const a = 1;\n**not bold**", lang: "ts" });
  });

  // Regression: a CRLF line with a heading used to loop forever and crash the
  // tab (the "Partnerships channel" bug). If this hangs, that bug is back.
  test("CRLF and lone CR line endings parse like LF", () => {
    const crlf = parseMarkdown("# Title\r\n-# small\r\nbody\r\n");
    const lf = parseMarkdown("# Title\n-# small\nbody\n");
    expect(crlf).toEqual(lf);
    expect(parseMarkdown("# a\rb")).toEqual(parseMarkdown("# a\nb"));
  });
});

describe("parseMarkdown inline", () => {
  test("nests formatting", () => {
    const [block] = parseMarkdown("**bold __and underlined__**");
    const [bold] = block.inline ?? [];
    expect(bold.type).toBe("bold");
    expect(inlineTypes(bold.children)).toContain("underline");
  });

  test("recognises code, strike, spoiler, timestamps and channel mentions", () => {
    const channelId = "11111111-1111-4111-8111-111111111111";
    const [block] = parseMarkdown(`\`x\` ~~y~~ ||z|| <t:1700000000:R> <#${channelId}>`);
    const types = inlineTypes(block.inline);
    for (const t of ["code", "strikethrough", "spoiler", "timestamp", "channel_mention"]) {
      expect(types).toContain(t);
    }
    const ts = block.inline?.find((n) => n.type === "timestamp");
    expect(ts?.content).toBe("1700000000");
    expect(ts?.format).toBe("R");
  });

  test("allows http(s), mailto and relative links", () => {
    for (const href of ["https://serika.chat", "http://example.com/x", "mailto:a@b.c", "/channels/me"]) {
      const [block] = parseMarkdown(`[go](${href})`);
      expect(block.inline?.[0]).toMatchObject({ type: "link", href, content: "go" });
    }
  });

  test("renders dangerous link schemes as plain text (XSS guard)", () => {
    for (const href of ["javascript:alert(1)", "JavaScript:alert(1)", "data:text/html,<b>x</b>", "vbscript:msgbox(1)"]) {
      const [block] = parseMarkdown(`[click](${href})`);
      const nodes = block.inline ?? [];
      expect(nodes.some((n) => n.type === "link")).toBeFalse();
    }
  });
});

import { describe, expect, test } from "bun:test";
import { isSafeLinkHref, parseInlineMarkdown, parseMarkdown, splitMarkdownBlocks, type MarkdownNode } from "@/lib/chat/markdown";

describe("Discord block rules", () => {
  test("headings need a space after the hashes", () => {
    for (const text of ["#general is down", "#1 fan", "####four", "#"]) {
      expect(splitMarkdownBlocks(text)[0].type).toBe("paragraph");
    }
    expect(splitMarkdownBlocks("## Two")[0]).toEqual({ type: "heading", level: 2, text: "Two" });
    expect(splitMarkdownBlocks("#### Four")[0].type).toBe("paragraph");
  });

  test("-# is subtext only with one hash and a space", () => {
    expect(splitMarkdownBlocks("-# small")[0]).toEqual({ type: "small", text: "small" });
    expect(splitMarkdownBlocks("-## no")[0].type).toBe("paragraph");
    expect(splitMarkdownBlocks("-#no")[0].type).toBe("paragraph");
  });

  test("unordered and ordered lists, nested by indentation", () => {
    const [list] = splitMarkdownBlocks("- a\n* b\n  - c\n    - d\n- e");
    expect(list.type).toBe("list");
    if (list.type !== "list") return;
    expect(list.ordered).toBe(false);
    expect(list.items.map((i) => i.text)).toEqual(["a", "b", "e"]);
    const nested = list.items[1].children[0];
    expect(nested.type).toBe("list");
    if (nested.type !== "list") return;
    expect(nested.items[0].text).toBe("c");
    expect(nested.items[0].children[0]).toMatchObject({ type: "list", items: [{ text: "d" }] });

    const [ol] = splitMarkdownBlocks("3. three\n4. four");
    expect(ol).toMatchObject({ type: "list", ordered: true, start: 3 });
  });

  test("a numbered list after a bullet list is a separate list; text ends a list", () => {
    const blocks = splitMarkdownBlocks("- a\n1. b\nafter");
    expect(blocks.map((b) => b.type)).toEqual(["list", "list", "paragraph"]);
  });

  test("not lists: no space, no content, numbers in prose", () => {
    for (const text of ["-1 points", "*not a list*", "1.5 is a number", "- "]) {
      expect(splitMarkdownBlocks(text)[0].type).toBe("paragraph");
    }
  });

  test("> quotes need a space; >>> quotes the rest of the message", () => {
    expect(splitMarkdownBlocks(">no")[0].type).toBe("paragraph");
    const quoted = splitMarkdownBlocks("> one\n> # two\nafter");
    expect(quoted[0]).toMatchObject({ type: "blockquote", children: [{ type: "paragraph", text: "one" }, { type: "heading", text: "two" }] });
    expect(quoted[1]).toEqual({ type: "paragraph", text: "after" });
    const multi = splitMarkdownBlocks("before\n>>> all\nof\n- this");
    expect(multi.map((b) => b.type)).toEqual(["paragraph", "blockquote"]);
    expect(multi[1]).toMatchObject({ children: [{ type: "paragraph", text: "all\nof" }, { type: "list" }] });
  });

  test("code fences: language, one-line fences, unclosed fences stay text", () => {
    expect(splitMarkdownBlocks("```py\nprint(1)\n```")[0]).toEqual({ type: "codeblock", code: "print(1)", lang: "py" });
    expect(splitMarkdownBlocks("```x = 1```")[0]).toEqual({ type: "codeblock", code: "x = 1", lang: "" });
    expect(splitMarkdownBlocks("```js\nopen")[0].type).toBe("paragraph");
    // Markdown inside a fence is literal.
    expect(splitMarkdownBlocks("```\n# not a heading\n- nor a list\n```")).toEqual([
      { type: "codeblock", code: "# not a heading\n- nor a list", lang: "" },
    ]);
  });
});

describe("inline rules", () => {
  test("bare URLs are kept whole (underscores in URLs are not underline)", () => {
    const nodes = parseInlineMarkdown("see https://a.com/x__y__z.");
    expect(nodes.find((n) => n.type === "url")?.content).toBe("https://a.com/x__y__z");
    expect(nodes.some((n) => n.type === "underline")).toBeFalse();
    expect(parseInlineMarkdown("<https://b.com>")[0]).toMatchObject({ type: "url", content: "https://b.com" });
  });

  test("masked links whose text is a URL are not links", () => {
    const nodes = parseInlineMarkdown("[https://good.com](https://evil.com)");
    expect(nodes.some((n) => n.type === "link")).toBeFalse();
    expect(isSafeLinkHref("javascript:alert(1)")).toBeFalse();
    expect(isSafeLinkHref("https://x.com")).toBeTrue();
  });

  test("_italic_ respects word boundaries; escapes stay literal", () => {
    expect(parseInlineMarkdown("_hi_")[0].type).toBe("italic");
    expect(parseInlineMarkdown("snake_case_name").every((n) => n.type === "text")).toBeTrue();
    expect(parseInlineMarkdown("\\*not italic\\*")).toEqual([{ type: "text", content: "*not italic*" }]);
  });

  test("formatting wraps mentions so the caller can tokenize them inside", () => {
    const [bold] = parseInlineMarkdown("**hi <@11111111-1111-4111-8111-111111111111>**");
    expect(bold.type).toBe("bold");
    expect(bold.children?.[0]).toEqual({ type: "text", content: "hi <@11111111-1111-4111-8111-111111111111>" });
  });

  test("list items carry inline nodes", () => {
    const [list] = parseMarkdown("- **a**\n- b");
    expect(list.type).toBe("list");
    expect(list.items?.[0].inline[0].type).toBe("bold");
  });
});

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

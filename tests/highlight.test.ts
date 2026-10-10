import { describe, expect, test } from "bun:test";
import { highlightCode, isHighlightable, MAX_HIGHLIGHT_LENGTH } from "@/lib/chat/highlight";

const kinds = (code: string, lang: string) =>
  (highlightCode(code, lang) ?? []).filter((t) => t.kind).map((t) => `${t.kind}:${t.text}`);

describe("highlightCode", () => {
  test("unknown languages and oversized code are left plain", () => {
    expect(highlightCode("x", "brainfuck")).toBeNull();
    expect(highlightCode("x", "")).toBeNull();
    expect(highlightCode("a".repeat(MAX_HIGHLIGHT_LENGTH + 1), "js")).toBeNull();
    expect(isHighlightable("TS")).toBeTrue();
  });

  test("tokens always rebuild the source exactly", () => {
    const samples: Array<[string, string]> = [
      ["const a = `x${1}`; // c\n/* b */ foo(2.5e3)", "ts"],
      ['def f():\n    """d"""\n    return None  # c', "python"],
      ['<a href="x">&amp;</a><!-- c -->', "html"],
      ['{"k": [1, true]}', "json"],
      ["key: value\n# c\n- 1", "yaml"],
      ["+a\n-b\n c", "diff"],
      [".x { color: #fff }", "css"],
      ["[s]\nk = 'v'", "toml"],
      ["echo \"$HOME\" 'x'", "bash"],
      ["SELECT 1 -- c", "sql"],
      ['#include <x.h>\nint main() { return 0; }', "cpp"],
    ];
    for (const [code, lang] of samples) {
      const tokens = highlightCode(code, lang);
      expect(tokens).not.toBeNull();
      expect(tokens!.map((t) => t.text).join("")).toBe(code);
    }
  });

  test("classifies the common token kinds", () => {
    const js = kinds("const x = 42; // hi\nfoo('s')", "js");
    expect(js).toContain("keyword:const");
    expect(js).toContain("number:42");
    expect(js).toContain("comment:// hi");
    expect(js).toContain("function:foo");
    expect(js).toContain("string:'s'");
    expect(kinds("SELECT * FROM t", "sql")).toEqual(["keyword:SELECT", "keyword:FROM"]);
    expect(kinds('{"a": 1}', "json")).toEqual(['attr:"a"', "number:1"]);
    expect(kinds("+add\n-del", "diff")).toEqual(["addition:+add", "deletion:-del"]);
    expect(kinds("<b>", "html")).toEqual(["tag:b"]);
  });

  test("identifiers containing digits are not numbers", () => {
    expect(kinds("x1 = v2", "py")).toEqual([]);
  });
});

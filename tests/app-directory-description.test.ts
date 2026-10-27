import { describe, expect, test } from "bun:test";
import { parseDescriptionBlocks, splitTableRow } from "@/lib/appDirectory/descriptionBlocks";

describe("app long description blocks", () => {
  test("--- after a blank line is a rule; text stays markdown", () => {
    const blocks = parseDescriptionBlocks("# Title\n\nIntro\n\n---\n\n## Next\n- a");
    expect(blocks.map((b) => b.kind)).toEqual(["markdown", "rule", "markdown"]);
    expect(blocks[0]).toEqual({ kind: "markdown", text: "# Title\n\nIntro\n" });
  });

  test("tables with a delimiter row, optional header, alignment and escaped pipes", () => {
    const blocks = parseDescriptionBlocks("## Tools\n| | |\n|---|:---:|\n| 🏷️ **Tags** | `a!tag rules` |\n| a \\| b | c |\n\nAfter");
    expect(blocks.map((b) => b.kind)).toEqual(["markdown", "table", "markdown"]);
    const t = blocks[1];
    if (t.kind !== "table") throw new Error("not a table");
    expect(t.header).toBeNull();
    expect(t.align).toEqual([null, "center"]);
    expect(t.rows).toEqual([["🏷️ **Tags**", "`a!tag rules`"], ["a | b", "c"]]);
  });

  test("a pipe in a normal sentence, or inside a code fence, is not a table", () => {
    expect(parseDescriptionBlocks("Use a | b to choose.\nNext line").map((b) => b.kind)).toEqual(["markdown"]);
    expect(parseDescriptionBlocks("```\n| a |\n|---|\n---\n```").map((b) => b.kind)).toEqual(["markdown"]);
  });

  test("setext-style text directly above --- stays text", () => {
    expect(parseDescriptionBlocks("Heading\n---").map((b) => b.kind)).toEqual(["markdown"]);
  });

  test("splitTableRow", () => {
    expect(splitTableRow("| a | b |")).toEqual(["a", "b"]);
    expect(splitTableRow("a | b")).toEqual(["a", "b"]);
  });
});

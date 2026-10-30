import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { IntlMessageFormat } from "intl-messageformat";

// gt() strings are ICU messages. In ICU an ASCII apostrophe right before a
// brace starts quoted literal text, so "Leave '{name}'" renders the literal
// text "Leave {name}" instead of the server name (CORD-78). Quote variables
// with double quotes (or typographic quotes) instead.

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const QUOTED_VARIABLE = /'\{[A-Za-z_]\w*\}/;

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sourceFiles(path, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(path);
  }
  return out;
}

describe("ICU apostrophe escaping in translated strings", () => {
  test("the old single-quoted form really hides the variable", () => {
    expect(new IntlMessageFormat("Leave '{name}'", "en").format({ name: "Test" })).toBe("Leave {name}");
    expect(new IntlMessageFormat("Leave \"{name}\"? You'll need a new invite to rejoin.", "en").format({ name: "Test" }))
      .toBe("Leave \"Test\"? You'll need a new invite to rejoin.");
  });

  test("no gt() source string single-quotes a variable", () => {
    const offenders: string[] = [];
    const call = /\bgt\(\s*"((?:[^"\\]|\\.)*)"/g;
    for (const file of sourceFiles(join(ROOT, "src"))) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(call)) {
        if (QUOTED_VARIABLE.test(match[1])) offenders.push(`${file.slice(ROOT.length + 1)}: ${match[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test("no translation file single-quotes a variable", () => {
    const offenders: string[] = [];
    const dir = join(ROOT, "public/_gt");
    for (const name of readdirSync(dir).filter((n) => n.endsWith(".json"))) {
      const data = JSON.parse(readFileSync(join(dir, name), "utf8")) as Record<string, unknown>;
      for (const [key, value] of Object.entries(data)) {
        if (typeof value === "string" && QUOTED_VARIABLE.test(value)) offenders.push(`${name} ${key}: ${value}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

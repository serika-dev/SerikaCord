#!/usr/bin/env bun
/**
 * Add an entry to the "## Unreleased" section of CHANGELOG.md.
 *
 *   bun scripts/changelog-add.ts <Added|Changed|Fixed|Performance|Security|Removed> "entry text"
 *   bun run changelog Fixed "**Close DM works** — the X on a DM row did nothing."
 *
 * The kind maps to the changelog's house headings (Added → Features,
 * Fixed → Bug Fixes, …; see CHANGELOG_CATEGORIES in src/lib/changelog.ts).
 * The bullet is appended under that heading, which is created if missing.
 * Released by scripts/release.ts.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CHANGELOG_CATEGORIES, CHANGELOG_HEADINGS, type ChangelogKind } from "../src/lib/changelog";

const CHANGELOG = join(import.meta.dir, "..", "CHANGELOG.md");
const kinds = Object.keys(CHANGELOG_CATEGORIES) as ChangelogKind[];

function usage(msg?: string): never {
  if (msg) console.error(`✖ ${msg}\n`);
  console.error(`Usage: bun scripts/changelog-add.ts <${kinds.join("|")}> "entry text"`);
  process.exit(1);
}

const [kindArg, ...textParts] = process.argv.slice(2);
if (!kindArg || textParts.length === 0) usage();
const kind = kinds.find((k) => k.toLowerCase() === kindArg.toLowerCase());
if (!kind) usage(`Unknown kind "${kindArg}"`);
const text = textParts.join(" ").trim().replace(/^[-*]\s+/, "").replace(/\s*\n\s*/g, " ");
if (!text) usage("Entry text is empty");

const heading = CHANGELOG_CATEGORIES[kind];
const src = readFileSync(CHANGELOG, "utf8");
const nl = src.includes("\r\n") ? "\r\n" : "\n";
const lines = src.replace(/\r\n/g, "\n").split("\n");

// Locate Unreleased; create it above the first release if it's missing.
let start = lines.findIndex((l) => /^## Unreleased\s*$/.test(l));
if (start === -1) {
  let firstSection = lines.findIndex((l) => l.startsWith("## "));
  if (firstSection === -1) firstSection = lines.length;
  lines.splice(firstSection, 0, "## Unreleased", "", "---", "");
  start = firstSection;
}
let end = lines.findIndex((l, i) => i > start && l.startsWith("## "));
if (end === -1) end = lines.length;
// The section's closing "---" separator stays below everything we insert.
let bodyEnd = end;
while (bodyEnd > start + 1 && (lines[bodyEnd - 1].trim() === "" || /^---\s*$/.test(lines[bodyEnd - 1]))) bodyEnd--;

const headingIdx = lines.findIndex((l, i) => i > start && i < bodyEnd && l.trim() === `### ${heading}`);
const bullet = `- ${text}`;

if (headingIdx !== -1) {
  // After the last line belonging to this heading (before the next heading).
  let insertAt = headingIdx + 1;
  for (let i = headingIdx + 1; i < bodyEnd && !/^#{2,3}\s/.test(lines[i]); i++) {
    if (lines[i].trim() !== "") insertAt = i + 1;
  }
  lines.splice(insertAt, 0, bullet);
} else {
  // New heading: place it in the standard order relative to existing headings.
  const order = CHANGELOG_HEADINGS.indexOf(heading);
  let insertAt = bodyEnd;
  for (let i = start + 1; i < bodyEnd; i++) {
    const m = lines[i].match(/^### (.+?)\s*$/);
    if (m && CHANGELOG_HEADINGS.indexOf(m[1]) > order) {
      insertAt = i;
      break;
    }
  }
  // Before another heading: "### H", bullet, blank. At the end of the body
  // (whose trailing blank line + "---" follow): blank, "### H", bullet.
  const block = insertAt === bodyEnd ? ["", `### ${heading}`, bullet] : [`### ${heading}`, bullet, ""];
  lines.splice(insertAt, 0, ...block);
}

writeFileSync(CHANGELOG, lines.join(nl));
console.log(`✔ CHANGELOG.md → Unreleased → ${heading}: ${bullet}`);

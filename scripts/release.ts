#!/usr/bin/env bun
/**
 * Cut a SerikaCord release: bump the version everywhere it lives and turn the
 * CHANGELOG "## Unreleased" section into a dated release section.
 *
 *   bun scripts/release.ts <patch|minor|major|x.y.z> [--dry-run] [--commit] [--tag] [--allow-empty]
 *
 *   --dry-run      print the planned diff, write nothing
 *   --commit       commit the bump as "release: vX.Y.Z" (only the files this script touched)
 *   --tag          also create the annotated tag vX.Y.Z (needs --commit)
 *   --allow-empty  release even if Unreleased has no entries
 *
 *   bun run release:dry [minor]     preview (defaults to patch)
 *   bun run release minor --commit --tag
 *
 * Never pushes. After it runs: `git push && git push origin vX.Y.Z` — the tag
 * push starts the Release Build workflow (.github/workflows/build.yml), which
 * takes the version from the tag.
 *
 * The UI never hard-codes the version: it reads APP_VERSION (src/lib/version.ts),
 * which next.config.ts inlines from package.json at build time.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { CHANGELOG_HEADINGS, stripEmptyHeadings } from "../src/lib/changelog";

const ROOT = join(import.meta.dir, "..");

// ─── args ───────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const positional = args.filter((a) => !a.startsWith("--"));
const KNOWN_FLAGS = ["--dry-run", "--commit", "--tag", "--allow-empty"];

function usage(msg?: string): never {
  if (msg) console.error(`✖ ${msg}\n`);
  console.error("Usage: bun scripts/release.ts <patch|minor|major|x.y.z> [--dry-run] [--commit] [--tag] [--allow-empty]");
  process.exit(1);
}

for (const f of flags) if (!KNOWN_FLAGS.includes(f)) usage(`Unknown flag ${f}`);
const dryRun = flags.has("--dry-run");
// `bun run release:dry` with no bump previews a patch release.
if (positional.length === 0 && dryRun) positional.push("patch");
if (positional.length !== 1) usage();
const doCommit = flags.has("--commit");
const doTag = flags.has("--tag");
const allowEmpty = flags.has("--allow-empty");
if (doTag && !doCommit) usage("--tag needs --commit (the tag must point at the release commit)");

// ─── helpers ────────────────────────────────────────────────────────────────
function git(...gitArgs: string[]): { ok: boolean; out: string } {
  const r = spawnSync("git", gitArgs, { cwd: ROOT, encoding: "utf8" });
  return { ok: r.status === 0, out: (r.stdout || "").trim() + (r.status === 0 ? "" : (r.stderr || "").trim()) };
}

function fail(msg: string): never {
  console.error(`✖ ${msg}`);
  process.exit(1);
}

type Semver = [number, number, number];

function parseSemver(v: string): Semver | null {
  const m = v.trim().replace(/^v/, "").match(/^(\d+)\.(\d+)\.(\d+)$/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function compareSemver(a: Semver, b: Semver): number {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

function today(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// ─── preflight ──────────────────────────────────────────────────────────────
if (!git("rev-parse", "--is-inside-work-tree").ok) fail("Not inside a git checkout.");
if (!git("diff", "--cached", "--quiet").ok) {
  fail("The git index has staged changes. Commit or unstage them first so the release commit only contains the bump.");
}

const pkgPath = join(ROOT, "package.json");
const current = JSON.parse(readFileSync(pkgPath, "utf8")).version as string;
const currentSemver = parseSemver(current);
if (!currentSemver) fail(`package.json version "${current}" is not x.y.z`);

const bump = positional[0];
let nextSemver: Semver;
if (bump === "patch") nextSemver = [currentSemver[0], currentSemver[1], currentSemver[2] + 1];
else if (bump === "minor") nextSemver = [currentSemver[0], currentSemver[1] + 1, 0];
else if (bump === "major") nextSemver = [currentSemver[0] + 1, 0, 0];
else {
  const explicit = parseSemver(bump);
  if (!explicit) usage(`"${bump}" is not patch, minor, major or x.y.z`);
  nextSemver = explicit;
}
if (compareSemver(nextSemver, currentSemver) <= 0) {
  fail(`Next version ${nextSemver.join(".")} must be greater than the current ${current}.`);
}
const next = nextSemver.join(".");
const tag = `v${next}`;

if (git("rev-parse", "-q", "--verify", `refs/tags/${tag}`).ok) fail(`Tag ${tag} already exists.`);

const headSha = git("rev-parse", "--short", "HEAD").out;

// ─── planned edits ──────────────────────────────────────────────────────────
interface Edit {
  path: string;
  /** Return the new content, or throw if the expected version field is missing. */
  apply: (src: string) => string;
}

/** Replace the first match of `re` (whose group 1 is the old value) with `value`. */
function replaceField(src: string, re: RegExp, value: string, what: string): string {
  const m = src.match(re);
  if (!m || m.index === undefined) throw new Error(`could not find ${what}`);
  const start = m.index + m[0].indexOf(m[1]);
  return src.slice(0, start) + value + src.slice(start + m[1].length);
}

const jsonVersion = (src: string) => replaceField(src, /"version"\s*:\s*"([^"]*)"/, next, '"version"');

const edits: Edit[] = [
  { path: "package.json", apply: jsonVersion },
  { path: "desktop-tauri/package.json", apply: jsonVersion },
  { path: "desktop-tauri/src-tauri/tauri.conf.json", apply: jsonVersion },
  {
    path: "desktop-tauri/src-tauri/Cargo.toml",
    // The [package] version — the first top-level `version = ` line.
    apply: (src) => replaceField(src, /^\[package\]\r?\n(?:(?!\[)[^\n]*\n)*?version\s*=\s*"([^"]*)"/m, next, "[package] version"),
  },
  {
    path: "desktop-tauri/src-tauri/Cargo.lock",
    apply: (src) => replaceField(src, /name = "serikacord-desktop"\r?\nversion = "([^"]*)"/, next, "serikacord-desktop entry"),
  },
  { path: "desktop/package.json", apply: jsonVersion },
  {
    path: "mobile/android/app/build.gradle",
    apply: (src) => {
      let out = replaceField(src, /versionName\s+"([^"]*)"/, next, "versionName");
      const code = out.match(/versionCode\s+(\d+)/);
      if (!code) throw new Error("could not find versionCode");
      out = replaceField(out, /versionCode\s+(\d+)/, String(Number(code[1]) + 1), "versionCode");
      return out;
    },
  },
  {
    path: "desktop-QT/CMakeLists.txt",
    apply: (src) => replaceField(src, /project\(\s*SerikaCord\s+VERSION\s+([\d.]+)/, next, "project() VERSION"),
  },
  {
    path: "desktop-QT/Info.plist",
    apply: (src) => {
      let out = replaceField(src, /<key>CFBundleVersion<\/key>\s*<string>([^<]*)<\/string>/, next, "CFBundleVersion");
      out = replaceField(out, /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]*)<\/string>/, next, "CFBundleShortVersionString");
      return out;
    },
  },
  { path: "CHANGELOG.md", apply: (src) => releaseChangelog(src) },
];

/** Move the Unreleased body into a new "## vX.Y.Z — date" section. */
function releaseChangelog(src: string): string {
  const nl = src.includes("\r\n") ? "\r\n" : "\n";
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const start = lines.findIndex((l) => /^## Unreleased\s*$/.test(l));
  if (start === -1) throw new Error('no "## Unreleased" section');
  let end = lines.findIndex((l, i) => i > start && l.startsWith("## "));
  if (end === -1) end = lines.length;

  const body = stripEmptyHeadings(
    lines.slice(start + 1, end).join("\n").replace(/\n+---\s*$/, "").trim(),
  );
  if (!body && !allowEmpty) {
    throw new Error("Unreleased has no entries (add some with `bun run changelog`, or pass --allow-empty)");
  }

  const fresh = ["## Unreleased", "", ...CHANGELOG_HEADINGS.flatMap((h) => [`### ${h}`, ""]), "---", ""];
  const release = [
    `## ${tag} — ${today()}`,
    "",
    `**Tag:** \`${tag}\` · **Commit:** \`${headSha}\``,
    "",
    ...(body ? [body, ""] : []),
    "---",
    "",
  ];

  const head = lines.slice(0, start).join("\n")
    // Keep the preamble's "vA → vB" range pointing at the newest release.
    .replace(/(→\s*)v\d+\.\d+\.\d+/, `$1${tag}`);
  const rest = lines.slice(end);
  return [head, ...fresh, ...release, ...rest].join("\n").split("\n").join(nl);
}

// ─── run ────────────────────────────────────────────────────────────────────
console.log(`SerikaCord ${current} → ${next}${dryRun ? " (dry run)" : ""}\n`);

const planned: { path: string; before: string; after: string }[] = [];
for (const edit of edits) {
  const abs = join(ROOT, edit.path);
  if (!existsSync(abs)) {
    console.warn(`⚠ skipping ${edit.path} (not found)`);
    continue;
  }
  const before = readFileSync(abs, "utf8");
  let after: string;
  try {
    after = edit.apply(before);
  } catch (err) {
    if (edit.path === "CHANGELOG.md") fail(`CHANGELOG.md: ${(err as Error).message}`);
    console.warn(`⚠ skipping ${edit.path}: ${(err as Error).message}`);
    continue;
  }
  if (after !== before) planned.push({ path: edit.path, before, after });
}

if (dryRun) {
  const dir = mkdtempSync(join(tmpdir(), "serikacord-release-"));
  try {
    for (const p of planned) {
      const a = join(dir, "a");
      const b = join(dir, "b");
      writeFileSync(a, p.before);
      writeFileSync(b, p.after);
      const r = spawnSync("diff", ["-u", "--label", `a/${p.path}`, "--label", `b/${p.path}`, a, b], { encoding: "utf8" });
      process.stdout.write(r.stdout || `(changed: ${p.path})\n`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  console.log(`\nWould update ${planned.length} file(s).${doCommit ? ` Would commit "release: ${tag}".` : ""}${doTag ? ` Would tag ${tag}.` : ""}`);
  process.exit(0);
}

for (const p of planned) {
  writeFileSync(join(ROOT, p.path), p.after);
  console.log(`✔ ${p.path}`);
}

if (doCommit) {
  const paths = planned.map((p) => p.path);
  const add = git("add", "--", ...paths);
  if (!add.ok) fail(`git add failed: ${add.out}`);
  const commit = git("commit", "-m", `release: ${tag}`);
  if (!commit.ok) fail(`git commit failed: ${commit.out}`);
  console.log(`\n✔ committed release: ${tag} (${git("rev-parse", "--short", "HEAD").out})`);
  if (doTag) {
    const t = git("tag", "-a", tag, "-m", `SerikaCord ${tag}`);
    if (!t.ok) fail(`git tag failed: ${t.out}`);
    console.log(`✔ tagged ${tag}`);
  }
}

console.log("\nNothing was pushed. Next:");
if (!doCommit) console.log(`  git add -A && git commit -m "release: ${tag}"`);
if (!doTag) console.log(`  git tag -a ${tag} -m "SerikaCord ${tag}"`);
console.log(`  git push && git push origin ${tag}   # the tag push runs the Release Build workflow`);

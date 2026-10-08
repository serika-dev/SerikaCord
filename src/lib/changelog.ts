// CHANGELOG.md structure, shared by the /changelog page and the release tooling
// (scripts/release.ts, scripts/changelog-add.ts — keep them in sync with this).
//
// The file is a list of `## ` sections: "## Unreleased" at the top, then
// "## vX.Y.Z — YYYY-MM-DD" releases, newest first. Each section groups bullets
// under `### <Category>` headings.

/** `bun run changelog <Kind> "..."` kinds → the heading they land under. */
export const CHANGELOG_CATEGORIES = {
  Added: "Features",
  Changed: "Changes",
  Fixed: "Bug Fixes",
  Performance: "Performance",
  Security: "Security",
  Removed: "Removed",
} as const;

export type ChangelogKind = keyof typeof CHANGELOG_CATEGORIES;

/** Headings a fresh Unreleased section starts with, in display order. */
export const CHANGELOG_HEADINGS: string[] = Object.values(CHANGELOG_CATEGORIES);

export interface ChangelogSection {
  /** Heading text without the leading "## ". */
  title: string;
  /** "1.2.7" for release sections, null for Unreleased and anything else. */
  version: string | null;
  /** "2026-07-21" when the heading carries a date. */
  date: string | null;
  unreleased: boolean;
  /** Markdown between this heading and the next `## ` (or the end). */
  body: string;
}

const RELEASE_HEADING = /^v?(\d+\.\d+\.\d+(?:-[\w.]+)?)\s*(?:[—–-]\s*(\d{4}-\d{2}-\d{2}))?/;

/** Split CHANGELOG.md into its `## ` sections (the preamble is dropped). */
export function parseChangelog(markdown: string): ChangelogSection[] {
  const sections: ChangelogSection[] = [];
  let current: ChangelogSection | null = null;
  let body: string[] = [];
  let inFence = false;

  const flush = () => {
    if (current) {
      current.body = body.join("\n").replace(/\n+---\s*$/, "").trim();
      sections.push(current);
    }
  };

  for (const line of markdown.replace(/\r\n/g, "\n").split("\n")) {
    if (line.startsWith("```")) inFence = !inFence;
    if (!inFence && line.startsWith("## ")) {
      flush();
      const title = line.slice(3).trim();
      const m = title.match(RELEASE_HEADING);
      current = {
        title,
        version: m ? m[1] : null,
        date: m?.[2] ?? null,
        unreleased: /^unreleased\b/i.test(title),
        body: "",
      };
      body = [];
      continue;
    }
    if (current) body.push(line);
  }
  flush();
  return sections;
}

/** Drop `###` headings that have nothing under them (e.g. a fresh Unreleased). */
export function stripEmptyHeadings(body: string): string {
  const lines = body.split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^#{3,6}\s/.test(lines[i])) {
      let j = i + 1;
      while (j < lines.length && lines[j].trim() === "") j++;
      if (j >= lines.length || /^#{2,6}\s/.test(lines[j]) || /^---\s*$/.test(lines[j])) {
        i = j - 1;
        continue;
      }
    }
    out.push(lines[i]);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

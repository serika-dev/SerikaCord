import type { ReactNode } from "react";
import Link from "next/link";
import { getGT } from "gt-next/server";
import { buildMetadata } from "@/lib/seo";
import { Logo } from "@/components/ui/Logo";
import { parseChangelog, stripEmptyHeadings, type ChangelogSection } from "@/lib/changelog";
import { APP_VERSION, BUILD_COMMIT_URL, BUILD_SHA } from "@/lib/version";
// Inlined into the build as a string (asset/source rule in next.config.ts), so
// the page always shows the notes of the build that serves it.
import changelogSource from "../../../CHANGELOG.md";

export const metadata = buildMetadata({
  title: "What's new",
  description: "Release notes for SerikaCord: new features, fixes and performance work in every version.",
  path: "/changelog",
  keywords: ["SerikaCord changelog", "SerikaCord release notes", "SerikaCord updates"],
});

/** How many tagged releases to show under Unreleased. */
const RELEASES_SHOWN = 5;

const GITHUB_RELEASES = "https://github.com/serika-dev/SerikaCord/releases";

// ─── Minimal markdown → JSX for CHANGELOG.md ────────────────────────────────
// Covers what the changelog uses: ###/#### headings, nested "-" lists,
// numbered lists, paragraphs, ---, **bold**, *italic*, `code` and links.
// Styled like chat markdown (MarkdownRenderer), which needs ServerContext and
// so can't be used here.

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)|(?<![\w*])\*([^*\s][^*]*)\*(?![\w*])|(?<!\w)_([^_\s][^_]*)_(?!\w))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const key = `${keyPrefix}-${i++}`;
    if (m[2] !== undefined) {
      out.push(<strong key={key} className="font-semibold text-[var(--text-primary)]">{renderInline(m[2], key)}</strong>);
    } else if (m[3] !== undefined) {
      out.push(
        <code key={key} className="px-1 py-0.5 rounded bg-[var(--app-surface-alt)] text-[var(--text-primary)] text-[0.85em] font-mono">
          {m[3]}
        </code>,
      );
    } else if (m[4] !== undefined) {
      const href = m[5];
      const safe = /^(https?:\/\/|\/(?!\/)|#)/.test(href);
      out.push(
        safe ? (
          <a key={key} href={href} target={href.startsWith("http") ? "_blank" : undefined} rel="noopener noreferrer" className="text-[var(--app-accent)] hover:underline break-words">
            {renderInline(m[4], key)}
          </a>
        ) : (
          m[4]
        ),
      );
    } else {
      out.push(<em key={key}>{m[6] ?? m[7]}</em>);
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

interface ListItem {
  text: string;
  children: ListItem[];
}

function renderList(items: ListItem[], ordered: boolean, key: string): ReactNode {
  const Tag = ordered ? "ol" : "ul";
  return (
    <Tag key={key} className={`${ordered ? "list-decimal" : "list-disc"} pl-5 space-y-1.5 marker:text-[var(--text-muted)]`}>
      {items.map((item, i) => (
        <li key={i} className="pl-1">
          {renderInline(item.text, `${key}-${i}`)}
          {item.children.length > 0 && <div className="mt-1.5">{renderList(item.children, false, `${key}-${i}-c`)}</div>}
        </li>
      ))}
    </Tag>
  );
}

function renderMarkdown(body: string, keyPrefix: string): ReactNode[] {
  const lines = body.split("\n");
  const blocks: ReactNode[] = [];
  let paragraph: string[] = [];
  let k = 0;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    const key = `${keyPrefix}-p${k++}`;
    blocks.push(<p key={key} className="leading-relaxed">{renderInline(paragraph.join(" "), key)}</p>);
    paragraph = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed === "") {
      flushParagraph();
      continue;
    }
    if (/^-{3,}$/.test(trimmed)) {
      flushParagraph();
      blocks.push(<hr key={`${keyPrefix}-hr${k++}`} className="border-[var(--border-subtle)]" />);
      continue;
    }
    const heading = trimmed.match(/^(#{3,6})\s+(.*)$/);
    if (heading) {
      flushParagraph();
      const key = `${keyPrefix}-h${k++}`;
      blocks.push(
        heading[1].length === 3 ? (
          <h3 key={key} className="pt-2 text-xs font-bold uppercase tracking-wide text-[var(--text-secondary)]">
            {renderInline(heading[2], key)}
          </h3>
        ) : (
          <h4 key={key} className="pt-1 text-sm font-semibold text-[var(--text-primary)]">
            {renderInline(heading[2], key)}
          </h4>
        ),
      );
      continue;
    }

    // Lists: collect consecutive list lines (and their wrapped continuations).
    const listStart = line.match(/^(\s*)([-*]|\d+\.)\s+(.*)$/);
    if (listStart) {
      flushParagraph();
      const ordered = /\d/.test(listStart[2]);
      const root: ListItem[] = [];
      const stack: { indent: number; items: ListItem[] }[] = [{ indent: listStart[1].length, items: root }];
      let lastItem: ListItem | null = null;
      for (; i < lines.length; i++) {
        const l = lines[i];
        const m = l.match(/^(\s*)([-*]|\d+\.)\s+(.*)$/);
        if (m) {
          const indent = m[1].length;
          while (stack.length > 1 && indent < stack[stack.length - 1].indent) stack.pop();
          if (indent > stack[stack.length - 1].indent && lastItem) {
            stack.push({ indent, items: lastItem.children });
          }
          lastItem = { text: m[3], children: [] };
          stack[stack.length - 1].items.push(lastItem);
        } else if (l.trim() !== "" && /^\s+/.test(l) && lastItem) {
          lastItem.text += ` ${l.trim()}`;
        } else {
          i--;
          break;
        }
      }
      blocks.push(renderList(root, ordered, `${keyPrefix}-l${k++}`));
      continue;
    }

    paragraph.push(trimmed);
  }
  flushParagraph();
  return blocks;
}

function sectionId(section: ChangelogSection): string {
  return section.version ? `v${section.version}` : section.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export default async function ChangelogPage() {
  const gt = await getGT();

  const sections = parseChangelog(changelogSource);
  const unreleased = sections.find((s) => s.unreleased && s.title.trim().toLowerCase() === "unreleased");
  const releases = sections.filter((s) => s.version).slice(0, RELEASES_SHOWN);
  const unreleasedBody = unreleased ? stripEmptyHeadings(unreleased.body) : "";

  const shown: { section: ChangelogSection; body: string }[] = [
    ...(unreleasedBody ? [{ section: unreleased!, body: unreleasedBody }] : []),
    ...releases.map((section) => ({ section, body: stripEmptyHeadings(section.body) })),
  ];

  return (
    <div className="min-h-screen bg-[var(--bg-app)] text-[var(--text-secondary)]">
      <nav className="sticky top-0 z-50 bg-[var(--bg-app)]/80 backdrop-blur-xl border-b border-[var(--border-subtle)]">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <Link href="/">
            <Logo size="sm" />
          </Link>
          <Link href="/channels/me" className="text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">
            {gt("Open SerikaCord")} →
          </Link>
        </div>
      </nav>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 pt-10 pb-20">
        <p className="text-sm font-medium text-[var(--app-accent)] mb-2">{gt("Changelog")}</p>
        <h1 className="text-3xl sm:text-4xl font-bold text-[var(--text-primary)] mb-2">{gt("What's new")}</h1>
        <p className="text-sm text-[var(--text-muted)]">
          {gt("You're on SerikaCord v{version}", { version: APP_VERSION })}{" "}
          {BUILD_COMMIT_URL ? (
            <a href={BUILD_COMMIT_URL} target="_blank" rel="noopener noreferrer" className="font-mono hover:underline">
              ({BUILD_SHA})
            </a>
          ) : (
            <span className="font-mono">({BUILD_SHA})</span>
          )}
        </p>

        {shown.length > 1 && (
          <div className="mt-6 flex flex-wrap gap-2">
            {shown.map(({ section }) => (
              <a
                key={sectionId(section)}
                href={`#${sectionId(section)}`}
                className="px-2.5 py-1 rounded-full text-xs font-medium border border-[var(--border-subtle)] bg-[var(--bg-card)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors"
              >
                {section.version ? `v${section.version}` : gt("Unreleased")}
              </a>
            ))}
          </div>
        )}

        <div className="mt-8 space-y-6">
          {shown.length === 0 && <p>{gt("No release notes yet.")}</p>}
          {shown.map(({ section, body }) => {
            const id = sectionId(section);
            return (
              <section
                key={id}
                id={id}
                className="scroll-mt-20 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4 sm:p-6"
              >
                <header className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <h2 className="text-xl font-bold text-[var(--text-primary)]">
                    {section.version ? `v${section.version}` : gt("Unreleased")}
                  </h2>
                  {section.date && <span className="text-sm text-[var(--text-muted)]">{section.date}</span>}
                  {section.version === APP_VERSION && (
                    <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[var(--app-accent)] text-[var(--text-on-accent)]">
                      {gt("Current")}
                    </span>
                  )}
                  {section.unreleased && (
                    <span className="text-xs text-[var(--text-muted)]">{gt("Not in a tagged release yet")}</span>
                  )}
                </header>
                <div className="space-y-3 text-sm break-words">{renderMarkdown(body, id)}</div>
              </section>
            );
          })}
        </div>

        <p className="mt-10 text-sm text-[var(--text-muted)]">
          {gt("Older releases and downloads are on")}{" "}
          <a href={GITHUB_RELEASES} target="_blank" rel="noopener noreferrer" className="text-[var(--app-accent)] hover:underline">
            GitHub
          </a>
          .
        </p>
      </main>
    </div>
  );
}

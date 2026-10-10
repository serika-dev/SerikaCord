"use client";

import { Fragment, memo, useMemo, useState, useEffect, useCallback } from "react";
import { parseMarkdown, type MarkdownNode, type ParsedMarkdown } from "@/lib/chat/markdown";
import { cn } from "@/lib/utils";
import { Check, Copy, Hash } from "lucide-react";
import { useChatGt } from "./ChatGtContext";
import { useServer } from "@/contexts/ServerContext";
import { useRouter } from "next/navigation";
import { useGT } from "gt-next";

type GTFunc = (str: string, params?: Record<string, unknown>) => string;

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

function formatRelativeTime(targetMs: number, gt: GTFunc): string {
  const diffMs = targetMs - Date.now();
  const diffSecs = Math.round(diffMs / 1000);
  const absSecs = Math.abs(diffSecs);

  if (absSecs < 60) {
    return diffSecs >= 0 ? gt("in a few seconds") : gt("a few seconds ago");
  }

  const diffMins = Math.round(diffSecs / 60);
  const absMins = Math.abs(diffMins);
  if (absMins < 60) {
    return diffSecs >= 0 ? gt("in {n} minutes", { n: absMins }) : gt("{n} minutes ago", { n: absMins });
  }

  const diffHours = Math.round(diffMins / 60);
  const absHours = Math.abs(diffHours);
  if (absHours < 24) {
    return diffSecs >= 0 ? gt("in {n} hours", { n: absHours }) : gt("{n} hours ago", { n: absHours });
  }

  const diffDays = Math.round(diffHours / 24);
  const absDays = Math.abs(diffDays);
  if (absDays < 30) {
    return diffSecs >= 0 ? gt("in {n} days", { n: absDays }) : gt("{n} days ago", { n: absDays });
  }

  const diffMonths = Math.round(diffDays / 30);
  const absMonths = Math.abs(diffMonths);
  if (absMonths < 12) {
    return diffSecs >= 0 ? gt("in {n} months", { n: absMonths }) : gt("{n} months ago", { n: absMonths });
  }

  const diffYears = Math.round(diffMonths / 12);
  const absYears = Math.abs(diffYears);
  return diffSecs >= 0 ? gt("in {n} years", { n: absYears }) : gt("{n} years ago", { n: absYears });
}

function formatCountdown(targetMs: number, gt: GTFunc): string {
  const diffMs = targetMs - Date.now();
  if (diffMs <= 0) {
    return gt("00:00:00 (Passed)");
  }

  const totalSecs = Math.floor(diffMs / 1000);
  const secs = totalSecs % 60;
  const totalMins = Math.floor(totalSecs / 60);
  const mins = totalMins % 60;
  const totalHours = Math.floor(totalMins / 60);
  const hours = totalHours % 24;
  const totalDays = Math.floor(totalHours / 24);

  const pad = (num: number) => String(num).padStart(2, "0");
  const timeStr = `${pad(hours)}:${pad(mins)}:${pad(secs)}`;

  if (totalDays > 0) {
    return `${totalDays}d ${timeStr}`;
  }
  return timeStr;
}

function parseTimestampOptions(optionsStr: string): { end?: string; color?: string } {
  const options: { end?: string; color?: string } = {};
  if (!optionsStr) return options;

  let str = optionsStr.replace(/\[|\]/g, " ");
  if (str.endsWith(":")) {
    str = str.slice(0, -1);
  }

  const hasKeys = /\b(end|color)\s*[:=]/i.test(str);

  if (hasKeys) {
    const endRegex = /\bend\s*[:=]\s*(.*?)(?=\s*\bcolor\s*[:=]|$)/i;
    const colorRegex = /\bcolor\s*[:=]\s*(.*?)(?=\s*\bend\s*[:=]|$)/i;

    const endMatch = str.match(endRegex);
    const colorMatch = str.match(colorRegex);

    if (endMatch) {
      options.end = endMatch[1].trim();
      options.end = options.end.replace(/[;,:]$/, "").trim();
    }
    if (colorMatch) {
      options.color = colorMatch[1].trim();
      options.color = options.color.replace(/[;,:]$/, "").trim();
    }
  } else {
    const parts = str.split(/[;,]/);
    if (parts.length > 0) {
      options.end = parts[0].trim();
    }
    if (parts.length > 1) {
      options.color = parts[1].trim();
    }
  }

  return options;
}

const DiscordTimestamp = memo(function DiscordTimestamp({
  timestamp,
  format,
  options
}: {
  timestamp: number;
  format?: string;
  options?: string;
}) {
  const gt = useGT();
  const parsedOptions = useMemo(() => parseTimestampOptions(options || ""), [options]);
  const endOption = parsedOptions.end;
  const colorOption = parsedOptions.color;

  // Memoize date to avoid creating a new object every render (which would
  // destabilise the useCallback / useEffect dependency chains and cause an
  // infinite re-render loop).
  const date = useMemo(() => new Date(timestamp * 1000), [timestamp]);
  const targetMs = timestamp * 1000;

  const tooltipText = useMemo(
    () =>
      date.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) +
      " " +
      date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }),
    [date]
  );

  // Compute display text. Dependencies are all primitives / stable refs so this
  // callback won't be recreated spuriously.
  const computeDisplayText = useCallback(() => {
    const d = new Date(targetMs);
    switch (format) {
      case "t":
        return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
      case "T":
        return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' });
      case "d":
        return d.toLocaleDateString(undefined, { year: 'numeric', month: 'numeric', day: 'numeric' });
      case "D":
        return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
      case "f":
        return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) + " " + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
      case "F":
        return d.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) + " " + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
      case "R":
        return formatRelativeTime(targetMs, gt);
      case "C": {
        const isPassed = Date.now() >= targetMs;
        return isPassed
          ? (endOption || gt("00:00:00 (Passed)"))
          : formatCountdown(targetMs, gt);
      }
      default:
        return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) + " " + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    }
  }, [targetMs, format, endOption, gt]);

  const [liveText, setLiveText] = useState(() => computeDisplayText());

  useEffect(() => {
    // Sync text when props change
    setLiveText(computeDisplayText());

    if (format === "R") {
      const interval = setInterval(() => {
        setLiveText(formatRelativeTime(targetMs, gt));
      }, 10_000);
      return () => clearInterval(interval);
    }

    if (format === "C") {
      const interval = setInterval(() => {
        const now = Date.now();
        if (now >= targetMs) {
          setLiveText(endOption || gt("00:00:00 (Passed)"));
          clearInterval(interval);
        } else {
          setLiveText(formatCountdown(targetMs, gt));
        }
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [targetMs, format, endOption, computeDisplayText, gt]);

  if (format === "C") {
    return (
      <h1
        title={tooltipText}
        className="text-3xl font-extrabold tracking-tight my-2 select-none block"
        style={{ color: colorOption || "var(--accent-color, #8B5CF6)" }}
      >
        {liveText}
      </h1>
    );
  }

  return (
    <span
      title={tooltipText}
      className="px-1.5 py-0.5 rounded bg-[var(--app-surface-alt)] hover:bg-[var(--app-border)] text-[var(--text-primary)] text-[0.9em] font-medium inline-block select-none cursor-pointer transition-colors duration-150 align-baseline"
    >
      {liveText}
    </span>
  );
});

const ChannelMention = memo(function ChannelMention({ channelId }: { channelId: string }) {
  const gt = useGT();
  const router = useRouter();
  const { channels, currentServer } = useServer();

  const channelName = useMemo(() => {
    const ch = channels.find((c) => c.id === channelId);
    return ch ? ch.name : null;
  }, [channelId, channels]);

  const handleClick = () => {
    if (currentServer) {
      router.push(`/channels/${currentServer.id}/${channelId}`);
    }
  };

  return (
    <span
      onClick={handleClick}
      className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-[var(--app-accent)]/15 hover:bg-[var(--app-accent)]/25 text-[var(--app-accent)] text-[0.9em] font-medium cursor-pointer transition-colors duration-150 align-baseline"
    >
      <Hash className="w-3.5 h-3.5 shrink-0" />
      {channelName || gt("unknown-channel")}
    </span>
  );
});

function Spoiler({ children }: { children: React.ReactNode }) {
  const [revealed, setRevealed] = useState(false);
  return (
    <span
      onClick={() => setRevealed(true)}
      className={cn(
        "rounded px-0.5 cursor-pointer transition-colors select-none",
        revealed ? "bg-[var(--app-surface-alt)] text-[var(--text-primary)]" : "bg-[var(--text-muted)] text-transparent"
      )}
    >
      {children}
    </span>
  );
}

const ANSI_FG_COLORS: Record<number, string> = {
  30: "#4f545c", 31: "#dc322f", 32: "#85c46c", 33: "#e5c100",
  34: "#58a6ff", 35: "#b00588", 36: "#00b3b3", 37: "#ffffff",
  90: "#4f545c", 91: "#ff6b6b", 92: "#5fff5f", 93: "#ffff5f",
  94: "#5f5fff", 95: "#ff5fff", 96: "#5fffff", 97: "#ffffff",
};

const ANSI_BG_COLORS: Record<number, string> = {
  40: "#4f545c", 41: "#dc322f", 42: "#85c46c", 43: "#e5c100",
  44: "#58a6ff", 45: "#b00588", 46: "#00b3b3", 47: "#ffffff",
  100: "#4f545c", 101: "#ff6b6b", 102: "#5fff5f", 103: "#ffff5f",
  104: "#5f5fff", 105: "#ff5fff", 106: "#5fffff", 107: "#ffffff",
};

interface AnsiStyle {
  bold: boolean;
  dim: boolean;
  italic: boolean;
  underline: boolean;
  strikethrough: boolean;
  fg: string | null;
  bg: string | null;
}

function parseAnsiToSpans(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  // Match ESC[...m sequences (real ANSI) or bare [...m (Discord-style without ESC).
  const re = /\x1b?\[([\d;]*)m/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  const style: AnsiStyle = {
    bold: false, dim: false, italic: false, underline: false,
    strikethrough: false, fg: null, bg: null,
  };
  let key = 0;

  const flush = (text: string) => {
    if (text.length === 0) return;
    const css: React.CSSProperties = {};
    if (style.fg) css.color = style.fg;
    if (style.bg) css.backgroundColor = style.bg;
    if (style.bold) css.fontWeight = "bold";
    if (style.dim) css.opacity = "0.5";
    if (style.italic) css.fontStyle = "italic";
    if (style.underline || style.strikethrough) {
      const decos: string[] = [];
      if (style.underline) decos.push("underline");
      if (style.strikethrough) decos.push("line-through");
      css.textDecoration = decos.join(" ");
    }
    const hasStyle = style.fg || style.bg || style.bold || style.dim ||
      style.italic || style.underline || style.strikethrough;
    if (hasStyle) {
      nodes.push(<span key={`a-${key++}`} style={css}>{text}</span>);
    } else {
      nodes.push(<span key={`a-${key++}`}>{text}</span>);
    }
  };

  while ((match = re.exec(text)) !== null) {
    // Flush text before the escape sequence
    if (match.index > lastIndex) {
      flush(text.slice(lastIndex, match.index));
    }
    // Parse the SGR parameters
    const params = match[1].split(";").map((s) => parseInt(s, 10));
    if (params.length === 0 || (params.length === 1 && params[0] === 0)) {
      // Reset
      style.bold = false; style.dim = false; style.italic = false;
      style.underline = false; style.strikethrough = false;
      style.fg = null; style.bg = null;
    } else {
      for (let i = 0; i < params.length; i++) {
        const code = params[i];
        if (code === 0) {
          style.bold = false; style.dim = false; style.italic = false;
          style.underline = false; style.strikethrough = false;
          style.fg = null; style.bg = null;
        } else if (code === 1) style.bold = true;
        else if (code === 2) style.dim = true;
        else if (code === 3) style.italic = true;
        else if (code === 4) style.underline = true;
        else if (code === 9) style.strikethrough = true;
        else if (code === 22) { style.bold = false; style.dim = false; }
        else if (code === 23) style.italic = false;
        else if (code === 24) style.underline = false;
        else if (code === 29) style.strikethrough = false;
        else if (code === 39) style.fg = null;
        else if (code === 49) style.bg = null;
        else if (ANSI_FG_COLORS[code]) style.fg = ANSI_FG_COLORS[code];
        else if (ANSI_BG_COLORS[code]) style.bg = ANSI_BG_COLORS[code];
        else if (code === 38) {
          // Extended foreground: 38;5;n (256) or 38;2;r;g;b (truecolor)
          if (params[i + 1] === 5 && params[i + 2] !== undefined) {
            style.fg = `var(--ansi-256-${params[i + 2]}, #ffffff)`;
            i += 2;
          } else if (params[i + 1] === 2 && params[i + 4] !== undefined) {
            style.fg = `rgb(${params[i + 2]}, ${params[i + 3]}, ${params[i + 4]})`;
            i += 4;
          }
        } else if (code === 48) {
          if (params[i + 1] === 5 && params[i + 2] !== undefined) {
            style.bg = `var(--ansi-256-${params[i + 2]}, #4f545c)`;
            i += 2;
          } else if (params[i + 1] === 2 && params[i + 4] !== undefined) {
            style.bg = `rgb(${params[i + 2]}, ${params[i + 3]}, ${params[i + 4]})`;
            i += 4;
          }
        }
      }
    }
    lastIndex = re.lastIndex;
  }

  // Flush remaining text
  if (lastIndex < text.length) {
    flush(text.slice(lastIndex));
  }

  return nodes;
}

const AnsiCodeblock = memo(function AnsiCodeblock({ code }: { code: string }) {
  const spans = useMemo(() => parseAnsiToSpans(code), [code]);
  return <>{spans}</>;
});

// ── Syntax highlighting (lazy) ──────────────────────────────────────────
// The highlighter is its own chunk, loaded the first time a fenced block with
// a language renders; afterwards it's used synchronously.
type HighlightModule = typeof import("@/lib/chat/highlight");
let highlightModule: HighlightModule | null = null;
let highlightLoad: Promise<HighlightModule> | null = null;
function loadHighlighter(): Promise<HighlightModule> {
  if (!highlightLoad) {
    highlightLoad = import("@/lib/chat/highlight").then((m) => {
      highlightModule = m;
      return m;
    });
  }
  return highlightLoad;
}

const CodeBlock = memo(function CodeBlock({ code, lang }: { code: string; lang: string }) {
  const gt = useChatGt();
  const isAnsi = lang === "ansi";
  const [mod, setMod] = useState<HighlightModule | null>(highlightModule);
  const [copiedAt, setCopiedAt] = useState(0);
  const wantsHighlight = Boolean(lang) && !isAnsi;
  useEffect(() => {
    if (mod || !wantsHighlight) return;
    let alive = true;
    void loadHighlighter()
      .then((m) => {
        if (alive) setMod(m);
      })
      .catch(() => { /* plain text it is */ });
    return () => {
      alive = false;
    };
  }, [mod, wantsHighlight]);
  const tokens = useMemo(
    () => (mod && wantsHighlight ? mod.highlightCode(code, lang) : null),
    [mod, wantsHighlight, code, lang],
  );
  useEffect(() => {
    if (!copiedAt) return;
    const t = setTimeout(() => setCopiedAt(0), 1500);
    return () => clearTimeout(t);
  }, [copiedAt]);

  const copy = (e: React.MouseEvent) => {
    e.stopPropagation();
    void navigator.clipboard
      ?.writeText(code)
      .then(() => setCopiedAt(Date.now()))
      .catch(() => {});
  };
  const copied = copiedAt > 0;

  return (
    <span className="md-codeblock group/code relative my-1 block max-w-full overflow-hidden rounded-md border border-[var(--app-border)] bg-[var(--app-surface-alt)]">
      <button
        type="button"
        onClick={copy}
        className="absolute right-1.5 top-1.5 z-[1] flex items-center gap-1 rounded bg-[var(--app-surface)] px-1.5 py-1 text-[11px] text-[var(--text-muted)] opacity-0 shadow-sm transition-opacity hover:text-[var(--text-primary)] focus-visible:opacity-100 group-hover/code:opacity-100"
        title={gt("Copy")}
        aria-label={gt("Copy")}
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        {copied ? gt("Copied") : gt("Copy")}
      </button>
      <pre className="m-0 overflow-x-auto p-2 pr-16">
        <code className="block whitespace-pre-wrap break-words font-mono text-[0.875em] leading-[1.125rem] text-[var(--text-primary)]">
          {isAnsi ? (
            <AnsiCodeblock code={code} />
          ) : tokens ? (
            tokens.map((t, i) =>
              t.kind ? (
                <span key={i} className={`hl-${t.kind}`}>
                  {t.text}
                </span>
              ) : (
                <Fragment key={i}>{t.text}</Fragment>
              ),
            )
          ) : (
            code
          )}
        </code>
      </pre>
    </span>
  );
});

/** Renders a text (or bare URL) leaf; MessageContent swaps in mentions / emoji. */
export type MarkdownTextRenderer = (node: MarkdownNode, key: string) => React.ReactNode;

function defaultRenderText(node: MarkdownNode, key: string): React.ReactNode {
  if (node.type === "url") {
    return (
      <a key={key} href={node.href} target="_blank" rel="noopener noreferrer" className="text-[var(--app-accent)] hover:underline break-all">
        {node.content}
      </a>
    );
  }
  return <Fragment key={key}>{node.content}</Fragment>;
}

function renderInlineNodes(nodes: MarkdownNode[], keyPrefix: string, renderText: MarkdownTextRenderer): React.ReactNode[] {
  return nodes.map((node, i) => {
    const key = `${keyPrefix}-${i}`;
    const kids = () => (node.children ? renderInlineNodes(node.children, key, renderText) : null);
    switch (node.type) {
      case "bold":
        return <strong key={key} className="font-bold">{kids()}</strong>;
      case "italic":
        return <em key={key}>{kids()}</em>;
      case "underline":
        return <u key={key}>{kids()}</u>;
      case "strikethrough":
        return <s key={key}>{kids()}</s>;
      case "spoiler":
        return <Spoiler key={key}>{kids()}</Spoiler>;
      case "code":
        return (
          <code key={key} className="md-inline-code rounded px-1 py-0.5 font-mono text-[0.85em] bg-[var(--app-surface-alt)] border border-[var(--app-border)]">
            {node.content}
          </code>
        );
      case "link":
        return (
          <a key={key} href={node.href} title={node.href} target="_blank" rel="noopener noreferrer" className="text-[var(--app-accent)] hover:underline break-words">
            {node.content}
          </a>
        );
      case "linebreak":
        return <br key={key} />;
      case "timestamp":
        return <DiscordTimestamp key={key} timestamp={parseInt(node.content)} format={node.format} options={node.options} />;
      case "channel_mention":
        return <ChannelMention key={key} channelId={node.content} />;
      default:
        return renderText(node, key);
    }
  });
}

function renderBlock(block: ParsedMarkdown, key: string, renderText: MarkdownTextRenderer, inline: boolean): React.ReactNode {
  const inl = () => (block.inline ? renderInlineNodes(block.inline, key, renderText) : null);
  if (inline) {
    // Reply previews: one line, no block layout.
    switch (block.type) {
      case "codeblock":
        return (
          <code key={key} className="md-inline-code rounded px-1 font-mono text-[0.85em] bg-[var(--app-surface-alt)]">
            {block.code}
          </code>
        );
      case "blockquote":
        return <Fragment key={key}>{(block.children ?? []).map((c, i) => renderBlock(c, `${key}-${i}`, renderText, true))}</Fragment>;
      case "list":
        return (
          <Fragment key={key}>
            {(block.items ?? []).map((item, i) => (
              <Fragment key={i}>
                {i > 0 ? " " : ""}
                {renderInlineNodes(item.inline, `${key}-${i}`, renderText)}
              </Fragment>
            ))}{" "}
          </Fragment>
        );
      default:
        return <Fragment key={key}>{inl()} </Fragment>;
    }
  }
  switch (block.type) {
    case "codeblock":
      return <CodeBlock key={key} code={block.code || ""} lang={block.lang || ""} />;
    case "heading":
      return (
        <span
          key={key}
          className={cn(
            "md-heading block font-bold leading-[1.375] text-[var(--text-primary)] mt-2 first:mt-0 mb-0.5",
            block.level === 1 && "text-[1.5em]",
            block.level === 2 && "text-[1.25em]",
            block.level === 3 && "text-[1em]"
          )}
        >
          {inl()}
        </span>
      );
    case "small":
      return (
        <span key={key} className="md-subtext block text-[0.8125em] leading-[1.11rem] text-[var(--text-muted)]">
          {inl()}
        </span>
      );
    case "blockquote":
      return (
        <span key={key} className="md-quote my-0.5 flex max-w-full">
          <span aria-hidden="true" className="w-1 shrink-0 rounded bg-[var(--app-muted-2)] opacity-70" />
          <blockquote className="min-w-0 flex-1 pl-3 pr-2">
            {(block.children ?? []).map((c, i) => renderBlock(c, `${key}-${i}`, renderText, false))}
          </blockquote>
        </span>
      );
    case "list": {
      const items = (block.items ?? []).map((item, i) => (
        <li key={i} className="md-list-item my-0.5 pl-0.5 whitespace-pre-wrap break-words">
          {renderInlineNodes(item.inline, `${key}-${i}`, renderText)}
          {item.children.map((c, j) => renderBlock(c, `${key}-${i}-${j}`, renderText, false))}
        </li>
      ));
      return block.ordered ? (
        <ol key={key} start={block.start} className="md-list my-1 ml-4 list-decimal pl-3 marker:text-[var(--text-muted)]">
          {items}
        </ol>
      ) : (
        <ul key={key} className="md-list my-1 ml-4 list-disc pl-3 marker:text-[var(--text-muted)] [&_ul]:list-[circle] [&_ul_ul]:list-[square]">
          {items}
        </ul>
      );
    }
    default:
      return <Fragment key={key}>{inl()}</Fragment>;
  }
}

interface MarkdownDocumentProps {
  blocks: ParsedMarkdown[];
  /** Text / bare-URL leaves (MessageContent: mentions, emoji, link previews). */
  renderText?: MarkdownTextRenderer;
  /** Single-line rendering (reply previews). */
  inline?: boolean;
}

/** Renders parsed blocks. Callers wrap it in a `whitespace-pre-wrap` container. */
export function MarkdownDocument({ blocks, renderText = defaultRenderText, inline = false }: MarkdownDocumentProps) {
  return <>{blocks.map((block, i) => renderBlock(block, `md-${i}`, renderText, inline))}</>;
}

export const MarkdownRenderer = memo(function MarkdownRenderer({ content, className }: MarkdownRendererProps) {
  const blocks = useMemo(() => parseMarkdown(content), [content]);
  return (
    <span className={cn("whitespace-pre-wrap break-words", className)}>
      <MarkdownDocument blocks={blocks} />
    </span>
  );
});

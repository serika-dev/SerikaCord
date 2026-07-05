"use client";

import { memo, useMemo, useState, useEffect } from "react";
import { parseMarkdown, type MarkdownNode } from "@/lib/chat/markdown";
import { cn } from "@/lib/utils";

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

function formatRelativeTime(targetMs: number): string {
  const diffMs = targetMs - Date.now();
  const diffSecs = Math.round(diffMs / 1000);
  const absSecs = Math.abs(diffSecs);

  if (absSecs < 60) {
    return diffSecs >= 0 ? "in a few seconds" : "a few seconds ago";
  }

  const diffMins = Math.round(diffSecs / 60);
  const absMins = Math.abs(diffMins);
  if (absMins < 60) {
    return diffSecs >= 0 ? `in ${absMins} minute${absMins === 1 ? "" : "s"}` : `${absMins} minute${absMins === 1 ? "" : "s"} ago`;
  }

  const diffHours = Math.round(diffMins / 60);
  const absHours = Math.abs(diffHours);
  if (absHours < 24) {
    return diffSecs >= 0 ? `in ${absHours} hour${absHours === 1 ? "" : "s"}` : `${absHours} hour${absHours === 1 ? "" : "s"} ago`;
  }

  const diffDays = Math.round(diffHours / 24);
  const absDays = Math.abs(diffDays);
  if (absDays < 30) {
    return diffSecs >= 0 ? `in ${absDays} day${absDays === 1 ? "" : "s"}` : `${absDays} day${absDays === 1 ? "" : "s"} ago`;
  }

  const diffMonths = Math.round(diffDays / 30);
  const absMonths = Math.abs(diffMonths);
  if (absMonths < 12) {
    return diffSecs >= 0 ? `in ${absMonths} month${absMonths === 1 ? "" : "s"}` : `${absMonths} month${absMonths === 1 ? "" : "s"} ago`;
  }

  const diffYears = Math.round(diffMonths / 12);
  const absYears = Math.abs(diffYears);
  return diffSecs >= 0 ? `in ${absYears} year${absYears === 1 ? "" : "s"}` : `${absYears} year${absYears === 1 ? "" : "s"} ago`;
}

function formatCountdown(targetMs: number): string {
  const diffMs = targetMs - Date.now();
  if (diffMs <= 0) {
    return "00:00:00 (Passed)";
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

  let str = optionsStr;
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
  const [mounted, setMounted] = useState(false);
  const [relativeText, setRelativeText] = useState("");
  const [countdownText, setCountdownText] = useState("");

  const parsedOptions = useMemo(() => parseTimestampOptions(options || ""), [options]);

  useEffect(() => {
    setMounted(true);
    if (format === "R") {
      setRelativeText(formatRelativeTime(timestamp * 1000));
      const interval = setInterval(() => {
        setRelativeText(formatRelativeTime(timestamp * 1000));
      }, 10000);
      return () => clearInterval(interval);
    } else if (format === "C") {
      const targetMs = timestamp * 1000;
      setCountdownText(formatCountdown(targetMs));
      const interval = setInterval(() => {
        const now = Date.now();
        setCountdownText(formatCountdown(targetMs));
        if (now >= targetMs) {
          clearInterval(interval);
        }
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [timestamp, format]);

  const date = new Date(timestamp * 1000);
  const initialText = date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) + " " + date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

  if (!mounted) {
    if (format === "C") {
      const isPassed = Date.now() >= timestamp * 1000;
      const endText = parsedOptions.end || "00:00:00 (Passed)";
      const currentText = isPassed ? endText : "00:00:00";
      return (
        <h1
          className="text-3xl font-extrabold tracking-tight my-2 select-none block"
          style={{ color: parsedOptions.color || "var(--accent-color, #8B5CF6)" }}
        >
          {currentText}
        </h1>
      );
    }
    return (
      <span className="px-1.5 py-0.5 rounded bg-[var(--app-surface-alt)] text-[var(--text-primary)] text-[0.9em] font-medium inline-block select-none align-baseline">
        {initialText}
      </span>
    );
  }

  const tooltipText = date.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) + " " + date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

  let displayText = "";
  switch (format) {
    case "t":
      displayText = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
      break;
    case "T":
      displayText = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' });
      break;
    case "d":
      displayText = date.toLocaleDateString(undefined, { year: 'numeric', month: 'numeric', day: 'numeric' });
      break;
    case "D":
      displayText = date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
      break;
    case "f":
      displayText = date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) + " " + date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
      break;
    case "F":
      displayText = date.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) + " " + date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
      break;
    case "R":
      displayText = relativeText || formatRelativeTime(timestamp * 1000);
      break;
    case "C":
      const isPassed = Date.now() >= timestamp * 1000;
      displayText = isPassed
        ? (parsedOptions.end || "00:00:00 (Passed)")
        : (countdownText || formatCountdown(timestamp * 1000));
      break;
    default:
      displayText = date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) + " " + date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }

  if (format === "C") {
    return (
      <h1
        title={tooltipText}
        className="text-3xl font-extrabold tracking-tight my-2 select-none block"
        style={{ color: parsedOptions.color || "var(--accent-color, #8B5CF6)" }}
      >
        {displayText}
      </h1>
    );
  }

  return (
    <span
      title={tooltipText}
      className="px-1.5 py-0.5 rounded bg-[var(--app-surface-alt)] hover:bg-[var(--app-border)] text-[var(--text-primary)] text-[0.9em] font-medium inline-block select-none cursor-pointer transition-colors duration-150 align-baseline"
    >
      {displayText}
    </span>
  );
});

function renderInlineNodes(nodes: MarkdownNode[], keyPrefix: string): React.ReactNode[] {
  return nodes.map((node, i) => {
    const key = `${keyPrefix}-${i}`;
    switch (node.type) {
      case "bold":
        return <strong key={key} className="font-bold">{node.children && renderInlineNodes(node.children, key)}</strong>;
      case "italic":
        return <em key={key}>{node.children && renderInlineNodes(node.children, key)}</em>;
      case "underline":
        return <u key={key}>{node.children && renderInlineNodes(node.children, key)}</u>;
      case "strikethrough":
        return <s key={key}>{node.children && renderInlineNodes(node.children, key)}</s>;
      case "code":
        return (
          <code key={key} className="px-1 py-0.5 rounded bg-[var(--app-surface-alt)] text-[#e2b714] text-[0.85em] font-mono">
            {node.content}
          </code>
        );
      case "link":
        return (
          <a key={key} href={node.href} target="_blank" rel="noopener noreferrer" className="text-[var(--app-accent)] hover:underline break-all">
            {node.content}
          </a>
        );
      case "linebreak":
        return <br key={key} />;
      case "timestamp":
        return <DiscordTimestamp key={key} timestamp={parseInt(node.content)} format={node.format} options={node.options} />;
      default:
        // Handle multi-line text by splitting on \n
        const text = node.content;
        if (text.includes("\n")) {
          const parts = text.split("\n");
          return parts.map((part, j) => (
            <span key={`${key}-${j}`}>
              {j > 0 && <br />}
              {part}
            </span>
          ));
        }
        return <span key={key}>{text}</span>;
    }
  });
}

export const MarkdownRenderer = memo(function MarkdownRenderer({ content, className }: MarkdownRendererProps) {
  const blocks = useMemo(() => parseMarkdown(content), [content]);

  return (
    <span className={cn("inline", className)}>
      {blocks.map((block, i) => {
        const key = `md-block-${i}`;
        switch (block.type) {
          case "codeblock":
            return (
              <pre key={key} className="my-1 p-3 rounded-md bg-[var(--app-surface-alt)] border border-[var(--app-border)] overflow-x-auto">
                <code className="text-[0.85em] font-mono text-[var(--text-primary)]">{block.code}</code>
              </pre>
            );
          case "heading":
            return (
              <span
                key={key}
                className={cn(
                  "font-bold block",
                  block.level === 1 && "text-lg",
                  block.level === 2 && "text-base",
                  block.level === 3 && "text-sm"
                )}
              >
                {block.inline && renderInlineNodes(block.inline, key)}
              </span>
            );
          default:
            return (
              <span key={key} className="inline">
                {block.inline && renderInlineNodes(block.inline, key)}
              </span>
            );
        }
      })}
    </span>
  );
});

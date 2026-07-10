"use client";

import { memo, useMemo, useState, useEffect, useCallback } from "react";
import { parseMarkdown, type MarkdownNode } from "@/lib/chat/markdown";
import { cn } from "@/lib/utils";
import { Hash } from "lucide-react";
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
      case "spoiler":
        return <Spoiler key={key}>{node.children && renderInlineNodes(node.children, key)}</Spoiler>;
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
      case "channel_mention":
        return <ChannelMention key={key} channelId={node.content} />;
      default:
        return <span key={key}>{node.content}</span>;
    }
  });
}

export const MarkdownRenderer = memo(function MarkdownRenderer({ content, className }: MarkdownRendererProps) {
  const blocks = useMemo(() => parseMarkdown(content), [content]);

  return (
    <span className={cn("whitespace-pre-wrap break-words", className)}>
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
          case "blockquote":
            return (
              <blockquote
                key={key}
                className="border-l-4 border-[var(--app-accent)] pl-3 my-1 italic text-[var(--text-muted)] block"
              >
                {block.inline && renderInlineNodes(block.inline, key)}
              </blockquote>
            );
          case "small":
            return (
              <span
                key={key}
                className="text-[0.7em] text-[var(--text-muted)] block"
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

"use client";

import { useRef, useState } from "react";
import { Bold, Code, Eye, EyeOff, Italic, Strikethrough, Underline } from "lucide-react";
import { useGT } from "gt-next";
import { MarkdownRenderer } from "@/components/chat/MarkdownRenderer";
import { cn } from "@/lib/utils";

/**
 * Channel topic / forum post guidelines editor: a markdown textarea with a
 * formatting toolbar, a rendered preview toggle and a character counter
 * (Discord's Post Guidelines box).
 */
export function MarkdownField({
  value,
  onChange,
  maxLength,
  placeholder,
  ariaLabel,
  rows = 4,
  disabled,
  invalid,
}: {
  value: string;
  onChange: (value: string) => void;
  maxLength: number;
  placeholder?: string;
  ariaLabel: string;
  rows?: number;
  disabled?: boolean;
  invalid?: boolean;
}) {
  const gt = useGT();
  const ref = useRef<HTMLTextAreaElement>(null);
  const [preview, setPreview] = useState(false);

  // Wraps the selection (or inserts an empty pair at the caret) and keeps it selected.
  const wrap = (marker: string) => {
    const el = ref.current;
    if (!el || disabled) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const next = value.slice(0, start) + marker + value.slice(start, end) + marker + value.slice(end);
    if (next.length > maxLength) return;
    onChange(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + marker.length, end + marker.length);
    });
  };

  const tools = [
    { marker: "**", label: gt("Bold"), icon: Bold },
    { marker: "*", label: gt("Italic"), icon: Italic },
    { marker: "__", label: gt("Underline"), icon: Underline },
    { marker: "~~", label: gt("Strikethrough"), icon: Strikethrough },
    { marker: "`", label: gt("Code"), icon: Code },
  ];
  const remaining = maxLength - value.length;

  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg border bg-[var(--bg-input)] transition-[border-color,box-shadow] duration-(--motion-fast)",
        "focus-within:border-[color-mix(in_srgb,var(--app-accent)_60%,transparent)] focus-within:ring-2 focus-within:ring-[var(--app-accent)]/25",
        invalid ? "border-red-500" : "border-[var(--border-subtle)]",
        disabled && "opacity-60",
      )}
    >
      <div className="flex items-center gap-0.5 border-b border-[var(--border-subtle)] bg-[var(--bg-hover)]/40 px-1.5 py-1">
        {tools.map((tool) => (
          <button
            key={tool.marker}
            type="button"
            onClick={() => wrap(tool.marker)}
            disabled={disabled || preview}
            title={tool.label}
            aria-label={tool.label}
            className="flex h-7 w-7 items-center justify-center rounded text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:opacity-40 max-md:h-9 max-md:w-9"
          >
            <tool.icon className="h-3.5 w-3.5" />
          </button>
        ))}
        <span aria-hidden className="mx-1 h-4 w-px bg-[var(--border-subtle)]" />
        <button
          type="button"
          onClick={() => setPreview((p) => !p)}
          aria-pressed={preview}
          title={gt("Toggle Preview")}
          aria-label={gt("Toggle Preview")}
          className={cn(
            "flex h-7 items-center gap-1.5 rounded px-2 text-xs font-medium transition-colors max-md:h-9",
            preview
              ? "bg-[color-mix(in_srgb,var(--app-accent)_15%,transparent)] text-[var(--app-accent)]"
              : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]",
          )}
        >
          {preview ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          {gt("Preview")}
        </button>
      </div>
      <div className="relative">
        {preview ? (
          <div className="min-h-[96px] px-3 py-2.5 pb-6 text-sm leading-relaxed text-[var(--text-primary)]">
            {value.trim() ? (
              <MarkdownRenderer content={value} />
            ) : (
              <span className="italic text-[var(--text-muted)]">{gt("Nothing to preview yet.")}</span>
            )}
          </div>
        ) : (
          <textarea
            ref={ref}
            value={value}
            onChange={(e) => onChange(e.target.value.slice(0, maxLength))}
            maxLength={maxLength}
            rows={rows}
            disabled={disabled}
            placeholder={placeholder}
            aria-label={ariaLabel}
            aria-invalid={invalid || undefined}
            className="block w-full resize-y bg-transparent px-3 py-2.5 pb-6 text-sm leading-relaxed text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] disabled:cursor-not-allowed max-md:text-base"
          />
        )}
        <span
          aria-live="polite"
          className={cn(
            "pointer-events-none absolute bottom-1.5 right-2.5 text-[11px] font-semibold tabular-nums",
            remaining <= 50 ? "text-red-500" : "text-[var(--text-muted)]",
          )}
        >
          {value.length}/{maxLength}
        </span>
      </div>
    </div>
  );
}

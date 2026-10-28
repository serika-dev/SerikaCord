"use client";

import { Fragment, useEffect, useRef } from "react";
import { useGT } from "gt-next";
import { Bot, Sparkles } from "lucide-react";
import { cdnImage, cn } from "@/lib/utils";
import type { CommandGroup, CommandSpec, RankedCommand } from "@/lib/chat/commandComposer";
import { BUILTIN_COMMAND_ICONS, optionKindLabel } from "@/components/chat/commands/commandLabels";

/** Command name with the matched letters emphasised. */
function Highlighted({ text, match }: { text: string; match: number[] }) {
  if (match.length === 0) return <>{text}</>;
  const set = new Set(match);
  return (
    <>
      {Array.from(text).map((ch, i) =>
        set.has(i) ? (
          <span key={i} className="font-semibold text-[var(--text-primary)]">{ch}</span>
        ) : (
          <Fragment key={i}>{ch}</Fragment>
        ),
      )}
    </>
  );
}

export function CommandIcon({ spec, className }: { spec: CommandSpec; className?: string }) {
  return (
    <span
      className={cn(
        "flex items-center justify-center shrink-0 rounded-md overflow-hidden bg-[color-mix(in_srgb,var(--app-accent)_15%,transparent)] text-[var(--app-accent)]",
        className,
      )}
      aria-hidden="true"
    >
      {spec.source === "app" ? (
        spec.app?.icon ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={cdnImage(spec.app.icon)} alt="" className="w-full h-full object-cover" loading="lazy" />
        ) : (
          <Bot className="w-4 h-4" />
        )
      ) : (
        BUILTIN_COMMAND_ICONS[spec.name] ?? <Sparkles className="w-4 h-4" />
      )}
    </span>
  );
}

interface CommandPaletteProps {
  groups: CommandGroup[];
  rows: RankedCommand[];
  activeKey: string | null;
  onPick: (spec: CommandSpec) => void;
  onActivate: (key: string) => void;
  listId: string;
}

/**
 * The `/` command list above the composer: grouped by app (with its icon) and
 * one built-in group, fuzzy matches highlighted, and a preview of the
 * highlighted command's options. Keyboard handling lives in MessageBar (the
 * caret stays in the composer); the mouse only highlights on real movement
 * so the list never jumps under a resting pointer while typing.
 */
export function CommandPalette({ groups, rows, activeKey, onPick, onActivate, listId }: CommandPaletteProps) {
  const gt = useGT();
  const listRef = useRef<HTMLDivElement>(null);
  const active = rows.find((r) => r.spec.key === activeKey)?.spec ?? rows[0]?.spec ?? null;

  // Keep the highlighted row visible (DOM only, no state).
  useEffect(() => {
    if (!activeKey) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-command-key="${CSS.escape(activeKey)}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [activeKey]);

  return (
    <div
      className="theme-solid absolute left-1 right-1 sm:left-2 sm:right-2 bottom-[calc(100%+8px)] z-20 flex flex-col overflow-hidden rounded-lg border border-[var(--app-border)] bg-[var(--app-surface-alt)] shadow-[var(--app-elev-2)] max-h-[min(55dvh,28rem)]"
    >
      <div ref={listRef} id={listId} role="listbox" aria-label={gt("Commands")} className="overflow-y-auto overscroll-contain min-h-0">
        {groups.map((group) => (
          <div key={group.key} role="group" aria-label={group.kind === "builtin" ? gt("Built-in") : group.label}>
            <div className="sticky top-0 z-10 flex items-center gap-2 px-3 py-1.5 bg-[var(--app-surface-alt)] border-b border-[var(--app-border)]/50" onMouseDown={(e) => e.preventDefault()}>
              {group.kind === "app" ? (
                group.icon ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={cdnImage(group.icon)} alt="" className="w-4 h-4 rounded-sm object-cover shrink-0" />
                ) : (
                  <Bot className="w-3.5 h-3.5 text-[var(--app-accent)] shrink-0" />
                )
              ) : (
                <Sparkles className="w-3.5 h-3.5 text-[var(--app-accent)] shrink-0" />
              )}
              <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--app-muted)] truncate">
                {group.kind === "builtin" ? gt("Built-in") : group.label}
              </span>
              <span className="ml-auto text-[10px] text-[var(--app-muted)] tabular-nums">{group.items.length}</span>
            </div>
            {group.items.map((row) => {
              const isActive = row.spec.key === activeKey;
              const preview = row.spec.options.slice(0, 3);
              return (
                <div
                  key={row.spec.key}
                  id={`${listId}-${row.spec.key}`}
                  data-command-key={row.spec.key}
                  role="option"
                  aria-selected={isActive}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onPick(row.spec);
                  }}
                  onMouseMove={() => {
                    if (!isActive) onActivate(row.spec.key);
                  }}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2 min-h-[44px] cursor-pointer select-none",
                    isActive ? "bg-[color-mix(in_srgb,var(--app-accent)_14%,transparent)]" : "hover:bg-[var(--app-surface)]/60",
                  )}
                >
                  <CommandIcon spec={row.spec} className="w-8 h-8" />
                  <span className="flex flex-col min-w-0 flex-1">
                    <span className="truncate text-sm text-[var(--text-secondary)]">
                      /<Highlighted text={row.spec.name} match={row.match} />
                    </span>
                    {row.spec.description && (
                      <span className="truncate text-xs text-[var(--app-muted)]">{row.spec.description}</span>
                    )}
                  </span>
                  {preview.length > 0 && (
                    <span className="hidden sm:flex items-center gap-1 shrink-0 max-w-[45%] overflow-hidden">
                      {preview.map((o) => (
                        <span
                          key={o.name}
                          className={cn(
                            "truncate rounded px-1.5 py-0.5 text-[10px] font-medium border",
                            o.required
                              ? "border-[color-mix(in_srgb,var(--app-accent)_40%,transparent)] text-[var(--app-accent)]"
                              : "border-[var(--app-border)] text-[var(--app-muted)]",
                          )}
                        >
                          {o.name}
                        </span>
                      ))}
                      {row.spec.options.length > preview.length && (
                        <span className="text-[10px] text-[var(--app-muted)]">+{row.spec.options.length - preview.length}</span>
                      )}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* Preview of the highlighted command */}
      {active && (
        <div className="shrink-0 border-t border-[var(--app-border)] bg-[var(--app-surface)] px-3 py-2" onMouseDown={(e) => e.preventDefault()}>
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-sm font-semibold text-[var(--text-primary)] truncate">/{active.name}</span>
            <span className="text-[11px] text-[var(--app-muted)] truncate">
              {active.source === "app" ? active.app?.name : gt("Built-in")}
            </span>
            <span className="ml-auto hidden md:flex items-center gap-2 text-[10px] text-[var(--app-muted)] shrink-0">
              <kbd className="rounded border border-[var(--app-border)] px-1">↑↓</kbd>
              <kbd className="rounded border border-[var(--app-border)] px-1">{gt("Enter")}</kbd>
              <kbd className="rounded border border-[var(--app-border)] px-1">{gt("Esc")}</kbd>
            </span>
          </div>
          {active.options.length > 0 ? (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {active.options.map((o) => (
                <span
                  key={o.name}
                  title={o.description || undefined}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px]",
                    o.required
                      ? "border-[color-mix(in_srgb,var(--app-accent)_45%,transparent)] bg-[color-mix(in_srgb,var(--app-accent)_10%,transparent)] text-[var(--text-primary)]"
                      : "border-[var(--app-border)] text-[var(--app-muted)]",
                  )}
                >
                  <span className="font-medium">{o.name}</span>
                  <span className="opacity-70">{optionKindLabel(gt, o.kind)}</span>
                  {o.required ? (
                    <span className="text-[9px] font-bold uppercase text-[var(--app-accent)]">{gt("required")}</span>
                  ) : null}
                </span>
              ))}
            </div>
          ) : (
            <p className="mt-0.5 text-[11px] text-[var(--app-muted)]">{gt("No options. Press Enter to pick, then Enter to send.")}</p>
          )}
          {active.hint && <p className="mt-1 text-[11px] text-[var(--app-muted)] line-clamp-2">{active.hint}</p>}
        </div>
      )}
    </div>
  );
}

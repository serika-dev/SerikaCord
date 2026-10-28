"use client";

import { useId, useMemo, useState } from "react";
import { useGT } from "gt-next";
import { Check, ChevronDown, Search, User } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn, cdnImage } from "@/lib/utils";

export interface PickerServer {
  id: string;
  name: string;
  icon?: string | null;
}

export function ServerIcon({ name, icon, className }: { name: string; icon?: string | null; className?: string }) {
  return icon ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={cdnImage(icon)} alt="" className={cn("rounded-full object-cover shrink-0 bg-[var(--bg-hover)]", className)} />
  ) : (
    <span className={cn("rounded-full shrink-0 flex items-center justify-center bg-[var(--app-accent)] text-[var(--text-on-accent,#fff)] text-[11px] font-bold", className)}>
      {name.charAt(0).toUpperCase()}
    </span>
  );
}

/** Servers matching a case-insensitive name query; `firstId` (the server you're in) leads. */
export function filterPickerServers<T extends PickerServer>(servers: readonly T[], query: string, firstId?: string | null): T[] {
  const q = query.trim().toLowerCase();
  const list = q ? servers.filter((s) => s.name.toLowerCase().includes(q)) : [...servers];
  if (firstId) list.sort((a, b) => (a.id === firstId ? -1 : b.id === firstId ? 1 : 0));
  return list;
}

interface ServerProfilePickerProps {
  servers: readonly PickerServer[];
  /** Selected server, or null for the main profile (with `includeMain`). */
  value: string | null;
  onChange: (serverId: string | null) => void;
  /** server id → overridden fields: those servers get a "Customised" mark. */
  profiled: Record<string, string[]>;
  /** Offer "Main Profile" as the first row (the in-profile editor). */
  includeMain?: boolean;
  /** Listed first (the server the profile was opened from). */
  preferredId?: string | null;
  /** Return false to keep the current selection (e.g. unsaved changes). */
  canChange?: () => boolean;
  /** `field`: full-width settings dropdown. `header`: compact title button. */
  variant?: "field" | "header";
}

/**
 * Pick the server whose profile you edit: searchable, with server icons and
 * a mark on servers that already have a server profile. Arrow keys move,
 * Enter picks, Escape closes.
 */
export function ServerProfilePicker({
  servers,
  value,
  onChange,
  profiled,
  includeMain = false,
  preferredId,
  canChange,
  variant = "field",
}: ServerProfilePickerProps) {
  const gt = useGT();
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const current = value ? servers.find((s) => s.id === value) ?? null : null;

  const results = useMemo(() => filterPickerServers(servers, query, preferredId), [servers, query, preferredId]);
  const showMain = includeMain && !query.trim();
  const offset = showMain ? 1 : 0;
  const rowCount = results.length + offset;
  const activeIndex = Math.max(0, Math.min(active, rowCount - 1));

  const onOpenChange = (next: boolean) => {
    if (next && canChange && !canChange()) return;
    setOpen(next);
    if (next) {
      setQuery("");
      const at = value ? filterPickerServers(servers, "", preferredId).findIndex((s) => s.id === value) : -1;
      setActive(at >= 0 ? at + (includeMain ? 1 : 0) : 0);
    }
  };

  const pick = (index: number) => {
    const id = showMain && index === 0 ? null : results[index - offset]?.id;
    if (id === undefined) return;
    setOpen(false);
    if (id !== value) onChange(id);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (rowCount === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((activeIndex + 1) % rowCount);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((activeIndex - 1 + rowCount) % rowCount);
    } else if (e.key === "Home") {
      e.preventDefault();
      setActive(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setActive(rowCount - 1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      pick(activeIndex);
    }
  };

  const optionId = (i: number) => `${listId}-opt-${i}`;
  const rowClass = (i: number) => cn(
    "w-full flex items-center gap-2.5 px-2.5 min-h-10 py-1.5 rounded-lg text-sm text-left transition-colors duration-100 outline-none",
    i === activeIndex ? "bg-[var(--bg-hover)] text-[var(--text-primary)]" : "text-[var(--text-secondary)]",
  );
  const mark = (id: string) => (profiled[id]?.length ? (
    <span className="shrink-0 rounded-full bg-[color-mix(in_srgb,var(--app-accent)_16%,transparent)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--app-accent)]">
      {gt("Customised")}
    </span>
  ) : null);

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        {variant === "field" ? (
          <button
            type="button"
            disabled={servers.length === 0}
            aria-haspopup="listbox"
            // The visible server name is the accessible name once one is picked.
            aria-label={current ? undefined : gt("Choose a server")}
            className={cn(
              "group w-full h-12 flex items-center gap-2.5 px-3 rounded-lg border text-left text-sm transition-[border-color,background-color] duration-150",
              "border-[var(--border-subtle)] bg-[var(--bg-input,var(--bg-app))] hover:border-[var(--border-strong,var(--border-subtle))]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-accent)]",
              open && "border-[var(--app-accent)]",
              "disabled:cursor-not-allowed disabled:opacity-60",
            )}
          >
            {current ? (
              <>
                <ServerIcon name={current.name} icon={current.icon} className="size-7" />
                <span className="min-w-0 flex-1 truncate font-medium text-[var(--text-primary)]">{current.name}</span>
                {mark(current.id)}
              </>
            ) : (
              <span className="flex-1 text-[var(--text-muted)]">{servers.length === 0 ? gt("You're not in any servers yet.") : gt("Choose a server")}</span>
            )}
            <ChevronDown className={cn("w-4 h-4 shrink-0 text-[var(--text-muted)] transition-transform duration-150", open && "rotate-180")} />
          </button>
        ) : (
          <button
            type="button"
            aria-haspopup="listbox"
            title={gt("Choose which profile to edit")}
            className="group flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-[15px] font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-accent)]"
          >
            {current && <ServerIcon name={current.name} icon={current.icon} className="size-5" />}
            <span className="truncate">{current ? current.name : gt("Main Profile")}</span>
            <ChevronDown className={cn("w-4 h-4 shrink-0 text-[var(--text-muted)] transition-transform duration-150", open && "rotate-180")} />
          </button>
        )}
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        collisionPadding={8}
        className={cn(
          "p-2 rounded-xl border-[var(--border-subtle)] bg-[var(--app-surface)] text-[var(--text-primary)] shadow-xl",
          variant === "field" ? "w-[var(--radix-popover-trigger-width)] min-w-64 max-w-[calc(100vw-16px)]" : "w-72 max-w-[calc(100vw-16px)]",
        )}
      >
        <div className="relative mb-1.5">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)] pointer-events-none" />
          <input
            autoFocus
            value={query}
            onChange={(e) => { setQuery(e.target.value); setActive(0); }}
            onKeyDown={onKeyDown}
            placeholder={gt("Search")}
            role="combobox"
            aria-expanded
            aria-controls={listId}
            aria-activedescendant={rowCount > 0 ? optionId(activeIndex) : undefined}
            aria-label={gt("Search your servers")}
            className="w-full h-9 pl-8 pr-2.5 rounded-lg bg-[var(--bg-input,var(--bg-hover))] border border-[var(--border-subtle)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--app-accent)]"
          />
        </div>
        <div id={listId} role="listbox" aria-label={gt("Servers")} className="max-h-72 overflow-y-auto overscroll-contain space-y-0.5 pr-0.5">
          {showMain && (
            <button
              id={optionId(0)}
              type="button"
              role="option"
              aria-selected={value === null}
              tabIndex={-1}
              onMouseEnter={() => setActive(0)}
              onClick={() => pick(0)}
              className={rowClass(0)}
            >
              <span className="size-6 shrink-0 rounded-full flex items-center justify-center bg-[var(--bg-hover)] text-[var(--text-secondary)]">
                <User className="w-3.5 h-3.5" />
              </span>
              <span className="flex-1 min-w-0 truncate font-medium">{gt("Main Profile")}</span>
              {value === null && <Check className="w-4 h-4 shrink-0 text-[var(--app-accent)]" />}
            </button>
          )}
          {showMain && results.length > 0 && (
            <p className="px-2.5 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">{gt("Server Profiles")}</p>
          )}
          {results.map((s, i) => {
            const row = i + offset;
            const selected = value === s.id;
            return (
              <button
                key={s.id}
                id={optionId(row)}
                type="button"
                role="option"
                aria-selected={selected}
                tabIndex={-1}
                onMouseEnter={() => setActive(row)}
                onClick={() => pick(row)}
                className={rowClass(row)}
                ref={row === activeIndex ? (el) => el?.scrollIntoView({ block: "nearest" }) : undefined}
              >
                <ServerIcon name={s.name} icon={s.icon} className="size-6" />
                <span className="flex-1 min-w-0 truncate" title={s.name}>{s.name}</span>
                {mark(s.id)}
                {selected && <Check className="w-4 h-4 shrink-0 text-[var(--app-accent)]" />}
              </button>
            );
          })}
          {results.length === 0 && (
            <p className="px-2.5 py-3 text-xs text-[var(--text-muted)]">
              {servers.length === 0 ? gt("You're not in any servers yet.") : gt("No servers match your search.")}
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

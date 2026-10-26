"use client";

import { useState, type ReactNode } from "react";
import { T, useGT } from "gt-next";
import { Ban, Check, ChevronsUpDown, Hash, Megaphone, Plus } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command";
import { Loader } from "@/components/ui/Loader";
import { cn } from "@/lib/utils";

export const PICK_NONE = "__none__";
export const PICK_CREATE = "__create__";

export interface PickerOption {
  value: string;
  label: string;
  kind: "text" | "announcement";
  /** Shown muted after the name, e.g. "linked to #general". */
  hint?: string;
  disabled?: boolean;
}

export interface PickerGroup {
  heading: string;
  options: PickerOption[];
}

export function ChannelGlyph({ kind, className }: { kind: string; className?: string }) {
  const Icon = kind === "announcement" ? Megaphone : Hash;
  return <Icon className={cn("size-4 shrink-0 text-[var(--text-muted)]", className)} aria-hidden="true" />;
}

/**
 * Searchable channel select for one mapping row: "Don't bridge", an optional
 * "Create new channel", then the channels grouped by category.
 */
export function ChannelPicker({
  value,
  groups,
  createLabel,
  onSelect,
  busy,
  disabled,
  ariaLabel,
  trigger,
}: {
  value: string | null;
  groups: PickerGroup[];
  createLabel?: string;
  onSelect: (value: string) => void;
  busy?: boolean;
  disabled?: boolean;
  ariaLabel: string;
  trigger: ReactNode;
}) {
  const gt = useGT();
  const [open, setOpen] = useState(false);
  const pick = (v: string) => {
    setOpen(false);
    if (v !== (value ?? PICK_NONE)) onSelect(v);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild disabled={disabled || busy}>
        <button
          type="button"
          aria-label={ariaLabel}
          className={cn(
            "group flex w-full min-w-0 items-center gap-2 h-9 rounded-lg border px-2.5 text-left text-sm transition-[border-color,background-color] duration-150 ease-out",
            "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--app-accent)] disabled:opacity-60",
            value
              ? "border-[var(--border-subtle)] bg-[var(--bg-card)] text-[var(--text-primary)] hover:border-[var(--border-strong)]"
              : "border-dashed border-[var(--border-subtle)] bg-transparent text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)]",
          )}
        >
          <span className="flex min-w-0 flex-1 items-center gap-1.5">{trigger}</span>
          {busy ? <Loader size={14} /> : <ChevronsUpDown className="size-3.5 shrink-0 opacity-60" aria-hidden="true" />}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(20rem,calc(100vw-2rem))] p-0 bg-[var(--bg-card)] border-[var(--border-subtle)] text-[var(--text-primary)] rounded-xl overflow-hidden">
        <Command className="bg-transparent text-[var(--text-primary)]">
          <CommandInput placeholder={gt("Search channels")} />
          <CommandList className="max-h-[min(320px,50vh)]">
            <CommandEmpty><T>No channels match.</T></CommandEmpty>
            <CommandGroup>
              <CommandItem value={`__none ${gt("Don't bridge")}`} onSelect={() => pick(PICK_NONE)}>
                <Ban className="size-4 text-[var(--text-muted)]" aria-hidden="true" />
                <span className="flex-1"><T>Don&apos;t bridge</T></span>
                {!value && <Check className="size-4 text-[var(--app-accent)]" aria-hidden="true" />}
              </CommandItem>
              {createLabel && (
                <CommandItem value={`__create ${createLabel}`} onSelect={() => pick(PICK_CREATE)}>
                  <Plus className="size-4 text-[var(--app-accent)]" aria-hidden="true" />
                  <span className="flex-1 truncate">{createLabel}</span>
                </CommandItem>
              )}
            </CommandGroup>
            {groups.map((group) =>
              group.options.length === 0 ? null : (
                <div key={group.heading}>
                  <CommandSeparator className="bg-[var(--border-subtle)]" />
                  <CommandGroup heading={group.heading}>
                    {group.options.map((o) => (
                      <CommandItem
                        key={o.value}
                        value={`${o.label} ${o.value}`}
                        disabled={o.disabled}
                        onSelect={() => pick(o.value)}
                      >
                        <ChannelGlyph kind={o.kind} />
                        <span className="min-w-0 flex-1 truncate">{o.label}</span>
                        {o.hint && <span className="shrink-0 max-w-[45%] truncate text-[11px] text-[var(--text-muted)]">{o.hint}</span>}
                        {value === o.value && <Check className="size-4 text-[var(--app-accent)]" aria-hidden="true" />}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </div>
              ),
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

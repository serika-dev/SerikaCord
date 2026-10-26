"use client";

import { useId, useMemo, useState } from "react";
import { useGT } from "gt-next";
import { Check, ChevronDown, Search, Tag } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ServerTagPill } from "@/components/user/ServerTagPill";
import { useServerTagChoice } from "@/components/settings/ServerTagPicker";
import { filterTaggedServers, tagFromServer } from "@/components/user/profileEditor/selfProfile";
import type { ResolvedServerTag } from "@/lib/servers/serverProfile";
import { cn, cdnImage } from "@/lib/utils";

/**
 * Your own tag chip on the full profile ("SRKA ▾"): opens a searchable list
 * of your servers with a tag turned on, plus "No Server Tag". Picking one
 * adopts it right away. Arrow keys move, Enter picks, Escape closes.
 */
export function ServerTagSelect({ tag }: { tag: ResolvedServerTag | null }) {
  const gt = useGT();
  const listId = useId();
  const { tagged, currentId, saving, choose } = useServerTagChoice();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  const results = useMemo(() => filterTaggedServers(tagged, query), [tagged, query]);
  // Row 0 is "No Server Tag", then one row per server.
  const rowCount = results.length + 1;
  const activeIndex = Math.min(active, rowCount - 1);

  if (!tag && tagged.length === 0) return null;

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) {
      setQuery("");
      const current = tagged.findIndex((s) => s.id === currentId);
      setActive(current >= 0 ? current + 1 : 0);
    }
  };

  const pick = async (index: number) => {
    if (saving) return;
    const serverId = index === 0 ? null : results[index - 1]?.id ?? null;
    if (index > 0 && !serverId) return;
    if (serverId === currentId) {
      setOpen(false);
      return;
    }
    if (await choose(serverId)) setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
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
      void pick(activeIndex);
    }
  };

  const optionId = (i: number) => `${listId}-opt-${i}`;
  const rowClass = (i: number) => cn(
    "w-full flex items-center gap-2.5 px-2.5 h-10 rounded-lg text-sm text-left transition-colors duration-100 outline-none",
    i === activeIndex ? "bg-[var(--bg-hover)] text-[var(--text-primary)]" : "text-[var(--text-secondary)]",
  );

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={gt("Change server tag")}
          className={cn(
            "group inline-flex items-center gap-1 rounded-md shrink-0 transition-colors duration-150",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-accent)]",
            !tag && "px-1.5 py-1 border border-dashed border-white/20 text-xs font-semibold text-white/60 hover:text-white hover:border-white/40",
          )}
        >
          {tag ? (
            <ServerTagPill
              tag={tag}
              size="md"
              interactive={false}
              className="group-hover:border-white/30"
              trailing={<ChevronDown className={cn("-mr-0.5 w-3.5 h-3.5 text-white/60 transition-transform duration-150 group-hover:text-white", open && "rotate-180")} />}
            />
          ) : (
            <>
              <Tag className="w-3.5 h-3.5" />
              {gt("Server Tag")}
              <ChevronDown className={cn("w-3.5 h-3.5 text-white/60 transition-transform duration-150", open && "rotate-180")} />
            </>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        collisionPadding={8}
        className="w-72 p-2 rounded-xl border-[var(--border-subtle)] bg-[var(--app-surface)] text-[var(--text-primary)] shadow-xl"
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
            aria-activedescendant={optionId(activeIndex)}
            aria-label={gt("Search your servers")}
            className="w-full h-9 pl-8 pr-2.5 rounded-lg bg-[var(--bg-input,var(--bg-hover))] border border-[var(--border-subtle)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--app-accent)]"
          />
        </div>
        <div id={listId} role="listbox" aria-label={gt("Server tags")} className="max-h-64 overflow-y-auto overscroll-contain space-y-0.5 pr-0.5">
          <button
            id={optionId(0)}
            type="button"
            role="option"
            aria-selected={!currentId}
            tabIndex={-1}
            disabled={saving !== null}
            onMouseEnter={() => setActive(0)}
            onClick={() => void pick(0)}
            className={rowClass(0)}
          >
            <span className="flex-1 italic text-[var(--text-muted)]">{gt("No Server Tag")}</span>
            {!currentId && <Check className="w-4 h-4 shrink-0 text-[var(--app-accent)]" />}
          </button>
          {results.map((s, i) => {
            const row = i + 1;
            const serverTag = tagFromServer(s);
            const selected = currentId === s.id;
            return (
              <button
                key={s.id}
                id={optionId(row)}
                type="button"
                role="option"
                aria-selected={selected}
                tabIndex={-1}
                disabled={saving !== null}
                onMouseEnter={() => setActive(row)}
                onClick={() => void pick(row)}
                className={rowClass(row)}
                ref={row === activeIndex ? (el) => el?.scrollIntoView({ block: "nearest" }) : undefined}
              >
                {s.icon ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={cdnImage(s.icon)} alt="" className="size-6 rounded-full object-cover shrink-0" />
                ) : (
                  <span className="size-6 rounded-full shrink-0 flex items-center justify-center bg-[var(--app-accent)] text-white text-[11px] font-bold">
                    {s.name.charAt(0).toUpperCase()}
                  </span>
                )}
                <span className="flex-1 min-w-0 truncate" title={s.name}>{s.name}</span>
                {serverTag && <ServerTagPill tag={serverTag} interactive={false} />}
                {selected && <Check className="w-4 h-4 shrink-0 text-[var(--app-accent)]" />}
              </button>
            );
          })}
          {results.length === 0 && (
            <p className="px-2.5 py-3 text-xs text-[var(--text-muted)]">{gt("No servers match your search.")}</p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

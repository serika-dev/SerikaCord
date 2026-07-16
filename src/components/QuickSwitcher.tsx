"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useServer } from "@/contexts/ServerContext";
import { onHotkey } from "@/lib/keybinds";
import { cn } from "@/lib/utils";
import { Hash, Server as ServerIcon, AtSign, Volume2, Megaphone } from "lucide-react";
import { useGT } from "gt-next";

interface DMRecipient {
  id: string;
  username: string;
  displayName?: string;
  avatar?: string;
}
interface DMChannel {
  id: string;
  type: string;
  recipients: DMRecipient[];
}

type SwitchItem = {
  key: string;
  kind: "server" | "channel" | "dm";
  label: string;
  sublabel?: string;
  href: string;
  avatar?: string;
  channelType?: string;
};

/**
 * Ctrl+K command palette — jump to any server, a channel in the active server,
 * or a direct message. Opens on the `goto-dm` broadcast hotkey.
 */
export function QuickSwitcher() {
  const gt = useGT();
  const router = useRouter();
  const { servers, currentServer, channels } = useServer();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [dms, setDms] = useState<DMChannel[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const toggleSwitcher = useCallback(() => {
    setOpen((prev) => {
      if (prev) return false; // pressing the hotkey again closes it
      setQuery("");
      setActive(0);
      return true;
    });
  }, []);

  useEffect(() => onHotkey("goto-dm", toggleSwitcher), [toggleSwitcher]);

  // Focus the field + (re)load DMs each time it opens. setDms lands in an async
  // callback (not the effect body), so it's compiler-safe.
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => inputRef.current?.focus(), 40);
    let cancelled = false;
    fetch("/api/dms")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data?.channels) setDms(data.channels as DMChannel[]);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [open]);

  const items = useMemo<SwitchItem[]>(() => {
    const list: SwitchItem[] = [];
    for (const s of servers) {
      list.push({ key: `s-${s.id}`, kind: "server", label: s.name, href: `/channels/${s.id}`, avatar: s.icon });
    }
    if (currentServer) {
      for (const c of channels) {
        if (!["text", "announcement", "voice", "forum"].includes(c.type)) continue;
        list.push({
          key: `c-${c.id}`,
          kind: "channel",
          label: c.name,
          sublabel: currentServer.name,
          href: `/channels/${currentServer.id}/${c.id}`,
          channelType: c.type,
        });
      }
    }
    for (const dm of dms) {
      const r = dm.recipients?.[0];
      if (!r) continue;
      const name = dm.recipients.map((x) => x.displayName || x.username).join(", ");
      list.push({ key: `d-${dm.id}`, kind: "dm", label: name, sublabel: gt("Direct Message"), href: `/dm/${r.id}`, avatar: r.avatar });
    }
    return list;
  }, [servers, currentServer, channels, dms, gt]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items.slice(0, 50);
    return items
      .filter((i) => i.label.toLowerCase().includes(q) || i.sublabel?.toLowerCase().includes(q))
      .slice(0, 50);
  }, [items, query]);

  // Clamp during render instead of via a setState-in-effect (compiler-safe).
  const safeActive = filtered.length ? Math.min(active, filtered.length - 1) : 0;

  const go = useCallback((item: SwitchItem | undefined) => {
    if (!item) return;
    setOpen(false);
    router.push(item.href);
  }, [router]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((filtered.length ? (safeActive + 1) % filtered.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((filtered.length ? (safeActive - 1 + filtered.length) % filtered.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      go(filtered[safeActive]);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-xl p-0 overflow-hidden gap-0" showCloseButton={false}>
        <DialogTitle className="sr-only">{gt("Quick Switcher")}</DialogTitle>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={gt("Where would you like to go?")}
          className="w-full px-4 py-3.5 bg-transparent text-[var(--text-primary)] text-base outline-none border-b border-[var(--app-border)] placeholder:text-[var(--app-muted-2)]"
        />
        <div className="max-h-[50vh] overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-[var(--app-muted)]">{gt("No results")}</p>
          ) : (
            filtered.map((item, idx) => (
              <button
                key={item.key}
                type="button"
                onMouseEnter={() => setActive(idx)}
                onClick={() => go(item)}
                className={cn(
                  "w-full flex items-center gap-3 px-4 py-2 text-left transition-colors",
                  idx === safeActive ? "bg-[var(--app-accent)]/15" : "hover:bg-[var(--app-surface)]/60"
                )}
              >
                <span className="flex items-center justify-center w-8 h-8 shrink-0 rounded-lg bg-[var(--app-surface-alt)] text-[var(--app-muted)] overflow-hidden">
                  {item.avatar ? (
                    <img src={item.avatar} alt="" className="w-full h-full object-cover" />
                  ) : item.kind === "server" ? (
                    <ServerIcon className="w-4 h-4" />
                  ) : item.kind === "dm" ? (
                    <AtSign className="w-4 h-4" />
                  ) : item.channelType === "voice" ? (
                    <Volume2 className="w-4 h-4" />
                  ) : item.channelType === "announcement" ? (
                    <Megaphone className="w-4 h-4" />
                  ) : (
                    <Hash className="w-4 h-4" />
                  )}
                </span>
                <span className="flex flex-col min-w-0">
                  <span className="truncate text-sm text-[var(--text-primary)]">{item.label}</span>
                  {item.sublabel && (
                    <span className="truncate text-xs text-[var(--app-muted)]">{item.sublabel}</span>
                  )}
                </span>
              </button>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

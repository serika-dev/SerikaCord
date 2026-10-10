"use client";

import { sharedGet } from "@/lib/bootFetch";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useServer, useServerMembersOptional } from "@/contexts/ServerContext";
import { useUnread } from "@/contexts/UnreadContext";
import { onHotkey } from "@/lib/keybinds";
import { cn, cdnImage } from "@/lib/utils";
import { Hash, Server as ServerIcon, AtSign, Volume2, Megaphone, MessagesSquare, Users, User as UserIcon, Radio } from "lucide-react";
import { useGT } from "gt-next";
import { dmChannelHref } from "@/lib/chat/groupDm";
import { groupDisplayName } from "@/lib/chat/dmCall";
import {
  parseSwitcherQuery,
  pushRecent,
  rankSwitcherItems,
  switcherKeyForPath,
  type SwitcherItem,
} from "@/lib/quickSwitcher";

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
  /** Group DMs only. */
  name?: string | null;
  icon?: string | null;
}
interface SwitcherChannel {
  id: string;
  serverId: string;
  name: string;
  type: string;
  parentName?: string | null;
}
interface Friend {
  id: string;
  username: string;
  displayName?: string | null;
  avatar?: string | null;
}

type Row = SwitcherItem & { avatar?: string | null; channelId?: string; serverId?: string };

const RECENT_KEY = "sc:switcher:recent";

function readRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === "string") : [];
  } catch {
    return [];
  }
}

function writeRecent(list: string[]) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    /* storage disabled */
  }
}

/**
 * Ctrl+K quick switcher (Discord's): every server, every channel you can open
 * in every server, DMs, group DMs and people. Prefixes narrow the search
 * (@ users, # text channels, ! voice channels, * servers); places with
 * mentions, unread messages and recent visits rank first.
 */
export function QuickSwitcher() {
  const gt = useGT();
  const router = useRouter();
  const pathname = usePathname();
  const { servers } = useServer();
  const membersCtx = useServerMembersOptional();
  const members = membersCtx?.members;
  const { isChannelUnread, getMentionCount, isServerUnread, getServerMentionCount } = useUnread();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [dms, setDms] = useState<DMChannel[]>([]);
  const [channels, setChannels] = useState<SwitcherChannel[]>([]);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [recent, setRecent] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const toggleSwitcher = useCallback(() => {
    setOpen((prev) => {
      if (prev) return false; // pressing the hotkey again closes it
      setQuery("");
      setActive(0);
      setRecent(readRecent());
      return true;
    });
  }, []);

  useEffect(() => onHotkey("goto-dm", toggleSwitcher), [toggleSwitcher]);

  // Remember where the user goes (per device), for "recent" ranking.
  useEffect(() => {
    const key = pathname ? switcherKeyForPath(pathname) : null;
    if (key) writeRecent(pushRecent(readRecent(), key));
  }, [pathname]);

  // Focus the field + (re)load DMs, all servers' channels and friends each time
  // it opens. setState lands in async callbacks (not the effect body).
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => inputRef.current?.focus(), 40);
    let cancelled = false;
    sharedGet("/api/dms")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data?.channels) setDms(data.channels as DMChannel[]);
      })
      .catch(() => {});
    sharedGet("/api/users/@me/switcher-channels")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && Array.isArray(data?.channels)) setChannels(data.channels as SwitcherChannel[]);
      })
      .catch(() => {});
    sharedGet("/api/friends")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && Array.isArray(data?.friends)) setFriends(data.friends as Friend[]);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [open]);

  const serverNames = useMemo(() => new Map(servers.map((s) => [s.id, s.name] as const)), [servers]);

  const items = useMemo<Row[]>(() => {
    const list: Row[] = [];
    for (const s of servers) {
      list.push({
        key: `s-${s.id}`,
        kind: "server",
        label: s.name,
        href: `/channels/${s.id}`,
        avatar: s.icon,
        serverId: s.id,
      });
    }
    for (const c of channels) {
      const serverName = serverNames.get(c.serverId);
      if (!serverName) continue; // left the server since
      list.push({
        key: `c-${c.id}`,
        kind: "channel",
        label: c.name,
        sublabel: c.parentName ? `${serverName} · ${c.parentName}` : serverName,
        href: `/channels/${c.serverId}/${c.id}`,
        channelType: c.type,
        channelId: c.id,
        serverId: c.serverId,
      });
    }
    const dmUserIds = new Set<string>();
    for (const dm of dms) {
      const href = dmChannelHref(dm);
      if (!href) continue;
      const names = (dm.recipients || []).map((x) => x.displayName || x.username);
      if (dm.type === "group_dm") {
        list.push({
          key: `g-${dm.id}`,
          kind: "group",
          label: groupDisplayName(dm.name, names),
          // Members are searchable too ("alice" finds the group she's in).
          sublabel: names.join(", "),
          href,
          avatar: dm.icon ?? null,
          channelId: dm.id,
        });
        continue;
      }
      const r = dm.recipients?.[0];
      if (!r) continue;
      dmUserIds.add(r.id);
      list.push({
        key: `d-${r.id}`,
        kind: "dm",
        label: r.displayName || r.username,
        sublabel: r.username,
        aliases: [r.username],
        href,
        avatar: r.avatar,
        channelId: dm.id,
      });
    }
    // People without an open DM: friends and members of the current server.
    const people = new Map<string, Friend>();
    for (const f of friends) people.set(f.id, f);
    for (const m of (members || []) as Array<{ id?: string; username?: string; displayName?: string; avatar?: string | null; isBot?: boolean }>) {
      if (!m.id || !m.username || people.has(m.id)) continue;
      people.set(m.id, { id: m.id, username: m.username, displayName: m.displayName, avatar: m.avatar });
    }
    for (const p of people.values()) {
      if (dmUserIds.has(p.id)) continue;
      list.push({
        key: `d-${p.id}`,
        kind: "user",
        label: p.displayName || p.username,
        sublabel: p.username,
        aliases: [p.username],
        href: `/dm/${p.id}`,
        avatar: p.avatar,
      });
    }
    // Unread / mention state for ranking and badges.
    for (const row of list) {
      if (row.kind === "server" && row.serverId) {
        row.unread = isServerUnread(row.serverId);
        row.mentions = getServerMentionCount(row.serverId);
      } else if (row.channelId) {
        row.unread = isChannelUnread(row.channelId);
        row.mentions = getMentionCount(row.channelId);
      }
    }
    return list;
  }, [servers, channels, serverNames, dms, friends, members, isServerUnread, getServerMentionCount, isChannelUnread, getMentionCount]);

  const recentRanks = useMemo(() => new Map(recent.map((k, i) => [k, i] as const)), [recent]);
  // The place you're in right now is never a useful destination.
  const currentKey = pathname ? switcherKeyForPath(pathname) : null;
  const filtered = useMemo(
    () => rankSwitcherItems(items.filter((i) => i.key !== currentKey), query, { recent: recentRanks, limit: 50 }) as Row[],
    [items, query, recentRanks, currentKey],
  );
  const mode = parseSwitcherQuery(query).mode;

  // Clamp during render instead of via a setState-in-effect (compiler-safe).
  const safeActive = filtered.length ? Math.min(active, filtered.length - 1) : 0;

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${safeActive}"]`)?.scrollIntoView({ block: "nearest" });
  }, [safeActive]);

  const go = useCallback((item: Row | undefined) => {
    if (!item) return;
    setOpen(false);
    router.push(item.href);
  }, [router]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || (e.key === "Tab" && !e.shiftKey)) {
      e.preventDefault();
      setActive((filtered.length ? (safeActive + 1) % filtered.length : 0));
    } else if (e.key === "ArrowUp" || (e.key === "Tab" && e.shiftKey)) {
      e.preventDefault();
      setActive((filtered.length ? (safeActive - 1 + filtered.length) % filtered.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      go(filtered[safeActive]);
    }
  };

  const kindLabel = (item: Row): string => {
    switch (item.kind) {
      case "server":
        return gt("Server");
      case "group":
        return gt("Group DM");
      case "dm":
        return gt("Direct Message");
      case "user":
        return gt("User");
      default:
        return item.channelType === "voice" || item.channelType === "stage" ? gt("Voice Channel") : gt("Text Channel");
    }
  };

  const modeHint =
    mode === "user" ? gt("Searching users and direct messages")
    : mode === "text" ? gt("Searching text channels")
    : mode === "voice" ? gt("Searching voice channels")
    : mode === "server" ? gt("Searching servers")
    : null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-xl p-0 overflow-hidden gap-0 w-[calc(100vw-32px)]" showCloseButton={false}>
        <DialogTitle className="sr-only">{gt("Quick Switcher")}</DialogTitle>
        <div className="px-4 pt-4 pb-3 border-b border-[var(--app-border)]">
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            placeholder={gt("Where would you like to go?")}
            aria-label={gt("Where would you like to go?")}
            role="combobox"
            aria-expanded="true"
            aria-controls="quick-switcher-results"
            aria-activedescendant={filtered[safeActive] ? `qs-${filtered[safeActive].key}` : undefined}
            className="w-full h-11 px-3 rounded-md bg-[var(--app-surface-alt)] text-[var(--text-primary)] text-base outline-none placeholder:text-[var(--app-muted-2)]"
          />
          {modeHint && <p className="mt-2 text-xs text-[var(--app-muted)]">{modeHint}</p>}
        </div>
        <div ref={listRef} id="quick-switcher-results" role="listbox" className="max-h-[50vh] overflow-y-auto py-1">
          {!query.trim() && filtered.length > 0 && (
            <p className="px-4 pt-2 pb-1 text-[11px] font-bold uppercase tracking-wide text-[var(--app-muted)]">{gt("Previous channels")}</p>
          )}
          {filtered.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-[var(--app-muted)]">
              {query.trim() ? gt("No results") : gt("Start typing to search")}
            </p>
          ) : (
            filtered.map((item, idx) => (
              <button
                key={item.key}
                id={`qs-${item.key}`}
                data-idx={idx}
                type="button"
                role="option"
                aria-selected={idx === safeActive}
                onMouseEnter={() => setActive(idx)}
                onClick={() => go(item)}
                className={cn(
                  "w-full flex items-center gap-3 px-4 py-2 text-left transition-colors",
                  idx === safeActive ? "bg-[var(--app-accent)]/15" : "hover:bg-[var(--app-surface)]/60"
                )}
              >
                <span
                  className={cn(
                    "flex items-center justify-center w-8 h-8 shrink-0 overflow-hidden text-[var(--app-muted)]",
                    item.kind === "server" ? "rounded-xl bg-[var(--app-surface-alt)]" : item.kind === "channel" ? "" : "rounded-full bg-[var(--app-surface-alt)]",
                  )}
                >
                  {item.avatar ? (
                    <img src={cdnImage(item.avatar)} alt="" className="w-full h-full object-cover" />
                  ) : item.kind === "server" ? (
                    <ServerIcon className="w-4 h-4" />
                  ) : item.kind === "group" ? (
                    <Users className="w-4 h-4" />
                  ) : item.kind === "user" ? (
                    <UserIcon className="w-4 h-4" />
                  ) : item.kind === "dm" ? (
                    <AtSign className="w-4 h-4" />
                  ) : item.channelType === "voice" ? (
                    <Volume2 className="w-4 h-4" />
                  ) : item.channelType === "stage" ? (
                    <Radio className="w-4 h-4" />
                  ) : item.channelType === "announcement" ? (
                    <Megaphone className="w-4 h-4" />
                  ) : item.channelType === "forum" ? (
                    <MessagesSquare className="w-4 h-4" />
                  ) : (
                    <Hash className="w-4 h-4" />
                  )}
                </span>
                <span className="flex flex-col min-w-0 flex-1">
                  <span
                    className={cn(
                      "truncate text-sm",
                      item.unread || (item.mentions ?? 0) > 0 ? "text-[var(--text-primary)] font-semibold" : "text-[var(--text-secondary)]",
                    )}
                  >
                    {item.label}
                  </span>
                  {item.sublabel && (
                    <span className="truncate text-xs text-[var(--app-muted)]">{item.sublabel}</span>
                  )}
                </span>
                {(item.mentions ?? 0) > 0 ? (
                  <span className="shrink-0 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[11px] font-bold leading-[18px] text-center">
                    {item.mentions! > 99 ? "99+" : item.mentions}
                  </span>
                ) : item.unread ? (
                  <span className="shrink-0 w-2 h-2 rounded-full bg-[var(--text-primary)]" aria-label={gt("Unread")} />
                ) : null}
                <span className="hidden sm:inline shrink-0 text-[11px] text-[var(--app-muted)]">{kindLabel(item)}</span>
              </button>
            ))
          )}
        </div>
        <div className="px-4 py-2.5 border-t border-[var(--app-border)] bg-[var(--app-surface-alt)]/40 text-[11px] text-[var(--app-muted)]">
          <span className="font-bold uppercase tracking-wide text-[var(--app-accent)]">{gt("Protip:")}</span>{" "}
          {gt("Start searches with @ for users, # for text channels, ! for voice channels and * for servers.")}
        </div>
      </DialogContent>
    </Dialog>
  );
}

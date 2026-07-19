"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { useServer } from "@/contexts/ServerContext";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Separator } from "@/components/ui/separator";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Plus, Compass, MessageSquare, Check, BellOff, Bell, Copy, LogOut,
  FolderPlus, FolderMinus, Folder as FolderIcon, Pencil, Users, UserPlus,
} from "lucide-react";
import { cn, cdnImage } from "@/lib/utils";
import { motion } from "framer-motion";
import { useMentions } from "@/hooks/useMentions";
import { useUnread } from "@/contexts/UnreadContext";
import { useServerMutes } from "@/hooks/useServerMutes";
import { useServerLayout, type ServerLayoutEntry } from "@/hooks/useServerLayout";
import { usePolling } from "@/hooks/usePolling";
import { useGT } from "gt-next";
import { ServerBadge } from "@/components/ui/badges";

interface ServerSidebarProps {
  onCreateServer: () => void;
  onInvitePeople?: (serverId?: string) => void;
}

type Server = ReturnType<typeof useServer>["servers"][number];

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
  updatedAt?: string;
  lastMessageId?: string | null;
}

const DM_POLL_INTERVAL = 30_000;
const DM_SEEN_KEY = "sc:dm-seen";
const DM_SEEN_INIT_KEY = "sc:dm-seen-init";

function loadDmSeen(): Record<string, string> {
  if (typeof localStorage === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(DM_SEEN_KEY) || "{}") as Record<string, string>;
  } catch {
    return {};
  }
}
function saveDmSeen(map: Record<string, string>) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(DM_SEEN_KEY, JSON.stringify(map));
  } catch {
    /* quota — ignore */
  }
}

export function ServerSidebar({ onCreateServer, onInvitePeople }: ServerSidebarProps) {
  const gt = useGT();
  const router = useRouter();
  const { servers, currentServer, setCurrentServer, leaveServer, prefetchServer } = useServer();
  const { serverMentionCounts, markServerRead } = useMentions();
  const { isServerUnread } = useUnread();
  const { isMuted, toggleMute } = useServerMutes();
  const pathname = usePathname();

  // Defensive: drop entries without an id and de-duplicate by id.
  const uniqueServers = useMemo(() => {
    const seen = new Set<string>();
    const out: Server[] = [];
    for (const s of servers) {
      const id = s?.id;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push(s);
    }
    return out;
  }, [servers]);

  const serversById = useMemo(() => {
    const map = new Map<string, Server>();
    for (const s of uniqueServers) map.set(s.id, s);
    return map;
  }, [uniqueServers]);

  const liveIds = useMemo(() => uniqueServers.map((s) => s.id), [uniqueServers]);
  const {
    entries, folders, reorder, createFolder, addToFolder, removeFromFolder,
    renameFolder, recolorFolder, moveServer, folderColors,
  } = useServerLayout(liveIds);

  const entryKey = (e: ServerLayoutEntry) => (e.kind === "server" ? `s:${e.id}` : `f:${e.id}`);

  const [menuServerId, setMenuServerId] = useState<string | null>(null);
  const [menuFolderId, setMenuFolderId] = useState<string | null>(null);
  const [openFolders, setOpenFolders] = useState<Set<string>>(new Set());
  const [renamingFolder, setRenamingFolder] = useState<string | null>(null);

  // ── native drag & drop for the server rail ─────────────────────────────────
  // Keyed by entry key (`s:<id>` / `f:<id>`). `dropTarget.mode` is "into" when
  // hovering the middle of a target (create/merge folder) or "before"/"after"
  // when hovering its top/bottom edge (reorder).
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ key: string; mode: "into" | "before" | "after" } | null>(null);

  const handleDragOver = (e: React.DragEvent, target: ServerLayoutEntry) => {
    if (!draggingKey) return;
    const targetKey = entryKey(target);
    if (targetKey === draggingKey) { setDropTarget(null); return; }
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const third = rect.height / 3;
    // Only servers/folders can *receive* a merge; a dragged folder can't nest.
    const draggingIsServer = draggingKey.startsWith("s:");
    let mode: "into" | "before" | "after";
    if (draggingIsServer && y > third && y < third * 2) mode = "into";
    else mode = y < rect.height / 2 ? "before" : "after";
    setDropTarget({ key: targetKey, mode });
  };

  const applyDrop = (target: ServerLayoutEntry) => {
    const source = draggingKey;
    setDraggingKey(null);
    const dt = dropTarget;
    setDropTarget(null);
    if (!source || !dt) return;
    const targetKey = entryKey(target);
    if (source === targetKey) return;

    if (source.startsWith("s:")) {
      const sourceId = source.slice(2);

      // "into" mode: merge into folder or create new folder with target server
      if (dt.mode === "into") {
        if (target.kind === "folder") {
          moveServer(sourceId, { kind: "folder", folderId: target.id });
        } else {
          moveServer(sourceId, { kind: "mergeWithServer", targetServerId: target.id });
        }
        return;
      }

      // "before"/"after" reorder — handle servers from folders and top-level
      const inFolder = folders.find((f) => f.serverIds.includes(sourceId));
      if (inFolder) {
        // Extract from folder, then insert at position
        const without = entries
          .map((e) =>
            e.kind === "folder" && e.id === inFolder.id
              ? { ...e, serverIds: e.serverIds.filter((id) => id !== sourceId) }
              : e
          )
          .filter((e) => !(e.kind === "folder" && e.serverIds.length === 0))
          .filter((e) => !(e.kind === "server" && e.id === sourceId));
        const targetIdx = without.findIndex((en) => entryKey(en) === targetKey);
        if (targetIdx === -1) {
          without.push({ kind: "server", id: sourceId });
        } else {
          const insertAt = dt.mode === "before" ? targetIdx : targetIdx + 1;
          without.splice(insertAt, 0, { kind: "server", id: sourceId });
        }
        reorder(without);
      } else {
        // Top-level server reorder
        const src = entries.find((en) => entryKey(en) === source);
        if (!src) return;
        const without = entries.filter((en) => entryKey(en) !== source);
        const targetIdx = without.findIndex((en) => entryKey(en) === targetKey);
        if (targetIdx === -1) return;
        const insertAt = dt.mode === "before" ? targetIdx : targetIdx + 1;
        without.splice(insertAt, 0, src);
        reorder(without);
      }
      return;
    }

    // Folder drag — only reorder at top level
    const src = entries.find((en) => entryKey(en) === source);
    if (!src) return;
    const without = entries.filter((en) => entryKey(en) !== source);
    const targetIdx = without.findIndex((en) => entryKey(en) === targetKey);
    if (targetIdx === -1) return;
    const insertAt = dt.mode === "before" ? targetIdx : targetIdx + 1;
    without.splice(insertAt, 0, src);
    reorder(without);
  };

  const handleDropOnBottom = () => {
    const source = draggingKey;
    setDraggingKey(null);
    setDropTarget(null);
    if (!source) return;

    if (source.startsWith("s:")) {
      const sourceId = source.slice(2);
      const inFolder = folders.find((f) => f.serverIds.includes(sourceId));
      if (inFolder) {
        // Pull out of folder and append to end
        const without = entries
          .map((e) =>
            e.kind === "folder" && e.id === inFolder.id
              ? { ...e, serverIds: e.serverIds.filter((id) => id !== sourceId) }
              : e
          )
          .filter((e) => !(e.kind === "folder" && e.serverIds.length === 0))
          .filter((e) => !(e.kind === "server" && e.id === sourceId));
        without.push({ kind: "server", id: sourceId });
        reorder(without);
      } else {
        // Already top-level, move to end
        const src = entries.find((en) => entryKey(en) === source);
        if (!src) return;
        const without = entries.filter((en) => entryKey(en) !== source);
        without.push(src);
        reorder(without);
      }
    } else {
      // Folder to end
      const src = entries.find((en) => entryKey(en) === source);
      if (!src) return;
      const without = entries.filter((en) => entryKey(en) !== source);
      without.push(src);
      reorder(without);
    }
  };

  const clearDrag = () => { setDraggingKey(null); setDropTarget(null); };

  // ── DM unread rail ────────────────────────────────────────────────────────
  // A DM is "unread" only when it has a real message that is newer than the last
  // time we saw it (persisted per-device). On first ever load we baseline every
  // existing conversation as read, so nothing shows until a genuinely new message
  // arrives — this stops empty/old DMs from lingering in the rail.
  const [dmChannels, setDmChannels] = useState<DMChannel[]>([]);
  const [dmSeen, setDmSeen] = useState<Record<string, string>>(loadDmSeen);

  const markDmSeen = useCallback((channel: DMChannel) => {
    const stamp = channel.updatedAt || new Date().toISOString();
    setDmSeen((prev) => {
      if (prev[channel.id] === stamp) return prev;
      const next = { ...prev, [channel.id]: stamp };
      saveDmSeen(next);
      return next;
    });
  }, []);

  const fetchDMs = useCallback(async () => {
    try {
      const res = await fetch("/api/dms");
      if (!res.ok) return;
      const data = await res.json();
      const channels = (data.channels || []) as DMChannel[];
      setDmChannels(channels);
      setDmSeen((prev) => {
        const next = { ...prev };
        let changed = false;
        // First-run baseline: treat all current conversations as already read.
        if (typeof localStorage !== "undefined" && !localStorage.getItem(DM_SEEN_INIT_KEY)) {
          for (const c of channels) {
            next[c.id] = c.updatedAt || new Date().toISOString();
          }
          localStorage.setItem(DM_SEEN_INIT_KEY, "1");
          changed = true;
        }
        // Keep the currently-open DM marked read as new messages land in it.
        const openId = pathname?.startsWith("/dm/") ? pathname.slice(4) : null;
        if (openId) {
          const open = channels.find((c) => c.recipients?.[0]?.id === openId);
          if (open && next[open.id] !== (open.updatedAt || "")) {
            next[open.id] = open.updatedAt || new Date().toISOString();
            changed = true;
          }
        }
        if (changed) saveDmSeen(next);
        return changed ? next : prev;
      });
    } catch {
      /* ignore — rail just won't populate */
    }
  }, [pathname]);

  // usePolling fires immediately on mount (and on tab refocus), so no separate
  // initial-fetch effect is needed.
  usePolling(() => void fetchDMs(), DM_POLL_INTERVAL);

  const unreadDMs = useMemo(() => {
    return dmChannels
      .filter((c) => {
        const recipient = c.recipients?.[0];
        if (!recipient || !c.lastMessageId || !c.updatedAt) return false;
        // Don't flag the DM you're currently reading.
        if (pathname === `/dm/${recipient.id}`) return false;
        const seen = dmSeen[c.id];
        return !seen || new Date(c.updatedAt).getTime() > new Date(seen).getTime();
      })
      .map((c) => ({ channel: c, recipient: c.recipients[0] }));
  }, [dmChannels, dmSeen, pathname]);

  const totalDMUnread = unreadDMs.length;

  // ── handlers ──────────────────────────────────────────────────────────────
  const handleServerClick = (server: Server) => {
    setCurrentServer(server);
    router.push(`/channels/${server.id}`);
  };
  const handleCopyServerId = (serverId: string) => void navigator.clipboard?.writeText(serverId);
  const handleHomeClick = () => { setCurrentServer(null); router.push("/channels/me"); };
  const handleLeaveServer = async (server: Server) => {
    if (!window.confirm(gt("Leave '{name}'? You'll need a new invite to rejoin.", { name: server.name }))) return;
    try {
      await leaveServer(server.id);
      if (currentServer?.id === server.id) { setCurrentServer(null); router.push("/channels/me"); }
    } catch { /* leaveServer surfaces its own errors */ }
  };
  const toggleFolder = (id: string) =>
    setOpenFolders((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  // ── reusable server icon button (plain render fn — no component boundary so
  //     Reorder items don't remount on every parent state change) ─────────────
  const renderServerIcon = (server: Server, inFolder: boolean) => {
    const mentionCount = serverMentionCounts.get(server.id) || 0;
    const muted = isMuted(server.id);
    const hasMention = mentionCount > 0 && !muted;
    // Unread-without-mention: show the Discord-style short white pill.
    const hasUnread = !muted && isServerUnread(server.id);
    const isActive = currentServer?.id === server.id;
    const folderOfServer = folders.find((f) => f.serverIds.includes(server.id));

    return (
      <div
        className="relative"
        onContextMenu={(e) => { e.preventDefault(); setMenuServerId(server.id); }}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <motion.button
              onClick={() => handleServerClick(server)}
              onMouseEnter={() => prefetchServer(server.id)}
              whileTap={{ scale: 0.88 }}
              transition={{ type: "spring", stiffness: 500, damping: 30 }}
              className={cn(
                "relative flex items-center justify-center bg-[var(--bg-sidebar-elevated)] transition-[border-radius] duration-200 group overflow-hidden transform-gpu [backface-visibility:hidden]",
                inFolder ? "w-10 h-10 rounded-[12px] hover:rounded-[10px]" : "w-12 h-12 rounded-[24px] hover:rounded-[16px]",
                isActive && (inFolder ? "rounded-[10px]" : "rounded-[16px]"),
                muted && "opacity-60"
              )}
            >
              {server.icon ? (
                <Avatar className={cn("rounded-none", inFolder ? "w-10 h-10" : "w-12 h-12")}>
                  <AvatarImage src={cdnImage(server.icon)} alt={server.name} draggable={false} />
                  <AvatarFallback className="rounded-none bg-[var(--app-accent)] text-[var(--text-on-accent)]">
                    {server.name.charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
              ) : (
                <span className={cn("font-semibold text-[var(--text-primary)]", inFolder ? "text-sm" : "text-lg")}>
                  {server.name.charAt(0).toUpperCase()}
                </span>
              )}
              {!inFolder && (
                <div
                  className={cn(
                    // Animate a fixed-height bar with a GPU transform (scaleY)
                    // instead of animating `height`, which caused per-frame
                    // reflow and a visible stutter on hover.
                    "absolute left-0 w-1 h-10 bg-[var(--text-primary)] rounded-r-full origin-center transition-transform duration-200 will-change-transform",
                    // Full bar when active; short pill when unread; grows on hover.
                    isActive
                      ? "scale-y-100"
                      : hasUnread
                        ? "scale-y-[0.2] group-hover:scale-y-50"
                        : "scale-y-0 group-hover:scale-y-50"
                  )}
                />
              )}
              {hasMention && !isActive && (
                <span className="absolute bottom-0 right-0 min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full bg-[var(--app-accent)] border-[3px] border-[var(--app-bg)] text-[10px] font-bold text-white leading-none">
                  {mentionCount > 99 ? "99+" : mentionCount}
                </span>
              )}
            </motion.button>
          </TooltipTrigger>
          <TooltipContent side="right" className="bg-[var(--bg-card)] text-[var(--text-primary)] border border-[var(--border-subtle)] p-3 max-w-[260px]">
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-1.5 flex-wrap">
                {server.isPartnered && <ServerBadge type="partnered" size="sm" iconOnly />}
                <span className="font-bold text-sm leading-tight">{server.name}</span>
              </div>
              {server.description && (
                <p className="text-xs text-[var(--text-muted)] line-clamp-2 leading-relaxed">{server.description}</p>
              )}
              <div className="flex items-center gap-3 mt-0.5">
                {server.onlineCount !== undefined && server.onlineCount > 0 && (
                  <span className="flex items-center gap-1 text-xs text-[var(--text-muted)]">
                    <span className="w-2 h-2 rounded-full bg-[#23A55A]" />
                    {server.onlineCount.toLocaleString()} {gt("Online")}
                  </span>
                )}
                {server.memberCount !== undefined && (
                  <span className="flex items-center gap-1 text-xs text-[var(--text-muted)]">
                    <Users className="w-3 h-3" />
                    {server.memberCount.toLocaleString()} {gt("Members")}
                  </span>
                )}
              </div>
            </div>
          </TooltipContent>
        </Tooltip>

        <DropdownMenu
          open={menuServerId === server.id}
          onOpenChange={(o) => setMenuServerId(o ? server.id : null)}
        >
          <DropdownMenuTrigger asChild>
            <span className="absolute inset-0 pointer-events-none" aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent side="right" align="start" className="w-56">
            <DropdownMenuItem disabled={mentionCount === 0} onClick={() => markServerRead(server.id)}>
              <Check className="w-4 h-4" />
              {gt("Mark As Read")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => toggleMute(server.id)}>
              {muted ? <Bell className="w-4 h-4" /> : <BellOff className="w-4 h-4" />}
              {muted ? gt("Unmute Server") : gt("Mute Server")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {/* Folder management */}
            {folderOfServer ? (
              <DropdownMenuItem onClick={() => removeFromFolder(server.id)}>
                <FolderMinus className="w-4 h-4" />
                {gt("Remove from Folder")}
              </DropdownMenuItem>
            ) : (
              <>
                <DropdownMenuItem onClick={() => createFolder(server.id)}>
                  <FolderPlus className="w-4 h-4" />
                  {gt("New Folder")}
                </DropdownMenuItem>
                {folders.length > 0 && (
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                      <FolderIcon className="w-4 h-4" />
                      {gt("Add to Folder")}
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent className="w-48">
                      {folders.map((f) => (
                        <DropdownMenuItem key={f.id} onClick={() => addToFolder(server.id, f.id)}>
                          <span className="w-3 h-3 rounded-full" style={{ backgroundColor: f.color }} />
                          <span className="truncate">{f.name}</span>
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                )}
              </>
            )}
            {onInvitePeople && (
              <DropdownMenuItem onClick={() => onInvitePeople(server.id)}>
                <UserPlus className="w-4 h-4" />
                {gt("Invite People")}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={() => handleCopyServerId(server.id)}>
              <Copy className="w-4 h-4" />
              {gt("Copy Server ID")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={() => void handleLeaveServer(server)}>
              <LogOut className="w-4 h-4" />
              {gt("Leave Server")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    );
  };

  // ── folder tile (plain render fn) ────────────────────────────────────────────
  const renderFolder = (folder: Extract<ServerLayoutEntry, { kind: "folder" }>) => {
    const folderServers = folder.serverIds
      .map((id) => serversById.get(id))
      .filter((s): s is Server => Boolean(s));
    const isOpen = openFolders.has(folder.id);
    const folderMentions = folderServers.reduce((sum, s) => sum + (serverMentionCounts.get(s.id) || 0), 0);
    const menuOpen = menuFolderId === folder.id;
    const setMenuOpen = (o: boolean) => setMenuFolderId(o ? folder.id : null);

    return (
      <div className="flex flex-col items-center gap-2 w-full">
        <div
          className="relative"
          onContextMenu={(e) => { e.preventDefault(); setMenuOpen(true); }}
        >
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => toggleFolder(folder.id)}
                className={cn(
                  "relative flex items-center justify-center w-12 h-12 rounded-[16px] transition-all duration-200 overflow-hidden",
                  isOpen ? "bg-transparent" : "hover:rounded-[12px]"
                )}
                style={!isOpen ? { backgroundColor: `${folder.color}33` } : undefined}
              >
                {isOpen ? (
                  <FolderIcon className="w-6 h-6" style={{ color: folder.color }} />
                ) : (
                  <div className="grid grid-cols-2 gap-0.5 p-1.5 w-full h-full">
                    {folderServers.slice(0, 4).map((s) => (
                      s.icon ? (
                        <img key={s.id} src={cdnImage(s.icon)} alt="" draggable={false} className="w-full h-full object-cover rounded-[4px]" />
                      ) : (
                        <span key={s.id} className="flex items-center justify-center rounded-[4px] bg-[var(--bg-sidebar-elevated)] text-[9px] font-bold text-[var(--text-primary)]">
                          {s.name.charAt(0).toUpperCase()}
                        </span>
                      )
                    ))}
                  </div>
                )}
                {!isOpen && folderMentions > 0 && (
                  <span className="absolute bottom-0 right-0 min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full bg-[var(--app-accent)] border-[3px] border-[var(--app-bg)] text-[10px] font-bold text-white leading-none">
                    {folderMentions > 99 ? "99+" : folderMentions}
                  </span>
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side="right" className="bg-[var(--bg-card)] text-[var(--text-primary)] border border-[var(--border-subtle)]">
              {folder.name}
            </TooltipContent>
          </Tooltip>

          <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
            <DropdownMenuTrigger asChild>
              <span className="absolute inset-0 pointer-events-none" aria-hidden />
            </DropdownMenuTrigger>
            <DropdownMenuContent side="right" align="start" className="w-52">
              <DropdownMenuItem onClick={() => { setMenuOpen(false); setRenamingFolder(folder.id); }}>
                <Pencil className="w-4 h-4" />
                {gt("Rename Folder")}
              </DropdownMenuItem>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <span className="w-3 h-3 rounded-full" style={{ backgroundColor: folder.color }} />
                  {gt("Folder Color")}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="flex flex-wrap gap-1 p-2 w-36">
                  {folderColors.map((c) => (
                    <button
                      key={c}
                      onClick={() => recolorFolder(folder.id, c)}
                      className={cn("w-6 h-6 rounded-full border-2", folder.color === c ? "border-white" : "border-transparent")}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Rename inline input */}
        {renamingFolder === folder.id && (
          <input
            autoFocus
            defaultValue={folder.name}
            onBlur={(e) => { renameFolder(folder.id, e.target.value.trim() || folder.name); setRenamingFolder(null); }}
            onKeyDown={(e) => {
              if (e.key === "Enter") { renameFolder(folder.id, (e.target as HTMLInputElement).value.trim() || folder.name); setRenamingFolder(null); }
              if (e.key === "Escape") setRenamingFolder(null);
            }}
            className="w-16 text-[10px] text-center bg-[var(--bg-card)] text-[var(--text-primary)] border border-[var(--border-subtle)] rounded px-1 py-0.5 outline-none"
          />
        )}

        {/* Expanded servers */}
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            className="flex flex-col items-center gap-2 w-full rounded-[12px] py-2"
            style={{ backgroundColor: `${folder.color}1A` }}
          >
            {folderServers.map((s) => {
              const sKey = `s:${s.id}`;
              const isDraggingOut = draggingKey === sKey;
              return (
                <div
                  key={s.id}
                  draggable
                  onDragStart={(e) => { e.stopPropagation(); setDraggingKey(sKey); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", sKey); }}
                  onDragEnd={clearDrag}
                  className={cn("transition-opacity", isDraggingOut && "opacity-40")}
                >
                  {renderServerIcon(s, true)}
                </div>
              );
            })}
          </motion.div>
        )}
      </div>
    );
  };

  return (
    <TooltipProvider delayDuration={0}>
      <div className="flex flex-col items-center w-[72px] h-full bg-[var(--app-bg)] py-3 gap-2 border-r border-[var(--app-border)]">
        {/* Home Button (DMs / message inbox) */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={handleHomeClick}
              className={cn(
                "relative flex items-center justify-center w-12 h-12 rounded-[24px] bg-[var(--bg-sidebar-elevated)] transition-all duration-200 hover:rounded-[16px] hover:bg-[var(--app-accent)] group",
                !currentServer && "rounded-[16px] bg-[var(--app-accent)]"
              )}
            >
              <MessageSquare className="w-7 h-7 text-[var(--text-secondary)] group-hover:text-[var(--text-on-accent)] transition-colors" />
              <div
                className={cn(
                  "absolute left-0 w-1 bg-[var(--text-primary)] rounded-r-full transition-all duration-200",
                  !currentServer ? "h-10" : "h-0 group-hover:h-5"
                )}
              />
              {/* DM unread badge on the inbox icon */}
              {totalDMUnread > 0 && (
                <span className="absolute -bottom-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full bg-[var(--app-accent)] border-[3px] border-[var(--app-bg)] text-[10px] font-bold text-white leading-none">
                  {totalDMUnread > 99 ? "99+" : totalDMUnread}
                </span>
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent side="right" className="bg-[var(--bg-card)] text-[var(--text-primary)] border border-[var(--border-subtle)]">
            {gt("Direct Messages")}
          </TooltipContent>
        </Tooltip>

        {/* Unread DMs — show only the most recent sender; the rest collapse into
            a "+N" pill that jumps to the DM home. */}
        {unreadDMs.length > 0 && (
          <div className="flex flex-col items-center gap-2 w-full">
            {(() => {
              const { channel, recipient } = unreadDMs[0];
              return (
                <Tooltip key={channel.id}>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => { markDmSeen(channel); router.push(`/dm/${recipient.id}`); }}
                      className="relative flex items-center justify-center w-12 h-12 rounded-[24px] transition-[border-radius] duration-200 hover:rounded-[16px] group overflow-hidden"
                    >
                      <Avatar className="w-12 h-12">
                        <AvatarImage src={cdnImage(recipient.avatar)} alt={recipient.displayName || recipient.username} />
                        <AvatarFallback className="bg-[var(--app-accent)] text-[var(--text-on-accent)]">
                          {(recipient.displayName || recipient.username).charAt(0).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div className="absolute left-0 w-1 h-2.5 bg-[var(--text-primary)] rounded-r-full group-hover:h-5 transition-all duration-200" />
                      <span className="absolute bottom-0 right-0 w-3.5 h-3.5 flex items-center justify-center rounded-full bg-[var(--app-accent)] border-[3px] border-[var(--app-bg)]" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right" className="bg-[var(--bg-card)] text-[var(--text-primary)] border border-[var(--border-subtle)]">
                    {recipient.displayName || recipient.username}
                  </TooltipContent>
                </Tooltip>
              );
            })()}

            {unreadDMs.length > 1 && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => router.push("/channels/me")}
                    className="flex items-center justify-center w-12 h-12 rounded-[24px] bg-[var(--bg-sidebar-elevated)] transition-[border-radius] duration-200 hover:rounded-[16px] hover:bg-[var(--app-accent)] text-[var(--text-primary)] text-sm font-bold"
                  >
                    +{unreadDMs.length - 1}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right" className="bg-[var(--bg-card)] text-[var(--text-primary)] border border-[var(--border-subtle)]">
                  {gt("{count} more unread DMs", { count: unreadDMs.length - 1 })}
                </TooltipContent>
              </Tooltip>
            )}
          </div>
        )}

        <Separator className="w-8 h-0.5 bg-[var(--app-border)] rounded-full" />

        {/* Server List — drag a server onto another to make a folder, or between
            items to reorder. Dropping on the empty area below moves to end. */}
        <div
          className="flex-1 w-full overflow-x-hidden overflow-y-auto server-rail-scroll py-0.5"
          onDragOver={(e) => { if (draggingKey) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; } }}
          onDrop={(e) => { if (draggingKey && !dropTarget) { e.preventDefault(); handleDropOnBottom(); } }}
        >
          <div className="flex flex-col items-center gap-2">
            {entries.map((entry) => {
              const key = entryKey(entry);
              const isDragging = draggingKey === key;
              const isDropInto = dropTarget?.key === key && dropTarget.mode === "into";
              const showBefore = dropTarget?.key === key && dropTarget.mode === "before";
              const showAfter = dropTarget?.key === key && dropTarget.mode === "after";
              return (
                <div
                  key={key}
                  draggable
                  onDragStart={(e) => { setDraggingKey(key); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", key); }}
                  onDragEnd={clearDrag}
                  onDragOver={(e) => handleDragOver(e, entry)}
                  onDrop={(e) => { e.preventDefault(); e.stopPropagation(); applyDrop(entry); }}
                  className={cn(
                    "relative w-full flex justify-center transition-opacity duration-150",
                    isDragging && "opacity-40"
                  )}
                >
                  {/* reorder position indicators */}
                  {showBefore && <span className="absolute -top-1 left-1/2 -translate-x-1/2 w-8 h-1 rounded-full bg-[var(--app-accent)]" />}
                  {showAfter && <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-8 h-1 rounded-full bg-[var(--app-accent)]" />}
                  <div className={cn("rounded-[16px] transition-shadow", isDropInto && "ring-2 ring-[var(--app-accent)] ring-offset-2 ring-offset-[var(--app-bg)]")}>
                    {entry.kind === "server"
                      ? (serversById.has(entry.id) ? renderServerIcon(serversById.get(entry.id)!, false) : null)
                      : renderFolder(entry)}
                  </div>
                </div>
              );
            })}
            {/* Bottom drop zone — visible only while dragging */}
            {draggingKey && (
              <div
                className="w-full min-h-[24px] rounded transition-colors"
                onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }}
                onDrop={(e) => { e.preventDefault(); e.stopPropagation(); handleDropOnBottom(); }}
              />
            )}
          </div>
        </div>

        <Separator className="w-8 h-0.5 bg-[var(--app-border)] rounded-full" />

        {/* Add Server */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={onCreateServer}
              className="flex items-center justify-center w-12 h-12 rounded-[24px] bg-[var(--bg-sidebar-elevated)] transition-all duration-200 hover:rounded-[16px] hover:bg-[var(--app-accent)] group"
            >
              <Plus className="w-6 h-6 text-[var(--app-accent)] group-hover:text-[var(--text-on-accent)] transition-colors" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right" className="bg-[var(--bg-card)] text-[var(--text-primary)] border border-[var(--border-subtle)]">
            {gt("Add a Server")}
          </TooltipContent>
        </Tooltip>

        {/* Explore Servers */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => router.push("/channels/explore")}
              className="flex items-center justify-center w-12 h-12 rounded-[24px] bg-[var(--bg-sidebar-elevated)] transition-all duration-200 hover:rounded-[16px] hover:bg-[var(--app-accent)] group"
            >
              <Compass className="w-6 h-6 text-[var(--app-accent)] group-hover:text-[var(--text-on-accent)] transition-colors" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right" className="bg-[var(--bg-card)] text-[var(--text-primary)] border border-[var(--border-subtle)]">
            {gt("Explore Discoverable Servers")}
          </TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
}

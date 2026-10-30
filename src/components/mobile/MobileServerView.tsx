"use client";

import { useState, useMemo, useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { useServer } from "@/contexts/ServerContext";
import { useUnread } from "@/contexts/UnreadContext";
import {
  Hash,
  Volume2,
  ChevronDown,
  ChevronRight,
  Search,
  UserPlus,
  Megaphone,
  MessagesSquare,
  Radio,
  AlertTriangle,
  X,
  MoreHorizontal,
} from "lucide-react";
import { cn, cdnImage } from "@/lib/utils";
import { voiceService, type VoiceParticipant } from "@/lib/services/voiceService";
import { useGT } from "gt-next";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";
import { usePolling } from "@/hooks/usePolling";
import { PullIndicator } from "@/components/mobile/PullIndicator";
import { MountWhenOpened } from "@/components/ui/MountWhenOpened";
import { VoiceChannelMembers } from "@/components/voice/VoiceChannelMembers";
import { filterMobileChannelGroups, groupMobileChannels } from "@/lib/mobile/channelGroups";
import { useLongPress } from "./useLongPress";
import { Bone } from "./Bone";
import { ServerEventsEntry } from "@/components/events/ServerEventsEntry";
import { ServerGuideEntry } from "@/components/server/community/ServerGuideEntry";
import { ServerPageEntries } from "@/components/server/community/ServerPageEntries";
import { prefetchChannelMessages } from "@/hooks/useChatSession";
import { useMobileShell } from "./MobileShellContext";

const MobileServerSheet = dynamic(() => import("./MobileServerSheet").then((m) => m.MobileServerSheet), { ssr: false });
const MobileChannelSheet = dynamic(() => import("./MobileChannelSheet").then((m) => m.MobileChannelSheet), { ssr: false });

type ServerChannel = ReturnType<typeof useServer>["channels"][number];

/** Placeholder rows while a server's channel list loads (no spinner). */
function ChannelListSkeleton() {
  return (
    <div className="space-y-5 px-3 pt-3" aria-hidden="true">
      {[5, 3, 4].map((rows, i) => (
        <div key={i} className="space-y-2">
          <Bone className="ml-1 h-3 w-24" />
          {Array.from({ length: rows }).map((_, j) => (
            <div key={j} className="flex items-center gap-3 px-2 py-1.5">
              <Bone className="h-5 w-5 rounded" />
              <Bone className="h-4" style={{ width: `${45 + ((i * 7 + j * 13) % 40)}%` }} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function ChannelIcon({ type, nsfw }: { type: string; nsfw?: boolean }) {
  const cls = "h-5 w-5 text-[var(--text-muted)]";
  const icon =
    type === "voice" ? <Volume2 className={cls} /> :
    type === "stage" ? <Radio className={cls} /> :
    type === "announcement" ? <Megaphone className={cls} /> :
    type === "forum" ? <MessagesSquare className={cls} /> :
    <Hash className={cls} />;
  return (
    <span className="relative flex h-5 w-5 shrink-0 items-center justify-center">
      {icon}
      {nsfw && <AlertTriangle className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 text-red-400" />}
    </span>
  );
}

/**
 * Phone channel list for the selected server (shown beside the server rail),
 * Discord-mobile style: the server name opens the server sheet, channel rows
 * are dense with unread/mention state, voice channels list who's in them, and
 * a long-press opens the channel menu.
 */
export function MobileServerView() {
  const router = useRouter();
  const shell = useMobileShell();
  const gt = useGT();
  const { currentServer, channels, channelsServerId, setCurrentChannel, fetchChannels, fetchServers } = useServer();
  // Re-render on voice connect/leave so the active voice channel highlight is live.
  const voiceRoomId = useSyncExternalStore(
    (onChange) => voiceService.subscribe(() => onChange()),
    () => (voiceService.connected ? voiceService.currentRoomId : null),
    () => null,
  );
  const { isChannelUnread, getMentionCount, isChannelMuted } = useUnread();
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(() => new Set());
  const [searchQuery, setSearchQuery] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showServerSheet, setShowServerSheet] = useState(false);
  const [sheetChannel, setSheetChannel] = useState<ServerChannel | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const channelPress = useLongPress<ServerChannel>(setSheetChannel);

  const serverId = currentServer?.id ?? null;
  const channelsReady = !!serverId && channelsServerId === serverId;

  const groups = useMemo(() => groupMobileChannels(channelsReady ? channels : []), [channels, channelsReady]);
  const filteredGroups = useMemo(() => filterMobileChannelGroups(groups, searchQuery), [groups, searchQuery]);

  // ── Who's in each voice channel ──────────────────────────────────────────
  const voiceChannelIds = useMemo(
    () => (channelsReady ? channels.filter((c) => c.type === "voice").map((c) => c.id) : []),
    [channels, channelsReady],
  );
  const [externalVoice, setExternalVoice] = useState<Map<string, VoiceParticipant[]>>(() => new Map());
  const [ownVoice, setOwnVoice] = useState<VoiceParticipant[]>(() => voiceService.currentParticipants);
  useEffect(
    () =>
      voiceService.subscribe(() => {
        setOwnVoice(voiceService.connected ? voiceService.currentParticipants : []);
      }),
    [],
  );
  const fetchVoiceStates = useCallback(async () => {
    const rooms = voiceChannelIds.map((id) => `channel-${id}`).filter((r) => r !== voiceService.currentRoomId);
    if (rooms.length === 0) {
      setExternalVoice(new Map());
      return;
    }
    try {
      const res = await fetch(`/api/voice/states?rooms=${encodeURIComponent(rooms.join(","))}`);
      if (!res.ok) return;
      const data = (await res.json()) as { states?: Record<string, VoiceParticipant[]> };
      const next = new Map<string, VoiceParticipant[]>();
      for (const [roomId, list] of Object.entries(data.states ?? {})) {
        if (list?.length) next.set(roomId.replace(/^channel-/, ""), list);
      }
      setExternalVoice(next);
    } catch {
      /* best effort */
    }
  }, [voiceChannelIds]);
  usePolling(() => void fetchVoiceStates(), 8000, voiceChannelIds.length > 0, voiceChannelIds.join(","));

  const handleRefresh = useCallback(async () => {
    if (isRefreshing || !serverId) return;
    setIsRefreshing(true);
    try {
      await Promise.all([fetchChannels(serverId), fetchServers(), fetchVoiceStates()]);
    } finally {
      setIsRefreshing(false);
    }
  }, [isRefreshing, serverId, fetchChannels, fetchServers, fetchVoiceStates]);
  const { pullDistance, pullHandlers } = usePullToRefresh(scrollContainerRef, handleRefresh);

  if (!currentServer) return null;

  const toggleCategory = (categoryId: string) => {
    setCollapsedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(categoryId)) next.delete(categoryId);
      else next.add(categoryId);
      return next;
    });
  };

  const handleChannelClick = (channel: ServerChannel) => {
    if (channelPress.wasLongPress()) return;
    // Voice channels open their call view (participants + Join), like text
    // channels; joining happens from that screen.
    const href = `/channels/${currentServer.id}/${channel.id}`;
    if (shell) {
      // Same page: the chat slides in and paints from the message cache.
      shell.open(href, () => setCurrentChannel(channel));
      return;
    }
    setCurrentChannel(channel);
    router.push(href);
  };
  /** Warm the message cache as the finger lands, before the tap completes. */
  const warmChannel = (channel: ServerChannel) => {
    if (channel.type === "voice" || channel.type === "stage" || channel.type === "category") return;
    void prefetchChannelMessages(`/api/channels/${channel.id}`);
  };

  const banner = currentServer.banner ? cdnImage(currentServer.banner) : null;

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col bg-[var(--bg-app)]">
      {/* Server header: optional banner, then the name (opens the server sheet) */}
      <div className="relative flex-shrink-0">
        {banner ? (
          <div className="relative h-28 bg-cover bg-center" style={{ backgroundImage: `url(${banner})` }}>
            <div className="absolute inset-0 bg-gradient-to-b from-black/30 to-transparent" />
          </div>
        ) : (
          <div className="pt-safe" />
        )}
        <div className={cn("flex items-center gap-1 px-3", banner ? "pt-2" : "pt-3")}>
          <button
            type="button"
            onClick={() => setShowServerSheet(true)}
            className="flex min-w-0 flex-1 touch-manipulation items-center gap-1 rounded-lg py-1.5 pl-1 text-left active:opacity-70"
          >
            <h1 className="truncate text-[19px] font-bold leading-tight text-[var(--text-primary)]">{currentServer.name}</h1>
            <ChevronRight className="h-4 w-4 shrink-0 text-[var(--text-muted)]" />
          </button>
          <button
            type="button"
            onClick={() => setShowServerSheet(true)}
            aria-label={gt("Server menu")}
            className="flex h-11 w-11 -mr-1 touch-manipulation items-center justify-center rounded-full text-[var(--text-secondary)] active:bg-[var(--bg-hover)]"
          >
            <MoreHorizontal className="h-5 w-5" />
          </button>
        </div>
        {typeof currentServer.memberCount === "number" && (
          <p className="px-4 pb-1 text-xs text-[var(--text-muted)]">
            {gt("{count} Members", { count: currentServer.memberCount })}
          </p>
        )}

        {/* Search + invite */}
        <div className="flex items-center gap-2 px-3 pb-2.5 pt-1.5">
          {showSearch ? (
            <div className="flex h-10 flex-1 items-center gap-2 rounded-full bg-[var(--bg-card)] px-3">
              <Search className="h-4 w-4 shrink-0 text-[var(--text-muted)]" />
              <input
                type="text"
                placeholder={gt("Search channels...")}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                autoFocus
                enterKeyHint="search"
                className="min-w-0 flex-1 bg-transparent text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none"
              />
              <button
                type="button"
                onClick={() => {
                  setShowSearch(false);
                  setSearchQuery("");
                }}
                aria-label={gt("Close search")}
                className="-mr-1 flex h-7 w-7 items-center justify-center rounded-full text-[var(--text-muted)] active:bg-[var(--bg-hover)]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowSearch(true)}
              className="flex h-10 flex-1 touch-manipulation items-center gap-2 rounded-full bg-[var(--bg-card)] px-3 text-[var(--text-muted)] active:bg-[var(--bg-hover)]"
            >
              <Search className="h-4 w-4" />
              <span className="text-sm">{gt("Search")}</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent("openInviteDialog", { detail: { serverId: currentServer.id } }))}
            aria-label={gt("Invite people")}
            className="flex h-10 w-10 shrink-0 touch-manipulation items-center justify-center rounded-full bg-[var(--bg-card)] text-[var(--text-secondary)] active:bg-[var(--bg-hover)]"
          >
            <UserPlus className="h-[18px] w-[18px]" />
          </button>
        </div>
      </div>

      {/* Channel List. The guide, events and page links scroll with the
          channels so a short phone keeps the list, instead of pinning those
          rows and leaving the channels the leftover half of the screen. */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto overscroll-contain border-t border-[var(--border-subtle)]"
        {...pullHandlers}
      >
        <PullIndicator distance={pullDistance} refreshing={isRefreshing} />
        {!searchQuery && (
          <div>
            <ServerGuideEntry key={`guide:${currentServer.id}`} serverId={currentServer.id} variant="mobile" />
            <ServerEventsEntry key={currentServer.id} serverId={currentServer.id} variant="mobile" />
            <ServerPageEntries key={`pages:${currentServer.id}`} serverId={currentServer.id} variant="mobile" />
          </div>
        )}
        <div className="px-2 pt-1" style={{ paddingBottom: "calc(var(--mobile-content-pb) + 4.5rem)" }}>
          {!channelsReady ? (
            <ChannelListSkeleton />
          ) : filteredGroups.length === 0 ? (
            <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
              <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--bg-card)]">
                <Search className="h-7 w-7 text-[var(--text-muted)]" />
              </div>
              <h3 className="mb-1 font-semibold text-[var(--text-primary)]">
                {searchQuery ? gt("No channels found") : gt("No channels yet")}
              </h3>
              {searchQuery && <p className="text-sm text-[var(--text-muted)]">{gt("Try a different search term")}</p>}
            </div>
          ) : (
            filteredGroups.map((group) => {
              const key = group.id ?? "uncategorized";
              const collapsed = !searchQuery && collapsedCategories.has(key);
              return (
                <div key={key} className="mb-1">
                  {group.id !== null && (
                    <button
                      type="button"
                      onClick={() => toggleCategory(key)}
                      className="flex w-full touch-manipulation items-center gap-1 px-1.5 pb-1 pt-4 text-left text-xs font-bold uppercase tracking-wide text-[var(--text-muted)] active:text-[var(--text-secondary)]"
                    >
                      <ChevronDown className={cn("h-3 w-3 shrink-0 transition-transform duration-150", collapsed && "-rotate-90")} />
                      <span className="truncate">{group.name}</span>
                    </button>
                  )}

                  {group.channels.map((channel) => {
                    const isVoice = channel.type === "voice" || channel.type === "stage";
                    const inThisVoice = isVoice && voiceRoomId === `channel-${channel.id}`;
                    const unread = !isVoice && isChannelUnread(channel.id);
                    const mentions = isVoice ? 0 : getMentionCount(channel.id);
                    const muted = !isVoice && isChannelMuted(channel.id);
                    const participants = isVoice
                      ? inThisVoice
                        ? ownVoice
                        : externalVoice.get(channel.id) ?? []
                      : [];
                    // A collapsed category still shows unread channels and voice channels in use.
                    if (collapsed && !unread && !mentions && participants.length === 0) return null;
                    return (
                      <div key={channel.id}>
                        <button
                          type="button"
                          {...channelPress.bind(channel)}
                          onTouchStartCapture={() => warmChannel(channel)}
                          onPointerEnter={() => warmChannel(channel)}
                          onClick={() => handleChannelClick(channel)}
                          className={cn(
                            "relative flex h-10 w-full touch-manipulation select-none items-center gap-2.5 rounded-md px-2 text-left transition-colors duration-100",
                            "active:bg-[var(--bg-hover)]",
                            inThisVoice
                              ? "bg-green-500/10 text-green-500"
                              : unread || mentions
                                ? "text-[var(--text-primary)]"
                                : muted
                                  ? "text-[var(--text-muted)] opacity-60"
                                  : "text-[var(--text-secondary)]",
                          )}
                        >
                          {unread && !muted && (
                            <span className="absolute -left-2 top-1/2 h-2 w-1 -translate-y-1/2 rounded-r-full bg-[var(--text-primary)]" />
                          )}
                          <ChannelIcon type={channel.type} nsfw={channel.isNsfw} />
                          <span className={cn("min-w-0 flex-1 truncate text-[16px]", unread || mentions ? "font-semibold" : "font-medium")}>
                            {channel.name}
                          </span>
                          {mentions > 0 && (
                            <span className="flex h-5 min-w-[20px] shrink-0 items-center justify-center rounded-full bg-red-500 px-1.5 text-xs font-bold text-white">
                              {mentions > 99 ? "99+" : mentions}
                            </span>
                          )}
                          {isVoice && participants.length > 0 && (
                            <span className="shrink-0 text-xs font-medium text-[var(--text-muted)]">{participants.length}</span>
                          )}
                        </button>
                        {isVoice && participants.length > 0 && (
                          <VoiceChannelMembers
                            participants={participants}
                            active={inThisVoice}
                            serverId={currentServer.id}
                            channelId={channel.id}
                            canMove={false}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>
      </div>

      <MountWhenOpened open={showServerSheet}>
        {showServerSheet && <MobileServerSheet server={currentServer} onClose={() => setShowServerSheet(false)} />}
      </MountWhenOpened>
      <MountWhenOpened open={!!sheetChannel}>
        {sheetChannel && (
          <MobileChannelSheet channel={sheetChannel} serverId={currentServer.id} onClose={() => setSheetChannel(null)} />
        )}
      </MountWhenOpened>
    </div>
  );
}

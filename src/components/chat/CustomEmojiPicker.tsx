"use client";

import { useState, useRef, useCallback, useEffect, useMemo, useDeferredValue, memo } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { 
  Search, Clock, Star, Smile, Users, Dog, Apple, Gamepad2, 
  Plane, Lightbulb, Heart, Flag, ImageIcon, Sticker, X, Plus, Copy, StarOff
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn, cdnImage } from "@/lib/utils";
import { EMOJI_CATEGORIES, EMOJI_TO_NAME, type EmojiCategory } from "@/lib/constants/emojis";
import { GifPicker } from "@/components/chat/GifPicker";
import { useGT } from "gt-next";
import { useEmojiFavorites } from "@/hooks/useEmojiFavorites";
import { toast } from "sonner";

interface CustomEmoji {
  id: string;
  name: string;
  url: string;
  serverId?: string;
  serverName?: string;
  serverIcon?: string;
  animated?: boolean;
}

interface UnifiedEmojiFavorite {
  emoji: string;
  name: string;
  customEmojiId?: string;
  url?: string;
}

interface StickerItem {
  id: string;
  name: string;
  description?: string;
  tags?: string[];
  imageUrl: string;
  serverId?: string;
  serverName?: string;
}

interface EmojiPickerProps {
  onEmojiSelect: (emoji: string, isCustom?: boolean, emojiData?: CustomEmoji) => void;
  onGifSelect?: (gifUrl: string) => void;
  onStickerSelect?: (sticker: StickerItem) => void;
  serverEmojis?: CustomEmoji[];
  recentEmojis?: string[];
  favoriteEmojis?: string[];
  serverName?: string;
  className?: string;
  allowServerEmojisInDMs?: boolean;
  availableServerEmojis?: CustomEmoji[]; // All server emojis the user has access to
  allowServerStickersInDMs?: boolean;
  availableServerStickers?: StickerItem[]; // All server stickers the user has access to
  serverId?: string;
  initialTab?: TabType;
}

// Category icons using Lucide React icons
const CATEGORY_ICONS: { id: string; icon: React.ElementType; label: string }[] = [
  { id: "recent", icon: Clock, label: "Recently Used" },
  { id: "favorites", icon: Star, label: "Favorites" },
  { id: "smileys", icon: Smile, label: "Smileys & Emotion" },
  { id: "people", icon: Users, label: "People & Body" },
  { id: "animals", icon: Dog, label: "Animals & Nature" },
  { id: "food", icon: Apple, label: "Food & Drink" },
  { id: "activities", icon: Gamepad2, label: "Activities" },
  { id: "travel", icon: Plane, label: "Travel & Places" },
  { id: "objects", icon: Lightbulb, label: "Objects" },
  { id: "symbols", icon: Heart, label: "Symbols" },
  { id: "flags", icon: Flag, label: "Flags" },
];

type GTFunc = ReturnType<typeof useGT>;

function emojiCategoryLabel(id: string, gt: GTFunc): string {
  switch (id) {
    case 'recent': return gt('Recently Used');
    case 'favorites': return gt('Favorites');
    case 'smileys': return gt('Smileys & Emotion');
    case 'people': return gt('People & Body');
    case 'animals': return gt('Animals & Nature');
    case 'food': return gt('Food & Drink');
    case 'activities': return gt('Activities');
    case 'travel': return gt('Travel & Places');
    case 'objects': return gt('Objects');
    case 'symbols': return gt('Symbols');
    case 'flags': return gt('Flags');
    default: return id;
  }
}

type TabType = "gifs" | "stickers" | "emoji";

// Convert emoji to twemoji URL directly - much faster than parsing HTML
function getEmojiUrl(emoji: string): string {
  const codePoints = [...emoji]
    .map(char => char.codePointAt(0)?.toString(16))
    .filter(Boolean)
    .join('-');
  return `https://cdn.jsdelivr.net/gh/jdecked/twemoji@17.0.2/assets/svg/${codePoints}.svg`;
}

// Memoized emoji button component - only re-renders when emoji changes.
// Always renders the twemoji SVG so the picker matches how emoji look in chat.
// The speed win comes from LazyEmojiSection (below), which only mounts a
// section's buttons once it nears the viewport, plus loading="lazy" so images
// aren't fetched until visible — not from swapping the artwork.
const EmojiButton = memo(function EmojiButton({
  emoji,
  onClick,
  onContextMenu,
}: {
  emoji: string;
  onClick: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      onClick={onClick}
      onContextMenu={onContextMenu}
      className="w-10 h-10 flex items-center justify-center hover:bg-[#2a2a40] rounded-lg transition-colors"
    >
      <img
        src={cdnImage(getEmojiUrl(emoji))}
        alt={emoji}
        className="w-7 h-7"
        loading="lazy"
        decoding="async"
      />
    </button>
  );
});

// Lazily mounts a heavy emoji section only when it scrolls near the viewport.
// Off-screen sections render nothing but reserve their scroll height, so the
// picker opens instantly and stays smooth no matter how many emoji exist —
// while still rendering real twemoji images once a section comes into view.
const LazyEmojiSection = memo(function LazyEmojiSection({
  estimatedHeight,
  scrollRef,
  setRef,
  children,
}: {
  estimatedHeight: number;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  setRef: (el: HTMLDivElement | null) => void;
  children: React.ReactNode;
}) {
  const [visible, setVisible] = useState(false);
  const localRef = useRef<HTMLDivElement | null>(null);

  const assignRef = useCallback((el: HTMLDivElement | null) => {
    localRef.current = el;
    setRef(el);
  }, [setRef]);

  useEffect(() => {
    if (visible) return;
    const el = localRef.current;
    const root = scrollRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      // rootMargin pre-mounts sections just before they reach the viewport so
      // scrolling never reveals an empty placeholder.
      { root: root ?? null, rootMargin: "400px 0px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [scrollRef, visible]);

  return (
    <div ref={assignRef} style={visible ? undefined : { minHeight: estimatedHeight }}>
      {visible ? children : null}
    </div>
  );
});

// Memoized custom emoji button
const CustomEmojiButton = memo(function CustomEmojiButton({
  emoji, 
  onClick,
  onContextMenu,
}: { 
  emoji: CustomEmoji; 
  onClick: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      onClick={onClick}
      onContextMenu={onContextMenu}
      className="w-10 h-10 flex items-center justify-center hover:bg-[#2a2a40] rounded-lg transition-colors"
      title={`:${emoji.name}:${emoji.serverName ? ` from ${emoji.serverName}` : ''}`}
    >
      <img
        src={cdnImage(emoji.url)}
        alt={emoji.name}
        className="w-7 h-7 object-contain"
        loading="lazy"
        decoding="async"
      />
    </button>
  );
});

const RECENT_EMOJIS_KEY = "serika-recent-emojis";

type RecentEmojiEntry =
  | { kind: "unicode"; emoji: string }
  | { kind: "custom"; id: string; name: string; url: string; animated?: boolean };

// Stable default values: inline `= []` defaults create a new array identity
// on every render, which turns any effect depending on them into an infinite
// setState loop (this crashed the reaction picker).
const EMPTY_CUSTOM_EMOJIS: CustomEmoji[] = [];
const EMPTY_STRINGS: string[] = [];
const EMPTY_STICKERS: StickerItem[] = [];

export function CustomEmojiPicker({
  onEmojiSelect,
  onGifSelect,
  onStickerSelect,
  serverEmojis = EMPTY_CUSTOM_EMOJIS,
  recentEmojis = EMPTY_STRINGS,
  favoriteEmojis = EMPTY_STRINGS,
  serverName = "Server",
  className,
  allowServerEmojisInDMs = false,
  availableServerEmojis = EMPTY_CUSTOM_EMOJIS,
  allowServerStickersInDMs = false,
  availableServerStickers = EMPTY_STICKERS,
  serverId,
  initialTab = "emoji",
}: EmojiPickerProps) {
  const gt = useGT();
  const router = useRouter();
  const { favorites: emojiFavs, isFavorite: isEmojiFavorite, toggleFavorite: toggleEmojiFavorite, isReady: favReady } = useEmojiFavorites();
  const [search, setSearch] = useState("");
  // Keep typing responsive: filtering runs against the deferred value so
  // keystrokes never block on re-filtering thousands of emojis.
  const deferredSearch = useDeferredValue(search);
  const [activeTab, setActiveTab] = useState<TabType>(initialTab);
  const [recentEntries, setRecentEntries] = useState<RecentEmojiEntry[]>([]);

  // Context menu state for right-click on emojis
  const [ctxMenu, setCtxMenu] = useState<{
    x: number;
    y: number;
    emoji: string;
    name?: string;
    customEmojiId?: string;
    url?: string;
  } | null>(null);

  // Close context menu on any click elsewhere or Escape
  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    const closeOnEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setCtxMenu(null);
      }
    };
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", closeOnEsc, { capture: true });
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", closeOnEsc, { capture: true } as EventListenerOptions);
    };
  }, [ctxMenu]);

  const handleEmojiContextMenu = useCallback(
    (e: React.MouseEvent, emoji: string, emojiData?: CustomEmoji) => {
      e.preventDefault();
      e.stopPropagation();
      const name = emojiData ? emojiData.name : EMOJI_TO_NAME[emoji];
      setCtxMenu({
        x: e.clientX,
        y: e.clientY,
        emoji,
        name,
        customEmojiId: emojiData?.id,
        url: emojiData?.url,
      });
    },
    []
  );

  const handleCopyEmojiId = useCallback(() => {
    if (!ctxMenu) return;
    const id = ctxMenu.customEmojiId || ctxMenu.emoji;
    navigator.clipboard?.writeText(id);
    toast.success(gt("Copied {id}", { id }));
    setCtxMenu(null);
  }, [ctxMenu, gt]);

  const handleToggleFav = useCallback(() => {
    if (!ctxMenu) return;
    toggleEmojiFavorite({
      emoji: ctxMenu.emoji,
      name: ctxMenu.name,
      customEmojiId: ctxMenu.customEmojiId,
      url: ctxMenu.url,
    });
    setCtxMenu(null);
  }, [ctxMenu, toggleEmojiFavorite]);

  // Load persisted recently-used emojis once
  useEffect(() => {
    try {
      const raw = localStorage.getItem(RECENT_EMOJIS_KEY);
      if (raw) setRecentEntries(JSON.parse(raw) as RecentEmojiEntry[]);
    } catch { /* corrupt/unavailable storage */ }
  }, []);
  const [stickers, setStickers] = useState<StickerItem[]>([]);
  const [isLoadingStickers, setIsLoadingStickers] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const [activeSection, setActiveSection] = useState("recent");
  // Sticker sidebar state
  const stickerScrollRef = useRef<HTMLDivElement>(null);
  const stickerSidebarRef = useRef<HTMLDivElement>(null);
  const stickerSectionRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const [activeStickerSection, setActiveStickerSection] = useState("");

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  // Combined emojis - use all server emojis user has access to (cross-server)
  const allCustomEmojis = useMemo(() => {
    if (availableServerEmojis.length > 0) {
      // Merge: show all available server emojis, but prioritize current server's.
      // Backfill serverName on current-server entries from the cross-server
      // list so per-server grouping labels every emoji correctly.
      const nameById = new Map(
        availableServerEmojis
          .filter((e) => e.serverName)
          .map((e) => [e.id, e.serverName as string])
      );
      const iconById = new Map(
        availableServerEmojis
          .filter((e) => e.serverIcon)
          .map((e) => [e.id, e.serverIcon as string])
      );
      const currentServerIds = new Set(serverEmojis.map(e => e.id));
      const enrichedCurrent = serverEmojis.map((e) =>
        e.serverName ? e : { ...e, serverName: nameById.get(e.id), serverIcon: e.serverIcon ?? iconById.get(e.id) }
      );
      const others = availableServerEmojis.filter(e => !currentServerIds.has(e.id));
      return [...enrichedCurrent, ...others];
    }
    return serverEmojis;
  }, [availableServerEmojis, serverEmojis]);

  // Filter emojis based on search — uses shortcode names for keyword search
  const filteredCategories = useMemo(() => {
    if (!deferredSearch.trim()) return EMOJI_CATEGORIES;

    const query = deferredSearch.toLowerCase();
    return EMOJI_CATEGORIES.map(category => ({
      ...category,
      emojis: category.emojis.filter(emoji => {
        const name = EMOJI_TO_NAME[emoji];
        return name && name.includes(query);
      }),
    })).filter(category => category.emojis.length > 0);
  }, [deferredSearch]);

  // Filter custom emojis
  const filteredCustomEmojis = useMemo(() => {
    if (!deferredSearch.trim()) return allCustomEmojis;
    const query = deferredSearch.toLowerCase();
    return allCustomEmojis.filter(emoji =>
      emoji.name.toLowerCase().includes(query)
    );
  }, [deferredSearch, allCustomEmojis]);

  // Group custom emojis by their server (current server first, since
  // allCustomEmojis puts the current server's emojis before the others)
  const groupedCustomEmojis = useMemo(() => {
    const groups: Array<{ server: string; serverId?: string; serverIcon?: string; emojis: CustomEmoji[] }> = [];
    const indexByServer = new Map<string, number>();
    for (const emoji of filteredCustomEmojis) {
      const server = emoji.serverName || serverName;
      let index = indexByServer.get(server);
      if (index === undefined) {
        index = groups.length;
        indexByServer.set(server, index);
        groups.push({ server, serverId: emoji.serverId, serverIcon: emoji.serverIcon, emojis: [] });
      }
      groups[index].emojis.push(emoji);
    }
    return groups;
  }, [filteredCustomEmojis, serverName]);

  // Filter recent/favorites — persisted entries first, then any prop-provided
  const filteredRecent = useMemo(() => {
    const fromProps: RecentEmojiEntry[] = recentEmojis.map((emoji) => ({ kind: "unicode" as const, emoji }));
    const seen = new Set(recentEntries.map((e) => (e.kind === "custom" ? `c:${e.id}` : `u:${e.emoji}`)));
    const combined = [
      ...recentEntries,
      ...fromProps.filter((e) => e.kind === "unicode" && !seen.has(`u:${e.emoji}`)),
    ];
    if (!deferredSearch.trim()) return combined;
    const query = deferredSearch.toLowerCase();
    return combined.filter((entry) =>
      entry.kind === "custom" ? entry.name.toLowerCase().includes(query) : (EMOJI_TO_NAME[entry.emoji]?.includes(query) ?? false)
    );
  }, [deferredSearch, recentEmojis, recentEntries]);

  // Build favorites list from DB-backed hook, merging with any prop-provided ones
  const filteredFavorites = useMemo(() => {
    // DB favorites take priority; merge prop favorites as fallback
    const dbEmojiFavs: UnifiedEmojiFavorite[] = favReady
      ? emojiFavs.map(f => ({
          emoji: f.emoji,
          name: f.name || (f.customEmojiId ? f.emoji.replace(/:/g, "") : (EMOJI_TO_NAME[f.emoji] || "emoji")),
          customEmojiId: f.customEmojiId || undefined,
          url: f.url || undefined,
        }))
      : favoriteEmojis.map(emoji => {
          const isCustom = emoji.startsWith(":") && emoji.endsWith(":");
          return {
            emoji,
            name: isCustom ? emoji.replace(/:/g, "") : (EMOJI_TO_NAME[emoji] || "emoji"),
          };
        });

    if (!deferredSearch.trim()) return dbEmojiFavs;
    const query = deferredSearch.toLowerCase();
    return dbEmojiFavs.filter(entry => entry.name.toLowerCase().includes(query));
  }, [deferredSearch, favoriteEmojis, emojiFavs, favReady]);

  // Group stickers by server for sidebar sections
  const groupedStickers = useMemo(() => {
    const groups: Array<{ server: string; serverId?: string; serverIcon?: string; stickers: StickerItem[] }> = [];
    const indexByServer = new Map<string, number>();
    // Build a serverId → icon lookup from available server emojis
    const iconByServerId = new Map<string, string>();
    for (const e of availableServerEmojis) {
      if (e.serverId && e.serverIcon) iconByServerId.set(e.serverId, e.serverIcon);
    }
    for (const sticker of stickers) {
      const server = sticker.serverName || (sticker.serverId ? "Server" : "Stickers");
      let index = indexByServer.get(server);
      if (index === undefined) {
        index = groups.length;
        indexByServer.set(server, index);
        groups.push({
          server,
          serverId: sticker.serverId,
          serverIcon: sticker.serverId ? iconByServerId.get(sticker.serverId) : undefined,
          stickers: [],
        });
      }
      groups[index].stickers.push(sticker);
    }
    return groups;
  }, [stickers, availableServerEmojis]);

  // Sticker sidebar scroll handling
  const setStickerSectionRef = useCallback((id: string) => (el: HTMLDivElement | null) => {
    if (el) {
      stickerSectionRefs.current.set(id, el);
    } else {
      stickerSectionRefs.current.delete(id);
    }
  }, []);

  const scrollStickerToSection = useCallback((sectionId: string) => {
    const section = stickerSectionRefs.current.get(sectionId);
    const container = stickerScrollRef.current;
    if (!section || !container) return;
    const containerRect = container.getBoundingClientRect();
    const sectionRect = section.getBoundingClientRect();
    const offset = sectionRect.top - containerRect.top;
    container.scrollTo({ top: container.scrollTop + offset, behavior: "smooth" });
    setActiveStickerSection(sectionId);
  }, []);

  const handleStickerScroll = useCallback(() => {
    const container = stickerScrollRef.current;
    if (!container) return;
    const containerTop = container.getBoundingClientRect().top;
    let current = "";
    for (const [id, element] of stickerSectionRefs.current) {
      if (element.getBoundingClientRect().top <= containerTop + 50) {
        current = id;
      }
    }
    if (current) setActiveStickerSection(current);
  }, []);

  useEffect(() => {
    const container = stickerScrollRef.current;
    if (!container) return;
    let ticking = false;
    const throttled = () => {
      if (!ticking) {
        requestAnimationFrame(() => { handleStickerScroll(); ticking = false; });
        ticking = true;
      }
    };
    container.addEventListener("scroll", throttled, { passive: true });
    return () => container.removeEventListener("scroll", throttled);
  }, [handleStickerScroll]);

  // Auto-scroll sticker sidebar to keep active icon visible
  useEffect(() => {
    const sidebar = stickerSidebarRef.current;
    if (!sidebar || !activeStickerSection) return;
    const btn = sidebar.querySelector(`[data-section="${activeStickerSection}"]`) as HTMLElement | null;
    if (btn) btn.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeStickerSection]);

  const handleEmojiClick = useCallback((emoji: string, isCustom = false, emojiData?: CustomEmoji) => {
    // Record in recently used (persisted locally)
    setRecentEntries((prev) => {
      const entry: RecentEmojiEntry = isCustom && emojiData
        ? { kind: "custom", id: emojiData.id, name: emojiData.name, url: emojiData.url, animated: emojiData.animated }
        : { kind: "unicode", emoji };
      const key = entry.kind === "custom" ? `c:${entry.id}` : `u:${entry.emoji}`;
      const next = [entry, ...prev.filter((e) => (e.kind === "custom" ? `c:${e.id}` : `u:${e.emoji}`) !== key)].slice(0, 24);
      try {
        localStorage.setItem(RECENT_EMOJIS_KEY, JSON.stringify(next));
      } catch { /* storage full or unavailable */ }
      return next;
    });
    onEmojiSelect(emoji, isCustom, emojiData);
  }, [onEmojiSelect]);

  // Track programmatic scroll so the scroll handler doesn't fight clicks
  const isScrollingToSection = useRef(false);
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Scroll to section when clicking category icon
  const scrollToSection = useCallback((sectionId: string) => {
    const section = sectionRefs.current.get(sectionId);
    const container = scrollRef.current;
    if (!section || !container) return;

    // Suppress scroll-handler updates during the smooth-scroll animation
    isScrollingToSection.current = true;
    if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);

    // Compute target scroll position relative to the container, not offsetParent
    const containerRect = container.getBoundingClientRect();
    const sectionRect = section.getBoundingClientRect();
    const offset = sectionRect.top - containerRect.top;
    container.scrollTo({ top: container.scrollTop + offset, behavior: "smooth" });

    setActiveSection(sectionId);

    // Re-enable scroll handler after the animation settles
    scrollTimeoutRef.current = setTimeout(() => {
      isScrollingToSection.current = false;
    }, 500);
  }, []);

  // Update active section based on scroll position — uses viewport-relative
  // rects so it works regardless of nested offset parents.
  const handleScroll = useCallback(() => {
    if (isScrollingToSection.current) return;

    const container = scrollRef.current;
    if (!container) return;

    const containerTop = container.getBoundingClientRect().top;
    let currentSection = "";

    for (const [id, element] of sectionRefs.current) {
      const elementTop = element.getBoundingClientRect().top;
      if (elementTop <= containerTop + 50) {
        currentSection = id;
      }
    }

    if (currentSection) {
      setActiveSection(currentSection);
    }
  }, []);

  // Auto-scroll the sidebar to keep the active icon visible
  useEffect(() => {
    const sidebar = sidebarRef.current;
    if (!sidebar) return;
    const activeBtn = sidebar.querySelector(`[data-section="${activeSection}"]`) as HTMLElement | null;
    if (activeBtn) {
      activeBtn.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [activeSection]);

  useEffect(() => {
    const container = scrollRef.current;
    if (container) {
      // Set the correct active section on mount before the user scrolls.
      handleScroll();
      let ticking = false;
      const throttledHandler = () => {
        if (!ticking) {
          requestAnimationFrame(() => {
            handleScroll();
            ticking = false;
          });
          ticking = true;
        }
      };
      container.addEventListener("scroll", throttledHandler, { passive: true });
      return () => container.removeEventListener("scroll", throttledHandler);
    }
  }, [handleScroll]);

  useEffect(() => {
    if (activeTab !== "stickers") {
      // Bail out if already empty — a new [] identity here re-renders forever
      setStickers((prev) => (prev.length === 0 ? prev : []));
      return;
    }

    // Use cross-server stickers if available
    if (availableServerStickers.length > 0) {
      setStickers(availableServerStickers);
      return;
    }

    if (!serverId) {
      setStickers([]);
      return;
    }

    let active = true;
    const run = async () => {
      setIsLoadingStickers(true);
      try {
        const response = await fetch(`/api/servers/${serverId}/stickers`);
        if (!response.ok) return;
        const data = await response.json();
        if (!active) return;
        setStickers((data.stickers || []).map((sticker: { id?: string; _id?: string; name: string; description?: string; tags?: string[]; imageUrl?: string; url?: string }) => ({
          id: sticker.id || sticker._id,
          name: sticker.name,
          description: sticker.description,
          tags: sticker.tags || [],
          imageUrl: sticker.imageUrl || sticker.url,
          serverId,
          serverName,
        })));
      } catch {
        if (active) {
          setStickers([]);
        }
      } finally {
        if (active) {
          setIsLoadingStickers(false);
        }
      }
    };

    void run();
    return () => {
      active = false;
    };
  }, [activeTab, serverId, availableServerStickers, serverName]);

  // Register section ref
  const setSectionRef = useCallback((id: string) => (el: HTMLDivElement | null) => {
    if (el) {
      sectionRefs.current.set(id, el);
    } else {
      sectionRefs.current.delete(id);
    }
  }, []);

  return (
    <div className={cn("w-full max-w-[440px] bg-[#1a1a2e] rounded-lg border border-[#2a2a40] flex flex-col shadow-2xl overflow-hidden", className)}>
      {/* Top Tabs - GIFs, Stickers, Emoji */}
      <div className="flex border-b border-[#2a2a40]">
        <button
          onClick={() => setActiveTab("gifs")}
          className={cn(
            "flex-1 py-3 text-sm font-semibold transition-all flex items-center justify-center gap-2",
            activeTab === "gifs" 
              ? "text-white bg-[#2a2a40]" 
              : "text-[#8888aa] hover:text-white hover:bg-[#2a2a40]/50"
          )}
        >
          <ImageIcon className="w-4 h-4" />
          {gt("GIFs")}
        </button>
        <button
          onClick={() => setActiveTab("stickers")}
          className={cn(
            "flex-1 py-3 text-sm font-semibold transition-all flex items-center justify-center gap-2",
            activeTab === "stickers" 
              ? "text-white bg-[#2a2a40]" 
              : "text-[#8888aa] hover:text-white hover:bg-[#2a2a40]/50"
          )}
        >
          <Sticker className="w-4 h-4" />
          {gt("Stickers")}
        </button>
        <button
          onClick={() => setActiveTab("emoji")}
          className={cn(
            "flex-1 py-3 text-sm font-semibold transition-all flex items-center justify-center gap-2",
            activeTab === "emoji" 
              ? "text-white bg-[#2a2a40]" 
              : "text-[#8888aa] hover:text-white hover:bg-[#2a2a40]/50"
          )}
        >
          <Smile className="w-4 h-4" />
          {gt("Emoji")}
        </button>
      </div>

      {/* Content based on tab */}
      {activeTab === "gifs" ? (
        // flex-none: flex-1's 0% basis can't resolve against this auto-height
        // column, which made the GIF list grow unboundedly with no scroll
        <div className="flex-none h-[440px] max-h-[60dvh] min-h-0">
          <GifPicker
            onGifSelect={(gif) => onGifSelect?.(gif.url)}
            className="w-full h-full rounded-none border-none bg-[#1a1a2e]"
          />
        </div>
      ) : activeTab === "stickers" ? (
        <div className="flex-none h-[440px] max-h-[60dvh] min-h-0 flex">
          {/* Sticker Category Sidebar */}
          {groupedStickers.length > 0 && (
            <div ref={stickerSidebarRef} className="w-12 bg-[#0f0f1a] flex flex-col items-center py-2 gap-1 border-r border-[#2a2a40] overflow-y-auto scrollbar-thin scrollbar-thumb-[#2a2a40] scrollbar-track-transparent">
              {groupedStickers.map((group) => {
                const sectionId = `sticker-${group.serverId || group.server}`;
                const isActive = activeStickerSection === sectionId;
                return (
                  <button
                    key={sectionId}
                    data-section={sectionId}
                    onClick={() => scrollStickerToSection(sectionId)}
                    className={cn(
                      "w-9 h-9 flex items-center justify-center rounded-lg transition-all overflow-hidden shrink-0",
                      isActive
                        ? "bg-[#8B5CF6] text-white"
                        : "text-[#8888aa] hover:bg-[#2a2a40] hover:text-white"
                    )}
                    title={group.server}
                  >
                    {group.serverIcon ? (
                      <img src={cdnImage(group.serverIcon)} alt={group.server} className="w-5 h-5 rounded-full object-cover" />
                    ) : (
                      <span className="text-[10px] font-bold">{group.server.charAt(0).toUpperCase()}</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
          {/* Sticker Grid */}
          <div ref={stickerScrollRef} className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-[#2a2a40] scrollbar-track-transparent">
            {isLoadingStickers ? (
              <div className="p-3">
                <div className="grid grid-cols-5 gap-2">
                  {Array.from({ length: 10 }).map((_, idx) => (
                    <div key={idx} className="h-16 rounded-md bg-[#2a2a40] animate-pulse" />
                  ))}
                </div>
              </div>
            ) : groupedStickers.length > 0 ? (
              <div className="p-3 space-y-4">
                {groupedStickers.map((group) => {
                  const sectionId = `sticker-${group.serverId || group.server}`;
                  return (
                    <div key={sectionId} ref={setStickerSectionRef(sectionId)}>
                      <p className="text-xs uppercase tracking-wider text-[#8888aa] mb-2 sticky top-0 bg-[#1a1a2e] py-1 z-10 -mx-3 px-3">
                        {group.server}
                      </p>
                      <div className="grid grid-cols-5 gap-2">
                        {group.stickers.map((sticker) => (
                          <button
                            key={sticker.id}
                            onClick={() => onStickerSelect?.(sticker)}
                            className="group rounded-md border border-[#2a2a40] hover:border-[#8B5CF6] transition-colors p-1"
                            title={sticker.name}
                          >
                            <img
                              src={cdnImage(sticker.imageUrl)}
                              alt={sticker.name}
                              className="w-full h-14 object-contain group-hover:scale-105 transition-transform"
                              loading="lazy"
                            />
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-center p-3">
                <Sticker className="w-8 h-8 text-[#8888aa] mb-3" />
                <p className="text-[#8888aa] text-sm">
                  {serverId || availableServerStickers.length > 0 ? gt("No stickers uploaded yet") : gt("Open a server channel to use stickers")}
                </p>
              </div>
            )}
          </div>
        </div>
      ) : (
        <>
          {/* Search Bar */}
          <div className="p-3 border-b border-[#2a2a40]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8888aa]" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={gt("Search emojis...")}
                className="pl-10 pr-10 bg-[#0f0f1a] border-[#2a2a40] text-white placeholder:text-[#8888aa] h-10 rounded-lg focus-visible:ring-1 focus-visible:ring-[#8B5CF6]"
              />
              {search && (
                <button 
                  onClick={() => setSearch("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#8888aa] hover:text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>

          {/* Main Content - Sidebar + Emoji Grid */}
          <div className="flex flex-1 min-h-0">
            {/* Category Sidebar */}
            <div ref={sidebarRef} className="w-12 h-[440px] max-h-[60dvh] bg-[#0f0f1a] flex flex-col items-center py-2 gap-1 border-r border-[#2a2a40] overflow-y-auto scrollbar-thin scrollbar-thumb-[#2a2a40] scrollbar-track-transparent">
              {/* Recent + Favorites first */}
              {CATEGORY_ICONS.filter((cat) => cat.id === "recent" || cat.id === "favorites").map((cat) => {
                const IconComponent = cat.icon;
                const isActive = activeSection === cat.id;
                return (
                  <button
                    key={cat.id}
                    data-section={cat.id}
                    onClick={() => scrollToSection(cat.id)}
                    className={cn(
                      "w-9 h-9 flex items-center justify-center rounded-lg transition-all shrink-0",
                      isActive 
                        ? "bg-[#8B5CF6] text-white" 
                        : "text-[#8888aa] hover:bg-[#2a2a40] hover:text-white"
                    )}
                    title={emojiCategoryLabel(cat.id, gt)}
                  >
                    <IconComponent className="w-5 h-5" />
                  </button>
                );
              })}
              {/* Server icons — after recent/favorites, before twemoji */}
              {groupedCustomEmojis.map((group) => {
                const sectionId = `server-${group.serverId || group.server}`;
                const isActive = activeSection === sectionId;
                return (
                  <button
                    key={sectionId}
                    data-section={sectionId}
                    onClick={() => scrollToSection(sectionId)}
                    className={cn(
                      "w-9 h-9 flex items-center justify-center rounded-lg transition-all overflow-hidden shrink-0",
                      isActive
                        ? "bg-[#8B5CF6] text-white"
                        : "text-[#8888aa] hover:bg-[#2a2a40] hover:text-white"
                    )}
                    title={group.server}
                  >
                    {group.serverIcon ? (
                      <img
                        src={cdnImage(group.serverIcon)}
                        alt={group.server}
                        className="w-5 h-5 rounded-full object-cover"
                      />
                    ) : (
                      <span className="text-[10px] font-bold">
                        {group.server.charAt(0).toUpperCase()}
                      </span>
                    )}
                  </button>
                );
              })}
              {/* Twemoji standard category icons — after servers */}
              {CATEGORY_ICONS.filter((cat) => cat.id !== "recent" && cat.id !== "favorites").map((cat) => {
                const IconComponent = cat.icon;
                const isActive = activeSection === cat.id;
                return (
                  <button
                    key={cat.id}
                    data-section={cat.id}
                    onClick={() => scrollToSection(cat.id)}
                    className={cn(
                      "w-9 h-9 flex items-center justify-center rounded-lg transition-all shrink-0",
                      isActive 
                        ? "bg-[#8B5CF6] text-white" 
                        : "text-[#8888aa] hover:bg-[#2a2a40] hover:text-white"
                    )}
                    title={emojiCategoryLabel(cat.id, gt)}
                  >
                    <IconComponent className="w-5 h-5" />
                  </button>
                );
              })}
            </div>

            {/* Emoji Grid - Single scrollable list with sections */}
            <div 
              ref={scrollRef}
              className="flex-1 h-[440px] max-h-[60dvh] overflow-y-auto overflow-x-hidden scrollbar-thin scrollbar-thumb-[#2a2a40] scrollbar-track-transparent"
            >
              <div className="p-3 space-y-4">
                {/* Recently Used Section */}
                {filteredRecent.length > 0 && (
                  <div ref={setSectionRef("recent")}>
                    <h3 className="text-xs font-semibold text-[#8888aa] mb-2 flex items-center gap-1.5 uppercase tracking-wide sticky top-0 bg-[#1a1a2e] py-1 z-10">
                      <Clock className="w-3.5 h-3.5" />
                      {gt("Recently Used")}
                    </h3>
                    <div className="grid grid-cols-8 gap-0.5">
                      {filteredRecent.slice(0, 24).map((entry, idx) =>
                        entry.kind === "custom" ? (
                          <CustomEmojiButton
                            key={`recent-c-${entry.id}-${idx}`}
                            emoji={{ id: entry.id, name: entry.name, url: entry.url, animated: entry.animated }}
                            onClick={() =>
                              handleEmojiClick(`:${entry.name}:`, true, {
                                id: entry.id,
                                name: entry.name,
                                url: entry.url,
                                animated: entry.animated,
                              })
                            }
                            onContextMenu={(e) => handleEmojiContextMenu(e, `:${entry.name}:`, { id: entry.id, name: entry.name, url: entry.url, animated: entry.animated })}
                          />
                        ) : (
                          <EmojiButton
                            key={`recent-u-${idx}`}
                            emoji={entry.emoji}
                            onClick={() => handleEmojiClick(entry.emoji)}
                            onContextMenu={(e) => handleEmojiContextMenu(e, entry.emoji)}
                          />
                        )
                      )}
                    </div>
                  </div>
                )}

                {/* Favorites Section */}
                {filteredFavorites.length > 0 && (
                  <div ref={setSectionRef("favorites")}>
                    <h3 className="text-xs font-semibold text-[#8888aa] mb-2 flex items-center gap-1.5 uppercase tracking-wide sticky top-0 bg-[#1a1a2e] py-1 z-10">
                      <Star className="w-3.5 h-3.5" />
                      {gt("Favorites")}
                    </h3>
                    <div className="grid grid-cols-8 gap-0.5">
                      {filteredFavorites.map((entry, idx) => {
                        if (entry.customEmojiId) {
                          const emojiData = {
                            id: entry.customEmojiId,
                            name: entry.name,
                            url: entry.url || "",
                          };
                          return (
                            <CustomEmojiButton
                              key={`fav-${idx}`}
                              emoji={emojiData}
                              onClick={() => handleEmojiClick(entry.emoji, true, emojiData)}
                              onContextMenu={(e) => handleEmojiContextMenu(e, entry.emoji, emojiData)}
                            />
                          );
                        }
                        return (
                          <EmojiButton
                            key={`fav-${idx}`}
                            emoji={entry.emoji}
                            onClick={() => handleEmojiClick(entry.emoji)}
                            onContextMenu={(e) => handleEmojiContextMenu(e, entry.emoji)}
                          />
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Server Custom Emojis — one section per server, like Discord */}
                {groupedCustomEmojis.map((group) => {
                  const sectionId = `server-${group.serverId || group.server}`;
                  return (
                  <div key={`server-${group.server}`} ref={setSectionRef(sectionId)}>
                    <h3 className="text-xs font-semibold text-[#8888aa] mb-2 flex items-center gap-1.5 uppercase tracking-wide sticky top-0 bg-[#1a1a2e] py-1 z-10">
                      {group.serverIcon && group.serverId ? (
                        <button
                          onClick={() => router.push(`/channels/${group.serverId}`)}
                          className="flex items-center gap-1.5 hover:text-white transition-colors"
                          title={`Jump to ${group.server}`}
                        >
                          <img
                            src={cdnImage(group.serverIcon)}
                            alt={group.server}
                            className="w-4 h-4 rounded-full object-cover"
                          />
                          {group.server}
                        </button>
                      ) : (
                        group.server
                      )}
                    </h3>
                    <div className="grid grid-cols-8 gap-0.5">
                      {group.emojis.map((emoji) => (
                        <CustomEmojiButton
                          key={emoji.id}
                          emoji={emoji}
                          onClick={() => handleEmojiClick(`:${emoji.name}:`, true, emoji)}
                          onContextMenu={(e) => handleEmojiContextMenu(e, `:${emoji.name}:`, emoji)}
                        />
                      ))}
                    </div>
                  </div>
                  );
                })}

                {/* Standard Emoji Categories — each section mounts its emoji
                    grid lazily as it nears the viewport so the picker never
                    renders thousands of images at once. */}
                {filteredCategories.map((category) => (
                  <LazyEmojiSection
                    key={category.id}
                    scrollRef={scrollRef}
                    setRef={setSectionRef(category.id)}
                    estimatedHeight={Math.ceil(category.emojis.length / 8) * 40 + 28}
                  >
                    <h3 className="text-xs font-semibold text-[#8888aa] mb-2 uppercase tracking-wide sticky top-0 bg-[#1a1a2e] py-1 z-10">
                      {category.name}
                    </h3>
                    <div className="grid grid-cols-8 gap-0.5">
                      {category.emojis.map((emoji, idx) => (
                        <EmojiButton
                          key={`${category.id}-${idx}`}
                          emoji={emoji}
                          onClick={() => handleEmojiClick(emoji)}
                          onContextMenu={(e) => handleEmojiContextMenu(e, emoji)}
                        />
                      ))}
                    </div>
                  </LazyEmojiSection>
                ))}

                {/* No results */}
                {search && filteredCategories.length === 0 && filteredCustomEmojis.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    <Search className="w-12 h-12 text-[#4a4a6a] mb-4" />
                    <p className="text-[#8888aa] text-sm">{gt("No emojis found for \"{search}\"", { search })}</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="border-t border-[#2a2a40] p-2 flex items-center bg-[#0f0f1a]">
            <div className="flex items-center gap-2 text-xs text-[#8888aa]">
              <span>{gt("Powered by Twemoji")}</span>
            </div>
          </div>
        </>
      )}

      {typeof document !== "undefined" && ctxMenu && createPortal(
        <div
          className="fixed z-[9999] min-w-[160px] bg-[#1a1a2e] border border-[#2a2a40] rounded-lg shadow-xl py-1"
          style={{ 
            left: Math.min(ctxMenu.x, window.innerWidth - 168), 
            top: Math.min(ctxMenu.y, window.innerHeight - 88) 
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={handleToggleFav}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-[#ccccee] hover:bg-[#2a2a40] transition-colors"
          >
            {isEmojiFavorite(ctxMenu.emoji, ctxMenu.customEmojiId) ? (
              <>
                <StarOff className="w-4 h-4" />
                {gt("Unfavorite")}
              </>
            ) : (
              <>
                <Star className="w-4 h-4" />
                {gt("Favorite")}
              </>
            )}
          </button>
          <button
            onClick={handleCopyEmojiId}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-[#ccccee] hover:bg-[#2a2a40] transition-colors"
          >
            <Copy className="w-4 h-4" />
            {gt("Copy ID")}
          </button>
        </div>,
        document.body
      )}
    </div>
  );
}

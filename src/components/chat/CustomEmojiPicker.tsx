"use client";

import { useState, useRef, useCallback, useEffect, useMemo, memo } from "react";
import { 
  Search, Clock, Star, Smile, Users, Dog, Apple, Gamepad2, 
  Plane, Lightbulb, Heart, Flag, ImageIcon, Sticker, X, Plus
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { EMOJI_CATEGORIES, EMOJI_TO_NAME, type EmojiCategory } from "@/lib/constants/emojis";
import { GifPicker } from "@/components/chat/GifPicker";
import { useGT } from "gt-next";

interface CustomEmoji {
  id: string;
  name: string;
  url: string;
  serverId?: string;
  serverName?: string;
  animated?: boolean;
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
    .join('-')
    .replace(/-fe0f/g, ''); // Remove variation selector
  return `https://cdn.jsdelivr.net/gh/twitter/twemoji@latest/assets/svg/${codePoints}.svg`;
}

// Memoized emoji button component - only re-renders when emoji changes
const EmojiButton = memo(function EmojiButton({ 
  emoji, 
  onClick
}: { 
  emoji: string; 
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-10 h-10 flex items-center justify-center hover:bg-[#2a2a40] rounded-lg transition-colors"
    >
      <img 
        src={getEmojiUrl(emoji)} 
        alt={emoji}
        className="w-7 h-7"
        loading="lazy"
        decoding="async"
      />
    </button>
  );
});

// Memoized custom emoji button
const CustomEmojiButton = memo(function CustomEmojiButton({ 
  emoji, 
  onClick 
}: { 
  emoji: CustomEmoji; 
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-10 h-10 flex items-center justify-center hover:bg-[#2a2a40] rounded-lg transition-colors"
      title={`:${emoji.name}:${emoji.serverName ? ` from ${emoji.serverName}` : ''}`}
    >
      <img
        src={emoji.url}
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
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<TabType>(initialTab);
  const [recentEntries, setRecentEntries] = useState<RecentEmojiEntry[]>([]);

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
  const sectionRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const [activeSection, setActiveSection] = useState("smileys");

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
      const currentServerIds = new Set(serverEmojis.map(e => e.id));
      const enrichedCurrent = serverEmojis.map((e) =>
        e.serverName ? e : { ...e, serverName: nameById.get(e.id) }
      );
      const others = availableServerEmojis.filter(e => !currentServerIds.has(e.id));
      return [...enrichedCurrent, ...others];
    }
    return serverEmojis;
  }, [availableServerEmojis, serverEmojis]);

  // Filter emojis based on search — uses shortcode names for keyword search
  const filteredCategories = useMemo(() => {
    if (!search.trim()) return EMOJI_CATEGORIES;
    
    const query = search.toLowerCase();
    return EMOJI_CATEGORIES.map(category => ({
      ...category,
      emojis: category.emojis.filter(emoji => {
        const name = EMOJI_TO_NAME[emoji];
        return name && name.includes(query);
      }),
    })).filter(category => category.emojis.length > 0);
  }, [search]);

  // Filter custom emojis
  const filteredCustomEmojis = useMemo(() => {
    if (!search.trim()) return allCustomEmojis;
    const query = search.toLowerCase();
    return allCustomEmojis.filter(emoji =>
      emoji.name.toLowerCase().includes(query)
    );
  }, [search, allCustomEmojis]);

  // Group custom emojis by their server (current server first, since
  // allCustomEmojis puts the current server's emojis before the others)
  const groupedCustomEmojis = useMemo(() => {
    const groups: Array<{ server: string; emojis: CustomEmoji[] }> = [];
    const indexByServer = new Map<string, number>();
    for (const emoji of filteredCustomEmojis) {
      const server = emoji.serverName || serverName;
      let index = indexByServer.get(server);
      if (index === undefined) {
        index = groups.length;
        indexByServer.set(server, index);
        groups.push({ server, emojis: [] });
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
    if (!search.trim()) return combined;
    const query = search.toLowerCase();
    return combined.filter((entry) =>
      entry.kind === "custom" ? entry.name.toLowerCase().includes(query) : (EMOJI_TO_NAME[entry.emoji]?.includes(query) ?? false)
    );
  }, [search, recentEmojis, recentEntries]);

  const filteredFavorites = useMemo(() => {
    if (!search.trim()) return favoriteEmojis;
    const query = search.toLowerCase();
    return favoriteEmojis.filter(emoji => (EMOJI_TO_NAME[emoji]?.includes(query) ?? false));
  }, [search, favoriteEmojis]);

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

  // Scroll to section when clicking category icon
  const scrollToSection = useCallback((sectionId: string) => {
    const section = sectionRefs.current.get(sectionId);
    if (section) {
      section.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    setActiveSection(sectionId);
  }, []);

  // Update active section based on scroll position - throttled
  const handleScroll = useCallback(() => {
    const container = scrollRef.current;
    if (!container) return;

    const scrollTop = container.scrollTop;
    let currentSection = "smileys";

    for (const [id, element] of sectionRefs.current) {
      if (element.offsetTop <= scrollTop + 60) {
        currentSection = id;
      }
    }

    setActiveSection(currentSection);
  }, []);

  useEffect(() => {
    const container = scrollRef.current;
    if (container) {
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
        <div className="flex-none h-[440px] max-h-[60dvh] min-h-0 flex flex-col">
          <div className="p-3 border-b border-[#2a2a40]">
            <p className="text-xs uppercase tracking-wider text-[#8888aa]">
              {serverId || availableServerStickers.length > 0 ? gt("Server Stickers") : gt("Stickers")}
            </p>
          </div>
          <div className="p-3 flex-1 overflow-y-auto">
            {isLoadingStickers ? (
              <div className="grid grid-cols-5 gap-2">
                {Array.from({ length: 10 }).map((_, idx) => (
                  <div key={idx} className="h-16 rounded-md bg-[#2a2a40] animate-pulse" />
                ))}
              </div>
            ) : stickers.length > 0 ? (
              <div className="space-y-4">
                {Object.entries(
                  stickers.reduce((acc, sticker) => {
                    const group = sticker.serverName || (sticker.serverId ? "Server" : "Stickers");
                    if (!acc[group]) acc[group] = [];
                    acc[group].push(sticker);
                    return acc;
                  }, {} as Record<string, StickerItem[]>)
                ).map(([serverName, serverStickers]) => (
                  <div key={serverName}>
                    <p className="text-xs uppercase tracking-wider text-[#8888aa] mb-2 sticky top-0 bg-[#1a1a2e] py-1">
                      {serverName}
                    </p>
                    <div className="grid grid-cols-5 gap-2">
                      {serverStickers.map((sticker) => (
                        <button
                          key={sticker.id}
                          onClick={() => onStickerSelect?.(sticker)}
                          className="group rounded-md border border-[#2a2a40] hover:border-[#8B5CF6] transition-colors p-1"
                          title={sticker.name}
                        >
                          <img
                            src={sticker.imageUrl}
                            alt={sticker.name}
                            className="w-full h-14 object-contain group-hover:scale-105 transition-transform"
                            loading="lazy"
                          />
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-center">
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
            <div className="w-12 bg-[#0f0f1a] flex flex-col items-center py-2 gap-1 border-r border-[#2a2a40]">
              {CATEGORY_ICONS.map((cat) => {
                const IconComponent = cat.icon;
                const isActive = activeSection === cat.id;
                return (
                  <button
                    key={cat.id}
                    onClick={() => scrollToSection(cat.id)}
                    className={cn(
                      "w-9 h-9 flex items-center justify-center rounded-lg transition-all",
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
                          />
                        ) : (
                          <EmojiButton
                            key={`recent-u-${idx}`}
                            emoji={entry.emoji}
                            onClick={() => handleEmojiClick(entry.emoji)}
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
                      {filteredFavorites.map((emoji, idx) => (
                        <EmojiButton
                          key={`fav-${idx}`}
                          emoji={emoji}
                          onClick={() => handleEmojiClick(emoji)}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {/* Server Custom Emojis — one section per server, like Discord */}
                {groupedCustomEmojis.map((group) => (
                  <div key={`server-${group.server}`}>
                    <h3 className="text-xs font-semibold text-[#8888aa] mb-2 flex items-center gap-1.5 uppercase tracking-wide sticky top-0 bg-[#1a1a2e] py-1 z-10">
                      {group.server}
                    </h3>
                    <div className="grid grid-cols-8 gap-0.5">
                      {group.emojis.map((emoji) => (
                        <CustomEmojiButton
                          key={emoji.id}
                          emoji={emoji}
                          onClick={() => handleEmojiClick(`:${emoji.name}:`, true, emoji)}
                        />
                      ))}
                    </div>
                  </div>
                ))}

                {/* Standard Emoji Categories */}
                {filteredCategories.map((category) => (
                  <div key={category.id} ref={setSectionRef(category.id)}>
                    <h3 className="text-xs font-semibold text-[#8888aa] mb-2 uppercase tracking-wide sticky top-0 bg-[#1a1a2e] py-1 z-10">
                      {category.name}
                    </h3>
                    <div className="grid grid-cols-8 gap-0.5">
                      {category.emojis.map((emoji, idx) => (
                        <EmojiButton
                          key={`${category.id}-${idx}`}
                          emoji={emoji}
                          onClick={() => handleEmojiClick(emoji)}
                        />
                      ))}
                    </div>
                  </div>
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
    </div>
  );
}

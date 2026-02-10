"use client";

import { useState, useRef, useCallback, useEffect, useMemo, memo } from "react";
import { 
  Search, Clock, Star, Smile, Users, Dog, Apple, Gamepad2, 
  Plane, Lightbulb, Heart, Flag, ImageIcon, Sticker, X, Plus
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { EMOJI_CATEGORIES, type EmojiCategory } from "@/lib/constants/emojis";

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
}

interface EmojiPickerProps {
  onEmojiSelect: (emoji: string, isCustom?: boolean, emojiData?: CustomEmoji) => void;
  onGifSelect?: (gifUrl: string) => void;
  onStickerSelect?: (stickerUrl: string, sticker?: StickerItem) => void;
  serverEmojis?: CustomEmoji[];
  recentEmojis?: string[];
  favoriteEmojis?: string[];
  serverName?: string;
  className?: string;
  allowServerEmojisInDMs?: boolean;
  availableServerEmojis?: CustomEmoji[]; // All server emojis the user has access to
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

export function CustomEmojiPicker({
  onEmojiSelect,
  onGifSelect,
  onStickerSelect,
  serverEmojis = [],
  recentEmojis = [],
  favoriteEmojis = [],
  serverName = "Server",
  className,
  allowServerEmojisInDMs = false,
  availableServerEmojis = [],
  serverId,
  initialTab = "emoji",
}: EmojiPickerProps) {
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<TabType>(initialTab);
  const [gifSearch, setGifSearch] = useState("");
  const [gifResults, setGifResults] = useState<Array<{ id: string; title: string; url: string; previewUrl: string }>>([]);
  const [isLoadingGifs, setIsLoadingGifs] = useState(false);
  const [stickers, setStickers] = useState<StickerItem[]>([]);
  const [isLoadingStickers, setIsLoadingStickers] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const [activeSection, setActiveSection] = useState("smileys");

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  // Combined emojis for DMs - use all server emojis user has access to
  const allCustomEmojis = useMemo(() => {
    if (allowServerEmojisInDMs && availableServerEmojis.length > 0) {
      return availableServerEmojis;
    }
    return serverEmojis;
  }, [allowServerEmojisInDMs, availableServerEmojis, serverEmojis]);

  // Filter emojis based on search
  const filteredCategories = useMemo(() => {
    if (!search.trim()) return EMOJI_CATEGORIES;
    
    const query = search.toLowerCase();
    return EMOJI_CATEGORIES.map(category => ({
      ...category,
      emojis: category.emojis.filter(emoji => 
        // Simple search - emoji itself contains query
        emoji.toLowerCase().includes(query)
      ),
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

  // Filter recent/favorites
  const filteredRecent = useMemo(() => {
    if (!search.trim()) return recentEmojis;
    const query = search.toLowerCase();
    return recentEmojis.filter(emoji => emoji.toLowerCase().includes(query));
  }, [search, recentEmojis]);

  const filteredFavorites = useMemo(() => {
    if (!search.trim()) return favoriteEmojis;
    const query = search.toLowerCase();
    return favoriteEmojis.filter(emoji => emoji.toLowerCase().includes(query));
  }, [search, favoriteEmojis]);

  const handleEmojiClick = useCallback((emoji: string, isCustom = false, emojiData?: CustomEmoji) => {
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
    if (activeTab !== "gifs") return;
    let active = true;
    const run = async () => {
      setIsLoadingGifs(true);
      try {
        const response = await fetch(`/api/gifs/search?q=${encodeURIComponent(gifSearch)}&limit=24`);
        if (!response.ok) return;
        const data = await response.json();
        if (active) {
          setGifResults(data.gifs || []);
        }
      } catch {
        if (active) {
          setGifResults([]);
        }
      } finally {
        if (active) {
          setIsLoadingGifs(false);
        }
      }
    };

    const timer = setTimeout(run, 200);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [activeTab, gifSearch]);

  useEffect(() => {
    if (activeTab !== "stickers" || !serverId) {
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
        setStickers((data.stickers || []).map((sticker: any) => ({
          id: sticker.id || sticker._id,
          name: sticker.name,
          description: sticker.description,
          tags: sticker.tags || [],
          imageUrl: sticker.imageUrl || sticker.url,
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
  }, [activeTab, serverId]);

  // Register section ref
  const setSectionRef = useCallback((id: string) => (el: HTMLDivElement | null) => {
    if (el) {
      sectionRefs.current.set(id, el);
    } else {
      sectionRefs.current.delete(id);
    }
  }, []);

  return (
    <div className={cn("w-[440px] bg-[#1a1a2e] rounded-lg border border-[#2a2a40] flex flex-col shadow-2xl overflow-hidden", className)}>
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
          GIFs
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
          Stickers
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
          Emoji
        </button>
      </div>

      {/* Content based on tab */}
      {activeTab === "gifs" ? (
        <div className="flex-1 min-h-[400px] flex flex-col">
          <div className="p-3 border-b border-[#2a2a40]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8888aa]" />
              <Input
                value={gifSearch}
                onChange={(e) => setGifSearch(e.target.value)}
                placeholder="Search GIFs..."
                className="pl-10 pr-10 bg-[#0f0f1a] border-[#2a2a40] text-white placeholder:text-[#8888aa] h-10 rounded-lg focus-visible:ring-1 focus-visible:ring-[#8B5CF6]"
              />
              {gifSearch && (
                <button
                  onClick={() => setGifSearch("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#8888aa] hover:text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
          <div className="p-3 h-[340px] overflow-y-auto">
            {isLoadingGifs ? (
              <div className="grid grid-cols-3 gap-2">
                {Array.from({ length: 9 }).map((_, idx) => (
                  <div key={idx} className="h-24 rounded-md bg-[#2a2a40] animate-pulse" />
                ))}
              </div>
            ) : gifResults.length > 0 ? (
              <div className="grid grid-cols-3 gap-2">
                {gifResults.map((gif) => (
                  <button
                    key={gif.id}
                    onClick={() => onGifSelect?.(gif.url)}
                    className="group relative rounded-md overflow-hidden border border-[#2a2a40] hover:border-[#8B5CF6] transition-colors"
                    title={gif.title}
                  >
                    <img
                      src={gif.previewUrl || gif.url}
                      alt={gif.title}
                      className="w-full h-24 object-cover group-hover:scale-105 transition-transform"
                      loading="lazy"
                    />
                  </button>
                ))}
              </div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-center">
                <ImageIcon className="w-8 h-8 text-[#8888aa] mb-3" />
                <p className="text-[#8888aa] text-sm">No GIF results</p>
              </div>
            )}
          </div>
        </div>
      ) : activeTab === "stickers" ? (
        <div className="flex-1 min-h-[400px] flex flex-col">
          <div className="p-3 border-b border-[#2a2a40]">
            <p className="text-xs uppercase tracking-wider text-[#8888aa]">
              {serverId ? "Server Stickers" : "Stickers"}
            </p>
          </div>
          <div className="p-3 h-[340px] overflow-y-auto">
            {isLoadingStickers ? (
              <div className="grid grid-cols-4 gap-2">
                {Array.from({ length: 8 }).map((_, idx) => (
                  <div key={idx} className="h-20 rounded-md bg-[#2a2a40] animate-pulse" />
                ))}
              </div>
            ) : stickers.length > 0 ? (
              <div className="grid grid-cols-4 gap-2">
                {stickers.map((sticker) => (
                  <button
                    key={sticker.id}
                    onClick={() => onStickerSelect?.(sticker.imageUrl, sticker)}
                    className="group rounded-md border border-[#2a2a40] hover:border-[#8B5CF6] transition-colors p-1"
                    title={sticker.name}
                  >
                    <img
                      src={sticker.imageUrl}
                      alt={sticker.name}
                      className="w-full h-16 object-contain group-hover:scale-105 transition-transform"
                      loading="lazy"
                    />
                  </button>
                ))}
              </div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-center">
                <Sticker className="w-8 h-8 text-[#8888aa] mb-3" />
                <p className="text-[#8888aa] text-sm">
                  {serverId ? "No stickers uploaded yet" : "Open a server channel to use stickers"}
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
                placeholder="Search emojis..."
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
                    title={cat.label}
                  >
                    <IconComponent className="w-5 h-5" />
                  </button>
                );
              })}
            </div>

            {/* Emoji Grid - Single scrollable list with sections */}
            <div 
              ref={scrollRef}
              className="flex-1 h-[380px] overflow-y-auto overflow-x-hidden scrollbar-thin scrollbar-thumb-[#2a2a40] scrollbar-track-transparent"
            >
              <div className="p-3 space-y-4">
                {/* Recently Used Section */}
                {filteredRecent.length > 0 && (
                  <div ref={setSectionRef("recent")}>
                    <h3 className="text-xs font-semibold text-[#8888aa] mb-2 flex items-center gap-1.5 uppercase tracking-wide sticky top-0 bg-[#1a1a2e] py-1 z-10">
                      <Clock className="w-3.5 h-3.5" />
                      Recently Used
                    </h3>
                    <div className="grid grid-cols-8 gap-0.5">
                      {filteredRecent.slice(0, 24).map((emoji, idx) => (
                        <EmojiButton
                          key={`recent-${idx}`}
                          emoji={emoji}
                          onClick={() => handleEmojiClick(emoji)}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {/* Favorites Section */}
                {filteredFavorites.length > 0 && (
                  <div ref={setSectionRef("favorites")}>
                    <h3 className="text-xs font-semibold text-[#8888aa] mb-2 flex items-center gap-1.5 uppercase tracking-wide sticky top-0 bg-[#1a1a2e] py-1 z-10">
                      <Star className="w-3.5 h-3.5" />
                      Favorites
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

                {/* Server Custom Emojis Section */}
                {filteredCustomEmojis.length > 0 && (
                  <div>
                    <h3 className="text-xs font-semibold text-[#8888aa] mb-2 flex items-center gap-1.5 uppercase tracking-wide sticky top-0 bg-[#1a1a2e] py-1 z-10">
                      {allowServerEmojisInDMs ? "Your Servers" : serverName}
                    </h3>
                    <div className="grid grid-cols-8 gap-0.5">
                      {filteredCustomEmojis.map((emoji) => (
                        <CustomEmojiButton
                          key={emoji.id}
                          emoji={emoji}
                          onClick={() => handleEmojiClick(`:${emoji.name}:`, true, emoji)}
                        />
                      ))}
                    </div>
                  </div>
                )}

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
                    <p className="text-[#8888aa] text-sm">No emojis found for "{search}"</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Footer with Add Emoji button */}
          <div className="border-t border-[#2a2a40] p-2 flex items-center justify-between bg-[#0f0f1a]">
            <div className="flex items-center gap-2 text-xs text-[#8888aa]">
              <span>Powered by Twemoji</span>
            </div>
            <button className="flex items-center gap-1.5 px-3 py-1.5 bg-[#8B5CF6] hover:bg-[#7C3AED] text-white text-xs font-semibold rounded-lg transition-colors">
              <Plus className="w-3.5 h-3.5" />
              Add Emoji
            </button>
          </div>
        </>
      )}
    </div>
  );
}

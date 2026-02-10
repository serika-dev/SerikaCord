"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Search, Loader2, ChevronLeft, TrendingUp, Grid3X3, Tag as TagIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface Gif {
  id: string;
  slug: string;
  title: string;
  url: string;
  thumbnailUrl?: string;
  webmUrl?: string;
  width?: number;
  height?: number;
}

interface Collection {
  id: string;
  name: string;
  slug: string;
  description?: string;
  gifCount: number;
  previewGifs: { url: string; thumbnailUrl?: string }[];
}

interface Tag {
  id: string;
  name: string;
  slug: string;
  count: number;
  previewUrl?: string;
}

interface GifPickerProps {
  onGifSelect: (gif: Gif) => void;
  apiKey?: string;
  className?: string;
}

const SERIKA_GIFS_API = "https://gifs.serika.dev/api";

type ViewMode = "home" | "trending" | "category" | "search";
type HomeTab = "tags" | "collections";

export function GifPicker({ onGifSelect, apiKey, className }: GifPickerProps) {
  const [search, setSearch] = useState("");
  const [gifs, setGifs] = useState<Gif[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("home");
  const [homeTab, setHomeTab] = useState<HomeTab>("tags");
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [selectedCategory, setSelectedCategory] = useState<{ type: "tag" | "collection"; item: Tag | Collection } | null>(null);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);

  const headers: HeadersInit = apiKey ? { "X-API-Key": apiKey } : {};

  // Format GIF response
  const formatGifs = (data: Record<string, unknown>[]): Gif[] => {
    return data.map((gif) => ({
      id: gif.id as string,
      slug: gif.slug as string,
      title: gif.title as string,
      url: gif.url as string,
      thumbnailUrl: gif.thumbnailUrl as string | undefined,
      webmUrl: gif.webmUrl as string | undefined,
      width: gif.width as number | undefined,
      height: gif.height as number | undefined,
    }));
  };

  // Fetch trending GIFs
  const fetchTrending = useCallback(async (page = 1, append = false) => {
    if (page === 1) setIsLoading(true);
    else setIsLoadingMore(true);
    
    try {
      const response = await fetch(
        `${SERIKA_GIFS_API}/gifs?sort=trending&limit=20&page=${page}`,
        { headers }
      );
      
      if (response.ok) {
        const data = await response.json();
        const formattedGifs = formatGifs(data.gifs || []);
        
        if (append) {
          setGifs(prev => [...prev, ...formattedGifs]);
        } else {
          setGifs(formattedGifs);
        }
        
        setTotalPages(data.pagination?.totalPages || 1);
        setCurrentPage(page);
      }
    } catch (error) {
      console.error("Failed to fetch trending GIFs:", error);
    } finally {
      setIsLoading(false);
      setIsLoadingMore(false);
    }
  }, [apiKey]);

  // Fetch collections
  const fetchCollections = useCallback(async () => {
    try {
      const response = await fetch(`${SERIKA_GIFS_API}/collections?limit=20`, { headers });
      
      if (response.ok) {
        const data = await response.json();
        setCollections(data.collections || []);
      }
    } catch (error) {
      console.error("Failed to fetch collections:", error);
    }
  }, [apiKey]);

  // Fetch tags with preview images
  const fetchTags = useCallback(async () => {
    try {
      const response = await fetch(`${SERIKA_GIFS_API}/tags?limit=10`, { headers });
      
      if (response.ok) {
        const data = await response.json();
        const tagsData = (data.tags || []).slice(0, 10);
        
        // Fetch preview image for each tag
        const tagsWithPreviews = await Promise.all(
          tagsData.map(async (tag: Tag) => {
            try {
              const gifResponse = await fetch(
                `${SERIKA_GIFS_API}/gifs?tag=${encodeURIComponent(tag.slug)}&limit=1`,
                { headers }
              );
              if (gifResponse.ok) {
                const gifData = await gifResponse.json();
                const firstGif = gifData.gifs?.[0];
                return {
                  ...tag,
                  previewUrl: firstGif?.thumbnailUrl || firstGif?.url || "",
                };
              }
            } catch {
              // Ignore individual tag preview errors
            }
            return tag;
          })
        );
        
        setTags(tagsWithPreviews);
      }
    } catch (error) {
      console.error("Failed to fetch tags:", error);
    }
  }, [apiKey]);

  // Fetch GIFs by tag
  const fetchByTag = useCallback(async (tagSlug: string, page = 1, append = false) => {
    if (page === 1) setIsLoading(true);
    else setIsLoadingMore(true);
    
    try {
      const response = await fetch(
        `${SERIKA_GIFS_API}/gifs?tag=${encodeURIComponent(tagSlug)}&limit=20&page=${page}`,
        { headers }
      );
      
      if (response.ok) {
        const data = await response.json();
        const formattedGifs = formatGifs(data.gifs || []);
        
        if (append) {
          setGifs(prev => [...prev, ...formattedGifs]);
        } else {
          setGifs(formattedGifs);
        }
        
        setTotalPages(data.pagination?.totalPages || 1);
        setCurrentPage(page);
      }
    } catch (error) {
      console.error("Failed to fetch GIFs by tag:", error);
    } finally {
      setIsLoading(false);
      setIsLoadingMore(false);
    }
  }, [apiKey]);

  // Fetch GIFs from collection
  const fetchCollectionGifs = useCallback(async (collectionId: string, page = 1, append = false) => {
    if (page === 1) setIsLoading(true);
    else setIsLoadingMore(true);
    
    try {
      const response = await fetch(
        `${SERIKA_GIFS_API}/collections/${collectionId}/gifs?limit=20&page=${page}`,
        { headers }
      );
      
      if (response.ok) {
        const data = await response.json();
        const formattedGifs = formatGifs(data.gifs || []);
        
        if (append) {
          setGifs(prev => [...prev, ...formattedGifs]);
        } else {
          setGifs(formattedGifs);
        }
        
        setTotalPages(data.pagination?.totalPages || 1);
        setCurrentPage(page);
      }
    } catch (error) {
      console.error("Failed to fetch collection GIFs:", error);
    } finally {
      setIsLoading(false);
      setIsLoadingMore(false);
    }
  }, [apiKey]);

  // Search GIFs
  const searchGifs = useCallback(async (query: string, page = 1, append = false) => {
    if (!query.trim()) {
      setViewMode("home");
      return;
    }

    if (page === 1) setIsLoading(true);
    else setIsLoadingMore(true);
    
    setViewMode("search");
    
    try {
      const response = await fetch(
        `${SERIKA_GIFS_API}/gifs?search=${encodeURIComponent(query)}&limit=20&page=${page}`,
        { headers }
      );
      
      if (response.ok) {
        const data = await response.json();
        const formattedGifs = formatGifs(data.gifs || []);
        
        if (append) {
          setGifs(prev => [...prev, ...formattedGifs]);
        } else {
          setGifs(formattedGifs);
        }
        
        setTotalPages(data.pagination?.totalPages || 1);
        setCurrentPage(page);
      }
    } catch (error) {
      console.error("Failed to search GIFs:", error);
    } finally {
      setIsLoading(false);
      setIsLoadingMore(false);
    }
  }, [apiKey]);

  // Initial load
  useEffect(() => {
    fetchTags();
    fetchCollections();
  }, [fetchTags, fetchCollections]);

  // Handle search input change with debounce
  const handleSearchChange = (value: string) => {
    setSearch(value);
    
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }
    
    searchTimeoutRef.current = setTimeout(() => {
      if (value.trim()) {
        searchGifs(value, 1);
      } else {
        setViewMode("home");
        setGifs([]);
      }
    }, 300);
  };

  // Load more when scrolling
  const loadMore = useCallback(() => {
    if (isLoadingMore || currentPage >= totalPages) return;
    
    const nextPage = currentPage + 1;
    
    switch (viewMode) {
      case "trending":
        fetchTrending(nextPage, true);
        break;
      case "search":
        searchGifs(search, nextPage, true);
        break;
      case "category":
        if (selectedCategory?.type === "tag") {
          fetchByTag((selectedCategory.item as Tag).slug, nextPage, true);
        } else if (selectedCategory?.type === "collection") {
          fetchCollectionGifs((selectedCategory.item as Collection).id, nextPage, true);
        }
        break;
    }
  }, [viewMode, currentPage, totalPages, isLoadingMore, search, selectedCategory, fetchTrending, searchGifs, fetchByTag, fetchCollectionGifs]);

  // Intersection observer for infinite scroll
  useEffect(() => {
    if (observerRef.current) {
      observerRef.current.disconnect();
    }

    observerRef.current = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !isLoading && !isLoadingMore && viewMode !== "home") {
          loadMore();
        }
      },
      { threshold: 0.1 }
    );

    if (loadMoreRef.current) {
      observerRef.current.observe(loadMoreRef.current);
    }

    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
    };
  }, [loadMore, isLoading, isLoadingMore, viewMode]);

  // Navigation handlers
  const goToTrending = () => {
    setViewMode("trending");
    setSearch("");
    setSelectedCategory(null);
    setCurrentPage(1);
    fetchTrending(1);
  };

  const goToCategory = (type: "tag" | "collection", item: Tag | Collection) => {
    setSelectedCategory({ type, item });
    setViewMode("category");
    setSearch("");
    setCurrentPage(1);
    if (type === "tag") {
      fetchByTag((item as Tag).slug, 1);
    } else {
      fetchCollectionGifs((item as Collection).id, 1);
    }
  };

  const goHome = () => {
    setViewMode("home");
    setSearch("");
    setSelectedCategory(null);
    setCurrentPage(1);
    setGifs([]);
  };

  // Get header title
  const getHeaderTitle = () => {
    switch (viewMode) {
      case "trending":
        return "Trending GIFs";
      case "category":
        return selectedCategory?.item?.name || "Category";
      case "search":
        return `Search: ${search}`;
      default:
        return null;
    }
  };

  // Get category background image
  const getCategoryBackground = (item: Tag | Collection, type: "tag" | "collection") => {
    if (type === "collection") {
      const col = item as Collection;
      return col.previewGifs?.[0]?.thumbnailUrl || col.previewGifs?.[0]?.url || "";
    }
    return "";
  };

  const showBackButton = viewMode !== "home";

  return (
    <div className={cn("w-[440px] h-[500px] bg-[#1e1f22] rounded-lg flex flex-col overflow-hidden", className)}>
      {/* Sub-header with back button when in category/trending view */}
      {showBackButton ? (
        <div className="flex items-center gap-2 px-4 py-2 border-b border-[#2b2d31] flex-shrink-0">
          <button
            onClick={goHome}
            className="p-1 hover:bg-[#2b2d31] rounded transition-colors"
          >
            <ChevronLeft className="w-5 h-5 text-[#b5bac1]" />
          </button>
          <span className="text-sm font-medium text-white">{getHeaderTitle()}</span>
        </div>
      ) : (
        // Home tabs
        <div className="flex gap-1 px-4 pt-3 pb-2 border-b border-[#2b2d31] flex-shrink-0">
          <button
            onClick={() => setHomeTab("tags")}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md transition-colors",
              homeTab === "tags"
                ? "text-white bg-[#5865f2]"
                : "text-[#b5bac1] hover:text-white hover:bg-[#2b2d31]"
            )}
          >
            <TagIcon className="w-4 h-4" />
            Tags
          </button>
          <button
            onClick={() => setHomeTab("collections")}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md transition-colors",
              homeTab === "collections"
                ? "text-white bg-[#5865f2]"
                : "text-[#b5bac1] hover:text-white hover:bg-[#2b2d31]"
            )}
          >
            <Grid3X3 className="w-4 h-4" />
            Collections
          </button>
        </div>
      )}

      {/* Search bar */}
      <div className="px-4 py-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#949ba4]" />
          <Input
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder="Search Serika"
            className="pl-10 bg-[#1e1f22] border-[#1e1f22] text-white placeholder:text-[#949ba4] h-10 rounded-md focus:ring-0 focus:border-[#1e1f22]"
            autoFocus
          />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto min-h-0 scrollbar-thin scrollbar-thumb-[#1a1b1e] scrollbar-track-transparent hover:scrollbar-thumb-[#2b2d31] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-[#1a1b1e] [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:border-2 [&::-webkit-scrollbar-thumb]:border-transparent hover:[&::-webkit-scrollbar-thumb]:bg-[#3b3d44]">
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 text-[#5865f2] animate-spin" />
          </div>
        ) : viewMode === "home" && !search ? (
          // Home view - Category tiles based on selected tab
          <div className="p-2 grid grid-cols-2 gap-2">
            {/* Trending GIFs tile - always show */}
            <button
              onClick={goToTrending}
              className="relative aspect-[16/9] rounded-lg overflow-hidden group"
            >
              <div className="absolute inset-0 bg-gradient-to-br from-[#5865f2] to-[#3b44a8]" />
              <div className="absolute inset-0 flex items-center justify-center gap-2">
                <TrendingUp className="w-5 h-5 text-white" />
                <span className="text-sm font-semibold text-white">Trending GIFs</span>
              </div>
              <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity" />
            </button>

            {homeTab === "collections" ? (
              // Collection tiles
              <>
                {collections.map((collection) => (
                  <button
                    key={collection.id}
                    onClick={() => goToCategory("collection", collection)}
                    className="relative aspect-[16/9] rounded-lg overflow-hidden group"
                  >
                    {/* Background image */}
                    {collection.previewGifs?.[0] && (
                      <img
                        src={collection.previewGifs[0].thumbnailUrl || collection.previewGifs[0].url}
                        alt=""
                        className="absolute inset-0 w-full h-full object-cover"
                        loading="lazy"
                      />
                    )}
                    {!collection.previewGifs?.[0] && (
                      <div className="absolute inset-0 bg-gradient-to-br from-[#2b2d31] to-[#1e1f22]" />
                    )}
                    {/* Overlay */}
                    <div className="absolute inset-0 bg-black/40 group-hover:bg-black/50 transition-colors" />
                    {/* Label */}
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="text-sm font-semibold text-white drop-shadow-lg">
                        {collection.name}
                      </span>
                    </div>
                  </button>
                ))}
              </>
            ) : (
              // Tag tiles with preview images
              <>
                {tags.slice(0, 10).map((tag) => (
                  <button
                    key={tag.id}
                    onClick={() => goToCategory("tag", tag)}
                    className="relative aspect-[16/9] rounded-lg overflow-hidden group"
                  >
                    {/* Background image from first GIF */}
                    {tag.previewUrl ? (
                      <img
                        src={tag.previewUrl}
                        alt=""
                        className="absolute inset-0 w-full h-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div className="absolute inset-0 bg-gradient-to-br from-[#2b2d31] to-[#1e1f22]" />
                    )}
                    {/* Overlay */}
                    <div className="absolute inset-0 bg-black/40 group-hover:bg-black/50 transition-colors" />
                    {/* Label */}
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="text-sm font-semibold text-white drop-shadow-lg capitalize">
                        {tag.name}
                      </span>
                    </div>
                  </button>
                ))}
              </>
            )}
          </div>
        ) : gifs.length === 0 && !isLoading ? (
          <div className="flex flex-col items-center justify-center py-20 text-[#949ba4]">
            <Search className="w-12 h-12 mb-3 opacity-50" />
            <p className="text-sm">No GIFs found</p>
            {search && (
              <button
                onClick={goHome}
                className="mt-3 text-[#5865f2] hover:underline text-sm"
              >
                Browse categories
              </button>
            )}
          </div>
        ) : (
          // GIF grid - masonry-like 2 column layout
          <div className="p-2">
            <div className="columns-2 gap-2 space-y-2">
              {gifs.map((gif) => (
                <button
                  key={gif.id}
                  onClick={() => onGifSelect(gif)}
                  className="relative w-full rounded-lg overflow-hidden hover:ring-2 hover:ring-[#5865f2] transition-all break-inside-avoid"
                  title={gif.title}
                >
                  <img
                    src={gif.url}
                    alt={gif.title}
                    className="w-full h-auto"
                    loading="lazy"
                  />
                </button>
              ))}
            </div>
            
            {/* Load more trigger */}
            {currentPage < totalPages && (
              <div ref={loadMoreRef} className="flex justify-center py-4">
                {isLoadingMore && (
                  <Loader2 className="w-5 h-5 text-[#5865f2] animate-spin" />
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-2 border-t border-[#2b2d31] flex items-center justify-center">
        <span className="text-xs text-[#949ba4]">
          Powered by{" "}
          <a
            href="https://gifs.serika.dev"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#5865f2] hover:underline"
          >
            SerikaGIFs
          </a>
        </span>
      </div>
    </div>
  );
}

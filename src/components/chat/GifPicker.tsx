"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Search, Loader2, ChevronLeft, TrendingUp, Grid3X3, Tag as TagIcon, X, Flame, Star, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useGifFavorites } from "@/hooks/useGifFavorites";

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
  className?: string;
}

const SERIKA_GIFS_API = "/api/gifs";
const GIF_PAGE_SIZE = 20;
const COLLECTION_PAGE_SIZE = 20;
const TAG_PAGE_SIZE = 10;
const MAX_PAGES = 50; // Safety cap to prevent infinite loading

type ViewMode = "home" | "trending" | "category" | "search";
type HomeTab = "trending" | "tags" | "collections" | "favorites";

export function GifPicker({ onGifSelect, className }: GifPickerProps) {
  const { favorites, removeFavorite } = useGifFavorites();
  const [search, setSearch] = useState("");
  const [gifs, setGifs] = useState<Gif[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("home");
  const [homeTab, setHomeTab] = useState<HomeTab>("trending");
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [collectionsPage, setCollectionsPage] = useState(1);
  const [collectionsTotalPages, setCollectionsTotalPages] = useState(1);
  const [tagsPage, setTagsPage] = useState(1);
  const [tagsTotalPages, setTagsTotalPages] = useState(1);
  const [selectedCategory, setSelectedCategory] = useState<{ type: "tag" | "collection"; item: Tag | Collection } | null>(null);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const gifsRef = useRef<Gif[]>([]);
  const noNewItemsRef = useRef(false);

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

  const resolveTotalPages = (apiTotalPages: unknown, page: number, resultCount: number, pageSize: number) => {
    if (typeof apiTotalPages === "number" && apiTotalPages > 0) {
      return Math.min(apiTotalPages, MAX_PAGES);
    }
    // If we got fewer than pageSize results, we've reached the end
    if (resultCount < pageSize) return page;
    // Otherwise allow one more page, but cap at MAX_PAGES
    return Math.min(page + 1, MAX_PAGES);
  };

  // Fetch trending GIFs
  const fetchTrending = useCallback(async (page = 1, append = false) => {
    if (page === 1) setIsLoading(true);
    else setIsLoadingMore(true);
    
    try {
      const response = await fetch(
        `${SERIKA_GIFS_API}/gifs?sort=trending&limit=${GIF_PAGE_SIZE}&page=${page}`
      );
      
      if (response.ok) {
        const data = await response.json();
        const formattedGifs = formatGifs(data.gifs || []);
        
        if (append) {
          const seen = new Set(gifsRef.current.map(g => g.id));
          const unique = formattedGifs.filter(g => !seen.has(g.id));
          if (unique.length === 0) {
            noNewItemsRef.current = true;
            setTotalPages(page); // No more pages
            return;
          }
          gifsRef.current = [...gifsRef.current, ...unique];
          setGifs(gifsRef.current);
        } else {
          gifsRef.current = formattedGifs;
          noNewItemsRef.current = false;
          setGifs(formattedGifs);
        }
        
        setTotalPages(resolveTotalPages(data.pagination?.totalPages, page, formattedGifs.length, GIF_PAGE_SIZE));
        setCurrentPage(page);
      }
    } catch (error) {
      console.error("Failed to fetch trending GIFs:", error);
    } finally {
      setIsLoading(false);
      setIsLoadingMore(false);
    }
  }, []);

  // Fetch collections
  const fetchCollections = useCallback(async (page = 1, append = false) => {
    if (append) setIsLoadingMore(true);
    try {
      const response = await fetch(`${SERIKA_GIFS_API}/collections?limit=${COLLECTION_PAGE_SIZE}&page=${page}`);
      
      if (response.ok) {
        const data = await response.json();
        const nextCollections = data.collections || [];
        if (append) {
          setCollections((prev) => {
            const seen = new Set(prev.map((item) => item.id));
            const uniqueNew = nextCollections.filter((item: Collection) => !seen.has(item.id));
            return [...prev, ...uniqueNew];
          });
        } else {
          setCollections(nextCollections);
        }
        setCollectionsTotalPages(
          resolveTotalPages(data.pagination?.totalPages, page, nextCollections.length, COLLECTION_PAGE_SIZE)
        );
        setCollectionsPage(page);
      }
    } catch (error) {
      console.error("Failed to fetch collections:", error);
    } finally {
      if (append) setIsLoadingMore(false);
    }
  }, []);

  // Fetch tags with preview images
  const fetchTags = useCallback(async (page = 1, append = false) => {
    if (append) setIsLoadingMore(true);
    try {
      const response = await fetch(`${SERIKA_GIFS_API}/tags?limit=${TAG_PAGE_SIZE}&page=${page}`);
      
      if (response.ok) {
        const data = await response.json();
        const rawTags: Record<string, unknown>[] = data.tags || [];
        const tagsWithPreviews: Tag[] = rawTags.map((t) => ({
          id: String(t.id ?? t.slug ?? t.name ?? ""),
          name: String(t.name ?? t.slug ?? ""),
          slug: String(t.slug ?? t.name ?? ""),
          count: Number(t.count ?? 0),
          previewUrl: (t.previewUrl as string) || (t.preview_url as string) || (t.preview as string) || undefined,
        }));
        
        if (append) {
          setTags((prev) => {
            const seen = new Set(prev.map((item) => item.id));
            const uniqueNew = tagsWithPreviews.filter((item: Tag) => !seen.has(item.id));
            return [...prev, ...uniqueNew];
          });
        } else {
          setTags(tagsWithPreviews);
        }
        setTagsTotalPages(resolveTotalPages(data.pagination?.totalPages, page, tagsWithPreviews.length, TAG_PAGE_SIZE));
        setTagsPage(page);
      }
    } catch (error) {
      console.error("Failed to fetch tags:", error);
    } finally {
      if (append) setIsLoadingMore(false);
    }
  }, []);

  // Fetch GIFs by tag
  const fetchByTag = useCallback(async (tagSlug: string, page = 1, append = false) => {
    if (page === 1) setIsLoading(true);
    else setIsLoadingMore(true);
    
    try {
      const response = await fetch(
        `${SERIKA_GIFS_API}/gifs?tag=${encodeURIComponent(tagSlug)}&limit=${GIF_PAGE_SIZE}&page=${page}`
      );
      
      if (response.ok) {
        const data = await response.json();
        const formattedGifs = formatGifs(data.gifs || []);
        
        if (append) {
          const seen = new Set(gifsRef.current.map(g => g.id));
          const unique = formattedGifs.filter(g => !seen.has(g.id));
          if (unique.length === 0) {
            noNewItemsRef.current = true;
            setTotalPages(page);
            return;
          }
          gifsRef.current = [...gifsRef.current, ...unique];
          setGifs(gifsRef.current);
        } else {
          gifsRef.current = formattedGifs;
          noNewItemsRef.current = false;
          setGifs(formattedGifs);
        }
        
        setTotalPages(resolveTotalPages(data.pagination?.totalPages, page, formattedGifs.length, GIF_PAGE_SIZE));
        setCurrentPage(page);
      }
    } catch (error) {
      console.error("Failed to fetch GIFs by tag:", error);
    } finally {
      setIsLoading(false);
      setIsLoadingMore(false);
    }
  }, []);

  // Fetch GIFs from collection
  const fetchCollectionGifs = useCallback(async (collectionId: string, page = 1, append = false) => {
    if (page === 1) setIsLoading(true);
    else setIsLoadingMore(true);
    
    try {
      const response = await fetch(
        `${SERIKA_GIFS_API}/gifs?collection=${encodeURIComponent(collectionId)}&limit=${GIF_PAGE_SIZE}&page=${page}`
      );
      
      if (response.ok) {
        const data = await response.json();
        const formattedGifs = formatGifs(data.gifs || []);
        
        if (append) {
          const seen = new Set(gifsRef.current.map(g => g.id));
          const unique = formattedGifs.filter(g => !seen.has(g.id));
          if (unique.length === 0) {
            noNewItemsRef.current = true;
            setTotalPages(page);
            return;
          }
          gifsRef.current = [...gifsRef.current, ...unique];
          setGifs(gifsRef.current);
        } else {
          gifsRef.current = formattedGifs;
          noNewItemsRef.current = false;
          setGifs(formattedGifs);
        }
        
        setTotalPages(resolveTotalPages(data.pagination?.totalPages, page, formattedGifs.length, GIF_PAGE_SIZE));
        setCurrentPage(page);
      }
    } catch (error) {
      console.error("Failed to fetch collection GIFs:", error);
    } finally {
      setIsLoading(false);
      setIsLoadingMore(false);
    }
  }, []);

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
        `${SERIKA_GIFS_API}/gifs?search=${encodeURIComponent(query)}&limit=${GIF_PAGE_SIZE}&page=${page}`
      );
      
      if (response.ok) {
        const data = await response.json();
        const formattedGifs = formatGifs(data.gifs || []);
        
        if (append) {
          const seen = new Set(gifsRef.current.map(g => g.id));
          const unique = formattedGifs.filter(g => !seen.has(g.id));
          if (unique.length === 0) {
            noNewItemsRef.current = true;
            setTotalPages(page);
            return;
          }
          gifsRef.current = [...gifsRef.current, ...unique];
          setGifs(gifsRef.current);
        } else {
          gifsRef.current = formattedGifs;
          noNewItemsRef.current = false;
          setGifs(formattedGifs);
        }
        
        setTotalPages(resolveTotalPages(data.pagination?.totalPages, page, formattedGifs.length, GIF_PAGE_SIZE));
        setCurrentPage(page);
      }
    } catch (error) {
      console.error("Failed to search GIFs:", error);
    } finally {
      setIsLoading(false);
      setIsLoadingMore(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    fetchTrending(1, false);
    fetchTags(1, false);
    fetchCollections(1, false);
  }, [fetchTrending, fetchTags, fetchCollections]);

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
    if (isLoadingMore || noNewItemsRef.current) return;

    if (viewMode === "home") {
      if (homeTab === "favorites") return;
      if (homeTab === "trending") {
        if (currentPage >= totalPages) return;
        fetchTrending(currentPage + 1, true);
      } else if (homeTab === "tags") {
        if (tagsPage >= tagsTotalPages) return;
        fetchTags(tagsPage + 1, true);
      } else if (homeTab === "collections") {
        if (collectionsPage >= collectionsTotalPages) return;
        fetchCollections(collectionsPage + 1, true);
      }
      return;
    }

    if (currentPage >= totalPages) return;

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
  }, [
    viewMode,
    homeTab,
    currentPage,
    totalPages,
    tagsPage,
    tagsTotalPages,
    collectionsPage,
    collectionsTotalPages,
    isLoadingMore,
    search,
    selectedCategory,
    fetchTags,
    fetchCollections,
    fetchTrending,
    searchGifs,
    fetchByTag,
    fetchCollectionGifs,
  ]);

  // Intersection observer for infinite scroll
  useEffect(() => {
    if (observerRef.current) {
      observerRef.current.disconnect();
    }

    observerRef.current = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !isLoading && !isLoadingMore) {
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
  }, [loadMore, isLoading, isLoadingMore, viewMode, homeTab]);

  const canLoadMore = viewMode === "home"
    ? (homeTab === "trending" ? currentPage < totalPages : homeTab === "tags" ? tagsPage < tagsTotalPages : homeTab === "collections" ? collectionsPage < collectionsTotalPages : false)
    : currentPage < totalPages;

  // Navigation handlers
  const goToTrending = () => {
    setViewMode("trending");
    setSearch("");
    setSelectedCategory(null);
    setCurrentPage(1);
    noNewItemsRef.current = false;
    fetchTrending(1);
  };

  const goToCategory = (type: "tag" | "collection", item: Tag | Collection) => {
    setSelectedCategory({ type, item });
    setViewMode("category");
    setSearch("");
    setCurrentPage(1);
    noNewItemsRef.current = false;
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
    noNewItemsRef.current = false;
    gifsRef.current = [];
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
  const showBackButton = viewMode !== "home";

  const SkeletonTile = () => (
    <div className="relative aspect-[16/9] rounded-lg overflow-hidden bg-[#2b2d31] animate-pulse" />
  );

  const SkeletonGif = ({ tall }: { tall?: boolean }) => (
    <div className={cn("w-full rounded-lg bg-[#2b2d31] animate-pulse break-inside-avoid mb-2", tall ? "h-32" : "h-20")} />
  );

  return (
    <div className={cn(
      "w-full max-w-[440px] h-[480px] bg-[#1e1f22] rounded-xl flex flex-col overflow-hidden shadow-2xl border border-[#2b2d31]/60",
      className
    )}>
      {/* Header: back button or home tabs */}
      {showBackButton ? (
        <div className="flex items-center gap-2 px-3 py-2 border-b border-[#2b2d31] flex-shrink-0">
          <button
            onClick={goHome}
            className="p-1.5 hover:bg-[#2b2d31] rounded-md transition-colors"
          >
            <ChevronLeft className="w-4 h-4 text-[#b5bac1]" />
          </button>
          <span className="text-sm font-semibold text-white truncate">{getHeaderTitle()}</span>
        </div>
      ) : (
        <div className="flex gap-0.5 px-3 pt-2.5 pb-0 border-b border-[#2b2d31] flex-shrink-0">
          {([
            { id: "trending", label: "Trending", icon: <Flame className="w-3.5 h-3.5" /> },
            { id: "tags",     label: "Tags",     icon: <TagIcon className="w-3.5 h-3.5" /> },
            { id: "collections", label: "Collections", icon: <Grid3X3 className="w-3.5 h-3.5" /> },
            { id: "favorites", label: "Favorites", icon: <Star className="w-3.5 h-3.5" /> },
          ] as { id: HomeTab; label: string; icon: React.ReactNode }[]).map((tab) => (
            <button
              key={tab.id}
              onClick={() => setHomeTab(tab.id)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-t-md transition-all border-b-2 -mb-px",
                homeTab === tab.id
                  ? "text-white border-[#5865f2] bg-[#5865f2]/10"
                  : "text-[#949ba4] border-transparent hover:text-[#d5d9e8] hover:bg-[#2b2d31]/50"
              )}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>
      )}

      {/* Search bar */}
      <div className="px-3 py-2 flex-shrink-0">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#949ba4]" />
          <Input
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder="Search GIFs…"
            className="pl-9 pr-8 bg-[#111214] border-[#2b2d31] text-white placeholder:text-[#949ba4] h-9 text-sm rounded-lg focus:ring-1 focus:ring-[#5865f2]/50 focus:border-[#5865f2]/50"
            autoFocus
          />
          {search && (
            <button
              onClick={() => { handleSearchChange(""); }}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 hover:bg-[#2b2d31] rounded transition-colors"
            >
              <X className="w-3.5 h-3.5 text-[#949ba4]" />
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto min-h-0 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-[#2b2d31] [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-[#3b3d44]">
        {isLoading ? (
          /* Skeleton loaders */
          viewMode === "home" && !search ? (
            <div className="p-2 grid grid-cols-2 gap-2">
              {Array.from({ length: 8 }).map((_, i) => <SkeletonTile key={i} />)}
            </div>
          ) : (
            <div className="p-2 columns-2 gap-2">
              {Array.from({ length: 10 }).map((_, i) => <SkeletonGif key={i} tall={i % 3 === 0} />)}
            </div>
          )
        ) : viewMode === "home" && !search ? (
          /* Home tabs: trending gifs grid OR category tiles */
          homeTab === "trending" ? (
            gifs.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-[#949ba4]">
                <Flame className="w-10 h-10 mb-3 opacity-30" />
                <p className="text-sm">No trending GIFs right now</p>
              </div>
            ) : (
              <div className="p-2">
                <div className="columns-2 gap-2">
                  {gifs.map((gif) => (
                    <button
                      key={gif.id}
                      onClick={() => onGifSelect(gif)}
                      title={gif.title}
                      className="relative w-full rounded-lg overflow-hidden hover:ring-2 hover:ring-[#5865f2] hover:brightness-90 transition-all break-inside-avoid mb-2 group"
                    >
                      <img src={gif.thumbnailUrl || gif.url} alt={gif.title} className="w-full h-auto block" loading="lazy" />
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors" />
                    </button>
                  ))}
                </div>
                {canLoadMore && (
                  <div ref={loadMoreRef} className="flex justify-center py-3">
                    {isLoadingMore && <Loader2 className="w-4 h-4 text-[#5865f2] animate-spin" />}
                  </div>
                )}
              </div>
            )
          ) : homeTab === "favorites" ? (
            favorites.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-[#949ba4]">
                <Star className="w-10 h-10 mb-3 opacity-30" />
                <p className="text-sm">No favorite GIFs yet</p>
                <p className="text-xs text-[#6b7387] mt-1">Star GIFs in chat to save them here</p>
              </div>
            ) : (
              <div className="p-2">
                <div className="columns-2 gap-2">
                  {favorites.map((fav) => (
                    <div
                      key={fav.url}
                      className="relative w-full rounded-lg overflow-hidden hover:ring-2 hover:ring-[#5865f2] hover:brightness-90 transition-all break-inside-avoid mb-2 group"
                    >
                      <button
                        onClick={() =>
                          onGifSelect({
                            id: fav.url,
                            slug: "",
                            title: fav.title || "Favorite",
                            url: fav.url,
                            thumbnailUrl: fav.url,
                          })
                        }
                        title={fav.title || "Favorite GIF"}
                        className="w-full"
                      >
                        <img
                          src={fav.url}
                          alt={fav.title || "Favorite GIF"}
                          className="w-full h-auto block"
                          loading="lazy"
                        />
                      </button>
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          removeFavorite(fav.url);
                        }}
                        className="absolute top-1.5 right-1.5 p-1.5 rounded-full bg-black/60 hover:bg-red-500/80 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                        title="Remove from favorites"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )
          ) : (
            <div className="p-2 grid grid-cols-2 gap-2">
              {(homeTab === "collections" ? collections : tags).map((item) => {
                const isCollection = homeTab === "collections";
                const col = item as Collection;
                const tag = item as Tag;
                const bgImg = isCollection
                  ? col.previewGifs?.[0]?.thumbnailUrl || col.previewGifs?.[0]?.url
                  : tag.previewUrl;
                return (
                  <button
                    key={item.id}
                    onClick={() => goToCategory(isCollection ? "collection" : "tag", item)}
                    className="relative aspect-[16/9] rounded-lg overflow-hidden group"
                  >
                    {bgImg ? (
                      <img src={bgImg} alt="" className="absolute inset-0 w-full h-full object-cover" loading="lazy" />
                    ) : (
                      <div className="absolute inset-0 bg-gradient-to-br from-[#2b2d31] to-[#1e1f22]" />
                    )}
                    <div className="absolute inset-0 bg-black/40 group-hover:bg-black/55 transition-colors" />
                    <div className="absolute inset-0 flex items-end p-2">
                      <span className="text-xs font-bold text-white drop-shadow-md capitalize leading-tight line-clamp-2">
                        {item.name}
                      </span>
                    </div>
                  </button>
                );
              })}
              {(homeTab === "collections" ? collections.length : tags.length) === 0 && (
                <div className="col-span-2 flex flex-col items-center justify-center py-12 text-[#949ba4]">
                  <Grid3X3 className="w-10 h-10 mb-3 opacity-30" />
                  <p className="text-sm">Nothing here yet</p>
                </div>
              )}
              {canLoadMore && (
                <div ref={loadMoreRef} className="col-span-2 flex justify-center py-3">
                  {isLoadingMore && <Loader2 className="w-4 h-4 text-[#5865f2] animate-spin" />}
                </div>
              )}
            </div>
          )
        ) : gifs.length === 0 && !isLoading ? (
          <div className="flex flex-col items-center justify-center py-16 text-[#949ba4]">
            <Search className="w-10 h-10 mb-3 opacity-30" />
            <p className="text-sm font-medium">No GIFs found</p>
            {search && (
              <p className="text-xs mt-1 text-[#6b7387]">Try a different search term</p>
            )}
            <button
              onClick={() => handleSearchChange("")}
              className="mt-4 px-4 py-1.5 text-xs font-medium bg-[#5865f2]/20 hover:bg-[#5865f2]/30 text-[#7289da] rounded-full transition-colors"
            >
              Clear search
            </button>
          </div>
        ) : (
          <div className="p-2">
            <div className="columns-2 gap-2">
              {gifs.map((gif) => (
                <button
                  key={gif.id}
                  onClick={() => onGifSelect(gif)}
                  title={gif.title}
                  className="relative w-full rounded-lg overflow-hidden hover:ring-2 hover:ring-[#5865f2] hover:brightness-90 transition-all break-inside-avoid mb-2 group"
                >
                  <img src={gif.thumbnailUrl || gif.url} alt={gif.title} className="w-full h-auto block" loading="lazy" />
                  <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/60 to-transparent p-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <p className="text-[10px] text-white leading-tight line-clamp-1">{gif.title}</p>
                  </div>
                </button>
              ))}
            </div>
            {canLoadMore && (
              <div ref={loadMoreRef} className="flex justify-center py-3">
                {isLoadingMore && <Loader2 className="w-4 h-4 text-[#5865f2] animate-spin" />}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-3 py-1.5 border-t border-[#2b2d31] flex items-center justify-center flex-shrink-0">
        <span className="text-[10px] text-[#6b7387]">
          Powered by{" "}
          <a href="https://gifs.serika.dev" target="_blank" rel="noopener noreferrer" className="text-[#5865f2] hover:underline">
            SerikaGIFs
          </a>
        </span>
      </div>
    </div>
  );
}

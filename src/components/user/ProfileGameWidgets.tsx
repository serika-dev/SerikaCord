"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Plus, X, Search, Star, Gamepad2, RotateCw, Bookmark, ChevronLeft, ChevronRight, ChevronUp, ChevronDown, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn, cdnImage } from "@/lib/utils";
import { useGT } from "gt-next";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

// ── Types ──────────────────────────────────────────────────────────────────
export type GameCategory = "favorite" | "liked" | "rotation" | "wishlist";

export interface LibraryGame {
  id: string;
  igdbId: number | null;
  steamAppId: string | null;
  name: string;
  coverUrl: string | null;
  category: GameCategory;
  tags: string[];
  note: string | null;
  position: number;
}

type Library = Record<GameCategory, LibraryGame[]>;

const EMPTY_LIBRARY: Library = { favorite: [], liked: [], rotation: [], wishlist: [] };

export const CATEGORY_LIMITS: Record<GameCategory, number> = { favorite: 1, liked: 20, rotation: 5, wishlist: 20 };

// ── Data hooks ───────────────────────────────────────────────────────────────
function useLibrary(userId: string) {
  const [library, setLibrary] = useState<Library>(EMPTY_LIBRARY);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    try {
      const res = await fetch(`/api/users/${userId}/games`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      setLibrary({ ...EMPTY_LIBRARY, ...(data.library || {}) });
    } catch {
      /* leave empty */
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { setLoading(true); refetch(); }, [refetch]);

  return { library, loading, setLibrary, refetch };
}

// ── Game cover card ──────────────────────────────────────────────────────────
function GameCover({ game, size = "md" }: { game: LibraryGame; size?: "sm" | "md" | "lg" }) {
  const dims = size === "lg" ? "w-16 h-16" : size === "sm" ? "w-12 h-12" : "w-full aspect-[3/4]";
  return game.coverUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={cdnImage(game.coverUrl)} alt={game.name} className={cn(dims, "rounded-lg object-cover")} />
  ) : (
    <div className={cn(dims, "rounded-lg bg-gradient-to-br from-white/[0.06] to-white/[0.02] flex flex-col items-center justify-center p-1 border border-white/[0.05]")}>
      <Gamepad2 className="w-1/4 h-1/4 text-white/20" />
      <span className="text-[8px] text-white/40 text-center truncate max-w-full mt-0.5">{game.name}</span>
    </div>
  );
}

function AddPosterButton({ onClick, cols = 4 }: { onClick: () => void; cols?: number }) {
  return (
    <button
      onClick={onClick}
      className={cn(cols === 5 ? "aspect-[3/4]" : "aspect-[3/4]", "rounded-lg border-2 border-dashed border-white/10 hover:border-[#8B5CF6]/50 bg-white/[0.02] hover:bg-[#8B5CF6]/[0.04] flex items-center justify-center transition-colors group/add")}
    >
      <Plus className="w-5 h-5 text-white/20 group-hover/add:text-[#8B5CF6] transition-colors" />
    </button>
  );
}

// ── Add-game search dialog ────────────────────────────────────────────────────
type GameTagType = "skill" | "rating" | "lookingFor";

function TagPicker({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div>
      <p className="text-[10px] text-white/40 mb-1.5 uppercase tracking-wide">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <button
            key={o.value}
            onClick={() => onChange(o.value === value ? "" : o.value)}
            className={cn(
              "px-2.5 py-1 rounded-full text-[10px] border transition-colors",
              o.value === value
                ? "bg-[#8B5CF6] border-[#8B5CF6] text-white"
                : "bg-white/[0.04] border-white/[0.08] text-white/60 hover:bg-white/[0.08]"
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function AddGameDialog({
  open, onOpenChange, category, allLibrary, onAdded,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  category: GameCategory;
  allLibrary: Library;
  onAdded: (game: LibraryGame) => void;
}) {
  const gt = useGT();
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<{ id: number; name: string; coverUrl: string | null }[]>([]);
  const [adding, setAdding] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [tags, setTags] = useState<Record<GameTagType, string>>({ skill: "", rating: "", lookingFor: "" });

  useEffect(() => {
    if (!open) {
      setQuery("");
      setResults([]);
      setAdding(null);
      setNote("");
      setTags({ skill: "", rating: "", lookingFor: "" });
      setSearching(false);
    }
  }, [open]);

  // Debounced IGDB search returning up to 3 results.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setResults([]); return; }
    setSearching(true);
    const handle = setTimeout(async () => {
      try {
        const res = await fetch(`/api/igdb/games?query=${encodeURIComponent(q)}`);
        const data = await res.json();
        setResults(Array.isArray(data.games) ? data.games : []);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 400);
    return () => clearTimeout(handle);
  }, [query]);

  const existingSet = useMemo(() => {
    const s = new Set<string | number>();
    for (const cat of Object.values(allLibrary)) {
      for (const g of cat) {
        if (g.igdbId != null) s.add(g.igdbId);
        s.add(g.name.toLowerCase());
      }
    }
    return s;
  }, [allLibrary]);

  const visibleResults = results
    .filter((r) => !existingSet.has(r.id) && !existingSet.has(r.name.toLowerCase()))
    .slice(0, 3);

  const selectedTags = [tags.skill, tags.rating, tags.lookingFor].filter(Boolean);
  const canAddCustom = query.trim().length >= 2 && !visibleResults.some((r) => r.name.toLowerCase() === query.trim().toLowerCase());

  const submit = async (game: { id?: number; name: string; coverUrl?: string | null }) => {
    const key = game.id?.toString() ?? game.name;
    setAdding(key);
    try {
      const res = await fetch(`/api/users/@me/games`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category,
          igdbId: game.id,
          name: game.name,
          coverUrl: game.coverUrl ?? undefined,
          tags: selectedTags.length > 0 ? selectedTags : undefined,
          note: note.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to add game");
      onAdded(data.game);
      onOpenChange(false);
      toast.success(gt("Added to your profile"));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setAdding(null);
    }
  };

  const tagOptions = useCallback((gt: ReturnType<typeof useGT>) => ({
    skill: [
      { value: "None", label: gt("None") },
      { value: "Casual", label: gt("Casual") },
      { value: "Intermediate", label: gt("Intermediate") },
      { value: "Expert", label: gt("Expert") },
      { value: "Better than you", label: gt("Better than you") },
    ],
    rating: [
      { value: "Obsessed", label: gt("Obsessed") },
      { value: "Love It", label: gt("Love It") },
      { value: "Kind of love it", label: gt("Kind of love it") },
      { value: "Kind of hate it", label: gt("Kind of hate it") },
      { value: "Ragequitting", label: gt("Ragequitting") },
    ],
    lookingFor: [
      { value: "Looking for group", label: gt("Looking for group") },
      { value: "Open to play", label: gt("Open to play") },
      { value: "Looking for tips", label: gt("Looking for tips") },
      { value: "Open to teach", label: gt("Open to teach") },
      { value: "Looking to discuss", label: gt("Looking to discuss") },
    ],
  }), []);

  const options = tagOptions(gt);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[#0c0c10] border-white/[0.08] sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-white">{gt("Add a game")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 max-h-[70vh] overflow-y-auto">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={gt("Search for a game…")}
              className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg pl-9 pr-3 py-2.5 text-sm text-white placeholder:text-white/40 focus:outline-none focus:border-[#8B5CF6]"
            />
          </div>

          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={gt("Add a note…")}
            rows={2}
            className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-xs text-white placeholder:text-white/40 focus:outline-none focus:border-[#8B5CF6] resize-none"
          />

          <div className="space-y-3">
            <TagPicker label={gt("Skill level")} value={tags.skill} onChange={(v) => setTags((t) => ({ ...t, skill: v }))} options={options.skill} />
            <TagPicker label={gt("Rating")} value={tags.rating} onChange={(v) => setTags((t) => ({ ...t, rating: v }))} options={options.rating} />
            <TagPicker label={gt("Looking for")} value={tags.lookingFor} onChange={(v) => setTags((t) => ({ ...t, lookingFor: v }))} options={options.lookingFor} />
          </div>

          <div className="min-h-[80px] space-y-1">
            {searching ? (
              <div className="flex items-center justify-center py-6 text-white/40">
                <Loader2 className="w-5 h-5 animate-spin" />
              </div>
            ) : visibleResults.length > 0 ? (
              visibleResults.map((game) => (
                <button
                  key={game.id ?? game.name}
                  disabled={!!adding}
                  onClick={() => submit({ id: game.id, name: game.name, coverUrl: game.coverUrl })}
                  className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-white/[0.06] transition-colors text-left disabled:opacity-50"
                >
                  <GameCover game={{ ...(game as unknown as LibraryGame), coverUrl: game.coverUrl }} size="sm" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white font-medium truncate">{game.name}</p>
                    <p className="text-xs text-white/40">{gt("Click to add")}</p>
                  </div>
                  {adding === (game.id?.toString() ?? game.name) && <Loader2 className="w-4 h-4 animate-spin text-white/60" />}
                </button>
              ))
            ) : canAddCustom ? (
              <button
                disabled={!!adding}
                onClick={() => submit({ name: query.trim() })}
                className="w-full text-left p-2 rounded-lg hover:bg-white/[0.06] text-sm text-white/70 disabled:opacity-50"
              >
                {gt('Add "{q}" anyway', { q: query.trim() })}
              </button>
            ) : query.trim().length >= 2 ? (
              <p className="text-xs text-white/30 text-center py-6">{gt("No new matches")}</p>
            ) : (
              <p className="text-xs text-white/30 text-center py-6">{gt("Type at least 2 characters")}</p>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Section shell ─────────────────────────────────────────────────────────────
function SectionHeader({ icon: Icon, title, subtitle, onMoveUp, onMoveDown }: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  subtitle?: string;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
}) {
  return (
    <div className="flex items-center justify-between mb-2 group/hdr">
      <div className="flex items-center gap-2">
        <Icon className="w-3.5 h-3.5 text-[#8B5CF6]" />
        <h4 className="text-[11px] font-bold text-[#9a9aad] uppercase tracking-wide">{title}</h4>
        {subtitle && <span className="text-[10px] text-white/30">{subtitle}</span>}
      </div>
      {(onMoveUp || onMoveDown) && (
        <div className="flex items-center gap-0.5 opacity-0 group-hover/hdr:opacity-100 transition-opacity">
          {onMoveUp && <button onClick={onMoveUp} className="p-0.5 rounded hover:bg-white/10 text-white/40 hover:text-white"><ChevronUp className="w-3 h-3" /></button>}
          {onMoveDown && <button onClick={onMoveDown} className="p-0.5 rounded hover:bg-white/10 text-white/40 hover:text-white"><ChevronDown className="w-3 h-3" /></button>}
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
// `addCategory`/`setAddCategory` are controlled by the parent so the single
// "Add Widget" popup can drive the game-add dialog. Empty categories are never
// rendered — nothing is forced onto the profile by default.
const DEFAULT_SECTION_ORDER: GameCategory[] = ["favorite", "liked", "rotation", "wishlist"];
const SECTION_STORAGE_KEY = "serika:game-widget-order";

export function ProfileGameWidgets({ userId, isSelf, addCategory, setAddCategory }: {
  userId: string;
  isSelf: boolean;
  addCategory: GameCategory | null;
  setAddCategory: (c: GameCategory | null) => void;
}) {
  const gt = useGT();
  const { library, loading, setLibrary, refetch } = useLibrary(userId);
  const [showAllLiked, setShowAllLiked] = useState(false);
  const [showAllWishlist, setShowAllWishlist] = useState(false);
  const [sectionOrder, setSectionOrder] = useState<GameCategory[]>(() => {
    if (typeof window === "undefined") return DEFAULT_SECTION_ORDER;
    try {
      const saved = localStorage.getItem(SECTION_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as GameCategory[];
        if (Array.isArray(parsed) && parsed.length === 4) return parsed;
      }
    } catch {}
    return DEFAULT_SECTION_ORDER;
  });

  const moveSection = (cat: GameCategory, dir: -1 | 1) => {
    setSectionOrder((prev) => {
      const idx = prev.indexOf(cat);
      const next = idx + dir;
      if (next < 0 || next >= prev.length) return prev;
      const arr = [...prev];
      [arr[idx], arr[next]] = [arr[next], arr[idx]];
      try { localStorage.setItem(SECTION_STORAGE_KEY, JSON.stringify(arr)); } catch {}
      return arr;
    });
  };

  const remove = async (game: LibraryGame) => {
    // Optimistic
    setLibrary((prev) => ({ ...prev, [game.category]: prev[game.category].filter((g) => g.id !== game.id) }));
    try {
      const res = await fetch(`/api/users/@me/games/${game.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
    } catch {
      toast.error(gt("Failed to remove game"));
      refetch();
    }
  };

  const move = async (game: LibraryGame, dir: -1 | 1) => {
    const list = [...library[game.category]];
    const idx = list.findIndex((g) => g.id === game.id);
    const next = idx + dir;
    if (next < 0 || next >= list.length) return;
    [list[idx], list[next]] = [list[next], list[idx]];
    setLibrary((prev) => ({ ...prev, [game.category]: list }));
    try {
      await fetch(`/api/users/@me/games/reorder`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: game.category, orderedIds: list.map((g) => g.id) }),
      });
    } catch {
      refetch();
    }
  };

  const onAdded = (game: LibraryGame) => {
    setLibrary((prev) => ({ ...prev, [game.category]: [...prev[game.category], game] }));
  };

  const hasAnything = Object.values(library).some((l) => l.length > 0);
  if (loading) {
    return <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-white/30" /></div>;
  }
  if (!isSelf && !hasAnything) return null;

  const editControls = (game: LibraryGame, ordered: boolean) => isSelf && (
    <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1 bg-black/50 rounded-lg">
      {ordered && (
        <button onClick={() => move(game, -1)} className="p-1 rounded bg-black/60 hover:bg-black/80 text-white"><ChevronLeft className="w-3.5 h-3.5" /></button>
      )}
      <button onClick={() => remove(game)} className="p-1 rounded bg-red-500/80 hover:bg-red-500 text-white"><X className="w-3.5 h-3.5" /></button>
      {ordered && (
        <button onClick={() => move(game, 1)} className="p-1 rounded bg-black/60 hover:bg-black/80 text-white"><ChevronRight className="w-3.5 h-3.5" /></button>
      )}
    </div>
  );

  // Grid renderer for liked / wishlist (show 8, then show-more → 2 rows of 4).
  const renderGrid = (category: "liked" | "wishlist", showAll: boolean, setShowAll: (v: boolean) => void, icon: React.ComponentType<{ className?: string }>, title: string) => {
    const games = library[category];
    const limit = CATEGORY_LIMITS[category];
    const isFull = games.length >= limit;
    if (games.length === 0 && !isSelf) return null;
    if (games.length === 0 && isSelf) {
      return (
        <div className="rounded-xl bg-white/[0.02] border border-white/[0.05] p-3">
          <SectionHeader
            icon={icon}
            title={title}
            subtitle={`0/${limit}`}
            onMoveUp={() => moveSection(category, -1)}
            onMoveDown={() => moveSection(category, 1)}
          />
          <div className="grid grid-cols-4 gap-2">
            <AddPosterButton onClick={() => setAddCategory(category)} />
          </div>
        </div>
      );
    }
    const visible = showAll ? games : games.slice(0, 8);
    const showAddPoster = isSelf && !isFull && (visible.length < 8 || showAll);
    return (
      <div className="rounded-xl bg-white/[0.02] border border-white/[0.05] p-3">
        <SectionHeader
          icon={icon}
          title={title}
          subtitle={`${games.length}/${limit}`}
          onMoveUp={isSelf ? () => moveSection(category, -1) : undefined}
          onMoveDown={isSelf ? () => moveSection(category, 1) : undefined}
        />
        <div className="grid grid-cols-4 gap-2">
          {visible.map((game) => (
            <div key={game.id} className="group relative" title={game.name}>
              <GameCover game={game} />
              {game.tags.length > 0 && (
                <div className="flex flex-wrap gap-0.5 mt-1">
                  {game.tags.slice(0, 2).map((txt) => (
                    <span key={txt} className="text-[8px] px-1 py-0.5 rounded bg-[#8B5CF6]/20 text-[#c4b5fd] truncate max-w-full">{txt}</span>
                  ))}
                  {game.tags.length > 2 && (
                    <span className="text-[8px] px-1 py-0.5 rounded bg-white/[0.06] text-white/40">+{game.tags.length - 2}</span>
                  )}
                </div>
              )}
              {editControls(game, true)}
            </div>
          ))}
          {showAddPoster && <AddPosterButton onClick={() => setAddCategory(category)} />}
        </div>
        {games.length > 8 && (
          <button onClick={() => setShowAll(!showAll)} className="mt-2 text-xs text-[#8B5CF6] hover:underline">
            {showAll ? gt("Show less") : gt("Show more")}
          </button>
        )}
        {isSelf && !showAddPoster && games.length >= 8 && !showAll && !isFull && (
          <button onClick={() => setAddCategory(category)} className="mt-2 w-full py-2 rounded-lg border border-dashed border-white/10 hover:border-[#8B5CF6]/50 text-xs text-white/40 hover:text-[#8B5CF6] transition-colors flex items-center justify-center gap-1.5">
            <Plus className="w-3.5 h-3.5" /> {gt("Add more")}
          </button>
        )}
      </div>
    );
  };

  const favorite = library.favorite[0];

  const renderSection = (cat: GameCategory) => {
    if (cat === "favorite") {
      if (!favorite && !isSelf) return null;
      return (
        <div key="favorite" className="rounded-xl bg-white/[0.02] border border-white/[0.05] p-3">
          <SectionHeader
            icon={Star}
            title={gt("Favorite game")}
            subtitle={favorite ? `1/${CATEGORY_LIMITS.favorite}` : `0/${CATEGORY_LIMITS.favorite}`}
            onMoveUp={isSelf ? () => moveSection("favorite", -1) : undefined}
            onMoveDown={isSelf ? () => moveSection("favorite", 1) : undefined}
          />
          {favorite ? (
            <div className="group relative flex gap-3 p-3 rounded-lg bg-white/[0.03] border border-white/[0.06]">
              <GameCover game={favorite} size="lg" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-white truncate">{favorite.name}</p>
                {favorite.note && <p className="text-xs text-white/50 mt-0.5 line-clamp-2">{favorite.note}</p>}
                {favorite.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {favorite.tags.map((txt) => (
                      <span key={txt} className="text-[10px] px-1.5 py-0.5 rounded bg-[#8B5CF6]/20 text-[#c4b5fd]">{txt}</span>
                    ))}
                  </div>
                )}
              </div>
              {isSelf && (
                <button onClick={() => remove(favorite)} className="opacity-0 group-hover:opacity-100 self-start p-1 rounded hover:bg-white/10 text-white/50 hover:text-white transition"><X className="w-4 h-4" /></button>
              )}
            </div>
          ) : (
            isSelf && (
              <button onClick={() => setAddCategory("favorite")} className="w-full py-3 rounded-lg border-2 border-dashed border-white/10 hover:border-[#8B5CF6]/50 bg-white/[0.02] hover:bg-[#8B5CF6]/[0.04] text-xs text-white/40 hover:text-[#8B5CF6] transition-colors flex items-center justify-center gap-1.5">
                <Plus className="w-4 h-4" /> {gt("Add favorite game")}
              </button>
            )
          )}
        </div>
      );
    }
    if (cat === "liked") return <div key="liked">{renderGrid("liked", showAllLiked, setShowAllLiked, Gamepad2, gt("Games I like"))}</div>;
    if (cat === "rotation") {
      const games = library.rotation;
      const limit = CATEGORY_LIMITS.rotation;
      const isFull = games.length >= limit;
      if (games.length === 0 && !isSelf) return null;
      const showAddPoster = isSelf && !isFull;
      return (
        <div key="rotation" className="rounded-xl bg-white/[0.02] border border-white/[0.05] p-3">
          <SectionHeader
            icon={RotateCw}
            title={gt("Games in rotation")}
            subtitle={`${games.length}/${limit}`}
            onMoveUp={isSelf ? () => moveSection("rotation", -1) : undefined}
            onMoveDown={isSelf ? () => moveSection("rotation", 1) : undefined}
          />
          <div className="grid grid-cols-5 gap-2">
            {games.map((game) => (
              <div key={game.id} className="group relative" title={game.name}>
                <GameCover game={game} />
                {game.tags.length > 0 && (
                  <div className="flex flex-wrap gap-0.5 mt-1">
                    {game.tags.slice(0, 2).map((txt) => (
                      <span key={txt} className="text-[8px] px-1 py-0.5 rounded bg-[#8B5CF6]/20 text-[#c4b5fd] truncate max-w-full">{txt}</span>
                    ))}
                    {game.tags.length > 2 && (
                      <span className="text-[8px] px-1 py-0.5 rounded bg-white/[0.06] text-white/40">+{game.tags.length - 2}</span>
                    )}
                  </div>
                )}
                {editControls(game, true)}
              </div>
            ))}
            {showAddPoster && <AddPosterButton onClick={() => setAddCategory("rotation")} cols={5} />}
          </div>
        </div>
      );
    }
    if (cat === "wishlist") return <div key="wishlist">{renderGrid("wishlist", showAllWishlist, setShowAllWishlist, Bookmark, gt("Want to play"))}</div>;
    return null;
  };

  return (
    <div className="space-y-4">
      {sectionOrder.map((cat) => renderSection(cat))}
      {addCategory && (
        <AddGameDialog open={!!addCategory} onOpenChange={(v) => !v && setAddCategory(null)} category={addCategory} allLibrary={library} onAdded={onAdded} />
      )}
    </div>
  );
}

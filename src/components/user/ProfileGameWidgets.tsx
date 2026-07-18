"use client";

import { useState, useEffect, useCallback } from "react";
import { Plus, X, Search, Star, Gamepad2, RotateCw, Bookmark, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
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

const CATEGORY_LIMITS: Record<GameCategory, number> = { favorite: 1, liked: 20, rotation: 5, wishlist: 20 };

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
    <div className={cn(dims, "rounded-lg bg-white/[0.05] flex items-center justify-center")}>
      <Gamepad2 className="w-1/3 h-1/3 text-white/30" />
    </div>
  );
}

// ── Add-game search dialog ────────────────────────────────────────────────────
function AddGameDialog({
  open, onOpenChange, category, onAdded,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  category: GameCategory;
  onAdded: (game: LibraryGame) => void;
}) {
  const gt = useGT();
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [result, setResult] = useState<{ id: number; name: string; coverUrl: string | null } | null>(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (!open) { setQuery(""); setResult(null); setSearching(false); }
  }, [open]);

  // Debounced IGDB lookup (reuses the existing /api/igdb/game endpoint).
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setResult(null); return; }
    setSearching(true);
    const handle = setTimeout(async () => {
      try {
        const res = await fetch(`/api/igdb/game?name=${encodeURIComponent(q)}`);
        const data = await res.json();
        setResult(data.game || null);
      } catch {
        setResult(null);
      } finally {
        setSearching(false);
      }
    }, 400);
    return () => clearTimeout(handle);
  }, [query]);

  const submit = async (game: { id?: number; name: string; coverUrl?: string | null }) => {
    setAdding(true);
    try {
      const res = await fetch(`/api/users/@me/games`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category,
          igdbId: game.id,
          name: game.name,
          coverUrl: game.coverUrl ?? undefined,
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
      setAdding(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[#0c0c10] border-white/[0.08] sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-white">{gt("Add a game")}</DialogTitle>
        </DialogHeader>
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
        <div className="min-h-[80px]">
          {searching ? (
            <div className="flex items-center justify-center py-6 text-white/40">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          ) : result ? (
            <button
              disabled={adding}
              onClick={() => submit({ id: result.id, name: result.name, coverUrl: result.coverUrl })}
              className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-white/[0.06] transition-colors text-left disabled:opacity-50"
            >
              <GameCover game={{ ...(result as unknown as LibraryGame), coverUrl: result.coverUrl }} size="sm" />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-white font-medium truncate">{result.name}</p>
                <p className="text-xs text-white/40">{gt("Click to add")}</p>
              </div>
              {adding && <Loader2 className="w-4 h-4 animate-spin text-white/60" />}
            </button>
          ) : query.trim().length >= 2 ? (
            <button
              disabled={adding}
              onClick={() => submit({ name: query.trim() })}
              className="w-full text-left p-2 rounded-lg hover:bg-white/[0.06] text-sm text-white/70"
            >
              {gt('Add "{q}" anyway', { q: query.trim() })}
            </button>
          ) : (
            <p className="text-xs text-white/30 text-center py-6">{gt("Type at least 2 characters")}</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Section shell ─────────────────────────────────────────────────────────────
function SectionHeader({ icon: Icon, title, subtitle }: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="flex items-center justify-between mb-2">
      <div className="flex items-center gap-2">
        <Icon className="w-3.5 h-3.5 text-[#8B5CF6]" />
        <h4 className="text-[11px] font-bold text-[#9a9aad] uppercase tracking-wide">{title}</h4>
        {subtitle && <span className="text-[10px] text-white/30">{subtitle}</span>}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
// `addCategory`/`setAddCategory` are controlled by the parent so the single
// "Add Widget" popup can drive the game-add dialog. Empty categories are never
// rendered — nothing is forced onto the profile by default.
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
    if (games.length === 0) return null;
    const visible = showAll ? games : games.slice(0, 8);
    return (
      <div>
        <SectionHeader icon={icon} title={title} subtitle={`${games.length}/${CATEGORY_LIMITS[category]}`} />
        <div className="grid grid-cols-4 gap-2">
          {visible.map((game) => (
            <div key={game.id} className="group relative" title={game.name}>
              <GameCover game={game} />
              {editControls(game, false)}
            </div>
          ))}
        </div>
        {games.length > 8 && (
          <button onClick={() => setShowAll(!showAll)} className="mt-2 text-xs text-[#8B5CF6] hover:underline">
            {showAll ? gt("Show less") : gt("Show more")}
          </button>
        )}
      </div>
    );
  };

  const favorite = library.favorite[0];

  return (
    <div className="space-y-4">
      {/* Favorite game — only if set */}
      {favorite && (
        <div>
          <SectionHeader icon={Star} title={gt("Favorite game")} />
          <div className="group relative flex gap-3 p-3 rounded-xl bg-white/[0.03] border border-white/[0.06]">
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
        </div>
      )}

      {/* Games I like */}
      {renderGrid("liked", showAllLiked, setShowAllLiked, Gamepad2, gt("Games I like"))}

      {/* Games in rotation */}
      {library.rotation.length > 0 && (
        <div>
          <SectionHeader icon={RotateCw} title={gt("Games in rotation")} subtitle={`${library.rotation.length}/${CATEGORY_LIMITS.rotation}`} />
          <div className="grid grid-cols-5 gap-2">
            {library.rotation.map((game) => (
              <div key={game.id} className="group relative" title={game.name}>
                <GameCover game={game} />
                {editControls(game, true)}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Want to play */}
      {renderGrid("wishlist", showAllWishlist, setShowAllWishlist, Bookmark, gt("Want to play"))}

      {addCategory && (
        <AddGameDialog open={!!addCategory} onOpenChange={(v) => !v && setAddCategory(null)} category={addCategory} onAdded={onAdded} />
      )}
    </div>
  );
}

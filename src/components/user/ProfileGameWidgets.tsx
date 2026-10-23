"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Plus, Search, Star, Gamepad2, RotateCw, Bookmark, ChevronLeft, ChevronRight, ChevronUp, ChevronDown, Loader2, Trash2, Tag } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useGT } from "gt-next";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { WidgetAddSlot, WidgetCard, WidgetHeader, WidgetIconButton, WidgetImage, WidgetSkeleton } from "@/components/widgets/WidgetShell";

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
function CoverFallback({ name, className }: { name: string; className: string }) {
  return (
    <div className={cn(className, "rounded-[6px] bg-gradient-to-br from-[var(--sw-accent-deep)]/40 via-white/[0.04] to-[var(--sw-accent-night)]/70 ring-1 ring-inset ring-white/[0.08] flex flex-col items-center justify-center gap-1 p-1.5 text-center")}>
      <Gamepad2 className="size-[22%] min-w-4 text-white/35" aria-hidden />
      <span className="text-[9.5px] leading-tight font-medium text-white/65 line-clamp-3 break-words max-w-full">{name}</span>
    </div>
  );
}

function GameCover({ game, size = "md" }: { game: Pick<LibraryGame, "name" | "coverUrl">; size?: "sm" | "md" | "poster" }) {
  const dims = size === "poster" ? "w-full aspect-[16/9]" : size === "sm" ? "w-10 h-[53px]" : "w-full aspect-[3/4]";
  return (
    <WidgetImage
      src={game.coverUrl}
      alt={game.name}
      className={cn(dims, "rounded-[6px] object-cover bg-white/[0.04] ring-1 ring-inset ring-white/[0.06] transition-transform duration-300 ease-out group-hover:scale-[1.035] motion-reduce:transition-none")}
      fallback={<CoverFallback name={game.name} className={dims} />}
    />
  );
}

function AddPosterButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <WidgetAddSlot onClick={onClick} label={label} className="aspect-[3/4]">
      <Plus className="size-5 transition-transform duration-200 group-hover/add:scale-110" aria-hidden />
    </WidgetAddSlot>
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
      <p className="text-[10px] font-semibold text-[var(--sw-faint)] mb-1.5 uppercase tracking-[0.08em]">{label}</p>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={label}>
        {options.map((o) => (
          <button
            type="button"
            key={o.value}
            aria-pressed={o.value === value}
            onClick={() => onChange(o.value === value ? "" : o.value)}
            className={cn(
              "sw-focus px-2.5 py-1 rounded-full text-[11px] border transition-colors",
              o.value === value
                ? "bg-[var(--sw-accent)] border-[var(--sw-accent)] text-white"
                : "bg-white/[0.04] border-[var(--sw-hairline)] text-[var(--sw-muted)] hover:bg-white/[0.08] hover:text-[var(--sw-text)]"
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
  const [searchState, setSearchState] = useState<{ q: string; games: { id: number; name: string; coverUrl: string | null }[] }>({ q: "", games: [] });
  const [adding, setAdding] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [tags, setTags] = useState<Record<GameTagType, string>>({ skill: "", rating: "", lookingFor: "" });

  // The dialog is unmounted when closed (see ProfileGameWidgets), so its state
  // starts fresh every time it opens.
  // Debounced IGDB search returning up to 3 results. Results are keyed by the
  // query they answer, so stale responses are ignored and "searching" is derived.
  const q = query.trim();
  useEffect(() => {
    if (q.length < 2) return;
    let active = true;
    const handle = setTimeout(async () => {
      try {
        const res = await fetch(`/api/igdb/games?query=${encodeURIComponent(q)}`);
        const data = await res.json();
        if (active) setSearchState({ q, games: Array.isArray(data.games) ? data.games : [] });
      } catch {
        if (active) setSearchState({ q, games: [] });
      }
    }, 400);
    return () => { active = false; clearTimeout(handle); };
  }, [q]);
  const searching = q.length >= 2 && searchState.q !== q;
  const results = q.length >= 2 && searchState.q === q ? searchState.games : [];

  // Only dedup within the same category, not across all categories
  const existingInCategory = useMemo(() => {
    const s = new Set<string | number>();
    for (const g of allLibrary[category]) {
      if (g.igdbId != null) s.add(g.igdbId);
      s.add(g.name.toLowerCase());
    }
    return s;
  }, [allLibrary, category]);

  const visibleResults = results
    .filter((r) => !existingInCategory.has(r.id) && !existingInCategory.has(r.name.toLowerCase()))
    .slice(0, 3);

  const selectedTags = [tags.skill, tags.rating, tags.lookingFor].filter(Boolean);
  const canAddCustom = q.length >= 2 && !visibleResults.some((r) => r.name.toLowerCase() === q.toLowerCase());

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
      <DialogContent className="bg-[#0c0c10] border-[var(--sw-hairline)] sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-white">{gt("Add a game")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 max-h-[70vh] overflow-y-auto">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--sw-faint)]" aria-hidden />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={gt("Search for a game…")}
              aria-label={gt("Search for a game…")}
              className="w-full bg-white/[0.04] border border-[var(--sw-hairline)] rounded-[8px] pl-9 pr-3 py-2.5 text-sm text-white placeholder:text-[var(--sw-faint)] focus:outline-none focus:border-[var(--sw-accent)] focus:ring-2 focus:ring-[var(--sw-accent)]/25"
            />
          </div>

          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={gt("Add a note…")}
            aria-label={gt("Add a note…")}
            rows={2}
            maxLength={512}
            className="w-full bg-white/[0.04] border border-[var(--sw-hairline)] rounded-[8px] px-3 py-2 text-xs text-white placeholder:text-[var(--sw-faint)] focus:outline-none focus:border-[var(--sw-accent)] focus:ring-2 focus:ring-[var(--sw-accent)]/25 resize-none"
          />

          {/* Tags only for favorite and rotation categories */}
          {(category === "favorite" || category === "rotation") && (
            <div className="space-y-3">
              <div className="flex items-center gap-1.5 text-[10px] font-semibold text-[var(--sw-faint)] uppercase tracking-[0.08em]">
                <Tag className="w-3 h-3" aria-hidden /> {gt("Tags")}
              </div>
              <TagPicker label={gt("Skill level")} value={tags.skill} onChange={(v) => setTags((t) => ({ ...t, skill: v }))} options={options.skill} />
              <TagPicker label={gt("Rating")} value={tags.rating} onChange={(v) => setTags((t) => ({ ...t, rating: v }))} options={options.rating} />
              <TagPicker label={gt("Looking for")} value={tags.lookingFor} onChange={(v) => setTags((t) => ({ ...t, lookingFor: v }))} options={options.lookingFor} />
            </div>
          )}

          <div className="min-h-[80px] space-y-1">
            {searching ? (
              <div className="flex items-center justify-center py-6 text-[var(--sw-faint)]" role="status" aria-label={gt("Searching")}>
                <Loader2 className="w-5 h-5 animate-spin" aria-hidden />
              </div>
            ) : visibleResults.length > 0 ? (
              visibleResults.map((game) => (
                <button
                  type="button"
                  key={game.id ?? game.name}
                  disabled={!!adding}
                  onClick={() => submit({ id: game.id, name: game.name, coverUrl: game.coverUrl })}
                  className="sw-focus group w-full flex items-center gap-3 p-2 rounded-[8px] hover:bg-white/[0.06] transition-colors text-left disabled:opacity-50"
                >
                  <GameCover game={game} size="sm" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white font-medium truncate">{game.name}</p>
                    <p className="text-xs text-[var(--sw-faint)]">{gt("Click to add")}</p>
                  </div>
                  {adding === (game.id?.toString() ?? game.name) && <Loader2 className="w-4 h-4 animate-spin text-white/60" />}
                </button>
              ))
            ) : canAddCustom ? (
              <button
                type="button"
                disabled={!!adding}
                onClick={() => submit({ name: query.trim() })}
                className="sw-focus w-full text-left p-2 rounded-[8px] hover:bg-white/[0.06] text-sm text-[var(--sw-muted)] disabled:opacity-50"
              >
                {gt('Add "{q}" anyway', { q: query.trim() })}
              </button>
            ) : query.trim().length >= 2 ? (
              <p className="text-xs text-[var(--sw-faint)] text-center py-6">{gt("No new matches")}</p>
            ) : (
              <p className="text-xs text-[var(--sw-faint)] text-center py-6">{gt("Type at least 2 characters")}</p>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Section shell ─────────────────────────────────────────────────────────────
function Section({ icon, title, count, limit, onMoveUp, onMoveDown, onRemove, children }: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  count: number;
  limit: number;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onRemove?: () => void;
  children: React.ReactNode;
}) {
  const gt = useGT();
  const hasActions = !!(onMoveUp || onMoveDown || onRemove);
  return (
    <WidgetCard className="group @container">
      <WidgetHeader
        icon={icon}
        title={title}
        meta={limit > 1 ? `${count}/${limit}` : undefined}
        actions={hasActions ? (
          <>
            {onMoveUp && <WidgetIconButton icon={ChevronUp} label={gt("Move section up")} onClick={onMoveUp} revealOnHover />}
            {onMoveDown && <WidgetIconButton icon={ChevronDown} label={gt("Move section down")} onClick={onMoveDown} revealOnHover />}
            {onRemove && <WidgetIconButton icon={Trash2} tone="danger" label={gt("Remove section")} onClick={onRemove} revealOnHover />}
          </>
        ) : undefined}
      />
      <div className="px-3.5 pb-3.5">{children}</div>
    </WidgetCard>
  );
}

function TagPill({ children, tone = "accent" }: { children: React.ReactNode; tone?: "accent" | "muted" | "glass" }) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center truncate rounded-[4px] px-1.5 py-0.5 text-[10px] font-medium leading-none",
        tone === "accent" && "bg-[var(--sw-accent)]/18 text-[var(--sw-accent-soft)] ring-1 ring-inset ring-[var(--sw-accent)]/25",
        tone === "muted" && "bg-white/[0.06] text-[var(--sw-muted)]",
        tone === "glass" && "bg-black/45 text-white backdrop-blur-sm ring-1 ring-inset ring-white/15"
      )}
    >
      {children}
    </span>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
// `addCategory`/`setAddCategory` are controlled by the parent so the single
// "Add Widget" popup can drive the game-add dialog. Empty categories are never
// rendered — nothing is forced onto the profile by default.
const DEFAULT_SECTION_ORDER: GameCategory[] = ["favorite", "liked", "rotation", "wishlist"];
const SECTION_STORAGE_KEY = "serika:game-widget-order";
const GRID_PREVIEW = 10;

/** Saved order first, then any category it doesn't mention (never drops one). */
function normalizeOrder(saved: unknown): GameCategory[] {
  const known = Array.isArray(saved) ? saved.filter((c): c is GameCategory => DEFAULT_SECTION_ORDER.includes(c as GameCategory)) : [];
  const unique = [...new Set(known)];
  return [...unique, ...DEFAULT_SECTION_ORDER.filter((c) => !unique.includes(c))];
}

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
      if (saved) return normalizeOrder(JSON.parse(saved));
    } catch {}
    return DEFAULT_SECTION_ORDER;
  });

  // Only sections with games are shown, so moving skips over hidden ones.
  const shownOrder = sectionOrder.filter((c) => library[c].length > 0);

  const moveSection = (cat: GameCategory, dir: -1 | 1) => {
    const idx = shownOrder.indexOf(cat);
    const swapWith = shownOrder[idx + dir];
    if (idx === -1 || !swapWith) return;
    setSectionOrder((prev) => {
      const arr = [...prev];
      const a = arr.indexOf(cat);
      const b = arr.indexOf(swapWith);
      [arr[a], arr[b]] = [arr[b], arr[a]];
      try { localStorage.setItem(SECTION_STORAGE_KEY, JSON.stringify(arr)); } catch {}
      return arr;
    });
  };

  const removeSection = async (cat: GameCategory, title: string) => {
    const games = library[cat];
    if (games.length > 1 && !confirm(gt("Remove all {count} games from {section}?", { count: games.length, section: title }))) return;
    setLibrary((prev) => ({ ...prev, [cat]: [] }));
    let failed = false;
    for (const game of games) {
      try {
        const res = await fetch(`/api/users/@me/games/${game.id}`, { method: "DELETE" });
        if (!res.ok) failed = true;
      } catch {
        failed = true;
      }
    }
    if (failed) {
      toast.error(gt("Failed to remove game"));
      refetch();
    }
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
    // Visitors don't get a placeholder for a section that may not exist.
    return isSelf ? <WidgetSkeleton tiles={5} label={gt("Loading games")} /> : null;
  }
  if (!isSelf && !hasAnything) {
    return null;
  }

  const sectionControls = (cat: GameCategory, title: string) => {
    if (!isSelf) return {};
    const idx = shownOrder.indexOf(cat);
    return {
      onMoveUp: idx > 0 ? () => moveSection(cat, -1) : undefined,
      onMoveDown: idx < shownOrder.length - 1 ? () => moveSection(cat, 1) : undefined,
      onRemove: () => removeSection(cat, title),
    };
  };

  const editControls = (game: LibraryGame, index: number, total: number) => isSelf && (
    <div className="absolute inset-x-0 top-0 aspect-[3/4] flex items-end justify-center gap-1 p-1.5 rounded-[6px] bg-gradient-to-t from-black/80 via-black/30 to-transparent opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity duration-200 max-sm:opacity-100 max-sm:bg-none">
      {index > 0 && (
        <WidgetIconButton icon={ChevronLeft} label={gt("Move {name} earlier", { name: game.name })} onClick={() => move(game, -1)} className="bg-black/70 text-white size-6" />
      )}
      <WidgetIconButton icon={Trash2} tone="danger" label={gt("Remove {name}", { name: game.name })} onClick={() => remove(game)} className="bg-black/70 text-white size-6" />
      {index < total - 1 && (
        <WidgetIconButton icon={ChevronRight} label={gt("Move {name} later", { name: game.name })} onClick={() => move(game, 1)} className="bg-black/70 text-white size-6" />
      )}
    </div>
  );

  const posterGrid = "grid grid-cols-4 @md:grid-cols-5 gap-2";

  // Grid renderer for liked / wishlist (first 10, then show-more).
  const renderGrid = (category: "liked" | "wishlist", showAll: boolean, setShowAll: (v: boolean) => void, icon: React.ComponentType<{ className?: string }>, title: string) => {
    const games = library[category];
    const limit = CATEGORY_LIMITS[category];
    if (games.length === 0) return null;
    const isFull = games.length >= limit;
    const visible = showAll ? games : games.slice(0, GRID_PREVIEW);
    const showAddPoster = isSelf && !isFull && (games.length < GRID_PREVIEW || showAll);
    return (
      <Section key={category} icon={icon} title={title} count={games.length} limit={limit} {...sectionControls(category, title)}>
        <ul className={posterGrid}>
          {visible.map((game, i) => (
            <li key={game.id} className="group relative min-w-0" title={game.note ? `${game.name} — ${game.note}` : game.name}>
              <div className="overflow-hidden rounded-[6px]"><GameCover game={game} /></div>
              {editControls(game, i, games.length)}
            </li>
          ))}
          {showAddPoster && <li><AddPosterButton onClick={() => setAddCategory(category)} label={gt("Add a game to {section}", { section: title })} /></li>}
        </ul>
        {(games.length > GRID_PREVIEW || (isSelf && !showAddPoster && !isFull)) && (
          <div className="mt-2.5 flex items-center gap-3">
            {games.length > GRID_PREVIEW && (
              <button type="button" onClick={() => setShowAll(!showAll)} className="sw-focus rounded text-xs font-medium text-[var(--sw-accent-soft)] hover:underline" aria-expanded={showAll}>
                {showAll ? gt("Show less") : gt("Show all {count}", { count: games.length })}
              </button>
            )}
            {isSelf && !showAddPoster && !isFull && (
              <button type="button" onClick={() => setAddCategory(category)} className="sw-focus ml-auto inline-flex items-center gap-1 rounded text-xs text-[var(--sw-muted)] hover:text-[var(--sw-accent-soft)]">
                <Plus className="size-3.5" aria-hidden /> {gt("Add more")}
              </button>
            )}
          </div>
        )}
      </Section>
    );
  };

  const favorite = library.favorite[0];

  const renderSection = (cat: GameCategory) => {
    if (cat === "favorite") {
      if (!favorite) return null;
      const title = gt("Favorite game");
      return (
        <Section key="favorite" icon={Star} title={title} count={1} limit={CATEGORY_LIMITS.favorite} {...sectionControls("favorite", title)}>
          <div className="group relative overflow-hidden rounded-[8px] ring-1 ring-white/[0.08] shadow-[0_18px_40px_-24px_rgba(139,92,246,0.7)]">
            <GameCover game={favorite} size="poster" />
            <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/35 to-transparent" />
            <div className="absolute inset-x-0 bottom-0 p-3.5">
              <p className="font-display text-[19px] font-semibold leading-tight tracking-[-0.015em] text-white truncate drop-shadow-md">{favorite.name}</p>
              {favorite.note && <p className="text-[12.5px] text-white/80 mt-1 line-clamp-2">{favorite.note}</p>}
              {favorite.tags.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {favorite.tags.map((txt) => <TagPill key={txt} tone="glass">{txt}</TagPill>)}
                </div>
              )}
            </div>
            {isSelf && (
              <div className="absolute top-2 right-2">
                <WidgetIconButton icon={Trash2} tone="danger" revealOnHover label={gt("Remove {name}", { name: favorite.name })} onClick={() => remove(favorite)} className="bg-black/65 text-white backdrop-blur-sm" />
              </div>
            )}
          </div>
        </Section>
      );
    }
    if (cat === "liked") return renderGrid("liked", showAllLiked, setShowAllLiked, Gamepad2, gt("Games I like"));
    if (cat === "rotation") {
      const games = library.rotation;
      if (games.length === 0) return null;
      const limit = CATEGORY_LIMITS.rotation;
      const showAddPoster = isSelf && games.length < limit;
      const title = gt("Games in rotation");
      return (
        <Section key="rotation" icon={RotateCw} title={title} count={games.length} limit={limit} {...sectionControls("rotation", title)}>
          <ul className={posterGrid}>
            {games.map((game, i) => (
              <li key={game.id} className="group relative min-w-0" title={game.note ? `${game.name} — ${game.note}` : game.name}>
                <div className="overflow-hidden rounded-[6px]"><GameCover game={game} /></div>
                {game.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {game.tags.slice(0, 2).map((txt) => <TagPill key={txt}>{txt}</TagPill>)}
                    {game.tags.length > 2 && <TagPill tone="muted">+{game.tags.length - 2}</TagPill>}
                  </div>
                )}
                {editControls(game, i, games.length)}
              </li>
            ))}
            {showAddPoster && <li><AddPosterButton onClick={() => setAddCategory("rotation")} label={gt("Add a game to {section}", { section: title })} /></li>}
          </ul>
        </Section>
      );
    }
    if (cat === "wishlist") return renderGrid("wishlist", showAllWishlist, setShowAllWishlist, Bookmark, gt("Want to play"));
    return null;
  };

  return (
    <div className="space-y-3">
      {sectionOrder.map((cat) => renderSection(cat))}
      {addCategory && (
        <AddGameDialog open={!!addCategory} onOpenChange={(v) => !v && setAddCategory(null)} category={addCategory} allLibrary={library} onAdded={onAdded} />
      )}
    </div>
  );
}

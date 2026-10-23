"use client";

import { useState } from "react";
import { Plus, X, Gamepad2, Star, RotateCw, Bookmark, Check, LayoutGrid, ChevronUp, ChevronDown, Gift, Link2, Activity } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useGT, useLocale } from "gt-next";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { WidgetRenderer, widgetHasContent, type WidgetConfigShape, type WidgetUserData } from "@/components/widgets/WidgetRenderer";
import { WidgetAddSlot, WidgetEyebrow, WidgetIconButton, WidgetImage, WidgetSkeleton, WidgetSkeletonBlock } from "@/components/widgets/WidgetShell";
import {
  AddGameDialog,
  CATEGORY_LIMITS,
  GameSection,
  gameSectionTitle,
  useGameLibrary,
  type GameCategory,
} from "@/components/user/ProfileGameWidgets";
import {
  ProfileWishlistWidget,
  WishlistIcon,
  listMeta,
  setWishlistWidget,
  type WishlistWidgetState,
} from "@/components/user/ProfileWishlistWidget";
import { useJsonResource } from "@/hooks/useJsonResource";
import {
  SERIKA_WISHLIST_BUILTIN,
  SERIKA_WISHLIST_PUBLIC_URL,
  listForPlacement,
  type WishlistList,
  type WishlistWidgetResponse,
} from "@/lib/serikaWishlist";
import {
  GAME_BUILTIN_BY_CATEGORY,
  GAME_CATEGORY_ORDER,
  SECTION_BUILTIN_BY_KEY,
  boardOrder,
  categoryFromGameId,
  moveInOrder,
  sectionFromId,
  withFixedIds,
  type BoardSectionKey,
} from "@/lib/profileBoard";

/**
 * The Board tab of a profile: game sections, app widgets (Social SDK) and
 * Serika Wishlist widgets in ONE order stored in users.profile_widgets. The
 * owner can move any widget up or down (keyboard and touch friendly); the
 * order is the same for everyone who views the profile.
 */

interface Placement {
  id: string;
  type: string;
  applicationId?: string | null;
  builtin?: string | null;
  options?: { listSlug?: string | null } | null;
  config?: WidgetConfigShape;
  data?: WidgetUserData | null;
  application?: { name: string | null; icon: string | null } | null;
}

interface AvailableWidget {
  applicationId: string;
  name: string;
  icon: string | null;
  appName: string | null;
}

type BoardResponse = { widgets?: Placement[]; order?: string[] };

const GAME_OPTIONS: { category: GameCategory; icon: React.ComponentType<{ className?: string }> }[] = [
  { category: "favorite", icon: Star },
  { category: "liked", icon: Gamepad2 },
  { category: "rotation", icon: RotateCw },
  { category: "wishlist", icon: Bookmark },
];

function gameHint(category: GameCategory, gt: ReturnType<typeof useGT>): string {
  switch (category) {
    case "favorite": return gt("A poster and details for the game you love most");
    case "liked": return gt("A shelf of up to 20 games");
    case "rotation": return gt("What you're playing lately, with tags");
    default: return gt("Games on your backlog");
  }
}

// ── Add to Profile dialog ─────────────────────────────────────────────────────

function OptionRow({
  icon, title, subtitle, onClick, added = false, disabled = false,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: React.ReactNode;
  onClick?: () => void;
  added?: boolean;
  disabled?: boolean;
}) {
  const gt = useGT();
  const inert = added || disabled || !onClick;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={inert}
      className={cn(
        "sw-focus w-full flex items-center gap-3 p-2.5 rounded-[8px] border text-left transition-colors border-[var(--sw-hairline)]",
        inert ? "bg-white/[0.015] cursor-default" : "bg-white/[0.025] hover:bg-white/[0.055] hover:border-[var(--sw-hairline-strong)]",
        disabled && !added && "opacity-60"
      )}
    >
      {icon}
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-medium text-[var(--sw-text)] truncate">{title}</span>
        <span className="block text-xs text-[var(--sw-muted)]">{subtitle}</span>
      </span>
      {added ? (
        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-300/90 shrink-0">
          <Check className="size-3.5" aria-hidden /> {gt("Added")}
        </span>
      ) : !inert ? (
        <span className="grid place-items-center size-7 rounded-[6px] bg-[var(--sw-accent)]/15 text-[var(--sw-accent-soft)] shrink-0">
          <Plus className="size-4" aria-hidden />
        </span>
      ) : null}
    </button>
  );
}

function IconTile({ children }: { children: React.ReactNode }) {
  return (
    <span className="grid place-items-center size-9 shrink-0 rounded-[8px] bg-[var(--sw-accent)]/15 ring-1 ring-inset ring-[var(--sw-accent)]/25 text-[var(--sw-accent-soft)]">
      {children}
    </span>
  );
}

function AddWidgetDialog({
  open, onOpenChange, gameCounts, onAddGameCategory, addedAppIds, onAddApp, wishlist, wishlistLoading, placedSlugs, onAddWishlist,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  gameCounts: Record<GameCategory, number>;
  onAddGameCategory: (category: GameCategory) => void;
  addedAppIds: Set<string>;
  onAddApp: (applicationId: string) => Promise<void>;
  wishlist: WishlistWidgetResponse | null;
  wishlistLoading: boolean;
  placedSlugs: Set<string>;
  onAddWishlist: (list: WishlistList) => Promise<void>;
}) {
  const gt = useGT();
  const locale = useLocale();
  const res = useJsonResource<{ widgets?: AvailableWidget[] }>(open ? "/api/users/@me/available-widgets" : null);
  const available = res.data?.widgets ?? [];
  const [busy, setBusy] = useState<string | null>(null);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
      onOpenChange(false);
    } finally {
      setBusy(null);
    }
  };

  const publicLists = wishlist?.lists ?? [];
  const unplaced = publicLists.filter((l) => !placedSlugs.has(l.slug));
  const gameOptions = GAME_OPTIONS.filter(({ category }) => gameCounts[category] < CATEGORY_LIMITS[category]);
  const makePublicHint = (
    <>
      {gt("Make a list Public on Serika Wishlist to add it here.")}{" "}
      <a href={SERIKA_WISHLIST_PUBLIC_URL} target="_blank" rel="noopener noreferrer" className="sw-focus rounded text-[var(--sw-accent-soft)] hover:underline pointer-events-auto">
        wish.serika.dev
      </a>
    </>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[#0c0c10] border-[var(--sw-hairline)] sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-white">{gt("Add to Profile")}</DialogTitle>
          <DialogDescription className="text-[var(--sw-muted)]">{gt("Widgets show up on the Board tab of your profile.")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 max-h-[60vh] overflow-y-auto -mx-1 px-1 pb-1">
          <div className="space-y-1.5">
            <WidgetEyebrow className="px-0.5">{gt("Serika Wishlist")}</WidgetEyebrow>
            {wishlistLoading ? (
              <WidgetSkeletonBlock className="h-[58px] w-full rounded-[8px]" />
            ) : !wishlist ? (
              <OptionRow icon={<IconTile><Gift className="size-4" aria-hidden /></IconTile>} title={gt("Serika Wishlist")} subtitle={gt("Serika Wishlist could not be reached. Try again in a moment.")} disabled />
            ) : publicLists.length === 0 ? (
              <OptionRow icon={<IconTile><Gift className="size-4" aria-hidden /></IconTile>} title={gt("No public wishlists")} subtitle={makePublicHint} disabled />
            ) : unplaced.length === 0 ? (
              <OptionRow icon={<IconTile><Gift className="size-4" aria-hidden /></IconTile>} title={gt("All your public lists are on your profile")} subtitle={makePublicHint} disabled />
            ) : (
              unplaced.map((l) => (
                <OptionRow
                  key={l.slug}
                  icon={<WishlistIcon list={l} size="sm" />}
                  title={gt("Serika Wishlist · {title}", { title: l.title })}
                  subtitle={listMeta(l, gt, locale)}
                  disabled={busy !== null}
                  onClick={() => run(`wishlist:${l.slug}`, () => onAddWishlist(l))}
                />
              ))
            )}
          </div>

          {gameOptions.length > 0 && (
            <div className="space-y-1.5">
              <WidgetEyebrow className="px-0.5">{gt("Games")}</WidgetEyebrow>
              {gameOptions.map(({ category, icon: Icon }) => {
                const count = gameCounts[category];
                const limit = CATEGORY_LIMITS[category];
                return (
                  <OptionRow
                    key={category}
                    icon={<IconTile><Icon className="size-4" /></IconTile>}
                    title={gameSectionTitle(category, gt)}
                    subtitle={limit > 1 && count > 0 ? `${gameHint(category, gt)} · ${count}/${limit}` : gameHint(category, gt)}
                    onClick={() => { onAddGameCategory(category); onOpenChange(false); }}
                  />
                );
              })}
            </div>
          )}

          <div className="space-y-1.5">
            <WidgetEyebrow className="px-0.5">{gt("App widgets")}</WidgetEyebrow>
            {res.loading ? (
              <WidgetSkeletonBlock className="h-[58px] w-full rounded-[8px]" />
            ) : available.length === 0 ? (
              <p className="text-xs text-[var(--sw-faint)] px-0.5 py-2">{gt("No app widgets available yet.")}</p>
            ) : (
              available.map((w) => (
                <OptionRow
                  key={w.applicationId}
                  icon={
                    <WidgetImage
                      src={w.icon}
                      alt=""
                      className="size-9 rounded-[8px] object-cover shrink-0"
                      fallback={<IconTile><LayoutGrid className="size-4" aria-hidden /></IconTile>}
                    />
                  }
                  title={w.name}
                  subtitle={w.appName || gt("Application")}
                  added={addedAppIds.has(w.applicationId)}
                  disabled={busy !== null}
                  onClick={() => run(w.applicationId, () => onAddApp(w.applicationId))}
                />
              ))
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Board ─────────────────────────────────────────────────────────────────────

/** Up/down controls shared by every widget type on the Board. */
function MoveControls({ name, canUp, canDown, onMove, className }: {
  name: string;
  canUp: boolean;
  canDown: boolean;
  onMove: (dir: -1 | 1) => void;
  className?: string;
}) {
  const gt = useGT();
  return (
    <>
      <WidgetIconButton icon={ChevronUp} label={gt("Move {name} up", { name })} onClick={() => onMove(-1)} disabled={!canUp} revealOnHover className={className} />
      <WidgetIconButton icon={ChevronDown} label={gt("Move {name} down", { name })} onClick={() => onMove(1)} disabled={!canDown} revealOnHover className={className} />
    </>
  );
}

/** A fixed profile section (Connections, Recent activity) rendered on the Board. */
export interface BoardSectionContent {
  node: React.ReactNode;
  /** False when there is nothing to show (no connections / no activity). */
  hasContent: boolean;
  /** Show the section to its owner even when empty (e.g. an empty-state note). */
  showEmptyToOwner?: boolean;
}

/** Titled, card-less Board section with the shared move controls. */
function BoardSection({ icon: Icon, title, actions, children }: {
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  title: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="group" aria-label={title}>
      <header className="flex items-center gap-2.5 mb-2 min-w-0">
        <span className="grid place-items-center size-7 shrink-0 rounded-[var(--sw-radius-inner)] bg-[var(--sw-accent)]/15 ring-1 ring-inset ring-[var(--sw-accent)]/25">
          <Icon className="size-3.5 text-[var(--sw-accent-soft)]" aria-hidden />
        </span>
        <h4 className="font-display text-[14px] font-semibold tracking-[-0.01em] text-[var(--sw-text)] truncate flex-1">{title}</h4>
        {actions && <div className="flex items-center gap-0.5 shrink-0">{actions}</div>}
      </header>
      {children}
    </section>
  );
}

type BoardItem =
  | { kind: "section"; id: string; key: BoardSectionKey; name: string }
  | { kind: "game"; id: string; category: GameCategory; name: string }
  | { kind: "app"; id: string; placement: Placement; name: string }
  | { kind: "wishlist"; id: string; slug: string | null; state: WishlistWidgetState; list: WishlistList | null; name: string };

export function ProfileBoard({ userId, isSelf, sections }: {
  userId: string;
  isSelf: boolean;
  /** Fixed sections the profile renders on the Board (content comes from the caller). */
  sections?: Partial<Record<BoardSectionKey, BoardSectionContent>>;
}) {
  const gt = useGT();
  const res = useJsonResource<BoardResponse>(`/api/users/${userId}/profile-widgets`);
  const lib = useGameLibrary(userId);
  const [addOpen, setAddOpen] = useState(false);
  const [addCategory, setAddCategory] = useState<GameCategory | null>(null);
  // Optimistic Board (order and/or placements) until the server answers again.
  const [optimistic, setOptimistic] = useState<{ base: unknown; order: string[]; placements: Placement[] } | null>(null);

  const serverPlacements = res.data?.widgets ?? [];
  const serverOrder = withFixedIds(res.data?.order ?? boardOrder(serverPlacements));
  const current = optimistic && optimistic.base === res.data ? optimistic : { order: serverOrder, placements: serverPlacements };
  const { order, placements } = current;

  const wishlistPlacements = placements.filter((p) => p.builtin === SERIKA_WISHLIST_BUILTIN);
  const wl = useJsonResource<WishlistWidgetResponse>(
    wishlistPlacements.length > 0 || (isSelf && addOpen) ? `/api/users/${userId}/serika-wishlist` : null
  );

  const persistOrder = async (nextOrder: string[]) => {
    setOptimistic({ base: res.data, order: nextOrder, placements });
    try {
      const r = await fetch("/api/users/@me/widgets/order", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: nextOrder }),
      });
      if (!r.ok) throw new Error();
    } catch {
      toast.error(gt("Couldn't save the new order"));
      setOptimistic(null);
      res.reload();
    }
  };

  /** Save app-widget membership, keeping the current Board order. */
  const persistPlacements = async (nextPlacements: Placement[], nextOrder: string[]) => {
    setOptimistic({ base: res.data, order: nextOrder, placements: nextPlacements });
    const byId = new Map(nextPlacements.map((p) => [p.id, p]));
    const body = nextOrder
      .map((id) => {
        const p = byId.get(id);
        if (p) return { id: p.id, type: p.type, applicationId: p.applicationId ?? null, builtin: p.builtin ?? null };
        const cat = categoryFromGameId(id);
        if (cat) return { id, type: "builtin", applicationId: null, builtin: GAME_BUILTIN_BY_CATEGORY[cat] };
        const key = sectionFromId(id);
        return key ? { id, type: "builtin", applicationId: null, builtin: SECTION_BUILTIN_BY_KEY[key] } : null;
      })
      .filter(Boolean);
    try {
      const r = await fetch("/api/users/@me/widgets", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ widgets: body }),
      });
      if (!r.ok) throw new Error();
    } catch {
      toast.error(gt("Failed to save widgets"));
    } finally {
      res.reload();
    }
  };

  const addApp = async (applicationId: string) => {
    const id = `application:${applicationId}`;
    if (placements.some((p) => p.id === id)) return;
    await persistPlacements([...placements, { id, type: "application", applicationId }], [...order, id]);
  };

  const removeApp = (id: string) => persistPlacements(placements.filter((p) => p.id !== id), order.filter((x) => x !== id));

  const addWishlist = async (list: WishlistList) => {
    if (!(await setWishlistWidget(list.slug, true))) {
      toast.error(gt("Could not save your Wishlist widget"));
      return;
    }
    res.reload();
    wl.reload();
  };

  const removeWishlist = async (id: string, slug: string | null) => {
    setOptimistic({ base: res.data, order: order.filter((x) => x !== id), placements: placements.filter((p) => p.id !== id) });
    // A not-yet-migrated placement has no slug; null removes every wishlist widget,
    // so only send it when it is the only one.
    const target = slug ?? (wishlistPlacements.length === 1 ? null : undefined);
    const ok = target === undefined ? false : await setWishlistWidget(target, false);
    if (!ok) toast.error(gt("Could not save your Wishlist widget"));
    res.reload();
  };

  if (res.loading || lib.loading) {
    return isSelf ? <WidgetSkeleton tiles={5} label={gt("Loading widgets")} /> : null;
  }


  // ── Resolve the Board order into renderable items ──
  const byId = new Map(placements.map((p) => [p.id, p]));
  const wlData = wl.data;
  const wlState = (slug: string | null): { state: WishlistWidgetState; list: WishlistList | null } => {
    if (wl.loading) return { state: "loading", list: null };
    if (!wlData) return { state: "error", list: null };
    if (wlData.found === false) return { state: "no_account", list: null };
    const list = listForPlacement(wlData.lists ?? [], slug, wlData.placedSlugs ?? wishlistPlacements.map((p) => p.options?.listSlug ?? null));
    return list ? { state: "ok", list } : { state: "not_public", list: null };
  };

  const items: BoardItem[] = [];
  const sectionTitle = (key: BoardSectionKey) => (key === "connections" ? gt("Connections") : gt("Recent activity"));
  for (const id of order) {
    const key = sectionFromId(id);
    if (key) {
      const sec = sections?.[key];
      // Empty sections stay hidden for visitors; the owner may get an empty state.
      if (sec && (sec.hasContent || (isSelf && sec.showEmptyToOwner))) {
        items.push({ kind: "section", id, key, name: sectionTitle(key) });
      }
      continue;
    }
    const cat = categoryFromGameId(id);
    if (cat) {
      if (lib.library[cat].length > 0) items.push({ kind: "game", id, category: cat, name: gameSectionTitle(cat, gt) });
      continue;
    }
    const p = byId.get(id);
    if (!p) continue;
    if (p.type === "application") {
      if (p.config && widgetHasContent(p.config, p.data ?? null)) {
        items.push({ kind: "app", id, placement: p, name: p.application?.name || p.config.name });
      }
      continue;
    }
    if (p.builtin === SERIKA_WISHLIST_BUILTIN) {
      const slug = p.options?.listSlug ?? null;
      const { state, list } = wlState(slug);
      // Visitors never see broken or private lists.
      if (!isSelf && state !== "ok" && state !== "loading") continue;
      items.push({ kind: "wishlist", id, slug, state, list, name: list?.title ?? gt("Wishlist") });
    }
  }
  // Two wishlist widgets can't show the same list (e.g. a legacy one resolving to an already-placed list).
  const seenLists = new Set<string>();
  const visibleItems = items.filter((it) => {
    if (it.kind !== "wishlist" || !it.list) return true;
    if (seenLists.has(it.list.slug)) return false;
    seenLists.add(it.list.slug);
    return true;
  });

  if (!isSelf && visibleItems.length === 0) return null;

  const visibleIds = visibleItems.map((it) => it.id);
  const move = (id: string, dir: -1 | 1) => {
    const next = moveInOrder(order, visibleIds, id, dir);
    if (next) void persistOrder(next);
  };
  const controls = (it: BoardItem, i: number, className?: string) =>
    isSelf ? (
      <MoveControls name={it.name} canUp={i > 0} canDown={i < visibleItems.length - 1} onMove={(dir) => move(it.id, dir)} className={className} />
    ) : undefined;

  const gameCounts = Object.fromEntries(GAME_CATEGORY_ORDER.map((c) => [c, lib.library[c].length])) as Record<GameCategory, number>;
  const placedSlugs = new Set(
    (wlData?.placedSlugs ?? []).filter((s): s is string => !!s).concat(visibleItems.flatMap((it) => (it.kind === "wishlist" && it.list ? [it.list.slug] : [])))
  );

  return (
    <div className="space-y-3">
      {visibleItems.map((it, i) => {
        if (it.kind === "section") {
          return (
            <BoardSection key={it.id} icon={it.key === "connections" ? Link2 : Activity} title={it.name} actions={controls(it, i)}>
              {sections?.[it.key]?.node}
            </BoardSection>
          );
        }
        if (it.kind === "game") {
          return <GameSection key={it.id} category={it.category} lib={lib} isSelf={isSelf} boardActions={controls(it, i)} onAddGame={setAddCategory} />;
        }
        if (it.kind === "wishlist") {
          return (
            <ProfileWishlistWidget
              key={it.id}
              list={it.list}
              state={it.state}
              isSelf={isSelf}
              boardActions={controls(it, i)}
              onRemove={() => removeWishlist(it.id, it.slug)}
              onRetry={wl.reload}
            />
          );
        }
        const p = it.placement;
        return (
          <div key={it.id} className="group relative">
            <WidgetRenderer config={p.config!} data={p.data ?? null} icon={p.application?.icon} appName={p.application?.name} />
            {isSelf && (
              <div className="absolute top-2 right-2 flex items-center gap-0.5 rounded-[8px] bg-black/55 p-0.5 backdrop-blur-sm sm:bg-transparent sm:p-0 sm:backdrop-blur-none sm:group-hover:bg-black/55 sm:group-hover:p-0.5 sm:group-focus-within:bg-black/55 sm:group-focus-within:p-0.5">
                {controls(it, i, "text-white/85")}
                <WidgetIconButton icon={X} tone="danger" revealOnHover label={gt("Remove widget")} onClick={() => removeApp(it.id)} className="text-white/85" />
              </div>
            )}
          </div>
        );
      })}

      {isSelf && (
        <WidgetAddSlot onClick={() => setAddOpen(true)} label={gt("Add a widget")} className="w-full py-3 px-4 rounded-[10px] place-items-stretch">
          <span className="flex items-center justify-center gap-2 text-[13px] font-medium">
            <Plus className="size-4" aria-hidden />
            {gt("Add a widget")}
            <span className="hidden sm:inline text-[var(--sw-faint)] font-normal">· {gt("games, apps, your wishlists")}</span>
          </span>
        </WidgetAddSlot>
      )}

      {isSelf && (
        <AddWidgetDialog
          open={addOpen}
          onOpenChange={setAddOpen}
          gameCounts={gameCounts}
          onAddGameCategory={setAddCategory}
          addedAppIds={new Set(placements.map((p) => p.applicationId).filter((x): x is string => !!x))}
          onAddApp={addApp}
          wishlist={wlData}
          wishlistLoading={wl.loading}
          placedSlugs={placedSlugs}
          onAddWishlist={addWishlist}
        />
      )}
      {isSelf && addCategory && (
        <AddGameDialog
          open={!!addCategory}
          onOpenChange={(v) => !v && setAddCategory(null)}
          category={addCategory}
          allLibrary={lib.library}
          onAdded={lib.onAdded}
        />
      )}
      {isSelf && visibleItems.length > 1 && (
        <p className="text-[11px] text-[var(--sw-faint)] text-center">
          {gt("Use the arrows on each widget to change the order everyone sees.")}
        </p>
      )}
    </div>
  );
}


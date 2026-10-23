"use client";

import { useState, useEffect } from "react";
import { Plus, X, Gamepad2, Star, RotateCw, Bookmark, Gift, Check, LayoutGrid } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useGT } from "gt-next";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { WidgetRenderer, widgetHasContent, type WidgetConfigShape, type WidgetUserData } from "@/components/widgets/WidgetRenderer";
import { WidgetAddSlot, WidgetEyebrow, WidgetIconButton, WidgetImage, WidgetSkeletonBlock } from "@/components/widgets/WidgetShell";
import type { GameCategory } from "@/components/user/ProfileGameWidgets";
import { CATEGORY_LIMITS, type LibraryGame } from "@/components/user/ProfileGameWidgets";
import { ProfileWishlistWidget } from "@/components/user/ProfileWishlistWidget";
import { useJsonResource } from "@/hooks/useJsonResource";
import { SERIKA_WISHLIST_BUILTIN } from "@/lib/serikaWishlist";

interface Placement {
  id: string;
  type: string;
  applicationId?: string | null;
  builtin?: string | null;
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

type Library = Record<GameCategory, LibraryGame[]>;
const EMPTY_LIBRARY: Library = { favorite: [], liked: [], rotation: [], wishlist: [] };

const GAME_CATEGORY_OPTIONS: { category: GameCategory; icon: React.ComponentType<{ className?: string }>; label: (gt: ReturnType<typeof useGT>) => string; hint: (gt: ReturnType<typeof useGT>) => string }[] = [
  { category: "favorite", icon: Star, label: (gt) => gt("Favorite Game"), hint: (gt) => gt("One big poster for the game you love most") },
  { category: "liked", icon: Gamepad2, label: (gt) => gt("Games I Like"), hint: (gt) => gt("A shelf of up to 20 games") },
  { category: "rotation", icon: RotateCw, label: (gt) => gt("Games in Rotation"), hint: (gt) => gt("What you're playing lately, with tags") },
  { category: "wishlist", icon: Bookmark, label: (gt) => gt("Want to Play"), hint: (gt) => gt("Games on your backlog") },
];

function OptionRow({
  icon,
  title,
  subtitle,
  onClick,
  added = false,
  disabled = false,
  trailing,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  onClick: () => void;
  added?: boolean;
  disabled?: boolean;
  trailing?: React.ReactNode;
}) {
  const gt = useGT();
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || added}
      className={cn(
        "sw-focus w-full flex items-center gap-3 p-2.5 rounded-[8px] border text-left transition-colors",
        added
          ? "border-[var(--sw-hairline)] bg-white/[0.015] cursor-default"
          : "border-[var(--sw-hairline)] bg-white/[0.025] hover:bg-white/[0.055] hover:border-[var(--sw-hairline-strong)] disabled:opacity-50"
      )}
    >
      {icon}
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-medium text-[var(--sw-text)] truncate">{title}</span>
        <span className="block text-xs text-[var(--sw-muted)] truncate">{subtitle}</span>
      </span>
      {trailing}
      {added ? (
        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-300/90 shrink-0">
          <Check className="size-3.5" aria-hidden /> {gt("Added")}
        </span>
      ) : (
        <span className="grid place-items-center size-7 rounded-[6px] bg-[var(--sw-accent)]/15 text-[var(--sw-accent-soft)] shrink-0">
          <Plus className="size-4" aria-hidden />
        </span>
      )}
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

function AddWidgetDialog({ open, onOpenChange, onAddGameCategory, gameLibrary, addedAppIds, wishlistAdded, onAddApp, onAddWishlist }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onAddGameCategory?: (category: GameCategory) => void;
  gameLibrary: Library;
  addedAppIds: Set<string>;
  wishlistAdded: boolean;
  onAddApp: (applicationId: string) => Promise<void>;
  onAddWishlist: () => Promise<void>;
}) {
  const gt = useGT();
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

  const availableCategories = GAME_CATEGORY_OPTIONS.filter(({ category }) => gameLibrary[category].length < CATEGORY_LIMITS[category]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[#0c0c10] border-[var(--sw-hairline)] sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-white">{gt("Add to Profile")}</DialogTitle>
          <DialogDescription className="text-[var(--sw-muted)]">{gt("Widgets show up on the Board tab of your profile.")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 max-h-[60vh] overflow-y-auto -mx-1 px-1 pb-1">
          <div className="space-y-1.5">
            <WidgetEyebrow className="px-0.5">{gt("Serika")}</WidgetEyebrow>
            <OptionRow
              icon={<IconTile><Gift className="size-4" aria-hidden /></IconTile>}
              title={gt("Serika Wishlist")}
              subtitle={gt("Your public wishlists from wish.serika.dev")}
              added={wishlistAdded}
              disabled={busy !== null}
              onClick={() => run("wishlist", onAddWishlist)}
            />
          </div>

          {onAddGameCategory && availableCategories.length > 0 && (
            <div className="space-y-1.5">
              <WidgetEyebrow className="px-0.5">{gt("Games")}</WidgetEyebrow>
              {availableCategories.map(({ category, icon: Icon, label, hint }) => {
                const count = gameLibrary[category].length;
                const limit = CATEGORY_LIMITS[category];
                return (
                  <OptionRow
                    key={category}
                    icon={<IconTile><Icon className="size-4" /></IconTile>}
                    title={label(gt)}
                    subtitle={limit > 1 && count > 0 ? `${hint(gt)} · ${count}/${limit}` : hint(gt)}
                    onClick={() => { onAddGameCategory(category); onOpenChange(false); }}
                  />
                );
              })}
            </div>
          )}

          <div className="space-y-1.5">
            <WidgetEyebrow className="px-0.5">{gt("App widgets")}</WidgetEyebrow>
            {res.loading ? (
              <div className="space-y-1.5" aria-busy="true">
                <WidgetSkeletonBlock className="h-[58px] w-full rounded-[8px]" />
                <WidgetSkeletonBlock className="h-[58px] w-full rounded-[8px]" />
              </div>
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

export function ProfileAppWidgets({ userId, isSelf, onAddGameCategory, gameLibrary }: {
  userId: string;
  isSelf: boolean;
  /** Kept for API compatibility; app icons now come from the placement itself. */
  appIcon?: string | null;
  onAddGameCategory?: (category: GameCategory) => void;
  gameLibrary?: Library;
}) {
  const gt = useGT();
  const res = useJsonResource<{ widgets?: Placement[] }>(`/api/users/${userId}/profile-widgets`);
  // Optimistic placements win until the next server answer replaces `res.data`.
  const [optimistic, setOptimistic] = useState<{ base: unknown; placements: Placement[] } | null>(null);
  const placements = optimistic && optimistic.base === res.data ? optimistic.placements : res.data?.widgets ?? [];
  const [addOpen, setAddOpen] = useState(false);
  const [localGameLib, setLocalGameLib] = useState<Library>(EMPTY_LIBRARY);

  useEffect(() => {
    if (!isSelf || !onAddGameCategory || !addOpen || gameLibrary) return;
    let active = true;
    fetch(`/api/users/${userId}/games`)
      .then((r) => r.json())
      .then((d) => { if (active) setLocalGameLib({ ...EMPTY_LIBRARY, ...(d.library || {}) }); })
      .catch(() => {});
    return () => { active = false; };
  }, [userId, isSelf, onAddGameCategory, addOpen, gameLibrary]);

  const persistApps = async (next: Placement[]) => {
    setOptimistic({ base: res.data, placements: next });
    try {
      const r = await fetch("/api/users/@me/widgets", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ widgets: next.map((p) => ({ id: p.id, type: p.type, applicationId: p.applicationId ?? null, builtin: p.builtin ?? null })) }),
      });
      if (!r.ok) throw new Error();
    } catch {
      toast.error(gt("Failed to save widgets"));
    } finally {
      res.reload();
    }
  };

  const addApp = async (applicationId: string) => {
    if (placements.some((p) => p.applicationId === applicationId)) return;
    await persistApps([...placements, { id: `application:${applicationId}`, type: "application", applicationId }]);
  };

  const removeApp = (applicationId: string) => persistApps(placements.filter((p) => p.applicationId !== applicationId));

  const addWishlist = async () => {
    const r = await fetch("/api/users/@me/serika-wishlist", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: true, listSlug: null }),
    }).catch(() => null);
    if (!r?.ok) {
      toast.error(gt("Could not save your Wishlist widget"));
      return;
    }
    res.reload();
  };

  if (res.loading) {
    return isSelf ? <WidgetSkeletonBlock className="h-12 w-full rounded-[10px]" /> : null;
  }

  // Only render widgets that actually resolve content — never show empty shells.
  const visible = placements.filter((p) =>
    p.builtin === SERIKA_WISHLIST_BUILTIN || (p.type === "application" && p.config && widgetHasContent(p.config, p.data ?? null))
  );
  const wishlistAdded = placements.some((p) => p.builtin === SERIKA_WISHLIST_BUILTIN);
  const addedAppIds = new Set(placements.map((p) => p.applicationId).filter((id): id is string => !!id));

  if (!isSelf && visible.length === 0) return null;

  return (
    <div className="space-y-3">
      {visible.map((p) =>
        p.builtin === SERIKA_WISHLIST_BUILTIN ? (
          <ProfileWishlistWidget key={p.id} userId={userId} isSelf={isSelf} onChanged={res.reload} />
        ) : (
          <div key={p.id} className="group relative">
            <WidgetRenderer config={p.config!} data={p.data ?? null} icon={p.application?.icon} appName={p.application?.name} />
            {isSelf && (
              <div className="absolute top-2 right-2">
                <WidgetIconButton
                  icon={X}
                  tone="danger"
                  revealOnHover
                  label={gt("Remove widget")}
                  onClick={() => removeApp(p.applicationId!)}
                  className="bg-black/60 backdrop-blur-sm"
                />
              </div>
            )}
          </div>
        )
      )}
      {isSelf && (
        <WidgetAddSlot
          onClick={() => setAddOpen(true)}
          label={gt("Add a widget")}
          className="w-full py-3 px-4 rounded-[10px] place-items-stretch"
        >
          <span className="flex items-center justify-center gap-2 text-[13px] font-medium">
            <Plus className="size-4" aria-hidden />
            {gt("Add a widget")}
            <span className="hidden sm:inline text-[var(--sw-faint)] font-normal">· {gt("games, apps, your wishlist")}</span>
          </span>
        </WidgetAddSlot>
      )}
      {isSelf && (
        <AddWidgetDialog
          open={addOpen}
          onOpenChange={setAddOpen}
          onAddGameCategory={onAddGameCategory}
          gameLibrary={gameLibrary ?? localGameLib}
          addedAppIds={addedAppIds}
          wishlistAdded={wishlistAdded}
          onAddApp={addApp}
          onAddWishlist={addWishlist}
        />
      )}
    </div>
  );
}

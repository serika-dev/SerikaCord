"use client";

import { useState, useEffect, useCallback } from "react";
import { Plus, X, Loader2, Gamepad2, Star, RotateCw, Bookmark } from "lucide-react";
import { toast } from "sonner";
import { cdnImage } from "@/lib/utils";
import { useGT } from "gt-next";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { WidgetRenderer, widgetHasContent, type WidgetConfigShape, type WidgetUserData } from "@/components/widgets/WidgetRenderer";
import type { GameCategory } from "@/components/user/ProfileGameWidgets";

interface Placement {
  id: string;
  type: string;
  applicationId?: string | null;
  builtin?: string | null;
  config?: WidgetConfigShape;
  data?: WidgetUserData | null;
}

interface AvailableWidget {
  applicationId: string;
  name: string;
  icon: string | null;
  appName: string | null;
}

const GAME_CATEGORY_OPTIONS: { category: GameCategory; icon: React.ComponentType<{ className?: string }>; label: string }[] = [
  { category: "favorite", icon: Star, label: "Favorite Game" },
  { category: "liked", icon: Gamepad2, label: "Games I Like" },
  { category: "rotation", icon: RotateCw, label: "Games in Rotation" },
  { category: "wishlist", icon: Bookmark, label: "Want to Play" },
];

function AddWidgetDialog({ open, onOpenChange, existing, onAdd, onAddGameCategory }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  existing: string[];
  onAdd: (applicationId: string) => void;
  onAddGameCategory?: (category: GameCategory) => void;
}) {
  const gt = useGT();
  const [available, setAvailable] = useState<AvailableWidget[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetch("/api/users/@me/available-widgets")
      .then((r) => r.json())
      .then((d) => setAvailable(d.widgets || []))
      .catch(() => setAvailable([]))
      .finally(() => setLoading(false));
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[#0c0c10] border-white/[0.08] sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-white">{gt("Add to Profile")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-2 max-h-[50vh] overflow-y-auto">
          {/* Game categories */}
          {onAddGameCategory && (
            <>
              <p className="text-[10px] font-bold text-white/30 uppercase tracking-wide px-1 pt-1">{gt("Games")}</p>
              {GAME_CATEGORY_OPTIONS.map(({ category, icon: Icon, label }) => (
                <button
                  key={category}
                  onClick={() => { onAddGameCategory(category); onOpenChange(false); }}
                  className="w-full flex items-center gap-3 p-2.5 rounded-lg bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.05] transition-colors text-left"
                >
                  <div className="w-9 h-9 rounded-lg bg-[#8B5CF6]/20 flex items-center justify-center"><Icon className="w-4 h-4 text-[#8B5CF6]" /></div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white font-medium truncate">{gt(label)}</p>
                  </div>
                  <Plus className="w-4 h-4 text-white/50" />
                </button>
              ))}
              {/* Divider only when there are also app widgets below */}
              {available.length > 0 && (
                <div className="border-t border-white/[0.06] my-2" />
              )}
            </>
          )}
          {/* App widgets */}
          {loading ? (
            <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-white/30" /></div>
          ) : available.length === 0 ? (
            !onAddGameCategory && <p className="text-xs text-white/40 text-center py-8">{gt("No widgets available to add yet")}</p>
          ) : (
            <>
              <p className="text-[10px] font-bold text-white/30 uppercase tracking-wide px-1">{gt("Widgets")}</p>
              {available.map((w) => {
                const added = existing.includes(w.applicationId);
                return (
                  <button
                    key={w.applicationId}
                    disabled={added}
                    onClick={() => { onAdd(w.applicationId); onOpenChange(false); }}
                    className="w-full flex items-center gap-3 p-2.5 rounded-lg bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.05] transition-colors text-left disabled:opacity-40"
                  >
                    {w.icon ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={cdnImage(w.icon)} alt="" className="w-9 h-9 rounded-lg object-cover" />
                    ) : (
                      <div className="w-9 h-9 rounded-lg bg-white/[0.05] flex items-center justify-center"><Gamepad2 className="w-4 h-4 text-white/40" /></div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-white font-medium truncate">{w.name}</p>
                      <p className="text-xs text-white/40 truncate">{w.appName || gt("Application")}</p>
                    </div>
                    {added ? <span className="text-[10px] text-white/40">{gt("Added")}</span> : <Plus className="w-4 h-4 text-white/50" />}
                  </button>
                );
              })}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ProfileAppWidgets({ userId, isSelf, appIcon, onAddGameCategory }: { userId: string; isSelf: boolean; appIcon?: string | null; onAddGameCategory?: (category: GameCategory) => void }) {
  const gt = useGT();
  const [placements, setPlacements] = useState<Placement[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);

  const refetch = useCallback(async () => {
    try {
      const res = await fetch(`/api/users/${userId}/profile-widgets`);
      const data = await res.json();
      setPlacements((data.widgets || []).filter((w: Placement) => w.type === "application"));
    } catch {
      setPlacements([]);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { setLoading(true); refetch(); }, [refetch]);

  const persist = async (next: Placement[]) => {
    setPlacements(next);
    try {
      await fetch("/api/users/@me/widgets", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ widgets: next.map((p) => ({ id: p.id, type: p.type, applicationId: p.applicationId })) }),
      });
    } catch {
      toast.error(gt("Failed to save widgets"));
      refetch();
    }
  };

  const add = async (applicationId: string) => {
    // Re-fetch resolved data after adding so config/data hydrate.
    const next = [...placements, { id: `application:${applicationId}`, type: "application", applicationId }];
    await persist(next);
    refetch();
  };

  const remove = (applicationId: string) => {
    persist(placements.filter((p) => p.applicationId !== applicationId));
  };

  if (loading) return null;

  // Only render widgets that actually resolve content — never show empty shells.
  const visible = placements.filter((p) => p.config && widgetHasContent(p.config, p.data ?? null));

  // Non-self viewers see nothing if there are no renderable widgets.
  if (!isSelf && visible.length === 0) return null;

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-[11px] font-bold text-[#9a9aad] uppercase tracking-wide">{gt("Widgets")}</h4>
        {isSelf && (
          <button onClick={() => setAddOpen(true)} className="flex items-center gap-1 text-xs text-[#8B5CF6] hover:underline">
            <Plus className="w-3.5 h-3.5" /> {gt("Add Widget")}
          </button>
        )}
      </div>
      <div className="space-y-2">
        {visible.map((p) => (
          <div key={p.id} className="group relative">
            <WidgetRenderer config={p.config!} data={p.data ?? null} icon={appIcon} />
            {isSelf && (
              <button onClick={() => remove(p.applicationId!)} className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 p-1 rounded bg-black/60 hover:bg-red-500 text-white transition"><X className="w-3.5 h-3.5" /></button>
            )}
          </div>
        ))}
        {isSelf && visible.length === 0 && (
          <button onClick={() => setAddOpen(true)} className="w-full py-3 rounded-xl border border-dashed border-white/10 text-xs text-white/40 hover:border-white/20 hover:text-white/60 transition">
            {gt("Add a widget to your profile")}
          </button>
        )}
      </div>
      <AddWidgetDialog open={addOpen} onOpenChange={setAddOpen} existing={placements.map((p) => p.applicationId!).filter(Boolean)} onAdd={add} onAddGameCategory={onAddGameCategory} />
    </div>
  );
}

"use client";

import { useState } from "react";
import { useGT, useLocale } from "gt-next";
import { toast } from "sonner";
import { ArrowUpRight, Check, Gift, RefreshCw, SlidersHorizontal, Star } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import {
  WidgetCard,
  WidgetHeader,
  WidgetIconButton,
  WidgetImage,
  WidgetSkeletonBlock,
} from "@/components/widgets/WidgetShell";
import { useJsonResource } from "@/hooks/useJsonResource";
import { cn } from "@/lib/utils";
import {
  SERIKA_WISHLIST_PUBLIC_URL,
  formatWishlistMoney,
  visibleWishlists,
  wishlistThumb,
  type WishlistItem,
  type WishlistList,
  type WishlistWidgetResponse,
} from "@/lib/serikaWishlist";

type GT = ReturnType<typeof useGT>;

const FEATURED_TILES = 6;

function itemCountLabel(count: number, gt: GT): string {
  return count === 1 ? gt("1 item") : gt("{count} items", { count });
}

function listMeta(list: WishlistList, gt: GT, locale: string): string {
  const parts = [itemCountLabel(list.itemCount, gt)];
  if (list.totalValue && list.totalValue.amount > 0) {
    parts.push(formatWishlistMoney(list.totalValue.amount, list.totalValue.currency, locale));
  }
  return parts.join(" · ");
}

/** Emoji (or gift icon) on a violet tile, the list's identity mark. */
function ListMark({ emoji, size = "md" }: { emoji: string; size?: "sm" | "md" }) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid place-items-center shrink-0 rounded-[var(--sw-radius-inner)] bg-gradient-to-br from-[var(--sw-accent)]/25 to-[var(--sw-accent-night)]/60 ring-1 ring-inset ring-[var(--sw-accent)]/30",
        size === "md" ? "size-10 text-[20px]" : "size-8 text-[16px]"
      )}
    >
      {emoji ? <span className="leading-none">{emoji}</span> : <Gift className={size === "md" ? "size-4 text-[var(--sw-accent-soft)]" : "size-3.5 text-[var(--sw-accent-soft)]"} />}
    </span>
  );
}

function ThumbFallback({ title }: { title: string }) {
  return (
    <span aria-hidden className="absolute inset-0 grid place-items-center text-[18px] font-display font-semibold text-black/25">
      {title.charAt(0).toUpperCase() || <Gift className="size-5 text-black/20" />}
    </span>
  );
}

function ItemTile({ item, list, locale }: { item: WishlistItem; list: WishlistList; locale: string }) {
  const gt = useGT();
  const price = item.price != null && item.currency ? formatWishlistMoney(item.price, item.currency, locale) : null;
  const label = [
    item.title,
    price,
    item.priority === 1 ? gt("most wanted") : null,
    item.received ? gt("already gifted") : null,
  ].filter(Boolean).join(", ");
  return (
    <li className="min-w-0">
      <a
        href={item.url ?? list.url}
        target="_blank"
        rel="noopener noreferrer nofollow"
        aria-label={label}
        title={label}
        className="sw-focus group/item relative block aspect-square overflow-hidden rounded-[var(--sw-radius-inner)] sw-stage ring-1 ring-inset ring-black/[0.06]"
      >
        {item.imageUrl ? (
          <WidgetImage
            src={wishlistThumb(item.imageUrl)}
            alt={item.title}
            cdn={false}
            className={cn(
              "absolute inset-0 size-full object-contain p-[9%] transition-transform duration-300 ease-out group-hover/item:scale-[1.06] motion-reduce:transition-none",
              item.received && "opacity-45 grayscale"
            )}
            fallback={<ThumbFallback title={item.title} />}
          />
        ) : (
          <ThumbFallback title={item.title} />
        )}
        {item.priority === 1 && (
          <span aria-hidden className="absolute left-1 top-1 grid place-items-center size-[18px] rounded-[4px] bg-[var(--sw-accent)] shadow-[0_2px_8px_rgba(91,33,182,0.55)]">
            <Star className="size-2.5 fill-white text-white" />
          </span>
        )}
        {item.received && (
          <span aria-hidden className="absolute right-1 top-1 grid place-items-center size-[18px] rounded-full bg-emerald-500 text-white shadow">
            <Check className="size-3" strokeWidth={3} />
          </span>
        )}
        {price && !item.received && (
          <span aria-hidden className="absolute bottom-1 right-1 max-w-[calc(100%-8px)] truncate rounded-[4px] bg-black/75 px-1 py-px text-[9.5px] font-semibold tabular-nums text-white">
            {price}
          </span>
        )}
      </a>
    </li>
  );
}

function FeaturedList({ list, locale }: { list: WishlistList; locale: string }) {
  const gt = useGT();
  const overflow = Math.max(0, list.itemCount - FEATURED_TILES);
  // Leave the last tile for "+N" when the list is longer than the strip.
  const shown = list.items.slice(0, overflow > 0 ? FEATURED_TILES - 1 : FEATURED_TILES);
  const hiddenCount = list.itemCount - shown.length;
  const hasMostWanted = shown.some((i) => i.priority === 1);
  return (
    <div className="space-y-2.5">
      <a
        href={list.url}
        target="_blank"
        rel="noopener noreferrer"
        className="sw-focus group/list -mx-1.5 flex items-center gap-3 rounded-[var(--sw-radius-inner)] px-1.5 py-1 transition-colors hover:bg-[var(--sw-surface-hover)]"
      >
        <ListMark emoji={list.emoji} />
        <div className="min-w-0 flex-1">
          <p className="font-display text-[15px] font-semibold leading-snug tracking-[-0.01em] text-[var(--sw-text)] truncate">{list.title}</p>
          <p className="text-[11.5px] tabular-nums text-[var(--sw-muted)] truncate">{listMeta(list, gt, locale)}</p>
        </div>
        <ArrowUpRight aria-hidden className="size-4 shrink-0 text-[var(--sw-faint)] transition-[color,transform] group-hover/list:text-[var(--sw-accent-soft)] group-hover/list:-translate-y-px group-hover/list:translate-x-px" />
      </a>
      {list.description && (
        <p className="text-[12px] leading-relaxed text-[var(--sw-muted)] line-clamp-2">{list.description}</p>
      )}
      {shown.length > 0 && (
        <ul className="grid grid-cols-3 @md:grid-cols-6 gap-1.5" aria-label={gt("Items on {title}", { title: list.title })}>
          {shown.map((item, i) => <ItemTile key={`${item.title}-${i}`} item={item} list={list} locale={locale} />)}
          {hiddenCount > 0 && overflow > 0 && (
            <li>
              <a
                href={list.url}
                target="_blank"
                rel="noopener noreferrer"
                className="sw-focus grid aspect-square place-items-center rounded-[var(--sw-radius-inner)] bg-[var(--sw-surface-raised)] ring-1 ring-inset ring-[var(--sw-hairline)] text-[var(--sw-muted)] transition-colors hover:bg-[var(--sw-accent)]/10 hover:text-[var(--sw-accent-soft)]"
                aria-label={gt("{count} more on Serika Wishlist", { count: hiddenCount })}
              >
                <span className="font-display text-[15px] font-semibold tabular-nums">+{hiddenCount}</span>
              </a>
            </li>
          )}
        </ul>
      )}
      {hasMostWanted && (
        <p className="flex items-center gap-1.5 text-[10.5px] text-[var(--sw-faint)]">
          <span aria-hidden className="grid place-items-center size-3.5 rounded-[3px] bg-[var(--sw-accent)]">
            <Star className="size-2 fill-white text-white" />
          </span>
          {gt("Most wanted")}
        </p>
      )}
    </div>
  );
}

function CompactList({ list, locale }: { list: WishlistList; locale: string }) {
  const gt = useGT();
  const thumbs = list.items.filter((i) => i.imageUrl).slice(0, 3);
  return (
    <a
      href={list.url}
      target="_blank"
      rel="noopener noreferrer"
      className="sw-focus group/list -mx-1.5 flex items-center gap-3 rounded-[var(--sw-radius-inner)] px-1.5 py-1.5 transition-colors hover:bg-[var(--sw-surface-hover)]"
    >
      <ListMark emoji={list.emoji} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-[var(--sw-text)] truncate">{list.title}</p>
        <p className="text-[11px] tabular-nums text-[var(--sw-faint)] truncate">{listMeta(list, gt, locale)}</p>
      </div>
      {thumbs.length > 0 && (
        <span aria-hidden className="hidden @xs:flex -space-x-2 shrink-0">
          {thumbs.map((item, i) => (
            <span key={i} className="relative size-8 overflow-hidden rounded-[5px] sw-stage ring-2 ring-[#0b0b0f]">
              <WidgetImage
                src={wishlistThumb(item.imageUrl!, 96)}
                alt=""
                cdn={false}
                className="absolute inset-0 size-full object-contain p-0.5"
              />
            </span>
          ))}
        </span>
      )}
      <ArrowUpRight aria-hidden className="size-3.5 shrink-0 text-[var(--sw-faint)] group-hover/list:text-[var(--sw-accent-soft)]" />
    </a>
  );
}

function WishlistSkeleton({ label }: { label: string }) {
  return (
    <div className="sw-card overflow-hidden @container" role="status" aria-busy="true">
      <span className="sr-only">{label}</span>
      <div className="flex items-center gap-2.5 px-3.5 pt-3 pb-2.5">
        <WidgetSkeletonBlock className="size-7" />
        <WidgetSkeletonBlock className="h-3.5 w-24" />
      </div>
      <div className="px-3.5 pb-3.5 space-y-2.5">
        <div className="flex items-center gap-3">
          <WidgetSkeletonBlock className="size-10" />
          <div className="flex-1 space-y-1.5">
            <WidgetSkeletonBlock className="h-3.5 w-2/5" />
            <WidgetSkeletonBlock className="h-3 w-1/4" />
          </div>
        </div>
        <div className="grid grid-cols-3 @md:grid-cols-6 gap-1.5">
          {Array.from({ length: 6 }, (_, i) => (
            <WidgetSkeletonBlock key={i} className={cn("aspect-square", i >= 3 && "hidden @md:block")} />
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Owner settings ────────────────────────────────────────────────────────────

/** Read and change the signed-in user's Wishlist widget settings. */
export function useWishlistWidgetSettings(active: boolean) {
  const [refreshToken, setRefreshToken] = useState(0);
  const url = active ? `/api/users/@me/serika-wishlist${refreshToken ? `?refresh=1&n=${refreshToken}` : ""}` : null;
  const res = useJsonResource<WishlistWidgetResponse>(url);
  const [saved, setSaved] = useState<{ base: WishlistWidgetResponse | null; enabled: boolean; listSlug: string | null } | null>(null);
  const [saving, setSaving] = useState(false);
  // A local save wins until the server answers again.
  const current = saved && saved.base === res.data ? saved : null;
  const enabled = current ? current.enabled : !!res.data?.enabled;
  const listSlug = current ? current.listSlug : res.data?.listSlug ?? null;

  const save = async (next: { enabled: boolean; listSlug: string | null }) => {
    setSaving(true);
    setSaved({ base: res.data, ...next });
    try {
      const r = await fetch("/api/users/@me/serika-wishlist", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      if (!r.ok) throw new Error();
      return true;
    } catch {
      setSaved(null);
      return false;
    } finally {
      setSaving(false);
    }
  };

  return {
    loading: res.loading,
    refreshing: res.refreshing,
    error: res.error,
    data: res.data,
    enabled,
    listSlug,
    saving,
    save,
    refresh: () => setRefreshToken((n) => n + 1),
  };
}

/** Radio list: show all public lists, or feature one. */
function FeaturedListPicker({
  lists,
  value,
  onChange,
  disabled,
}: {
  lists: WishlistList[];
  value: string | null;
  onChange: (slug: string | null) => void;
  disabled?: boolean;
}) {
  const gt = useGT();
  const locale = useLocale();
  const options: Array<{ slug: string | null; title: string; meta: string; emoji: string }> = [
    { slug: null, title: gt("All public lists"), meta: gt("Shows up to three lists"), emoji: "" },
    ...lists.map((l) => ({ slug: l.slug, title: l.title, meta: listMeta(l, gt, locale), emoji: l.emoji })),
  ];
  return (
    <div role="radiogroup" aria-label={gt("Featured list")} className="space-y-1.5">
      {options.map((o) => {
        const selected = o.slug === value;
        return (
          <button
            key={o.slug ?? "__all"}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onChange(o.slug)}
            className={cn(
              "sw-focus w-full flex items-center gap-3 rounded-[8px] border px-2.5 py-2 text-left transition-colors disabled:opacity-50",
              selected
                ? "border-[var(--sw-accent)]/70 bg-[var(--sw-accent)]/[0.09]"
                : "border-[var(--sw-hairline)] bg-white/[0.02] hover:bg-white/[0.05]"
            )}
          >
            <ListMark emoji={o.emoji} size="sm" />
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-medium text-[var(--sw-text)] truncate">{o.title}</span>
              <span className="block text-[11px] text-[var(--sw-faint)] truncate">{o.meta}</span>
            </span>
            <span
              aria-hidden
              className={cn(
                "grid place-items-center size-4 shrink-0 rounded-full border",
                selected ? "border-[var(--sw-accent)] bg-[var(--sw-accent)]" : "border-[var(--sw-hairline-strong)]"
              )}
            >
              {selected && <span className="size-1.5 rounded-full bg-white" />}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function OwnerHints({ data, refreshing, onRefresh }: { data: WishlistWidgetResponse | null; refreshing: boolean; onRefresh: () => void }) {
  const gt = useGT();
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px]">
      <a
        href={data?.profileUrl ?? SERIKA_WISHLIST_PUBLIC_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="sw-focus inline-flex items-center gap-1 rounded text-[var(--sw-accent-soft)] hover:underline"
      >
        {gt("Manage lists on Serika Wishlist")} <ArrowUpRight aria-hidden className="size-3" />
      </a>
      <button
        type="button"
        onClick={onRefresh}
        disabled={refreshing}
        className="sw-focus inline-flex items-center gap-1 rounded text-[var(--sw-muted)] hover:text-[var(--sw-text)] disabled:opacity-50"
      >
        <RefreshCw aria-hidden className={cn("size-3", refreshing && "animate-spin")} /> {gt("Refresh")}
      </button>
    </div>
  );
}

/** Body shared by the profile settings dialog and the Profiles settings card. */
function WishlistSettingsBody({ settings, showToggle }: { settings: ReturnType<typeof useWishlistWidgetSettings>; showToggle: boolean }) {
  const gt = useGT();
  const { data, loading, error, enabled, listSlug, saving, save, refresh, refreshing } = settings;
  const lists = data?.lists ?? [];

  const update = async (next: { enabled: boolean; listSlug: string | null }) => {
    const ok = await save(next);
    if (!ok) toast.error(gt("Could not save your Wishlist widget"));
  };

  return (
    <div className="space-y-3">
      {showToggle && (
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-medium text-[var(--sw-text)]">{gt("Show my wishlists on my profile")}</p>
            <p className="text-xs text-[var(--sw-muted)]">{gt("Only lists you made public on Serika Wishlist are shown.")}</p>
          </div>
          <ToggleSwitch
            checked={enabled}
            disabled={saving}
            onCheckedChange={(v) => update({ enabled: v, listSlug })}
            aria-label={gt("Show my wishlists on my profile")}
          />
        </div>
      )}
      {loading ? (
        <div className="space-y-1.5" aria-busy="true">
          <WidgetSkeletonBlock className="h-12 w-full" />
          <WidgetSkeletonBlock className="h-12 w-full" />
        </div>
      ) : error != null && !data ? (
        <p className="text-xs text-[var(--sw-muted)]">{gt("Serika Wishlist could not be reached. Try again in a moment.")}</p>
      ) : data?.found === false ? (
        <p className="text-xs text-[var(--sw-muted)]">
          {gt("You don't have any wishlists yet. Make one on Serika Wishlist and set it to public to show it here.")}
        </p>
      ) : lists.length === 0 ? (
        <p className="text-xs text-[var(--sw-muted)]">
          {gt("None of your wishlists are public yet. Lists shared only with friends or kept private never appear on your profile.")}
        </p>
      ) : (
        (!showToggle || enabled) && (
          <div className="space-y-1.5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--sw-faint)]">{gt("Featured list")}</p>
            <FeaturedListPicker lists={lists} value={listSlug} disabled={saving} onChange={(slug) => update({ enabled: true, listSlug: slug })} />
          </div>
        )
      )}
      <OwnerHints data={data} refreshing={refreshing} onRefresh={refresh} />
    </div>
  );
}

export function WishlistSettingsDialog({
  open,
  onOpenChange,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onChanged: () => void;
}) {
  const gt = useGT();
  const settings = useWishlistWidgetSettings(open);
  const remove = async () => {
    const ok = await settings.save({ enabled: false, listSlug: null });
    if (!ok) { toast.error(gt("Could not save your Wishlist widget")); return; }
    onOpenChange(false);
    onChanged();
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) onChanged();
      }}
    >
      <DialogContent className="bg-[#0c0c10] border-[var(--sw-hairline)] sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-white flex items-center gap-2">
            <Gift className="size-4 text-[var(--sw-accent-soft)]" aria-hidden /> {gt("Wishlist widget")}
          </DialogTitle>
          <DialogDescription className="text-[var(--sw-muted)]">
            {gt("Shows your public lists from Serika Wishlist. Friends-only and private lists never appear.")}
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[55vh] overflow-y-auto -mx-1 px-1">
          <WishlistSettingsBody settings={settings} showToggle={false} />
        </div>
        <div className="flex items-center justify-between gap-2 pt-1">
          <button
            type="button"
            onClick={remove}
            disabled={settings.saving}
            className="sw-focus rounded-lg px-3 py-2 text-sm text-red-300 hover:bg-red-500/10 disabled:opacity-50"
          >
            {gt("Remove from profile")}
          </button>
          <button
            type="button"
            onClick={() => { onOpenChange(false); onChanged(); }}
            className="sw-focus rounded-lg bg-[var(--sw-accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[#7c4ff0]"
          >
            {gt("Done")}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Settings follow the app theme (light or dark), so map the widget tokens the
// body uses onto theme variables for this subtree.
const THEMED_TOKENS = {
  "--sw-text": "var(--text-primary)",
  "--sw-muted": "var(--text-muted)",
  "--sw-faint": "var(--text-muted)",
  "--sw-hairline": "var(--border-subtle)",
  "--sw-hairline-strong": "var(--border-strong)",
  "--sw-accent": "var(--app-accent)",
  "--sw-accent-soft": "var(--app-accent)",
} as React.CSSProperties;

/** Card for Settings → Profiles: turn the widget on/off and pick a list. */
export function SerikaWishlistSettingsCard() {
  const gt = useGT();
  const settings = useWishlistWidgetSettings(true);
  return (
    <section
      style={THEMED_TOKENS}
      className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-app)] p-5 space-y-4"
      aria-labelledby="serika-wishlist-settings-title"
    >
      <div className="flex items-center gap-2.5">
        <span className="grid place-items-center size-8 rounded-[6px] bg-[var(--sw-accent)]/15 ring-1 ring-inset ring-[var(--sw-accent)]/25">
          <Gift className="size-4 text-[var(--sw-accent-soft)]" aria-hidden />
        </span>
        <div className="min-w-0">
          <h3 id="serika-wishlist-settings-title" className="font-display text-[15px] font-semibold text-[var(--text-primary)]">{gt("Serika Wishlist")}</h3>
          <p className="text-xs text-[var(--sw-muted)]">{gt("Add your public wishlists to your profile as a widget.")}</p>
        </div>
      </div>
      <WishlistSettingsBody settings={settings} showToggle />
    </section>
  );
}

// ── Profile widget ────────────────────────────────────────────────────────────

export function ProfileWishlistWidget({
  userId,
  isSelf,
  onChanged,
}: {
  userId: string;
  isSelf: boolean;
  /** Called after the owner changes or removes the widget. */
  onChanged?: () => void;
}) {
  const gt = useGT();
  const locale = useLocale();
  const { data, loading, reload } = useJsonResource<WishlistWidgetResponse>(`/api/users/${userId}/serika-wishlist`);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const settingsDialog = isSelf && (
    <WishlistSettingsDialog
      open={settingsOpen}
      onOpenChange={setSettingsOpen}
      onChanged={() => { reload(); onChanged?.(); }}
    />
  );

  if (loading) return <WishlistSkeleton label={gt("Loading wishlist")} />;

  const ownerActions = isSelf ? (
    <WidgetIconButton icon={SlidersHorizontal} label={gt("Wishlist widget settings")} onClick={() => setSettingsOpen(true)} />
  ) : null;

  // Problems and empty states are only ever shown to the owner; everyone else
  // simply doesn't see the widget.
  const ownerNotice = (message: string, action?: React.ReactNode) =>
    isSelf ? (
      <>
        <WidgetCard className="@container">
          <WidgetHeader icon={Gift} title={gt("Wishlist")} meta={gt("Only you can see this")} actions={ownerActions} />
          <div className="px-3.5 pb-3.5 space-y-2">
            <p className="text-[12.5px] leading-relaxed text-[var(--sw-muted)]">{message}</p>
            {action}
          </div>
        </WidgetCard>
        {settingsDialog}
      </>
    ) : null;

  if (!data) {
    return ownerNotice(
      gt("Serika Wishlist could not be reached, so your wishlist is hidden for now."),
      <button type="button" onClick={reload} className="sw-focus inline-flex items-center gap-1.5 rounded text-[12px] text-[var(--sw-accent-soft)] hover:underline">
        <RefreshCw aria-hidden className="size-3" /> {gt("Try again")}
      </button>
    );
  }
  if (!data.enabled) return null;
  if (data.found === false) {
    return ownerNotice(
      gt("You haven't made a wishlist yet. Create one and set it to public to show it here."),
      <a href={SERIKA_WISHLIST_PUBLIC_URL} target="_blank" rel="noopener noreferrer" className="sw-focus inline-flex items-center gap-1 rounded text-[12px] text-[var(--sw-accent-soft)] hover:underline">
        {gt("Open Serika Wishlist")} <ArrowUpRight aria-hidden className="size-3" />
      </a>
    );
  }

  // Owners receive every public list; render exactly what visitors get.
  const lists = visibleWishlists(data.lists ?? [], data.listSlug, false);
  if (lists.length === 0) {
    return ownerNotice(
      gt("None of your wishlists are public yet. Set a list to public on Serika Wishlist to show it here."),
      <a href={data.profileUrl ?? SERIKA_WISHLIST_PUBLIC_URL} target="_blank" rel="noopener noreferrer" className="sw-focus inline-flex items-center gap-1 rounded text-[12px] text-[var(--sw-accent-soft)] hover:underline">
        {gt("Manage lists on Serika Wishlist")} <ArrowUpRight aria-hidden className="size-3" />
      </a>
    );
  }

  const [featured, ...rest] = lists;
  const titleId = `wishlist-${userId}`;
  return (
    <>
      <WidgetCard interactive className="@container" aria-labelledby={titleId}>
        <WidgetHeader
          icon={Gift}
          title={gt("Wishlist")}
          titleId={titleId}
          meta={lists.length > 1 ? gt("{count} lists", { count: lists.length }) : undefined}
          actions={
            <>
              {data.profileUrl && (
                <a
                  href={data.profileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={gt("Open on Serika Wishlist")}
                  title={gt("Open on Serika Wishlist")}
                  className="sw-focus grid place-items-center size-7 rounded-[var(--sw-radius-inner)] text-[var(--sw-muted)] hover:text-[var(--sw-text)] hover:bg-[var(--sw-surface-hover)] transition-colors"
                >
                  <ArrowUpRight className="size-3.5" aria-hidden />
                </a>
              )}
              {ownerActions}
            </>
          }
        />
        <div className="px-3.5 pb-3.5">
          <FeaturedList list={featured} locale={locale} />
          {rest.length > 0 && (
            <div className="mt-3 pt-2 border-t border-[var(--sw-hairline)] space-y-0.5">
              {rest.map((l) => <CompactList key={l.slug} list={l} locale={locale} />)}
            </div>
          )}
        </div>
      </WidgetCard>
      {settingsDialog}
    </>
  );
}

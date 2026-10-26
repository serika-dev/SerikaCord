"use client";

import { useState } from "react";
import { useGT, useLocale } from "gt-next";
import { toast } from "sonner";
import { ArrowUpRight, Check, Gift, RefreshCw, Star, X } from "lucide-react";
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
  wishlistThumb,
  type WishlistItem,
  type WishlistList,
  type WishlistWidgetResponse,
} from "@/lib/serikaWishlist";

type GT = ReturnType<typeof useGT>;

const TILES = 6;

function itemCountLabel(count: number, gt: GT): string {
  return count === 1 ? gt("1 item") : gt("{count} items", { count });
}

export function listMeta(list: WishlistList, gt: GT, locale: string): string {
  const parts = [itemCountLabel(list.itemCount, gt)];
  if (list.totalValue && list.totalValue.amount > 0) {
    parts.push(formatWishlistMoney(list.totalValue.amount, list.totalValue.currency, locale));
  }
  return parts.join(" · ");
}

/** The list's icon image, or a plain gift icon. Never the list emoji. */
export function WishlistIcon({ list, size = "md" }: { list: Pick<WishlistList, "iconUrl"> | null; size?: "sm" | "md" }) {
  const box = size === "md" ? "size-7" : "size-8";
  const fallback = (
    <span
      aria-hidden
      className={cn(
        box,
        "grid place-items-center shrink-0 rounded-[var(--sw-radius-inner)] bg-[var(--sw-accent)]/15 ring-1 ring-inset ring-[var(--sw-accent)]/25"
      )}
    >
      <Gift className="size-3.5 text-[var(--sw-accent-soft)]" />
    </span>
  );
  if (!list?.iconUrl) return fallback;
  return (
    <span className={cn(box, "relative shrink-0 overflow-hidden rounded-[var(--sw-radius-inner)] bg-white/[0.04] ring-1 ring-inset ring-white/10")}>
      <WidgetImage src={wishlistThumb(list.iconUrl, 96)} alt="" cdn={false} className="absolute inset-0 size-full object-cover" fallback={fallback} />
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

export function WishlistSkeleton({ label }: { label: string }) {
  return (
    <div className="sw-card overflow-hidden @container" role="status" aria-busy="true">
      <span className="sr-only">{label}</span>
      <div className="flex items-center gap-2.5 px-3.5 pt-3 pb-2.5">
        <WidgetSkeletonBlock className="size-7" />
        <div className="flex-1 space-y-1.5">
          <WidgetSkeletonBlock className="h-3.5 w-2/5" />
          <WidgetSkeletonBlock className="h-2.5 w-1/4" />
        </div>
      </div>
      <div className="grid grid-cols-3 @md:grid-cols-6 gap-1.5 px-3.5 pb-3.5">
        {Array.from({ length: 6 }, (_, i) => (
          <WidgetSkeletonBlock key={i} className={cn("aspect-square", i >= 3 && "hidden @md:block")} />
        ))}
      </div>
    </div>
  );
}

export type WishlistWidgetState = "loading" | "ok" | "error" | "not_public" | "no_account";

/**
 * One Serika Wishlist list on the Board. Problems are only ever shown to the
 * owner (with a way to remove the widget); visitors just don't see it.
 */
export function ProfileWishlistWidget({
  list,
  state,
  isSelf,
  boardActions,
  onRemove,
  onRetry,
}: {
  list: WishlistList | null;
  state: WishlistWidgetState;
  isSelf: boolean;
  /** Board move controls, placed in the header. */
  boardActions?: React.ReactNode;
  onRemove?: () => void;
  onRetry?: () => void;
}) {
  const gt = useGT();
  const locale = useLocale();

  if (state === "loading") return <WishlistSkeleton label={gt("Loading wishlist")} />;

  const removeButton = isSelf && onRemove ? (
    <WidgetIconButton icon={X} tone="danger" label={gt("Remove widget")} onClick={onRemove} revealOnHover />
  ) : null;

  if (state !== "ok" || !list) {
    if (!isSelf) return null;
    const message =
      state === "error"
        ? gt("Serika Wishlist could not be reached, so this list is hidden for now.")
        : state === "no_account"
          ? gt("You haven't made a wishlist yet. Create one and set it to public to show it here.")
          : gt("This list isn't public anymore, so nobody else can see this widget. Make it public on Serika Wishlist or remove the widget.");
    return (
      <WidgetCard className="group @container">
        <WidgetHeader
          iconSlot={<WishlistIcon list={null} />}
          title={gt("Wishlist")}
          meta={gt("Only you can see this")}
          metaBelow
          actions={<>{boardActions}{removeButton}</>}
        />
        <div className="px-3.5 pb-3.5 space-y-2">
          <p className="text-[12.5px] leading-relaxed text-[var(--sw-muted)]">{message}</p>
          {state === "error" && onRetry ? (
            <button type="button" onClick={onRetry} className="sw-focus inline-flex items-center gap-1.5 rounded text-[12px] text-[var(--sw-accent-soft)] hover:underline">
              <RefreshCw aria-hidden className="size-3" /> {gt("Try again")}
            </button>
          ) : (
            <a href={SERIKA_WISHLIST_PUBLIC_URL} target="_blank" rel="noopener noreferrer" className="sw-focus inline-flex items-center gap-1 rounded text-[12px] text-[var(--sw-accent-soft)] hover:underline">
              {gt("Open Serika Wishlist")} <ArrowUpRight aria-hidden className="size-3" />
            </a>
          )}
        </div>
      </WidgetCard>
    );
  }

  const overflow = Math.max(0, list.itemCount - TILES);
  // Leave the last tile for "+N" when the list is longer than the strip.
  const shown = list.items.slice(0, overflow > 0 ? TILES - 1 : TILES);
  const hiddenCount = list.itemCount - shown.length;
  const hasMostWanted = shown.some((i) => i.priority === 1);
  const titleId = `wishlist-${list.slug}`;

  return (
    <WidgetCard interactive className="group @container" aria-labelledby={titleId}>
      <WidgetHeader
        iconSlot={<WishlistIcon list={list} />}
        title={
          <a href={list.url} target="_blank" rel="noopener noreferrer" className="sw-focus rounded hover:underline decoration-[var(--sw-accent)]/60 underline-offset-2">
            {list.title}
          </a>
        }
        titleId={titleId}
        meta={listMeta(list, gt, locale)}
        metaBelow
        actions={
          <>
            <a
              href={list.url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={gt("Open on Serika Wishlist")}
              title={gt("Open on Serika Wishlist")}
              className="sw-focus hidden sm:grid place-items-center size-7 rounded-[var(--sw-radius-inner)] text-[var(--sw-muted)] hover:text-[var(--sw-text)] hover:bg-[var(--sw-surface-hover)] transition-colors"
            >
              <ArrowUpRight className="size-3.5" aria-hidden />
            </a>
            {boardActions}
            {removeButton}
          </>
        }
      />
      <div className="px-3.5 pb-3.5 space-y-2.5">
        {list.description && (
          <p className="text-[12px] leading-relaxed text-[var(--sw-muted)] line-clamp-2">{list.description}</p>
        )}
        {shown.length > 0 ? (
          <ul className="grid grid-cols-3 @md:grid-cols-6 gap-1.5" aria-label={gt("Items on {title}", { title: list.title })}>
            {shown.map((item, i) => <ItemTile key={`${item.title}-${i}`} item={item} list={list} locale={locale} />)}
            {overflow > 0 && hiddenCount > 0 && (
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
        ) : (
          <p className="text-[12px] text-[var(--sw-faint)]">{gt("This list is empty for now.")}</p>
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
    </WidgetCard>
  );
}

// ── Settings → Profiles ───────────────────────────────────────────────────────

// Settings follow the app theme (light or dark), so map the widget tokens the
// card uses onto theme variables for this subtree.
const THEMED_TOKENS = {
  "--sw-text": "var(--text-primary)",
  "--sw-muted": "var(--text-muted)",
  "--sw-faint": "var(--text-muted)",
  "--sw-hairline": "var(--border-subtle)",
  "--sw-hairline-strong": "var(--border-strong)",
  "--sw-accent": "var(--app-accent)",
  "--sw-accent-soft": "var(--app-accent)",
} as React.CSSProperties;

/** Add or remove the Board widget for one list (signed-in user). */
export async function setWishlistWidget(listSlug: string | null, enabled: boolean): Promise<boolean> {
  const r = await fetch("/api/users/@me/serika-wishlist", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled, listSlug }),
  }).catch(() => null);
  return !!r?.ok;
}

/** Card for Settings → Profiles: one switch per public list. */
export function SerikaWishlistSettingsCard() {
  const gt = useGT();
  const locale = useLocale();
  const [refreshToken, setRefreshToken] = useState(0);
  const res = useJsonResource<WishlistWidgetResponse>(`/api/users/@me/serika-wishlist${refreshToken ? `?refresh=1&n=${refreshToken}` : ""}`);
  // Local toggles win until the server answers again.
  const [local, setLocal] = useState<{ base: unknown; placed: string[] } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const data = res.data;
  const placed = local && local.base === data ? local.placed : (data?.placedSlugs ?? []).filter((s): s is string => !!s);
  const lists = data?.lists ?? [];

  const toggle = async (slug: string, on: boolean) => {
    const next = on ? [...placed, slug] : placed.filter((s) => s !== slug);
    setLocal({ base: data, placed: next });
    setBusy(slug);
    const ok = await setWishlistWidget(slug, on);
    setBusy(null);
    if (!ok) {
      setLocal(null);
      toast.error(gt("Could not save your Wishlist widget"));
    }
  };

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
          <p className="text-xs text-[var(--sw-muted)]">{gt("Each public list can be its own widget on your profile. Reorder them on your Board.")}</p>
        </div>
      </div>

      {res.loading ? (
        <div className="space-y-1.5" aria-busy="true">
          <WidgetSkeletonBlock className="h-12 w-full" />
          <WidgetSkeletonBlock className="h-12 w-full" />
        </div>
      ) : !data ? (
        <p className="text-xs text-[var(--sw-muted)]">{gt("Serika Wishlist could not be reached. Try again in a moment.")}</p>
      ) : data.found === false || lists.length === 0 ? (
        <p className="text-xs text-[var(--sw-muted)]">
          {gt("None of your wishlists are public yet. Lists shared only with friends or kept private never appear on your profile.")}
        </p>
      ) : (
        <ul className="space-y-1.5">
          {lists.map((l) => {
            const on = placed.includes(l.slug);
            return (
              <li key={l.slug} className="flex items-center gap-3 rounded-[8px] border border-[var(--sw-hairline)] px-2.5 py-2">
                <WishlistIcon list={l} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-medium text-[var(--sw-text)] truncate">{l.title}</span>
                  <span className="block text-[11px] text-[var(--sw-faint)] truncate">{listMeta(l, gt, locale)}</span>
                </span>
                <ToggleSwitch
                  checked={on}
                  disabled={busy !== null}
                  onCheckedChange={(v) => toggle(l.slug, v)}
                  aria-label={gt("Show {title} on my profile", { title: l.title })}
                />
              </li>
            );
          })}
        </ul>
      )}

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
          onClick={() => setRefreshToken((n) => n + 1)}
          disabled={res.refreshing}
          className="sw-focus inline-flex items-center gap-1 rounded text-[var(--sw-muted)] hover:text-[var(--sw-text)] disabled:opacity-50"
        >
          <RefreshCw aria-hidden className={cn("size-3", res.refreshing && "animate-spin")} /> {gt("Refresh")}
        </button>
      </div>
    </section>
  );
}

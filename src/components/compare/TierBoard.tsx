import Link from "next/link";
import { TIERS, type Tier, type TierAppId } from "@/lib/compare";
import { groupByTier, type Ranking } from "@/lib/compare/tiers";
import { AppMark } from "./CompareBlocks";

/**
 * Tier list visuals: coloured tier rows with app chips. Server components.
 * Tier colours are fixed hues (like every tier list) and readable in both
 * themes; everything else uses the theme variables.
 */

const TIER_SOLID: Record<Tier, string> = {
  S: "bg-rose-500 text-white",
  A: "bg-orange-500 text-white",
  B: "bg-amber-400 text-zinc-900",
  C: "bg-lime-500 text-zinc-900",
  D: "bg-sky-500 text-white",
  F: "bg-zinc-500 text-white",
};

const TIER_TINT: Record<Tier, string> = {
  S: "bg-rose-500/[0.07]",
  A: "bg-orange-500/[0.07]",
  B: "bg-amber-400/[0.08]",
  C: "bg-lime-500/[0.08]",
  D: "bg-sky-500/[0.07]",
  F: "bg-zinc-500/[0.08]",
};

export function TierLetter({ tier, size = "md" }: { tier: Tier; size?: "sm" | "md" }) {
  const dims = size === "sm" ? "h-7 w-7 text-sm" : "h-10 w-10 text-lg";
  return (
    <span className={`inline-flex items-center justify-center rounded-lg font-black ${dims} ${TIER_SOLID[tier]}`}>
      {tier}
    </span>
  );
}

export interface TierApp {
  name: string;
  short: string;
  hue: number;
  href: string;
  shutdown?: boolean;
}

function Chip({ id, app, highlight }: { id: TierAppId; app: TierApp; highlight: boolean }) {
  return (
    <Link
      href={app.href}
      data-app={id}
      className={`inline-flex items-center gap-1.5 rounded-full border py-1 pl-1 pr-3 text-sm font-medium transition-colors hover:border-[var(--app-accent)] ${
        highlight
          ? "border-[var(--app-accent)] bg-[var(--app-accent)]/15 text-[var(--app-text)] ring-1 ring-[var(--app-accent)]/40"
          : "border-[var(--app-border)] bg-[var(--app-surface)] text-[var(--app-text)]"
      } ${app.shutdown ? "opacity-70" : ""}`}
    >
      <AppMark name={app.name} hue={app.hue} size="sm" />
      <span className={app.shutdown ? "line-through decoration-1" : ""}>{app.short}</span>
    </Link>
  );
}

/** One board: six tier rows, apps as chips in best-to-worst order. */
export function TierRows({
  ranking,
  apps,
  tierNames,
  emptyLabel,
  highlight = "serikacord",
}: {
  ranking: Ranking;
  apps: Record<TierAppId, TierApp>;
  tierNames: Record<Tier, string>;
  emptyLabel: string;
  highlight?: TierAppId;
}) {
  const grouped = groupByTier(ranking);
  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--app-border)]">
      {TIERS.map((tier, i) => (
        <div key={tier} className={`flex min-h-14 ${i > 0 ? "border-t border-[var(--app-border)]" : ""} ${TIER_TINT[tier]}`}>
          <div className={`flex w-12 shrink-0 items-center justify-center text-2xl font-black sm:w-16 sm:text-3xl ${TIER_SOLID[tier]}`} aria-hidden>
            {tier}
          </div>
          {grouped[tier].length > 0 ? (
            <ul aria-label={tierNames[tier]} className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 p-2 sm:gap-2 sm:p-3">
              {grouped[tier].map((id) => (
                <li key={id}>
                  <Chip id={id} app={apps[id]} highlight={id === highlight} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="flex flex-1 items-center p-3 text-sm italic text-[var(--app-muted)]">
              <span className="sr-only">{tierNames[tier]}: </span>
              {emptyLabel}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

/** The reasons, best to worst, as a list under a board. */
export function TierReasons({
  ranking,
  apps,
  reasons,
  highlight = "serikacord",
}: {
  ranking: Ranking;
  apps: Record<TierAppId, TierApp>;
  reasons: Record<TierAppId, string>;
  highlight?: TierAppId;
}) {
  return (
    <ol className="divide-y divide-[var(--app-border)]">
      {ranking.map(([id, tier], i) => (
        <li
          key={id}
          className={`flex gap-3 px-3 py-2.5 text-sm sm:px-4 ${id === highlight ? "bg-[var(--app-accent)]/10" : ""}`}
        >
          <span className="w-6 shrink-0 pt-1 text-right font-mono text-xs text-[var(--app-muted)]">{i + 1}</span>
          <TierLetter tier={tier} size="sm" />
          <span className="min-w-0 flex-1 leading-relaxed">
            <Link href={apps[id].href} className="font-semibold hover:text-[var(--app-accent)]">
              {apps[id].name}
            </Link>
            <span className="text-[var(--app-muted)]"> · {reasons[id]}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

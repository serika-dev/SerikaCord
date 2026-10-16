import type { CSSProperties, ReactNode } from "react";
import { getGT } from "gt-next/server";
import { Check, CircleDashed, Clock, ExternalLink, HelpCircle, X } from "lucide-react";
import { FACT_GROUPS, sourceNumbers, type CompareSource, type CompareStatus, type FactCell, type Facts, type RowId } from "@/lib/compare";
import { factLabels, statusLabels } from "@/lib/compare/labels";

/**
 * Building blocks for the per-app comparison pages. Server components;
 * colours come from theme variables (status / tier hues use Tailwind's
 * palette at low opacity so they read in light and dark themes).
 */

/** A round letter mark for an app (we don't ship other companies' logos). */
export function AppMark({ name, hue, size = "md" }: { name: string; hue: number; size?: "sm" | "md" | "lg" }) {
  const dims = size === "lg" ? "h-12 w-12 text-lg" : size === "sm" ? "h-6 w-6 text-[11px]" : "h-9 w-9 text-sm";
  const style: CSSProperties = { backgroundColor: `hsl(${hue} 62% 46%)` };
  return (
    <span aria-hidden className={`inline-flex shrink-0 items-center justify-center rounded-full font-bold text-white ${dims}`} style={style}>
      {name.replace(/[^A-Za-z0-9]/g, "").slice(0, 1).toUpperCase()}
    </span>
  );
}

/** Superscript links to the numbered source list. */
export function SourceRefs({ numbers }: { numbers: number[] }) {
  if (numbers.length === 0) return null;
  return (
    <sup className="ml-0.5 whitespace-nowrap text-[10px] font-medium">
      {numbers.map((n, i) => (
        <span key={n}>
          {i > 0 && ","}
          <a href={`#source-${n}`} className="text-[var(--hm-accent-text)] hover:underline">
            [{n}]
          </a>
        </span>
      ))}
    </sup>
  );
}

/** Rows where "yes" is bad news for the user, so the colours flip. */
const INVERTED_ROWS: RowId[] = ["ads", "phone", "ageChecks"];

const GOOD = "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400";
const BAD = "bg-rose-500/10 text-rose-700 dark:text-rose-400";
const MID = "bg-amber-500/10 text-amber-700 dark:text-amber-400";
const SOON = "bg-sky-500/10 text-sky-700 dark:text-sky-400";
const NEUTRAL = "bg-[var(--hm-surface-2)] text-[var(--hm-body)]";

function statusStyle(status: CompareStatus, inverted: boolean): string {
  switch (status) {
    case "yes":
      return inverted ? BAD : GOOD;
    case "no":
      return inverted ? GOOD : BAD;
    case "partial":
      return MID;
    case "notyet":
      return SOON;
    default:
      return NEUTRAL;
  }
}

const STATUS_ICON = { yes: Check, no: X, partial: CircleDashed, notyet: Clock, unknown: HelpCircle } as const;

function CellBody({
  cell,
  row,
  labels,
  refs,
}: {
  cell: FactCell;
  row: RowId;
  labels: Record<CompareStatus, string>;
  refs: number[];
}) {
  const Icon = cell.status ? STATUS_ICON[cell.status] : null;
  return (
    <div className="text-sm leading-relaxed">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {cell.status && Icon && (
          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${statusStyle(cell.status, INVERTED_ROWS.includes(row))}`}>
            <Icon className="h-3.5 w-3.5" aria-hidden />
            {labels[cell.status]}
          </span>
        )}
        {cell.value && <span className="font-semibold text-[var(--hm-ink)]">{cell.value}</span>}
        {!cell.note && <SourceRefs numbers={refs} />}
      </div>
      {cell.note && (
        <p className="mt-1 text-[13px] text-[var(--hm-body)]">
          {cell.note}
          <SourceRefs numbers={refs} />
        </p>
      )}
    </div>
  );
}

/**
 * The detailed fact table: SerikaCord vs one app, grouped. A real table on
 * wide screens; stacked cards on phones (the table is hidden there, so
 * screen readers only meet one of the two).
 */
export async function FactTable({
  appName,
  serika,
  app,
  lookup,
}: {
  appName: string;
  serika: Facts;
  app: Facts;
  lookup: Map<string, number>;
}) {
  const gt = await getGT();
  const [{ groups, rows }, labels] = await Promise.all([factLabels(), statusLabels()]);

  return (
    <div>
      {/* Wide screens */}
      <div className="hidden overflow-hidden rounded-2xl border border-[var(--hm-line)] md:block">
        <table className="w-full table-fixed border-collapse text-left">
          <caption className="sr-only">{gt("SerikaCord and {app} compared, feature by feature", { app: appName })}</caption>
          <thead className="bg-[var(--hm-surface-2)] text-sm">
            <tr>
              <th scope="col" className="w-[26%] px-4 py-3 font-semibold">{gt("Feature")}</th>
              <th scope="col" className="w-[37%] px-4 py-3 font-semibold">SerikaCord</th>
              <th scope="col" className="w-[37%] px-4 py-3 font-semibold">{appName}</th>
            </tr>
          </thead>
          {FACT_GROUPS.map((group) => (
            <tbody key={group.id}>
              <tr className="border-t border-[var(--hm-line)] bg-[var(--hm-bg)]">
                <th scope="colgroup" colSpan={3} className="px-4 pb-2 pt-5 text-xs font-bold uppercase tracking-wider text-[var(--hm-accent-text)]">
                  {groups[group.id]}
                </th>
              </tr>
              {group.rows.map((row) => (
                <tr key={row} className="border-t border-[var(--hm-line)] bg-[var(--hm-surface)] align-top">
                  <th scope="row" className="px-4 py-3 text-sm font-medium">{rows[row]}</th>
                  <td className="px-4 py-3">
                    <CellBody cell={serika[row]} row={row} labels={labels} refs={sourceNumbers(lookup, "serika", serika[row].src)} />
                  </td>
                  <td className="px-4 py-3">
                    <CellBody cell={app[row]} row={row} labels={labels} refs={sourceNumbers(lookup, "app", app[row].src)} />
                  </td>
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>

      {/* Phones */}
      <div className="space-y-8 md:hidden">
        {FACT_GROUPS.map((group) => (
          <section key={group.id} aria-label={groups[group.id]}>
            <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-[var(--hm-accent-text)]">{groups[group.id]}</h3>
            <ul className="space-y-3">
              {group.rows.map((row) => (
                <li key={row} className="rounded-xl border border-[var(--hm-line)] bg-[var(--hm-surface)] p-4">
                  <h4 className="mb-3 text-sm font-semibold">{rows[row]}</h4>
                  <div className="space-y-3">
                    <div>
                      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--hm-body)]">SerikaCord</p>
                      <CellBody cell={serika[row]} row={row} labels={labels} refs={sourceNumbers(lookup, "serika", serika[row].src)} />
                    </div>
                    <div className="border-t border-[var(--hm-line)] pt-3">
                      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--hm-body)]">{appName}</p>
                      <CellBody cell={app[row]} row={row} labels={labels} refs={sourceNumbers(lookup, "app", app[row].src)} />
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

export async function StatusLegend() {
  const gt = await getGT();
  return (
    <p className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-[var(--hm-body)]">
      <span className="inline-flex items-center gap-1"><Check className="h-3.5 w-3.5" aria-hidden />{gt("Yes: available today")}</span>
      <span className="inline-flex items-center gap-1"><CircleDashed className="h-3.5 w-3.5" aria-hidden />{gt("Partly: limited, paid or with caveats")}</span>
      <span className="inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5" aria-hidden />{gt("Not yet: announced or in development")}</span>
      <span className="inline-flex items-center gap-1"><X className="h-3.5 w-3.5" aria-hidden />{gt("No: not offered")}</span>
      <span className="inline-flex items-center gap-1"><HelpCircle className="h-3.5 w-3.5" aria-hidden />{gt("Couldn't verify from a reliable source")}</span>
      <span>{gt("Green means good for you, red means bad for you: for ads, phone numbers and ID checks, a Yes is red.")}</span>
    </p>
  );
}

/** Points with a bold title, text and source refs, in a responsive grid. */
export function PointGrid({
  points,
  lookup,
  scope,
  tone,
}: {
  points: { title: string; text: string; src?: string[] }[];
  lookup: Map<string, number>;
  scope: "app" | "serika";
  tone: "us" | "them";
}) {
  const bar = tone === "us" ? "before:bg-[var(--brand-violet)]" : "before:bg-[var(--hm-body)]";
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {points.map((p) => (
        <li
          key={p.title}
          className={`relative overflow-hidden rounded-xl border border-[var(--hm-line)] bg-[var(--hm-surface)] p-4 pl-5 before:absolute before:inset-y-0 before:left-0 before:w-1 sm:p-5 sm:pl-6 ${bar}`}
        >
          <h3 className="mb-1.5 font-semibold leading-snug">{p.title}</h3>
          <p className="text-sm leading-relaxed text-[var(--hm-body)]">
            {p.text}
            <SourceRefs numbers={sourceNumbers(lookup, scope, p.src)} />
          </p>
        </li>
      ))}
    </ul>
  );
}

/** A plain bulleted list in a soft card. */
export function BulletCard({ title, intro, points, footer }: { title?: string; intro?: ReactNode; points: string[]; footer?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-[var(--hm-line)] bg-[var(--hm-surface)] p-5 sm:p-6">
      {title && <h3 className="mb-2 text-lg font-semibold">{title}</h3>}
      {intro && <div className="mb-3 text-sm leading-relaxed text-[var(--hm-body)]">{intro}</div>}
      <ul className="list-disc space-y-2 pl-5 text-sm leading-relaxed text-[var(--hm-body)] marker:text-[var(--hm-accent-text)]">
        {points.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
      {footer}
    </div>
  );
}

/** The numbered, dated source list that the [n] references point to. */
export async function SourceList({
  list,
  note,
}: {
  list: (CompareSource & { n: number; scope: "app" | "serika" })[];
  note: ReactNode;
}) {
  const gt = await getGT();
  return (
    <div>
      <div className="mb-4 max-w-3xl text-sm leading-relaxed text-[var(--hm-body)]">{note}</div>
      <ol className="space-y-2 text-sm">
        {list.map((s) => (
          <li key={`${s.scope}-${s.id}`} id={`source-${s.n}`} className="flex scroll-mt-24 gap-3 break-words rounded-lg px-2 py-1 target:bg-[var(--hm-surface-2)]">
            <span className="w-8 shrink-0 text-right font-mono text-xs leading-5 text-[var(--hm-body)]">[{s.n}]</span>
            <span className="min-w-0">
              <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-[var(--hm-accent-text)] hover:underline">
                {s.title}
                <ExternalLink className="ml-1 inline h-3.5 w-3.5 align-[-2px]" aria-hidden />
                <span className="sr-only"> {gt("(opens in a new tab)")}</span>
              </a>
              <span className="text-[var(--hm-body)]">
                {" · "}
                {s.publisher}
                {s.date ? ` · ${s.date}` : ""}
                {" · "}
                {s.kind === "primary" ? gt("Official source") : gt("Press or third party")}
              </span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

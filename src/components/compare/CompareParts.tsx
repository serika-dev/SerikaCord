import Link from "next/link";
import type { ReactNode } from "react";
import { getGT } from "gt-next/server";
import { ArrowRight, Check, CircleDashed, Clock, ExternalLink, HelpCircle, Minus, X } from "lucide-react";
import { Logo } from "@/components/ui/Logo";
import type { CompareFaqItem, CompareSource, CompareStatus } from "@/lib/compare";

/**
 * Building blocks for the public comparison pages (/compare/*). Server
 * components; colours come from the theme variables so the pages follow
 * the visitor's light / dark theme.
 */

export async function CompareShell({ children }: { children: ReactNode }) {
  const gt = await getGT();
  return (
    <div className="min-h-dvh overflow-x-hidden bg-[var(--app-bg)] text-[var(--app-text)]">
      <nav
        aria-label={gt("Main")}
        className="sticky top-0 z-40 border-b border-[var(--app-border)] bg-[var(--app-bg)]/85 backdrop-blur-xl"
      >
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-3 px-4 sm:px-6">
          <Link href="/" className="flex shrink-0 items-center gap-2 font-bold" aria-label={gt("SerikaCord home")}>
            <Logo variant="icon" size="sm" />
            <span className="hidden sm:inline">SerikaCord</span>
          </Link>
          <div className="flex items-center gap-1 text-sm sm:gap-2">
            <Link href="/compare" className="rounded-lg px-2.5 py-1.5 text-[var(--app-muted)] transition-colors hover:text-[var(--app-text)]">
              {gt("Compare")}
            </Link>
            <Link href="/download" className="rounded-lg px-2.5 py-1.5 text-[var(--app-muted)] transition-colors hover:text-[var(--app-text)]">
              {gt("Download")}
            </Link>
            <Link
              href="/channels/me"
              className="ml-1 inline-flex items-center gap-1.5 rounded-full bg-[var(--app-accent)] px-3.5 py-1.5 font-semibold text-white transition-opacity hover:opacity-90"
            >
              {gt("Open SerikaCord")}
            </Link>
          </div>
        </div>
      </nav>

      <main className="mx-auto max-w-5xl px-4 pb-20 pt-10 sm:px-6 sm:pt-14">{children}</main>

      <footer className="border-t border-[var(--app-border)] px-4 py-10 sm:px-6">
        <div className="mx-auto flex max-w-5xl flex-col gap-6 text-sm text-[var(--app-muted)] sm:flex-row sm:items-start sm:justify-between">
          <ul className="flex flex-wrap gap-x-5 gap-y-2">
            <li><Link href="/" className="hover:text-[var(--app-text)]">{gt("Home")}</Link></li>
            <li><Link href="/compare" className="hover:text-[var(--app-text)]">{gt("All comparisons")}</Link></li>
            <li><Link href="/compare/discord" className="hover:text-[var(--app-text)]">{gt("SerikaCord vs Discord")}</Link></li>
            <li><Link href="/compare/stoat" className="hover:text-[var(--app-text)]">{gt("SerikaCord vs Stoat")}</Link></li>
            <li><Link href="/download" className="hover:text-[var(--app-text)]">{gt("Download")}</Link></li>
            <li><Link href="/privacy" className="hover:text-[var(--app-text)]">{gt("Privacy Policy")}</Link></li>
            <li><Link href="/terms" className="hover:text-[var(--app-text)]">{gt("Terms of Service")}</Link></li>
            <li>
              <a href="https://github.com/serika-dev/SerikaCord" target="_blank" rel="noopener noreferrer" className="hover:text-[var(--app-text)]">
                {gt("Source code (GitHub)")}
              </a>
            </li>
          </ul>
          <p className="shrink-0">{gt("© 2026 Serika Company. All rights reserved.")}</p>
        </div>
      </footer>
    </div>
  );
}

export async function Breadcrumbs({ items }: { items: { href?: string; label: string }[] }) {
  const gt = await getGT();
  return (
    <nav aria-label={gt("Breadcrumb")} className="mb-6 text-sm text-[var(--app-muted)]">
      <ol className="flex flex-wrap items-center gap-1.5">
        {items.map((item, i) => (
          <li key={item.label} className="flex items-center gap-1.5">
            {i > 0 && <span aria-hidden>/</span>}
            {item.href ? (
              <Link href={item.href} className="hover:text-[var(--app-text)]">{item.label}</Link>
            ) : (
              <span aria-current="page" className="text-[var(--app-text)]">{item.label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function PageHeader({ eyebrow, title, intro, meta }: { eyebrow: string; title: string; intro: ReactNode; meta: ReactNode }) {
  return (
    <header className="mb-12">
      <p className="mb-3 text-sm font-semibold text-[var(--app-accent)]">{eyebrow}</p>
      <h1 className="mb-5 text-4xl font-extrabold leading-[1.08] tracking-tight sm:text-5xl">{title}</h1>
      <div className="max-w-3xl space-y-4 text-base leading-relaxed text-[var(--app-muted)] sm:text-lg">{intro}</div>
      <div className="mt-6 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--app-muted)]">{meta}</div>
    </header>
  );
}

export function Section({ id, title, intro, children }: { id: string; title: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="mb-14 scroll-mt-20">
      <h2 id={`${id}-title`} className="mb-3 text-2xl font-bold tracking-tight sm:text-3xl">{title}</h2>
      {intro && <div className="mb-5 max-w-3xl leading-relaxed text-[var(--app-muted)]">{intro}</div>}
      {children}
    </section>
  );
}

/** Two "pick this if" cards side by side (stacked on phones). */
export function PickCards({ cards }: { cards: { title: string; points: string[] }[] }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {cards.map((card) => (
        <div key={card.title} className="rounded-2xl border border-[var(--app-border)] bg-[var(--app-surface)] p-5 sm:p-6">
          <h3 className="mb-3 text-lg font-semibold">{card.title}</h3>
          <ul className="space-y-2 text-sm leading-relaxed text-[var(--app-muted)]">
            {card.points.map((p) => (
              <li key={p} className="flex gap-2">
                <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-[var(--app-accent)]" aria-hidden />
                <span>{p}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

/** A list of strengths, each with a bold lead-in and an explanation. */
export function PointList({ points }: { points: { title: string; text: string }[] }) {
  return (
    <ul className="space-y-3">
      {points.map((p) => (
        <li key={p.title} className="rounded-xl border border-[var(--app-border)] bg-[var(--app-surface)] p-4 sm:p-5">
          <h3 className="mb-1 font-semibold">{p.title}</h3>
          <p className="text-sm leading-relaxed text-[var(--app-muted)]">{p.text}</p>
        </li>
      ))}
    </ul>
  );
}

export interface CompareRow {
  feature: string;
  values: { status: CompareStatus; note?: string }[];
}

const STATUS_STYLE: Record<CompareStatus, string> = {
  yes: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  partial: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  notyet: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
  no: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
  unknown: "bg-[var(--app-surface-alt)] text-[var(--app-muted)]",
};

const STATUS_ICON: Record<CompareStatus, typeof Check> = {
  yes: Check,
  partial: CircleDashed,
  notyet: Clock,
  no: X,
  unknown: HelpCircle,
};

export async function ComparisonTable({ columns, rows, caption }: { columns: string[]; rows: CompareRow[]; caption: string }) {
  const gt = await getGT();
  const label: Record<CompareStatus, string> = {
    yes: gt("Yes"),
    partial: gt("Partial"),
    notyet: gt("Not yet"),
    no: gt("No"),
    unknown: gt("Couldn't verify"),
  };
  return (
    <div className="overflow-x-auto rounded-2xl border border-[var(--app-border)]">
      <table className="w-full min-w-[520px] border-collapse text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-[var(--app-surface-alt)]">
          <tr>
            <th scope="col" className="w-[34%] px-4 py-3 font-semibold">{gt("Feature")}</th>
            {columns.map((c) => (
              <th key={c} scope="col" className="px-4 py-3 font-semibold">{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.feature} className="border-t border-[var(--app-border)] bg-[var(--app-surface)] align-top">
              <th scope="row" className="px-4 py-3 font-medium">{row.feature}</th>
              {row.values.map((v, i) => {
                const Icon = STATUS_ICON[v.status];
                return (
                  <td key={`${row.feature}-${columns[i]}`} className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLE[v.status]}`}>
                      <Icon className="h-3.5 w-3.5" aria-hidden />
                      {label[v.status]}
                    </span>
                    {v.note && <p className="mt-1.5 text-xs leading-relaxed text-[var(--app-muted)]">{v.note}</p>}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export async function StatusLegend() {
  const gt = await getGT();
  return (
    <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--app-muted)]">
      <span className="inline-flex items-center gap-1"><Check className="h-3.5 w-3.5" aria-hidden />{gt("Yes: available to everyone today")}</span>
      <span className="inline-flex items-center gap-1"><CircleDashed className="h-3.5 w-3.5" aria-hidden />{gt("Partial: limited, paid or with caveats")}</span>
      <span className="inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5" aria-hidden />{gt("Not yet: announced or in development")}</span>
      <span className="inline-flex items-center gap-1"><Minus className="h-3.5 w-3.5" aria-hidden />{gt("No: not offered")}</span>
    </p>
  );
}

export function FaqList({ items }: { items: CompareFaqItem[] }) {
  return (
    <div className="divide-y divide-[var(--app-border)] rounded-2xl border border-[var(--app-border)] bg-[var(--app-surface)]">
      {items.map((item) => (
        <details key={item.question} className="group px-4 py-4 sm:px-5">
          <summary className="flex cursor-pointer list-none items-start justify-between gap-4 font-semibold">
            <h3 className="text-base">{item.question}</h3>
            <span aria-hidden className="mt-0.5 text-[var(--app-muted)] transition-transform group-open:rotate-45">+</span>
          </summary>
          <p className="mt-3 text-sm leading-relaxed text-[var(--app-muted)]">{item.answer}</p>
        </details>
      ))}
    </div>
  );
}

export async function SourceList({ sources, note }: { sources: CompareSource[]; note: ReactNode }) {
  const gt = await getGT();
  return (
    <div>
      <div className="mb-4 max-w-3xl text-sm leading-relaxed text-[var(--app-muted)]">{note}</div>
      <ol className="list-decimal space-y-2 pl-5 text-sm">
        {sources.map((s) => (
          <li key={s.url} className="break-words pl-1">
            <a href={s.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-start gap-1 text-[var(--app-accent)] hover:underline">
              <span>{s.title}</span>
              <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              <span className="sr-only">{gt("(opens in a new tab)")}</span>
            </a>
            <span className="text-[var(--app-muted)]"> · {s.publisher}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export async function CompareCta() {
  const gt = await getGT();
  return (
    <section className="mt-16 rounded-3xl border border-[var(--app-border)] bg-[var(--app-surface)] p-6 text-center sm:p-10">
      <h2 className="mb-2 text-2xl font-bold sm:text-3xl">{gt("Try SerikaCord for yourself")}</h2>
      <p className="mx-auto mb-6 max-w-xl text-[var(--app-muted)]">
        {gt("It's free, it runs in your browser, and there are apps for Windows, macOS, Linux and Android. Bring your friends, or bridge your Discord server while you decide.")}
      </p>
      <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
        <Link
          href="/register"
          className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-[var(--app-accent)] px-7 py-3 font-semibold text-white transition-opacity hover:opacity-90 sm:w-auto"
        >
          {gt("Create a free account")}
          <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
        <Link
          href="/download"
          className="inline-flex w-full items-center justify-center rounded-full border border-[var(--app-border)] px-7 py-3 font-semibold transition-colors hover:bg-[var(--app-surface-alt)] sm:w-auto"
        >
          {gt("Download the app")}
        </Link>
      </div>
    </section>
  );
}
